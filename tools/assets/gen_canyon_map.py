"""Writes client/shared/map_canyon.json: "Canyon Run", two lanes around a long middle corridor (original layout).

Rock cliffs and an adobe hut: a long mid corridor (6 m wide, 28 m long, a rock arch over it) between two rock walls with
connector slots; a west lane with the adobe "site" hut near team A and an east lane with boulders and ruined walls near team A
(the rotation puts the hut on the east lane near team B). Each team starts in a rock pocket with a wide mouth.
Drawn for the team A half (z >= 0); team B is the same drawing rotated 180 degrees.
    python tools/assets/gen_canyon_map.py          (MAP_PNG_DIR=/some/dir also writes a top-down PNG)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapgen_common import Canvas, DOOR, L, WINDOW, build_map  # noqa: E402

LEGEND = {
    "#": L("rock", 6.0),
    "%": L("adobe", 4.0, facade=[(1.2, 2.3)]),
    "d": DOOR("adobe", 2.6, 4.0),
    "w": WINDOW("adobe", 1.0, 2.4, 4.0),
    "l": L("adobe_low", 1.0),
    "b": L("boulder", 1.4),
    "c": L("crate", 1.0),
    "C": L("crate", 2.0),
    "r": L("rock", 6.0, y0=3.5),   # natural rock bridge over the corridor
    "Y": L("rock", 0.9),           # the overlook ledge
    "u": L("rock", 0.3),           # stair steps (0.3 m risers, below the 0.45 m step height)
    "v": L("rock", 0.6),
}
# ramp of 8 steps of 0.1125 m (a slope the player walks up: the physics steps up anything <= 0.45 m)
for _i in range(1, 9):
    LEGEND[str(_i)] = L("rock", round(0.1125 * _i, 4))


def draw():
    cv = Canvas(30)
    # --- cliffs and the two rock walls of the mid corridor
    cv.fill(-30, -23, 0, 30, "#")
    cv.fill(23, 30, 0, 30, "#")
    cv.fill(-9, -3, 0, 14, "#")
    cv.fill(3, 9, 0, 14, "#")
    cv.fill(-9, -3, 7, 9, ".")     # connector slot west mass (z 7..9)
    cv.fill(3, 9, 2, 4, ".")       # connector slot east mass (z 2..4); the rotation adds the mirrored ones near team B
    cv.fill(-3, 3, 10, 12, "r")
    # --- team A pocket (north end): rock all around, 10 m mouth, a screen wall and low arcs inside
    cv.fill(-30, -12, 21, 30, "#")
    cv.fill(12, 30, 21, 30, "#")
    cv.fill(-12, -5, 21, 23, "#")
    cv.fill(5, 12, 21, 23, "#")
    for x in (-8, -6, -4, -2, 1, 3, 5, 7):
        cv.put(x, 26, "A")
    cv.fill(-2, 2, 23, 24, "%")
    cv.fill(-7, -4, 24, 25, "l")
    cv.fill(4, 7, 24, 25, "l")
    # --- mid corridor: sniper at the team A end, a little cover, rifle half-way
    cv.put(0, 13, "S")
    cv.fill(-3, -1, 12, 13, "c")
    cv.fill(1, 3, 5, 6, "C")
    cv.fill(-3, -1, 3, 4, "c")
    cv.put(1, 8, "R")
    # --- west lane: adobe site hut (three doors, two windows), crates inside, boulders outside
    cv.room(-21, -13, 2, 10, "%")
    cv.fill(-14, -13, 5, 7, "d")
    cv.fill(-18, -16, 2, 3, "d")
    cv.fill(-20, -18, 9, 10, "d")
    cv.fill(-16, -15, 9, 10, "w")
    cv.fill(-21, -20, 5, 6, "w")
    cv.put(-18, 6, "C")
    cv.fill(-19, -17, 4, 5, "c")
    cv.put(-16, 7, "R")
    cv.fill(-12, -10, 12, 14, "b")
    cv.fill(-22, -20, 12, 14, "b")
    cv.fill(-17, -15, 13, 14, "l")
    cv.fill(-23, -22, 0, 1, ".")
    # --- east lane (team A side): dry riverbed with boulders and ruined adobe walls
    cv.fill(12, 14, 5, 7, "b")
    cv.fill(17, 19, 9, 11, "b")
    cv.fill(14, 19, 14, 15, "l")
    cv.fill(19, 20, 14, 18, "l")
    cv.fill(10, 12, 15, 17, "b")
    cv.fill(20, 22, 4, 6, "c")
    cv.put(15, 8, "P")
    # --- approach plaza in front of the pocket
    cv.fill(-8, -5, 17, 19, "b")
    cv.fill(5, 8, 16, 18, "b")
    cv.fill(-1, 1, 18, 19, "l")
    cv.put(-18, 18, "P")
    # --- overlook ledge (0.9 m) in the west plaza, reached by a long 8-step ramp from the east
    cv.fill(-22, -14, 14, 18, "Y")
    for i in range(8):
        cv.fill(-7 - i, -6 - i, 14, 17, str(i + 1))
    # --- stairs (0.3 m risers) up onto the low ruined wall of the east lane
    cv.fill(17, 18, 15, 18, "u")
    cv.fill(18, 19, 15, 18, "v")
    return cv


if __name__ == "__main__":
    cv = draw()
    if "--dump" in sys.argv:
        cv.dump()
    patches = [(-5, 5, 24, 30, "dust"), (-5, 5, -30, -24, "dust")]
    build_map("canyon", "Canyon Run", 30, cv.rows(), LEGEND, patches=patches)
