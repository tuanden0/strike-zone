package game

import (
	"errors"
	"math"
	"testing"
)

func newWorld(t testing.TB) *World {
	t.Helper()
	spec, m := mustLoad(t)
	return NewWorld(spec, m, MatchConfig{TimeLimitSec: 60, ScoreLimit: 10}, 42)
}

func add(t testing.TB, w *World, id int, team string) *Player {
	t.Helper()
	p, err := w.AddPlayer(id, "p", team)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func mv(seq uint32) Input { return Input{Seq: seq, F: 1, Weapon: -1} }

func TestInputValidate(t *testing.T) {
	ok := Input{Seq: 1, F: 1, S: -1, Yaw: 3, Pitch: 1.5, Weapon: 2}
	if err := ok.Validate(3); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	bad := map[string]Input{
		"nan f":       {F: math.NaN(), Weapon: -1},
		"inf yaw":     {Yaw: math.Inf(1), Weapon: -1},
		"-inf pitch":  {Pitch: math.Inf(-1), Weapon: -1},
		"f > 1":       {F: 1.01, Weapon: -1},
		"s < -1":      {S: -2, Weapon: -1},
		"huge yaw":    {Yaw: 1e6, Weapon: -1},
		"pitch high":  {Pitch: 1.7, Weapon: -1},
		"pitch low":   {Pitch: -1.7, Weapon: -1},
		"weapon high": {Weapon: 3},
		"weapon < -1": {Weapon: -2},
	}
	for name, in := range bad {
		if err := in.Validate(3); !errors.Is(err, ErrBadInput) {
			t.Errorf("%s: want ErrBadInput, got %v", name, err)
		}
	}
}

func TestQueueInputRules(t *testing.T) {
	w := newWorld(t)
	add(t, w, 1, TeamA)
	if err := w.QueueInput(9, mv(1)); !errors.Is(err, ErrNoPlayer) {
		t.Fatalf("unknown player: %v", err)
	}
	if err := w.QueueInput(1, mv(5)); err != nil {
		t.Fatal(err)
	}
	for _, seq := range []uint32{5, 4, 1} {
		if err := w.QueueInput(1, mv(seq)); !errors.Is(err, ErrStaleInput) {
			t.Fatalf("seq %d should be stale: %v", seq, err)
		}
	}
	bad := mv(6)
	bad.F = 7
	if err := w.QueueInput(1, bad); !errors.Is(err, ErrBadInput) {
		t.Fatalf("bad axis accepted: %v", err)
	}
	// a rejected input must not advance the sequence
	if err := w.QueueInput(1, mv(6)); err != nil {
		t.Fatalf("seq 6 should still be fine: %v", err)
	}
}

func TestStepAppliesOneInputPerTickAndAcks(t *testing.T) {
	w := newWorld(t)
	p := add(t, w, 1, TeamA)
	z0 := p.Kin.Z
	w.QueueInput(1, mv(1))
	w.Step()
	dz := z0 - p.Kin.Z
	want := w.Spec.Player.RunSpeed / float64(w.Spec.TickRate)
	if math.Abs(dz-want) > 1e-9 || p.LastSeq != 1 {
		t.Fatalf("dz=%v want %v ack=%d", dz, want, p.LastSeq)
	}
	// no input => no movement (server never extrapolates from stale input)
	z1 := p.Kin.Z
	w.Step()
	if p.Kin.Z != z1 {
		t.Fatal("moved without input")
	}
}

func TestSpeedCannotExceedRunSpeed(t *testing.T) {
	// A client flooding inputs cannot outrun the server tick: at most maxInputsPerTick per tick.
	w := newWorld(t)
	p := add(t, w, 1, TeamA)
	z0 := p.Kin.Z
	seq := uint32(0)
	for tick := 0; tick < 30; tick++ {
		for i := 0; i < 50; i++ { // 50 inputs per tick offered
			seq++
			w.QueueInput(1, mv(seq))
		}
		w.Step()
	}
	// 30 ticks => 30 refills + the initial allowance; never 2x speed.
	max := float64(30+maxBudget) * w.Spec.Player.RunSpeed / float64(w.Spec.TickRate)
	if d := z0 - p.Kin.Z; d > max+1e-9 {
		t.Fatalf("moved %v m in 1s, cap %v", d, max)
	}
	if len(p.queue) > maxQueue {
		t.Fatalf("queue grew to %d", len(p.queue))
	}
}

func TestCatchUpAfterJitter(t *testing.T) {
	// Two ticks without input, then three queued inputs: the backlog is worked off 2 per tick.
	w := newWorld(t)
	p := add(t, w, 1, TeamA)
	w.Step()
	w.Step()
	for i := uint32(1); i <= 3; i++ {
		w.QueueInput(1, mv(i))
	}
	w.Step()
	if p.LastSeq != 2 {
		t.Fatalf("expected 2 inputs processed, ack=%d", p.LastSeq)
	}
	w.Step()
	if p.LastSeq != 3 {
		t.Fatalf("backlog not cleared, ack=%d", p.LastSeq)
	}
}

func TestQueueDropsOldestWhenFull(t *testing.T) {
	w := newWorld(t)
	p := add(t, w, 1, TeamA)
	for i := uint32(1); i <= maxQueue+3; i++ {
		w.QueueInput(1, mv(i))
	}
	if len(p.queue) != maxQueue || p.queue[0].Seq != 4 {
		t.Fatalf("queue len=%d first=%d", len(p.queue), p.queue[0].Seq)
	}
}

func TestSpawnsFarFromEnemies(t *testing.T) {
	w := newWorld(t)
	a := add(t, w, 1, TeamA)
	b := add(t, w, 2, TeamB)
	if a.Kin.Z <= 0 || b.Kin.Z >= 0 {
		t.Fatalf("teams spawn on opposite ends: a.z=%v b.z=%v", a.Kin.Z, b.Kin.Z)
	}
	if a.Yaw != 0 || math.Abs(b.Yaw-math.Pi) > 1e-9 {
		t.Fatalf("spawn yaw: %v %v", a.Yaw, b.Yaw)
	}
	// Put an enemy right on top of one of A's spawn points: A must pick a different one.
	b.Kin.X, b.Kin.Z = w.Map.Spawns[TeamA][0].X, w.Map.Spawns[TeamA][0].Z
	c := add(t, w, 3, TeamA)
	if c.Kin.X == b.Kin.X && c.Kin.Z == b.Kin.Z {
		t.Fatal("spawned on top of an enemy")
	}
}

func TestAddRemoveAndTeams(t *testing.T) {
	w := newWorld(t)
	if _, err := w.AddPlayer(1, "x", "Z"); !errors.Is(err, ErrBadTeam) {
		t.Fatalf("bad team: %v", err)
	}
	add(t, w, 2, TeamA)
	add(t, w, 1, TeamB)
	if _, err := w.AddPlayer(1, "dup", TeamA); err == nil {
		t.Fatal("duplicate id accepted")
	}
	if ps := w.Players(); len(ps) != 2 || ps[0].ID != 1 || ps[1].ID != 2 {
		t.Fatal("players must be ordered by id")
	}
	if w.TeamCount(TeamA) != 1 || w.TeamCount(TeamB) != 1 {
		t.Fatal("team counts")
	}
	if err := w.SetTeam(1, TeamA); err != nil || w.TeamCount(TeamA) != 2 {
		t.Fatalf("SetTeam: %v", err)
	}
	if err := w.SetTeam(1, "Q"); !errors.Is(err, ErrBadTeam) {
		t.Fatal("bad team accepted")
	}
	if err := w.SetTeam(77, TeamA); !errors.Is(err, ErrNoPlayer) {
		t.Fatal("unknown player")
	}
	w.RemovePlayer(2)
	w.RemovePlayer(2) // idempotent
	if w.Len() != 1 || w.Player(2) != nil {
		t.Fatal("remove failed")
	}
}

func TestMatchTimeLimitEndsAndRestarts(t *testing.T) {
	w := newWorld(t)
	p := add(t, w, 1, TeamA)
	p.Kills = 3
	w.Score = [2]int{3, 1}
	rate := w.Spec.TickRate
	for i := 0; i < 60*rate-1; i++ {
		w.Step()
	}
	if w.State != StatePlaying || w.SecondsLeft() != 1 {
		t.Fatalf("state %s left %d", w.State, w.SecondsLeft())
	}
	w.Step()
	if w.State != StateEnded || w.Winner != TeamA {
		t.Fatalf("not ended: %s winner %q", w.State, w.Winner)
	}
	// inputs are ignored during intermission
	z := p.Kin.Z
	w.QueueInput(1, mv(1))
	w.Step()
	if p.Kin.Z != z {
		t.Fatal("moved during intermission")
	}
	inter := int(w.Spec.Match.IntermissionSeconds) * rate
	for i := 0; i < inter+1 && w.State == StateEnded; i++ {
		w.Step()
	}
	if w.State != StatePlaying || w.Score != [2]int{} || p.Kills != 0 || w.Winner != "" {
		t.Fatalf("restart failed: state=%s score=%v kills=%d", w.State, w.Score, p.Kills)
	}
	if w.SecondsLeft() != 60 {
		t.Fatalf("fresh match clock: %d", w.SecondsLeft())
	}
}

func TestDrawWhenTied(t *testing.T) {
	w := newWorld(t)
	add(t, w, 1, TeamA)
	for i := 0; i < 60*w.Spec.TickRate; i++ {
		w.Step()
	}
	if w.State != StateEnded || w.Winner != "draw" {
		t.Fatalf("state %s winner %q", w.State, w.Winner)
	}
}

func TestSnapshotContents(t *testing.T) {
	w := newWorld(t)
	add(t, w, 1, TeamA)
	add(t, w, 2, TeamB)
	w.QueueInput(1, mv(1))
	w.Step()
	s := w.Snapshot()
	if s.T != "snap" || len(s.Players) != 2 || s.Players[0].ID != 1 || s.State != StatePlaying || s.Left != 60 {
		t.Fatalf("snapshot: %+v", s)
	}
	you := w.SelfFor(1)
	if you.Seq != 1 || !you.A || you.HP != 100 || len(you.Mag) != 3 || !you.Prot {
		t.Fatalf("self: %+v", you)
	}
	if w.SelfFor(99) != nil {
		t.Fatal("self for unknown must be nil")
	}
}
