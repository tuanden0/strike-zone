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


def cracks(n, seed, count, length=90):
    """Wandering hairline cracks (random walk with a drifting heading), periodic, 0..1 mask."""
    rng = _rng(seed)
    m = np.zeros((n, n))
    for _ in range(count):
        x, y = rng.uniform(0, n, 2)
        a = rng.uniform(0, 2 * np.pi)
        for _ in range(int(rng.uniform(0.4, 1) * length)):
            a += rng.normal(0, 0.35)
            x, y = x + np.cos(a), y + np.sin(a)
            m[int(y) % n, int(x) % n] = 1.0
            if rng.random() < 0.03:  # short branch
                bx, by, ba = x, y, a + rng.choice((-1, 1)) * 0.9
                for _ in range(int(rng.uniform(5, 18))):
                    ba += rng.normal(0, 0.3)
                    bx, by = bx + np.cos(ba), by + np.sin(ba)
                    m[int(by) % n, int(bx) % n] = 0.8
    return m


# ---------------------------------------------------------------- map materials
def concrete(n=512, seed=1):
    h = fbm(n, seed)
    pits = dots(n, seed + 3, 140, 2.2)
    stain = smooth01(pnoise(n, 2.6, seed + 7), 0.2, 1.6)
    crack = cracks(n, seed + 41, 3, 70)
    v = 0.60 + 0.07 * h - 0.18 * pits - 0.10 * stain - 0.3 * crack
    base = tint((1.0, 1.0, 1.03), v)
    x, y = grid(n)
    seam = (np.minimum(x, 1 - x) < 2.0 / n) | (np.minimum(y, 1 - y) < 2.0 / n)  # formwork panel joints
    base[seam] *= 0.62
    for cx, cy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):  # tie holes
        d = np.sqrt(((x - cx) * n) ** 2 + ((y - cy) * n) ** 2)
        base[d < 5] *= 0.45
        pits = np.maximum(pits, (d < 5).astype(float))
    ht = 0.5 * h + 1.5 * pits * -1 - seam * 2.0 - crack * 1.5
    rough = np.clip(0.88 + 0.05 * h - 0.05 * pits, 0.6, 1.0)
    return dict(base=base, normal=normal_from_height(ht * 0.8, 3.0),
                orm=np.stack([1 - 0.5 * pits, rough, np.zeros((n, n))], -1))


def floor_tile(n=512, seed=2):
    h = fbm(n, seed)
    x, y = grid(n)
    oil = smooth01(pnoise(n, 3.0, seed + 11), 0.9, 1.9)
    scuff = scratches(n, seed + 5, 90, 40)
    crack = cracks(n, seed + 21, 7, 110)
    puddle = smooth01(pnoise(n, 3.2, seed + 31), 1.1, 1.6)  # low spots that hold water: darker, glossy
    v = 0.52 + 0.06 * h - 0.14 * oil + 0.05 * scuff - 0.3 * crack - 0.12 * puddle
    base = tint((1.0, 1.0, 1.02), v)
    joint = (np.minimum(x, 1 - x) < 3.0 / n) | (np.minimum(y, 1 - y) < 3.0 / n)
    base[joint] *= 0.45
    ht = 0.3 * h - joint * 2.5 - crack * 2.0
    rough = np.clip(0.78 + 0.1 * h - 0.25 * oil - 0.55 * puddle, 0.12, 1)
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
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(weave * 0.5 + 0.9 * a + 0.5 * b, 2.0),  # low-frequency terms read as cloth folds
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


def asphalt(n=512, seed=16):
    h = fbm(n, seed)
    grit = dots(n, seed + 1, 500, 1.6)
    crack = scratches(n, seed + 4, 14, 140)
    oil = smooth01(pnoise(n, 2.8, seed + 9), 1.0, 2.0)
    v = 0.30 + 0.05 * h + 0.07 * grit - 0.07 * oil - 0.1 * crack
    base = tint((1.0, 1.0, 1.04), v)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(0.5 * h + grit * 1.2 - crack * 2.0, 3.0),
                orm=np.stack([np.ones((n, n)), np.clip(0.88 - 0.2 * oil, 0.5, 1), np.zeros((n, n))], -1))


