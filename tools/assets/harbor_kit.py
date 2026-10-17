"""Harbor map visuals -> client/assets/models/map_harbor.glb  (python tools/assets/gen_harbor_map.py first).

Corrugated shipping containers (three paint jobs, stacked up to two high), a sheet-metal warehouse, crates and pallets on asphalt.
Run: /tmp/bpyenv/bin/python tools/assets/harbor_kit.py [--no-preview]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit_common import run  # noqa: E402

THEME = {
    "mats": {
        "asphalt": dict(tex="asphalt", size=256, color=(1.7, 1.7, 1.75, 1)),
        "concrete": dict(tex="concrete", size=256),
        "steel": dict(tex="steel", size=256, color=(1.8, 1.8, 1.9, 1)),
        "cont_a": dict(tex="container_metal", size=256),
        "cont_b": dict(tex="container_metal", size=256, color=(0.55, 0.85, 1.55, 1)),
        "cont_c": dict(tex="container_metal", size=256, color=(1.7, 0.62, 0.5, 1)),
        "sheet": dict(tex="container_metal", size=256, color=(0.95, 0.95, 0.9, 1)),
        "wood": dict(tex="wood", size=256, color=(0.85, 0.72, 0.58, 1)),
        "wood_dark": dict(tex="wood", size=256, color=(0.5, 0.38, 0.28, 1)),
        "paint_yellow": dict(color=(0.8, 0.55, 0.05, 1), roughness=0.6),
        "paint_white": dict(color=(0.8, 0.8, 0.78, 1), roughness=0.6),
        "glass": dict(color=(0.03, 0.05, 0.08, 1), roughness=0.1),
    },
    "floor": {"mat": "asphalt", "uv": (0.25, 0.25)},
    "frame": "steel",
    "glass": "glass",
    "patches": {"paint_yellow": {"mat": "paint_yellow"}, "paint_white": {"mat": "paint_white"}},
    "styles": {
        "outer": dict(kind="slab", mat="sheet", uv=(1.0, 0.4), plinth=("concrete", 0.6), cap=("steel", 0.25)),
        "cont_a": dict(kind="container", mat="cont_a", steel="steel"),
        "cont_b": dict(kind="container", mat="cont_b", steel="steel"),
        "cont_c": dict(kind="container", mat="cont_c", steel="steel"),
        "bigcrate": dict(kind="crate", mat="wood", rail="wood_dark", whole=True, post=0.16),
        "pallet": dict(kind="slab", mat="wood", uv=(1.0, 1.0), top=("wood_dark", 0.08)),
        "barrier": dict(kind="slab", mat="concrete", uv=(0.5, 0.5), bevel=0.1),
        "warehouse": dict(kind="slab", mat="sheet", uv=(1.0, 0.4), plinth=("concrete", 0.7), cap=("steel", 0.25)),
        "steelpillar": dict(kind="pillar", mat="steel", trim="steel", uv=(1.0, 1.0)),
        "concrete": dict(kind="slab", mat="concrete", uv=(0.5, 0.5), cap=("steel", 0.2)),
    },
}

if __name__ == "__main__":
    run("harbor", THEME, previews=[("overview", 25, 38, (0, 0, 0), 85)])
