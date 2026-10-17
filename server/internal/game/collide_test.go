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
