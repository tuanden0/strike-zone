"""Generic bolt-action scoped rifle -> client/assets/models/sniper.glb (world model) and sniper_fp.glb (first-person: rifle + gloved hands).
Run: blender -b -P tools/assets/sniper.py   (add --no-preview to skip renders)"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403
import weapon_parts as wp  # noqa: E402


def hands(b):
    # right hand on the pistol grip (palm faces -X, thumb up), left hand cupping the handguard (palm up)
    wp.glove(b, (0.036, -0.105, -0.043), axes=((0, 0, -1), (0, 1, 0), (1, 0, 0)), curl=(72, 82, 55), thumb=(5, 20), sleeve_dir=(0.35, -0.7, -0.6))
    wp.glove(b, (0.0, 0.25, 0.0), axes=((-1, 0, 0), (0, 1, 0), (0, 0, -1)), curl=(60, 70, 55), thumb=(0, 15), left=True, sleeve_dir=(-0.3, -0.8, -0.5))


def main():
    fresh()
    wp.weapon_materials()
    root, objs = assemble("sniper", wp.sniper("high"))
    export_glb("sniper", objs)
    n_world = tri_count(objs)
    render_previews("sniper", [o for o in objs if o.type == "MESH"], views=[("side", 90, 8), ("threequarter", 35, 22), ("top", 100, 70)], size=(1000, 560), samples=48, dist=2.0)
    # first-person variant
    fresh()
    wp.weapon_materials()
    parts = wp.sniper("high")
    arms = Builder("arms")
    hands(arms)
    parts["arms"] = arms
    root, objs = assemble("sniper_fp", parts)
    export_glb("sniper_fp", objs)
    render_previews("sniper_fp", [o for o in objs if o.type == "MESH"], views=[("side", 90, 8), ("cam", dict(loc=(-0.16, -0.52, 0.16), target=(0.02, 0.4, 0.06), lens=38), 0)], size=(1000, 640), samples=48, dist=1.6, focus=(0, 0.2, 0.0))
    print("TRIS sniper world", n_world)


if __name__ == "__main__":
    main()