def brick(n=512, seed=17):
    """Running-bond brick, 4 bricks across a 1 m tile, 14 courses; mortar joints, colour variation, grime."""
    r = _rng(seed)
    base = np.zeros((n, n, 3))
    ht = np.zeros((n, n))
    rows, cols = 14, 4
    rh = n / rows
    cw = n / cols
    h = fbm(n, seed + 3)
    yy, xx = np.mgrid[0:n, 0:n]
    row = (yy // rh).astype(int)
    off = (row % 2) * (cw / 2)
    col = ((xx + off) // cw).astype(int)
    my = (yy % rh) / rh
    mx = ((xx + off) % cw) / cw
    mortar = (my < 0.09) | (my > 0.97) | (mx < 0.03) | (mx > 0.985)
    tone = r.uniform(0.75, 1.15, (rows, cols + 1))
    t = tone[row, np.minimum(col, cols)]
    brickc = np.stack([0.50 * t, 0.24 * t, 0.17 * t], -1) * (0.92 + 0.08 * h[..., None])
    mort = np.array([0.55, 0.53, 0.5]) * (0.9 + 0.1 * h[..., None])
    base = np.where(mortar[..., None], mort, brickc)
    grime = smooth01(1 - yy / n, 0.0, 1.0) * smooth01(pnoise(n, 2.4, seed + 5), -0.2, 1.6)
    base = base * (1 - 0.3 * grime[..., None])
    ht = np.where(mortar, -1.0, 0.2 * h)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(ht, 3.0),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.9), np.zeros((n, n))], -1))


GENERATORS = dict(
    asphalt=asphalt, brick=brick,
    concrete=concrete, floor_tile=floor_tile, outer_panel=outer_panel, wood=wood, container_metal=container_metal,
    burlap=burlap, steel=steel, fabric_camo=fabric_camo, nylon=nylon, polymer=polymer, gunmetal=gunmetal,
    blade=blade, rubber=rubber, skin=skin, leather=leather,
)


# ---------------------------------------------------------------- extra map materials (stucco, terracotta, sandstone, sand, rock, cobble)
# Appended for the five-maps feature; the generators above are unchanged.
def stucco(n=256, seed=21):
    """Warm lime plaster: trowel mottling, damp stains rising from the foot, hairline cracks, a few chipped patches."""
    h = fbm(n, seed)
    x, y = grid(n)
    chips = dots(n, seed + 2, 26, 7)
    stain = smooth01(pnoise(n, 2.4, seed + 5), 0.0, 1.8) * smooth01(1 - y, 0.2, 1.0)
    crack = cracks(n, seed + 9, 4, 80)
    v = 0.86 + 0.07 * h - 0.10 * stain - 0.28 * crack + 0.07 * chips
    base = tint((1.0, 0.86, 0.62), v)
    base = base * (1 - 0.35 * chips[..., None] * 0.5) + np.array((0.55, 0.40, 0.28)) * (0.35 * chips[..., None] * 0.5)
    ht = 0.7 * h - 1.2 * chips - crack * 1.5
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(ht, 2.2),
                orm=np.stack([np.ones((n, n)), np.clip(0.90 + 0.05 * h, 0.5, 1), np.zeros((n, n))], -1))


