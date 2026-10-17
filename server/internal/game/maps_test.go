package game

import "testing"

func allMaps(t testing.TB) (*Spec, *MapSet) {
	t.Helper()
	s, ms, err := LoadAll()
	if err != nil {
		t.Fatal(err)
	}
	return s, ms
}

func TestMapRegistry(t *testing.T) {
	_, ms := allMaps(t)
	if len(ms.Order) < 2 || ms.Default() != "yard" || ms.Maps["crossroads"] == nil || ms.Label["crossroads"] == "" {
		t.Fatalf("registry: %+v", ms.Order)
	}
	for id, m := range ms.Maps {
		if len(m.Pickups) < 4 || len(m.Spawns["A"]) < 8 || len(m.Spawns["B"]) < 8 {
			t.Errorf("%s: pickups %d spawns A/B %d/%d", id, len(m.Pickups), len(m.Spawns["A"]), len(m.Spawns["B"]))
		}
	}
}

// walkable BFS on a 0.4 m grid for a standing player: every spawn and every weapon pickup must be reachable
// from team A's first spawn, and the two teams must be able to reach each other (no sealed rooms/blocked avenues).
func TestMapsAreFullyConnected(t *testing.T) {
	spec, ms := allMaps(t)
	for id, m := range ms.Maps {
		t.Run(id, func(t *testing.T) {
			const step = 0.4
			bd := m.Bounds
			nx := int((bd.MaxX-bd.MinX)/step) + 1
			nz := int((bd.MaxZ-bd.MinZ)/step) + 1
			// A cell is walkable if a standing player fits there at the floor, or on top of a jumpable (<= 1.0 m)
			// obstacle with full head room. Window sills therefore do NOT count as passable (the lintel blocks).
			free := func(ix, iz int) bool {
				if ix < 0 || iz < 0 || ix >= nx || iz >= nz {
					return false
				}
				x, z := bd.MinX+float64(ix)*step, bd.MinZ+float64(iz)*step
				ys := []float64{0}
				hw := spec.Player.HalfWidth
				for _, b := range m.Boxes {
					if b[4] <= 1.0 && x+hw > b[0] && x-hw < b[3] && z+hw > b[2] && z-hw < b[5] {
						ys = append(ys, b[4])
					}
				}
				for _, y := range ys {
					k := Kin{X: x, Y: y, Z: z}
					if !m.overlaps(spec, &k) {
						return true
					}
				}
				return false
			}
			cell := func(x, z float64) (int, int) { return int((x - bd.MinX) / step), int((z - bd.MinZ) / step) }
			seen := make([]bool, nx*nz)
			sx, sz := cell(m.Spawns["A"][0].X, m.Spawns["A"][0].Z)
			if !free(sx, sz) {
				t.Fatal("start cell blocked")
			}
			q := [][2]int{{sx, sz}}
			seen[sz*nx+sx] = true
			for len(q) > 0 {
				c := q[0]
				q = q[1:]
				for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
					x, z := c[0]+d[0], c[1]+d[1]
					if free(x, z) && !seen[z*nx+x] {
						seen[z*nx+x] = true
						q = append(q, [2]int{x, z})
					}
				}
			}
			reach := func(what string, x, z float64) {
				ix, iz := cell(x, z)
				ok := false
				for dx := -1; dx <= 1 && !ok; dx++ {
					for dz := -1; dz <= 1; dz++ {
						if ix+dx >= 0 && iz+dz >= 0 && ix+dx < nx && iz+dz < nz && seen[(iz+dz)*nx+ix+dx] {
							ok = true
						}
					}
				}
				if !ok {
					t.Errorf("%s at (%.1f, %.1f) is not reachable on foot from team A's spawn", what, x, z)
				}
			}
			for _, tm := range []string{"A", "B"} {
				for _, sp := range m.Spawns[tm] {
					reach("spawn "+tm, sp.X, sp.Z)
				}
			}
			for _, pk := range m.Pickups {
				reach("pickup", pk.X, pk.Z)
			}
		})
	}
}

func TestCrossroadsSpawnsFaceEachOtherAndAreFarApart(t *testing.T) {
	_, ms := allMaps(t)
	m := ms.Maps["crossroads"]
	a, b := m.Spawns["A"][0], m.Spawns["B"][0]
	if a.Z <= 0 || b.Z >= 0 || a.Z-b.Z < 40 {
		t.Fatalf("teams should start at opposite ends: A.z=%v B.z=%v", a.Z, b.Z)
	}
}
