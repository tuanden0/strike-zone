"""Writes client/shared/map_piazza.json: a small Mediterranean village (original layout).

Narrow alleys, a central square with a low fountain, stucco house blocks (two-storey look), a few enterable ground-floor
rooms, market stalls and crates. Team spawn courtyards at the north and south ends (walled, two gateways each).
    python tools/assets/gen_piazza_map.py          (MAP_PNG_DIR=/some/dir also writes a top-down PNG)
Drawn for the team A half (z >= 0); team B is the same drawing rotated 180 degrees (see mapgen_common.py).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapgen_common import Canvas, DOOR, L, WINDOW, build_map  # noqa: E402

FACADE = [(1.3, 2.5), (3.6, 4.9)]
LEGEND = {
    "H": L("house", 6.0, facade=FACADE),          # ochre stucco block
    "G": L("house2", 6.0, facade=FACADE),         # terracotta-pink stucco block
    "W": L("wall", 3.4),                          # courtyard garden wall
    "d": DOOR("house"), "e": DOOR("house2"),
    "w": WINDOW("house"), "v": WINDOW("house2"),
    "a": L("house", 6.0, y0=3.0),                 # bridging arch over a passage
    "f": L("fountain", 0.9), "q": L("water", 0.7), "F": L("fountain_col", 2.8),
    "m": L("stall", 1.0),
    "c": L("crate", 1.0), "C": L("crate", 2.0),
    "l": L("lowwall", 1.0),
}


def draw():
    cv = Canvas(28)
    # --- team A courtyard (north): walled, two gateways, planters just inside the gates
    cv.fill(-10, -9, 20, 28, "W")
    cv.fill(9, 10, 20, 28, "W")
    cv.fill(-10, 10, 20, 21, "W")
    cv.fill(-7, -4, 20, 21, ".")
    cv.fill(4, 7, 20, 21, ".")
    for x in (-8, -6, -4, -2, 1, 3, 5, 7):
        cv.put(x, 25, "A")
    cv.fill(-9, -7, 22, 23, "l")
    cv.fill(7, 9, 22, 23, "l")
    # --- tavern (enterable) west of the courtyard, solid block east of it
    cv.room(-28, -10, 20, 28, "H")
    cv.fill(-22, -20, 20, 21, "d")
    cv.fill(-16, -14, 20, 21, "d")
    cv.fill(-26, -25, 20, 21, "w")
    cv.fill(-25, -19, 24, 25, "l")
    cv.put(-26, 26, "c")
    cv.put(-12, 26, "C")
    cv.put(-15, 25, "P")
    cv.fill(10, 28, 20, 28, "G")
    # --- first row of houses (z 12..17): alleys between, a hall in the middle with a through-passage
    cv.fill(-28, -20, 12, 17, "H")
    cv.room(-17, -10, 12, 17, "H")
    cv.fill(-15, -13, 12, 13, "d")
    cv.fill(-16, -14, 16, 17, "d")
    cv.fill(-17, -16, 14, 15, "w")
    cv.put(-14, 14, "P")
    cv.fill(-7, 7, 12, 17, "G")
    cv.fill(-1, 1, 12, 17, "a")
    cv.room(10, 17, 12, 17, "H")
    cv.fill(11, 13, 12, 13, "d")
    cv.fill(14, 16, 16, 17, "d")
    cv.fill(16, 17, 14, 15, "w")
    cv.fill(20, 28, 12, 17, "G")
    # --- wings beside the square (z 2..9)
    cv.fill(-28, -20, 2, 9, "G")
    cv.room(-17, -10, 2, 9, "H")
    cv.fill(-11, -10, 5, 7, "d")
    cv.fill(-15, -13, 2, 3, "d")
    cv.fill(-14, -13, 8, 9, "w")
    cv.fill(-17, -16, 5, 6, "w")
    cv.put(-14, 5, "R")
    cv.fill(-16, -14, 6, 7, "c")
    cv.fill(10, 17, 2, 9, "H")
    cv.room(20, 28, 2, 9, "G")
    cv.fill(20, 21, 4, 6, "e")
    cv.fill(23, 25, 2, 3, "e")
    cv.fill(24, 25, 8, 9, "v")
    cv.fill(25, 27, 6, 7, "c")
    cv.put(26, 4, "C")
    # --- fountain (6 x 6, centre of the map; the lower half comes from the rotation)
    cv.fill(-3, 3, 2, 3, "f")
    cv.fill(-3, -2, 0, 2, "f")
    cv.fill(2, 3, 0, 2, "f")
    cv.fill(-2, 2, 0, 2, "q")
    cv.fill(-1, 1, 0, 1, "F")
    # --- market stalls and crates on the square
    cv.fill(-8, -5, 6, 7, "m")
    cv.fill(5, 8, 4, 5, "m")
    cv.fill(-5, -3, 10, 11, "c")
    cv.put(-5, 11, "c")
    cv.put(4, 10, "C")
    cv.put(5, 10, "c")
    cv.put(-9, 10, "R")
    # --- west end of the cross street: sniper nook
    cv.put(-27, 0, "S")
    cv.put(-26, 1, "c")
    cv.put(-24, 1, "C")
    return cv


if __name__ == "__main__":
    cv = draw()
    if "--dump" in sys.argv:
        cv.dump()
    patches = [(-10, 10, -12, 12, "paving"), (-9, 9, 21, 28, "paving"), (-9, 9, -28, -21, "paving")]
    build_map("piazza", "Piazza", 28, cv.rows(), LEGEND, patches=patches)
