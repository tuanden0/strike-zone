package game

import (
	"math"
	"testing"
)

func botWorld(t testing.TB, seed uint64) (*World, *Map) {
	t.Helper()
	spec, m := mustLoad(t)
	return NewWorld(spec, m, MatchConfig{TimeLimitSec: 100000, ScoreLimit: 100000}, seed), m
}

func TestNavFindsPathsBetweenSpawnsOnEveryMap(t *testing.T) {
	spec, ms, err := LoadAll()
	if err != nil {
		t.Fatal(err)
	}
	for id, m := range ms.Maps {
		n := navFor(spec, m)
		for _, a := range m.Spawns[TeamA] {
			if !n.Walkable(a.X, a.Z) {
				t.Errorf("%s: team A spawn (%v,%v) is not on a walkable nav cell", id, a.X, a.Z)
			}
			for _, b := range m.Spawns[TeamB][:2] {
				p := n.Path(a.X, a.Z, b.X, b.Z)
				if len(p) == 0 {
					t.Errorf("%s: no bot path from (%v,%v) to (%v,%v)", id, a.X, a.Z, b.X, b.Z)
				}
			}
		}
		for _, pk := range m.Pickups {
			if p := n.Path(m.Spawns[TeamA][0].X, m.Spawns[TeamA][0].Z, pk.X, pk.Z); len(p) == 0 {
				t.Errorf("%s: pickup (%v,%v) unreachable for bots", id, pk.X, pk.Z)
			}
		}
	}
}

func TestPathStaysOnWalkableCellsAndAvoidsWalls(t *testing.T) {
	spec, m := mustLoad(t)
	n := navFor(spec, m)
	a, b := m.Spawns[TeamA][0], m.Spawns[TeamB][0]
	path := n.Path(a.X, a.Z, b.X, b.Z)
	if len(path) < 2 {
		t.Fatalf("path %v", path)
	}
	prev := [2]float64{a.X, a.Z}
	for _, wp := range path {
		if !n.lineOK(prev, wp) {
			t.Fatalf("segment %v -> %v crosses a blocked cell", prev, wp)
		}
		prev = wp
	}
}

func TestBotWalksToItsGoalWithoutGettingStuck(t *testing.T) {
	w, _ := botWorld(t, 5)
	p, err := w.AddBot(1, "[BOT] A", TeamA, SkillNormal)
	if err != nil {
		t.Fatal(err)
	}
	p.ProtectUntil = 1 << 30
	start := [2]float64{p.Kin.X, p.Kin.Z}
	far := 0.0
	for i := 0; i < 30*40; i++ { // 40 s alone on the map
		w.Step()
		far = math.Max(far, math.Hypot(p.Kin.X-start[0], p.Kin.Z-start[1]))
	}
	if far < 15 {
		t.Fatalf("bot only got %.1f m from its spawn in 40 s: it is stuck", far)
	}
}

func TestBotsFightAndKillEachOther(t *testing.T) {
	for _, skill := range []string{SkillEasy, SkillNormal, SkillHard} {
		w, _ := botWorld(t, 9)
		for i := 0; i < 3; i++ {
			if _, err := w.AddBot(10+i, "a", TeamA, skill); err != nil {
				t.Fatal(err)
			}
			if _, err := w.AddBot(20+i, "b", TeamB, skill); err != nil {
				t.Fatal(err)
			}
		}
		shots, kills := 0, 0
		for i := 0; i < 30*180; i++ { // 3 minutes
			w.Step()
			shots += len(eventsOf(w, EvShot))
			kills += len(eventsOf(w, EvKill))
		}
		t.Logf("%s: %d shots, %d kills, score %v", skill, shots, kills, w.Score)
		if shots < 50 || kills < 2 {
			t.Errorf("%s: bots barely fight (%d shots, %d kills in 3 min)", skill, shots, kills)
		}
	}
}

func TestBotsNeverShootTeammatesAndSkillOrdersAccuracy(t *testing.T) {
	acc := map[string]float64{}
	for _, skill := range []string{SkillEasy, SkillHard} {
		w, _ := botWorld(t, 21)
		for i := 0; i < 3; i++ {
			w.AddBot(10+i, "a", TeamA, skill)
			w.AddBot(20+i, "b", TeamB, skill)
		}
		shots, hits := 0, 0
		for i := 0; i < 30*240; i++ {
			w.Step()
			for _, e := range w.Events() {
				switch e.E {
				case EvShot:
					shots++
				case EvHit:
					hits++
					if w.players[e.By].Team == w.players[e.V].Team && e.By != e.V {
						t.Fatalf("friendly fire: %d hit teammate %d", e.By, e.V)
					}
				}
			}
		}
		if shots == 0 {
			t.Fatalf("%s: no shots", skill)
		}
		acc[skill] = float64(hits) / float64(shots)
	}
	t.Logf("accuracy easy %.2f hard %.2f", acc[SkillEasy], acc[SkillHard])
	if acc[SkillHard] <= acc[SkillEasy] {
		t.Errorf("hard bots should hit more than easy ones (%.2f vs %.2f)", acc[SkillHard], acc[SkillEasy])
	}
}

func TestBotCannotSeeThroughWallsSmokeOrFlash(t *testing.T) {
	w, a, b := duel(t)
	a.Yaw = 0 // faces -z toward b
	if !w.canSee(a, b) {
		t.Fatal("open floor, facing the target: must see it")
	}
	a.Yaw = math.Pi
	if w.canSee(a, b) {
		t.Fatal("sees an enemy behind its back")
	}
	a.Yaw = 0
	boomAt(w, gSmoke, a.ID, 5, 1.2, 7)
	w.Step()
	if w.canSee(a, b) {
		t.Fatal("sees through smoke")
	}
	w.smokes = nil
	a.FlashUntil = w.Tick + 30
	if w.canSee(a, b) {
		t.Fatal("a flashed bot still sees")
	}
}

func TestBotAIUsesTheClientInputRules(t *testing.T) {
	w, _ := botWorld(t, 3)
	p, _ := w.AddBot(1, "bot", TeamA, SkillHard)
	for i := 0; i < 300; i++ {
		in := p.bot.Think(w, p)
		if err := in.Validate(len(w.Spec.Weapons)); err != nil {
			t.Fatalf("tick %d: bot produced an invalid input: %v (%+v)", i, err, in)
		}
		if in.Nade < 0 || in.Nade > len(w.Spec.Grenades) {
			t.Fatalf("bad nade %d", in.Nade)
		}
		w.Step()
	}
	if w.AddBotErr(2, "x", TeamB, "godlike") == nil {
		t.Fatal("unknown skill accepted")
	}
}

// AddBotErr is a test helper returning only the error.
func (w *World) AddBotErr(id int, nick, team, skill string) error {
	_, err := w.AddBot(id, nick, team, skill)
	return err
}

func TestBotsRespawnAndMatchesRunForLong(t *testing.T) {
	w, _ := botWorld(t, 77)
	w.Cfg.ScoreLimit = 15
	for i := 0; i < 5; i++ {
		w.AddBot(10+i, "a", TeamA, SkillNormal)
		w.AddBot(20+i, "b", TeamB, SkillNormal)
	}
	ended := false
	for i := 0; i < 30*600 && !ended; i++ { // up to 10 minutes of game time
		w.Step()
		ended = w.State == StateEnded
	}
	if !ended {
		t.Fatalf("a 5v5 bot match never reached the score limit (score %v)", w.Score)
	}
	alive := 0
	for _, p := range w.Players() {
		if p.Alive {
			alive++
		}
	}
	if alive == 0 {
		t.Fatal("nobody respawned")
	}
}
