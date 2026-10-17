"""Writes client/shared/map_bunker.json: an indoor close-quarters concrete complex (original layout).

Drawn by carving rooms and 3 m corridors out of a solid block: a central hall with pillars, an armory on each flank, two long
N-S side corridors (one 42 m run), E-W corridors north and south of the hall, three rooms in each row, and a walled spawn room
at each end (two doorways). Doorways are 3 m wide. Drawn for the team A half (z >= 0); team B is the same drawing rotated 180 degrees.
    python tools/assets/gen_bunker_map.py          (MAP_PNG_DIR=/some/dir also writes a top-down PNG)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapgen_common import Canvas, DOOR, L, WINDOW, build_map  # noqa: E402

LEGEND = {
    "W": L("concrete", 4.0),
    "d": DOOR("concrete", 2.6, 4.0),
    "g": WINDOW("concrete", 1.0, 2.4, 4.0),
    "p": L("bpillar", 4.0),
    "l": L("lowcover", 0.9),
    "c": L("mcrate", 1.0),
    "C": L("mcrate", 2.0),
    "a": L("concrete", 4.0, y0=3.1),   # ceiling beam across a corridor
}


def draw():
    cv = Canvas(28)
    cv.fill(-28, 28, 0, 28, "W")
    # --- carve: hall, armories, side corridors, E-W corridors, rooms, spawn room
    cv.fill(-9, 9, 0, 6, ".")                                    # central hall (z -6..6 with the rotation)
    cv.fill(-25, -14, 0, 6, ".")                                 # west armory
    cv.fill(14, 25, 0, 6, ".")                                   # east armory
    cv.fill(-13, -10, 0, 21, ".")                                # west long corridor
    cv.fill(10, 13, 0, 21, ".")                                  # east long corridor
    cv.fill(-26, 26, 7, 10, ".")                                 # north E-W corridor
    cv.fill(-26, 26, 18, 21, ".")                                # front E-W corridor (in front of the spawn room)
    cv.fill(-26, -14, 11, 17, ".")                               # west room
    cv.fill(-9, 9, 11, 17, ".")                                  # centre room
    cv.fill(14, 26, 11, 17, ".")                                 # east room
    cv.fill(-8 - 1, 9, 22, 28, ".")                              # spawn room
    # --- doors (3 m): hall, armories, rooms, spawn room
    cv.fill(-6, -3, 6, 7, "d")
    cv.fill(3, 6, 6, 7, "d")
    cv.fill(-10, -9, 3, 5, "d")                                  # hall west wall (the rotation adds z -5..-3)
    cv.fill(9, 10, 1, 3, "d")                                    # hall east wall (z 1..3; rotation z -3..-1 on the west)
    cv.fill(-14, -13, 2, 5, "d")                                 # west armory <-> corridor
    cv.fill(13, 14, 1, 4, "d")                                   # east armory <-> corridor
    cv.fill(-21, -18, 6, 7, "d")                                 # west armory <-> north corridor
    cv.fill(17, 20, 6, 7, "d")                                   # east armory <-> north corridor
    cv.fill(-24, -21, 10, 11, "d")                               # west room <-> north corridor
    cv.fill(-19, -16, 17, 18, "d")                               # west room <-> front corridor
    cv.fill(-14, -13, 13, 16, "d")                               # west room <-> corridor
    cv.fill(-6, -3, 10, 11, "d")
    cv.fill(3, 6, 10, 11, "d")                                   # centre room <-> north corridor
    cv.fill(-1, 2, 17, 18, "d")                                  # centre room <-> front corridor
    cv.fill(-10, -9, 12, 15, "d")                                # centre room <-> west corridor
    cv.fill(9, 10, 13, 16, "d")                                  # centre room <-> east corridor
    cv.fill(13, 14, 12, 15, "d")                                 # east room <-> corridor
    cv.fill(17, 20, 10, 11, "d")                                 # east room <-> north corridor
    cv.fill(22, 25, 17, 18, "d")                                 # east room <-> front corridor
    cv.fill(-6, -3, 21, 22, "d")
    cv.fill(3, 6, 21, 22, "d")                                   # spawn room <-> front corridor
    # --- windows (sight lines through the walls)
    cv.fill(-4, -2, 17, 18, "g")
    cv.fill(2, 4, 10, 11, "g")
    cv.fill(-25, -23, 17, 18, "g")
    cv.fill(22, 24, 10, 11, "g")
    # --- spawn room
    for x in (-7, -5, -3, -1, 0, 2, 4, 6):
        cv.put(x, 25, "A")
    cv.fill(-1, 1, 22, 23, "l")
    cv.fill(-9, -8, 27, 28, "p")
    cv.fill(8, 9, 27, 28, "p")
    # --- central hall: pillars, two low barriers (z +-3.5), rifle at the centre
    for x, z in ((-5, 2), (4, 2)):
        cv.put(x, z, "p")
    cv.fill(-2, 2, 3, 4, "l")
    cv.put(0, 1, "R")
    cv.put(-8, 5, "c")
    cv.put(7, 5, "c")
    # --- armories
    cv.fill(-24, -21, 1, 3, "C")
    cv.fill(-19, -15, 4, 5, "l")
    cv.put(-17, 2, "P")
    cv.fill(15, 19, 1, 2, "l")
    cv.fill(22, 24, 3, 5, "C")
    cv.put(20, 3, "p")
    # --- rooms
    cv.put(-22, 13, "p")
    cv.put(-18, 13, "p")
    cv.fill(-25, -23, 15, 16, "c")
    cv.put(-20, 14, "R")
    cv.fill(-5, -2, 13, 14, "l")
    cv.fill(2, 5, 14, 15, "l")
    cv.put(-6, 16, "c")
    cv.put(5, 11, "c")
    cv.fill(16, 18, 13, 15, "C")
    cv.fill(21, 24, 12, 13, "l")
    cv.put(22, 15, "P")
    # --- corridors: a little cover, beams over the junctions, sniper at the north end of the west long corridor
    cv.fill(-20, -18, 7, 8, "c")
    cv.fill(14, 16, 9, 10, "c")
    cv.fill(-18, -16, 20, 21, "c")
    cv.fill(16, 18, 18, 19, "c")
    for x0 in (-13, 10):
        cv.fill(x0, x0 + 3, 8, 9, "a")
        cv.fill(x0, x0 + 3, 19, 20, "a")
    cv.put(-12, 20, "S")
    return cv


if __name__ == "__main__":
    cv = draw()
    if "--dump" in sys.argv:
        cv.dump()
    build_map("bunker", "Bunker", 28, cv.rows(), LEGEND, outer_h=4.0)
