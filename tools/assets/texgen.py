"""Deterministic procedural textures (numpy only). All maps are periodic so they tile.

Each generator returns dict(base=HxWx3 float 0..1 sRGB, normal=HxWx3 (OpenGL, tangent space) | None,
orm=HxWx3 (R=ao, G=roughness, B=metalness) | None). Row 0 is the BOTTOM row (Blender image order).
"""
import numpy as np


def _rng(seed):
    return np.random.default_rng(seed)


def pnoise(n, beta, seed, stretch=(1.0, 1.0)):
    """Periodic 1/f^beta noise, standardized (mean 0, std 1). stretch scales frequency per axis (x,y)."""
    w = _rng(seed).standard_normal((n, n))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(n)[:, None] * stretch[1]
    fx = np.fft.fftfreq(n)[None, :] * stretch[0]
    f = np.sqrt(fx**2 + fy**2)
    f[0, 0] = 1.0
    F = F / f**beta
    F[0, 0] = 0
    a = np.real(np.fft.ifft2(F))
    return (a - a.mean()) / (a.std() + 1e-9)


def fbm(n, seed, lo=2.4, hi=1.0):
    return 0.6 * pnoise(n, lo, seed) + 0.4 * pnoise(n, hi, seed + 101)


def smooth01(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_height(h, strength=2.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -dx * strength, -dy * strength, np.ones_like(h)
    l = np.sqrt(nx**2 + ny**2 + nz**2)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


def rgb(r, g, b, n):
    return np.stack([np.full((n, n), c) for c in (r, g, b)], -1)


def tint(base_rgb, v):
    """base_rgb tuple (0..1), v HxW multiplier."""
    return np.clip(np.stack([v * c for c in base_rgb], -1), 0, 1)


def grid(n):
    y, x = np.mgrid[0:n, 0:n]
    return x / n, y / n


def dots(n, seed, count, rad_px, soft=1.5):
    """Random dark/light blobs as 0..1 mask, periodic."""
    rng = _rng(seed)
    m = np.zeros((n, n))
    yy, xx = np.mgrid[0:n, 0:n]
    for _ in range(count):
        cx, cy = rng.uniform(0, n, 2)
        r = rng.uniform(0.4, 1.0) * rad_px
        dx = np.minimum(abs(xx - cx), n - abs(xx - cx))
        dy = np.minimum(abs(yy - cy), n - abs(yy - cy))
        m = np.maximum(m, np.clip(1 - np.sqrt(dx**2 + dy**2) / r, 0, 1) ** (1 / soft))
    return m


def scratches(n, seed, count, length=60):
    rng = _rng(seed)
    m = np.zeros((n, n))
    for _ in range(count):
        x, y = rng.uniform(0, n, 2)
        a = rng.uniform(0, np.pi)
        for t in range(int(rng.uniform(0.3, 1) * length)):
            xi, yi = int(x + t * np.cos(a)) % n, int(y + t * np.sin(a)) % n
            m[yi, xi] = rng.uniform(0.5, 1)
    return m


# ---------------------------------------------------------------- map materials
def concrete(n=512, seed=1):
    h = fbm(n, seed)
    pits = dots(n, seed + 3, 140, 2.2)
    stain = smooth01(pnoise(n, 2.6, seed + 7), 0.2, 1.6)
    v = 0.60 + 0.07 * h - 0.18 * pits - 0.10 * stain
    base = tint((1.0, 1.0, 1.03), v)
    x, y = grid(n)
    seam = (np.minimum(x, 1 - x) < 2.0 / n) | (np.minimum(y, 1 - y) < 2.0 / n)  # formwork panel joints
    base[seam] *= 0.62
    for cx, cy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):  # tie holes
        d = np.sqrt(((x - cx) * n) ** 2 + ((y - cy) * n) ** 2)
        base[d < 5] *= 0.45
        pits = np.maximum(pits, (d < 5).astype(float))
    ht = 0.5 * h + 1.5 * pits * -1 - seam * 2.0
    rough = np.clip(0.88 + 0.05 * h - 0.05 * pits, 0.6, 1.0)
    return dict(base=base, normal=normal_from_height(ht * 0.8, 3.0),
                orm=np.stack([1 - 0.5 * pits, rough, np.zeros((n, n))], -1))


def floor_tile(n=512, seed=2):
    h = fbm(n, seed)
    x, y = grid(n)
    oil = smooth01(pnoise(n, 3.0, seed + 11), 0.9, 1.9)
    scuff = scratches(n, seed + 5, 90, 40)
    v = 0.52 + 0.06 * h - 0.14 * oil + 0.05 * scuff
    base = tint((1.0, 1.0, 1.02), v)
    joint = (np.minimum(x, 1 - x) < 3.0 / n) | (np.minimum(y, 1 - y) < 3.0 / n)
    base[joint] *= 0.45
    ht = 0.3 * h - joint * 2.5
    rough = np.clip(0.78 + 0.1 * h - 0.25 * oil, 0.4, 1)
    return dict(base=base, normal=normal_from_height(ht, 2.5),
                orm=np.stack([np.ones((n, n)), rough, np.zeros((n, n))], -1))


def outer_panel(n=512, seed=3):
    """Non-tiling in V: lower dark concrete, hazard band, upper panelled wall. u tiles every 4 m."""
    h = fbm(n, seed)
    x, y = grid(n)
    v = 0.40 + 0.05 * h
    base = tint((0.95, 1.0, 1.08), v)
    base[y > 0.36] = tint((0.8, 0.88, 1.0), 0.42 + 0.05 * h)[y > 0.36]
    band = (y > 0.28) & (y < 0.34)
    stripe = (((x * 8 + y * 8) % 1.0) < 0.5)
    base[band & stripe] = (0.80, 0.62, 0.10)
    base[band & ~stripe] = (0.07, 0.07, 0.08)
    seam = (np.minimum(x, 1 - x) < 2.0 / n) | (abs(y - 0.68) < 1.5 / n) | (abs(y - 0.97) < 1.5 / n)
    base[seam] *= 0.55
    grime = smooth01(1 - y, 0.4, 1.0) * smooth01(pnoise(n, 2.2, seed + 4), -0.3, 1.5)
    base *= (1 - 0.25 * grime)[..., None]
    ht = 0.4 * h - seam * 2.0 - band * 0.8
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(ht, 2.5),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.82), np.zeros((n, n))], -1))


