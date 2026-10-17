package game

import "math"

// Kin is the kinematic state of a player's feet position.
type Kin struct {
	X, Y, Z  float64
	Vy       float64
	OnGround bool
	Crouch   bool    // lowered stance; persists until there is room to stand
	Impact   float64 // downward speed (m/s) of the landing that happened this tick, else 0 (fall damage reads it)
}

// MoveCmd is the movement part of an input.
type MoveCmd struct {
	F, S   float64 // forward/strafe axes in [-1,1]
	Yaw    float64
	Jump   bool
	Walk   bool
	Crouch bool // Shift held
}

func (m *Map) overlaps(s *Spec, k *Kin) bool {
	hw := s.Player.HalfWidth
	h := s.HeightOf(k)
	for i := range m.Boxes {
		o := &m.Boxes[i]
		if k.X+hw > o[0] && k.X-hw < o[3] && k.Y+h > o[1] && k.Y < o[4] && k.Z+hw > o[2] && k.Z-hw < o[5] {
			return true
		}
	}
	return false
}

// Step advances one fixed tick and returns the horizontal speed used (m/s). extra are additional solid boxes (other players, see
// PlayerSolids) that block like map boxes this tick.
// Must remain numerically identical to stepMove in client/js/physics.js.
func Step(s *Spec, m *Map, k *Kin, c MoveCmd, extra ...[6]float64) float64 {
	p := &s.Player
	dt := 1 / float64(s.TickRate)
	hw := p.HalfWidth
	// stance: crouch only starts on the ground; standing up needs headroom at the current spot
	if c.Crouch && k.OnGround {
		k.Crouch = true
	} else if !c.Crouch && k.Crouch {
		probe := *k
		probe.Crouch = false
		if !m.overlaps(s, &probe) {
			k.Crouch = false
		}
	}
	height := s.HeightOf(k)
	wasGround := k.OnGround
	speed := p.RunSpeed
	switch {
	case k.Crouch:
		speed = p.Crouch.Speed
	case c.Walk:
		speed = p.WalkSpeed
	}
	sy, cy := math.Sin(c.Yaw), math.Cos(c.Yaw)
	wx := -sy*c.F + cy*c.S
	wz := -cy*c.F - sy*c.S
	if l := math.Hypot(wx, wz); l > 1 {
		wx /= l
		wz /= l
	}
	vx, vz := wx*speed, wz*speed

	if c.Jump && k.OnGround && !k.Crouch {
		k.Vy = p.JumpSpeed
		k.OnGround = false
	}
	k.Vy -= p.Gravity * dt

	b := m.Boxes
	if len(extra) > 0 {
		b = append(append(make([][6]float64, 0, len(b)+len(extra)), b...), extra...)
	}
	hit := func(o *[6]float64) bool {
		return k.X+hw > o[0] && k.X-hw < o[3] && k.Y+height > o[1] && k.Y < o[4] && k.Z+hw > o[2] && k.Z-hw < o[5]
	}
	// step-up: a grounded player walks onto an obstacle whose top is at most StepHeight above the feet (stairs, kerbs, ramps made of
	// small steps) when there is headroom there; anything higher blocks as before (jump instead)
	stepUp := func(o *[6]float64) bool {
		if !wasGround || o[4] <= k.Y || o[4]-k.Y > p.StepHeight {
			return false
		}
		old := k.Y
		k.Y = o[4]
		for j := range b {
			if hit(&b[j]) {
				k.Y = old
				return false
			}
		}
		return true
	}
	k.X += vx * dt
	for i := range b {
		if hit(&b[i]) && !stepUp(&b[i]) {
			if vx > 0 {
				k.X = b[i][0] - hw
			} else {
				k.X = b[i][3] + hw
			}
		}
	}
	k.Z += vz * dt
	for i := range b {
		if hit(&b[i]) && !stepUp(&b[i]) {
			if vz > 0 {
				k.Z = b[i][2] - hw
			} else {
				k.Z = b[i][5] + hw
			}
		}
	}
	k.Y += k.Vy * dt
	k.OnGround = false
	impact := 0.0
	if k.Y <= 0 {
		k.Y = 0
		if k.Vy < 0 {
			if !wasGround {
				impact = -k.Vy
			}
			k.Vy = 0
		}
		k.OnGround = true
	}
	for i := range b {
		if hit(&b[i]) {
			if k.Vy > 0 {
				k.Y = b[i][1] - height
				k.Vy = 0
			} else {
				if !wasGround && -k.Vy > impact {
					impact = -k.Vy
				}
				k.Y = b[i][4]
				k.Vy = 0
				k.OnGround = true
			}
		}
	}
	k.Impact = impact
	bd := &m.Bounds
	k.X = math.Min(math.Max(k.X, bd.MinX+hw), bd.MaxX-hw)
	k.Z = math.Min(math.Max(k.Z, bd.MinZ+hw), bd.MaxZ-hw)
	return math.Hypot(vx, vz)
}

// AimDir converts view angles to a unit direction (yaw 0 looks toward -Z).
func AimDir(yaw, pitch float64) [3]float64 {
	cp := math.Cos(pitch)
	return [3]float64{-math.Sin(yaw) * cp, math.Sin(pitch), -math.Cos(yaw) * cp}
}

// RayBox is a slab test; returns entry distance (>=0) or -1 on miss.
func RayBox(o, d [3]float64, box [6]float64, maxT float64) float64 {
	tmin, tmax := 0.0, maxT
	for a := 0; a < 3; a++ {
		lo, hi := box[a], box[a+3]
		if math.Abs(d[a]) < 1e-12 {
			if o[a] < lo || o[a] > hi {
				return -1
			}
			continue
		}
		inv := 1 / d[a]
		t1, t2 := (lo-o[a])*inv, (hi-o[a])*inv
		if t1 > t2 {
			t1, t2 = t2, t1
		}
		if t1 > tmin {
			tmin = t1
		}
		if t2 < tmax {
			tmax = t2
		}
		if tmin > tmax {
			return -1
		}
	}
	return tmin
}

// RayWorld returns the distance to the nearest map geometry or floor, or maxT if none.
func (m *Map) RayWorld(o, d [3]float64, maxT float64) float64 {
	best := maxT
	if d[1] < 0 && o[1] > 0 {
		if t := -o[1] / d[1]; t < best {
			best = t
		}
	}
	for i := range m.Boxes {
		if t := RayBox(o, d, m.Boxes[i], best); t >= 0 && t < best {
			best = t
		}
	}
	return best
}

// PlayerSolids returns the boxes of the other living players as obstacles for k's next step. A player that k already overlaps (a respawn
// next to someone, two players who walked into each other in the same tick) is left out so that they can walk apart instead of being
// stuck. Must stay identical to playerSolids in client/js/physics.js.
func PlayerSolids(s *Spec, k *Kin, others []Kin) [][6]float64 {
	const eps = 1e-6
	hw := s.Player.HalfWidth
	h := s.HeightOf(k)
	var out [][6]float64
	for i := range others {
		o := &others[i]
		b := [6]float64{o.X - hw, o.Y, o.Z - hw, o.X + hw, o.Y + s.HeightOf(o), o.Z + hw}
		if k.X+hw > b[0]+eps && k.X-hw < b[3]-eps && k.Y+h > b[1]+eps && k.Y < b[4]-eps && k.Z+hw > b[2]+eps && k.Z-hw < b[5]-eps {
			continue // (eps: standing against another player is a touch, not an overlap, even with rounding noise)
		}
		out = append(out, b)
	}
	return out
}
