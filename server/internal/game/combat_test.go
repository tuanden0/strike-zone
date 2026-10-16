package game

import (
	"math"
	"testing"
)

// combatWorld: spread disabled for deterministic aim; huge score limit unless set.
func combatWorld(t testing.TB) *World {
	t.Helper()
	spec, m := mustLoad(t)
	s2 := *spec
	s2.Weapons = append([]WeaponSpec(nil), spec.Weapons...)
	for i := range s2.Weapons {
		s2.Weapons[i].Spread, s2.Weapons[i].MoveSpread = 0, 0
	}
	return NewWorld(&s2, m, MatchConfig{TimeLimitSec: 600, ScoreLimit: 1000}, 7)
}

// duel places A at (0,0,10) and B at (0,0,0) facing each other on open floor (x=0 is clear of
// walls between z=10 and z=0? centre crates sit at |x|<=1.5 near z=6.5..8 so use x=5).
func duel(t testing.TB) (*World, *Player, *Player) {
	t.Helper()
	w := combatWorld(t)
	a := add(t, w, 1, TeamA)
	b := add(t, w, 2, TeamB)
	a.Kin = Kin{X: 5, Z: 12, OnGround: true}
	b.Kin = Kin{X: 5, Z: 2, OnGround: true}
	a.ProtectUntil, b.ProtectUntil = 0, 0
	return w, a, b
}

// aim returns yaw,pitch from shooter's eye to target point.
func aim(w *World, from *Player, tx, ty, tz float64) (yaw, pitch float64) {
	ex, ey, ez := from.Kin.X, from.Kin.Y+w.Spec.Player.EyeHeight, from.Kin.Z
	dx, dy, dz := tx-ex, ty-ey, tz-ez
	return math.Atan2(-dx, -dz), math.Atan2(dy, math.Hypot(dx, dz))
}

var seqs = map[int]uint32{}

func fireAt(t testing.TB, w *World, shooter *Player, tx, ty, tz float64, weapon int) {
	t.Helper()
	yaw, pitch := aim(w, shooter, tx, ty, tz)
	seqs[shooter.ID]++
	if err := w.QueueInput(shooter.ID, Input{Seq: seqs[shooter.ID] + 1000*uint32(w.Tick+1), Yaw: yaw, Pitch: pitch, Fire: true, Weapon: weapon}); err != nil {
		t.Fatal(err)
	}
	w.Step()
}

func eventsOf(w *World, kind string) []Event {
	var out []Event
	for _, e := range w.Events() {
		if e.E == kind {
			out = append(out, e)
		}
	}
	return out
}

func TestRifleBodyShotDamage(t *testing.T) {
	w, a, b := duel(t)
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1) // torso
	if b.HP != 70 {
		t.Fatalf("body shot should deal 30, hp=%d", b.HP)
	}
	hits := eventsOf(w, EvHit)
	if len(hits) != 1 || hits[0].Head || hits[0].Dmg != 30 || hits[0].By != 1 || hits[0].V != 2 {
		t.Fatalf("hit event: %+v", hits)
	}
	if sh := eventsOf(w, EvShot); len(sh) != 1 || sh[0].Hit != HitBody {
		t.Fatalf("shot event: %+v", sh)
	}
	if a.Mag[0] != 29 {
		t.Fatalf("ammo not consumed: %d", a.Mag[0])
	}
}

func TestHeadshotIsFourTimes(t *testing.T) {
	w, a, b := duel(t)
	fireAt(t, w, a, b.Kin.X, 1.62, b.Kin.Z, -1) // head centre
	hits := eventsOf(w, EvHit)
	if len(hits) != 1 || !hits[0].Head || hits[0].Dmg != 120 {
		t.Fatalf("headshot event: %+v", hits)
	}
	if b.Alive || b.HP != 0 {
		t.Fatalf("rifle headshot must kill: hp=%d alive=%v", b.HP, b.Alive)
	}
	kills := eventsOf(w, EvKill)
	if len(kills) != 1 || !kills[0].Head || kills[0].By != 1 || kills[0].V != 2 {
		t.Fatalf("kill event: %+v", kills)
	}
	if sh := eventsOf(w, EvShot); sh[0].Hit != HitHead {
		t.Fatalf("shot hit kind %q", sh[0].Hit)
	}
}

