package game

import (
	"fmt"
	"math"
)

// Bot skill levels.
const (
	SkillEasy   = "easy"
	SkillNormal = "normal"
	SkillHard   = "hard"
)

// ValidSkill reports whether s names a bot difficulty.
func ValidSkill(s string) bool { return s == SkillEasy || s == SkillNormal || s == SkillHard }

type skillParams struct {
	react      int     // ticks between first seeing an enemy and opening fire
	turn       float64 // max view turn per tick (rad)
	aimErr     float64 // aim noise (rad, std dev-ish)
	burstMin   int     // shots per burst
	burstMax   int
	pause      int     // ticks between bursts
	headChance float64 // probability a target lock aims at the head
}

var skills = map[string]skillParams{
	SkillEasy:   {react: 20, turn: 0.04, aimErr: 0.05, burstMin: 2, burstMax: 3, pause: 20, headChance: 0.05},
	SkillNormal: {react: 11, turn: 0.075, aimErr: 0.028, burstMin: 3, burstMax: 5, pause: 12, headChance: 0.15},
	SkillHard:   {react: 6, turn: 0.13, aimErr: 0.012, burstMin: 4, burstMax: 8, pause: 8, headChance: 0.3},
}

// Bot is the AI driving a Player. It produces the same Input a client would send, so every rule (movement, spread, recoil
// bloom, cooldowns, grenade limits) applies to it unchanged.
type Bot struct {
	skill skillParams
	nav   *Nav

	path       [][2]float64
	pathI      int
	goalUntil  int
	target     int // enemy player id, 0 = none
	reactUntil int
	lastSeen   [3]float64
	lastSeenAt int
	aimHead    bool
	noise      [2]float64
	noiseUntil int
	strafe     float64
	strafeTill int
	burstTicks int
	pauseUntil int
	semiFlip   bool
	stuckPos   [2]float64
	stuckAt    int
	stuckHits  int
	jumpUntil  int
	nadeAt     int
}

// AddBot adds an AI player. id must be unique among players (the lobby allocates it from the same counter as sessions).
func (w *World) AddBot(id int, nick, team, skill string) (*Player, error) {
	if !ValidSkill(skill) {
		return nil, fmt.Errorf("unknown bot skill %q", skill)
	}
	p, err := w.AddPlayer(id, nick, team)
	if err != nil {
		return nil, err
	}
	p.bot = &Bot{skill: skills[skill], nav: navFor(w.Spec, w.Map)}
	p.IsBot = true
	return p, nil
}

func wrapPi(a float64) float64 {
	a = math.Mod(a+math.Pi, 2*math.Pi)
	if a < 0 {
		a += 2 * math.Pi
	}
	return a - math.Pi
}

func yawTo(dx, dz float64) float64 { return math.Atan2(-dx, -dz) }

func (b *Bot) turnToward(p *Player, yaw, pitch float64) {
	p.Yaw += math.Max(-b.skill.turn, math.Min(b.skill.turn, wrapPi(yaw-p.Yaw)))
	p.Pitch += math.Max(-b.skill.turn, math.Min(b.skill.turn, pitch-p.Pitch))
	p.Pitch = math.Max(-1.4, math.Min(1.4, p.Pitch))
}

// canSee: enemy v is in front of p (or very close), in range, with a clear line that no smoke blocks; flashed bots see nothing.
func (w *World) canSee(p, v *Player) bool {
	if p.FlashUntil > w.Tick {
		return false
	}
	eye := [3]float64{p.Kin.X, p.Kin.Y + w.Spec.Player.EyeHeight, p.Kin.Z}
	tgt := [3]float64{v.Kin.X, v.Kin.Y + 1.2, v.Kin.Z}
	dx, dy, dz := tgt[0]-eye[0], tgt[1]-eye[1], tgt[2]-eye[2]
	d := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if d > 90 {
		return false
	}
	if d > 5 {
		look := AimDir(p.Yaw, p.Pitch)
		if (look[0]*dx+look[1]*dy+look[2]*dz)/d < 0.17 { // outside ~80 degrees either side
			return false
		}
	}
	return w.clearLine(eye, tgt) && !w.smokeBlocks(eye, tgt)
}

