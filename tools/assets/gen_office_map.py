"""Writes client/shared/map_office.json: floor 3 of a real office, traced from its evacuation plan ("So do thoat nan lau 3").

Unlike the other grid maps this one is NOT rotated: the whole floor is drawn as on the plan (top of the plan = -z), so the two
halves differ. Team A spawns in the left stairwell, team B in the right one; both face the building.

Every wall and piece of furniture is a free-size box traced in plan pixels (the photo of the plan, deskewed by 1 degree and
shown 2000 px wide) and converted to metres:
  - structure (walls, doors, columns) and large furniture (desks, tables, counters, sofas, planters) at K = 0.0345 m/px,
    i.e. the real building (~0.023 m/px, about 33 x 20 m) scaled up 1.5x so aisles are wide enough to fight in;
  - small furniture (chairs, stools, potted plants, toilets) keeps its real size and only its position is scaled.
Doors are open doorways, widened to at least 2.1 m so bots fit through (WC stall doors keep their size); stairs are flat (the floor above/below is not built).
    python tools/assets/gen_office_map.py          (MAP_PNG_DIR=/some/dir also writes a top-down PNG)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapgen_common import build_map  # noqa: E402

K = 0.0345            # m per plan px (1.5x the real scale)
CX, CY = 1065, 731    # plan px at the map centre
HX, HZ = 26, 16       # half extents of the bounds (m)
WALL = 3.2            # interior and exterior wall height (open top, like the bunker)
LINTEL = 2.3          # door head height
DOOR_MIN = 2.1        # m: bots need a 1.6 m clear route through doorways

boxes = []            # (mat, x0, x1, z0, z1, y0, y1)
decor = []


def X(px):
    return round((px - CX) * K, 3)


def Z(py):
    return round((py - CY) * K, 3)


def B(mat, x0, x1, y0, y1, h, base=0.0):
    """Box from a plan rectangle (px) scaled with the building."""
    boxes.append((mat, X(x0), X(x1), Z(y0), Z(y1), base, h))


def W(x0, x1, y0, y1, mat="wall"):
    B(mat, x0, x1, y0, y1, WALL)


def small(mat, cx, cy, w, d, h):
    """Real-size item (w x d metres) centred at a scaled plan position."""
    x, z = (cx - CX) * K, (cy - CY) * K
    boxes.append((mat, round(x - w / 2, 3), round(x + w / 2, 3), round(z - d / 2, 3), round(z + d / 2, 3), 0.0, h))


def D(x0, x1, y0, y1, min_w=DOOR_MIN):
    """Doorway through a wall (plan rect = the gap): lintel box + frame decor; widened to min_w along the wall."""
    along_x = (x1 - x0) > (y1 - y0)
    a, b = (X(x0), X(x1)) if along_x else (Z(y0), Z(y1))
    if b - a < min_w:
        m = (a + b) / 2
        a, b = round(m - min_w / 2, 3), round(m + min_w / 2, 3)
    f0, f1 = (Z(y0), Z(y1)) if along_x else (X(x0), X(x1))
    if along_x:
        boxes.append(("wall", a, b, f0, f1, LINTEL, WALL))
    else:
        boxes.append(("wall", f0, f1, a, b, LINTEL, WALL))
    decor.append({"type": "door", "axis": "x" if along_x else "z", "fixed": f0, "t": round(f1 - f0, 3), "a": a, "b": b,
                  "y0": 0.0, "y1": LINTEL})
    return a, b


def Wd(x0, x1, y0, y1, doors, mat="wall", min_w=DOOR_MIN):
    """Wall with doorways cut out: doors = [(p0, p1)] plan px along the wall's long axis."""
    along_x = (x1 - x0) > (y1 - y0)
    lo, hi = (x0, x1) if along_x else (y0, y1)
    cuts = []
    for p0, p1 in doors:
        a, b = D(p0, p1, y0, y1, min_w) if along_x else D(x0, x1, p0, p1, min_w)
        cuts.append((a, b))
    wa, wb = (X(lo), X(hi)) if along_x else (Z(lo), Z(hi))
    pos = wa
    for a, b in sorted(cuts) + [(wb, wb)]:
        if a > pos + 0.01:
            if along_x:
                boxes.append((mat, pos, a, Z(y0), Z(y1), 0.0, WALL))
            else:
                boxes.append((mat, X(x0), X(x1), pos, a, 0.0, WALL))
        pos = max(pos, b)


def Ww(x0, x1, y0, y1, windows):
    """Exterior wall with window bands: windows = [(p0, p1)] plan px along the wall."""
    along_x = (x1 - x0) > (y1 - y0)
    lo, hi = (x0, x1) if along_x else (y0, y1)
    pos = lo
    for a, b in sorted(windows) + [(hi, hi)]:
        if a > pos:
            W(*((pos, a, y0, y1) if along_x else (x0, x1, pos, a)), mat="outer")
        if b > a:
            W(*((a, b, y0, y1) if along_x else (x0, x1, a, b)), mat="window")
        pos = max(pos, b)


