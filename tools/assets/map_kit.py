"""Map visuals -> client/assets/models/map.glb

Reads client/shared/map.json (the collision source of truth) and builds one detailed, bevelled prop per
collision box so visuals match collision exactly (nothing protrudes outside its box except wall lamps
well above head height). Run: `blender -b -P tools/assets/map_kit.py` (or python with the bpy module).

Coordinates: map.json is three.js space (x right, y up, z toward viewer); Blender is Z-up, and the glTF
exporter maps Blender (x, y, z) -> glTF (x, z, -y). So a map point (x, y, z) is built at Blender (x, -z, y).
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403
import common  # noqa: E402

M = json.load(open(os.path.join(ROOT, "client", "shared", "map.json")))


def place(part, loc=(0, 0, 0), rot_z=0.0):
    """Rotate about Z (degrees) then translate: local frame -> Blender world."""
    bmesh.ops.transform(part, matrix=Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(rot_z), 4, "Z"), verts=part.verts)
    return part


class Kit:
    def __init__(self):
        fresh()
        self.b = Builder("map")
        material("concrete", tex="concrete", color=(1, 1, 1, 1))
        material("outer_panel", tex="outer_panel")
        material("wood", tex="wood")
        material("container_a", tex="container_metal")
        material("container_b", tex="container_metal", color=(0.55, 0.85, 1.55, 1))
        material("container_c", tex="container_metal", color=(1.7, 0.62, 0.5, 1))
        material("burlap", tex="burlap")
        material("steel", tex="steel")
        material("floor_tile", tex="floor_tile")
        material("lamp_glow", color=(1, 0.85, 0.55, 1), roughness=0.4, emission=(1, 0.8, 0.45, 1), emission_strength=6.0)

    def add(self, part, mat, uv=(1.0, 1.0), loc=(0, 0, 0), rot_z=0.0):
        place(part, loc, rot_z)
        self.b.add(part, mat, uv=uv)

    # ---------------------------------------------------------------- props (local frame: centre-bottom origin)
    def lamp(self, loc, rot_z, glow=True):
        """Cage work-lamp bracketed to a wall; local +Y points away from the wall."""
        self.add(box((0.05, 0.22, 0.05), (0, 0.11, 0), bevel=0.008, segs=1), "steel", loc=loc, rot_z=rot_z)
        self.add(cyl(0.1, 0.1, 0.2, (0, 0.24, 0), (90, 0, 0), 10, bevel=0.01), "steel", loc=loc, rot_z=rot_z)
        self.add(sphere(0.075, (1, 1, 1), (0, 0.24, -0.12), segs=8, rings=6), "lamp_glow", loc=loc, rot_z=rot_z)
        for a in (0, 60, 120):  # cage bars
            self.add(box((0.012, 0.012, 0.2), (0, 0.24, -0.12), (0, 0, a), segs=1), "steel", loc=loc, rot_z=rot_z)
        self.add(cyl(0.11, 0.11, 0.015, (0, 0.24, -0.23), (90, 0, 0), 10), "steel", loc=loc, rot_z=rot_z)

    def barrier_wall(self, cx, cz, w, h, d):
        """Concrete barrier wall (tall divider)."""
        L, T = (d, w) if d >= w else (w, d)
        rz = 0 if d >= w else 90  # local long axis = Blender Y when rz=0
        loc = (cx, -cz, 0)
        base = 0.45
        cap = 0.28
        ins = 0.03
        # plinth, core, cap are flush with the collision box; panels sit 3 cm proud of the core inside it.
        self.add(box((T, L, base), (0, 0, base / 2), bevel=0.035), "concrete", (0.5, 0.5), loc, rz)
        self.add(box((T, L, cap), (0, 0, h - cap / 2), bevel=0.04), "concrete", (0.5, 0.5), loc, rz)
        self.add(box((T - 2 * ins, L - 2 * ins, h - base - cap + 0.02), (0, 0, base + (h - base - cap) / 2), bevel=0.0), "concrete", (0.5, 0.5), loc, rz)
        n = max(1, round(L / 2.5))
        pl = (L - 2 * ins) / n
        for i in range(n):  # panels with expansion joints between them
            y = -L / 2 + ins + pl * (i + 0.5)
            self.add(box((T - 0.01, pl - 0.05, h - base - cap), (0, y, base + (h - base - cap) / 2), bevel=0.02), "concrete", (0.5, 0.5), loc, rz)
        # lamps on both faces, high above head height
        for i in range(2):
            y = -L / 4 + i * L / 2
            side = 1 if i == 0 else -1
            self.lamp(Vector(loc) + Vector((0, 0, h - 0.7)) + Vector(Matrix.Rotation(math.radians(rz), 3, "Z") @ Vector((side * T / 2, y, 0))), rz + (-90 if side > 0 else 90))

    def sandbags(self, cx, cz, w, h, d, seed):
        rnd = random.Random(seed)
        L, T = (w, d) if w >= d else (d, w)
        rz = 0 if w >= d else 90  # long axis local X
        loc = (cx, -cz, 0)
        rows = max(2, round(h / 0.2))
        rh = h / rows
        layer = T / 2
        n = max(2, round(L / 0.5))
        bw = L / n
        # hidden filler core keeps the silhouette solid
        self.add(box((L - 0.06, T - 0.1, h - 0.04), (0, 0, h / 2), bevel=0.0), "burlap", (1, 1), loc, rz)
        for r in range(rows):
            z0 = r * rh
            odd = r % 2 == 1
            counts = n - 1 if odd else n
            for side in (-1, 1):
                for i in range(counts):
                    if odd:
                        x0 = -L / 2 + bw * (i + 1)
                        width = bw
                    else:
                        x0 = -L / 2 + bw * (i + 0.5)
                        width = bw
                    sx = width * rnd.uniform(0.95, 1.0)
                    sz = rh * rnd.uniform(0.9, 1.0)
                    yy = side * (T / 2 - layer / 2)
                    p = box((sx, layer * rnd.uniform(0.96, 1.0), sz), (x0, yy, z0 + rh / 2), (0, 0, rnd.uniform(-3, 3)), bevel=min(sz, sx) * 0.3, segs=1)
                    self.add(p, "burlap", (1.2, 1.2), loc, rz)
            if odd:  # half bags close the ends of the running bond
                for side in (-1, 1):
                    for x0 in (-L / 2 + bw * 0.25, L / 2 - bw * 0.25):
                        yy = side * (T / 2 - layer / 2)
                        self.add(box((bw / 2, layer, rh * 0.95), (x0, yy, z0 + rh / 2), bevel=rh * 0.28, segs=1), "burlap", (1.2, 1.2), loc, rz)
        # top row of bags lying across the thickness
        top = h
        for i in range(n):
            x0 = -L / 2 + bw * (i + 0.5)
            self.add(box((bw * 0.97, T * 0.98, 0.06), (x0, 0, top - 0.03), bevel=0.02, segs=1), "burlap", (1.2, 1.2), loc, rz)

    def wood_crate(self, cx, cz, w, h, d, y0=0.0):
        loc = (cx, -cz, y0)
        W, D, H = w, d, h  # Blender X = map x, Blender Y = map -z
        p = 0.09
        e = 0.008
        uv = (1.0, 1.0)
        for sx in (-1, 1):
            for sy in (-1, 1):
                self.add(box((p, p, H), (sx * (W / 2 - p / 2), sy * (D / 2 - p / 2), H / 2), bevel=e, segs=1), "wood", uv, loc)
        for z in (p / 2, H - p / 2):  # top and bottom rails
            for sy in (-1, 1):
                self.add(box((W - 2 * p, p, p), (0, sy * (D / 2 - p / 2), z), bevel=e, segs=1), "wood", uv, loc)
            for sx in (-1, 1):
                self.add(box((p, D - 2 * p, p), (sx * (W / 2 - p / 2), 0, z), bevel=e, segs=1), "wood", uv, loc)
        rec = 0.025
        for sy in (-1, 1):  # recessed panels + diagonal brace
            self.add(box((W - 2 * p + 0.02, 0.035, H - 2 * p + 0.02), (0, sy * (D / 2 - rec - 0.0175), H / 2), bevel=0), "wood", uv, loc)
            iw, ih = W - 2 * p, H - 2 * p
            ang = math.degrees(math.atan2(ih, iw))
            ln = math.hypot(iw, ih) * 0.98
            br = box((ln, 0.04, 0.11), (0, sy * (D / 2 - rec - 0.003), H / 2), (0, 0, 0), bevel=0.006, segs=1)
            bmesh.ops.rotate(br, cent=Vector((0, sy * (D / 2 - rec), H / 2)), matrix=Matrix.Rotation(math.radians(ang), 3, "Y"), verts=br.verts)
            self.add(br, "wood", uv, loc)
        for sx in (-1, 1):
            self.add(box((0.035, D - 2 * p + 0.02, H - 2 * p + 0.02), (sx * (W / 2 - rec - 0.0175), 0, H / 2), bevel=0), "wood", uv, loc)
            iw, ih = D - 2 * p, H - 2 * p
            ang = math.degrees(math.atan2(ih, iw))
            ln = math.hypot(iw, ih) * 0.98
            br = box((0.04, ln, 0.11), (sx * (W / 2 - rec - 0.003), 0, H / 2), bevel=0.006, segs=1)
            bmesh.ops.rotate(br, cent=Vector((sx * (W / 2 - rec), 0, H / 2)), matrix=Matrix.Rotation(math.radians(-ang), 3, "X"), verts=br.verts)
            self.add(br, "wood", uv, loc)
        # lid planks (slightly below the rail tops so the rails read as a frame)
        planks = max(2, round(D / 0.25))
        pd = (D - 2 * p) / planks
        for i in range(planks):
            self.add(box((W - 2 * p + 0.01, pd - 0.012, 0.05), (0, -D / 2 + p + pd * (i + 0.5), H - 0.03), bevel=0.006, segs=1), "wood", uv, loc)
        # steel corner brackets on the top corners
        for sx in (-1, 1):
            for sy in (-1, 1):
                self.add(box((p + 0.002, p + 0.002, 0.012), (sx * (W / 2 - p / 2), sy * (D / 2 - p / 2), H - 0.006), bevel=0.003, segs=1), "steel", (2, 2), loc)

    def container(self, cx, cz, w, h, d, mat):
        long_x = w >= d
        L, T = (w, d) if long_x else (d, w)
        rz = -90 if long_x else 0  # local Y is the long axis
        loc = (cx, -cz, 0)
        H = h
        post = 0.1
        depth = 0.03
        pitch = 0.12
        self.add(box((T - 2 * depth, L - 0.04, H - 0.04), (0, 0, H / 2), bevel=0), mat, (1, 1), loc, rz)
        # corrugated long sides: trapezoid ribs; outer peaks are flush with the collision box
        z0, z1 = post * 0.4, H - post * 0.4
        ys = []
        y = -L / 2 + post
        while y < L / 2 - post - 1e-6:
            for t, dv in ((0.0, 0.0), (0.1, 0.0), (0.4, 1.0), (0.6, 1.0), (0.9, 0.0)):
                yy = y + t * pitch
                if yy < L / 2 - post:
                    ys.append((yy, dv))
            y += pitch
        ys.append((L / 2 - post, 0.0))
        for side in (-1, 1):
            bm = bmesh.new()
            bot = [bm.verts.new((side * (T / 2 - depth * dv), yy, z0)) for yy, dv in ys]
            top = [bm.verts.new((side * (T / 2 - depth * dv), yy, z1)) for yy, dv in ys]
            for k in range(len(ys) - 1):
                quad = (bot[k], bot[k + 1], top[k + 1], top[k])
                bm.faces.new(quad if side > 0 else quad[::-1])
            self.add(bm, mat, (1, 1), loc, rz)
        # frame: posts, rails (flush with collision box)
        for sx in (-1, 1):
            for sy in (-1, 1):
                self.add(box((post, post, H), (sx * (T / 2 - post / 2), sy * (L / 2 - post / 2), H / 2), bevel=0.012, segs=1), "steel", (2, 2), loc, rz)
        for z in (post * 0.4, H - post * 0.4):
            for sx in (-1, 1):
                self.add(box((post, L - 2 * post, post * 0.8), (sx * (T / 2 - post / 2), 0, z), bevel=0.01, segs=1), "steel", (2, 2), loc, rz)
            for sy in (-1, 1):
                self.add(box((T - 2 * post, post, post * 0.8), (0, sy * (L / 2 - post / 2), z), bevel=0.01, segs=1), "steel", (2, 2), loc, rz)
        # roof
        self.add(box((T - 0.04, L - 0.04, 0.05), (0, 0, H - 0.025), bevel=0.01, segs=1), mat, (1, 1), loc, rz)
        # door end (+Y local): two leaves, locking rods, handles
        for lx in (-1, 1):
            self.add(box((T / 2 - post - 0.02, 0.035, H - 0.2), (lx * (T / 4), L / 2 - 0.03, H / 2), bevel=0.008, segs=1), mat, (1, 1), loc, rz)
            for k in (-0.3, 0.3):
                self.add(cyl(0.014, 0.014, H - 0.24, (lx * (T / 4) + k * (T / 4) * 0.8, L / 2 - 0.005, H / 2), (0, 0, 0), 6), "steel", (2, 2), loc, rz)
                self.add(box((0.07, 0.025, 0.03), (lx * (T / 4) + k * (T / 4) * 0.8, L / 2 - 0.005, H * 0.45), bevel=0.004, segs=1), "steel", (2, 2), loc, rz)
        self.add(box((T - 2 * post, 0.03, H - 2 * post * 0.5), (0, -L / 2 + 0.03, H / 2), bevel=0), mat, (1, 1), loc, rz)  # blind end

    def outer_wall(self, minx, maxx, minz, maxz, h):
        """Perimeter wall: visual slab sits behind the collision face; pilasters/doors fill up to it."""
        Lx, Lz = maxx - minx, maxz - minz
        if Lx >= Lz:  # north / south walls
            L, T = Lx, Lz
            cx = (minx + maxx) / 2
            if (minz + maxz) / 2 < 0:  # north: collision inner face at z=maxz (map) => Blender y = -maxz, outside = +y
                loc, rz = (cx, -maxz, 0), 0
            else:
                loc, rz = (cx, -minz, 0), 180
        else:
            L, T = Lz, Lx
            cz = (minz + maxz) / 2
            if (minx + maxx) / 2 > 0:  # east: inner face at x=minx, outside +x
                loc, rz = (minx, -cz, 0), -90
            else:
                loc, rz = (maxx, -cz, 0), 90
        recess = 0.24
        tv = T - recess
        # slab: local x along length, local y outward from inner face (y=0 is the collision face)
        self.add(box((L, tv, h), (0, recess + tv / 2, h / 2), bevel=0.03), "outer_panel", (1 / 4, 1 / 6), loc, rz)
        self.add(box((L, tv + 0.0, 0.3), (0, recess + tv / 2, h - 0.15), bevel=0.05), "concrete", (0.5, 0.5), loc, rz)
        # pilasters every 6 m, flush with the collision face
        n = int(L // 6)
        for i in range(n + 1):
            x = -L / 2 + 3 + i * (L - 6) / max(n, 1) if n else 0
            self.add(box((0.5, recess + 0.02, h - 0.3), (x, (recess + 0.02) / 2, (h - 0.3) / 2), bevel=0.03), "concrete", (0.5, 0.5), loc, rz)
            self.add(box((0.56, recess + 0.02, 0.18), (x, (recess + 0.02) / 2, h - 0.39), bevel=0.03), "concrete", (0.5, 0.5), loc, rz)
        # doors at +-14 m (skip on the short side walls which also get one)
        for dx in (-L / 2 + 6.5, L / 2 - 6.5):
            dw, dh = 1.5, 2.5
            self.add(box((dw + 0.2, recess + 0.02, 0.14), (dx, (recess + 0.02) / 2, dh + 0.07), bevel=0.02), "steel", (1, 1), loc, rz)
            for s in (-1, 1):
                self.add(box((0.1, recess + 0.02, dh), (dx + s * (dw / 2 + 0.05), (recess + 0.02) / 2, dh / 2), bevel=0.02), "steel", (1, 1), loc, rz)
            leaf = box((dw, 0.05, dh), (dx, recess - 0.03, dh / 2), bevel=0.01, segs=1)
            self.add(leaf, "container_b", (1, 1), loc, rz)
            for k in (0.3, 0.75):  # raised panels
                self.add(box((dw * 0.7, 0.03, dh * 0.3), (dx, recess - 0.07, dh * k), bevel=0.008, segs=1), "container_b", (1, 1), loc, rz)
            self.add(box((0.05, 0.05, 0.2), (dx + dw * 0.35, recess - 0.08, 1.05), bevel=0.01, segs=1), "steel", (4, 4), loc, rz)
            self.lamp(Vector(loc) + Matrix.Rotation(math.radians(rz), 3, "Z") @ Vector((dx, 0.0, dh + 0.55)), rz + 180)

    def floor(self):
        bd = M["bounds"]
        w, d = bd["maxX"] - bd["minX"], bd["maxZ"] - bd["minZ"]
        self.add(box((w + 1, d + 1, 0.2), ((bd["minX"] + bd["maxX"]) / 2, -(bd["minZ"] + bd["maxZ"]) / 2, -0.1), bevel=0), "floor_tile", (0.25, 0.25))


def build():
    k = Kit()
    k.floor()
    crate_i = 0
    for i, bx in enumerate(M["boxes"]):
        mn, mx = bx["min"], bx["max"]
        w, h, d = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
        cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
        m = bx["mat"]
        if m == "outer":
            k.outer_wall(mn[0], mx[0], mn[2], mx[2], h)
        elif m == "wall" and h >= 2.0:
            k.barrier_wall(cx, cz, w, h, d)
        elif m == "wall":
            k.sandbags(cx, cz, w, h, d, seed=100 + i)
        elif max(w, d) >= 2.9:
            k.container(cx, cz, w, h, d, ["container_a", "container_b", "container_c"][crate_i % 3])
            crate_i += 1
        else:
            k.wood_crate(cx, cz, w, h, d)
    ob = k.b.build()
    return ob


if __name__ == "__main__":
    ob = build()
    export_glb("map", [ob])
    if not NO_PREVIEW:
        # overview over the south side; container + crates; sandbag wall + barrier; door + wall lamp
        render_previews("map", [ob], views=[("overview", 20, 42)], size=(1100, 700), samples=40, focus=(0, 0, 0), dist=62)
        render_previews("map_container", [ob], views=[("closeup", 28, 16)], samples=48, focus=(0, -7.25, 0.6), dist=7)
        render_previews("map_sandbags", [ob], views=[("closeup", 200, 14)], samples=48, focus=(-4.5, -16.9, 0.6), dist=6)
        render_previews("map_door", [ob], views=[("closeup", 180, 6)], samples=48, focus=(18.5, -23.5, 1.5), dist=7)
