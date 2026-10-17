"""Crossroads map visuals -> client/assets/models/map_crossroads.glb

Reads client/shared/map_crossroads.json (collision boxes + "decor" hints written by gen_crossroads_map.py) and builds
one detailed prop per collision box. Same coordinate conventions as map_kit.py.
Run: python tools/assets/gen_crossroads_map.py && blender -b -P tools/assets/crossroads_kit.py
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403
import common  # noqa: E402
import map_kit  # noqa: E402
import weapon_parts as wp  # noqa: E402
from map_kit import Kit, place  # noqa: E402

M = json.load(open(os.path.join(ROOT, "client", "shared", "map_crossroads.json")))


class XKit(Kit):
    def __init__(self):
        super().__init__()
        wp.weapon_materials()  # rubber / gunmetal reused for tyres and trim
        material("asphalt", tex="asphalt")
        material("brick", tex="brick")
        material("sidewalk", tex="floor_tile", color=(1.15, 1.12, 1.05, 1))
        material("paint_white", color=(0.8, 0.8, 0.78, 1), roughness=0.6)
        material("paint_yellow", color=(0.8, 0.55, 0.05, 1), roughness=0.6)
        material("paint_red", color=(0.6, 0.06, 0.05, 1), roughness=0.6)
        material("glass", color=(0.03, 0.05, 0.08, 1), roughness=0.05, metallic=0.0)
        material("soil", color=(0.12, 0.08, 0.05, 1), roughness=1.0)
        material("leaf", color=(0.08, 0.28, 0.07, 1), roughness=0.8)
        material("light_red", color=(1, 0.1, 0.05, 1), roughness=0.3, emission=(1, 0.1, 0.05, 1), emission_strength=3.0)
        material("light_white", color=(1, 0.95, 0.8, 1), roughness=0.3, emission=(1, 0.95, 0.8, 1), emission_strength=4.0)

    # ------------------------------------------------------------------ ground / roads
    def ground(self):
        B = M["bounds"]["maxX"]
        self.add(box((2 * B + 2, 2 * B + 2, 0.2), (0, 0, -0.1)), "sidewalk", (0.25, 0.25))
        half = [d for d in M["decor"] if d["type"] == "roads"][0]["half"]
        h = 0.012
        # one cross-shaped surface without overlapping (coplanar) boxes
        self.add(box((2 * half, 2 * B, h), (0, 0, h / 2)), "asphalt", (0.25, 0.25))
        for sg in (-1, 1):
            arm = B - half
            self.add(box((arm, 2 * half, h), (sg * (half + arm / 2), 0, h / 2)), "asphalt", (0.25, 0.25))
        # markings (Blender y = -z)
        top = h
        pz = lambda x, y, w, d, mat: self.add(box((w, d, 0.006), (x, y, top + 0.003)), mat, (1, 1))  # noqa: E731
        for axis in ("v", "h"):
            for s in range(10, int(B), 6):  # dashed double yellow centre line, outside the junction
                for sg in (-1, 1):
                    for off in (-0.09, 0.09):
                        if axis == "v":
                            pz(off, sg * (s + 1.5), 0.08, 3.0, "paint_yellow")
                        else:
                            pz(sg * (s + 1.5), off, 3.0, 0.08, "paint_yellow")
            for sg in (-1, 1):
                for e in (-1, 1):
                    L = B - 10
                    if axis == "v":
                        pz(e * (half - 0.45), sg * (10 + L / 2), 0.12, L, "paint_white")
                    else:
                        pz(sg * (10 + L / 2), e * (half - 0.45), L, 0.12, "paint_white")
            for sg in (-1, 1):  # zebra crossings at the four mouths
                for k in range(-5, 6):
                    c = k * 1.0
                    if axis == "v":
                        pz(c, sg * 7.8, 0.5, 2.6, "paint_white")
                    else:
                        pz(sg * 7.8, c, 2.6, 0.5, "paint_white")
            for sg in (-1, 1):  # stop lines
                if axis == "v":
                    pz(sg * 3.0, sg * 6.4, 5.6, 0.3, "paint_white")
                else:
                    pz(sg * 6.4, -sg * 3.0, 0.3, 5.6, "paint_white")

    # ------------------------------------------------------------------ buildings
    def building_wall(self, mn, mx):
        """One wall segment; faces outward-in brick, concrete plinth + cornice where it reaches the roof line."""
        w, d, h = mx[0] - mn[0], mx[2] - mn[2], mx[1] - mn[1]
        cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
        loc = (cx, -cz, mn[1])
        uv = (1.0, 1.0)
        trim = h > 2.0 and mn[1] < 0.01
        cap = mx[1] >= 3.1 and h > 0.5
        # brick face sits 2 cm inside the collision box (across the thickness) so plinth/cornice read as relief
        ins = 0.04 if trim or cap else 0.0
        sw, sd = (w, d - ins) if d <= w else (w - ins, d)
        self.add(box((sw, sd, h - (0.02 if cap else 0.0)), (0, 0, (h - (0.02 if cap else 0.0)) / 2), bevel=0.01, segs=1), "brick", uv, loc)
        if trim:  # concrete plinth band at the foot (flush with the collision box)
            self.add(box((w, d, 0.45), (0, 0, 0.225), bevel=0.02, segs=1), "concrete", (0.5, 0.5), loc)
        if cap:  # cornice / coping
            ch = 0.28
            self.add(box((w, d, ch), (0, 0, h - ch / 2), bevel=0.03, segs=1), "concrete", (0.5, 0.5), loc)

    def opening_frame(self, dc):
        """Visual frame for a door/window gap (no glass: bullets pass through windows)."""
        t = dc["t"]
        a, b, y0, y1 = dc["a"], dc["b"], dc["y0"], dc["y1"]
        fw = 0.1
        mid = (a + b) / 2
        for nm, (c0, c1, z0, z1) in {"l": (a, a + fw, y0, y1), "r": (b - fw, b, y0, y1), "t": (a, b, y1 - fw, y1), "b": (a, b, y0, y0 + fw)}.items():
            if nm == "b" and dc["type"] == "door":
                continue
            sx, sy = c1 - c0, z1 - z0
            if dc["axis"] == "x":  # wall runs along x at z = fixed .. fixed+t  (Blender y = -z)
                self.add(box((sx, t + 0.02, sy), ((c0 + c1) / 2, -(dc["fixed"] + t / 2), (z0 + z1) / 2), bevel=0.008, segs=1), "steel", (1, 1))
            else:
                self.add(box((t + 0.02, sx, sy), (dc["fixed"] + t / 2, -((c0 + c1) / 2), (z0 + z1) / 2), bevel=0.008, segs=1), "steel", (1, 1))


def build():
    k = XKit()
    k.ground()
    for bx in M["boxes"]:
        mn, mx, m = bx["min"], bx["max"], bx["mat"]
        w, h, d = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
        cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
        if m == "outer":
            k.outer_wall(mn[0], mx[0], mn[2], mx[2], h)
        elif m == "building":
            k.building_wall(mn, mx)
        elif m == "wall":
            k.barrier_wall(cx, cz, w, h, d)

    for dc in M["decor"]:
        if dc["type"] in ("door", "window"):
            k.opening_frame(dc)
    return k.b.build()


if __name__ == "__main__":
    ob = build()
    export_glb("map_crossroads", [ob])
    if not NO_PREVIEW:
        render_previews("crossroads", [ob], views=[("overview", 25, 40)], size=(1100, 700), samples=40, focus=(0, 0, 0), dist=78)
        render_previews("crossroads_street", [ob], views=[("avenue", 180, 7)], size=(1000, 600), samples=48, focus=(0, -4, 1.4), dist=22)
        render_previews("crossroads_building", [ob], views=[("corner", 215, 14)], size=(1000, 600), samples=48, focus=(14, 9, 2), dist=22)
