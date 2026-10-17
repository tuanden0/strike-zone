"""Generic, fictional weapon designs (no real-world firearm is reproduced) used by rifle.py, pistol.py, knife.py
and character.py. Origin = grip, +Y = muzzle direction, +Z = up, +X = right.

Each builder returns {part_name: Builder}. 'body' is always present; animated sub-parts have their own name
(rifle: mag, bolt; pistol: slide, mag) so the client can drive them by node name.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: F401,F403
import common  # noqa: E402


def weapon_materials():
    S = 256  # small objects: 256 px maps are plenty and keep the glb files small
    material("gunmetal", tex="gunmetal", size=S)
    material("polymer", tex="polymer", size=S)
    material("polymer_tan", tex="polymer", tex_kwargs=dict(color=(0.24, 0.27, 0.19)), size=S)
    material("polymer_wood", tex="polymer", tex_kwargs=dict(color=(0.42, 0.22, 0.09)), size=S)  # lacquered wood look for the rifle furniture
    material("steel_dark", tex="steel", color=(0.35, 0.35, 0.38, 1), size=S)
    material("rubber", tex="rubber", size=S)
    material("lens", color=(0.05, 0.09, 0.14, 1), roughness=0.05, metallic=0.0)
    material("red_dot", color=(1, 0.1, 0.05, 1), roughness=0.3, emission=(1, 0.1, 0.05, 1), emission_strength=8.0)
    material("blade", tex="blade", size=S)
    material("brass", color=(0.78, 0.58, 0.22, 1), roughness=0.35, metallic=1.0)
    material("glove", tex="nylon", tex_kwargs=dict(color=(0.11, 0.115, 0.12)), size=S)
    material("glove_pad", tex="rubber", size=S)
    material("sleeve", tex="fabric_camo", color=(0.22, 0.26, 0.19, 1), size=S)


def rifle(detail="high"):
    """Wood-and-steel battle rifle: stamped receiver, gas tube over the barrel, post sight, strongly curved magazine."""
    hi = detail == "high"
    body, mag, bolt = Builder("rifle"), Builder("rifle_mag"), Builder("rifle_bolt")
    g, p, d, w = "gunmetal", "polymer", "steel_dark", "polymer_wood"
    # --- receiver, wooden hand guards, barrel
    body.add(box((0.046, 0.34, 0.07), (0, 0.02, 0.07), bevel=0.005), g, (4, 4))
    body.add(box((0.042, 0.2, 0.055), (0, 0.0, 0.015), bevel=0.005), g, (4, 4))
    body.add(box((0.054, 0.3, 0.05), (0, 0.32, 0.052), bevel=0.014), w, (4, 4))  # lower hand guard
    body.add(box((0.044, 0.26, 0.026), (0, 0.33, 0.1), bevel=0.01), w, (4, 4))  # upper hand guard
    body.add(box((0.03, 0.2, 0.02), (0, 0.04, 0.114), bevel=0.004, segs=1), g, (4, 4))  # receiver dust cover
    body.add(cyl(0.0115, 0.0115, 0.2, (0, 0.55, 0.066), (90, 0, 0), 8), g, (4, 4))  # barrel
    body.add(cyl(0.009, 0.009, 0.3, (0, 0.46, 0.094), (90, 0, 0), 6), g, (4, 4))  # gas tube
    body.add(box((0.026, 0.05, 0.04), (0, 0.6, 0.084), bevel=0.005, segs=1), g, (4, 4))  # front sight block
    body.add(box((0.006, 0.006, 0.034), (0, 0.6, 0.118), bevel=0), g, (4, 4))  # post
    body.add(cyl(0.017, 0.015, 0.05, (0, 0.655, 0.066), (90, 0, 0), 8, bevel=0.002), d, (4, 4))  # slant muzzle brake
    if hi:
        for i in range(5):  # hand guard grooves
            for sx in (-1, 1):
                body.add(box((0.004, 0.012, 0.03), (sx * 0.028, 0.24 + i * 0.045, 0.052), bevel=0), d, (8, 8))
        for i in range(4):  # rear sight ladder and receiver rivets
            body.add(box((0.012, 0.008, 0.008 + i * 0.002), (0, 0.19 + i * 0.012, 0.12 + i * 0.001), bevel=0), d, (8, 8))
        body.add(box((0.006, 0.05, 0.02), (0.024, 0.04, 0.085), bevel=0), d, (8, 8))  # ejection port
        body.add(box((0.012, 0.09, 0.012), (0.026, 0.01, 0.06), bevel=0.002, segs=1), d, (8, 8))  # selector lever
        body.add(box((0.008, 0.02, 0.02), (0.026, 0.14, 0.05), bevel=0.002, segs=1), d, (8, 8))  # mag catch
        body.add(box((0.006, 0.014, 0.02), (0.028, 0.45, 0.06), bevel=0.002, segs=1), d, (8, 8))  # cleaning rod end
    # --- stock: wooden, straight with a small drop
    secs = [(-0.33, 0.04, 0.1, 0.03), (-0.25, 0.04, 0.085, 0.045), (-0.17, 0.037, 0.065, 0.058), (-0.1, 0.032, 0.056, 0.066)]
    body.add(loft([ring((0, y, z), (1, 0, 0), (0, 0, 1), wd, h) for y, wd, h, z in secs]), w, (4, 4))
    body.add(box((0.042, 0.022, 0.1), (0, -0.342, 0.03), (3, 0, 0), bevel=0.006), "rubber", (6, 6))  # butt pad
    # --- grip + trigger group
    body.add(box((0.034, 0.05, 0.105), (0, -0.035, -0.045), (-16, 0, 0), bevel=0.008), w, (6, 6))
    body.add(box((0.012, 0.075, 0.006), (0, 0.07, -0.04), bevel=0.0015, segs=1), g, (4, 4))
    body.add(box((0.012, 0.006, 0.03), (0, 0.105, -0.025), bevel=0.0015, segs=1), g, (4, 4))
    body.add(box((0.01, 0.01, 0.03), (0, 0.07, -0.012), (-20, 0, 0), bevel=0.002, segs=1), d, (4, 4))  # trigger
    body.add(box((0.012, 0.014, 0.034), (0, 0.008, -0.035), bevel=0.002, segs=1), g, (4, 4))
    # --- magazine: steel banana, swept far forward
    rings = []
    pos = Vector((0, 0.07, -0.012))
    for k in range(7):
        step = Vector((0, math.sin(0.15 * k), -math.cos(0.15 * k))) * 0.03
        th = 0.15 * k
        up = Vector((0, math.cos(th), math.sin(th)))
        rings.append(ring(pos, (1, 0, 0), up, 0.03, 0.046))
        pos = pos + Vector((0, math.sin(th), -math.cos(th))) * 0.03
    mag.add(loft(rings), d, (6, 6))
    mag.add(box((0.032, 0.05, 0.01), tuple(pos - step * 0.5), (math.degrees(0.15 * 6), 0, 0), bevel=0.003, segs=1), g, (6, 6))
    if hi:
        for k in range(4):  # ribs
            mag.add(box((0.026, 0.004, 0.014), (0, 0.098, -0.03 - k * 0.026), bevel=0), g, (8, 8))
    # charging handle on the right side of the receiver
    bolt.add(box((0.012, 0.03, 0.02), (0.03, 0.01, 0.1), bevel=0.003, segs=1), d, (6, 6))
    bolt.add(sphere(0.011, loc=(0.04, 0.0, 0.1), segs=6, rings=4), d, (6, 6))
    return {"body": body, "mag": mag, "bolt": bolt}


def sniper(detail="high"):
    """Bolt-action scoped rifle. Grip/trigger/fore-end sit where the rifle's do, so the rifle hold pose fits it."""
    hi = detail == "high"
    body, mag, bolt = Builder("sniper"), Builder("sniper_mag"), Builder("sniper_bolt")
    g, p, d = "gunmetal", "polymer", "steel_dark"
    # --- action, fore-end, long barrel with muzzle brake
    body.add(box((0.048, 0.36, 0.07), (0, 0.04, 0.07), bevel=0.006), g, (4, 4))
    body.add(box((0.052, 0.34, 0.06), (0, 0.3, 0.046), bevel=0.012), "polymer_tan", (4, 4))  # fore-end
    body.add(cyl(0.0135, 0.0105, 0.62, (0, 0.62, 0.07), (90, 0, 0), 10), g, (4, 4))  # heavy barrel
    body.add(cyl(0.021, 0.021, 0.09, (0, 0.95, 0.07), (90, 0, 0), 10, bevel=0.002), d, (4, 4))  # muzzle brake
    if hi:
        for k in range(3):
            body.add(box((0.046, 0.008, 0.012), (0, 0.925 + k * 0.025, 0.07), bevel=0), "rubber", (2, 2))  # brake ports
        body.add(box((0.006, 0.07, 0.02), (0.027, 0.04, 0.09), bevel=0), d, (8, 8))  # ejection port
        body.add(box((0.012, 0.3, 0.008), (0, 0.18, 0.108), bevel=0.002, segs=1), d, (4, 4))  # receiver rail
        for k in range(4):  # barrel flutes
            body.add(box((0.004, 0.14, 0.004), (0.011, 0.42 + 0.0 * k, 0.07 + (k - 1.5) * 0.007), bevel=0), d, (8, 8))
        for y in (0.0, 0.17):  # scope rings
            body.add(cyl(0.027, 0.027, 0.014, (0, y, 0.158), (90, 0, 0), 12), g, (4, 4))
        body.add(cyl(0.013, 0.013, 0.01, (0, 0.085, 0.208), (0, 0, 0), 8), "rubber", (4, 4))  # turret cap
        body.add(cyl(0.013, 0.013, 0.01, (0.049, 0.085, 0.158), (0, 90, 0), 8), "rubber", (4, 4))
    # --- scope: tube, objective bell, eyepiece, mounts, turrets
    body.add(cyl(0.0225, 0.0225, 0.30, (0, 0.08, 0.158), (90, 0, 0), 12), d, (4, 4))
    body.add(cyl(0.0225, 0.034, 0.07, (0, 0.265, 0.158), (90, 0, 0), 12), d, (4, 4))  # objective bell
    body.add(cyl(0.0225, 0.03, 0.05, (0, -0.085, 0.158), (90, 0, 0), 12), d, (4, 4))  # eyepiece
    body.add(cyl(0.029, 0.029, 0.004, (0, 0.30, 0.158), (90, 0, 0), 12), "lens", (1, 1))  # front lens
    body.add(cyl(0.024, 0.024, 0.004, (0, -0.111, 0.158), (90, 0, 0), 12), "lens", (1, 1))  # rear lens
    for y in (0.0, 0.17):
        body.add(box((0.03, 0.03, 0.04), (0, y, 0.12), bevel=0.004, segs=1), g, (4, 4))
    body.add(cyl(0.011, 0.011, 0.03, (0, 0.085, 0.19), (0, 0, 0), 8), g, (4, 4))  # elevation turret
    body.add(cyl(0.011, 0.011, 0.03, (0.03, 0.085, 0.158), (0, 90, 0), 8), g, (4, 4))  # windage turret
    # --- stock: thumbhole-style taper with high cheek piece
    secs = [(-0.34, 0.042, 0.11, 0.055), (-0.26, 0.042, 0.095, 0.07), (-0.17, 0.04, 0.075, 0.075), (-0.1, 0.034, 0.062, 0.07)]
    body.add(loft([ring((0, y, z), (1, 0, 0), (0, 0, 1), w, h) for y, w, h, z in secs]), "polymer_tan", (4, 4))
    body.add(box((0.036, 0.13, 0.026), (0, -0.2, 0.124), (2, 0, 0), bevel=0.008, segs=1), "polymer_tan", (4, 4))  # cheek riser
    body.add(box((0.044, 0.022, 0.115), (0, -0.352, 0.052), (3, 0, 0), bevel=0.006), "rubber", (6, 6))  # recoil pad
    # --- grip + trigger group (same place as the rifle's)
    body.add(box((0.034, 0.05, 0.105), (0, -0.035, -0.045), (-16, 0, 0), bevel=0.008), p, (6, 6))
    body.add(box((0.012, 0.075, 0.006), (0, 0.07, -0.04), bevel=0.0015, segs=1), g, (4, 4))
    body.add(box((0.012, 0.006, 0.03), (0, 0.105, -0.025), bevel=0.0015, segs=1), g, (4, 4))
    body.add(box((0.01, 0.01, 0.03), (0, 0.07, -0.012), (-20, 0, 0), bevel=0.002, segs=1), d, (4, 4))
    if hi:  # folded bipod
        for sx in (-1, 1):
            body.add(cyl(0.005, 0.005, 0.15, (sx * 0.02, 0.5, 0.0), (80, 0, 0), 6), d, (4, 4))
            body.add(box((0.014, 0.03, 0.01), (sx * 0.02, 0.575, -0.026), bevel=0.003, segs=1), "rubber", (4, 4))  # bipod foot
    # --- 5-round box magazine (flush under the action) and the bolt handle (cycles after each shot)
    mag.add(box((0.032, 0.07, 0.06), (0, 0.07, -0.002), bevel=0.004, segs=1), p, (6, 6))
    mag.add(box((0.034, 0.072, 0.008), (0, 0.07, -0.034), bevel=0.002, segs=1), d, (6, 6))
    bolt.add(cyl(0.006, 0.006, 0.045, (0.04, -0.03, 0.075), (0, 90, 0), 8), d, (6, 6))
    bolt.add(sphere(0.016, loc=(0.068, -0.03, 0.075), segs=8, rings=6), "rubber", (4, 4))
    return {"body": body, "mag": mag, "bolt": bolt}