def chair(cx, cy, back, real=0.5, h=0.9):
    small(f"chair_{back}", cx, cy, real, real, h)


# ------------------------------------------------------------------------------------------------ structure
# top-left block: unused room, U stair around a stairwell, the left (straight) stair
W(340, 650, 293, 300, "outer")                      # top
W(340, 348, 293, 405, "outer")                      # unused room, left
W(315, 432, 400, 407, "outer")                      # unused room bottom / left stair top
Wd(420, 428, 300, 405, [(305, 335)])                # unused room <-> stair hall
W(315, 322, 400, 625, "outer")                      # left stair, outer side
W(315, 432, 618, 625, "outer")                      # left stair bottom
Wd(425, 432, 405, 618, [(555, 618)])                # left stair door -> pantry
W(425, 445, 405, 445, "column")
B("stairwell", 495, 580, 365, 450, 1.05)            # stairwell eye (balustrade)
Wd(432, 640, 515, 520, [(432, 485)])                # stair lobby <-> pantry
W(640, 650, 293, 695)                               # stair hall / VP01 left wall

# VP01 (top office)
Ww(650, 1452, 345, 352, [(720, 865), (975, 1130), (1240, 1395)])
Wd(650, 1465, 688, 695, [(652, 715), (1415, 1458)])
for x0 in (643, 900, 1165, 1425):
    W(x0, x0 + 45, 403, 440, "column")
W(1463, 1470, 438, 695)                             # VP01 right wall

# top-right block: two elevators (closed), unused room, elevator lobby, the right stair
W(1452, 1700, 283, 392, "elevator")
W(1692, 1775, 282, 290, "outer")
W(1765, 1775, 282, 400, "outer")
Wd(1692, 1800, 392, 402, [(1720, 1755)])            # unused room bottom / right stair top
W(1683, 1710, 400, 428, "column")
Wd(1470, 1700, 500, 505, [(1540, 1630)], mat="glasswall")   # elevator lobby <-> lounge (glass partition, sliding door)
Wd(1700, 1710, 400, 618, [(555, 618)])              # right stair door -> lounge
W(1790, 1800, 392, 628, "outer")
W(1700, 1800, 618, 628, "outer")

# left side: balcony, washrooms, store rooms
W(345, 352, 625, 775, "railing")
W(382, 433, 625, 680)                               # shaft
Wd(425, 433, 680, 750, [(718, 748)])                # pantry <-> balcony
W(408, 437, 750, 780, "column")
W(352, 485, 775, 780)                               # balcony / WC
W(345, 355, 775, 1182, "outer")
W(355, 437, 822, 828, "tile")                       # WC stall partition
Wd(430, 437, 780, 885, [(795, 822), (845, 878)], mat="tile", min_w=0)
W(355, 437, 883, 890, "tile")
Wd(480, 485, 775, 1175, [(892, 950)])               # WC corridor / kitchen counter wall, door to the washroom
W(355, 438, 1037, 1042, "tile")
W(360, 410, 1100, 1106, "tile")
W(411, 438, 1097, 1120, "column")
Wd(433, 438, 1042, 1172, [(1045, 1080), (1135, 1172)], mat="tile", min_w=0)
Wd(480, 578, 950, 955, [(520, 578)])                # store room top (drawn at y 942; moved down to clear the washroom door)
W(573, 580, 955, 1060)
W(485, 578, 1055, 1062)
Wd(573, 580, 1062, 1175, [(1062, 1105)])

# bottom exterior wall (VP02 windows)
Ww(345, 1775, 1172, 1182, [(470, 608), (720, 865), (985, 1110), (1240, 1390), (1505, 1640)])
for x0 in (650, 905, 1165, 1425):
    W(x0, x0 + 44, 1083, 1120, "column")

# meeting room
Wd(1292, 1297, 735, 882, [(740, 778)])
W(1292, 1470, 735, 740)
W(1465, 1470, 740, 882)
W(1292, 1470, 877, 882)

# right side: balcony, washrooms
W(1765, 1775, 628, 770, "railing")
W(1690, 1735, 628, 668)                             # shaft
Wd(1683, 1690, 668, 742, [(708, 740)])              # lounge <-> balcony
W(1682, 1710, 742, 773, "column")
W(1633, 1775, 768, 773)
Wd(1633, 1640, 773, 1172, [(885, 937)])             # VP02 / washroom wall
Wd(1683, 1690, 773, 887, [(778, 812), (838, 876)], mat="tile", min_w=0)
W(1690, 1765, 818, 823, "tile")
W(1683, 1765, 883, 890, "tile")
W(1683, 1765, 1033, 1040, "tile")
Wd(1683, 1690, 1040, 1172, [(1040, 1078), (1125, 1162)], mat="tile", min_w=0)
W(1683, 1712, 1090, 1118, "column")
W(1712, 1765, 1100, 1106, "tile")
W(1765, 1775, 770, 1182, "outer")

