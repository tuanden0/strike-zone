"""Pyramid map visuals -> client/assets/models/map_pyramid.glb  (python tools/assets/gen_pyramid_map.py first).

Sandstone ashlar walls, tiers, pillars and obelisks (gold cap) on rippled sand; wooden crates.
Run: /tmp/bpyenv/bin/python tools/assets/pyramid_kit.py [--no-preview]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit_common import run  # noqa: E402

THEME = {
    "mats": {
        "sandstone": dict(tex="sandstone", size=512, color=(1.0, 0.95, 0.88, 1)),
        "sandstone_light": dict(tex="sandstone", size=512, color=(1.25, 1.2, 1.1, 1)),
        "sandstone_dark": dict(tex="sandstone", size=512, color=(0.72, 0.62, 0.52, 1)),
        "sand": dict(tex="sand", size=256),
        "paving": dict(tex="sandstone", size=512, color=(1.15, 1.08, 0.98, 1)),
        "wood": dict(tex="wood", size=256, color=(0.85, 0.72, 0.58, 1)),
        "wood_dark": dict(tex="wood", size=256, color=(0.5, 0.38, 0.28, 1)),
        "gold": dict(color=(0.9, 0.62, 0.12, 1), roughness=0.3, metallic=0.9),
    },
    "floor": {"mat": "sand", "uv": (0.5, 0.5)},
    "frame": "sandstone_dark",
    "patches": {"paving": {"mat": "paving", "uv": (0.5, 0.5)}},
    "styles": {
        "outer": dict(kind="slab", mat="sandstone", uv=(0.5, 0.5), plinth=("sandstone_dark", 0.5), cap=("sandstone_light", 0.3)),
        "wall": dict(kind="slab", mat="sandstone", uv=(0.5, 0.5), plinth=("sandstone_dark", 0.4), cap=("sandstone_light", 0.3)),
        "rubble": dict(kind="slab", mat="sandstone_dark", uv=(0.5, 0.5), top=("sandstone", 0.08)),
        "pillar": dict(kind="pillar", mat="sandstone", trim="sandstone_light", uv=(0.5, 0.5)),
        "obelisk": dict(kind="slab", mat="sandstone_light", uv=(0.5, 0.5), plinth=("sandstone_dark", 0.9), cap=("gold", 0.5)),
        "block": dict(kind="slab", mat="sandstone", uv=(0.5, 0.5), top=("sandstone_light", 0.08)),
        "tier": dict(kind="slab", mat="sandstone", uv=(0.5, 0.5), top=("sandstone_light", 0.1)),
        "crate": dict(kind="crate", mat="wood", rail="wood_dark"),
    },
}

if __name__ == "__main__":
    run("pyramid", THEME, previews=[("overview", 25, 38, (0, 0, 0), 85)])
