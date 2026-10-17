"""Bunker map visuals -> client/assets/models/map_bunker.glb  (python tools/assets/gen_bunker_map.py first).

Formwork concrete walls with steel plinth/cap bands, tiled concrete floor, hazard-yellow door frames, olive metal crates.
Run: /tmp/bpyenv/bin/python tools/assets/bunker_kit.py [--no-preview]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit_common import run  # noqa: E402

THEME = {
    "mats": {
        "concrete": dict(tex="concrete", size=512, color=(1.15, 1.15, 1.2, 1)),
        "floor": dict(tex="floor_tile", size=256, color=(1.5, 1.5, 1.55, 1)),
        "steel": dict(tex="steel", size=256, color=(1.8, 1.8, 1.9, 1)),
        "metalcrate": dict(tex="container_metal", size=256, color=(0.7, 0.78, 0.55, 1)),
        "hazard": dict(color=(0.85, 0.6, 0.05, 1), roughness=0.6),
        "glass": dict(color=(0.03, 0.05, 0.08, 1), roughness=0.1),
    },
    "floor": {"mat": "floor", "uv": (0.5, 0.5)},
    "frame": "hazard",
    "glass": "glass",
    "patches": {},
    "styles": {
        "outer": dict(kind="slab", mat="concrete", uv=(0.5, 0.5), plinth=("steel", 0.35), cap=("steel", 0.15)),
        "concrete": dict(kind="slab", mat="concrete", uv=(0.5, 0.5), plinth=("steel", 0.35), cap=("steel", 0.15)),
        "bpillar": dict(kind="pillar", mat="concrete", trim="steel", uv=(0.5, 0.5)),
        "lowcover": dict(kind="slab", mat="steel", uv=(1.0, 1.0), top=("hazard", 0.06)),
        "mcrate": dict(kind="crate", mat="metalcrate", rail="steel"),
    },
}

if __name__ == "__main__":
    run("bunker", THEME, previews=[("overview", 25, 45, (0, 0, 0), 75)])