def terracotta(n=256, seed=22):
    """Curved clay roof tiles: 8 columns x 6 overlapping rows, per-tile colour variation, moss/soot streaks."""
    r = _rng(seed)
    x, y = grid(n)
    cols, rows = 8, 6
    cx = (x * cols) % 1.0
    ry = (y * rows) % 1.0
    ci = np.floor(x * cols).astype(int)
    ri = np.floor(y * rows).astype(int)
    tone = r.uniform(0.78, 1.15, (rows, cols))[ri, ci]
    prof = 0.5 + 0.5 * np.cos((cx - 0.5) * 2 * np.pi)       # convex tile
    shade = 0.55 + 0.45 * ry                                  # lower edge of each row overlaps the next: dark line
    h = fbm(n, seed + 1)
    soot = smooth01(pnoise(n, 2.6, seed + 4), 0.2, 1.8)
    v = (0.50 + 0.42 * prof) * shade * tone * (0.95 + 0.05 * h) * (1 - 0.25 * soot)
    base = np.stack([v * 0.86, v * 0.38, v * 0.22], -1)
    ht = prof * 1.5 + ry * 1.2 + 0.2 * h
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(ht, 2.5),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.82), np.zeros((n, n))], -1))


def sandstone(n=512, seed=23):
    """Ashlar courses of uneven height, per-block tone, thin dark joints, wind-pitted faces."""
    r = _rng(seed)
    x, y = grid(n)
    heights = np.array([0.22, 0.17, 0.25, 0.14, 0.22])
    heights = heights / heights.sum()
    edges = np.concatenate([[0], np.cumsum(heights)])
    base = np.zeros((n, n, 3))
    ht = np.zeros((n, n))
    h = fbm(n, seed + 3)
    pits = dots(n, seed + 5, 90, 3.0)
    mortar = np.zeros((n, n), bool)
    yy, xx = y, x
    for k in range(len(heights)):
        m = (yy >= edges[k]) & (yy < edges[k + 1] + (1e-9 if k == len(heights) - 1 else 0))
        nb = int(r.integers(3, 5))
        cuts = np.sort(r.uniform(0, 1, nb))
        cuts = np.concatenate([[0], cuts, [1.0001]])
        off = r.uniform(0, 1)
        xo = (xx + off) % 1.0
        for j in range(len(cuts) - 1):
            bm = m & (xo >= cuts[j]) & (xo < cuts[j + 1])
            tone = r.uniform(0.82, 1.1)
            base[bm] = np.array((0.80, 0.64, 0.42)) * tone
        ly = (yy - edges[k]) / heights[k]
        mortar |= m & ((ly < 0.035) | (ly > 0.97))
        for j in range(len(cuts) - 1):
            mortar |= m & (np.abs(xo - cuts[j]) < 0.004)
    base = base * (0.9 + 0.12 * h[..., None]) * (1 - 0.25 * pits[..., None])
    base[mortar] *= 0.55
    ht = 0.5 * h - 1.5 * pits - mortar * 2.2
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(ht, 2.8),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.92), np.zeros((n, n))], -1))


def sand(n=512, seed=24):
    """Wind-rippled desert sand with fine grain and a few pebbles."""
    h = fbm(n, seed)
    x, y = grid(n)
    warp = pnoise(n, 2.0, seed + 2)
    rip = 0.5 + 0.5 * np.sin((x * 6 + y * 2.0 + 0.35 * warp) * 2 * np.pi)
    grain = dots(n, seed + 3, 900, 1.5)
    peb = dots(n, seed + 4, 40, 4.0)
    v = 0.74 + 0.06 * h + 0.05 * rip + 0.05 * grain - 0.1 * peb
    base = tint((1.0, 0.83, 0.58), v)
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(rip * 0.7 + grain * 0.8 + peb * 1.5 + 0.3 * h, 2.0),
                orm=np.stack([np.ones((n, n)), np.full((n, n), 0.97), np.zeros((n, n))], -1))


