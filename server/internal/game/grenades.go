package game

import "math"

// Grenade kinds (GrenadeSpec.Kind).
const (
	KindFrag  = "frag"  // explodes: distance-falloff damage to enemies (and half to the thrower), blocked by walls
	KindSmoke = "smoke" // leaves a cloud that blocks line of sight (visual for players, vision for bots)
	KindFlash = "flash" // blinds everyone with a line of sight, strongest when looking at it
)

// Grenade is a thrown projectile (server-simulated; clients only render it).
type Grenade struct {
	ID, G, Owner int
	Pos, Vel     [3]float64
	Fuse         int // ticks left
}

// Smoke is a standing cloud.
type Smoke struct {
	Pos   [3]float64
	G     int
	Until int
}

// GrenadeState / SmokeState are the snapshot views.
type GrenadeState struct {
	ID int     `json:"i"`
	G  int     `json:"g"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	Z  float64 `json:"z"`
}

type SmokeState struct {
	G    int     `json:"g"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Z    float64 `json:"z"`
	Left int     `json:"l"`
}

// nadeWeaponIndex is the weapon index reported in hit/kill events for grenade damage (after the real weapons).
func (w *World) nadeWeaponIndex(g int) int { return len(w.Spec.Weapons) + g }

func (w *World) throwNade(p *Player, g int) {
	if !p.Alive || g < 0 || g >= len(w.Spec.Grenades) || p.Nades[g] <= 0 || w.Tick < p.NextThrow {
		return
	}
	gs := &w.Spec.Grenades[g]
	dir := AimDir(p.Yaw, p.Pitch)
	eye := [3]float64{p.Kin.X, p.Kin.Y + w.Spec.Player.EyeHeight, p.Kin.Z}
	start := eye
	if w.Map.RayWorld(eye, dir, 0.6) >= 0.6 { // not throwing at a wall right in front of the face
		start = [3]float64{eye[0] + dir[0]*0.5, eye[1] + dir[1]*0.5, eye[2] + dir[2]*0.5}
	}
	w.nextNade++
	w.grenades = append(w.grenades, &Grenade{
		ID: w.nextNade, G: g, Owner: p.ID, Pos: start,
		Vel:  [3]float64{dir[0] * gs.Speed, dir[1]*gs.Speed + gs.UpBias, dir[2] * gs.Speed},
		Fuse: gs.FuseTicks,
	})
	p.Nades[g]--
	p.NextThrow = w.Tick + w.Spec.Nades.CooldownTicks
	p.ProtectUntil = 0
	w.events = append(w.events, Event{E: EvThrow, By: p.ID, G: g})
}

// hitsBox reports whether a sphere of radius r at c touches the box.
func hitsBox(c [3]float64, r float64, b *[6]float64) bool {
	dx := c[0] - math.Min(math.Max(c[0], b[0]), b[3])
	dy := c[1] - math.Min(math.Max(c[1], b[1]), b[4])
	dz := c[2] - math.Min(math.Max(c[2], b[2]), b[5])
	return dx*dx+dy*dy+dz*dz < r*r
}

func (w *World) nadeHits(c [3]float64) bool {
	r := w.Spec.Nades.Radius
	for i := range w.Map.Boxes {
		if hitsBox(c, r, &w.Map.Boxes[i]) {
			return true
		}
	}
	return false
}

// moveNade integrates one tick: gravity, per-axis collision with the map boxes (bounce), floor, bounds, rolling friction.
func (w *World) moveNade(g *Grenade) {
	n := &w.Spec.Nades
	dt := 1 / float64(w.Spec.TickRate)
	g.Vel[1] -= n.Gravity * dt
	for a := 0; a < 3; a++ {
		old := g.Pos[a]
		g.Pos[a] += g.Vel[a] * dt
		if w.nadeHits(g.Pos) {
			g.Pos[a] = old
			g.Vel[a] = -g.Vel[a] * n.Restitution
			for b := 0; b < 3; b += 2 { // scrub speed on every impact
				g.Vel[b] *= 0.85
			}
		}
	}
	if g.Pos[1] < n.Radius {
		g.Pos[1] = n.Radius
		if g.Vel[1] < 0 {
			g.Vel[1] = -g.Vel[1] * n.Restitution
			if g.Vel[1] < 1 {
				g.Vel[1] = 0
			}
		}
		g.Vel[0] *= 0.8
		g.Vel[2] *= 0.8
	}
	if g.Pos[1] <= n.Radius+1e-9 && g.Vel[1] == 0 {
		g.Vel[0] *= 0.94
		g.Vel[2] *= 0.94
	}
	bd := &w.Map.Bounds
	if g.Pos[0] < bd.MinX+n.Radius || g.Pos[0] > bd.MaxX-n.Radius {
		g.Pos[0] = math.Min(math.Max(g.Pos[0], bd.MinX+n.Radius), bd.MaxX-n.Radius)
		g.Vel[0] = -g.Vel[0] * n.Restitution
	}
	if g.Pos[2] < bd.MinZ+n.Radius || g.Pos[2] > bd.MaxZ-n.Radius {
		g.Pos[2] = math.Min(math.Max(g.Pos[2], bd.MinZ+n.Radius), bd.MaxZ-n.Radius)
		g.Vel[2] = -g.Vel[2] * n.Restitution
	}
}

