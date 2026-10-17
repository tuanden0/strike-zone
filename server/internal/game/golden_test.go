package game

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

type goldenCmd struct {
	F, S, Yaw float64
	Jump      bool
	Walk      bool
	Crouch    bool
}

type goldenScenario struct {
	Start  [3]float64
	Inputs []goldenCmd
	Boxes  [][6]float64 // extra collision boxes for this scenario (e.g. a low beam)
	Others []struct {   // other (static, living) players standing in the scenario
		X, Y, Z float64
		C       bool
	}
	Expect []struct {
		X, Y, Z, Vy float64
		G, C        bool
		I           float64
	}
}

func mustLoad(t testing.TB) (*Spec, *Map) {
	t.Helper()
	s, m, err := LoadDefault()
	if err != nil {
		t.Fatal(err)
	}
	return s, m
}

// The JS client predicts movement with client/js/physics.js; any drift from Go breaks reconciliation.
func TestMoveMatchesJSGolden(t *testing.T) {
	spec, m := mustLoad(t)
	raw, err := os.ReadFile("testdata/golden_move.json")
	if err != nil {
		t.Fatal(err)
	}
	var sc []goldenScenario
	if err := json.Unmarshal(raw, &sc); err != nil {
		t.Fatal(err)
	}
	if len(sc) < 11 {
		t.Fatalf("expected >=11 scenarios, got %d", len(sc))
	}
	crouched, landings := 0, 0
	const eps = 1e-9
	for si, s := range sc {
		k := Kin{X: s.Start[0], Y: s.Start[1], Z: s.Start[2]}
		mm := m
		if len(s.Boxes) > 0 {
			c := *m
			c.Boxes = append(append([][6]float64(nil), m.Boxes...), s.Boxes...)
			mm = &c
		}
		for i, in := range s.Inputs {
			var solids [][6]float64
			if len(s.Others) > 0 {
				ks := make([]Kin, len(s.Others))
				for j, o := range s.Others {
					ks[j] = Kin{X: o.X, Y: o.Y, Z: o.Z, Crouch: o.C}
				}
				solids = PlayerSolids(spec, &k, ks)
			}
			Step(spec, mm, &k, MoveCmd{F: in.F, S: in.S, Yaw: in.Yaw, Jump: in.Jump, Walk: in.Walk, Crouch: in.Crouch}, solids...)
			if k.Crouch {
				crouched++
			}
			if k.Impact > 0 {
				landings++
			}
			e := s.Expect[i]
			if math.Abs(k.X-e.X) > eps || math.Abs(k.Y-e.Y) > eps || math.Abs(k.Z-e.Z) > eps || math.Abs(k.Vy-e.Vy) > eps || k.OnGround != e.G || k.Crouch != e.C || math.Abs(k.Impact-e.I) > eps {
				t.Fatalf("scenario %d step %d: go=%+v js=%+v", si, i, k, e)
			}
		}
	}
	if landings < 3 {
		t.Fatalf("golden scenarios barely exercise landings (%d)", landings)
	}
	if crouched < 100 {
		t.Fatalf("golden scenarios barely exercise crouching (%d ticks)", crouched)
	}
}

func TestLoadDefault(t *testing.T) {
	s, m := mustLoad(t)
	if s.TickRate != 30 || len(s.Weapons) != 4 || len(m.Boxes) == 0 || len(m.Spawns["A"]) == 0 {
		t.Fatalf("unexpected defaults: %+v", s)
	}
}

func TestParseRejectsBadSpecs(t *testing.T) {
	good, _ := os.ReadFile("../../../client/shared/spec.json")
	gm, _ := os.ReadFile("../../../client/shared/map.json")
	if _, _, err := Parse(good, gm); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Parse([]byte(`{"tickRate":0}`), gm); err == nil {
		t.Fatal("tickRate 0 accepted")
	}
	if _, _, err := Parse([]byte(`not json`), gm); err == nil {
		t.Fatal("bad json accepted")
	}
	// spawn inside a wall must be rejected
	bad := []byte(`{"name":"x","bounds":{"minX":-5,"maxX":5,"minZ":-5,"maxZ":5},"boxes":[{"min":[-1,0,-1],"max":[1,2,1],"mat":"wall"}],"spawns":{"A":[{"x":0,"z":0,"yaw":0}],"B":[{"x":3,"z":3,"yaw":0}]}}`)
	if _, _, err := Parse(good, bad); err == nil {
		t.Fatal("spawn inside geometry accepted")
	}
}

