package game

import "math"

// Kin is the kinematic state of a player's feet position.
type Kin struct {
	X, Y, Z  float64
	Vy       float64
	OnGround bool
}

// MoveCmd is the movement part of an input.
type MoveCmd struct {
	F, S float64 // forward/strafe axes in [-1,1]
	Yaw  float64
	Jump bool
	Walk bool
}

func (m *Map) overlaps(s *Spec, k *Kin) bool {
	hw := s.Player.HalfWidth
	for i := range m.Boxes {
		o := &m.Boxes[i]
		if k.X+hw > o[0] && k.X-hw < o[3] && k.Y+s.Player.Height > o[1] && k.Y < o[4] && k.Z+hw > o[2] && k.Z-hw < o[5] {
			return true
		}
	}
	return false
}

// Step advances one fixed tick and returns the horizontal speed used (m/s).
// Must remain numerically identical to stepMove in client/js/physics.js.
func Step(s *Spec, m *Map, k *Kin, c MoveCmd) float64 {
	p := &s.Player
	dt := 1 / float64(s.TickRate)
	hw := p.HalfWidth
	speed := p.RunSpeed
	if c.Walk {
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

	if c.Jump && k.OnGround {
		k.Vy = p.JumpSpeed
		k.OnGround = false
	}
	k.Vy -= p.Gravity * dt

	b := m.Boxes
	hit := func(o *[6]float64) bool {
		return k.X+hw > o[0] && k.X-hw < o[3] && k.Y+p.Height > o[1] && k.Y < o[4] && k.Z+hw > o[2] && k.Z-hw < o[5]
	}
	k.X += vx * dt
	for i := range b {
		if hit(&b[i]) {
			if vx > 0 {
				k.X = b[i][0] - hw
			} else {
				k.X = b[i][3] + hw
			}
		}
	}
	k.Z += vz * dt
	for i := range b {
		if hit(&b[i]) {
			if vz > 0 {
				k.Z = b[i][2] - hw
			} else {
				k.Z = b[i][5] + hw
			}
		}
	}
	k.Y += k.Vy * dt
	k.OnGround = false
	if k.Y <= 0 {
		k.Y = 0
		if k.Vy < 0 {
			k.Vy = 0
		}
		k.OnGround = true
	}
	for i := range b {
		if hit(&b[i]) {
			if k.Vy > 0 {
				k.Y = b[i][1] - p.Height
				k.Vy = 0
			} else {
				k.Y = b[i][4]
				k.Vy = 0
				k.OnGround = true
			}
		}
	}
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
