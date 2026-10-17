"""Print a Markdown table (triangles, size, textures, animations) for every glb in client/assets/models. Pure python."""
import json
import os
import struct

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODELS = os.path.join(ROOT, "client", "assets", "models")


def read(path):
    d = open(path, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    return json.loads(d[20:20 + jl]), len(d)


def tris(j):
    n = 0
    for m in j.get("meshes", []):
        for p in m["primitives"]:
            if "indices" in p:
                n += j["accessors"][p["indices"]]["count"] // 3
            else:
                n += j["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    # count each mesh once per node instance
    inst = {}
    for nd in j.get("nodes", []):
        if "mesh" in nd:
            inst[nd["mesh"]] = inst.get(nd["mesh"], 0) + 1
    total = 0
    for mi, m in enumerate(j.get("meshes", [])):
        t = sum((j["accessors"][p["indices"]]["count"] // 3) if "indices" in p else (j["accessors"][p["attributes"]["POSITION"]]["count"] // 3) for p in m["primitives"])
        total += t * inst.get(mi, 1)
    return total


def main():
    rows = []
    grand = 0
    for f in sorted(os.listdir(MODELS)):
        if not f.endswith(".glb"):
            continue
        j, size = read(os.path.join(MODELS, f))
        imgs = len(j.get("images", []))
        mats = len(j.get("materials", []))
        anims = ", ".join(a["name"] for a in j.get("animations", [])) or "-"
        rows.append((f, tris(j), size, mats, imgs, anims))
        grand += size
    print("| File | Triangles | Size | Materials | Images | Animations |")
    print("|------|----------:|-----:|----------:|-------:|------------|")
    for f, t, s, m, i, a in rows:
        print(f"| `{f}` | {t:,} | {s/1024:,.0f} KB | {m} | {i} | {a} |")
    print(f"| **total** | | **{grand/1048576:.2f} MB** | | | |")


if __name__ == "__main__":
    main()