def pistol(detail="high"):
    hi = detail == "high"
    body, slide, mag = Builder("pistol"), Builder("pistol_slide"), Builder("pistol_mag")
    g, p, d = "gunmetal", "polymer", "steel_dark"
    # frame + dust cover + guard
    body.add(box((0.028, 0.15, 0.03), (0, 0.055, 0.04), bevel=0.004), p, (6, 6))
    body.add(box((0.026, 0.07, 0.014), (0, 0.13, 0.03), bevel=0.003, segs=1), p, (6, 6))
    body.add(box((0.012, 0.075, 0.006), (0, 0.065, 0.015), bevel=0.0015, segs=1), p, (6, 6))
    body.add(box((0.012, 0.006, 0.03), (0, 0.1, 0.03), bevel=0.0015, segs=1), p, (6, 6))
    body.add(box((0.01, 0.01, 0.026), (0, 0.04, 0.032), (-18, 0, 0), bevel=0.002, segs=1), d, (6, 6))  # trigger
    # grip with side panels
    body.add(box((0.03, 0.05, 0.105), (0, -0.015, -0.025), (-12, 0, 0), bevel=0.007), p, (6, 6))
    for sx in (-1, 1):
        body.add(box((0.004, 0.04, 0.085), (sx * 0.0165, -0.015, -0.028), (-12, 0, 0), bevel=0.0015, segs=1), "rubber", (10, 10))
    body.add(box((0.032, 0.054, 0.012), (0, -0.04, -0.082), (-12, 0, 0), bevel=0.003, segs=1), d, (6, 6))  # base plate
    body.add(box((0.03, 0.03, 0.016), (0, -0.04, 0.062), (10, 0, 0), bevel=0.004, segs=1), p, (6, 6))  # beavertail
    body.add(box((0.026, 0.012, 0.05), (0, 0.012, -0.012), (-12, 0, 0), bevel=0.003, segs=1), p, (6, 6))  # front strap under the trigger guard
    if hi:
        body.add(box((0.008, 0.014, 0.018), (0, -0.045, 0.093), (-20, 0, 0), bevel=0.002, segs=1), d, (6, 6))  # hammer
        body.add(box((0.012, 0.02, 0.012), (-0.017, 0.04, 0.045), bevel=0.002, segs=1), d, (6, 6))  # slide stop
        body.add(box((0.01, 0.014, 0.01), (0.017, 0.008, 0.03), bevel=0.002, segs=1), d, (6, 6))  # mag release
        for i in range(4):  # rail slots
            body.add(box((0.012, 0.004, 0.003), (0, 0.11 + i * 0.012, 0.0385), bevel=0), d, (8, 8))
    # slide (own node: kicks back when firing): thick, angular, with a top rib and a wedge barrel hood
    slide.add(box((0.036, 0.20, 0.036), (0, 0.065, 0.07), bevel=0.004), g, (6, 6))
    slide.add(box((0.012, 0.19, 0.01), (0, 0.065, 0.093), bevel=0.002, segs=1), d, (6, 6))  # top rib
    slide.add(box((0.026, 0.05, 0.012), (0, 0.14, 0.052), bevel=0.003, segs=1), g, (6, 6))  # barrel hood underside
    slide.add(box((0.005, 0.006, 0.012), (0, 0.158, 0.104), bevel=0), d, (8, 8))  # front sight
    slide.add(box((0.022, 0.012, 0.01), (0, -0.03, 0.1), bevel=0.002, segs=1), d, (6, 6))  # rear sight
    slide.add(cyl(0.0075, 0.0075, 0.02, (0, 0.172, 0.068), (90, 0, 0), 6), d, (6, 6))  # muzzle
    if hi:
        for i in range(6):
            for sx in (-1, 1):
                slide.add(box((0.003, 0.004, 0.028), (sx * 0.0185, -0.03 + i * 0.01, 0.07), bevel=0), d, (8, 8))
        slide.add(box((0.003, 0.05, 0.022), (0.0185, 0.085, 0.075), bevel=0), d, (8, 8))  # ejection port
        for i in range(4):  # front serrations
            for sx in (-1, 1):
                slide.add(box((0.003, 0.004, 0.028), (sx * 0.0185, 0.125 + i * 0.01, 0.07), bevel=0), d, (8, 8))
    mag.add(box((0.024, 0.04, 0.09), (0, -0.012, -0.03), (-12, 0, 0), bevel=0.002, segs=1), d, (6, 6))
    return {"body": body, "slide": slide, "mag": mag}