def wood(n=512, seed=4):
    """Four horizontal planks per tile, grain along x, nail heads."""
    x, y = grid(n)
    grain = pnoise(n, 1.6, seed, stretch=(1.0, 0.05))
    knots = dots(n, seed + 2, 10, 7)
    plank = np.floor(y * 4)
    shade = np.array([0.0, 0.07, -0.05, 0.04])[plank.astype(int) % 4]
    v = 0.52 + 0.09 * grain + shade - 0.12 * knots
    base = tint((1.0, 0.72, 0.42), v)
    gap = (abs((y * 4) % 1.0) < 0.025) | (abs((y * 4) % 1.0) > 0.975)
    base[gap] *= 0.25
    for k in range(4):
        for cx in (0.06, 0.94):
            d = np.sqrt(((x - cx) * n) ** 2 + ((y - (k + 0.5) / 4) * n) ** 2)
            base[d < 4] = (0.30, 0.30, 0.32)
    ht = 0.5 * grain - 3 * gap + 0.8 * knots
    rough = np.clip(0.78 + 0.08 * grain, 0.5, 1)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(ht, 2.2),
                orm=np.stack([np.ones((n, n)), rough, np.zeros((n, n))], -1))


def container_metal(n=512, seed=5):
    """Painted corrugated steel: vertical ribs baked into shading, rust at the bottom, scratches."""
    x, y = grid(n)
    rib = 0.5 + 0.5 * np.sin(x * 2 * np.pi * 8)
    h = fbm(n, seed)
    rust = smooth01(pnoise(n, 2.2, seed + 3) + 1.2 * (1 - y) - 0.6, 0.7, 1.8) * 0.8
    sc = scratches(n, seed + 9, 70, 70)
    v = 0.62 + 0.04 * h + 0.08 * rib
    base = tint((0.50, 0.64, 0.44), v)
    base = base * (1 - rust[..., None]) + np.array((0.38, 0.19, 0.09)) * rust[..., None] * (0.7 + 0.3 * h[..., None])
    base = np.clip(base + 0.25 * sc[..., None] * 0.5, 0, 1)
    rough = np.clip(0.55 + 0.25 * rust + 0.05 * h - 0.2 * sc, 0.25, 1)
    metal = np.clip(0.8 - 0.6 * rust, 0, 1)
    return dict(base=base, normal=normal_from_height(rib * 1.2 + 0.2 * h, 1.5),
                orm=np.stack([np.ones((n, n)), rough, metal], -1))


def burlap(n=512, seed=6):
    x, y = grid(n)
    weave = np.sin(x * 2 * np.pi * 64) * np.sin(y * 2 * np.pi * 64)
    h = fbm(n, seed)
    dirt = smooth01(pnoise(n, 2.4, seed + 2), 0.0, 1.8)
    v = 0.55 + 0.10 * weave + 0.05 * h - 0.18 * dirt
    base = tint((0.82, 0.70, 0.48), v)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(weave * 0.6 + 0.3 * h, 3.0),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.95), np.zeros((n, n))], -1))


def steel(n=512, seed=7, color=(0.30, 0.31, 0.33)):
    h = fbm(n, seed)
    sc = scratches(n, seed + 1, 120, 80)
    base = tint(color, 0.8 + 0.12 * h + 0.35 * sc)
    rough = np.clip(0.5 + 0.12 * h - 0.2 * sc, 0.2, 1)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(0.2 * h + sc, 1.5),
                orm=np.stack([np.ones((n, n)), rough, np.full((n, n), 0.9)], -1))


