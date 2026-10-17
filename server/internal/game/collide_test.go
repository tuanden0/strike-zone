package game

import (
	"math"
	"testing"
)

func walk(t testing.TB, w *World, p *Player, f, s float64, ticks int) {
	t.Helper()
	for i := 0; i < ticks; i++ {
		step(t, w, p, Input{Weapon: -1, F: f, S: s})
	}
}

func TestPlayersCannotWalkThroughEachOther(t *testing.T) {
	w, a, b := duel(t) // a at z=12, b at z=2, same x, a faces -Z
	walk(t, w, a, 1, 0, 150)
	hw := w.Spec.Player.HalfWidth
	if gap := a.Kin.Z - b.Kin.Z; gap < 2*hw-1e-6 || gap > 2*hw+0.2 {
		t.Fatalf("a stopped %.3f m behind b, want a body width (%.2f): walked through or stopped early", gap, 2*hw)
	}
	if b.Kin.Z != 2 {
		t.Fatalf("the blocked walker pushed b: z=%v", b.Kin.Z)
	}
}

func TestPlayersSlideAlongEachOther(t *testing.T) {
	w, a, b := duel(t)
	walk(t, w, a, 1, 0, 150) // up against b
	z := a.Kin.Z
	walk(t, w, a, 1, 1, 3) // forward + strafe right: the sideways motion goes on, the forward motion is blocked
	if math.Abs(a.Kin.Z-z) > 1e-6 {
		t.Fatalf("a went through b while sliding: z %v -> %v", z, a.Kin.Z)
	}
	if a.Kin.X <= b.Kin.X+0.1 {
		t.Fatalf("a did not slide sideways around b: dx=%v", a.Kin.X-b.Kin.X)
	}
}

func TestDeadPlayersAreNotSolid(t *testing.T) {
	w, a, b := duel(t)
	b.Alive = false
	b.HP = 0
	b.RespawnAt = 1 << 30
	walk(t, w, a, 1, 0, 150)
	if a.Kin.Z > b.Kin.Z {
		t.Fatalf("a was stopped by a corpse: z=%v", a.Kin.Z)
	}
}

func TestOverlappingPlayersCanWalkApart(t *testing.T) {
	w, a, b := duel(t)
	b.Kin = Kin{X: a.Kin.X, Z: a.Kin.Z - 0.2, OnGround: true} // b spawned inside a
	walk(t, w, a, -1, 0, 30)                                  // a backs off (+Z)
	if a.Kin.Z < 12.3 {
		t.Fatalf("a is stuck inside b: z=%v", a.Kin.Z)
	}
	// and now they are solid again
	z := a.Kin.Z
	walk(t, w, a, 1, 0, 150)
	if gap := a.Kin.Z - b.Kin.Z; gap < 0.6-1e-6 {
		t.Fatalf("a walked through b after separating: gap %.3f (z was %v)", gap, z)
	}
}

func TestPlayerSolidsSkipsOverlappingOnes(t *testing.T) {
	spec, _ := mustLoad(t)
	k := Kin{X: 0, Z: 0, OnGround: true}
	got := PlayerSolids(spec, &k, []Kin{{X: 0.1, Z: 0.1, OnGround: true}, {X: 2, Z: 0, OnGround: true}, {X: 0, Y: 1.9, Z: 0}})
	if len(got) != 2 || math.Abs(got[0][0]-1.7) > 1e-9 {
		t.Fatalf("solids: %v (want the far player and the one above, not the overlapping one)", got)
	}
}

func TestBotsAreSolidToo(t *testing.T) {
	w, a, _ := duel(t)
	bot := add(t, w, 3, TeamB)
	bot.Kin = Kin{X: a.Kin.X, Z: 8, OnGround: true}
	bot.ProtectUntil = 0
	w.players[2].Alive = false // clear b out of the way
	walk(t, w, a, 1, 0, 100)
	if a.Kin.Z < 8.5 {
		t.Fatalf("a walked through the third player: z=%v", a.Kin.Z)
	}
}

