// Bullet holes (walls, floor, crates), blood splatters + pools, blood spray particles.
// All purely cosmetic and client-side: positions come from the server's `shot` events (or local practice hits).
import * as THREE from '../vendor/three.module.js';
import { rayWorld } from './physics.js';

const HOLES = 300;
const SPLATS = 120;
const POOLS = 40;
const PARTS = 64;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function holeTexture() {
  const r = rng(11);
  return canvasTex(128, (g, s) => {
    const c = s / 2;
    // chipped plaster ring (light, soft) then the dark crater and radial cracks
    let grd = g.createRadialGradient(c, c, 4, c, c, 60);
    grd.addColorStop(0, 'rgba(70,66,60,0.9)');
    grd.addColorStop(0.45, 'rgba(95,90,82,0.55)');
    grd.addColorStop(1, 'rgba(120,115,105,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(c, c, 60, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(25,23,21,0.75)';
    g.lineWidth = 1.6;
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const len = 14 + r() * 40;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 8, c + Math.sin(a) * 8);
      g.lineTo(c + Math.cos(a + (r() - 0.5) * 0.4) * len, c + Math.sin(a + (r() - 0.5) * 0.4) * len);
      g.stroke();
    }
    grd = g.createRadialGradient(c, c, 0, c, c, 20);
    grd.addColorStop(0, 'rgba(3,3,3,1)');
    grd.addColorStop(0.75, 'rgba(12,11,10,0.97)');
    grd.addColorStop(1, 'rgba(15,14,13,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(c, c, 20, 0, Math.PI * 2);
    g.fill();
  });
}

