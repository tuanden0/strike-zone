package game

import "math"

// Pickup is a weapon lying on the ground, either a map spawn point or something a player dropped.
type Pickup struct {
	ID    int     `json:"id"`
	W     int     `json:"w"` // weapon index
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Z     float64 `json:"z"`
	Mag   int     `json:"m"`
	Res   int     `json:"r"`
	Spawn int     `json:"-"` // index of the map spawn point it belongs to, -1 for dropped weapons
	Until int     `json:"-"` // expiry tick for dropped weapons
}

// pickupRespawn tracks an empty map spawn point.
type pickupRespawn struct {
	idx int
	at  int
}

// Pickups returns the ground weapons ordered by id (valid until the next Step).
func (w *World) Pickups() []Pickup {
	out := make([]Pickup, 0, len(w.pickups))
	for _, pk := range w.pickups {
		pk := *pk
		pk.X, pk.Y, pk.Z = r3(pk.X), r3(pk.Y), r3(pk.Z)
		out = append(out, pk)
	}
	sortPickups(out)
	return out
}

func sortPickups(a []Pickup) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j].ID < a[j-1].ID; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

func (w *World) addPickup(pk Pickup) {
	w.nextPickup++
	pk.ID = w.nextPickup
	w.pickups[pk.ID] = &pk
	w.PickupsDirty = true
}

func (w *World) removePickup(id int) {
	delete(w.pickups, id)
	w.PickupsDirty = true
}

func (w *World) spawnMapPickup(idx int) {
	sp := w.Map.Pickups[idx]
	ws := &w.Spec.Weapons[sp.W]
	w.addPickup(Pickup{W: sp.W, X: sp.X, Y: 0, Z: sp.Z, Mag: ws.MagSize, Res: ws.Reserve, Spawn: idx})
}

// resetPickups clears the ground and re-creates every map spawn (match start / restart).
func (w *World) resetPickups() {
	w.pickups = map[int]*Pickup{}
	w.respawns = nil
	for i := range w.Map.Pickups {
		w.spawnMapPickup(i)
	}
	w.PickupsDirty = true
}

// stepPickups expires dropped weapons and refills empty map spawn points.
func (w *World) stepPickups() {
	for id, pk := range w.pickups {
		if pk.Spawn < 0 && w.Tick >= pk.Until {
			w.removePickup(id)
		}
	}
	rest := w.respawns[:0]
	for _, r := range w.respawns {
		if w.Tick >= r.at {
			w.spawnMapPickup(r.idx)
		} else {
			rest = append(rest, r)
		}
	}
	w.respawns = rest
}

// ownsRanged reports whether slot i is a droppable (non-melee) weapon the player owns.
func (w *World) droppable(p *Player, i int) bool {
	return i >= 0 && i < len(p.Has) && p.Has[i] && !w.Spec.Weapons[i].Melee
}

// dropWeapon puts the current weapon on the ground in front of the player.
func (w *World) dropWeapon(p *Player) {
	if !w.droppable(p, p.Cur) {
		return
	}
	w.spillWeapon(p, p.Cur, w.Spec.Pickups.DropForward)
	// switch to the first weapon still owned (the knife is never dropped)
	for i := range p.Has {
		if p.Has[i] {
			p.Cur = i
			break
		}
	}
	p.ReloadDone = 0
	p.NextFire = max(p.NextFire, w.Tick+w.Spec.SwitchTicks)
}

// spillWeapon removes weapon slot i from the player and lays it `fwd` metres ahead on the ground.
func (w *World) spillWeapon(p *Player, i int, fwd float64) {
	dir := AimDir(p.Yaw, 0)
	x := p.Kin.X + dir[0]*fwd
	z := p.Kin.Z + dir[2]*fwd
	// keep it inside the arena and out of walls: fall back to the player's own position
	probe := Kin{X: x, Y: p.Kin.Y, Z: z}
	if w.Map.overlaps(w.Spec, &probe) || x < w.Map.Bounds.MinX || x > w.Map.Bounds.MaxX || z < w.Map.Bounds.MinZ || z > w.Map.Bounds.MaxZ {
		x, z = p.Kin.X, p.Kin.Z
	}
	w.addPickup(Pickup{W: i, X: x, Y: p.Kin.Y, Z: z, Mag: p.Mag[i], Res: p.Res[i], Spawn: -1, Until: w.Tick + w.ticks(w.Spec.Pickups.DropLifetimeSeconds)})
	p.Has[i] = false
	p.Mag[i], p.Res[i] = 0, 0
}

// usePickup picks up the nearest weapon in range, swapping with the one in that slot.
func (w *World) usePickup(p *Player) {
	best, bd := 0, math.MaxFloat64
	for id, pk := range w.pickups {
		d := math.Hypot(pk.X-p.Kin.X, pk.Z-p.Kin.Z)
		if d > w.Spec.Pickups.Radius || math.Abs(pk.Y-p.Kin.Y) > 1.6 {
			continue
		}
		if d < bd || (d == bd && id < best) {
			best, bd = id, d
		}
	}
	pk := w.pickups[best]
	if pk == nil {
		return
	}
	slot := pk.W
	taken := *pk
	w.removePickup(best)
	if taken.Spawn >= 0 {
		w.respawns = append(w.respawns, pickupRespawn{idx: taken.Spawn, at: w.Tick + w.ticks(w.Spec.Pickups.RespawnSeconds)})
	}
	if p.Has[slot] { // swap: the old weapon goes where the new one was
		w.addPickup(Pickup{W: slot, X: taken.X, Y: taken.Y, Z: taken.Z, Mag: p.Mag[slot], Res: p.Res[slot], Spawn: -1, Until: w.Tick + w.ticks(w.Spec.Pickups.DropLifetimeSeconds)})
	}
	p.Has[slot] = true
	p.Mag[slot], p.Res[slot] = taken.Mag, taken.Res
	p.Cur = slot
	p.ReloadDone = 0
	p.NextFire = max(p.NextFire, w.Tick+w.Spec.SwitchTicks)
}
