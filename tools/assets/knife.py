"""Combat knife -> knife.glb (world) and knife_fp.glb (first-person with gloved hand).
Run: blender -b -P tools/assets/knife.py   (--no-preview to skip renders)"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403
import weapon_parts as wp  # noqa: E402


def hands(b):
    # fist around the handle: fingers wrap across it; back of the hand faces right
    wp.glove(b, (0.03, -0.03, -0.085), axes=((0, 1, 0), (0, 0, 1), (1, 0, 0)), curl=(80, 85, 60), thumb=(20, 30), sleeve_dir=(0.25, -0.7, -0.6))


def main():
    fresh()
    wp.weapon_materials()
    root, objs = assemble("knife", wp.knife("high"))
    export_glb("knife", objs)
    meshes = [o for o in objs if o.type == "MESH"]
    render_previews("knife", meshes, views=[("side", 90, 4), ("threequarter", 40, 22), ("top", 100, 70)], size=(900, 600), samples=48, dist=0.6)
    fresh()
    wp.weapon_materials()
    parts = wp.knife("high")
    arms = Builder("arms")
    hands(arms)
    parts["arms"] = arms
    root, objs = assemble("knife_fp", parts)
    export_glb("knife_fp", objs)
    meshes = [o for o in objs if o.type == "MESH"]
    render_previews("knife_fp", meshes, views=[("side", 90, 6), ("cam", dict(loc=(-0.1, -0.45, 0.12), target=(0.0, 0.12, 0.0), lens=38), 0)], size=(900, 600), samples=48, dist=0.7, focus=(0, 0.05, 0.0))


if __name__ == "__main__":
    main()
