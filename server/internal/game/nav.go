package game

import (
	"container/heap"
	"math"
	"sync"
)

// Nav is a walkability grid over a map (0.5 m cells) used by bots for A* path finding. Every cell has a stand height (the top of the
// obstacle under it: stairs, kerbs and ramps made of small steps are walkable because the player physics steps up them); a move is
// allowed when it climbs at most StepHeight or drops at most maxDrop, taller obstacles are walls (bots do not jump onto cover).
// Only cells connected to a spawn count as walkable. A small clearance keeps the 0.6 m wide body clear of walls.
type Nav struct {
	minX, minZ float64
	nx, nz     int
	walk       []bool
	h          []float64 // stand height per cell
	step       float64
}

const (
	maxDrop  = 1.5 // a drop this high (7.7 m/s landing) stays under the fall-damage speed
	maxStand = 2.5 // obstacles taller than this are never stood on
)

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
	n := &Nav{minX: b.MinX, minZ: b.MinZ, nx: int(math.Ceil((b.MaxX - b.MinX) / navCell)), nz: int(math.Ceil((b.MaxZ - b.MinZ) / navCell)), step: s.Player.StepHeight}
	n.walk = make([]bool, n.nx*n.nz)
	n.h = make([]float64, n.nx*n.nz)
	const clr = 0.12 // extra clearance on each side
	hw := s.Player.HalfWidth + clr
	cand := make([]float64, 0, 8)
	for iz := 0; iz < n.nz; iz++ {
		for ix := 0; ix < n.nx; ix++ {
			x, z := n.center(ix, iz)
			if !(x > b.MinX+s.Player.HalfWidth && x < b.MaxX-s.Player.HalfWidth && z > b.MinZ+s.Player.HalfWidth && z < b.MaxZ-s.Player.HalfWidth) {
				continue
			}
			// stand height: the highest obstacle top under the footprint that leaves headroom (0 = the floor)
			cand = append(cand[:0], 0)
			for i := range m.Boxes {
				o := &m.Boxes[i]
				if x+hw > o[0] && x-hw < o[3] && z+hw > o[2] && z-hw < o[5] && o[4] <= maxStand && o[4] > 0 {
					cand = append(cand, o[4])
				}
			}
			best, ok := 0.0, false
			for _, t := range cand {
				free := true
				for _, d := range [5][2]float64{{0, 0}, {clr, 0}, {-clr, 0}, {0, clr}, {0, -clr}} {
					k := Kin{X: x + d[0], Y: t, Z: z + d[1]}
					if m.overlaps(s, &k) {
						free = false
						break
					}
				}
				if free && (!ok || t > best) {
					best, ok = t, true
				}
			}
			if ok {
				n.walk[iz*n.nx+ix] = true
				n.h[iz*n.nx+ix] = best
			}
		}
	}
	n.keepConnected(m)
	return n
}

// edgeOK: can a body walk from cell a to the adjacent cell b (climb a step, or drop a little)?
func (n *Nav) edgeOK(a, b int) bool {
	d := n.h[b] - n.h[a]
	return n.walk[a] && n.walk[b] && d <= n.step+1e-9 && -d <= maxDrop
}

// keepConnected drops walkable cells that no spawn can reach (tops of crates, enclosed pockets), so path snapping never picks them.
func (n *Nav) keepConnected(m *Map) {
	seen := make([]bool, len(n.walk))
	var queue []int
	for _, sp := range m.Spawns {
		for _, s := range sp {
			if ix, iz, ok := n.snapAny(s.X, s.Z); ok {
				if i := iz*n.nx + ix; !seen[i] {
					seen[i] = true
					queue = append(queue, i)
				}
			}
		}
	}
	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		cx, cz := c%n.nx, c/n.nx
		for dz := -1; dz <= 1; dz++ {
			for dx := -1; dx <= 1; dx++ {
				nx, nz := cx+dx, cz+dz
				if (dx == 0 && dz == 0) || nx < 0 || nz < 0 || nx >= n.nx || nz >= n.nz {
					continue
				}
				ni := nz*n.nx + nx
				if seen[ni] || !n.edgeOK(c, ni) {
					continue
				}
				if dx != 0 && dz != 0 && (!n.edgeOK(c, cz*n.nx+nx) || !n.edgeOK(c, nz*n.nx+cx)) {
					continue
				}
				seen[ni] = true
				queue = append(queue, ni)
			}
		}
	}
	for i := range n.walk {
		n.walk[i] = n.walk[i] && seen[i]
	}
}

// snapAny is snap over the raw (pre-connectivity) walkable cells.
func (n *Nav) snapAny(x, z float64) (int, int, bool) {
	return n.snap(x, z)
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
				if !n.edgeOK(cur.idx, nz*n.nx+nx) {
					continue
				}
				if dx != 0 && dz != 0 {
					if !n.edgeOK(cur.idx, cz*n.nx+cx+dx) || !n.edgeOK(cur.idx, (cz+dz)*n.nx+cx) { // no corner cutting
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
	prev := -1
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		ix, iz := n.cellOf(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)
		if !n.ok(ix, iz) {
			return false
		}
		c := iz*n.nx + ix
		if prev >= 0 && prev != c && math.Abs(n.h[c]-n.h[prev]) > 1e-9 { // never cut across a step: follow the cells
			return false
		}
		prev = c
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