def knife(detail="high"):
    body = Builder("knife")
    # blade: clip-point profile (y = length, z = width); flat grind down to a central edge line
    spine = [(0.03, 0.017), (0.12, 0.017), (0.2, 0.017)]  # tanto: straight spine, angular tip
    edge = [(0.03, -0.0135), (0.13, -0.0135), (0.16, -0.006)]
    tip = (0.228, 0.017)
    t = 0.0035
    bm = bmesh.new()
    sl = [bm.verts.new((-t, y, z)) for y, z in spine]
    sr = [bm.verts.new((t, y, z)) for y, z in spine]
    ed = [bm.verts.new((0, y, z)) for y, z in edge]
    T = bm.verts.new((0, tip[0], tip[1]))
    n = len(spine)
    for i in range(n - 1):
        bm.faces.new((sl[i], sl[i + 1], ed[i + 1], ed[i]))      # left flat (normal -X)
        bm.faces.new((ed[i], ed[i + 1], sr[i + 1], sr[i]))      # right flat (normal +X)
        bm.faces.new((sr[i], sr[i + 1], sl[i + 1], sl[i]))      # spine (normal +Z)
    bm.faces.new((sl[-1], T, ed[-1]))
    bm.faces.new((ed[-1], T, sr[-1]))
    bm.faces.new((sr[-1], T, sl[-1]))
    body.add(bm, "blade", (6, 6))
    body.add(box((0.0085, 0.1, 0.004), (0, 0.085, 0.006), bevel=0), "steel_dark", (8, 8))  # fuller groove
    body.add(box((0.012, 0.014, 0.058), (0, 0.027, 0.0), bevel=0.003, segs=1), "brass", (6, 6))  # guard
    body.add(box((0.02, 0.012, 0.008), (0, 0.027, 0.03), bevel=0.002, segs=1), "gunmetal", (6, 6))
    prof = [(0.012, 0.02)]
    for i in range(6):  # ridged rubber grip, revolved about Y
        y = 0.02 - 0.018 * i
        prof += [(0.0145, y - 0.003), (0.0125, y - 0.012)]
    prof += [(0.0135, -0.098)]
    body.add(lathe(prof, rot=(-90, 0, 0), segs=8), "rubber", (10, 10))
    body.add(box((0.026, 0.02, 0.026), (0, -0.108, 0), bevel=0.005, segs=1), "brass", (6, 6))  # pommel
    body.add(box((0.004, 0.012, 0.008), (0, -0.12, -0.002), bevel=0.001, segs=1), "gunmetal", (6, 6))  # lanyard tab
    return {"body": body}