func (w *World) stepGrenades() {
	live := w.grenades[:0]
	for _, g := range w.grenades {
		w.moveNade(g)
		g.Fuse--
		if g.Fuse <= 0 {
			w.explode(g)
			continue
		}
		live = append(live, g)
	}
	w.grenades = live
	rest := w.smokes[:0]
	for _, s := range w.smokes {
		if w.Tick < s.Until {
			rest = append(rest, s)
		}
	}
	w.smokes = rest
}

// clearLine reports whether nothing in the map lies between a and b.
func (w *World) clearLine(a, b [3]float64) bool {
	d := [3]float64{b[0] - a[0], b[1] - a[1], b[2] - a[2]}
	l := math.Sqrt(d[0]*d[0] + d[1]*d[1] + d[2]*d[2])
	if l < 1e-6 {
		return true
	}
	d = [3]float64{d[0] / l, d[1] / l, d[2] / l}
	return w.Map.RayWorld(a, d, l) >= l-0.05
}

// smokeBlocks reports whether an active smoke cloud sits on the segment a-b.
func (w *World) smokeBlocks(a, b [3]float64) bool {
	for _, s := range w.smokes {
		r := w.Spec.Grenades[s.G].Radius
		ab := [3]float64{b[0] - a[0], b[1] - a[1], b[2] - a[2]}
		ac := [3]float64{s.Pos[0] - a[0], s.Pos[1] - a[1], s.Pos[2] - a[2]}
		den := ab[0]*ab[0] + ab[1]*ab[1] + ab[2]*ab[2]
		t := 0.0
		if den > 0 {
			t = math.Min(1, math.Max(0, (ac[0]*ab[0]+ac[1]*ab[1]+ac[2]*ab[2])/den))
		}
		dx, dy, dz := a[0]+ab[0]*t-s.Pos[0], a[1]+ab[1]*t-s.Pos[1], a[2]+ab[2]*t-s.Pos[2]
		if dx*dx+dy*dy+dz*dz < r*r {
			return true
		}
	}
	return false
}

func (w *World) explode(g *Grenade) {
	gs := &w.Spec.Grenades[g.G]
	at := g.Pos
	w.events = append(w.events, Event{E: EvBoom, By: g.Owner, G: g.G, At: &at})
	owner := w.players[g.Owner]
	switch gs.Kind {
	case KindSmoke:
		w.smokes = append(w.smokes, Smoke{Pos: at, G: g.G, Until: w.Tick + w.ticks(gs.Duration)})
	case KindFrag:
		for _, id := range w.order {
			v := w.players[id]
			if !v.Alive || w.Tick < v.ProtectUntil {
				continue
			}
			if owner != nil && v != owner && v.Team == owner.Team {
				continue // no friendly fire
			}
			c := [3]float64{v.Kin.X, v.Kin.Y + w.Spec.Player.Body.Y1/2, v.Kin.Z}
			d := math.Sqrt(sq(c[0]-at[0]) + sq(c[1]-at[1]) + sq(c[2]-at[2]))
			if d > gs.Radius || !w.clearLine(at, c) {
				continue
			}
			dmg := gs.Damage * (1 - d/gs.Radius)
			if v == owner {
				dmg /= 2
			}
			n := int(math.Round(dmg))
			if n <= 0 {
				continue
			}
			v.HP -= n
			w.events = append(w.events, Event{E: EvHit, By: g.Owner, V: v.ID, W: w.nadeWeaponIndex(g.G), Dmg: n})
			if v.HP <= 0 {
				w.kill(owner, v, false, w.nadeWeaponIndex(g.G), g.Owner)
			}
		}
	case KindFlash:
		for _, id := range w.order {
			v := w.players[id]
			if !v.Alive {
				continue
			}
			eye := [3]float64{v.Kin.X, v.Kin.Y + w.Spec.Player.EyeHeight, v.Kin.Z}
			d := math.Sqrt(sq(eye[0]-at[0]) + sq(eye[1]-at[1]) + sq(eye[2]-at[2]))
			if d > gs.Radius || !w.clearLine(at, eye) {
				continue
			}
			to := [3]float64{(at[0] - eye[0]) / math.Max(d, 1e-6), (at[1] - eye[1]) / math.Max(d, 1e-6), (at[2] - eye[2]) / math.Max(d, 1e-6)}
			look := AimDir(v.Yaw, v.Pitch)
			facing := look[0]*to[0] + look[1]*to[1] + look[2]*to[2] // 1 = looking straight at it
			f := math.Min(1, math.Max(0, (facing+0.3)/1.3)) * (1 - 0.5*d/gs.Radius)
			if t := int(math.Round(f * gs.Duration * float64(w.Spec.TickRate))); t >= 3 {
				v.FlashUntil = max(v.FlashUntil, w.Tick+t)
			}
		}
	}
}

func sq(x float64) float64 { return x * x }

func (w *World) clearGrenades() {
	w.grenades = w.grenades[:0]
	w.smokes = w.smokes[:0]
}
