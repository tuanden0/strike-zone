package game

import (
	"math"
	"testing"
)

func flatMap(boxes ...[6]float64) *Map {
	m := &Map{Boxes: boxes}
	m.Bounds.MinX, m.Bounds.MaxX, m.Bounds.MinZ, m.Bounds.MaxZ = -30, 30, -30, 30
	return m
}

func TestCrouchIsSlowerAndCannotJump(t *testing.T) {
	spec, _ := mustLoad(t)
	m := flatMap()
	k := Kin{Z: 10, OnGround: true}
	for i := 0; i < 30; i++ { // one second of crouch-walking
		Step(spec, m, &k, MoveCmd{F: 1, Crouch: true})
	}
	if !k.Crouch || math.Abs((10-k.Z)-spec.Player.Crouch.Speed) > 0.05 {
		t.Fatalf("crouched for 1 s: moved %.2f m (want %.2f), crouch=%v", 10-k.Z, spec.Player.Crouch.Speed, k.Crouch)
	}
	for i := 0; i < 5; i++ {
		Step(spec, m, &k, MoveCmd{F: 0, Crouch: true, Jump: true})
	}
	if k.Y != 0 || !k.OnGround {
		t.Fatalf("a crouched player jumped (y=%v)", k.Y)
	}
	Step(spec, m, &k, MoveCmd{}) // let go: stands up, can run again
	if k.Crouch {
		t.Fatal("did not stand up in open space")
	}
	z0 := k.Z
	for i := 0; i < 30; i++ {
		Step(spec, m, &k, MoveCmd{F: 1})
	}
	if math.Abs((z0-k.Z)-spec.Player.RunSpeed) > 0.1 {
		t.Fatalf("standing speed %.2f want %.2f", z0-k.Z, spec.Player.RunSpeed)
	}
}

func TestCrouchFitsUnderALowBeamAndCannotStandUpUnderIt(t *testing.T) {
	spec, _ := mustLoad(t)
	beam := [6]float64{-3, 1.3, 5, 3, 2.2, 7} // underside 1.3 m: standing (1.8) hits it, crouched (1.15) fits
	m := flatMap(beam)
	standing := Kin{Z: 12, OnGround: true}
	for i := 0; i < 200; i++ {
		Step(spec, m, &standing, MoveCmd{F: 1})
	}
	if standing.Z < 7 {
		t.Fatalf("a standing player walked under a 1.3 m beam (z=%.2f)", standing.Z)
	}
	k := Kin{Z: 12, OnGround: true}
	for i := 0; i < 400 && k.Z > 3; i++ {
		Step(spec, m, &k, MoveCmd{F: 1, Crouch: true})
	}
	if k.Z > 3 {
		t.Fatalf("crouched player could not pass under the beam (z=%.2f)", k.Z)
	}
	// stand up attempt under the beam: refused until clear
	k = Kin{Z: 6, OnGround: true, Crouch: true}
	Step(spec, m, &k, MoveCmd{F: 0, Crouch: false})
	if !k.Crouch {
		t.Fatal("stood up inside the beam")
	}
	for i := 0; i < 60 && k.Crouch; i++ {
		Step(spec, m, &k, MoveCmd{F: 1, Crouch: false}) // keep walking out with Shift released
		if k.Crouch && k.Z > 7.5 {
			t.Fatalf("still crouched after clearing the beam (z=%.2f)", k.Z)
		}
	}
	if k.Crouch {
		t.Fatal("never stood up after leaving the beam")
	}
}

func TestCrouchStartsOnlyOnTheGround(t *testing.T) {
	spec, _ := mustLoad(t)
	m := flatMap()
	k := Kin{OnGround: true}
	Step(spec, m, &k, MoveCmd{Jump: true})
	if k.OnGround {
		t.Fatal("setup: should be airborne")
	}
	Step(spec, m, &k, MoveCmd{Crouch: true})
	if k.Crouch {
		t.Fatal("crouched in mid-air")
	}
}

func TestCrouchedPlayerHasLowerHitboxesAndEye(t *testing.T) {
	w, a, b := duel(t)
	b.Kin.Crouch = true
	// aim at standing head height (1.65 m): passes over a crouched target (top 1.15 m)
	fireAt(t, w, a, b.Kin.X, 1.65, b.Kin.Z, -1)
	if b.HP != 100 {
		t.Fatalf("a shot at standing head height hit a crouched player (hp %d)", b.HP)
	}
	// crouched head box 0.8..1.15 -> head shot
	w2, a2, b2 := duel(t)
	b2.Kin.Crouch = true
	fireAt(t, w2, a2, b2.Kin.X, 1.0, b2.Kin.Z, -1)
	hits := eventsOf(w2, EvHit)
	if len(hits) != 1 || !hits[0].Head {
		t.Fatalf("a shot at a crouched player's head height should be a headshot: %+v", hits)
	}
	// shooter eye height follows the stance
	w3, a3, b3 := duel(t)
	a3.Kin.Crouch = true
	yaw, pitch := aim(w3, a3, b3.Kin.X, 0.6, b3.Kin.Z)
	w3.QueueInput(a3.ID, Input{Seq: 1, Yaw: yaw, Pitch: pitch, Fire: true, Crouch: true, Weapon: -1})
	w3.Step()
	sh := eventsOf(w3, EvShot)
	if len(sh) != 1 || math.Abs(sh[0].From[1]-w3.Spec.Player.Crouch.EyeHeight) > 1e-9 {
		t.Fatalf("shot origin %v want eye height %v", sh[0].From, w3.Spec.Player.Crouch.EyeHeight)
	}
}

func TestSnapshotsCarryTheStance(t *testing.T) {
	w, p := pkWorld(t)
	send(t, w, Input{Weapon: -1, Crouch: true})
	if !p.Kin.Crouch || !w.SelfFor(1).Cr {
		t.Fatal("self.cr not set while crouching")
	}
	if ps := w.Snapshot().Players; len(ps) != 1 || !ps[0].Crouch {
		t.Fatalf("players[].c not set: %+v", ps)
	}
	send(t, w, Input{Weapon: -1})
	if w.SelfFor(1).Cr {
		t.Fatal("still reported crouching after release")
	}
	// respawn stands up
	send(t, w, Input{Weapon: -1, Crouch: true})
	w.respawn(p)
	if p.Kin.Crouch {
		t.Fatal("respawned crouched")
	}
}

func TestSpecRejectsBadCrouch(t *testing.T) {
	spec, _ := mustLoad(t)
	for name, mut := range map[string]func(*Spec){
		"taller than standing": func(s *Spec) { s.Player.Crouch.Height = 2 },
		"eye above head":       func(s *Spec) { s.Player.Crouch.EyeHeight = 1.5 },
		"faster than walking":  func(s *Spec) { s.Player.Crouch.Speed = 9 },
		"head above body top":  func(s *Spec) { s.Player.Crouch.Head.Y1 = 1.6 },
		"zero height":          func(s *Spec) { s.Player.Crouch.Height = 0 },
	} {
		s2 := *spec
		mut(&s2)
		if validateSpec(&s2) == nil {
			t.Errorf("%s accepted", name)
		}
	}
}