func TestHitboxBoundaryHeadVsBody(t *testing.T) {
	// y just below the head box bottom (1.45) is body; just above is head.
	for _, c := range []struct {
		y    float64
		head bool
	}{{1.40, false}, {1.50, true}, {1.78, true}, {0.1, false}} {
		w, a, b := duel(t)
		fireAt(t, w, a, b.Kin.X, c.y, b.Kin.Z, -1)
		hits := eventsOf(w, EvHit)
		if len(hits) != 1 || hits[0].Head != c.head {
			t.Fatalf("y=%v want head=%v got %+v", c.y, c.head, hits)
		}
	}
}

func TestMissAndWallBlocking(t *testing.T) {
	w, a, b := duel(t)
	fireAt(t, w, a, b.Kin.X+2, 1.0, b.Kin.Z, -1) // aim 2m to the side
	if b.HP != 100 || len(eventsOf(w, EvHit)) != 0 {
		t.Fatal("shot at empty space hurt someone")
	}
	// Put B behind the left-lane divider wall (x=-8, z in [4,14]); A shoots through it.
	w, a, b = duel(t)
	a.Kin = Kin{X: -3, Z: 8, OnGround: true}
	b.Kin = Kin{X: -13, Z: 8, OnGround: true}
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1)
	if b.HP != 100 {
		t.Fatalf("bullet passed through a wall, hp=%d", b.HP)
	}
	if sh := eventsOf(w, EvShot); sh[0].Hit != HitWall || sh[0].To[0] < -8.6 {
		t.Fatalf("shot should end at the wall: %+v", sh[0])
	}
	// Shooting into the floor ends at the floor.
	w, a, _ = duel(t)
	fireAt(t, w, a, a.Kin.X, 0, a.Kin.Z-3, -1)
	if sh := eventsOf(w, EvShot); sh[0].Hit != HitWall || math.Abs(sh[0].To[1]) > 1e-6 {
		t.Fatalf("floor hit: %+v", sh[0])
	}
}

func TestNoFriendlyFire(t *testing.T) {
	w := combatWorld(t)
	a := add(t, w, 1, TeamA)
	c := add(t, w, 3, TeamA)
	a.Kin, c.Kin = Kin{X: 5, Z: 12, OnGround: true}, Kin{X: 5, Z: 2, OnGround: true}
	a.ProtectUntil, c.ProtectUntil = 0, 0
	fireAt(t, w, a, 5, 1.0, 2, -1)
	if c.HP != 100 || len(eventsOf(w, EvHit)) != 0 {
		t.Fatal("teammate was damaged")
	}
}

func TestDeadPlayersAreNotTargets(t *testing.T) {
	w, a, b := duel(t)
	b.Alive = false
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1)
	if len(eventsOf(w, EvHit)) != 0 {
		t.Fatal("hit a dead player")
	}
}

func TestSpawnProtection(t *testing.T) {
	w, a, b := duel(t)
	b.ProtectUntil = w.Tick + 100
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1)
	if b.HP != 100 {
		t.Fatal("protected player took damage")
	}
	// firing ends the shooter's own protection
	a.ProtectUntil = w.Tick + 100
	b.ProtectUntil = 0
	w.Tick += 10 // let rifle cooldown expire
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1)
	if a.ProtectUntil != 0 {
		t.Fatal("protection should end when firing")
	}
}

func TestKillScoreDeathAndRespawn(t *testing.T) {
	w, a, b := duel(t)
	fireAt(t, w, a, b.Kin.X, 1.62, b.Kin.Z, -1)
	if b.Alive || b.Deaths != 1 || a.Kills != 1 || w.Score != [2]int{1, 0} || !w.Dirty {
		t.Fatalf("after kill: alive=%v deaths=%d kills=%d score=%v", b.Alive, b.Deaths, a.Kills, w.Score)
	}
	if got := w.SelfFor(2); got.A || got.Resp != 3*w.Spec.TickRate {
		t.Fatalf("self after death: %+v", got)
	}
	// dead player's input is ignored and acked
	z := b.Kin.Z
	w.QueueInput(2, Input{Seq: 99999, F: 1, Weapon: -1})
	for i := 0; i < w.Spec.TickRate*3-1; i++ {
		w.Step()
	}
	if b.Alive || b.Kin.Z != z {
		t.Fatalf("respawned too early or moved while dead (alive=%v)", b.Alive)
	}
	w.Step()
	if !b.Alive || b.HP != 100 || b.Mag[0] != 30 || b.Cur != 0 {
		t.Fatalf("respawn state: alive=%v hp=%d mag=%d", b.Alive, b.HP, b.Mag[0])
	}
	if b.Kin.Z >= 0 {
		t.Fatalf("B should respawn at its own end (z<0), z=%v", b.Kin.Z)
	}
	if w.Tick < b.ProtectUntil == false {
		t.Fatal("respawned player should be protected")
	}
}

