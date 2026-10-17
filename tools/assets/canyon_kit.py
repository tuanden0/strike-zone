"""Canyon map visuals -> client/assets/models/map_canyon.glb  (python tools/assets/gen_canyon_map.py first).

Banded red rock cliffs and boulders, adobe walls (the stucco texture, orange tint), packed sand floor, wooden crates.
Run: /tmp/bpyenv/bin/python tools/assets/canyon_kit.py [--no-preview]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit_common import run  # noqa: E402

THEME = {
    "mats": {
        "rock": dict(tex="rock", size=512),
        "rock_dark": dict(tex="rock", size=512, color=(0.72, 0.62, 0.58, 1)),
        "adobe": dict(tex="stucco", size=512, color=(1.0, 0.68, 0.48, 1)),
        "adobe_light": dict(tex="stucco", size=512, color=(1.0, 0.78, 0.6, 1)),
        "sand": dict(tex="sand", size=256, color=(1.0, 0.78, 0.62, 1)),
        "dust": dict(tex="sand", size=256, color=(1.15, 1.0, 0.85, 1)),
        "wood": dict(tex="wood", size=256, color=(0.85, 0.7, 0.55, 1)),
        "wood_dark": dict(tex="wood", size=256, color=(0.45, 0.33, 0.25, 1)),
        "glass": dict(color=(0.03, 0.03, 0.04, 1), roughness=0.3),
    },
    "floor": {"mat": "sand", "uv": (0.4, 0.4)},
    "frame": "wood_dark",
    "glass": "glass",
    "patches": {"dust": {"mat": "dust", "uv": (0.4, 0.4)}},
    "styles": {
        "outer": dict(kind="slab", mat="rock", uv=(0.25, 0.25)),
        "rock": dict(kind="slab", mat="rock", uv=(0.25, 0.25)),
        "adobe": dict(kind="slab", mat="adobe", uv=(0.5, 0.5), plinth=("rock_dark", 0.4), cap=("adobe_light", 0.2)),
        "adobe_low": dict(kind="slab", mat="adobe", uv=(0.5, 0.5), top=("rock_dark", 0.08)),
        "boulder": dict(kind="slab", mat="rock_dark", uv=(0.35, 0.35), bevel=0.25),
        "crate": dict(kind="crate", mat="wood", rail="wood_dark"),
    },
}

if __name__ == "__main__":
    run("canyon", THEME, previews=[("overview", 25, 38, (0, 0, 0), 85)])
