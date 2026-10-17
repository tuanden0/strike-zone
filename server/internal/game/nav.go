package game

import (
	"container/heap"
	"math"
	"sync"
)

// Nav is a walkability grid over a map (0.5 m cells) used by bots for A* path finding. It treats every box as a wall
// (bots do not jump over cover) and keeps a small clearance so the 0.6 m wide player body fits.
type Nav struct {
	minX, minZ float64
	nx, nz     int
	walk       []bool
}

const navCell = 0.5

var (
	navMu    sync.Mutex
	navCache = map[*Map]*Nav{}
)

// navFor returns the (cached) grid of a map. The cache key is the map pointer: maps are immutable once loaded.
func navFor(s *Spec, m *Map) *Nav {
	navMu.Lock()
	defer navMu.Unlock()
	if n, ok := navCache[m]; ok {
		return n
	}
	n := buildNav(s, m)
	navCache[m] = n
	return n
}

func buildNav(s *Spec, m *Map) *Nav {
	b := m.Bounds
	n := &Nav{minX: b.MinX, minZ: b.MinZ, nx: int(math.Ceil((b.MaxX - b.MinX) / navCell)), nz: int(math.Ceil((b.MaxZ - b.MinZ) / navCell))}
	n.walk = make([]bool, n.nx*n.nz)
	const clr = 0.12 // extra clearance on each side
	for iz := 0; iz < n.nz; iz++ {
		for ix := 0; ix < n.nx; ix++ {
			x, z := n.center(ix, iz)
			ok := x > b.MinX+s.Player.HalfWidth && x < b.MaxX-s.Player.HalfWidth && z > b.MinZ+s.Player.HalfWidth && z < b.MaxZ-s.Player.HalfWidth
			for _, d := range [5][2]float64{{0, 0}, {clr, 0}, {-clr, 0}, {0, clr}, {0, -clr}} {
				if !ok {
					break
				}
				k := Kin{X: x + d[0], Z: z + d[1]}
				ok = !m.overlaps(s, &k)
			}
			n.walk[iz*n.nx+ix] = ok
		}
	}
	return n
}

func (n *Nav) center(ix, iz int) (float64, float64) {
	return n.minX + (float64(ix)+0.5)*navCell, n.minZ + (float64(iz)+0.5)*navCell
}

func (n *Nav) cellOf(x, z float64) (int, int) {
	return int(math.Floor((x - n.minX) / navCell)), int(math.Floor((z - n.minZ) / navCell))
}

func (n *Nav) ok(ix, iz int) bool {
	return ix >= 0 && iz >= 0 && ix < n.nx && iz < n.nz && n.walk[iz*n.nx+ix]
}

// Walkable reports whether a body centred at (x,z) fits.
func (n *Nav) Walkable(x, z float64) bool {
	ix, iz := n.cellOf(x, z)
	return n.ok(ix, iz)
}

// snap returns the nearest walkable cell to (x,z), searching outward in rings.
func (n *Nav) snap(x, z float64) (int, int, bool) {
	cx, cz := n.cellOf(x, z)
	if n.ok(cx, cz) {
		return cx, cz, true
	}
	for r := 1; r <= 8; r++ {
		best, bx, bz := math.MaxFloat64, 0, 0
		for dz := -r; dz <= r; dz++ {
			for dx := -r; dx <= r; dx++ {
				if max(abs(dx), abs(dz)) != r || !n.ok(cx+dx, cz+dz) {
					continue
				}
				if d := float64(dx*dx + dz*dz); d < best {
					best, bx, bz = d, cx+dx, cz+dz
				}
			}
		}
		if best < math.MaxFloat64 {
			return bx, bz, true
		}
	}
	return 0, 0, false
}

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

type navItem struct {
	idx int
	f   float64
}
type navHeap []navItem

func (h navHeap) Len() int            { return len(h) }
func (h navHeap) Less(i, j int) bool  { return h[i].f < h[j].f }
func (h navHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *navHeap) Push(x interface{}) { *h = append(*h, x.(navItem)) }
func (h *navHeap) Pop() interface{} {
	o := *h
	v := o[len(o)-1]
	*h = o[:len(o)-1]
	return v
}

// Path returns waypoints (x,z) from a to b, or nil when b is unreachable. Both ends are snapped to the nearest walkable cell.
func (n *Nav) Path(ax, az, bx, bz float64) [][2]float64 {
	sx, sz, ok1 := n.snap(ax, az)
	gx, gz, ok2 := n.snap(bx, bz)
	if !ok1 || !ok2 {
		return nil
	}
	start, goal := sz*n.nx+sx, gz*n.nx+gx
	if start == goal {
		x, z := n.center(gx, gz)
		return [][2]float64{{x, z}}
	}
	g := make(map[int]float64, 256)
	from := make(map[int]int, 256)
	closed := make(map[int]bool, 256)
	h := &navHeap{{start, 0}}
	g[start] = 0
	hcost := func(ix, iz int) float64 {
		dx, dz := math.Abs(float64(ix-gx)), math.Abs(float64(iz-gz))
		return math.Max(dx, dz) + 0.414*math.Min(dx, dz)
	}
	for h.Len() > 0 {
		cur := heap.Pop(h).(navItem)
		if closed[cur.idx] {
			continue
		}
		closed[cur.idx] = true
		if cur.idx == goal {
			break
		}
		cx, cz := cur.idx%n.nx, cur.idx/n.nx
		for dz := -1; dz <= 1; dz++ {
			for dx := -1; dx <= 1; dx++ {
				if dx == 0 && dz == 0 {
					continue
				}
				nx, nz := cx+dx, cz+dz
				if !n.ok(nx, nz) {
					continue
				}
				cost := 1.0
				if dx != 0 && dz != 0 {
					if !n.ok(cx+dx, cz) || !n.ok(cx, cz+dz) { // no corner cutting
						continue
					}
					cost = 1.414
				}
				ni := nz*n.nx + nx
				ng := g[cur.idx] + cost
				if old, seen := g[ni]; seen && ng >= old {
					continue
				}
				g[ni] = ng
				from[ni] = cur.idx
				heap.Push(h, navItem{ni, ng + hcost(nx, nz)})
			}
		}
	}
	if !closed[goal] {
		return nil
	}
	var cells []int
	for c := goal; c != start; c = from[c] {
		cells = append(cells, c)
	}
	cells = append(cells, start)
	pts := make([][2]float64, 0, len(cells))
	for i := len(cells) - 1; i >= 0; i-- {
		x, z := n.center(cells[i]%n.nx, cells[i]/n.nx)
		pts = append(pts, [2]float64{x, z})
	}
	return n.smooth(pts)
}

// lineOK samples the straight segment a-b for walkability.
func (n *Nav) lineOK(a, b [2]float64) bool {
	d := math.Hypot(b[0]-a[0], b[1]-a[1])
	steps := int(d/(navCell*0.5)) + 1
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		if !n.Walkable(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t) {
			return false
		}
	}
	return true
}

// smooth removes waypoints that a straight walkable line can skip.
func (n *Nav) smooth(p [][2]float64) [][2]float64 {
	if len(p) < 3 {
		return p
	}
	out := [][2]float64{p[0]}
	i := 0
	for i < len(p)-1 {
		j := len(p) - 1
		for ; j > i+1; j-- {
			if n.lineOK(p[i], p[j]) {
				break
			}
		}
		out = append(out, p[j])
		i = j
	}
	return out
}
