"""Shared, pure-python helpers for the grid-authored maps (piazza, pyramid, canyon, harbor, bunker).

A map is drawn as ASCII, one character per 1 m cell. Only the TEAM A half (z >= 0, the bottom of the picture) is
written; the team B half is the same drawing rotated 180 degrees about the map centre, so both teams get the same map by
construction. Each legend character stands for one or more stacked layers (mat, y0, y1) -> collision boxes, so doors,
windows and bridging arches are just characters with a lintel layer. Adjacent cells of the same character are merged
into the fewest rectangles.

    rows[0]  is the row at z = 0..1 (map centre),  rows[-1] is the back wall of team A's side (z = hz-1..hz)
    column 0 is x = -hx..-hx+1

Special characters (always walkable floor):  '.' floor   'A' team A spawn (rotated copy becomes team B)
                                             'R' rifle pickup  'P' pistol pickup  'S' sniper pickup
Everything the server needs ends up in client/shared/map_<id>.json (name, bounds, boxes, spawns, pickups); the extra
"decor" list (door / window / arch frames, facade windows, floor patches) is visual-only and ignored by the server.

Also here: a validator that mirrors server/internal/game/maps_test.go (0.4 m BFS, jumpable <= 1 m obstacles) and a stricter
bot-style check (0.5 m grid, no jumping, >= 1.6 m wide routes), plus a top-down PNG for eyeballing a layout.
"""
import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHARED = os.path.join(ROOT, "client", "shared")

HALF_W = 0.3      # spec.player.halfWidth
HEIGHT = 1.8      # spec.player.height
WALL_H = 6.0


def L(mat, y1, y0=0.0, kind=None, facade=None, extra=()):
    """Legend entry: one layer (mat, y0, y1) plus optional extra layers; kind 'door'|'window' emits a frame decor;
    facade = [(y0, y1), ...] rows of fake windows drawn on exposed faces."""
    return {"layers": [(mat, y0, y1)] + list(extra), "kind": kind, "facade": facade}


def DOOR(mat, lintel_y0=2.6, y1=WALL_H):
    return {"layers": [(mat, lintel_y0, y1)], "kind": "door", "facade": None}


def WINDOW(mat, sill=1.0, top=2.4, y1=WALL_H):
    return {"layers": [(mat, 0.0, sill), (mat, top, y1)], "kind": "window", "facade": None}


SPECIAL = {".": None, " ": None, "A": None, "B": None, "R": None, "P": None, "S": None}


def rects_of(cells):
    """Greedy merge of a set of (ix, iz) cells into [(x0, x1, z0, z1)] half-open rectangles (cell units)."""
    if not cells:
        return []
    byz = {}
    for x, z in cells:
        byz.setdefault(z, []).append(x)
    out, active = [], {}
    for z in range(min(byz), max(byz) + 2):
        xs = sorted(byz.get(z, []))
        runs, i = set(), 0
        while i < len(xs):
            j = i
            while j + 1 < len(xs) and xs[j + 1] == xs[j] + 1:
                j += 1
            runs.add((xs[i], xs[j] + 1))
            i = j + 1
        for run, z0 in list(active.items()):
            if run not in runs:
                out.append((run[0], run[1], z0, z))
                del active[run]
        for run in runs:
            active.setdefault(run, z)
    return out


class Grid:
    def __init__(self, hx, rows):
        self.hx = hx
        self.hz = len(rows)
        self.W = 2 * hx
        self.R = 2 * self.hz
        for i, r in enumerate(rows):
            if len(r) != self.W:
                raise SystemExit(f"row {i} has {len(r)} columns, expected {self.W}:\n{r}")
        bottom = [list(r) for r in rows]
        full = [[" "] * self.W for _ in range(self.R)]
        for i, r in enumerate(bottom):
            full[self.hz + i] = r[:]
        for i, r in enumerate(bottom):  # rotate 180 degrees: row hz+i, col c -> row hz-1-i, col W-1-c
            rr = full[self.hz - 1 - i]
            for c, ch in enumerate(r):
                rr[self.W - 1 - c] = "B" if ch == "A" else ch
        self.full = full

    def ch(self, ix, iz):
        if 0 <= ix < self.W and 0 <= iz < self.R:
            return self.full[iz][ix]
        return "#"

    def xz(self, ix, iz):
        """Cell origin (min corner) in world metres."""
        return ix - self.hx, iz - self.hz


