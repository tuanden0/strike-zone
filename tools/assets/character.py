"""Soldier character (two team colours) with armature + animations -> character_a.glb, character_b.glb

Standing height 1.80 m (feet z=0, top of helmet z=1.80), facing +Y in Blender (= -Z in three.js at yaw 0),
sized to fit the shared hitbox spec (client/shared/spec.json: body 0..1.45 m x 0.6 m, head 1.45..1.80 m x 0.36 m).
Rigid-bound parts (one bone per part, overlapping joints) so the rig stays tiny and the export is robust.

Clips: idle, run, crouch, hold_rifle/hold_pistol/hold_knife (arm poses), shoot_rifle/shoot_pistol/shoot_knife, death.
Leg/body clips never key the arm bones and the arm clips never key legs, so the client can layer them.
Weapons (low-poly versions) are children of bone hand.R: nodes w_rifle, w_pistol, w_knife (client toggles visibility).

Run: blender -b -P tools/assets/character.py   (--no-preview skips renders)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403
import weapon_parts as wp  # noqa: E402

FPS = 24
CLIP_FN = {}


def lin(c):
    """sRGB 0..1 -> linear (Blender colour fields are linear)."""
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


TEAMS = {"a": (0.20, 0.45, 0.88), "b": (0.86, 0.25, 0.22)}  # same hues as the HUD (#3b82f6 / #ef4444)

# ------------------------------------------------------------------------------------------------ rest pose
S_R = Vector((0.205, 0.0, 1.40))
S_L = Vector((-0.205, 0.0, 1.40))
ARM_A, ARM_B = 0.29, 0.28  # upper arm / forearm lengths
HAND_LEN = 0.09


def solve_arm(S, H, side, pole=None):
    """Two-bone IK. H = desired palm centre. Returns (elbow, wrist). Hand direction == forearm direction."""
    W = Vector(H)
    E = S + (W - S) * 0.5
    for _ in range(4):
        d = (W - S).length
        d = min(max(d, 0.12), ARM_A + ARM_B - 1e-3)
        axis = (W - S).normalized()
        x = (ARM_A**2 - ARM_B**2 + d**2) / (2 * d)
        h = math.sqrt(max(ARM_A**2 - x**2, 1e-6))
        pole = Vector(pole) if pole is not None else Vector((side * 0.6, -0.1, -1.0))
        perp = (pole - axis * pole.dot(axis)).normalized()
        E = S + axis * x + perp * h
        f = (W - E).normalized()
        W = Vector(H) - f * (HAND_LEN / 2)  # palm centre sits half a hand ahead of the wrist
    return E, W


# weapon hold targets: palm centres relative to weapon origin, weapon origin in body space
HOLDS = {
    "rifle": dict(w0=Vector((0.12, 0.30, 1.27)), rh=Vector((0.03, -0.04, -0.045)), lh=Vector((0.0, 0.295, 0.0))),
    "pistol": dict(w0=Vector((0.03, 0.46, 1.38)), rh=Vector((0.03, -0.04, -0.022)), lh=Vector((-0.03, -0.03, -0.03))),
    "knife": dict(w0=Vector((0.22, 0.36, 1.18)), rh=Vector((0.03, -0.03, -0.045)), lh=None),
}
LEFT_RELAXED = Vector((-0.19, 0.17, 1.07))


def hold_targets(kind):
    h = HOLDS[kind]
    rh = h["w0"] + h["rh"]
    lh = (h["w0"] + h["lh"]) if h["lh"] is not None else LEFT_RELAXED
    return rh, lh


def arm_solution(kind):
    rh, lh = hold_targets(kind)
    Er, Wr = solve_arm(S_R, rh, 1)
    El, Wl = solve_arm(S_L, lh, -1)
    return dict(Er=Er, Wr=Wr, El=El, Wl=Wl)


# ------------------------------------------------------------------------------------------------ armature
BONES = {  # name: (head, tail, parent)
    "root": ((0, 0, 0), (0, 0, 0.12), None),
    "hips": ((0, 0, 0.95), (0, 0, 1.02), "root"),
    "spine": ((0, 0, 1.02), (0, 0, 1.26), "hips"),
    "chest": ((0, 0, 1.26), (0, 0, 1.46), "spine"),
    "neck": ((0, 0, 1.46), (0, 0, 1.56), "chest"),
    "head": ((0, 0, 1.56), (0, 0, 1.80), "neck"),
}
for sd, sx in (("L", -1), ("R", 1)):
    x = 0.095 * sx
    BONES[f"thigh.{sd}"] = ((x, 0, 0.93), (x, 0, 0.50), "hips")
    BONES[f"shin.{sd}"] = ((x, 0, 0.50), (x, 0, 0.11), f"thigh.{sd}")
    BONES[f"foot.{sd}"] = ((x, 0, 0.11), (x, 0.15, 0.03), f"shin.{sd}")
_ARMS = arm_solution("rifle")
for sd, S, E, W in (("R", S_R, _ARMS["Er"], _ARMS["Wr"]), ("L", S_L, _ARMS["El"], _ARMS["Wl"])):
    f = (W - E).normalized()
    BONES[f"upper_arm.{sd}"] = (tuple(S), tuple(E), "chest")
    BONES[f"forearm.{sd}"] = (tuple(E), tuple(W), f"upper_arm.{sd}")
    BONES[f"hand.{sd}"] = (tuple(W), tuple(W + f * HAND_LEN), f"forearm.{sd}")

ORDER = list(BONES.keys())  # parents always precede children


def make_armature():
    arm = bpy.data.armatures.new("Armature")
    ob = bpy.data.objects.new("Armature", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for n in ORDER:
        h, t, par = BONES[n]
        b = arm.edit_bones.new(n)
        b.head, b.tail = Vector(h), Vector(t)
        if par:
            b.parent = eb[par]
        eb[n] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


class Rig:
    def __init__(self, ob):
        self.ob = ob
        self.rest = {n: ob.data.bones[n].matrix_local.copy() for n in ORDER}
        self.rest_dir = {n: (self.rest[n].to_3x3() @ Vector((0, 1, 0))).normalized() for n in ORDER}
        for pb in ob.pose.bones:
            pb.rotation_mode = "QUATERNION"
        self.pose_m = {}

    def pose(self, spec):
        """spec[bone] = dict(rot=(rx,ry,rz deg, world axes about the bone head), dir=Vector world, loc=Vector).
        Bones absent from spec stay at rest relative to their parent."""
        for n in ORDER:
            par = BONES[n][2]
            rest = self.rest[n]
            cur = (self.pose_m[par] @ self.rest[par].inverted() @ rest) if par else rest.copy()
            sp = spec.get(n, {})
            head = cur.translation.copy()
            if "dir" in sp:
                cd = (cur.to_3x3() @ Vector((0, 1, 0))).normalized()
                R = cd.rotation_difference(Vector(sp["dir"]).normalized()).to_matrix().to_4x4()
            elif "rot" in sp:
                R = Euler([math.radians(a) for a in sp["rot"]], "XYZ").to_matrix().to_4x4()
            else:
                R = Matrix.Identity(4)
            m = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ cur
            if "loc" in sp:
                m = Matrix.Translation(Vector(sp["loc"])) @ m
            self.pose_m[n] = m
            pb = self.ob.pose.bones[n]
            base = (self.pose_m[par] @ self.rest[par].inverted() @ rest) if par else rest
            pb.matrix_basis = base.inverted() @ m

    def key(self, bones, frame):
        for n in bones:
            pb = self.ob.pose.bones[n]
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            if n in ("root", "hips"):
                pb.keyframe_insert("location", frame=frame)

    def reset(self):
        self.pose({})


# ------------------------------------------------------------------------------------------------ geometry
def materials(team):
    col = lin(TEAMS[team])
    material("uniform_team_" + team, tex="fabric_camo", color=(col[0] * 1.05, col[1] * 1.05, col[2] * 1.05, 1))
    material("trousers_team_" + team, tex="fabric_camo", color=(col[0] * 0.55, col[1] * 0.55, col[2] * 0.55, 1))
    material("patch_" + team, color=(col[0], col[1], col[2], 1), roughness=0.8)
    material("vest", tex="nylon", tex_kwargs=dict(color=(0.14, 0.15, 0.13)), size=256)
    material("pouch", tex="nylon", tex_kwargs=dict(color=(0.22, 0.23, 0.18)), size=256)
    material("helmet", tex="polymer", tex_kwargs=dict(color=(0.20, 0.23, 0.18)), size=256)
    material("boot", tex="leather", size=256)
    material("sole", tex="rubber", size=256)
    material("skin", tex="skin")
    material("gaiter", tex="nylon", tex_kwargs=dict(color=(0.09, 0.09, 0.10)), size=256)
    material("goggle_lens", color=(0.55, 0.32, 0.08, 1), roughness=0.08, metallic=0.0)
    wp.weapon_materials()


def cyl_between(a, b, r1, r2, segs=8):
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = tuple(math.degrees(v) for v in Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler("XYZ"))
    return cyl(r1, r2, d.length, tuple((a + b) / 2), rot, segs)


def tube(sections, mat_uv=(3, 3)):
    return loft([ring((0, y, z) if False else c, (1, 0, 0), (0, 1, 0), w, d) for c, w, d in sections])


def torso_ring(z, w, d, cx=0.0, cy=0.0):
    return ring((cx, cy, z), (1, 0, 0), (0, 1, 0), w, d)


def build_body(team):
    b = Builder("body_mesh")
    U, T = "uniform_team_" + team, "trousers_team_" + team
    # --- head (bone head) -------------------------------------------------------------------------
    b.add(sphere(0.5, (0.17, 0.205, 0.22), (0, 0.0, 1.655), segs=10, rings=7), "skin", (3, 3), bone="head")
    b.add(sphere(0.5, (0.178, 0.212, 0.115), (0, 0.0, 1.585), segs=10, rings=6), "gaiter", (3, 3), bone="head")  # face mask
    b.add(box((0.19, 0.21, 0.035), (0, 0.0, 1.667), bevel=0.01, segs=1), "gaiter", (4, 4), bone="head")  # goggle strap
    b.add(box((0.15, 0.03, 0.052), (0, 0.108, 1.667), bevel=0.01, segs=1), "rubber", (6, 6), bone="head")  # goggle frame
    b.add(box((0.125, 0.006, 0.036), (0, 0.126, 1.667), bevel=0.0), "goggle_lens", (1, 1), bone="head")
    helmet = lathe([(0.119, 1.705), (0.122, 1.72), (0.12, 1.745), (0.107, 1.775), (0.07, 1.795), (0.0, 1.80)], segs=12, scale=(1.0, 1.13, 1.0))
    b.add(helmet, "helmet", (3, 3), bone="head")
    b.add(box((0.05, 0.03, 0.035), (0, 0.133, 1.757), bevel=0.006, segs=1), "gunmetal", (6, 6), bone="head")  # NVG mount
    b.add(box((0.2, 0.05, 0.1), (0, -0.115, 1.66), bevel=0.012), "helmet", (3, 3), bone="head")  # rear skirt
    b.add(box((0.2, 0.23, 0.02), (0, -0.0, 1.703), bevel=0.006, segs=1), "helmet", (3, 3), bone="head")  # brim
    for sx in (-1, 1):
        b.add(box((0.012, 0.09, 0.03), (sx * 0.123, 0.0, 1.735), bevel=0.003, segs=1), "gunmetal", (6, 6), bone="head")  # side rails
        b.add(box((0.03, 0.09, 0.09), (sx * 0.1, -0.01, 1.64), bevel=0.01, segs=1), "helmet", (3, 3), bone="head")  # ear guards
    b.add(box((0.02, 0.012, 0.05), (0, 0.136, 1.73), bevel=0.003, segs=1), "patch_" + team, (1, 1), bone="head")  # front team stripe
    # --- neck (bone neck) -----------------------------------------------------------------------
    b.add(cyl(0.05, 0.056, 0.14, (0, 0.005, 1.5), (0, 0, 0), 8), "gaiter", (3, 3), bone="neck")
    # --- torso ---------------------------------------------------------------------------------
    belly = loft([torso_ring(0.94, 0.31, 0.205), torso_ring(1.1, 0.33, 0.215), torso_ring(1.27, 0.35, 0.225)])
    b.add(belly, U, (2, 2), bone="spine")
    chest = loft([torso_ring(1.25, 0.37, 0.235), torso_ring(1.36, 0.405, 0.25), torso_ring(1.45, 0.36, 0.215)])
    b.add(chest, U, (2, 2), bone="chest")
    vest = loft([torso_ring(1.13, 0.40, 0.275), torso_ring(1.30, 0.425, 0.295), torso_ring(1.43, 0.385, 0.255)])
    b.add(vest, "vest", (3, 3), bone="chest")
    b.add(box((0.25, 0.045, 0.30), (0, 0.155, 1.30), bevel=0.012), "vest", (3, 3), bone="chest")  # front plate
    for x in (-0.09, 0.0, 0.09):
        b.add(box((0.072, 0.055, 0.12), (x, 0.17, 1.18), bevel=0.01, segs=1), "pouch", (4, 4), bone="chest")  # mag pouches
        b.add(box((0.074, 0.012, 0.03), (x, 0.2, 1.215), bevel=0.003, segs=1), "pouch", (4, 4), bone="chest")
    b.add(box((0.26, 0.07, 0.33), (0, -0.16, 1.283), bevel=0.014), "vest", (3, 3), bone="chest")  # back pack
    for sx in (-1, 1):
        b.add(box((0.085, 0.24, 0.04), (sx * 0.11, 0.0, 1.427), (0, 0, 0), bevel=0.008, segs=1), "vest", (3, 3), bone="chest")  # shoulder straps
        b.add(box((0.06, 0.07, 0.11), (sx * 0.215, 0.05, 1.22), bevel=0.01, segs=1), "pouch", (4, 4), bone="chest")  # side pouch
    b.add(box((0.07, 0.04, 0.1), (-0.14, 0.17, 1.40), bevel=0.008, segs=1), "gunmetal", (4, 4), bone="chest")  # radio
    # belt, hips
    b.add(box((0.355, 0.235, 0.055), (0, 0, 1.0), bevel=0.012, segs=1), "vest", (3, 3), bone="spine")
    for sx in (-1, 1):
        b.add(box((0.05, 0.07, 0.13), (sx * 0.185, 0.02, 0.93), bevel=0.01, segs=1), "pouch", (4, 4), bone="hips")
    hips = loft([torso_ring(0.84, 0.31, 0.215), torso_ring(0.92, 0.335, 0.225), torso_ring(1.0, 0.33, 0.215)])
    b.add(hips, T, (2, 2), bone="hips")
    # --- legs -----------------------------------------------------------------------------------
    for sd, sx in (("L", -1), ("R", 1)):
        x = 0.095 * sx
        thigh = loft([ring((x, 0, 0.93), (1, 0, 0), (0, 1, 0), 0.17, 0.19), ring((x, 0, 0.75), (1, 0, 0), (0, 1, 0), 0.15, 0.17), ring((x, 0, 0.52), (1, 0, 0), (0, 1, 0), 0.125, 0.14)])
        b.add(thigh, T, (2, 2), bone=f"thigh.{sd}")
        b.add(sphere(0.5, (0.13, 0.14, 0.13), (x, 0, 0.5), segs=8, rings=6), T, (2, 2), bone=f"thigh.{sd}")
        b.add(box((0.035, 0.1, 0.14), (x + sx * 0.08, 0.0, 0.72), bevel=0.01, segs=1), "pouch", (4, 4), bone=f"thigh.{sd}")  # cargo pocket
        shin = loft([ring((x, 0, 0.5), (1, 0, 0), (0, 1, 0), 0.125, 0.14), ring((x, 0, 0.3), (1, 0, 0), (0, 1, 0), 0.10, 0.115), ring((x, 0, 0.14), (1, 0, 0), (0, 1, 0), 0.098, 0.11)])
        b.add(shin, T, (2, 2), bone=f"shin.{sd}")
        b.add(box((0.105, 0.065, 0.12), (x, 0.07, 0.5), bevel=0.014), "vest", (4, 4), bone=f"shin.{sd}")  # knee pad
        b.add(box((0.108, 0.13, 0.14), (x, 0.0, 0.14), bevel=0.012), "boot", (3, 3), bone=f"foot.{sd}")  # ankle
        b.add(box((0.105, 0.27, 0.075), (x, 0.065, 0.06), bevel=0.018), "boot", (3, 3), bone=f"foot.{sd}")
        b.add(box((0.1, 0.07, 0.07), (x, 0.17, 0.05), bevel=0.02), "boot", (3, 3), bone=f"foot.{sd}")  # toe cap
        b.add(box((0.112, 0.29, 0.03), (x, 0.06, 0.015), bevel=0.008, segs=1), "sole", (3, 3), bone=f"foot.{sd}")
    # --- arms (rifle hold = rest pose) ------------------------------------------------------------
    for sd, S, E, W, side in (("R", S_R, _ARMS["Er"], _ARMS["Wr"], 1), ("L", S_L, _ARMS["El"], _ARMS["Wl"], -1)):
        b.add(sphere(0.5, (0.104, 0.104, 0.104), tuple(S), segs=8, rings=6), U, (2, 2), bone=f"upper_arm.{sd}")
        b.add(cyl_between(S, E, 0.052, 0.045), U, (2, 2), bone=f"upper_arm.{sd}")
        b.add(box((0.085, 0.095, 0.04), tuple(S + Vector((side * 0.0, 0, 0.026))), bevel=0.01, segs=1), "vest", (3, 3), bone=f"upper_arm.{sd}")  # shoulder armour
        if sd == "R":
            b.add(box((0.012, 0.06, 0.06), tuple(S + (E - S) * 0.4 + Vector((side * 0.052, 0, 0))), bevel=0.003, segs=1), "patch_" + team, (1, 1), bone=f"upper_arm.{sd}")  # team patch
        b.add(sphere(0.5, (0.095, 0.095, 0.095), tuple(E), segs=8, rings=6), U, (2, 2), bone=f"forearm.{sd}")
        b.add(cyl_between(E, W, 0.044, 0.037), U, (2, 2), bone=f"forearm.{sd}")
        b.add(box((0.07, 0.07, 0.07), tuple(E + Vector((0, 0, -0.02)) + (W - E).normalized() * 0.02), bevel=0.012, segs=1), "vest", (4, 4), bone=f"forearm.{sd}")  # elbow pad
        # glove hand along the forearm direction
        f = (W - E).normalized()
        up = Vector((0, 0, 1))
        right = f.cross(up).normalized() * -1
        up2 = right.cross(f).normalized() * -1
        R = Matrix(((right[0], f[0], up2[0]), (right[1], f[1], up2[1]), (right[2], f[2], up2[2])))
        eul = tuple(math.degrees(a) for a in R.to_euler("XYZ"))
        c = W + f * 0.045
        b.add(box((0.082, 0.09, 0.036), tuple(c), eul, bevel=0.008, segs=1), "glove", (6, 6), bone=f"hand.{sd}")
        for i, xo in enumerate((-0.03, -0.01, 0.01, 0.03)):
            sub = Builder("tmp")
            wp._chain(sub, W + R @ Vector((xo, 0.088, 0.0)), R, (0.034, 0.026), (35, 55), w0=0.02)
            for _f in list(sub.bm.faces):
                pass
            b.absorb(sub)
            sub.bm.free()
        sub = Builder("tmp")
        wp._chain(sub, W + R @ Vector((-side * 0.044, 0.02, -0.004)), R, (0.032, 0.026), (5, 30), w0=0.022)
        b.absorb(sub)
        sub.bm.free()
        b.add(cyl_between(W - f * 0.03, W + f * 0.012, 0.043, 0.043), "glove", (4, 4), bone=f"hand.{sd}")  # cuff
    return b


def lod_weapon(kind):
    parts = getattr(wp, kind)("lod")
    b = Builder("w_" + kind)
    for bld in parts.values():
        b.absorb(bld)
        bld.bm.free()
    return b


# ------------------------------------------------------------------------------------------------ animation
def ease(t):
    return t * t * (3 - 2 * t)


def arm_spec(sol):
    """Bone 'dir' specs for both arms from an IK solution (valid while the body is in rest pose)."""
    sp = {}
    for sd, S in (("R", S_R), ("L", S_L)):
        E, W = sol["E" + sd.lower()], sol["W" + sd.lower()]
        sp[f"upper_arm.{sd}"] = dict(dir=E - S)
        sp[f"forearm.{sd}"] = dict(dir=W - E)
        sp[f"hand.{sd}"] = dict(dir=W - E)
    return sp


ARM_BONES = [f"{k}.{s}" for k in ("upper_arm", "forearm", "hand") for s in ("L", "R")]
LEG_BONES = ["hips"] + [f"{k}.{s}" for k in ("thigh", "shin", "foot") for s in ("L", "R")]


def make_clip(rig, name, frames, keyed, fn, loop=True):
    ob = rig.ob
    CLIP_FN[name] = (fn, len(frames))
    act = bpy.data.actions.new(name)
    ob.animation_data.action = act
    n = len(frames)
    for i, f in enumerate(frames):
        rig.reset()
        rig.pose(fn(i, n))
        rig.key(keyed, f)
    ob.animation_data.action = None
    tr = ob.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, int(frames[0]), act)
    rig.reset()
    return act


def clips(rig):
    ob = rig.ob
    ob.animation_data_create()
    # ---- idle (breathing) --------------------------------------------------------------------
    def idle(i, n):
        s = math.sin(2 * math.pi * i / (n - 1))
        return {"hips": dict(loc=Vector((0, 0, 0.004 * s))), "spine": dict(rot=(0.8 * s, 0, 0)), "chest": dict(rot=(1.0 * s, 0, 0)), "head": dict(rot=(-0.8 * s, 0, 0))}
    make_clip(rig, "idle", list(range(1, 50, 2)) + [49], ["hips", "spine", "chest", "head"], lambda i, n: idle(i, n))

    # ---- run (legs, hips, spine lean; arms untouched) ------------------------------------------
    def leg(phase):
        sw = math.sin(phase)
        thigh = 44 * sw + 4
        flex = 6 + 62 * max(0.0, math.cos(phase + 0.5)) ** 1.4
        foot = -0.35 * (thigh - flex) + 4
        return thigh, -flex, foot

    def run(i, n):
        ph = 2 * math.pi * i / (n - 1)
        sp = {"hips": dict(loc=Vector((0, 0, 0.035 * math.cos(2 * ph) - 0.02)), rot=(0, 0, 4 * math.sin(ph))),
              "spine": dict(rot=(7 + 1.5 * math.cos(2 * ph), 0, -3 * math.sin(ph))), "head": dict(rot=(-5, 0, 0))}
        for sd, off in (("L", 0.0), ("R", math.pi)):
            t, s, f = leg(ph + off)
            sp[f"thigh.{sd}"] = dict(rot=(t, 0, 0))
            sp[f"shin.{sd}"] = dict(rot=(s, 0, 0))
            sp[f"foot.{sd}"] = dict(rot=(f, 0, 0))
        return sp
    make_clip(rig, "run", list(range(1, 18)), LEG_BONES + ["spine", "head"], run)

    # ---- crouch (static pose, 2 keys) ----------------------------------------------------------
    def crouch(i, n):
        sp = {"hips": dict(loc=Vector((0, 0, -0.40)), rot=(0, 0, 0)), "spine": dict(rot=(18, 0, 0)), "head": dict(rot=(-12, 0, 0))}
        for sd in ("L", "R"):
            sp[f"thigh.{sd}"] = dict(rot=(78, 0, 0))
            sp[f"shin.{sd}"] = dict(rot=(-112, 0, 0))
            sp[f"foot.{sd}"] = dict(rot=(32, 0, 0))
        return sp
    make_clip(rig, "crouch", [1, 24], LEG_BONES + ["spine", "head"], crouch)

    # ---- arm holds ------------------------------------------------------------------------------
    for kind in ("rifle", "pistol", "knife"):
        sol = arm_solution(kind)
        make_clip(rig, "hold_" + kind, [1, 2], ARM_BONES, lambda i, n, sol=sol: arm_spec(sol))

    # ---- shoot: recoil kick on the held weapon (knife: a slash) ---------------------------------
    for kind in ("rifle", "pistol"):
        rh, lh = hold_targets(kind)
        kick = (0.0, -0.045, 0.014) if kind == "rifle" else (0.0, -0.035, 0.03)

        def shoot(i, n, rh=rh, lh=lh, kick=kick):
            t = i / (n - 1)
            amp = math.sin(math.pi * min(1.0, t * 1.4)) ** 2 * (1 - t) if t < 0.72 else 0.0
            off = Vector(kick) * amp
            Er, Wr = solve_arm(S_R, rh + off, 1)
            El, Wl = solve_arm(S_L, lh + off, -1)
            return arm_spec(dict(Er=Er, Wr=Wr, El=El, Wl=Wl))
        make_clip(rig, "shoot_" + kind, list(range(1, 9)), ARM_BONES, shoot)

    rh, lh = hold_targets("knife")

    def slash(i, n):
        t = i / (n - 1)
        if t < 0.35:  # wind up to the right
            k = ease(t / 0.35)
            p = rh + Vector((0.12, -0.10, 0.10)) * k
        elif t < 0.65:  # sweep across the body
            k = ease((t - 0.35) / 0.3)
            p = rh + Vector((0.12, -0.10, 0.10)) * (1 - k) + Vector((-0.38, 0.10, -0.05)) * k
        else:  # recover
            k = ease((t - 0.65) / 0.35)
            p = rh + Vector((-0.38, 0.10, -0.05)) * (1 - k)
        Er, Wr = solve_arm(S_R, p, 1)
        El, Wl = solve_arm(S_L, lh, -1)
        return arm_spec(dict(Er=Er, Wr=Wr, El=El, Wl=Wl))
    make_clip(rig, "shoot_knife", list(range(1, 15)), ARM_BONES, slash)

    # ---- death: topple backwards (root pivots at the feet), limbs go slack --------------------
    def death(i, n):
        t = ease(i / (n - 1))
        sp = {"root": dict(rot=(86 * t, 0, -6 * t), loc=Vector((0, 0.0 * t, 0.06 * t))),
              "spine": dict(rot=(8 * t, 0, 0)), "head": dict(rot=(-14 * t, 0, 8 * t))}
        for sd, s in (("L", -1), ("R", 1)):
            sp[f"thigh.{sd}"] = dict(rot=(14 * t, 0, s * 8 * t))
            sp[f"shin.{sd}"] = dict(rot=(-18 * t, 0, 0))
            sp[f"upper_arm.{sd}"] = dict(rot=(30 * t, 0, s * 55 * t))
            sp[f"forearm.{sd}"] = dict(rot=(-20 * t, 0, s * 15 * t))
        return sp
    make_clip(rig, "death", list(range(1, 37)), ORDER, death)


# ------------------------------------------------------------------------------------------------ main
def build_team(team, preview):
    fresh()
    scn = bpy.context.scene
    scn.render.fps = FPS
    materials(team)
    arm = make_armature()
    mesh = build_body(team).build()
    mesh.name = "body_mesh"
    mesh.parent = arm
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    rig = Rig(arm)
    # weapons as children of hand.R (positioned for their own hold pose)
    weapon_objs = []
    for kind in ("rifle", "pistol", "knife"):
        wob = lod_weapon(kind).build()
        wob.name = "w_" + kind
        weapon_objs.append((kind, wob))
    clips(rig)
    for kind, wob in weapon_objs:
        sol = arm_solution(kind)
        rig.reset()
        spec = arm_spec(sol)
        rig.pose(spec)
        bone = arm.data.bones["hand.R"]
        P = arm.matrix_world @ rig.pose_m["hand.R"] @ Matrix.Translation((0, bone.length, 0))  # bone children hang off the tail
        T = Matrix.Translation(HOLDS[kind]["w0"])
        wob.parent = arm
        wob.parent_type = "BONE"
        wob.parent_bone = "hand.R"
        wob.matrix_parent_inverse = P.inverted() @ T
        wob.matrix_basis = Matrix.Identity(4)
    rig.reset()
    bpy.context.view_layer.update()
    allobj = [arm, mesh] + [w for _, w in weapon_objs]
    name = "character_" + team
    export_glb(name, allobj, animations=True)
    tris = tri_count([mesh])
    print(f"TRIS {name} body={tris} weapons={[(k, tri_count([w])) for k, w in weapon_objs]}")
    if preview and not NO_PREVIEW:
        rig.reset()
        for k, w in weapon_objs:
            w.hide_render = w.hide_viewport = k != "rifle"
        meshes = [mesh, weapon_objs[0][1]]
        render_previews(name, meshes, views=[("front", 200, 6), ("side", 115, 6), ("back", 25, 12)], size=(700, 900), samples=40, dist=4.6, focus=(0, 0.1, 0.9))
        # animation sanity renders: mid-stride run, crouch, and the death fall (arms in rifle hold unless the clip sets them)
        arm.animation_data.use_nla = False  # NLA strips would overwrite the manual preview pose
        hold = CLIP_FN["hold_rifle"][0](0, 2)
        for label, clip, idx in (("run", "run", 4), ("crouch", "crouch", 1), ("death", "death", 22)):
            fn, n = CLIP_FN[clip]
            spec = dict(hold)
            spec.update(fn(idx, n))
            rig.reset()
            rig.pose(spec)
            bpy.context.view_layer.update()
            render_previews(f"{name}_{label}", meshes, views=[("side", 115, 8)], size=(800, 600), samples=32, dist=4.6, focus=(0, 0.0, 0.8))
        rig.reset()
    return rig, arm, mesh, weapon_objs


if __name__ == "__main__":
    build_team("a", True)
    build_team("b", False)
