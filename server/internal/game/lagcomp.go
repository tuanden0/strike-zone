package game

// Lag compensation. Clients render other players ~100 ms in the past and their packets take time to arrive, so what a shooter aims
// at is where the target *was*. Each input carries `vt`, the server tick the shooter's screen was showing; hitscan is tested against
// every other player's recorded position at that tick (never more than LagCompSpec.MaxRewindTicks back, and never into the future),
// while walls, the shooter and all game state stay current. Players without a vt (bots, old clients) get no rewind.

const histLen = 32 // ring of recent positions per player (about 1 s)

type histEntry struct {
	tick     int
	x, y, z  float64
	crouch   bool
	alive    bool
	recorded bool
}

// recordHistory stores every player's position for the current tick (after movement, before shots are resolved).
func (w *World) recordHistory() {
	for _, p := range w.players {
		p.hist[w.Tick%histLen] = histEntry{tick: w.Tick, x: p.Kin.X, y: p.Kin.Y, z: p.Kin.Z, crouch: p.Kin.Crouch, alive: p.Alive, recorded: true}
	}
}

// rewindTicks is how far back the shooter's view is, clamped to the allowance.
func (w *World) rewindTicks(shooter *Player) int {
	limit := w.Spec.LagComp.MaxRewindTicks
	if limit == 0 || shooter.ViewTick <= 0 {
		return 0
	}
	d := w.Tick - shooter.ViewTick
	switch {
	case d < 0:
		return 0
	case d > limit:
		return limit
	}
	return d
}

// kinAt is the player's body state at tick t (current state when no record exists, e.g. just joined) and whether they were alive
// then: a player who has respawned since is not hittable at the spot where their previous life ended.
func (w *World) kinAt(p *Player, t int) (Kin, bool) {
	if t >= w.Tick {
		return p.Kin, true
	}
	e := p.hist[((t%histLen)+histLen)%histLen]
	if !e.recorded || e.tick != t {
		return p.Kin, true
	}
	return Kin{X: e.x, Y: e.y, Z: e.z, Crouch: e.crouch}, e.alive
}