func TestDeadCannotTeamSwitchToInstantRespawn(t *testing.T) {
	w, a, b := duel(t)
	fireAt(t, w, a, b.Kin.X, 1.62, b.Kin.Z, -1)
	if err := w.SetTeam(2, TeamA); err != nil {
		t.Fatal(err)
	}
	if b.Alive {
		t.Fatal("team switch must not revive a dead player")
	}
}

func TestMutualKillSameTick(t *testing.T) {
	w, a, b := duel(t)
	ya, pa := aim(w, a, b.Kin.X, 1.62, b.Kin.Z)
	yb, pb := aim(w, b, a.Kin.X, 1.62, a.Kin.Z)
	w.QueueInput(1, Input{Seq: 1, Yaw: ya, Pitch: pa, Fire: true, Weapon: -1})
	w.QueueInput(2, Input{Seq: 1, Yaw: yb, Pitch: pb, Fire: true, Weapon: -1})
	w.Step()
	if a.Alive || b.Alive || a.Kills != 1 || b.Kills != 1 {
		t.Fatalf("both fired the same tick; both must die (id order must not decide): a=%v b=%v", a.Alive, b.Alive)
	}
}

func TestFireRateAndAutoVsSemi(t *testing.T) {
	w, a, b := duel(t)
	b.Kin.X = 40 // out of the way; just count shots
	for i := 0; i < 30; i++ {
		w.QueueInput(1, Input{Seq: uint32(i + 1), Yaw: 0, Fire: true, Weapon: -1})
		w.Step()
	}
	// rifle: interval 3 ticks => 10 shots in 30 ticks, ammo 30 -> 20
	if a.Mag[0] != 20 {
		t.Fatalf("rifle rate: mag=%d (want 20)", a.Mag[0])
	}
	// pistol is semi-auto: holding fire gives exactly one shot
	w2, a2, _ := duel(t)
	w2.QueueInput(1, Input{Seq: 1, Weapon: 1})
	w2.Step()
	w2.Tick += w2.Spec.SwitchTicks
	for i := 0; i < 20; i++ {
		w2.QueueInput(1, Input{Seq: uint32(i + 2), Fire: true, Weapon: -1})
		w2.Step()
	}
	if a2.Mag[1] != 11 {
		t.Fatalf("semi-auto fired %d shots while holding", 12-a2.Mag[1])
	}
	// release then press again => second shot
	w2.QueueInput(1, Input{Seq: 100, Fire: false, Weapon: -1})
	w2.Step()
	w2.QueueInput(1, Input{Seq: 101, Fire: true, Weapon: -1})
	w2.Step()
	if a2.Mag[1] != 10 {
		t.Fatalf("second click should fire: mag=%d", a2.Mag[1])
	}
}

func TestReloadFlow(t *testing.T) {
	w, a, _ := duel(t)
	a.Mag[0] = 10
	seq := uint32(0)
	in := func(i Input) { seq++; i.Seq = seq; i.Weapon = -1; w.QueueInput(1, i); w.Step() }
	in(Input{Reload: true})
	if a.ReloadDone == 0 {
		t.Fatal("reload did not start")
	}
	for i := 0; i < w.Spec.Weapons[0].ReloadTicks-1; i++ {
		in(Input{})
	}
	if a.Mag[0] != 10 {
		t.Fatal("reload finished early")
	}
	in(Input{})
	if a.Mag[0] != 30 || a.Res[0] != 70 || a.ReloadDone != 0 {
		t.Fatalf("after reload mag=%d res=%d", a.Mag[0], a.Res[0])
	}
	// cannot fire while reloading
	in(Input{Reload: true})
	in(Input{Reload: true, Fire: true}) // mag is full: reload ignored, fires
	if a.Mag[0] != 29 {
		t.Fatalf("full mag: reload should be ignored, fire allowed (mag=%d)", a.Mag[0])
	}
}