func TestStepBasics(t *testing.T) {
	spec, m := mustLoad(t)
	// standing still on the floor stays put and grounded
	k := Kin{X: 0, Z: 20}
	for i := 0; i < 10; i++ {
		Step(spec, m, &k, MoveCmd{})
	}
	if k.Y != 0 || !k.OnGround || k.X != 0 || k.Z != 20 {
		t.Fatalf("idle drift: %+v", k)
	}
	// forward at yaw 0 goes toward -Z at run speed
	sp := Step(spec, m, &k, MoveCmd{F: 1})
	if sp != spec.Player.RunSpeed || k.Z >= 20 {
		t.Fatalf("forward: speed %v z %v", sp, k.Z)
	}
	// diagonal input is normalized: never faster than run speed
	if sp := Step(spec, m, &k, MoveCmd{F: 1, S: 1}); math.Abs(sp-spec.Player.RunSpeed) > 1e-9 {
		t.Fatalf("diagonal speed %v", sp)
	}
	// walk is slower
	if sp := Step(spec, m, &k, MoveCmd{F: 1, Walk: true}); sp != spec.Player.WalkSpeed {
		t.Fatalf("walk speed %v", sp)
	}
	// cannot walk through the outer wall
	k = Kin{X: 0, Z: 22}
	for i := 0; i < 200; i++ {
		Step(spec, m, &k, MoveCmd{F: -1})
	}
	if k.Z > m.Bounds.MaxZ-spec.Player.HalfWidth+1e-9 {
		t.Fatalf("passed outer wall: z=%v", k.Z)
	}
	// jump only from ground
	k = Kin{X: 0, Z: 20}
	Step(spec, m, &k, MoveCmd{})
	Step(spec, m, &k, MoveCmd{Jump: true})
	if k.Y <= 0 || k.OnGround {
		t.Fatalf("jump failed: %+v", k)
	}
	vy := k.Vy
	Step(spec, m, &k, MoveCmd{Jump: true})
	if k.Vy >= vy {
		t.Fatalf("double jump in air: vy %v -> %v", vy, k.Vy)
	}
}

func TestRayBox(t *testing.T) {
	box := [6]float64{-1, 0, -1, 1, 2, 1}
	if tt := RayBox([3]float64{0, 1, 5}, [3]float64{0, 0, -1}, box, 100); math.Abs(tt-4) > 1e-9 {
		t.Fatalf("hit t=%v", tt)
	}
	if RayBox([3]float64{5, 1, 5}, [3]float64{0, 0, -1}, box, 100) >= 0 {
		t.Fatal("miss reported as hit")
	}
	if RayBox([3]float64{0, 1, 5}, [3]float64{0, 0, -1}, box, 3) >= 0 {
		t.Fatal("beyond range reported as hit")
	}
	if RayBox([3]float64{0, 1, 5}, [3]float64{0, 0, 1}, box, 100) >= 0 {
		t.Fatal("ray pointing away hit")
	}
}

// Client-side ammo/cooldown prediction (client/js/weapons.js) must equal the server state machine.
func TestWeaponsMatchJSGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/golden_weapons.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Inputs []struct {
			Fire, Reload, Heavy bool
			Weapon              int
		}
		Expect []struct {
			Cur      int
			Mag, Res []int
			Cd, Rl   int
			Pf       bool
			Bu       int
			Sp       [2]float64
			Kk       float64
		}
		Table [][][3]float64
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	spec, m := mustLoad(t)
	w := NewWorld(spec, m, MatchConfig{TimeLimitSec: 100000, ScoreLimit: 1000}, 1)
	p := add(t, w, 1, TeamA)
	fired := 0
	for i, in := range g.Inputs {
		if err := w.QueueInput(1, Input{Seq: uint32(i + 1), Fire: in.Fire, Reload: in.Reload, Heavy: in.Heavy, Weapon: in.Weapon, Yaw: 0}); err != nil {
			t.Fatal(err)
		}
		w.Step()
		fired += len(eventsOf(w, EvShot))
		e := g.Expect[i]
		cd, rl := max(0, p.NextFire-w.Tick), 0
		if p.ReloadDone > 0 {
			rl = p.ReloadDone - w.Tick
		}
		same := func(a, b []int) bool {
			for k := range a {
				if a[k] != b[k] {
					return false
				}
			}
			return len(a) == len(b)
		}
		ws0 := &spec.Weapons[p.Cur]
		if p.Burst != e.Bu || math.Abs(spec.Spread(ws0, false, 0, p.Burst)-e.Sp[0]) > 1e-12 || math.Abs(spec.Spread(ws0, true, 1, p.Burst)-e.Sp[1]) > 1e-12 || math.Abs(burstKick(spec, ws0, p.Burst)-e.Kk) > 1e-12 {
			t.Fatalf("tick %d: go burst=%d spread=%v kick=%v; js %+v", i+1, p.Burst, spec.Spread(ws0, false, 0, p.Burst), burstKick(spec, ws0, p.Burst), e)
		}
		if p.Cur != e.Cur || !same(p.Mag, e.Mag) || !same(p.Res, e.Res) || cd != e.Cd || rl != e.Rl || p.PrevFire != e.Pf {
			t.Fatalf("tick %d: go cur=%d mag=%v res=%v cd=%d rl=%d pf=%v; js %+v", i+1, p.Cur, p.Mag, p.Res, cd, rl, p.PrevFire, e)
		}
	}
	for wi := range spec.Weapons {
		for bi, b := range []int{1, 2, 5, 12, 40} {
			ws := &spec.Weapons[wi]
			got := [3]float64{burstKick(spec, ws, b), spec.Bloom(ws, b), spec.Spread(ws, true, 0.5, b)}
			for k := range got {
				if math.Abs(got[k]-g.Table[wi][bi][k]) > 1e-12 {
					t.Fatalf("weapon %s burst %d: go %v js %v", ws.ID, b, got, g.Table[wi][bi])
				}
			}
		}
	}
	if fired < 50 {
		t.Fatalf("golden sequence barely exercises firing (%d shots)", fired)
	}
}

// burstKick mirrors client/js/weapons.js burstKick (only used by the parity test: the server does not apply view kick).
func burstKick(s *Spec, ws *WeaponSpec, burst int) float64 {
	r := s.Recoil
	return s.Kick(ws) * (1 + r.RampPerShot*float64(min(max(burst, 1), r.MaxShots)-1))
}