# ---------------------------------------------------------------- character / weapon materials
def fabric_camo(n=512, seed=8):
    """Neutral (near-white) camouflage; base colour factor in the material applies the team colour."""
    a = pnoise(n, 2.2, seed)
    b = pnoise(n, 2.0, seed + 4)
    c = pnoise(n, 1.8, seed + 8)
    v = 0.78 + 0.0 * a
    v = np.where(a > 0.55, 0.58, v)
    v = np.where(b > 0.75, 0.95, v)
    v = np.where(c > 1.0, 0.45, v)
    x, y = grid(n)
    weave = np.sin(x * 2 * np.pi * 128) * np.sin(y * 2 * np.pi * 128)
    dirt = smooth01(pnoise(n, 2.4, seed + 3), 0.4, 2.0)
    v = v * (1 - 0.22 * dirt) + 0.03 * weave
    base = np.stack([v, v, v], -1)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(weave * 0.5 + 0.2 * a, 2.0),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.92), np.zeros((n, n))], -1))


def nylon(n=512, seed=9, color=(0.13, 0.14, 0.15)):
    x, y = grid(n)
    weave = np.sin(x * 2 * np.pi * 96) * np.sin(y * 2 * np.pi * 96)
    h = fbm(n, seed)
    wear = smooth01(pnoise(n, 2.3, seed + 5), 0.8, 2.0)
    base = tint(color, 0.9 + 0.12 * weave + 0.12 * h + 0.5 * wear * 0.2)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(weave * 0.7, 2.5),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.88), np.zeros((n, n))], -1))


def polymer(n=512, seed=10, color=(0.16, 0.165, 0.17)):
    h = fbm(n, seed)
    speck = dots(n, seed + 1, 200, 1.5)
    sc = scratches(n, seed + 2, 80, 60)
    base = tint(color, 0.95 + 0.1 * h + 0.5 * sc * 0.4 + 0.25 * speck)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(0.5 * h + speck * 0.8, 2.0),
                orm=np.stack([np.ones((n, n)), np.clip(0.55 + 0.1 * h - 0.2 * sc, 0.2, 1), np.zeros((n, n))], -1))


def gunmetal(n=512, seed=11, color=(0.27, 0.28, 0.30)):
    h = fbm(n, seed)
    sc = scratches(n, seed + 1, 160, 70)
    wear = smooth01(pnoise(n, 2.0, seed + 6), 1.0, 2.2)
    base = tint(color, 0.9 + 0.1 * h)
    base = np.clip(base + (0.16 * wear + 0.10 * sc)[..., None] * np.array((0.8, 0.8, 0.82)), 0, 1)
    rough = np.clip(0.38 + 0.15 * h + 0.25 * wear - 0.1 * sc, 0.15, 1)
    return dict(base=base, normal=normal_from_height(0.25 * h + sc * 0.8, 1.5),
                orm=np.stack([np.ones((n, n)), rough, np.clip(0.95 - 0.5 * wear, 0, 1)], -1))


def blade(n=512, seed=12):
    x, y = grid(n)
    brush = pnoise(n, 1.4, seed, stretch=(1.0, 0.04))
    sc = scratches(n, seed + 1, 90, 90)
    base = tint((0.62, 0.64, 0.67), 0.85 + 0.07 * brush + 0.3 * sc)
    rough = np.clip(0.28 + 0.1 * brush + 0.2 * sc, 0.1, 1)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(0.4 * brush, 1.2),
                orm=np.stack([np.ones((n, n)), rough, np.full((n, n), 1.0)], -1))


def rubber(n=512, seed=13, color=(0.07, 0.07, 0.075)):
    x, y = grid(n)
    stip = pnoise(n, 0.6, seed)
    base = tint(color, 0.9 + 0.12 * stip)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(stip, 2.5),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.92), np.zeros((n, n))], -1))


def skin(n=256, seed=14):
    h = fbm(n, seed)
    base = tint((0.80, 0.60, 0.48), 0.9 + 0.04 * h)
    return dict(base=np.clip(base, 0, 1), normal=None,
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.65), np.zeros((n, n))], -1))


def leather(n=512, seed=15, color=(0.17, 0.13, 0.10)):
    h = fbm(n, seed)
    crack = pnoise(n, 0.9, seed + 3)
    sc = scratches(n, seed + 1, 80, 40)
    base = tint(color, 0.85 + 0.15 * h + 0.3 * sc * 0.3)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(crack * 0.8, 2.0),
                orm=np.stack([np.ones((n, n)), np.clip(0.6 + 0.2 * h, 0.2, 1), np.zeros((n, n))], -1))


GENERATORS = dict(
    concrete=concrete, floor_tile=floor_tile, outer_panel=outer_panel, wood=wood, container_metal=container_metal,
    burlap=burlap, steel=steel, fabric_camo=fabric_camo, nylon=nylon, polymer=polymer, gunmetal=gunmetal,
    blade=blade, rubber=rubber, skin=skin, leather=leather,
)
