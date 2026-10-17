"""Regenerate every asset (models in client/assets/models, previews in docs/previews).

  blender -b -P tools/assets/build_all.py [-- --no-preview]
  python tools/assets/build_all.py [--no-preview]        (python with the `bpy` wheel installed)
"""
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for name in ("map_kit", "rifle", "pistol", "knife", "character"):
    print(f"=== {name}")
    runpy.run_path(os.path.join(HERE, name + ".py"), run_name="__main__")
