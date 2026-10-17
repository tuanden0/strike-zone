"""Shared Blender helpers for the asset scripts (run with `blender -b -P script.py` or `python script.py` using the bpy module).

Everything is deterministic: fixed seeds, no randomness from time or the environment.
"""
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(ROOT, "client", "assets", "models")
PREVIEWS = os.path.join(ROOT, "docs", "previews")
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import texgen  # noqa: E402

NO_PREVIEW = "--no-preview" in sys.argv


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _tex_cache.clear()
    _mat_cache.clear()
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    return sc


# ------------------------------------------------------------------ textures & materials
_tex_cache = {}
_mat_cache = {}


def _image(name, arr, srgb):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"  # must precede pixel writes (it resets the buffer)
    rgba = np.concatenate([arr[..., :3], np.ones((h, w, 1))], -1).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    img.pack()
    return img


def texset(kind, size=None, **kw):
    """Generate (and cache) the images for a texgen generator. Returns dict(base,normal,orm) of bpy images."""
    key = (kind, size, tuple(sorted(kw.items())))
    if key in _tex_cache:
        return _tex_cache[key]
    gen = texgen.GENERATORS[kind]
    args = dict(kw)
    if size:
        args["n"] = size
    d = gen(**args)
    tag = kind + ("_" + "_".join(str(v) for v in kw.values()) if kw else "")
    out = {"base": _image(tag + "_base", d["base"], True)}
    if d.get("normal") is not None:
        out["normal"] = _image(tag + "_nrm", d["normal"], False)
    if d.get("orm") is not None:
        out["orm"] = _image(tag + "_orm", d["orm"], False)
    _tex_cache[key] = out
    return out


