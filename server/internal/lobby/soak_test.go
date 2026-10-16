package lobby

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"testing"
	"time"
)

// Ten bots hammer a full room with random (valid) inputs for 20 simulated seconds.
// Checks: no panic, state stays sane, and a tick fits comfortably in the 33 ms budget.
func TestSoakFullRoomRandomInputs(t *testing.T) {
	h := newHub(t)
	rng := rand.New(rand.NewPCG(1, 2))
	var sess []*Session
	for i := 0; i < 10; i++ {
		s, _ := client(t, h, "bot")
		if i == 0 {
			create(t, h, s, "Soak", "", 10)
		} else if err := send(t, h, s, map[string]any{"t": "join", "room": 1, "team": "auto"}); err != nil {
			t.Fatal(err)
		}
		sess = append(sess, s)
	}
	if h.rooms[1].World.Len() != 10 {
		t.Fatalf("room holds %d players", h.rooms[1].World.Len())
	}
	seq := make([]int, len(sess))
	var worst, total time.Duration
	const ticks = 600
	for tick := 0; tick < ticks; tick++ {
		for i, s := range sess {
			seq[i]++
			b, _ := json.Marshal(map[string]any{
				"t": "in", "seq": seq[i],
				"f": float64(rng.IntN(3) - 1), "s": float64(rng.IntN(3) - 1),
				"yaw": rng.Float64()*2*math.Pi - math.Pi, "pitch": rng.Float64() - 0.5,
				"jump": rng.IntN(20) == 0, "walk": rng.IntN(10) == 0, "fire": rng.IntN(2) == 0,
				"reload": rng.IntN(40) == 0, "weapon": rng.IntN(4) - 1,
			})
			if err := h.Handle(s, b); err != nil {
				t.Fatalf("bot %d: %v", i, err)
			}
		}
		t0 := time.Now()
		h.Tick()
		d := time.Since(t0)
		total += d
		if d > worst {
			worst = d
		}
	}
	w := h.rooms[1].World
	for _, p := range w.Players() {
		k := p.Kin
		if math.IsNaN(k.X+k.Y+k.Z) || k.X < -24 || k.X > 24 || k.Z < -24 || k.Z > 24 || k.Y < 0 || k.Y > 3 {
			t.Fatalf("player %d out of bounds: %+v", p.ID, k)
		}
		if p.HP > 100 || p.Mag[0] < 0 || p.Res[0] < 0 {
			t.Fatalf("bad stats: %+v", p)
		}
	}
	if w.Score[0]+w.Score[1] == 0 {
		t.Log("note: no kills happened in this soak run")
	}
	avg := total / ticks
	t.Logf("10 players, %d ticks: avg %v, worst %v, kills A/B %v", ticks, avg, worst, w.Score)
	if avg > 10*time.Millisecond {
		t.Fatalf("average tick %v too slow for a 33 ms budget", avg)
	}
}
