"""Office map visuals -> client/assets/models/map_office.glb  (python tools/assets/gen_office_map.py first).

White plaster walls with a grey skirting, dark-glass windows and glass partitions, tiled floor with carpet in the offices,
oak desks, grey office chairs (backrest on the side named in the mat: chair_n/s/e/w), potted plants and planters.
Run: /tmp/bpyenv/bin/python tools/assets/office_kit.py [--no-preview]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit_common import ThemeKit, run  # noqa: E402

THEME = {
    "mats": {
        "plaster": dict(tex="stucco", size=256, color=(1.45, 1.45, 1.42, 1)),
        "concrete": dict(tex="concrete", size=256, color=(1.25, 1.25, 1.25, 1)),
        "floor": dict(tex="floor_tile", size=256, color=(1.6, 1.58, 1.52, 1)),
        "carpet": dict(tex="nylon", size=256, color=(2.4, 2.6, 3.0, 1)),
        "wctile": dict(tex="floor_tile", size=256, color=(1.9, 1.95, 2.0, 1)),
        "stairs": dict(tex="concrete", size=256, color=(1.0, 1.0, 1.0, 1)),
        "steel": dict(tex="steel", size=256, color=(1.9, 1.9, 2.0, 1)),
        "skirting": dict(color=(0.22, 0.22, 0.23, 1), roughness=0.6),
        "glass": dict(color=(0.05, 0.09, 0.12, 1), roughness=0.08, metallic=0.3),
        "oak": dict(tex="wood", size=256, color=(1.15, 0.95, 0.72, 1)),
        "wood_dark": dict(tex="wood", size=256, color=(0.5, 0.38, 0.28, 1)),
        "white": dict(color=(0.85, 0.85, 0.83, 1), roughness=0.5),
        "chair_fabric": dict(tex="nylon", size=256, color=(1.6, 1.65, 1.75, 1)),
        "black": dict(color=(0.04, 0.04, 0.045, 1), roughness=0.5),
        "sofa": dict(tex="nylon", size=256, color=(2.6, 1.9, 1.3, 1)),
        "leaf": dict(color=(0.08, 0.28, 0.07, 1), roughness=0.7),
        "pot": dict(color=(0.32, 0.30, 0.28, 1), roughness=0.6),
        "printer": dict(color=(0.55, 0.56, 0.58, 1), roughness=0.4),
        "dark": dict(color=(0.06, 0.06, 0.07, 1), roughness=0.7),
    },
    "floor": {"mat": "floor", "uv": (0.5, 0.5)},
    "frame": "steel",
    "glass": "glass",
    "patches": {
        "carpet": dict(mat="carpet", uv=(0.5, 0.5)),
        "stairs": dict(mat="stairs", uv=(1.0, 1.0)),
        "wctile": dict(mat="wctile", uv=(1.0, 1.0)),
    },
    "styles": {
        "void": dict(kind="slab", mat="dark"),
        "outer": dict(kind="slab", mat="plaster", uv=(0.5, 0.5), plinth=("skirting", 0.1)),
        "wall": dict(kind="slab", mat="plaster", uv=(0.5, 0.5), plinth=("skirting", 0.1)),
        "tile": dict(kind="slab", mat="white", plinth=("skirting", 0.1)),
        "column": dict(kind="slab", mat="concrete", uv=(0.5, 0.5), plinth=("skirting", 0.1)),
        # glass between a solid sill and a solid head (the whole box is solid: you cannot climb out of the building)
        "window": dict(kind="glazed", mat="glass", frame="plaster", sill=0.9, head=2.6),
        "railing": dict(kind="glazed", mat="glass", frame="concrete", sill=1.1, head=3.0),
        "glasswall": dict(kind="glazed", mat="glass", frame="steel", sill=0.1, head=2.9),
        "elevator": dict(kind="slab", mat="steel", uv=(1.0, 1.0)),
        "stairwell": dict(kind="slab", mat="dark", top=("steel", 0.05)),
        "counter": dict(kind="slab", mat="wood_dark", top=("oak", 0.05)),
        "cabinet": dict(kind="slab", mat="white", top=("oak", 0.03)),
        "sink": dict(kind="slab", mat="white", top=("steel", 0.04)),
        "vanity": dict(kind="slab", mat="white", top=("concrete", 0.05)),
        "printer": dict(kind="slab", mat="printer", top=("dark", 0.08)),
        "toilet": dict(kind="slab", mat="white"),
        "sofa": dict(kind="slab", mat="sofa"),
        "armchair": dict(kind="slab", mat="sofa"),
        "desk": dict(kind="desk", mat="oak", legs="white"),
        "table": dict(kind="desk", mat="oak", legs="black"),
        "stool": dict(kind="stool", mat="black", seat="chair_fabric"),
        "plant": dict(kind="plant", pot="pot", leaf="leaf", pot_h=0.45),
        "planter": dict(kind="plant", pot="wood_dark", leaf="leaf", pot_h=0.55),
        **{f"chair_{d}": dict(kind="chair", mat="chair_fabric", base="black", back=d) for d in "nsew"},
    },
}


class OfficeKit(ThemeKit):
    def glazed(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        self.cub(x0, x1, z0, z1, y0, st["sill"], st["frame"], (0.5, 0.5))
        self.cub(x0 + 0.02, x1 - 0.02, z0 + 0.02, z1 - 0.02, st["sill"], st["head"], st["mat"])
        self.cub(x0, x1, z0, z1, st["head"], y1, st["frame"], (0.5, 0.5))

    def desk(self, mn, mx, st):
        """Top slab on panel legs at the two short ends (hollow underneath; the collision box is still solid)."""
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        t, p = 0.04, 0.05
        self.cub(x0, x1, z0, z1, y1 - t, y1, st["mat"], (1.0, 1.0))
        if (x1 - x0) >= (z1 - z0):
            for a in (x0 + 0.03, x1 - 0.03 - p):
                self.cub(a, a + p, z0 + 0.05, z1 - 0.05, y0, y1 - t, st["legs"])
        else:
            for a in (z0 + 0.03, z1 - 0.03 - p):
                self.cub(x0 + 0.05, x1 - 0.05, a, a + p, y0, y1 - t, st["legs"])

    def chair(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        seat = 0.46
        self.cub(cx - 0.2, cx + 0.2, cz - 0.03, cz + 0.03, y0, 0.05, st["base"])   # star base (two bars)
        self.cub(cx - 0.03, cx + 0.03, cz - 0.2, cz + 0.03 + 0.17, y0, 0.05, st["base"])
        self.cub(cx - 0.03, cx + 0.03, cz - 0.03, cz + 0.03, 0.05, seat - 0.06, st["base"])
        self.cub(x0 + 0.02, x1 - 0.02, z0 + 0.02, z1 - 0.02, seat - 0.06, seat, st["mat"])
        b, d = 0.07, st["back"]
        back = {"n": (x0 + 0.03, x1 - 0.03, z0, z0 + b), "s": (x0 + 0.03, x1 - 0.03, z1 - b, z1),
                "w": (x0, x0 + b, z0 + 0.03, z1 - 0.03), "e": (x1 - b, x1, z0 + 0.03, z1 - 0.03)}[d]
        self.cub(back[0], back[1], back[2], back[3], seat, y1, st["mat"])

    def stool(self, mn, mx, st):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        self.cub(cx - 0.15, cx + 0.15, cz - 0.15, cz + 0.15, y0, 0.03, st["mat"])
        self.cub(cx - 0.03, cx + 0.03, cz - 0.03, cz + 0.03, 0.03, y1 - 0.07, st["mat"])
        self.cub(x0, x1, z0, z1, y1 - 0.07, y1, st["seat"])

    def plant(self, mn, mx, st):
        """Pot / planter box with a few stacked, shrinking leaf blocks (all inside the collision box)."""
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        ph = st["pot_h"]
        self.cub(x0 + 0.02, x1 - 0.02, z0 + 0.02, z1 - 0.02, y0, ph, st["pot"])
        layers = 3
        for i in range(layers):
            f = 0.02 + 0.13 * min(x1 - x0, z1 - z0) * i
            a0, a1 = y0 + ph + (y1 - ph) * i / layers, y0 + ph + (y1 - ph) * (i + 1) / layers
            self.cub(x0 + f, x1 - f, z0 + f, z1 - f, a0, a1, st["leaf"])


if __name__ == "__main__":
    run("office", THEME, previews=[("overview", 25, 50, (0, 0, 0), 62)], kit=OfficeKit)
