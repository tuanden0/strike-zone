package game

import (
	"math"
	"testing"
)

const (
	gFrag  = 0
	gSmoke = 1
	gFlash = 2
)

// boomAt places a grenade of type g that explodes on the next Step.
func boomAt(w *World, g, owner int, x, y, z float64) {
	w.nextNade++
	w.grenades = append(w.grenades, &Grenade{ID: w.nextNade, G: g, Owner: owner, Pos: [3]float64{x, y, z}, Fuse: 1})
}

func TestThrowConsumesInventoryAndHonoursCooldown(t *testing.T) {
	w, p := pkWorld(t)
	if p.Nades[gFrag] != 1 || p.Nades[gSmoke] != 1 || p.Nades[gFlash] != 1 {
		t.Fatalf("spawn inventory %v", p.Nades)
	}
	send(t, w, Input{Weapon: -1, Nade: gFrag + 1})
	if p.Nades[gFrag] != 0 || len(w.grenades) != 1 {
		t.Fatalf("after throw: nades=%v in flight=%d", p.Nades, len(w.grenades))
	}
	send(t, w, Input{Weapon: -1, Nade: gSmoke + 1}) // inside the cooldown
	if p.Nades[gSmoke] != 1 {
		t.Fatal("threw again during the cooldown")
	}
	for i := 0; i < w.Spec.Nades.CooldownTicks; i++ {
		send(t, w, idle())
	}
	send(t, w, Input{Weapon: -1, Nade: gFrag + 1}) // none left
	if len(w.grenades) > 1 {
		t.Fatal("threw a grenade that was not in the inventory")
	}
	send(t, w, Input{Weapon: -1, Nade: gSmoke + 1})
	if p.Nades[gSmoke] != 0 {
		t.Fatal("second type should throw once the cooldown passed")
	}
}

func TestNadeInputIsValidated(t *testing.T) {
	w, _ := pkWorld(t)
	if err := w.QueueInput(1, Input{Seq: 9999, Weapon: -1, Nade: 99}); err == nil {
		t.Fatal("out-of-range grenade index accepted")
	}
	if err := w.QueueInput(1, Input{Seq: 10000, Weapon: -1, Nade: -1}); err == nil {
		t.Fatal("negative grenade index accepted")
	}
}

func TestFragDamageFallsOffWithDistanceAndIgnoresTeammates(t *testing.T) {
	w, a, b := duel(t) // a (team A) at z=12, b (team B) at z=2, x=5
	mate := add(t, w, 3, TeamA)
	mate.Kin = Kin{X: 5.5, Z: 12, OnGround: true}
	mate.ProtectUntil = 0
	gs := w.Spec.Grenades[gFrag]
	// 2 m from b: damage = Damage * (1 - d/R) at the body centre (0.725 m up)
	boomAt(w, gFrag, a.ID, 5, 0.725, 4)
	w.Step()
	want := int(math.Round(gs.Damage * (1 - 2/gs.Radius)))
	if got := 100 - b.HP; got != want && b.Alive {
		t.Fatalf("2 m frag: damage %d want %d", got, want)
	}
	if mate.HP != 100 {
		t.Fatalf("teammate took %d from a friendly grenade", 100-mate.HP)
	}
	// farther away hurts less
	b.HP, b.Alive = 100, true
	boomAt(w, gFrag, a.ID, 5, 0.725, -2.5) // 4.5 m behind b
	w.Step()
	far := 100 - b.HP
	if far <= 0 || far >= want {
		t.Fatalf("4.5 m frag damage %d should be 0 < d < %d", far, want)
	}
	// beyond the radius: nothing
	b.HP = 100
	boomAt(w, gFrag, a.ID, 5, 0.725, 2+gs.Radius+1)
	w.Step()
	if b.HP != 100 {
		t.Fatal("damage outside the radius")
	}
}

