"""Writes client/shared/map_crossroads.json (collision boxes, spawns, weapon pickups + visual-only decor hints).

An original "crossroads" arena: an EMPTY four-way street intersection (no cars, barriers or street furniture, by request)
framed by four enterable corner buildings and two walled spawn courtyards at the ends of the main avenue. Pure python, deterministic:
    python tools/assets/gen_crossroads_map.py
Visual-only data lives under "decor" (ignored by the server); boxes are the single source of collision.
"""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "shared", "map_crossroads.json")

B = 30.0          # arena half size
ROAD = 6.0        # half road width
WALL_H = 6.0
T = 0.6           # building wall thickness
DOOR_H = 2.6
SILL, WIN_TOP = 1.0, 2.4

boxes, decor = [], []


def box(mat, x0, x1, z0, z1, y0=0.0, y1=1.0):
    boxes.append({"min": [round(x0, 3), y0, round(z0, 3)], "max": [round(x1, 3), y1, round(z1, 3)], "mat": mat})


def wall_run(axis, fixed, a, b, gaps, mat="building", h=WALL_H, t=T):
    """Wall along `axis` ('x': varies x at z=fixed..fixed+t, 'z': varies z at x=fixed..fixed+t) from a..b with gaps
    [(g0, g1, 'door'|'window')]. Doors leave a full-height opening under a lintel; windows leave a sill + lintel."""
    cuts = sorted(gaps)
    pos = a
    segs = []
    for g0, g1, kind in cuts:
        segs.append((pos, g0, 0.0, h))
        if kind == "door":
            segs.append((g0, g1, DOOR_H, h))
        else:
            segs.append((g0, g1, 0.0, SILL))
            segs.append((g0, g1, WIN_TOP, h))
        decor.append({"type": kind, "axis": axis, "fixed": fixed, "t": t, "a": g0, "b": g1,
                      "y0": 0.0 if kind == "door" else SILL, "y1": DOOR_H if kind == "door" else WIN_TOP})
        pos = g1
    segs.append((pos, b, 0.0, h))
    for s0, s1, y0, y1 in segs:
        if s1 - s0 < 1e-6 or y1 - y0 < 1e-6:
            continue
        if axis == "x":
            box(mat, s0, s1, fixed, fixed + t, y0, y1)
        else:
            box(mat, fixed, fixed + t, s0, s1, y0, y1)


def building(sx, sz):
    """Corner building in quadrant (sx, sz) = (+-1, +-1): footprint |x| in 8..27, |z| in 8..22."""
    x0, x1 = (8, 27) if sx > 0 else (-27, -8)
    z0, z1 = (8, 22) if sz > 0 else (-22, -8)
    # wall facing the E-W road (the one at |z| = 8): door + window
    zf = z0 if sz > 0 else z1 - T
    wall_run("x", zf, x0, x1, [(x0 + 4.0, x0 + 6.6, "door"), (x0 + 12.0, x0 + 14.6, "window")])
    # wall facing the N-S avenue (|x| = 8): door + window
    xf = x0 if sx > 0 else x1 - T
    wall_run("z", xf, z0, z1, [(z0 + 3.0, z0 + 5.6, "door"), (z0 + 9.0, z0 + 11.6, "window")])
    # back wall (|z| = 22) and outer side wall (|x| = 27): solid with one window each
    zb = z1 - T if sz > 0 else z0
    wall_run("x", zb, x0, x1, [(x0 + 8.0, x0 + 10.6, "window")])
    xs = x1 - T if sx > 0 else x0
    wall_run("z", xs, z0, z1, [(z0 + 5.0, z0 + 7.6, "window")])


def main():
    # perimeter
    box("outer", -B - 1, B + 1, -B - 1, -B, 0, WALL_H)
    box("outer", -B - 1, B + 1, B, B + 1, 0, WALL_H)
    box("outer", -B - 1, -B, -B, B, 0, WALL_H)
    box("outer", B, B + 1, -B, B, 0, WALL_H)
    for sx in (-1, 1):
        for sz in (-1, 1):
            building(sx, sz)
    # spawn courtyard side walls (|x| = 9..10, |z| in 22..30), solid, with a stencil band
    for sx in (-1, 1):
        for sz in (-1, 1):
            xa, xb = (9.0, 9.8) if sx > 0 else (-9.8, -9.0)
            za, zb = (22.0, B) if sz > 0 else (-B, -22.0)
            box("wall", xa, xb, za, zb, 0, 4.0)
    spawnsA = [{"x": x, "z": 27.5, "yaw": 0.0} for x in (-7, -5, -3, -1, 1, 3, 5, 7)]
    spawnsB = [{"x": x, "z": -27.5, "yaw": 3.141592653589793} for x in (-7, -5, -3, -1, 1, 3, 5, 7)]
    pickups = [
        {"w": 0, "x": 16.5, "z": -17.0}, {"w": 0, "x": -16.5, "z": 17.0}, {"w": 0, "x": -16.5, "z": -17.0}, {"w": 0, "x": 16.5, "z": 17.0},
        {"w": 1, "x": 4.9, "z": 5.0}, {"w": 1, "x": -4.9, "z": -5.0}, {"w": 1, "x": 4.9, "z": -5.0}, {"w": 1, "x": -4.9, "z": 5.0},
        {"w": 3, "x": 26.0, "z": 0.0}, {"w": 3, "x": -26.0, "z": 0.0},  # snipers at the ends of the cross street (long sightline)
    ]
    decor.append({"type": "roads", "half": ROAD, "bound": B})
    out = {
        "name": "Crossroads",
        "bounds": {"minX": -B, "maxX": B, "minZ": -B, "maxZ": B},
        "boxes": boxes,
        "spawns": {"A": spawnsA, "B": spawnsB},
        "pickups": pickups,
        "decor": decor,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {OUT}: {len(boxes)} boxes, {len(decor)} decor items")


if __name__ == "__main__":
    main()
