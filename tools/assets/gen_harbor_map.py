"""Writes client/shared/map_harbor.json: a container yard (original layout).

Rows of corrugated shipping containers (single and double stacked) form a maze of 3 m aisles; a warehouse with two doors in the
middle, forklift-size crate blocks and pallets, jersey barriers; each team starts in a walled pocket closed by double-stacked
containers (two 4 m gaps), next to a dock office. Drawn for the team A half (z >= 0); team B is the same drawing rotated 180 degrees.
Adjacent containers use different characters (k/j/i, K/J/I) so they stay separate props.
    python tools/assets/gen_harbor_map.py          (MAP_PNG_DIR=/some/dir also writes a top-down PNG)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapgen_common import Canvas, DOOR, L, WINDOW, build_map  # noqa: E402

LEGEND = {
    "k": L("cont_a", 2.6), "j": L("cont_b", 2.6), "i": L("cont_c", 2.6),
    "K": L("cont_a", 5.2), "J": L("cont_b", 5.2), "I": L("cont_c", 5.2),
    "F": L("bigcrate", 2.0),
    "f": L("pallet", 1.0),
    "n": L("barrier", 0.9),
    "M": L("warehouse", 5.0),
    "d": DOOR("warehouse", 3.0, 5.0),
    "w": WINDOW("warehouse", 2.0, 3.0, 5.0),
    "p": L("steelpillar", 5.0),
    "W": L("concrete", 5.2),
}


def draw():
    cv = Canvas(30)
    # --- warehouse in the middle: door in the north wall (the rotation adds the south one), high windows, pillars, cover
    cv.fill(-9, 9, 3, 4, "M")
    cv.fill(-9, -8, 0, 4, "M")
    cv.fill(8, 9, 0, 4, "M")
    cv.fill(-5, -2, 3, 4, "d")
    cv.fill(-9, -8, 1, 3, "w")
    cv.fill(8, 9, 2, 3, "w")
    cv.fill(5, 7, 3, 4, "w")
    for x in (-6, -2, 2, 6):
        cv.put(x, 1, "p")
    cv.fill(-7, -4, 1, 3, "F")
    cv.fill(3, 6, 2, 3, "f")
    cv.put(0, 2, "R")
    # --- container rows (aisles 3 m between rows, 4 m next to the warehouse)
    for x0, x1, ch in ((-28, -22, "j"), (-19, -13, "i"), (13, 19, "k"), (22, 28, "j")):
        cv.fill(x0, x1, 1, 3, ch)
    for x0, x1, ch in ((-27, -21, "k"), (-18, -12, "i"), (-9, -3, "j"), (3, 9, "k"), (12, 18, "j"), (21, 27, "i")):
        cv.fill(x0, x1, 7, 9, ch)
    for x0, x1, ch in ((-30, -24, "i"), (-21, -15, "k"), (-12, -6, "j"), (-3, 3, "i"), (6, 12, "k"), (15, 21, "j"), (24, 30, "i")):
        cv.fill(x0, x1, 12, 14, ch)
    for x0, x1, ch in ((-27, -21, "K"), (-18, -12, "J"), (-9, -3, "I"), (3, 9, "K"), (12, 18, "J"), (21, 27, "I")):
        cv.fill(x0, x1, 17, 19, ch)
    # --- crates, pallets and barriers in the aisles
    cv.fill(-17, -14, 3, 5, "F")
    cv.fill(18, 21, 4, 5, "f")
    cv.fill(-1, 2, 10, 11, "f")
    cv.fill(-24, -22, 10, 11, "n")
    cv.fill(22, 24, 15, 16, "n")
    cv.fill(-9, -7, 15, 16, "n")
    cv.fill(10, 12, 20, 21, "n")
    # --- team A pocket (north end): double-stacked container wall with two 4 m gaps, side walls, spawn row
    for x0, x1, ch in ((-13, -7, "K"), (-3, 3, "J"), (7, 13, "I")):
        cv.fill(x0, x1, 22, 24, ch)
    cv.fill(-15, -13, 22, 28, "J")
    cv.fill(-15, -13, 28, 30, "W")
    cv.fill(13, 15, 22, 28, "K")
    cv.fill(13, 15, 28, 30, "W")
    for x in (-8, -6, -4, -2, 1, 3, 5, 7):
        cv.put(x, 27, "A")
    cv.fill(-2, 2, 29, 30, "f")
    # --- dock office west of the pocket
    cv.room(-29, -16, 22, 30, "M")
    cv.fill(-25, -22, 22, 23, "d")
    cv.fill(-19, -18, 22, 23, "w")
    cv.fill(-16, -15, 22, 30, "W")
    cv.fill(-27, -25, 25, 26, "f")
    cv.fill(-20, -18, 27, 29, "F")
    cv.put(-22, 27, "P")
    # --- east of the pocket: container alleys (dead ends)
    cv.fill(15, 17, 24, 30, "W")
    for x0, ch in ((17, "K"), (22, "I"), (27, "J")):
        cv.fill(x0, x0 + 2, 24, 30, ch)
    # --- pickups
    cv.put(-15, 20, "R")
    cv.put(0, 9, "P")
    cv.put(-29, 5, "S")
    return cv


def patches():
    out = []
    for z in (5.5, 20.5):  # dashed centre lines on the long aisle and the aisle in front of the pockets
        for sgn in (1, -1):
            for k in range(-14, 14):
                x0 = k * 2.0 + 0.2
                out.append((x0, x0 + 1.2, sgn * z - 0.06, sgn * z + 0.06, "paint_yellow"))
    # the 4 m gaps in front of the pockets: hatched pad
    for sgn in (1, -1):
        out.append((-7, -3, sgn * 20.0 - 0.08 if sgn > 0 else -20.08, sgn * 20.0 + 0.08 if sgn > 0 else -19.92, "paint_white"))
    return out


if __name__ == "__main__":
    cv = draw()
    if "--dump" in sys.argv:
        cv.dump()
    build_map("harbor", "Harbor", 30, cv.rows(), LEGEND, patches=patches(), outer_h=4.0)