def rock(n=512, seed=25):
    """Canyon strata: chunky sedimentary beds (own tone each, dark undercut line, lit lip), vertical joints, pitting."""
    r = _rng(seed)
    h = fbm(n, seed)
    x, y = grid(n)
    beds = 7
    warp = 0.22 * pnoise(n, 2.2, seed + 1, stretch=(1.0, 0.3))
    yy = y * beds + warp
    bi = np.floor(yy).astype(int)
    fr = yy - np.floor(yy)
    pal = np.array([(0.50, 0.32, 0.24), (0.68, 0.47, 0.32), (0.74, 0.58, 0.42), (0.58, 0.40, 0.30), (0.64, 0.44, 0.34), (0.78, 0.62, 0.46), (0.54, 0.36, 0.28)])
    tone = pal[bi % beds] * (0.9 + 0.2 * r.random(beds))[bi % beds][..., None]
    undercut = smooth01(0.10 - fr, 0.0, 0.10)                 # dark line at the foot of each bed
    lip = smooth01(fr, 0.75, 1.0) * 0.18                       # light edge at the top
    cell = np.floor(x * 5 + 0.15 * pnoise(n, 2.0, seed + 8, stretch=(1.0, 1.0)) + bi * 0.37).astype(int)
    vj = ((x * 5 + bi * 0.37) % 1.0 < 0.012) | ((x * 5 + bi * 0.37) % 1.0 > 0.988)
    grit = dots(n, seed + 3, 600, 2.0)
    shade = (0.82 + 0.14 * h + lip - 0.45 * undercut - 0.30 * vj - 0.16 * grit)[..., None]
    base = tone * shade
    ht = 0.8 * fr + 0.5 * h + 0.5 * grit - 2.5 * undercut - 1.2 * vj
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(ht, 3.2),
                orm=np.stack([np.clip(1 - 0.5 * undercut, 0, 1), np.full((n, n), 0.95), np.zeros((n, n))], -1))


def cobble(n=512, seed=26):
    """Irregular stone setts (jittered periodic cells): dark joints, domed stones, per-stone grey/tan tone."""
    r = _rng(seed)
    k = 8
    jx = r.uniform(0.15, 0.85, (k, k))
    jy = r.uniform(0.15, 0.85, (k, k))
    x, y = grid(n)
    # vectorised nearest/second-nearest feature points on the torus
    cell = np.array([(gy, gx) for gy in range(k) for gx in range(k)])
    feats = np.stack([(cell[:, 1] + jx[cell[:, 0], cell[:, 1]]) / k, (cell[:, 0] + jy[cell[:, 0], cell[:, 1]]) / k], -1)
    d_all = []
    for f in feats:
        dx = np.abs(x - f[0])
        dy = np.abs(y - f[1])
        dx = np.minimum(dx, 1 - dx)
        dy = np.minimum(dy, 1 - dy)
        d_all.append(np.sqrt(dx**2 + dy**2))
    d_all = np.stack(d_all, 0)
    order = np.argsort(d_all, 0)
    d1 = np.take_along_axis(d_all, order[:1], 0)[0]
    d2 = np.take_along_axis(d_all, order[1:2], 0)[0]
    idx = order[0]
    edge = (d2 - d1) * k                    # 0 on the joint, grows toward the stone centre
    tone = r.uniform(0.7, 1.15, len(feats))[idx]
    warm = r.uniform(0.0, 1.0, len(feats))[idx]
    h = fbm(n, seed + 3)
    dome = smooth01(edge, 0.0, 0.5)
    v = (0.50 + 0.10 * h) * tone * (0.55 + 0.45 * dome)
    base = np.stack([v * (0.95 + 0.12 * warm), v * (0.90 + 0.05 * warm), v * (0.82 - 0.05 * warm)], -1)
    ht = dome * 1.4 + 0.3 * h
    return dict(base=np.clip(base, 0, 1), normal=normal_from_height(ht, 3.0),
                orm=np.stack([0.5 + 0.5 * dome, np.full((n, n), 0.93), np.zeros((n, n))], -1))


GENERATORS.update(stucco=stucco, terracotta=terracotta, sandstone=sandstone, sand=sand, rock=rock, cobble=cobble)
