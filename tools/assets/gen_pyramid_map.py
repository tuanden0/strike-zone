"""Writes client/shared/map_pyramid.json: a desert ruin around a stepped pyramid (original layout).

A five-tier pyramid (0.8 m risers, 2 m treads: every tier is a jump) fills the centre; a sandstone avenue with a colonnade leads
to each team's walled courtyard (north / south end); ruined temples, a long outer corridor with doors on each flank, obelisks,
rubble walls. Drawn for the team A half (z >= 0); team B is the same drawing rotated 180 degrees.
    python tools/assets/gen_pyramid_map.py          (MAP_PNG_DIR=/some/dir also writes a top-down PNG)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapgen_common import Canvas, DOOR, L, build_map  # noqa: E402

LEGEND = {
    "W": L("wall", 4.5),
    "w": L("wall", 2.4),
    "l": L("rubble", 1.0),
    "k": L("pillar", 4.2),
    "O": L("obelisk", 6.0),
    "b": L("block", 1.3),
    "n": L("block", 0.9),
    "c": L("crate", 1.0),
    "d": DOOR("wall", 2.8, 4.5),
    "1": L("tier", 0.8), "2": L("tier", 1.6), "3": L("tier", 2.4), "4": L("tier", 3.2), "5": L("tier", 4.0),
}


def draw():
    cv = Canvas(30)
    # --- stepped pyramid, centre of the map (only the z >= 0 half is drawn; the rotation completes it)
    for lvl, h in enumerate([9, 7, 5, 3, 1], 1):
        for z in range(0, h):
            for x in range(-h, h):
                cv.put(x, z, str(lvl))
    # --- team A courtyard (north end): high walls, three gateways, a shield block and corner pillars inside
    cv.fill(-11, -10, 20, 30, "W")
    cv.fill(10, 11, 20, 30, "W")
    cv.fill(-11, 11, 20, 21, "W")
    cv.fill(-8, -6, 20, 21, "d")
    cv.fill(-2, 2, 20, 21, "d")
    cv.fill(6, 8, 20, 21, "d")
    for x in (-8, -6, -4, -2, 1, 3, 5, 7):
        cv.put(x, 25, "A")
    cv.fill(-1, 1, 23, 24, "b")
    for x, z in ((-9, 22), (8, 22), (-9, 28), (8, 28)):
        cv.put(x, z, "k")
    # --- barracks ruins beside the courtyard: west one roofless hall with two doors, east one half collapsed
    cv.fill(-14, -11, 22, 30, "W")
    cv.fill(11, 14, 22, 30, "W")
    cv.room(-30, -14, 22, 30, "W")
    cv.fill(-26, -24, 22, 23, "d")
    cv.fill(-20, -18, 22, 23, "d")
    for x in (-27, -23, -19):
        cv.put(x, 26, "k")
    cv.fill(-29, -27, 28, 29, "l")
    cv.put(-22, 27, "P")
    cv.room(14, 30, 22, 30, "W")
    cv.fill(18, 22, 22, 23, ".")
    cv.fill(26, 28, 22, 23, "d")
    cv.fill(14, 15, 27, 29, "l")
    for x in (17, 21, 25):
        cv.put(x, 26, "k")
    cv.fill(27, 29, 28, 29, "b")
    # --- avenue with a colonnade and a low cover block
    for z in (13, 15, 17):
        cv.put(-5, z, "k")
        cv.put(4, z, "k")
    cv.fill(-1, 1, 16, 17, "n")
    # --- west temple: four doors, four pillars, a rifle inside
    cv.room(-19, -9, 12, 19, "W")
    cv.fill(-10, -9, 14, 16, "d")
    cv.fill(-15, -13, 12, 13, "d")
    cv.fill(-17, -15, 18, 19, "d")
    cv.fill(-19, -18, 14, 16, "d")
    for x, z in ((-16, 14), (-16, 16), (-12, 14), (-12, 16)):
        cv.put(x, z, "k")
    cv.put(-14, 15, "R")
    # --- east temple: ruined (breaches, lowered walls), a pistol inside
    cv.room(9, 19, 12, 19, "W")
    cv.fill(13, 16, 12, 13, ".")
    cv.fill(9, 10, 14, 17, ".")
    cv.fill(11, 14, 18, 19, "w")
    cv.fill(15, 18, 18, 19, ".")
    cv.fill(18, 19, 13, 15, "l")
    cv.put(13, 14, "k")
    cv.put(16, 16, "k")
    cv.fill(11, 13, 16, 17, "b")
    cv.put(14, 15, "P")
    # --- obelisks at the foot of the pyramid, cover on the ring
    cv.fill(11, 13, 10, 12, "O")
    cv.fill(-13, -11, 10, 12, "O")
    cv.fill(-3, -1, 10, 11, "c")
    cv.fill(2, 4, 10, 11, "c")
    cv.put(-7, 10, "R")
    # --- west flank: long outer corridor behind a wall with two doors, sniper at its south end
    cv.fill(-24, -23, 0, 16, "W")
    cv.fill(-24, -23, 4, 6, "d")
    cv.fill(-24, -23, 10, 12, "d")
    cv.put(-28, 3, "S")
    cv.put(-29, 6, "c")
    cv.fill(-27, -25, 9, 10, "b")
    cv.fill(-22, -20, 6, 8, "b")
    cv.fill(-18, -17, 2, 7, "w")
    cv.fill(-17, -14, 6, 7, "l")
    for z in (1, 4):
        cv.put(-14, z, "k")
    # --- east flank: open ground with scattered ruins
    cv.fill(22, 24, 4, 6, "b")
    cv.fill(21, 26, 10, 11, "l")
    cv.fill(25, 26, 11, 14, "l")
    cv.fill(22, 25, 14, 15, "w")
    for x, z in ((26, 7), (23, 18)):
        cv.put(x, z, "k")
    cv.fill(27, 28, 0, 5, "W")
    cv.fill(13, 18, 2, 3, "W")
    cv.fill(17, 18, 3, 7, "W")
    cv.put(14, 6, "k")
    cv.fill(12, 14, 4, 5, "n")
    return cv


if __name__ == "__main__":
    cv = draw()
    if "--dump" in sys.argv:
        cv.dump()
    patches = [(-10, 10, 21, 30, "paving"), (-10, 10, -30, -21, "paving"), (-5, 5, 9, 20, "paving"), (-5, 5, -20, -9, "paving")]
    build_map("pyramid", "Sandstone Pyramid", 30, cv.rows(), LEGEND, patches=patches)
