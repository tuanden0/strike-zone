"""Generic Blender kit for the grid-authored maps -> client/assets/models/map_<id>.glb

Reads client/shared/map_<id>.json (collision boxes + visual-only "decor", written by gen_<id>_map.py) and builds one prop
per collision box, so visuals == collision (nothing but thin trim and decor above head height leaves its box).
A map script (piazza_kit.py ...) only supplies a THEME: materials, the floor, and a style per box `mat` name.

    python tools/assets/gen_piazza_map.py && /tmp/bpyenv/bin/python tools/assets/piazza_kit.py [--no-preview]

Styles (theme["styles"][mat] = dict(kind=..., ...)):
    slab       textured body (uv tiles/m) + optional plinth (mat, h) and cap (mat, h) bands; lintels get the cap only
    crate      1 m wooden crates (per 1 x 1 x 1 unit): body, corner posts, top/bottom rails
    container  corrugated shipping container (texture ribs) with steel frame, stacked per 2.6 m
    pillar     1 m square pillar per cell: base, shaft, capital
    stall      market stall counter + posts and a striped awning (awning is above head height)
    water      flat water slab
Coordinates: map (x, y, z) is built at Blender (x, -z, y); the glTF exporter turns that back into y-up.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403
import common  # noqa: E402


def place(part, loc=(0, 0, 0)):
    bmesh.ops.transform(part, matrix=Matrix.Translation(Vector(loc)), verts=part.verts)
    return part


class ThemeKit:
    def __init__(self, mid, theme):
        fresh()
        self.mid = mid
        self.M = json.load(open(os.path.join(ROOT, "client", "shared", f"map_{mid}.json")))
        self.theme = theme
        self.b = Builder("map")
        for name, kw in theme["mats"].items():
            material(name, **kw)

    # ------------------------------------------------------------------ primitives (map coordinates)
    def cub(self, x0, x1, z0, z1, y0, y1, mat, uv=(1.0, 1.0), bevel=0.0):
        part = box((x1 - x0, z1 - z0, y1 - y0), ((x0 + x1) / 2, -(z0 + z1) / 2, (y0 + y1) / 2), bevel=bevel, segs=1)
        if y0 < 0.02 and y1 - y0 > 0.02:  # floor-standing: the bottom face can never be seen
            bmesh.ops.delete(part, geom=[f for f in part.faces if f.normal.z < -0.9], context="FACES_ONLY")
        self.b.add(part, mat, uv=uv)

    def quad(self, pts, normal, mat, uv=(1.0, 1.0)):
        """Single flat quad from 4 map-space points (x, y, z); wound so that it faces `normal` (map space)."""
        bm = bmesh.new()
        vs = [bm.verts.new((x, -z, y)) for x, y, z in pts]
        n = Vector(((vs[1].co - vs[0].co).cross(vs[2].co - vs[1].co)))
        want = Vector((normal[0], -normal[2], normal[1]))
        if n.dot(want) < 0:
            vs.reverse()
        bm.faces.new(vs)
        self.b.add(bm, mat, uv=uv)

    # ------------------------------------------------------------------ box styles
    def slab(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        h = y1 - y0
        uv = st.get("uv", (1.0, 1.0))
        plinth, cap = st.get("plinth"), st.get("cap")
        has_p = plinth and y0 < 0.05 and h > 1.6
        has_c = cap and y1 >= 3.0 and h > 0.6
        ins = 0.04 if (has_p or has_c) and min(x1 - x0, z1 - z0) > 0.3 else 0.0
        ph = plinth[1] if has_p else 0.0
        ch = cap[1] if has_c else 0.0
        top_h = st["top"][1] if st.get("top") else 0.0
        # thin boxes get no inset: then the body must stop at the bands, or its faces overlap theirs (z-fighting)
        b0 = y0 if ins else y0 + ph
        b1 = y1 - (0.02 if has_c and ins else ch) - top_h
        self.cub(x0 + ins, x1 - ins, z0 + ins, z1 - ins, b0, b1, st["mat"], uv, bevel=st.get("bevel", 0.0))
        if has_p:
            self.cub(x0, x1, z0, z1, y0, y0 + ph, plinth[0], st.get("plinth_uv", (0.5, 0.5)))
        if has_c:
            self.cub(x0, x1, z0, z1, y1 - ch, y1, cap[0], st.get("cap_uv", (0.5, 0.5)))
        if st.get("top"):  # separate top surface (e.g. a lighter paving slab flush with the box)
            self.cub(x0, x1, z0, z1, y1 - st["top"][1], y1, st["top"][0], st.get("top_uv", (0.5, 0.5)))

    def crate(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        nx, nz, nh = max(1, round(x1 - x0)), max(1, round(z1 - z0)), max(1, round((y1 - y0) / 1.0))
        if st.get("whole"):  # one big crate (forklift-size) instead of 1 m units
            nx = nz = nh = 1
        ux, uz, uh = (x1 - x0) / nx, (z1 - z0) / nz, (y1 - y0) / nh
        mat, rail = st["mat"], st.get("rail", st["mat"])
        p = st.get("post", 0.1)
        for i in range(nx):
            for k in range(nz):
                for j in range(nh):
                    a0, a1 = x0 + i * ux, x0 + (i + 1) * ux
                    b0, b1 = z0 + k * uz, z0 + (k + 1) * uz
                    c0, c1 = y0 + j * uh, y0 + (j + 1) * uh
                    self.cub(a0 + 0.02, a1 - 0.02, b0 + 0.02, b1 - 0.02, c0, c1 - p * 0.5, mat, (1.0, 1.0))
                    for sx in (a0, a1 - p):
                        for sz in (b0, b1 - p):
                            self.cub(sx, sx + p, sz, sz + p, c0, c1, rail, (2.0, 2.0))
                    self.cub(a0, a1, b0, b1, c1 - p, c1, rail, (2.0, 2.0))  # lid frame (flush)

    def container(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        nh = max(1, round((y1 - y0) / 2.6))
        uh = (y1 - y0) / nh
        long_x = (x1 - x0) >= (z1 - z0)
        mat, steel = st["mat"], st.get("steel", "steel")
        uv = st.get("uv", (1.0, 0.4))
        pst = 0.11
        for j in range(nh):
            c0, c1 = y0 + j * uh, y0 + (j + 1) * uh
            ins = 0.03
            self.cub(x0 + ins, x1 - ins, z0 + ins, z1 - ins, c0, c1 - 0.02, mat, uv)
            # corner posts + top/bottom rails along the long sides (flush with the collision box)
            for sx in (x0, x1 - pst):
                for sz in (z0, z1 - pst):
                    self.cub(sx, sx + pst, sz, sz + pst, c0, c1, steel, (2.0, 2.0))
            for yy in (c0, c1 - pst * 0.8):
                if long_x:
                    self.cub(x0 + pst, x1 - pst, z0, z0 + pst, yy, yy + pst * 0.8, steel, (2.0, 2.0))
                    self.cub(x0 + pst, x1 - pst, z1 - pst, z1, yy, yy + pst * 0.8, steel, (2.0, 2.0))
                else:
                    self.cub(x0, x0 + pst, z0 + pst, z1 - pst, yy, yy + pst * 0.8, steel, (2.0, 2.0))
                    self.cub(x1 - pst, x1, z0 + pst, z1 - pst, yy, yy + pst * 0.8, steel, (2.0, 2.0))

    def pillar(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        mat, trim = st["mat"], st.get("trim", st["mat"])
        for i in range(max(1, round(x1 - x0))):
            for k in range(max(1, round(z1 - z0))):
                a0, b0 = x0 + i, z0 + k
                a1, b1 = a0 + 1, b0 + 1
                self.cub(a0, a1, b0, b1, y0, y0 + 0.35, trim, (0.5, 0.5))
                self.cub(a0 + 0.1, a1 - 0.1, b0 + 0.1, b1 - 0.1, y0 + 0.35, y1 - 0.35, mat, st.get("uv", (1.0, 1.0)))
                self.cub(a0, a1, b0, b1, y1 - 0.35, y1, trim, (0.5, 0.5))

    def stall(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        h = y1 - y0
        self.cub(x0, x1, z0, z1, y0, y1 - 0.06, st["mat"], (1.0, 1.0))
        self.cub(x0, x1, z0, z1, y1 - 0.06, y1, st.get("top", st["mat"]), (1.0, 1.0))
        # posts + awning above the counter (visual only, above head height except for the thin posts inside the footprint)
        long_x = (x1 - x0) >= (z1 - z0)
        ph = 2.55
        if long_x:
            for xx in (x0 + 0.08, x1 - 0.08):
                self.cub(xx - 0.04, xx + 0.04, z0 + 0.05, z0 + 0.13, y1, ph, st["mat"], (1.0, 1.0))
            n = max(2, round((x1 - x0) / 0.5))
            for i in range(n):
                xa = x0 - 0.3 + (x1 - x0 + 0.6) * i / n
                xb = x0 - 0.3 + (x1 - x0 + 0.6) * (i + 1) / n
                self.cub(xa, xb, z0 - 0.35, z1 + 0.35, ph, ph + 0.07, st["awning_a"] if i % 2 == 0 else st["awning_b"], (1.0, 1.0))
        else:
            for zz in (z0 + 0.08, z1 - 0.08):
                self.cub(x0 + 0.05, x0 + 0.13, zz - 0.04, zz + 0.04, y1, ph, st["mat"], (1.0, 1.0))
            n = max(2, round((z1 - z0) / 0.5))
            for i in range(n):
                za = z0 - 0.3 + (z1 - z0 + 0.6) * i / n
                zb = z0 - 0.3 + (z1 - z0 + 0.6) * (i + 1) / n
                self.cub(x0 - 0.35, x1 + 0.35, za, zb, ph, ph + 0.07, st["awning_a"] if i % 2 == 0 else st["awning_b"], (1.0, 1.0))

    def water(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        self.cub(x0, x1, z0, z1, y0, y1, st["mat"], (1.0, 1.0))

    # ------------------------------------------------------------------ decor
    def frame(self, d):
        t = d["t"]
        a, b, y0, y1 = d["a"], d["b"], d["y0"], d["y1"]
        fw = 0.12
        mat = self.theme.get("frame", "steel")
        bars = {"l": (a, a + fw, y0, y1), "r": (b - fw, b, y0, y1), "t": (a, b, y1 - fw, y1), "b": (a, b, y0, y0 + fw * 0.8)}
        for nm, (c0, c1, v0, v1) in bars.items():
            if nm == "b" and d["type"] == "door":
                continue
            if d["axis"] == "x":
                self.cub(c0, c1, d["fixed"] - 0.015, d["fixed"] + t + 0.015, v0, v1, mat, (1.0, 1.0))
            else:
                self.cub(d["fixed"] - 0.015, d["fixed"] + t + 0.015, c0, c1, v0, v1, mat, (1.0, 1.0))

    def fakewin(self, d):
        mat = self.theme.get("frame", "steel")
        glass = self.theme.get("glass", "glass")
        shut = self.theme.get("shutter")
        nx, nz = d["nx"], d["nz"]
        w = 0.5  # half width along the face
        ax, az = (1.0, 0.0) if nz else (0.0, 1.0)
        for y0, y1 in d["rows"]:
            cx, cz = d["x"], d["z"]
            # frame: one thin box proud of the wall by 5 cm
            if nz:
                za, zb = sorted((cz, cz + nz * 0.05))
                self.cub(cx - w, cx + w, za, zb, y0 - 0.08, y1 + 0.08, mat, (1.0, 1.0))
            else:
                xa, xb = sorted((cx, cx + nx * 0.05))
                self.cub(xa, xb, cz - w, cz + w, y0 - 0.08, y1 + 0.08, mat, (1.0, 1.0))
            off = 0.052

            def face(half, along, v0, v1, m):
                px, pz = cx + nx * off + ax * along, cz + nz * off + az * along
                pts = [(px - ax * half, v0, pz - az * half), (px + ax * half, v0, pz + az * half),
                       (px + ax * half, v1, pz + az * half), (px - ax * half, v1, pz - az * half)]
                self.quad(pts, (nx, 0.0, nz), m)
            face(w - 0.1, 0.0, y0, y1, glass)
            if shut:
                for s_ in (-1, 1):
                    face(0.15, s_ * (w + 0.15), y0 - 0.08, y1 + 0.08, shut)

    def patch(self, d):
        st = self.theme["patches"][d["mat"]]
        y = 0.012  # one flat quad just above the floor
        pts = [(d["x0"], y, d["z0"]), (d["x1"], y, d["z0"]), (d["x1"], y, d["z1"]), (d["x0"], y, d["z1"])]
        self.quad(pts, (0.0, 1.0, 0.0), st["mat"], st.get("uv", (0.5, 0.5)))

    # ------------------------------------------------------------------ build
    def floor(self):
        bd = self.M["bounds"]
        f = self.theme["floor"]
        self.cub(bd["minX"] - 1, bd["maxX"] + 1, bd["minZ"] - 1, bd["maxZ"] + 1, -0.2, 0.0, f["mat"], f.get("uv", (0.5, 0.5)))

    def build(self):
        self.floor()
        for d in self.M["decor"]:
            if d["type"] == "patch":
                self.patch(d)
        stat = {}

        def count(key, t0):
            stat[key] = stat.get(key, 0) + self.b.tris() - t0

        for bx in self.M["boxes"]:
            st = self.theme["styles"][bx["mat"]]
            t0 = self.b.tris()
            getattr(self, st["kind"])(bx["min"], bx["max"], st)
            count(bx["mat"], t0)
        for d in self.M["decor"]:
            t0 = self.b.tris()
            if d["type"] in ("door", "window"):
                self.frame(d)
            elif d["type"] == "fakewin":
                self.fakewin(d)
            count("decor:" + d["type"], t0)
        print("TRIS by style:", ", ".join(f"{k}={v}" for k, v in sorted(stat.items(), key=lambda kv: -kv[1])))
        return self.b.build()


def run(mid, theme, previews=(), kit=ThemeKit):
    """Build, export map_<mid>.glb and (unless --no-preview) render previews: [(label, az, el, focus, dist)].
    kit: a ThemeKit subclass that adds box styles of its own (a method per style kind)."""
    k = kit(mid, theme)
    ob = k.build()
    path, size = export_glb(f"map_{mid}", [ob])
    print(f"RESULT map_{mid}.glb tris={tri_count([ob])} bytes={size} ({size / 1048576:.2f} MB)")
    if not NO_PREVIEW:
        for label, az, el, focus, dist in previews:
            render_previews(f"{mid}", [ob], views=[(label, az, el)], size=(1000, 640), samples=24, focus=focus, dist=dist)
    return ob