class Canvas:
    """Draw the team A half in world metres (integers): x -hx..hx, z 0..hz. Later calls overwrite earlier ones."""

    def __init__(self, hx):
        self.hx, self.hz = hx, hx
        self.c = [["."] * (2 * hx) for _ in range(hx)]

    def fill(self, x0, x1, z0, z1, ch):
        for z in range(int(z0), int(z1)):
            for x in range(int(x0), int(x1)):
                if not (-self.hx <= x < self.hx and 0 <= z < self.hz):
                    raise SystemExit(f"fill outside the half: {(x0, x1, z0, z1, ch)}")
                self.c[z][x + self.hx] = ch

    def put(self, x, z, ch):
        self.fill(x, x + 1, z, z + 1, ch)

    def room(self, x0, x1, z0, z1, wall, inner="."):
        """Hollow rectangle: 1 m thick ring of `wall`, interior cleared to `inner`."""
        self.fill(x0, x1, z0, z1, wall)
        if x1 - x0 > 2 and z1 - z0 > 2:
            self.fill(x0 + 1, x1 - 1, z0 + 1, z1 - 1, inner)

    def rows(self):
        return ["".join(r) for r in self.c]

    def dump(self):
        print("\n".join(f"z{z:>3} " + "".join(r) for z, r in enumerate(self.c)))


