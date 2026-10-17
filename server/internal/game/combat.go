package game

import "math"

// resolveShots performs hitscan for every shot queued this tick. Movement of all players has
// already been applied, so results do not depend on player id order; players killed earlier in
// this phase still get their own already-queued shot resolved (trades are possible).
func (w *World) resolveShots() {
	for _, r := range w.shots {
		w.shoot(r)
	}
	w.shots = w.shots[:0]
}

// shoot resolves one queued shot with the weapon, aim and burst state of the input that fired it (not the end-of-tick state, which a later
// input of the same tick may have changed by switching weapon).
func (w *World) shoot(r shotReq) {
	p := r.p
	ws := &w.Spec.Weapons[r.weapon]
	pl := &w.Spec.Player
	eye := [3]float64{p.Kin.X, p.Kin.Y + w.Spec.EyeOf(&p.Kin), p.Kin.Z}

	// Spread grows with movement; airborne counts as full speed.
	frac := 1.0
	if p.Kin.OnGround {
		frac = math.Min(1, r.speed/pl.RunSpeed)
	}
	yaw, pitch := r.yaw, r.pitch
	if sp := w.Spec.Spread(ws, r.scoped, frac, r.burst); sp > 0 {
		r := sp * math.Sqrt(w.rng.Float64())
		a := w.rng.Float64() * 2 * math.Pi
		yaw += r * math.Cos(a)
		pitch += r * math.Sin(a)
	}
	dir := AimDir(yaw, pitch)

	best, victim, head, hitKind, _ := w.hitTest(p, eye, dir, ws.Range)
	to := [3]float64{eye[0] + dir[0]*best, eye[1] + dir[1]*best, eye[2] + dir[2]*best}
	from := eye
	w.events = append(w.events, Event{E: EvShot, By: p.ID, W: r.weapon, From: &from, To: &to, Hit: hitKind})
	if victim == nil {
		return
	}

	mult := 1.0
	if head {
		mult = ws.HeadMult
	}
	dmg := int(math.Round(ws.Damage * mult))
	victim.HP -= dmg
	w.events = append(w.events, Event{E: EvHit, By: p.ID, V: victim.ID, W: r.weapon, Dmg: dmg, Head: head})
	if victim.HP <= 0 {
		w.kill(p, victim, head, r.weapon, p.ID)
	}
}

// hitTest finds what a ray from eye along dir hits within rng: the world, or the nearest enemy hitbox (rewound by the shooter's view tick).
// It returns the hit distance, the victim (nil for none), whether the head was hit, and the hit kind.
func (w *World) hitTest(p *Player, eye, dir [3]float64, rng float64) (best float64, victim *Player, head bool, hitKind string, vk Kin) {
	best = w.Map.RayWorld(eye, dir, rng)
	hitKind = HitNone
	if best < rng {
		hitKind = HitWall
	}
	rewind := w.rewindTicks(p)
	for _, id := range w.order {
		o := w.players[id]
		if o == p || !o.Alive || o.Team == p.Team || w.Tick < o.ProtectUntil {
			continue
		}
		then, wasAlive := w.kinAt(o, w.Tick-rewind)
		if !wasAlive {
			continue
		}
		if t, h := w.rayPlayer(eye, dir, best, then); t >= 0 && t <= best {
			best, victim, head, vk = t, o, h, then
		}
	}
	if victim != nil {
		hitKind = HitBody
		if head {
			hitKind = HitHead
		}
	}
	return
}

// resolveHeavy lands every heavy stab whose windup has run out: a ray along the stabber's current view, fixed damage, no head bonus.
func (w *World) resolveHeavy() {
	for _, id := range w.order {
		p := w.players[id]
		if p.HeavyAt == 0 || w.Tick < p.HeavyAt {
			continue
		}
		p.HeavyAt = 0
		ws := &w.Spec.Weapons[p.Cur]
		if !p.Alive || ws.Heavy == nil {
			continue
		}
		eye := [3]float64{p.Kin.X, p.Kin.Y + w.Spec.EyeOf(&p.Kin), p.Kin.Z}
		dir := AimDir(p.Yaw, p.Pitch)
		best, victim, head, hitKind, vk := w.hitTest(p, eye, dir, ws.Heavy.Range)
		to := [3]float64{eye[0] + dir[0]*best, eye[1] + dir[1]*best, eye[2] + dir[2]*best}
		from := eye
		w.events = append(w.events, Event{E: EvShot, By: p.ID, W: p.Cur, From: &from, To: &to, Hit: hitKind, Hv: true})
		if victim == nil {
			continue
		}
		bs, _ := w.Spec.Boxes(vk.Crouch)
		dmg := int(math.Round(ws.Heavy.Damage * ws.Heavy.Mult(head, (to[1]-vk.Y)/bs.Y1)))
		victim.HP -= dmg
		w.events = append(w.events, Event{E: EvHit, By: p.ID, V: victim.ID, W: p.Cur, Dmg: dmg, Head: head, Hv: true})
		if victim.HP <= 0 {
			w.kill(p, victim, head, p.Cur, p.ID)
		}
	}
}

// rayPlayer returns the distance to the closer of head/body hitboxes (or -1) and whether it was the head.
func (w *World) rayPlayer(o, d [3]float64, maxT float64, k Kin) (float64, bool) {
	bs, hs := w.Spec.Boxes(k.Crouch)
	body := [6]float64{k.X - bs.HalfWidth, k.Y + bs.Y0, k.Z - bs.HalfWidth, k.X + bs.HalfWidth, k.Y + bs.Y1, k.Z + bs.HalfWidth}
	head := [6]float64{k.X - hs.HalfWidth, k.Y + hs.Y0, k.Z - hs.HalfWidth, k.X + hs.HalfWidth, k.Y + hs.Y1, k.Z + hs.HalfWidth}
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
	victim.HeavyAt = 0
	victim.LastSeq = victim.lastQueued
	w.Dirty = true
	w.events = append(w.events, Event{E: EvKill, By: by, V: victim.ID, W: wIdx, Head: head})
	if killer == nil || killer == victim || w.State != StatePlaying { // no scoring after the kill that ended the match, even in the same tick
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
