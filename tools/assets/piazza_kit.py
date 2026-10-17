"""Piazza map visuals -> client/assets/models/map_piazza.glb  (python tools/assets/gen_piazza_map.py first).

Warm stucco houses with terracotta coping, cobbled streets, a limestone fountain, striped market stalls.
Run: /tmp/bpyenv/bin/python tools/assets/piazza_kit.py [--no-preview]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit_common import run  # noqa: E402

THEME = {
    "mats": {
        "plaster_a": dict(tex="stucco", size=512, color=(1.0, 0.86, 0.62, 1)),
        "plaster_b": dict(tex="stucco", size=512, color=(1.0, 0.66, 0.52, 1)),
        "plaster_c": dict(tex="stucco", size=512, color=(1.0, 0.95, 0.84, 1)),
        "limestone": dict(tex="stucco", size=512, color=(0.92, 0.92, 0.88, 1)),
        "roof": dict(tex="terracotta", size=256),
        "cobble": dict(tex="cobble", size=256),
        "paving": dict(tex="cobble", size=256, color=(1.35, 1.28, 1.15, 1)),
        "stone": dict(tex="cobble", size=256, color=(0.8, 0.76, 0.72, 1)),
        "wood": dict(tex="wood", size=256, color=(0.9, 0.8, 0.7, 1)),
        "wood_dark": dict(tex="wood", size=256, color=(0.55, 0.4, 0.3, 1)),
        "water": dict(color=(0.06, 0.26, 0.34, 1), roughness=0.06),
        "glass": dict(color=(0.03, 0.04, 0.05, 1), roughness=0.1),
        "shutter": dict(color=(0.16, 0.36, 0.30, 1), roughness=0.7),
        "awning_a": dict(color=(0.72, 0.12, 0.08, 1), roughness=0.9),
        "awning_b": dict(color=(0.86, 0.80, 0.64, 1), roughness=0.9),
    },
    "floor": {"mat": "cobble", "uv": (0.5, 0.5)},
    "frame": "wood_dark",
    "glass": "glass",
    "shutter": "shutter",
    "patches": {"paving": {"mat": "paving", "uv": (0.4, 0.4)}},
    "styles": {
        "outer": dict(kind="slab", mat="plaster_c", uv=(0.5, 0.5), plinth=("stone", 0.5), cap=("roof", 0.25)),
        "house": dict(kind="slab", mat="plaster_a", uv=(0.5, 0.5), plinth=("stone", 0.5), cap=("roof", 0.25)),
        "house2": dict(kind="slab", mat="plaster_b", uv=(0.5, 0.5), plinth=("stone", 0.5), cap=("roof", 0.25)),
        "wall": dict(kind="slab", mat="plaster_c", uv=(0.5, 0.5), plinth=("stone", 0.5), cap=("roof", 0.2)),
        "lowwall": dict(kind="slab", mat="plaster_c", uv=(0.5, 0.5), top=("stone", 0.1)),
        "fountain": dict(kind="slab", mat="limestone", uv=(0.5, 0.5), top=("limestone", 0.12)),
        "fountain_col": dict(kind="slab", mat="limestone", uv=(0.5, 0.5)),
        "water": dict(kind="water", mat="water"),
        "stall": dict(kind="stall", mat="wood", top="wood_dark", awning_a="awning_a", awning_b="awning_b"),
        "crate": dict(kind="crate", mat="wood", rail="wood_dark"),
    },
}

if __name__ == "__main__":
    run("piazza", THEME, previews=[("overview", 20, 42, (0, 0, 0), 78)])
