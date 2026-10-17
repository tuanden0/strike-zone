package game

import (
	"math"
	"testing"
)

func TestStepUpStairsAndRamps(t *testing.T) {
	spec, _ := mustLoad(t)
	var boxes [][6]float64
	for n := 0; n < 6; n++ { // 0.2 m risers, 0.5 m treads, going away along -z
		boxes = append(boxes, [6]float64{-1, 0, 18 - 0.5*float64(n+1), 1, 0.2 * float64(n+1), 18 - 0.5*float64(n)})
	}
	m := flatMap(boxes...)
	k := Kin{Z: 20, OnGround: true}
	for i := 0; i < 200 && k.Z > 15.6; i++ { // stop on the top step
		Step(spec, m, &k, MoveCmd{F: 1})
	}
	if math.Abs(k.Y-1.2) > 1e-9 || k.Z > 15.6 {
		t.Fatalf("walking into 0.2 m stairs: y=%.2f z=%.2f (want on top, y=1.2)", k.Y, k.Z)
	}
	// ... and back down without bouncing or taking damage
	maxImpact := 0.0
	for i := 0; i < 150; i++ {
		Step(spec, m, &k, MoveCmd{F: -1})
		maxImpact = math.Max(maxImpact, k.Impact)
	}
	if k.Y != 0 || maxImpact > spec.Player.Fall.SafeSpeed {
		t.Fatalf("walking down the stairs: y=%.2f impact=%.2f", k.Y, maxImpact)
	}
}

func TestStepUpLimits(t *testing.T) {
	spec, _ := mustLoad(t)
	run := func(m *Map, crouch bool) Kin {
		k := Kin{Z: 12, OnGround: true}
		for i := 0; i < 150 && k.Z > 6.5; i++ { // up to the middle of the block
			Step(spec, m, &k, MoveCmd{F: 1, Crouch: crouch})
		}
		return k
	}
	if k := run(flatMap([6]float64{-2, 0, 5, 2, 0.6, 7}), false); k.Y != 0 || k.Z < 7 {
		t.Fatalf("a 0.6 m block is above the step height and must block: %+v", k)
	}
	if k := run(flatMap([6]float64{-2, 0, 5, 2, 0.4, 7}), false); k.Y != 0.4 {
		t.Fatalf("a 0.4 m kerb should be walked onto: %+v", k)
	}
	if k := run(flatMap([6]float64{-2, 0, 5, 2, 0.4, 7}, [6]float64{-2, 0.9, 5, 2, 1.5, 7}), false); k.Y == 0.4 || k.Z < 7 {
		t.Fatalf("stepped onto a kerb under a low beam with no headroom (y=%v z=%v)", k.Y, k.Z)
	}
	if k := run(flatMap([6]float64{-2, 0, 5, 2, 0.3, 7}), true); k.Y != 0.3 {
		t.Fatalf("a crouched player can step up too: %+v", k)
	}
	air := Kin{Z: 6.2, Y: 0, OnGround: true}
	Step(spec, flatMap([6]float64{-2, 0, 5, 2, 0.4, 7}), &air, MoveCmd{Jump: true}) // airborne players do not auto-step
	if air.OnGround {
		t.Fatal("setup: should be airborne")
	}
}

func TestLandingImpactMatchesTheDropHeight(t *testing.T) {
	spec, _ := mustLoad(t)
	m := flatMap([6]float64{-3, 0, 5, 3, 3, 7})
	k := Kin{Y: 3, Z: 6, OnGround: false}
	var impact float64
	for i := 0; i < 90 && impact == 0; i++ {
		Step(spec, m, &k, MoveCmd{}) // stand over the platform edge? no: z=6 is on it
		impact = k.Impact
	}
	// from 3 m onto the 3 m platform top: tiny
	if impact > 1 {
		t.Fatalf("landing on the platform you stand on: impact %.2f", impact)
	}
	k = Kin{Y: 3, Z: 12, OnGround: false} // 3 m above the floor, off the platform
	impact = 0
	for i := 0; i < 90 && impact == 0; i++ {
		Step(spec, m, &k, MoveCmd{})
		impact = k.Impact
	}
	want := math.Sqrt(2 * spec.Player.Gravity * 3)
	if math.Abs(impact-want) > 0.7 { // discrete integration: within about 0.6 m/s of sqrt(2 g h)
		t.Fatalf("3 m drop: impact %.2f m/s, want about %.2f", impact, want)
	}
	// a normal jump lands below the safe speed, and ordinary walking never reports an impact
	k = Kin{OnGround: true}
	Step(spec, m, &k, MoveCmd{Jump: true})
	maxI := 0.0
	for i := 0; i < 60; i++ {
		Step(spec, m, &k, MoveCmd{})
		maxI = math.Max(maxI, k.Impact)
	}
	if maxI <= 0 || maxI > spec.Player.Fall.SafeSpeed {
		t.Fatalf("a normal jump should land with 0 < impact <= safe speed (%v), got %.2f", spec.Player.Fall.SafeSpeed, maxI)
	}
}