func TestFragIsBlockedByWallsAndHalvedOnTheThrower(t *testing.T) {
	w, a, b := duel(t)
	var wall *[6]float64
	for i := range w.Map.Boxes {
		bx := &w.Map.Boxes[i]
		if bx[4]-bx[1] >= 3 && bx[3]-bx[0] <= 1.5 && bx[5]-bx[2] >= 4 && bx[2] > -20 && bx[5] < 20 { // a tall thin divider
			wall = bx
			break
		}
	}
	if wall == nil {
		t.Skip("no divider wall on this map")
	}
	zc := (wall[2] + wall[5]) / 2
	b.Kin = Kin{X: wall[3] + 1, Z: zc, OnGround: true}
	boomAt(w, gFrag, a.ID, wall[0]-1, 0.725, zc)
	w.Step()
	if b.HP != 100 {
		t.Fatalf("grenade hurt through a wall (%d)", 100-b.HP)
	}
	// thrower: half damage
	a.Kin = Kin{X: 5, Z: 12, OnGround: true}
	a.HP = 100
	boomAt(w, gFrag, a.ID, 5, 0.725, 11)
	w.Step()
	full := w.Spec.Grenades[gFrag].Damage * (1 - math.Hypot(0, 1)/w.Spec.Grenades[gFrag].Radius)
	if got := float64(100 - a.HP); math.Abs(got-full/2) > 1.5 {
		t.Fatalf("self damage %v want ~%v", got, full/2)
	}
}

func TestGrenadeKillScoresForTheThrowerButSelfKillDoesNot(t *testing.T) {
	w, a, b := duel(t)
	b.HP = 20
	boomAt(w, gFrag, a.ID, 5, 0.725, 2.5)
	w.Step()
	if b.Alive || a.Kills != 1 || w.Score[0] != 1 {
		t.Fatalf("grenade kill: alive=%v kills=%d score=%v", b.Alive, a.Kills, w.Score)
	}
	ks := eventsOf(w, EvKill)
	if len(ks) != 1 || ks[0].By != a.ID || ks[0].W != len(w.Spec.Weapons)+gFrag {
		t.Fatalf("kill event %+v", ks)
	}
	// suicide
	b2 := add(t, w, 4, TeamB)
	b2.Kin = Kin{X: -5, Z: -10, OnGround: true}
	b2.ProtectUntil, b2.HP = 0, 10
	boomAt(w, gFrag, b2.ID, -5, 0.725, -10)
	w.Step()
	if b2.Alive || b2.Kills != 0 || w.Score[1] != 0 || b2.Deaths != 1 {
		t.Fatalf("self-kill must not score: kills=%d score=%v deaths=%d", b2.Kills, w.Score, b2.Deaths)
	}
}

func TestGrenadeFliesBouncesAndStaysInTheArena(t *testing.T) {
	w, p := pkWorld(t)
	p.Yaw, p.Pitch = 0.4, 0.2
	send(t, w, Input{Weapon: -1, Yaw: 0.4, Pitch: 0.2, Nade: gFrag + 1})
	if len(w.grenades) != 1 {
		t.Fatal("not thrown")
	}
	g := w.grenades[0]
	r := w.Spec.Nades.Radius
	booms := 0
	for i := 0; i < 200; i++ {
		send(t, w, Input{Weapon: -1, Yaw: 0.4, Pitch: 0.2})
		booms += len(eventsOf(w, EvBoom))
		if len(w.grenades) == 0 {
			break
		}
		bd := w.Map.Bounds
		if g.Pos[1] < r-1e-9 || g.Pos[0] < bd.MinX || g.Pos[0] > bd.MaxX || g.Pos[2] < bd.MinZ || g.Pos[2] > bd.MaxZ || w.nadeHits(g.Pos) {
			t.Fatalf("grenade left the arena or sank into geometry at tick %d: %v", i, g.Pos)
		}
	}
	if booms != 1 || len(w.grenades) != 0 {
		t.Fatalf("booms=%d in flight=%d", booms, len(w.grenades))
	}
}