func TestTouchingPlayersStayBlockedDespiteRoundingNoise(t *testing.T) {
	spec, _ := mustLoad(t)
	k := Kin{X: -9.4 + 1e-13, Z: 20, OnGround: true} // exactly one body width from a player at -10, plus float noise
	if got := PlayerSolids(spec, &k, []Kin{{X: -10, Z: 20, OnGround: true}}); len(got) != 1 {
		t.Fatalf("a player standing against another counts as overlapping: %v", got)
	}
	k.X = -9.4 - 1e-13
	if got := PlayerSolids(spec, &k, []Kin{{X: -10, Z: 20, OnGround: true}}); len(got) != 1 {
		t.Fatalf("noise on the other side too: %v", got)
	}
}

func TestMovementHotPathDoesNotAllocate(t *testing.T) {
	w, a, _ := duel(t)
	in := Input{F: 1, Weapon: -1}
	w.solidBoxes(a) // first call sizes the scratch buffer
	n := testing.AllocsPerRun(200, func() {
		a.Kin = Kin{X: 5, Z: 12, OnGround: true}
		w.apply(a, in)
	})
	if n > 3 { // a few closure escapes are tolerated; copying the whole map per input (hundreds of KB/s per player) is not
		t.Fatalf("apply allocates %v times per input", n)
	}
	t.Logf("allocs per input: %v", n)
}

func TestQueuedShotKeepsTheWeaponOfItsInput(t *testing.T) {
	w, a, b := duel(t)
	yaw, pitch := aim(w, a, b.Kin.X, b.Kin.Y+1.0, b.Kin.Z)
	// two inputs in one tick: the first fires the rifle, the second pulls out the knife
	for i, in := range []Input{{Weapon: -1, Fire: true, Yaw: yaw, Pitch: pitch}, {Weapon: knifeSlot, Yaw: yaw, Pitch: pitch}} {
		heavySeq[a.ID]++
		in.Seq = heavySeq[a.ID]
		if err := w.QueueInput(a.ID, in); err != nil {
			t.Fatalf("input %d: %v", i, err)
		}
	}
	w.Step()
	found := false
	for _, ev := range w.Events() {
		if ev.E == EvShot && ev.By == a.ID {
			found = true
			if ev.W != 0 {
				t.Fatalf("the shot was resolved as weapon %d, want the rifle (0) that fired it", ev.W)
			}
		}
	}
	if !found {
		t.Fatal("no shot event")
	}
}

func TestNoScoringAfterTheKillThatEndedTheMatch(t *testing.T) {
	w, a, b := duel(t)
	c := add(t, w, 3, TeamB)
	w.Cfg.ScoreLimit = 1
	w.kill(a, b, false, 0, a.ID)
	if w.State != StateEnded {
		t.Fatal("setup: the first kill should end the match")
	}
	w.kill(a, c, false, 0, a.ID) // same tick, later in the loop
	if w.Score[0] != 1 || a.Kills != 1 {
		t.Fatalf("a kill after the match ended was scored: score %v kills %d", w.Score, a.Kills)
	}
}

func TestGrenadeOfAThrowerWhoLeftStillSparesHisTeam(t *testing.T) {
	w, a, b := duel(t)
	mate := add(t, w, 3, TeamA)
	mate.Kin = Kin{X: b.Kin.X + 1, Z: b.Kin.Z, OnGround: true}
	mate.ProtectUntil = 0
	w.nextNade++
	w.grenades = append(w.grenades, &Grenade{ID: w.nextNade, G: 0, Owner: 99, Team: TeamA, Pos: [3]float64{b.Kin.X + 0.5, 1, b.Kin.Z}, Fuse: 1})
	_ = a
	w.Step()
	if mate.HP != w.Spec.Player.MaxHealth {
		t.Fatalf("the ex-teammate of a thrower who left was hurt: hp %d", mate.HP)
	}
	if b.HP == w.Spec.Player.MaxHealth {
		t.Fatal("the enemy standing next to the blast was not hurt")
	}
}