func dropPlayer(w *World, p *Player, height float64) {
	p.Kin = Kin{X: 5, Y: height, Z: 12}
	p.ProtectUntil = 0
}

func TestFallDamageHurtsKillsAndRespectsProtection(t *testing.T) {
	w, p := pkWorld(t)
	dropPlayer(w, p, 3) // ~10.9 m/s: over the 9 m/s threshold
	for i := 0; i < 60; i++ {
		send(t, w, idle())
	}
	if p.HP >= 100 || p.HP <= 0 {
		t.Fatalf("a 3 m fall should hurt but not kill: hp %d", p.HP)
	}
	// high drop kills: no score for anybody, kill feed names the fall
	w2, p2 := pkWorld(t)
	dropPlayer(w2, p2, 12)
	var killEv []Event
	for i := 0; i < 90 && p2.Alive; i++ {
		send(t, w2, idle())
		killEv = append(killEv, eventsOf(w2, EvKill)...)
	}
	if p2.Alive || p2.Deaths != 1 || p2.Kills != 0 || w2.Score != [2]int{} {
		t.Fatalf("fall death: alive=%v deaths=%d kills=%d score=%v", p2.Alive, p2.Deaths, p2.Kills, w2.Score)
	}
	if len(killEv) != 1 || killEv[0].W != w2.fallIndex() || killEv[0].V != p2.ID {
		t.Fatalf("kill event %+v (want weapon index %d)", killEv, w2.fallIndex())
	}
	// spawn protection absorbs it
	w3, p3 := pkWorld(t)
	dropPlayer(w3, p3, 6)
	p3.ProtectUntil = w3.Tick + 1000
	for i := 0; i < 60; i++ {
		send(t, w3, idle())
	}
	if p3.HP != 100 {
		t.Fatalf("protected player took fall damage (%d)", p3.HP)
	}
	// stairs and jumps never hurt
	w4, p4 := pkWorld(t)
	for i := 0; i < 5; i++ {
		send(t, w4, Input{Weapon: -1, Jump: true})
		for k := 0; k < 25; k++ {
			send(t, w4, idle())
		}
	}
	if p4.HP != 100 {
		t.Fatalf("jumping hurt (%d)", p4.HP)
	}
}

func TestSpecRejectsBadStepAndFall(t *testing.T) {
	spec, _ := mustLoad(t)
	for name, mut := range map[string]func(*Spec){
		"huge step":     func(s *Spec) { s.Player.StepHeight = 2 },
		"negative step": func(s *Spec) { s.Player.StepHeight = -1 },
		"safe speed 0":  func(s *Spec) { s.Player.Fall.SafeSpeed = 0 },
		"neg damage":    func(s *Spec) { s.Player.Fall.DamagePerSpeed = -1 },
	} {
		s2 := *spec
		mut(&s2)
		if validateSpec(&s2) == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestBotNavigationClimbsStairsButNotWalls(t *testing.T) {
	spec, _ := mustLoad(t)
	wall := func(top float64) *Map {
		m := flatMap([6]float64{-30, 0, 0, 30, top, 1}) // a wall spanning the whole arena at z=0..1 (top = its height)
		m.Spawns = map[string][]Spawn{TeamA: {{X: 0, Z: 10}}, TeamB: {{X: 0, Z: -10}}}
		return m
	}
	if p := buildNav(spec, wall(2.0)).Path(0, 10, 0, -10); len(p) != 0 {
		t.Fatalf("a 2 m wall across the arena must block the path, got %v", p)
	}
	// replace the middle of a 2 m wall by 0.2 m stairs up to 1.0 m and down again: a legal route (steps <= 0.45)
	m := wall(2.0)
	m.Boxes = [][6]float64{{-30, 0, 0, -3, 2, 1}, {3, 0, 0, 30, 2, 1}}
	for i := 0; i < 5; i++ { // up: 0.2 .. 1.0 over z 3..0.5
		m.Boxes = append(m.Boxes, [6]float64{-3, 0, 3 - 0.5*float64(i+1), 3, 0.2 * float64(i+1), 3 - 0.5*float64(i)})
	}
	nav := buildNav(spec, m)
	path := nav.Path(0, 10, 0, 2.2)
	if len(path) == 0 {
		t.Fatal("no path up a staircase of 0.2 m steps")
	}
	// a single 1.0 m step is not climbable
	m2 := flatMap([6]float64{-3, 0, 3, 3, 1.0, 5})
	m2.Spawns = map[string][]Spawn{TeamA: {{X: 0, Z: 10}}, TeamB: {{X: 0, Z: -10}}}
	n2 := buildNav(spec, m2)
	if n2.Walkable(0, 4) {
		t.Fatal("the top of a 1 m crate must not be a walkable cell (unreachable by steps)")
	}
}