// Think returns this tick's input for the bot's player.
func (b *Bot) Think(w *World, p *Player) Input {
	in := Input{Seq: p.LastSeq + 1, Weapon: -1}
	tick := w.Tick
	ws := &w.Spec.Weapons[p.Cur]

	// ---- perception
	var tgt *Player
	bestD := math.MaxFloat64
	for _, id := range w.order {
		v := w.players[id]
		if v == p || !v.Alive || v.Team == p.Team || tick < v.ProtectUntil || !w.canSee(p, v) {
			continue
		}
		if d := math.Hypot(v.Kin.X-p.Kin.X, v.Kin.Z-p.Kin.Z); d < bestD {
			bestD, tgt = d, v
		}
	}
	if tgt != nil {
		if b.target != tgt.ID {
			b.target = tgt.ID
			b.reactUntil = tick + b.skill.react
			b.aimHead = w.rng.Float64() < b.skill.headChance
			b.burstTicks, b.pauseUntil = 0, tick+b.skill.react
		}
		b.lastSeen = [3]float64{tgt.Kin.X, tgt.Kin.Y, tgt.Kin.Z}
		b.lastSeenAt = tick
	} else {
		b.target = 0
	}
	if tick >= b.noiseUntil {
		b.noise = [2]float64{(w.rng.Float64()*2 - 1) * b.skill.aimErr, (w.rng.Float64()*2 - 1) * b.skill.aimErr}
		b.noiseUntil = tick + 8
	}

	var wishX, wishZ float64 // desired world movement direction (unit or zero)
	switch {
	case tgt != nil:
		w.botCombat(b, p, tgt, ws, &in, &wishX, &wishZ)
	default:
		b.botRoam(w, p, &wishX, &wishZ)
		// look where we are heading
		if wishX != 0 || wishZ != 0 {
			b.turnToward(p, yawTo(wishX, wishZ), 0)
		} else {
			b.turnToward(p, p.Yaw, 0)
		}
		// housekeeping: reload when low, fall back to the pistol when dry
		if ws.MagSize > 0 && p.Mag[p.Cur] < ws.MagSize*2/5 && p.Res[p.Cur] > 0 && p.ReloadDone == 0 {
			in.Reload = true
		}
		if ws.MagSize > 0 && p.Mag[p.Cur] == 0 && p.Res[p.Cur] == 0 {
			for i := range w.Spec.Weapons {
				if i != p.Cur && p.Has[i] && (w.Spec.Weapons[i].MagSize == 0 || p.Mag[i] > 0) {
					in.Weapon = i
					break
				}
			}
		}
	}

	// ---- stuck handling
	if tick-b.stuckAt >= 20 {
		if (wishX != 0 || wishZ != 0) && math.Hypot(p.Kin.X-b.stuckPos[0], p.Kin.Z-b.stuckPos[1]) < 0.25 {
			b.stuckHits++
			b.jumpUntil = tick + 4
			b.strafe, b.strafeTill = float64(1-2*(b.stuckHits%2)), tick+15
			if b.stuckHits >= 2 {
				b.path, b.goalUntil, b.stuckHits = nil, 0, 0
			}
		} else {
			b.stuckHits = 0
		}
		b.stuckPos, b.stuckAt = [2]float64{p.Kin.X, p.Kin.Z}, tick
	}
	in.Jump = tick < b.jumpUntil

	// ---- movement in the view frame
	sy, cy := math.Sin(p.Yaw), math.Cos(p.Yaw)
	in.F = math.Max(-1, math.Min(1, -sy*wishX-cy*wishZ))
	in.S = math.Max(-1, math.Min(1, cy*wishX-sy*wishZ))
	in.Yaw, in.Pitch = p.Yaw, p.Pitch
	if in.Nade > 0 {
		in.Pitch = math.Min(1.4, p.Pitch+0.28) // loft the throw
	}
	if in.Weapon >= 0 || in.Reload {
		in.Fire = false
	}
	return in
}