# ------------------------------------------------------------------------------------------------ furniture
# VP01: reception desk, cabinet, two 6-seat desk clusters with potted plants
B("counter", 700, 770, 415, 480, 1.05)
B("counter", 770, 850, 445, 485, 1.05)
B("counter", 850, 893, 405, 468, 1.05)
B("cabinet", 722, 750, 378, 415, 1.2)
chair(792, 400, "n", 0.6, 1.1)
chair(792, 498, "s")
for dx in (0, 275):
    B("desk", 1035 + dx, 1094 + dx, 355, 410, 0.75)
    B("desk", 984 + dx, 1127 + dx, 410, 443, 0.75)
    B("desk", 987 + dx, 1128 + dx, 466, 500, 0.75)
    B("desk", 1038 + dx, 1094 + dx, 500, 548, 0.75)
    B("desk", 982 + dx, 1127 + dx, 585, 620, 0.75)
    B("desk", 1032 + dx, 1088 + dx, 620, 688, 0.75)
    for cx in (1010 + dx, 1100 + dx):
        chair(cx, 383, "n")
        chair(cx, 528, "s")
        chair(cx, 650, "s")
    for px in (987, 1027, 1077, 1117):
        small("plant", px + dx, 455, 0.45, 0.45, 1.3)

# pantry: bar counter + stools, kitchen counter + sink, cafe tables
B("counter", 615, 640, 520, 690, 1.05)
for sy in (530, 560, 590, 620, 652, 683):
    small("stool", 604, sy, 0.4, 0.4, 0.75)
B("counter", 485, 512, 780, 862, 0.9)
B("sink", 485, 512, 862, 892, 0.9)
for tx, ty in ((508, 657), (508, 738), (633, 783), (707, 823), (777, 778), (848, 820)):
    small("table", tx, ty, 0.9, 0.9, 0.75)
    for sx in (-1, 1):
        for sz in (-1, 1):
            chair(tx + sx * 21, ty + sz * 21, "e" if sx > 0 else "w", 0.45, 0.85)

# central hall: planters, two 6-seat desk blocks, printer corner
for x0, x1, y0, y1 in ((628, 700, 862, 878), (738, 808, 862, 878), (815, 888, 862, 878), (895, 915, 737, 880), (1195, 1217, 735, 880),
                       (1597, 1635, 955, 973)):
    B("planter", x0, x1, y0, y1, 0.9)
for x0 in (957, 1087):
    B("desk", x0, x0 + 56, 735, 877, 0.75)
    for cy in (757, 805, 853):
        chair(x0 - 17, cy, "w")
        chair(x0 + 73, cy, "e")
B("printer", 1265, 1287, 760, 802, 1.1)
B("cabinet", 1259, 1288, 817, 863, 1.0)

# meeting room + the desk behind it
B("desk", 1350, 1438, 787, 831, 0.75)
for cx in (1366, 1392, 1421):
    chair(cx, 772, "n")
    chair(cx, 846, "s")
B("desk", 1503, 1533, 760, 857, 0.75)
for cy in (785, 830):
    chair(1487, cy, "w")

# lounge (by the right stair)
B("sofa", 1470, 1500, 568, 648, 0.85)
small("armchair", 1512, 542, 0.8, 0.8, 0.85)
small("armchair", 1512, 672, 0.8, 0.8, 0.85)

# washrooms: toilets, vanity counters
for ty in (790, 852, 1072, 1140):
    small("toilet", 374, ty, 0.7, 0.45, 0.8)
    small("toilet", 1748, ty, 0.7, 0.45, 0.8)
B("vanity", 355, 383, 895, 1035, 0.85)
B("vanity", 1737, 1765, 895, 1030, 0.85)

# VP02 (bottom office): 7 double desk rows + 1 single row along the right wall, chairs on both sides
COLUMNS = [(650, 694), (905, 949), (1165, 1209), (1425, 1469)]


def hits_column(cx, cy, r=12):
    return any(x0 - r < cx < x1 + r and 1083 - r < cy < 1120 + r for x0, x1 in COLUMNS)


for i in range(7):
    x0 = 663 + 130 * i
    B("desk", x0, x0 + 57, 933, 1168, 0.75)
    for cy in (958, 1005, 1053, 1100, 1148):
        for cx, back in ((x0 - 13, "w"), (x0 + 70, "e")):
            if not hits_column(cx, cy):
                chair(cx, cy, back)
