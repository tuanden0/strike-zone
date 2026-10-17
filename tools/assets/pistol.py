"""Generic semi-auto pistol -> pistol.glb (world) and pistol_fp.glb (first-person with gloved hands).
Run: blender -b -P tools/assets/pistol.py   (--no-preview to skip renders)"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403
import weapon_parts as wp  # noqa: E402


def hands(b):
    # right hand on the grip, left hand wrapping it from the left side
    wp.glove(b, (0.03, -0.085, -0.022), axes=((0, 0, -1), (0, 1, 0), (1, 0, 0)), curl=(70, 85, 55), thumb=(5, 20), sleeve_dir=(0.3, -0.75, -0.55))
    wp.glove(b, (-0.03, -0.07, -0.03), axes=((0, 0, 1), (0, 1, 0), (-1, 0, 0)), curl=(65, 80, 55), thumb=(0, 20), left=True, sleeve_dir=(-0.3, -0.75, -0.55))


def main():
    fresh()
    wp.weapon_materials()
    root, objs = assemble("pistol", wp.pistol("high"))
    export_glb("pistol", objs)
    meshes = [o for o in objs if o.type == "MESH"]
    render_previews("pistol", meshes, views=[("side", 90, 6), ("threequarter", 40, 22), ("rear", 160, 20)], size=(900, 600), samples=48, dist=0.8)
    fresh()
    wp.weapon_materials()
    parts = wp.pistol("high")
    arms = Builder("arms")
    hands(arms)
    parts["arms"] = arms
    root, objs = assemble("pistol_fp", parts)
    export_glb("pistol_fp", objs)
    meshes = [o for o in objs if o.type == "MESH"]
    render_previews("pistol_fp", meshes, views=[("side", 90, 6), ("cam", dict(loc=(-0.05, -0.42, 0.14), target=(0.0, 0.25, 0.05), lens=38), 0)], size=(900, 600), samples=48, dist=0.9, focus=(0, 0.0, 0.0))


if __name__ == "__main__":
    main()