function splatTexture(seed, drips) {
  const r = rng(seed);
  return canvasTex(256, (g, s) => {
    const c = s / 2;
    const blob = (x, y, rad, a) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(110,5,8,${a})`);
      grd.addColorStop(0.7, `rgba(80,3,6,${a * 0.9})`);
      grd.addColorStop(1, 'rgba(60,2,4,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    };
    blob(c, c, 34, 0.95);
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const d = 20 + r() * 70;
      blob(c + Math.cos(a) * d, c + Math.sin(a) * d, 3 + r() * 9, 0.9);
      if (r() < 0.5) { // streak toward the centre
        g.strokeStyle = 'rgba(85,4,6,0.8)';
        g.lineWidth = 2 + r() * 3;
        g.beginPath();
        g.moveTo(c, c);
        g.lineTo(c + Math.cos(a) * d, c + Math.sin(a) * d);
        g.stroke();
      }
    }
    if (drips) { // vertical runs (+Y of the decal points up the wall, drips run down)
      for (let i = 0; i < 4; i++) {
        const x = c - 30 + r() * 60;
        g.strokeStyle = 'rgba(80,3,5,0.85)';
        g.lineWidth = 3 + r() * 3;
        g.beginPath();
        g.moveTo(x, c);
        g.lineTo(x + (r() - 0.5) * 6, c + 30 + r() * 80);
        g.stroke();
        blob(x, c + 40 + r() * 80, 4, 0.9);
      }
    }
  });
}

function makeInstanced(tex, count, order = 1) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: 0.55, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2 - order, polygonOffsetUnits: -2 - order,
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2 + order;
  return mesh;
}

// Which surface does `p` lie on? Returns {n:[x,y,z]} facing against `dir`, or null.
export function surfaceAt(map, p, dir) {
  let best = null;
  let bd = 0.06;
  if (p[1] < bd && dir[1] < 0) {
    best = [0, 1, 0];
    bd = Math.max(0, p[1]);
  }
  const e = 0.06;
  for (const b of map.boxes) {
    if (p[0] < b[0] - e || p[0] > b[3] + e || p[1] < b[1] - e || p[1] > b[4] + e || p[2] < b[2] - e || p[2] > b[5] + e) continue;
    for (let a = 0; a < 3; a++) {
      for (const side of [-1, 1]) {
        const plane = side < 0 ? b[a] : b[a + 3];
        const d = Math.abs(p[a] - plane);
        if (d < bd && dir[a] * side < 0) { // face looks toward the shooter
          bd = d;
          best = [0, 0, 0];
          best[a] = side;
        }
      }
    }
  }
  return best ? { n: best, d: bd } : null;
}

export class Decals {
  constructor(scene, map) {
    this.map = map;
    this.scene = scene;
    this.rand = rng(99);
    this.holes = makeInstanced(holeTexture(), HOLES, 1);
    this.splats = [makeInstanced(splatTexture(21, false), SPLATS, 2), makeInstanced(splatTexture(22, true), SPLATS, 2)];
    this.pools = makeInstanced(splatTexture(23, false), POOLS, 3);
    this.hi = 0;
    this.si = [0, 0];
    this.pi = 0;
    scene.add(this.holes, ...this.splats, this.pools);

    // blood spray particles
    this.pgeo = new THREE.IcosahedronGeometry(0.025, 0);
    this.parts = new THREE.InstancedMesh(this.pgeo, new THREE.MeshBasicMaterial({ color: 0x8a0a0f }), PARTS);
    this.parts.frustumCulled = false;
    this.parts.count = 0;
    scene.add(this.parts);
    this.pstate = Array.from({ length: PARTS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 }));
    this.pn = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  _place(mesh, idx, point, n, size, aspect = 1, jitter = 0) {
    const nv = new THREE.Vector3(n[0], n[1], n[2]);
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
    const spin = new THREE.Quaternion().setFromAxisAngle(nv, this.rand() * Math.PI * 2);
    this._q.premultiply(spin);
    this._p.set(point[0] + n[0] * (0.004 + jitter), point[1] + n[1] * (0.004 + jitter), point[2] + n[2] * (0.004 + jitter));
    this._s.set(size, size * aspect, 1);
    this._m.compose(this._p, this._q, this._s);
    mesh.setMatrixAt(idx, this._m);
    mesh.count = Math.max(mesh.count, idx + 1);
    mesh.instanceMatrix.needsUpdate = true;
  }

  bulletHole(point, dir) {
    const s = surfaceAt(this.map, point, dir);
    if (!s) return;
    const size = 0.15 + this.rand() * 0.04;
    this._place(this.holes, this.hi, point, s.n, size, 1, (this.hi % 7) * 0.00025);
    this.hi = (this.hi + 1) % HOLES;
  }

  // Blood: spray particles at the wound, a splatter on whatever is behind the victim, droplets on the floor.
  blood(point, dir, head) {
    const d = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const nd = [dir[0] / d, dir[1] / d, dir[2] / d];
    for (let i = 0; i < (head ? 14 : 9); i++) {
      const st = this.pstate[this.pn];
      this.pn = (this.pn + 1) % PARTS;
      st.p.set(point[0], point[1], point[2]);
      const sp = 1.5 + this.rand() * 3.2;
      st.v.set(nd[0] * sp * 0.7 + (this.rand() - 0.5) * 2.4, nd[1] * sp * 0.7 + this.rand() * 1.6, nd[2] * sp * 0.7 + (this.rand() - 0.5) * 2.4);
      st.life = 0.35 + this.rand() * 0.35;
    }
    this.parts.count = PARTS;
    // splatter on the surface behind (exit side)
    const t = rayWorld(this.map, point, nd, 5);
    if (t < 5) {
      const hit = [point[0] + nd[0] * t, point[1] + nd[1] * t, point[2] + nd[2] * t];
      const s = surfaceAt(this.map, hit, nd);
      if (s) {
        const k = Math.round(this.rand());
        this._place(this.splats[k], this.si[k], hit, s.n, (head ? 0.7 : 0.5) * (1 - t / 8), 1, (this.si[k] % 5) * 0.0003);
        this.si[k] = (this.si[k] + 1) % SPLATS;
      }
    }
    // droplets on the floor under the wound
    if (point[1] > 0.1) this._floorSplat(point[0] + nd[0] * 0.4, point[2] + nd[2] * 0.4, 0.22 + this.rand() * 0.15);
  }

  _floorSplat(x, z, size) {
    const k = Math.round(this.rand());
    this._place(this.splats[k], this.si[k], [x, 0, z], [0, 1, 0], size, 1, (this.si[k] % 5) * 0.0003);
    this.si[k] = (this.si[k] + 1) % SPLATS;
  }

  bloodPool(x, z) {
    this._place(this.pools, this.pi, [x, 0, z], [0, 1, 0], 1.1 + this.rand() * 0.4, 1, (this.pi % 4) * 0.0004);
    this.pi = (this.pi + 1) % POOLS;
  }

  update(dt) {
    if (!this.parts.count) return;
    let alive = 0;
    for (let i = 0; i < PARTS; i++) {
      const st = this.pstate[i];
      if (st.life > 0) {
        st.life -= dt;
        st.v.y -= 9.8 * dt;
        st.p.addScaledVector(st.v, dt);
        if (st.p.y <= 0.01) {
          st.life = 0;
          if (this.rand() < 0.4) this._floorSplat(st.p.x, st.p.z, 0.08 + this.rand() * 0.08);
        }
        alive++;
      }
      this._s.setScalar(st.life > 0 ? 1 : 0);
      this._m.compose(st.p, this._q.identity(), this._s);
      this.parts.setMatrixAt(i, this._m);
    }
    this.parts.instanceMatrix.needsUpdate = true;
    if (!alive) this.parts.count = 0;
  }

  clear() {
    this.holes.count = 0;
    this.splats.forEach((m) => (m.count = 0));
    this.pools.count = 0;
    this.parts.count = 0;
    this.hi = this.pi = 0;
    this.si = [0, 0];
    this.pstate.forEach((s) => (s.life = 0));
  }
}
