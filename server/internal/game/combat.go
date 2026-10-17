package game

import "math"

// resolveShots performs hitscan for every shot queued this tick. Movement of all players has
// already been applied, so results do not depend on player id order; players killed earlier in
// this phase still get their own already-queued shot resolved (trades are possible).
func (w *World) resolveShots() {
	for _, p := range w.shots {
		w.shoot(p)
	}
	w.shots = w.shots[:0]
}

func (w *World) shoot(p *Player) {
	ws := &w.Spec.Weapons[p.Cur]
	pl := &w.Spec.Player
	eye := [3]float64{p.Kin.X, p.Kin.Y + w.Spec.EyeOf(&p.Kin), p.Kin.Z}

	// Spread grows with movement; airborne counts as full speed.
	frac := 1.0
	if p.Kin.OnGround {
		frac = math.Min(1, p.Speed/pl.RunSpeed)
	}
	yaw, pitch := p.Yaw, p.Pitch
	if sp := w.Spec.Spread(ws, p.Scoped, frac, p.Burst); sp > 0 {
		r := sp * math.Sqrt(w.rng.Float64())
		a := w.rng.Float64() * 2 * math.Pi
		yaw += r * math.Cos(a)
		pitch += r * math.Sin(a)
	}
	dir := AimDir(yaw, pitch)

	best := w.Map.RayWorld(eye, dir, ws.Range)
	hitKind := HitNone
	if best < ws.Range {
		hitKind = HitWall
	}
	var victim *Player
	head := false
	for _, id := range w.order {
		o := w.players[id]
		if o == p || !o.Alive || o.Team == p.Team || w.Tick < o.ProtectUntil {
			continue
		}
		if t, h := w.rayPlayer(eye, dir, best, o); t >= 0 && t <= best {
			best, victim, head = t, o, h
		}
	}
	to := [3]float64{eye[0] + dir[0]*best, eye[1] + dir[1]*best, eye[2] + dir[2]*best}
	if victim != nil {
		hitKind = HitBody
		if head {
			hitKind = HitHead
		}
	}
	from := eye
	w.events = append(w.events, Event{E: EvShot, By: p.ID, W: p.Cur, From: &from, To: &to, Hit: hitKind})
	if victim == nil {
		return
	}

	mult := 1.0
	if head {
		mult = ws.HeadMult
	}
	dmg := int(math.Round(ws.Damage * mult))
	victim.HP -= dmg
	w.events = append(w.events, Event{E: EvHit, By: p.ID, V: victim.ID, W: p.Cur, Dmg: dmg, Head: head})
	if victim.HP <= 0 {
		w.kill(p, victim, head, p.Cur, p.ID)
	}
}

// rayPlayer returns the distance to the closer of head/body hitboxes (or -1) and whether it was the head.
func (w *World) rayPlayer(o, d [3]float64, maxT float64, v *Player) (float64, bool) {
	bs, hs := w.Spec.Boxes(v.Kin.Crouch)
	body := [6]float64{v.Kin.X - bs.HalfWidth, v.Kin.Y + bs.Y0, v.Kin.Z - bs.HalfWidth, v.Kin.X + bs.HalfWidth, v.Kin.Y + bs.Y1, v.Kin.Z + bs.HalfWidth}
	head := [6]float64{v.Kin.X - hs.HalfWidth, v.Kin.Y + hs.Y0, v.Kin.Z - hs.HalfWidth, v.Kin.X + hs.HalfWidth, v.Kin.Y + hs.Y1, v.Kin.Z + hs.HalfWidth}
	th := RayBox(o, d, head, maxT)
	tb := RayBox(o, d, body, maxT)
	switch {
	case th < 0 && tb < 0:
		return -1, false
	case th >= 0 && (tb < 0 || th <= tb):
		return th, true
	default:
		return tb, false
	}
}

// kill ends a victim. killer may be nil (its player left); a self-kill (own grenade) scores nothing. wIdx is the weapon index
// shown in the kill feed, by the id of whoever gets the credit.
func (w *World) kill(killer, victim *Player, head bool, wIdx, by int) {
	victim.Alive = false
	victim.HP = 0
	victim.Deaths++
	victim.RespawnAt = w.Tick + w.ticks(w.Spec.Match.RespawnSeconds)
	victim.queue = nil
	victim.LastSeq = victim.lastQueued
	w.Dirty = true
	w.events = append(w.events, Event{E: EvKill, By: by, V: victim.ID, W: wIdx, Head: head})
	if killer == nil || killer == victim {
		return
	}
	killer.Kills++
	idx := 0
	if killer.Team == TeamB {
		idx = 1
	}
	w.Score[idx]++
	if w.State == StatePlaying && w.Score[idx] >= w.Cfg.ScoreLimit {
		w.endMatch()
	}
}