def build_map(mid, name, hx, rows, legend, patches=(), outer_mat="outer", outer_h=WALL_H, write=True, png=None, facade_cap=None):
    g = Grid(hx, rows)
    hz = g.hz
    for ch in {c for r in g.full for c in r}:
        if ch not in SPECIAL and ch not in legend:
            raise SystemExit(f"{mid}: character {ch!r} is not in the legend")

    boxes, decor = [], []

    def add_box(mat, x0, x1, z0, z1, y0, y1):
        boxes.append({"min": [round(x0, 3), round(y0, 3), round(z0, 3)], "max": [round(x1, 3), round(y1, 3), round(z1, 3)], "mat": mat})

    # perimeter (slightly overlapping corners, like the other maps)
    add_box(outer_mat, -hx - 1, hx + 1, -hz - 1, -hz, 0, outer_h)
    add_box(outer_mat, -hx - 1, hx + 1, hz, hz + 1, 0, outer_h)
    add_box(outer_mat, -hx - 1, -hx, -hz, hz, 0, outer_h)
    add_box(outer_mat, hx, hx + 1, -hz, hz, 0, outer_h)

    # group cells by identical layer stacks and merge
    groups = {}
    for iz in range(g.R):
        for ix in range(g.W):
            ch = g.full[iz][ix]
            if ch in SPECIAL:
                continue
            key = tuple(legend[ch]["layers"])
            groups.setdefault(key, set()).add((ix, iz))
    for key in sorted(groups):
        for x0, x1, z0, z1 in rects_of(groups[key]):
            for mat, y0, y1 in key:
                add_box(mat, x0 - hx, x1 - hx, z0 - hz, z1 - hz, y0, y1)

    # ---- decor: door / window frames
    def wallish(ch):
        if ch == "#":
            return True
        e = legend.get(ch)
        if not e:
            return False
        if e["kind"]:
            return True
        return any(y0 < 0.05 and y1 >= 2.0 for _, y0, y1 in e["layers"])

    seen = set()
    for iz in range(g.R):
        for ix in range(g.W):
            ch = g.full[iz][ix]
            e = legend.get(ch)
            if not e or not e["kind"] or (ix, iz) in seen:
                continue
            if wallish(g.ch(ix - 1, iz)) and wallish(g.ch(ix + 1, iz)):
                axis = "x"
            elif wallish(g.ch(ix, iz - 1)) and wallish(g.ch(ix, iz + 1)):
                axis = "z"
            else:
                continue
            # extend the run along the opening axis
            n = 0
            while True:
                jx, jz = (ix + n, iz) if axis == "x" else (ix, iz + n)
                if g.ch(jx, jz) != ch:
                    break
                seen.add((jx, jz))
                n += 1
            ys = sorted(y for _, y0, y1 in e["layers"] for y in (y0, y1))
            if e["kind"] == "door":
                y0, y1 = 0.0, min(l[1] for l in e["layers"])
            else:
                low = [l for l in e["layers"] if l[1] < 0.05][0]
                high = [l for l in e["layers"] if l[1] >= 0.05][0]
                y0, y1 = low[2], high[1]
            ox, oz = g.xz(ix, iz)
            if axis == "x":
                decor.append({"type": e["kind"], "axis": "x", "fixed": oz, "t": 1.0, "a": ox, "b": ox + n, "y0": y0, "y1": y1})
            else:
                decor.append({"type": e["kind"], "axis": "z", "fixed": ox, "t": 1.0, "a": oz, "b": oz + n, "y0": y0, "y1": y1})

    # ---- decor: facade windows on exposed faces of facade characters
    def open_at(ix, iz):
        if not (0 <= ix < g.W and 0 <= iz < g.R):
            return False
        c = g.full[iz][ix]
        e = legend.get(c)
        if e is None:
            return True
        if e["kind"]:
            return False
        return not any(y0 < 1.0 and y1 > 1.5 for _, y0, y1 in e["layers"])

    fw = 0
    for iz in range(g.R):
        for ix in range(g.W):
            ch = g.full[iz][ix]
            e = legend.get(ch)
            if not e or not e["facade"]:
                continue
            for dx, dz in ((0, -1), (0, 1), (-1, 0), (1, 0)):
                if not open_at(ix + dx, iz + dz):
                    continue
                along = ix if dz else iz
                if along % 3 != 1:
                    continue
                ax, az = (1, 0) if dz else (0, 1)
                if g.ch(ix - ax, iz - az) != ch or g.ch(ix + ax, iz + az) != ch:
                    continue
                if not (open_at(ix - ax + dx, iz - az + dz) and open_at(ix + ax + dx, iz + az + dz)):
                    continue
                ox, oz = g.xz(ix, iz)
                decor.append({"type": "fakewin", "x": ox + 0.5 + 0.5 * dx, "z": oz + 0.5 + 0.5 * dz, "nx": dx, "nz": dz,
                              "rows": [list(r) for r in e["facade"]]})
                fw += 1
    for p in patches:
        decor.append({"type": "patch", "x0": p[0], "x1": p[1], "z0": p[2], "z1": p[3], "mat": p[4]})

    spawns = {"A": [], "B": []}
    pickups = []
    for iz in range(g.R):
        for ix in range(g.W):
            ch = g.full[iz][ix]
            ox, oz = g.xz(ix, iz)
            c = (ox + 0.5, oz + 0.5)
            if ch == "A":
                spawns["A"].append({"x": c[0], "z": c[1], "yaw": 0.0})
            elif ch == "B":
                spawns["B"].append({"x": c[0], "z": c[1], "yaw": round(math.pi, 6)})
            elif ch in "RPS":
                pickups.append({"w": {"R": 0, "P": 1, "S": 3}[ch], "x": c[0], "z": c[1]})
    spawns["A"].sort(key=lambda s: (s["z"], s["x"]))
    spawns["B"].sort(key=lambda s: (-s["z"], -s["x"]))

    out = {"name": name, "bounds": {"minX": -hx, "maxX": hx, "minZ": -hz, "maxZ": hz}, "boxes": boxes,
           "spawns": spawns, "pickups": pickups, "decor": decor}
    problems = validate(out)
    print(f"{mid}: {len(boxes)} boxes, {len(decor)} decor ({fw} facade windows), spawns A/B {len(spawns['A'])}/{len(spawns['B'])}, "
          f"pickups {len(pickups)} (R {sum(p['w'] == 0 for p in pickups)}, P {sum(p['w'] == 1 for p in pickups)}, S {sum(p['w'] == 3 for p in pickups)})")
    for p in problems:
        print("  PROBLEM:", p)
    if png is None and os.environ.get("MAP_PNG_DIR"):
        png = os.path.join(os.environ["MAP_PNG_DIR"], f"{mid}.png")
    if png:
        render_png(out, png)
    if write:
        path = os.path.join(SHARED, f"map_{mid}.json")
        write_json(out, path)
        print("wrote", path)
    if problems:
        raise SystemExit(f"{mid}: validation failed")
    return out