B("desk", 1607, 1635, 973, 1168, 0.75)
for cy in (1000, 1048, 1095, 1140):
    chair(1591, cy, "w")

# ------------------------------------------------------------------------------------------------ spawns, pickups, floor
POINTS = [
    # team A: left stairwell (x -25.6..-22.1, z -11.2..-3.9)
    ("A", -24.6, -10.4), ("A", -23.0, -10.4), ("A", -24.6, -8.8), ("A", -23.0, -8.8),
    ("A", -24.6, -7.2), ("A", -23.0, -7.2), ("A", -24.6, -5.6), ("A", -23.0, -5.6),
    # team B: right stairwell (x 22.3..25.3, z -11.3..-3.7)
    ("B", 23.0, -10.4), ("B", 24.6, -10.4), ("B", 23.0, -8.8), ("B", 24.6, -8.8),
    ("B", 23.0, -7.2), ("B", 24.6, -7.2), ("B", 23.0, -5.6), ("B", 24.6, -5.6),
    ("R", X(520), Z(600)), ("R", X(1620), Z(660)), ("R", X(1580), Z(820)), ("R", X(760), Z(600)),
    ("P", X(420), Z(960)), ("P", X(1700), Z(960)), ("P", X(1580), Z(450)), ("P", X(560), Z(480)),
    ("S", X(565), Z(908)), ("S", X(1565), Z(908)),           # both ends of the 35 m corridor in front of VP02
]

PATCHES = [
    (X(650), X(1463), Z(352), Z(688), "carpet"),           # VP01
    (X(580), X(1633), Z(933), Z(1172), "carpet"),          # VP02
    (X(1297), X(1465), Z(740), Z(877), "carpet"),          # meeting room
    (X(322), X(425), Z(407), Z(618), "stairs"),            # left stair
    (X(1710), X(1790), Z(402), Z(618), "stairs"),          # right stair
    (X(428), X(640), Z(300), Z(450), "stairs"),            # U stair hall
    (X(355), X(480), Z(780), Z(1172), "wctile"),           # left washrooms
    (X(1640), X(1765), Z(773), Z(1172), "wctile"),         # right washrooms
]

STRUCT = ["column", "outer", "window", "railing", "elevator", "glasswall", "wall", "tile"]  # overlap winner first


def subtract(p, k):
    """Parts of box p (mat, x0, x1, z0, z1, y0, y1) outside box k; [p] when they do not overlap."""
    lo, hi = [p[1], p[5], p[3]], [p[2], p[6], p[4]]   # x, y, z
    klo, khi = [k[1], k[5], k[3]], [k[2], k[6], k[4]]
    if any(min(hi[a], khi[a]) - max(lo[a], klo[a]) <= 1e-6 for a in range(3)):
        return [p]
    out = []
    for a in range(3):  # peel off the slabs of p below / above k along each axis, then clamp p to k on that axis
        if lo[a] < klo[a]:
            h = hi[:]
            h[a] = klo[a]
            out.append((lo[:], h))
            lo[a] = klo[a]
        if hi[a] > khi[a]:
            l_ = lo[:]
            l_[a] = khi[a]
            out.append((l_, hi[:]))
            hi[a] = khi[a]
    return [(p[0], l[0], h[0], l[2], h[2], l[1], h[1]) for l, h in out]


def resolve_overlaps(bxs):
    """Overlapping structure boxes put coplanar faces with different textures on top of each other, which flicker (z-fighting)
    when you stand close. Cut every structure box so no two overlap; the union, and so the collision shape, stays the same."""
    struct = sorted((b for b in bxs if b[0] in STRUCT), key=lambda b: STRUCT.index(b[0]))
    kept = []
    for b in struct:
        parts = [b]
        for k in kept:
            parts = [q for p in parts for q in subtract(p, k)]
        kept += [p for p in parts if min(p[2] - p[1], p[4] - p[3], p[6] - p[5]) > 1e-3]
    return kept + [b for b in bxs if b[0] not in STRUCT]


if __name__ == "__main__":
    boxes = resolve_overlaps(boxes)
    rows = ["." * (2 * HX) for _ in range(2 * HZ)]
    png = os.path.join(os.environ["MAP_PNG_DIR"], "office.png") if os.environ.get("MAP_PNG_DIR") else None
    m = build_map("office", "Office", HX, rows, {}, patches=PATCHES, outer_mat="void", outer_h=WALL, rotate=False, extra=boxes,
                  spawn_yaw=(-math.pi / 2, math.pi / 2), points=POINTS, write=False, png=png)
    m["decor"] += decor
    from mapgen_common import SHARED, write_json  # noqa: E402
    write_json(m, os.path.join(SHARED, "map_office.json"))
    print("wrote", os.path.join(SHARED, "map_office.json"))