func TestReloadCancelledBySwitchAndBlocksFire(t *testing.T) {
	w, a, b := duel(t)
	a.Mag[0] = 5
	w.QueueInput(1, Input{Seq: 1, Reload: true, Weapon: -1})
	w.Step()
	w.QueueInput(1, Input{Seq: 2, Fire: true, Yaw: 0, Weapon: -1})
	w.Step()
	if a.Mag[0] != 5 || len(eventsOf(w, EvShot)) != 0 {
		t.Fatal("fired while reloading")
	}
	w.QueueInput(1, Input{Seq: 3, Weapon: 1})
	w.Step()
	if a.ReloadDone != 0 || a.Cur != 1 {
		t.Fatal("switch must cancel reload")
	}
	_ = b
}

func TestEmptyMagAutoReloadAndNoAmmo(t *testing.T) {
	w, a, _ := duel(t)
	a.Mag[0] = 0
	w.QueueInput(1, Input{Seq: 1, Fire: true, Weapon: -1})
	w.Step()
	if a.ReloadDone == 0 || len(eventsOf(w, EvShot)) != 0 {
		t.Fatal("empty mag + fire should start reload, not shoot")
	}
	// no reserve: nothing happens
	w2, a2, _ := duel(t)
	a2.Mag[0], a2.Res[0] = 0, 0
	w2.QueueInput(1, Input{Seq: 1, Fire: true, Weapon: -1})
	w2.Step()
	if a2.ReloadDone != 0 || len(eventsOf(w2, EvShot)) != 0 {
		t.Fatal("no ammo at all: must stay idle")
	}
}

func TestKnifeRangeAndDamage(t *testing.T) {
	w, a, b := duel(t)
	a.Kin = Kin{X: 5, Z: 4.0, OnGround: true}
	b.Kin = Kin{X: 5, Z: 2.5, OnGround: true} // 1.5 m: in range
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, 2)
	// weapon switch delay blocks the first swing; wait it out then swing
	for i := 0; i < w.Spec.SwitchTicks; i++ {
		w.Step()
	}
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1)
	if b.HP != 60 {
		t.Fatalf("knife should deal 40: hp=%d", b.HP)
	}
	// out of range (3 m) does nothing
	w, a, b = duel(t)
	a.Kin = Kin{X: 5, Z: 5.5, OnGround: true}
	b.Kin = Kin{X: 5, Z: 2.5, OnGround: true}
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, 2)
	for i := 0; i < w.Spec.SwitchTicks; i++ {
		w.Step()
	}
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1)
	if b.HP != 100 {
		t.Fatalf("knife hit from 3m: hp=%d", b.HP)
	}
	if a.Mag[2] != 0 {
		t.Fatal("knife has no ammo")
	}
}

func TestScoreLimitEndsMatch(t *testing.T) {
	w, a, b := duel(t)
	w.Cfg.ScoreLimit = 2
	for i := 0; i < 2; i++ {
		b.Alive, b.HP = true, 100
		b.Kin = Kin{X: 5, Z: 2, OnGround: true}
		b.ProtectUntil = 0
		w.Tick += 5
		fireAt(t, w, a, b.Kin.X, 1.62, b.Kin.Z, -1)
	}
	if w.State != StateEnded || w.Winner != TeamA || w.Score[0] != 2 {
		t.Fatalf("state=%s winner=%q score=%v", w.State, w.Winner, w.Score)
	}
	// no more damage once ended
	b.Alive, b.HP = true, 100
	w.QueueInput(1, Input{Seq: 5000, Fire: true, Weapon: -1})
	w.Step()
	if b.HP != 100 {
		t.Fatal("shots land after match end")
	}
}

func TestSpreadIsBoundedAndDeterministic(t *testing.T) {
	spec, m := mustLoad(t)
	run := func(seed uint64) [3]float64 {
		w := NewWorld(spec, m, MatchConfig{TimeLimitSec: 600, ScoreLimit: 100}, seed)
		a := add(t, w, 1, TeamA)
		a.Kin = Kin{X: 5, Z: 12, OnGround: true}
		w.QueueInput(1, Input{Seq: 1, Yaw: 0, Pitch: 0, Fire: true, Weapon: -1})
		w.Step()
		sh := eventsOf(w, EvShot)
		return *sh[0].To
	}
	if run(5) != run(5) {
		t.Fatal("same seed must give same spread")
	}
	// standing rifle spread 0.006 rad: at 100 m lateral error <= 0.6 m
	to := run(9)
	if math.Abs(to[0]-5) > 0.006*100*1.01 {
		t.Fatalf("spread too large: %v", to)
	}
}