func (w *World) botCombat(b *Bot, p, tgt *Player, ws *WeaponSpec, in *Input, wishX, wishZ *float64) {
	tick := w.Tick
	eye := [3]float64{p.Kin.X, p.Kin.Y + w.Spec.Player.EyeHeight, p.Kin.Z}
	ty := 1.25
	if b.aimHead {
		ty = 1.62
	}
	dx, dy, dz := tgt.Kin.X-eye[0], tgt.Kin.Y+ty-eye[1], tgt.Kin.Z-eye[2]
	hd := math.Hypot(dx, dz)
	wantYaw, wantPitch := yawTo(dx, dz)+b.noise[0], math.Atan2(dy, hd)+b.noise[1]
	b.turnToward(p, wantYaw, wantPitch)
	errAng := math.Hypot(wrapPi(wantYaw-p.Yaw), wantPitch-p.Pitch)

	// keep a fighting distance, otherwise strafe
	switch {
	case hd > 24:
		*wishX, *wishZ = dx/hd, dz/hd
	case hd < 5:
		*wishX, *wishZ = -dx/hd, -dz/hd
	default:
		if tick >= b.strafeTill {
			b.strafe = float64(1 - 2*w.rng.IntN(2))
			b.strafeTill = tick + 15 + w.rng.IntN(25)
		}
		rx, rz := -dz/hd, dx/hd // perpendicular to the line of fire
		*wishX, *wishZ = rx*b.strafe, rz*b.strafe
	}

	// firing: bursts, so the recoil bloom model rewards the bot for pausing
	if ws.MagSize > 0 && p.Mag[p.Cur] == 0 && p.Res[p.Cur] > 0 && p.ReloadDone == 0 {
		in.Reload = true
		return
	}
	if tick >= b.reactUntil && errAng < 0.04+b.skill.aimErr {
		if b.burstTicks > 0 {
			b.burstTicks--
			if ws.Auto || b.semiFlip {
				in.Fire = true
			}
			b.semiFlip = !b.semiFlip
			if b.burstTicks == 0 {
				b.pauseUntil = tick + b.skill.pause
			}
		} else if tick >= b.pauseUntil {
			shots := b.skill.burstMin + w.rng.IntN(b.skill.burstMax-b.skill.burstMin+1)
			b.burstTicks = shots * ws.IntervalTicks
		}
	}

	// grenades: lob a frag (or flash) at a distant visible enemy now and then
	if tick >= b.nadeAt && hd > 10 && hd < 28 && tgt.Alive {
		b.nadeAt = tick + 60 + w.rng.IntN(120)
		if w.rng.IntN(5) == 0 {
			for _, g := range []int{0, 2} {
				if g < len(p.Nades) && p.Nades[g] > 0 && tick >= p.NextThrow {
					in.Nade = g + 1
					break
				}
			}
		}
	}
}

// botRoam walks the bot along an A* path to a goal: the last place it saw an enemy, a weapon pickup, an enemy spawn or a
// random spot.
func (b *Bot) botRoam(w *World, p *Player, wishX, wishZ *float64) {
	tick := w.Tick
	if len(b.path) == 0 || b.pathI >= len(b.path) || tick >= b.goalUntil {
		b.pickGoal(w, p)
	}
	if b.pathI >= len(b.path) {
		return
	}
	for b.pathI < len(b.path) {
		wp := b.path[b.pathI]
		if math.Hypot(wp[0]-p.Kin.X, wp[1]-p.Kin.Z) < 0.55 {
			b.pathI++
			continue
		}
		d := math.Hypot(wp[0]-p.Kin.X, wp[1]-p.Kin.Z)
		*wishX, *wishZ = (wp[0]-p.Kin.X)/d, (wp[1]-p.Kin.Z)/d
		break
	}
}

func (b *Bot) pickGoal(w *World, p *Player) {
	tick := w.Tick
	var gx, gz float64
	switch r := w.rng.IntN(10); {
	case r < 3 && tick-b.lastSeenAt < 6*w.Spec.TickRate && b.lastSeenAt > 0:
		gx, gz = b.lastSeen[0], b.lastSeen[2]
	case r < 6:
		other := TeamB
		if p.Team == TeamB {
			other = TeamA
		}
		sp := w.Map.Spawns[other]
		s := sp[w.rng.IntN(len(sp))]
		gx, gz = s.X+(w.rng.Float64()*2-1)*6, s.Z+(w.rng.Float64()*2-1)*6
	case r < 8 && len(w.Map.Pickups) > 0:
		pk := w.Map.Pickups[w.rng.IntN(len(w.Map.Pickups))]
		gx, gz = pk.X, pk.Z
	default:
		bd := w.Map.Bounds
		gx, gz = bd.MinX+w.rng.Float64()*(bd.MaxX-bd.MinX), bd.MinZ+w.rng.Float64()*(bd.MaxZ-bd.MinZ)
	}
	b.path = b.nav.Path(p.Kin.X, p.Kin.Z, gx, gz)
	b.pathI = 0
	b.goalUntil = tick + 6*w.Spec.TickRate + w.rng.IntN(6*w.Spec.TickRate)
	if len(b.path) == 0 {
		b.goalUntil = tick + 10 // unreachable goal: try another soon
	}
}