func TestSmokeBlocksTheLineOfSightThenFades(t *testing.T) {
	w, a, b := duel(t)
	ea := [3]float64{a.Kin.X, 1.62, a.Kin.Z}
	eb := [3]float64{b.Kin.X, 1.62, b.Kin.Z}
	if w.smokeBlocks(ea, eb) {
		t.Fatal("no smoke yet")
	}
	boomAt(w, gSmoke, a.ID, 5, 1, 7) // between them
	w.Step()
	if len(w.smokes) != 1 || !w.smokeBlocks(ea, eb) {
		t.Fatalf("smoke cloud missing: %d", len(w.smokes))
	}
	if w.smokeBlocks([3]float64{-20, 1.6, 0}, [3]float64{-20, 1.6, 5}) {
		t.Fatal("smoke blocks lines far away from it")
	}
	if len(w.Snapshot().Smokes) != 1 {
		t.Fatal("smoke not in the snapshot")
	}
	for i := 0; i <= w.ticks(w.Spec.Grenades[gSmoke].Duration); i++ {
		w.Step()
	}
	if len(w.smokes) != 0 {
		t.Fatal("smoke never fades")
	}
}

func TestFlashBlindsMoreWhenLookingAtItAndNotThroughWalls(t *testing.T) {
	w, a, b := duel(t)
	// the flash goes off at z=7: b (z=2) looks toward +z (yaw pi) so it faces it; a (z=12) also looks +z, i.e. away from it
	b.Yaw, a.Yaw = math.Pi, math.Pi
	w.QueueInput(1, Input{Seq: 777, Weapon: -1, Yaw: math.Pi})
	w.QueueInput(2, Input{Seq: 777, Weapon: -1, Yaw: math.Pi})
	w.Step()
	boomAt(w, gFlash, a.ID, 5, 1.6, 7)
	w.Step()
	ta, tb := a.FlashUntil-w.Tick, b.FlashUntil-w.Tick
	if tb <= ta || tb < 10 {
		t.Fatalf("facing victim blind %d ticks should exceed the one looking away %d", tb, ta)
	}
	if y := w.SelfFor(2); y.FL <= 0 || y.FL != b.FlashUntil-w.Tick {
		t.Fatalf("self.fl = %d", y.FL)
	}
	// walls stop it
	a.FlashUntil, b.FlashUntil = 0, 0
	var wall *[6]float64
	for i := range w.Map.Boxes {
		bx := &w.Map.Boxes[i]
		if bx[4]-bx[1] >= 3 && bx[3]-bx[0] <= 1.5 && bx[5]-bx[2] >= 4 && bx[2] > -20 && bx[5] < 20 {
			wall = bx
			break
		}
	}
	if wall != nil {
		zc := (wall[2] + wall[5]) / 2
		b.Kin = Kin{X: wall[3] + 1, Z: zc, OnGround: true}
		boomAt(w, gFlash, a.ID, wall[0]-1, 1.6, zc)
		w.Step()
		if b.FlashUntil > w.Tick {
			t.Fatal("flash went through a wall")
		}
	}
}

func TestRestartClearsGrenadesAndRefillsInventory(t *testing.T) {
	w, a, _ := duel(t)
	send(t, w, Input{Weapon: -1, Nade: gSmoke + 1})
	boomAt(w, gSmoke, a.ID, 0, 1, 0)
	w.Step()
	w.endMatch()
	for w.State == StateEnded {
		w.Step()
	}
	if len(w.grenades) != 0 || len(w.smokes) != 0 || a.Nades[gSmoke] != 1 {
		t.Fatalf("after restart: grenades=%d smokes=%d inv=%v", len(w.grenades), len(w.smokes), a.Nades)
	}
}

func TestSpecRejectsBadGrenades(t *testing.T) {
	spec, _ := mustLoad(t)
	for name, mut := range map[string]func(*Spec){
		"unknown kind": func(s *Spec) { s.Grenades[0].Kind = "nuke" },
		"zero fuse":    func(s *Spec) { s.Grenades[0].FuseTicks = 0 },
		"frag no dmg":  func(s *Spec) { s.Grenades[0].Damage = 0 },
		"smoke no dur": func(s *Spec) { s.Grenades[1].Duration = 0 },
		"bad cooldown": func(s *Spec) { s.Nades.CooldownTicks = 0 },
		"huge speed":   func(s *Spec) { s.Grenades[0].Speed = 400 },
	} {
		s2 := *spec
		s2.Grenades = append([]GrenadeSpec(nil), spec.Grenades...)
		mut(&s2)
		if validateSpec(&s2) == nil {
			t.Errorf("%s accepted", name)
		}
	}
}