def material(name, tex=None, color=(1, 1, 1, 1), roughness=0.8, metallic=0.0, emission=None, emission_strength=1.0,
             normal_strength=1.0, tex_kwargs=None, size=None):
    """Principled PBR material. If `tex` (texgen name) is given, base/normal/ORM maps are wired in;
    scalar roughness/metallic are then ignored (the ORM map drives them) and `color` multiplies the base map."""
    if name in _mat_cache:
        return _mat_cache[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if tex:
        t = texset(tex, size, **(tex_kwargs or {}))
        im = nt.nodes.new("ShaderNodeTexImage")
        im.image = t["base"]
        if tuple(color) != (1, 1, 1, 1):
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.inputs["B"].default_value = color
            nt.links.new(im.outputs["Color"], mix.inputs["A"])
            nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        else:
            nt.links.new(im.outputs["Color"], bsdf.inputs["Base Color"])
        if "normal" in t:
            n = nt.nodes.new("ShaderNodeTexImage")
            n.image = t["normal"]
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = normal_strength
            nt.links.new(n.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        if "orm" in t:
            o = nt.nodes.new("ShaderNodeTexImage")
            o.image = t["orm"]
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(o.outputs["Color"], sep.inputs["Color"])
            nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
            nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Base Color"].default_value = color
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    _mat_cache[name] = m
    return m


# ------------------------------------------------------------------ geometry builders (bmesh)
def _xform(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    m = Matrix.LocRotScale(Vector(loc), Euler([math.radians(a) for a in rot], "XYZ"), Vector(scale))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def box(size, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    if bevel > 0:
        b = min(bevel, min(size) * 0.45)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, offset_type="OFFSET", segments=segs, profile=0.5, affect="EDGES")
    return _xform(bm, loc, rot)


def cyl(r1, r2=None, depth=1.0, loc=(0, 0, 0), rot=(0, 0, 0), segs=12, caps=True, bevel=0.0):
    """Cylinder/cone along local Z."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r1 if r2 is None else r2, depth=depth)
    if bevel > 0 and caps:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.8]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=1, profile=0.5, affect="EDGES")
    return _xform(bm, loc, rot)


def sphere(r=0.5, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), segs=12, rings=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    return _xform(bm, loc, rot, scale)


def lathe(profile, loc=(0, 0, 0), rot=(0, 0, 0), segs=16, scale=(1, 1, 1)):
    """Revolve [(radius, z), ...] around Z (open ends capped)."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                bm.faces.new((a[0], b[j], b[i]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    for ring in (rings[0], rings[-1]):
        if len(ring) > 2:
            bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _xform(bm, loc, rot, scale)


def grid_panel(w, h, nx, ny, fn, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Height-field panel in local XY facing +Z; fn(u,v)->z displacement (u,v in metres from corner)."""
    bm = bmesh.new()
    vs = [[bm.verts.new((i * w / nx, j * h / ny, fn(i * w / nx, j * h / ny))) for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    return _xform(bm, loc, rot)


def planar_uv(bm, scale=(1.0, 1.0), offset=(0.0, 0.0)):
    """Box-projected UVs in metres * scale (tiles per metre). Call AFTER all transforms of this part."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            if ax == 0:
                u, v = c.y, c.z
            elif ax == 1:
                u, v = c.x, c.z
            else:
                u, v = c.x, c.y
            l[uv].uv = (u * scale[0] + offset[0], v * scale[1] + offset[1])
    return bm


class Builder:
    """Accumulates bmesh parts into ONE mesh object with a material slot per material name."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []  # material names in slot order
        self.groups = []  # vertex-group names (for skinning)
        self.uv = self.bm.loops.layers.uv.verify()
        self.dl = self.bm.verts.layers.deform.verify()

    def add(self, part, mat, uv=None, bone=None):
        """part: bmesh. uv: (su, sv) tiles-per-metre for box projection (None = keep existing / (1,1))."""
        if uv is not False:
            planar_uv(part, uv or (1.0, 1.0))
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        if bone is not None and bone not in self.groups:
            self.groups.append(bone)
        gi = self.groups.index(bone) if bone is not None else None
        puv = part.loops.layers.uv.verify()
        vmap = {}
        for v in part.verts:
            nv = self.bm.verts.new(v.co)
            if gi is not None:
                nv[self.dl][gi] = 1.0
            vmap[v] = nv
        for f in part.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = mi
            for lo, ln in zip(f.loops, nf.loops):
                ln[self.uv].uv = lo[puv].uv
        part.free()

    def absorb(self, other, bone=None):
        """Copy all geometry of another Builder into this one (materials matched by name); optional rigid skin weight."""
        if bone is not None and bone not in self.groups:
            self.groups.append(bone)
        gi = self.groups.index(bone) if bone is not None else None
        vmap = {}
        for v in other.bm.verts:
            vmap[v] = self.bm.verts.new(v.co)
            if gi is not None:
                vmap[v][self.dl][gi] = 1.0
        for f in other.bm.faces:
            mat = other.mats[f.material_index]
            if mat not in self.mats:
                self.mats.append(mat)
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = self.mats.index(mat)
            for lo, ln in zip(f.loops, nf.loops):
                ln[self.uv].uv = lo[other.uv].uv

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    def build(self, split_angle=50.0):
        bm = self.bm
        bm.normal_update()  # parts are authored with correct winding; no global recalc (open shells would flip)
        lim = math.radians(split_angle)
        hard = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > lim]
        if hard:
            bmesh.ops.split_edges(bm, edges=hard)
        for f in bm.faces:
            f.smooth = True
        bmesh.ops.triangulate(bm, faces=bm.faces)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        for mn in self.mats:
            me.materials.append(bpy.data.materials[mn])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for g in self.groups:
            ob.vertex_groups.new(name=g)
        bm.free()
        return ob


# ------------------------------------------------------------------ export / stats / preview
def tri_count(objs):
    n = 0
    for o in objs:
        if o.type == "MESH":
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def export_glb(name, objs, animations=False, extras=None):
    os.makedirs(MODELS, exist_ok=True)
    path = os.path.join(MODELS, name + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(
        filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
        export_image_format="JPEG", export_jpeg_quality=85, export_image_quality=85,
        export_cameras=False, export_lights=False, export_extras=False,
        export_animations=animations, export_skins=True,
    )
    if animations:
        kw.update(export_animation_mode="ACTIONS", export_force_sampling=True, export_optimize_animation_size=False,
                  export_anim_single_armature=True)
    bpy.ops.export_scene.gltf(**kw)
    size = os.path.getsize(path)
    print(f"EXPORT {name}.glb  tris={tri_count(objs)}  bytes={size}")
    return path, size


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


def _look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_previews(name, objs, views=None, size=(900, 675), samples=40, focus=None, dist=None):
    """Render PNGs to docs/previews/<name>_<view>.jpg with Cycles (CPU). views: [(label, azimuth_deg, elevation_deg)]."""
    if NO_PREVIEW:
        return []
    os.makedirs(PREVIEWS, exist_ok=True)
    sc = bpy.context.scene
    for o in list(bpy.data.objects):  # idempotent: drop rig lights/camera/ground from an earlier call
        if o.name.startswith(("PrevSun", "PrevCam", "PrevGround")):
            bpy.data.objects.remove(o, do_unlink=True)
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 90
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    lo, hi = bounds(objs)
    center = Vector(focus) if focus else (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.05)
    # world: soft sky
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs["Strength"].default_value = 0.9
    sc.world = w
    # ground shadow catcher-ish plane
    bpy.ops.mesh.primitive_plane_add(size=radius * 12, location=(center.x, center.y, lo.z - 0.002))
    gp = bpy.context.object
    gp.name = "PrevGround"
    gm = bpy.data.materials.new("PrevGround")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.33, 0.35, 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    gp.data.materials.append(gm)
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 3.2
    sun.angle = math.radians(8)
    so = bpy.data.objects.new("PrevSun", sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    sc.collection.objects.link(so)
    cam = bpy.data.objects.new("PrevCam", bpy.data.cameras.new("PrevCam"))
    cam.data.lens = 50
    sc.collection.objects.link(cam)
    sc.camera = cam
    views = views or [("front", 25, 12), ("side", 115, 10), ("back", 205, 18)]
    d = dist or radius * 3.0
    out = []
    for label, az, el in views:
        if isinstance(az, dict):  # explicit camera: {"loc": (x,y,z), "target": (x,y,z), "lens": mm}
            cam.location = Vector(az["loc"])
            cam.data.lens = az.get("lens", 40)
            _look_at(cam, az["target"])
        else:
            cam.data.lens = 50
            a, e = math.radians(az), math.radians(el)
            cam.location = center + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * d
            _look_at(cam, center)
        path = os.path.join(PREVIEWS, f"{name}_{label}.jpg")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        out.append(path)
        print("PREVIEW", path)
    return out


def assemble(root_name, parts, extra=None):
    """Build each Builder in `parts` ({node_name: Builder}) into objects parented under an Empty root."""
    root = bpy.data.objects.new(root_name, None)
    bpy.context.scene.collection.objects.link(root)
    objs = [root]
    for nm, bld in parts.items():
        ob = bld.build()
        ob.name = nm
        ob.parent = root
        objs.append(ob)
    return root, objs


def ring(center, right, up, w, h, ch=0.25):
    """Chamfered-rectangle cross-section (8 verts) around `center`; right/up are unit vectors."""
    c, r, u = Vector(center), Vector(right), Vector(up)
    hw, hh = w / 2, h / 2
    k = min(hw, hh) * ch * 2
    pts = [(-hw + k, -hh), (hw - k, -hh), (hw, -hh + k), (hw, hh - k), (hw - k, hh), (-hw + k, hh), (-hw, hh - k), (-hw, -hh + k)]
    return [c + r * x + u * y for x, y in pts]


def loft(rings, caps=True):
    """Close a tube through successive equal-length vert rings (counter-clockwise seen from the +path end)."""
    bm = bmesh.new()
    vr = [[bm.verts.new(v) for v in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vr, vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], b[i], b[j], a[j]))
    if caps:
        bm.faces.new(vr[0][::-1])
        bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # closed shell: safe
    return bm
