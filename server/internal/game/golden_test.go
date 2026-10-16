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
}

type goldenScenario struct {
	Start  [3]float64
	Inputs []goldenCmd
	Expect []struct {
		X, Y, Z, Vy float64
		G           bool
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
	if len(sc) < 4 {
		t.Fatalf("expected >=4 scenarios, got %d", len(sc))
	}
	const eps = 1e-9
	for si, s := range sc {
		k := Kin{X: s.Start[0], Y: s.Start[1], Z: s.Start[2]}
		for i, in := range s.Inputs {
			Step(spec, m, &k, MoveCmd{F: in.F, S: in.S, Yaw: in.Yaw, Jump: in.Jump, Walk: in.Walk})
			e := s.Expect[i]
			if math.Abs(k.X-e.X) > eps || math.Abs(k.Y-e.Y) > eps || math.Abs(k.Z-e.Z) > eps || math.Abs(k.Vy-e.Vy) > eps || k.OnGround != e.G {
				t.Fatalf("scenario %d step %d: go=%+v js=%+v", si, i, k, e)
			}
		}
	}
}

func TestLoadDefault(t *testing.T) {
	s, m := mustLoad(t)
	if s.TickRate != 30 || len(s.Weapons) != 3 || len(m.Boxes) == 0 || len(m.Spawns["A"]) == 0 {
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