def write_json(m, path):
    def dump(v):
        return json.dumps(v, separators=(",", ":"))

    lines = ["{", f' "name": {dump(m["name"])},', f' "bounds": {dump(m["bounds"])},', ' "boxes": [']
    lines += [f"  {dump(b)}" + ("," if i < len(m["boxes"]) - 1 else "") for i, b in enumerate(m["boxes"])]
    lines += [" ],", f' "spawns": {{"A": {dump(m["spawns"]["A"])},', f'  "B": {dump(m["spawns"]["B"])}}},', ' "pickups": [']
    lines += [f"  {dump(p)}" + ("," if i < len(m["pickups"]) - 1 else "") for i, p in enumerate(m["pickups"])]
    lines += [" ],", ' "decor": [']
    lines += [f"  {dump(d)}" + ("," if i < len(m["decor"]) - 1 else "") for i, d in enumerate(m["decor"])]
    lines += [" ]", "}"]
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


# ------------------------------------------------------------------------------------------------ validation
def _hits(boxes, x, y, z, hw=HALF_W, h=HEIGHT):
    for b in boxes:
        (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
        if x + hw > x0 and x - hw < x1 and y + h > y0 and y < y1 and z + hw > z0 and z - hw < z1:
            return True
    return False


def validate(m):
    """Returns a list of problems (empty = fine). Mirrors the Go BFS test and adds bot-friendliness checks."""
    probs = []
    bd = m["bounds"]
    boxes = m["boxes"]
    for t in ("A", "B"):
        if len(m["spawns"][t]) != 8:
            probs.append(f"team {t}: {len(m['spawns'][t])} spawns, want 8")
    if not 8 <= len(m["pickups"]) <= 10:
        probs.append(f"{len(m['pickups'])} pickups, want 8-10")
    if sum(p["w"] == 3 for p in m["pickups"]) != 2:
        probs.append("want exactly 2 snipers")
    pts = [("spawn " + t, s["x"], s["z"]) for t in ("A", "B") for s in m["spawns"][t]] + [("pickup", p["x"], p["z"]) for p in m["pickups"]]
    for what, x, z in pts:
        if not (bd["minX"] <= x <= bd["maxX"] and bd["minZ"] <= z <= bd["maxZ"]):
            probs.append(f"{what} ({x},{z}) out of bounds")
        if _hits(boxes, x, 0.0, z):
            probs.append(f"{what} ({x},{z}) inside geometry")
    # ---- same walk model as maps_test.go (0.4 m grid, <= 1 m obstacles are stepped onto by jumping)
    step = 0.4
    nx = int((bd["maxX"] - bd["minX"]) / step) + 1
    nz = int((bd["maxZ"] - bd["minZ"]) / step) + 1
    near = {}

    def free(ix, iz):
        if ix < 0 or iz < 0 or ix >= nx or iz >= nz:
            return False
        x, z = bd["minX"] + ix * step, bd["minZ"] + iz * step
        ys = [0.0]
        for b in boxes:
            (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
            if y1 <= 1.0 and x + HALF_W > x0 and x - HALF_W < x1 and z + HALF_W > z0 and z - HALF_W < z1:
                ys.append(y1)
        return any(not _hits(boxes, x, y, z) for y in ys)

    cache = {}

    def cfree(ix, iz):
        k = (ix, iz)
        if k not in cache:
            cache[k] = free(ix, iz)
        return cache[k]

    a0 = m["spawns"]["A"][0]
    s = (int((a0["x"] - bd["minX"]) / step), int((a0["z"] - bd["minZ"]) / step))
    seen = {s}
    q = [s]
    while q:
        cx, cz = q.pop()
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (cx + dx, cz + dz)
            if n not in seen and cfree(*n):
                seen.add(n)
                q.append(n)
    for what, x, z in pts:
        ix, iz = int((x - bd["minX"]) / step), int((z - bd["minZ"]) / step)
        if not any((ix + dx, iz + dz) in seen for dx in (-1, 0, 1) for dz in (-1, 0, 1)):
            probs.append(f"{what} ({x},{z}) not reachable (Go-test model)")
    # ---- bot-style: no jumping, route >= 1.6 m wide (clearance 0.8 m on every side; sampled every 0.25 m)
    st = 0.25
    cl = 0.8
    nx2 = int((bd["maxX"] - bd["minX"]) / st)
    nz2 = int((bd["maxZ"] - bd["minZ"]) / st)
    solid = [[False] * nx2 for _ in range(nz2)]
    for b in boxes:
        (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
        if y0 >= HEIGHT:
            continue
        ia = max(0, int(math.floor((x0 - cl - bd["minX"]) / st)))
        ib = min(nx2 - 1, int(math.ceil((x1 + cl - bd["minX"]) / st)))
        ja = max(0, int(math.floor((z0 - cl - bd["minZ"]) / st)))
        jb = min(nz2 - 1, int(math.ceil((z1 + cl - bd["minZ"]) / st)))
        for j in range(ja, jb + 1):
            zc = bd["minZ"] + (j + 0.5) * st
            if not (zc + cl > z0 and zc - cl < z1):
                continue
            row = solid[j]
            for i in range(ia, ib + 1):
                xc = bd["minX"] + (i + 0.5) * st
                if xc + cl > x0 and xc - cl < x1:
                    row[i] = True

    def cell2(x, z):
        return int((x - bd["minX"]) / st), int((z - bd["minZ"]) / st)

    # BFS from every spawn/pickup region start; require all points in ONE component using the wide-route model
    comp = {}
    def flood(start):
        seen2 = {start}
        q2 = [start]
        while q2:
            cx, cz = q2.pop()
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nxc, nzc = cx + dx, cz + dz
                if 0 <= nxc < nx2 and 0 <= nzc < nz2 and not solid[nzc][nxc] and (nxc, nzc) not in seen2:
                    seen2.add((nxc, nzc))
                    q2.append((nxc, nzc))
        return seen2

    start = None
    for what, x, z in pts:
        c = cell2(x, z)
        if not solid[c[1]][c[0]]:
            start = c
            break
    if start is None:
        probs.append("bot model: no spawn/pickup has 0.8 m clearance")
        return probs
    reach = flood(start)
    for what, x, z in pts:
        c = cell2(x, z)
        if not any((c[0] + dx, c[1] + dz) in reach for dx in range(-6, 7) for dz in range(-6, 7)):
            probs.append(f"{what} ({x},{z}) not reachable by a >= 1.6 m wide route (bot model)")
    return probs


# ------------------------------------------------------------------------------------------------ top-down PNG
_PAL = {"outer": (60, 60, 70)}


def _colour(mat):
    if mat in _PAL:
        return _PAL[mat]
    h = sum(ord(c) * (i + 3) for i, c in enumerate(mat))
    c = ((h * 53) % 160 + 60, (h * 97) % 160 + 60, (h * 31) % 160 + 60)
    _PAL[mat] = c
    return c


def render_png(m, path, px=10):
    from PIL import Image, ImageDraw
    bd = m["bounds"]
    W, H = int((bd["maxX"] - bd["minX"] + 2) * px), int((bd["maxZ"] - bd["minZ"] + 2) * px)
    im = Image.new("RGB", (W, H), (225, 225, 215))
    d = ImageDraw.Draw(im)

    def P(x, z):
        return ((x - bd["minX"] + 1) * px, (z - bd["minZ"] + 1) * px)

    for b in sorted(m["boxes"], key=lambda b: b["max"][1]):
        c = _colour(b["mat"])
        hgt = b["max"][1]
        sh = min(1.0, 0.45 + 0.15 * hgt) if b["min"][1] < 0.05 else 0.55
        col = tuple(int(v * sh) for v in c)
        if b["min"][1] > 0.05:
            col = (col[0] // 2 + 120, col[1] // 2 + 120, col[2] // 2 + 120)
        (x0, _, z0), (x1, _, z1) = b["min"], b["max"]
        d.rectangle([*P(x0, z0), *P(x1, z1)], fill=col, outline=(20, 20, 20))
    for t, colr in (("A", (230, 40, 40)), ("B", (40, 90, 240))):
        for s in m["spawns"][t]:
            x, z = P(s["x"], s["z"])
            d.ellipse([x - 3, z - 3, x + 3, z + 3], fill=colr)
    for p in m["pickups"]:
        x, z = P(p["x"], p["z"])
        colr = {0: (255, 140, 0), 1: (255, 255, 0), 3: (200, 0, 255)}[p["w"]]
        d.rectangle([x - 4, z - 4, x + 4, z + 4], fill=colr, outline=(0, 0, 0))
    im.save(path)