# ------------------------------------------------------------------------------------------------ hands
def _mat_from_axes(lx, ly, lz):
    return Matrix(((lx[0], ly[0], lz[0]), (lx[1], ly[1], lz[1]), (lx[2], ly[2], lz[2])))


def _deg(R):
    return tuple(math.degrees(a) for a in R.to_euler("XYZ"))


def _chain(b, start, R, segs, curls, w0=0.019, taper=0.9):
    """Finger: successive boxes; curls[i] rotates about local X before segment i."""
    pos = Vector(start)
    w = w0
    for ln, cu in zip(segs, curls):
        R = R @ Euler((math.radians(cu), 0, 0), "XYZ").to_matrix()
        c = pos + R @ Vector((0, ln / 2, 0))
        b.add(box((w, ln * 1.03, w * 0.9), tuple(c), _deg(R), bevel=0.003, segs=1), "glove", (8, 8))
        pos = pos + R @ Vector((0, ln, 0))
        w *= taper


def glove(b, origin, axes, curl=(70, 80, 60), thumb=(10, 25), left=False, sleeve_len=0.34, sleeve_dir=(0, -1, 0)):
    """Gloved hand + sleeve. Hand frame: fingers +Y, back of hand +Z, thumb on -X (right) / +X (left).
    `axes` = world directions of the hand's local (X, Y, Z)."""
    O = Vector(origin)
    R = _mat_from_axes(*[Vector(a).normalized() for a in axes])
    side = 1 if left else -1
    W = lambda v: O + R @ Vector(v)  # noqa: E731
    b.add(box((0.088, 0.09, 0.036), tuple(W((0, 0.045, 0))), _deg(R), bevel=0.008), "glove", (8, 8))  # palm
    b.add(box((0.078, 0.026, 0.012), tuple(W((0, 0.082, 0.018))), _deg(R), bevel=0.004, segs=1), "glove_pad", (8, 8))  # knuckle guard
    for i, xo in enumerate((-0.033, -0.011, 0.011, 0.033)):
        fl = (0.036, 0.029, 0.023) if i in (1, 2) else (0.032, 0.026, 0.021)
        _chain(b, W((xo, 0.088, 0.0)), R, fl, curl, w0=0.02)
    Rt = R @ Euler((0, 0, math.radians(-side * 25)), "XYZ").to_matrix()
    _chain(b, W((side * 0.044, 0.02, -0.004)), Rt, (0.034, 0.03), thumb, w0=0.022)
    sl = sleeve_len
    D = Vector(sleeve_dir).normalized()
    Rs = tuple(math.degrees(a) for a in Vector((0, 0, 1)).rotation_difference(D).to_euler("XYZ"))
    b.add(cyl(0.040, 0.05, sl, tuple(O + D * (sl / 2 + 0.02)), Rs, 8, bevel=0.003), "sleeve", (4, 4))
    b.add(cyl(0.044, 0.044, 0.035, tuple(O + D * 0.03), Rs, 8), "glove", (6, 6))
