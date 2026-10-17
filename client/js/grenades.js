// Grenades in flight, explosions, flash and standing smoke clouds. All state comes from the server (snapshot `gr`/`sm`, events
// `throw`/`boom`); this only draws it. Purely visual: nothing here feeds back into the simulation.
import * as THREE from '../vendor/three.module.js';

import { rayWorld } from './physics.js';

const KIND_COLOR = { frag: 0x3c4a2e, smoke: 0x8a8f94, flash: 0xd8d8e8 };

function glow(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hitsBox(c, r, b) {
  const dx = c[0] - Math.min(Math.max(c[0], b[0]), b[3]);
  const dy = c[1] - Math.min(Math.max(c[1], b[1]), b[4]);
  const dz = c[2] - Math.min(Math.max(c[2], b[2]), b[5]);
  return dx * dx + dy * dy + dz * dz < r * r;
}

function touchesAny(boxes, c, r) {
  for (let i = 0; i < boxes.length; i++) if (hitsBox(c, r, boxes[i])) return true;
  return false;
}

// One tick of the server's grenade integration (grenades.go moveNade): gravity, per-axis box bounce, floor, bounds.
function stepNade(map, n, pos, vel, dt) {
  vel[1] -= n.gravity * dt;
  for (let ax = 0; ax < 3; ax++) {
    const old = pos[ax];
    pos[ax] += vel[ax] * dt;
    if (touchesAny(map.boxes, pos, n.radius)) {
      pos[ax] = old;
      vel[ax] = -vel[ax] * n.restitution;
      vel[0] *= 0.85;
      vel[2] *= 0.85;
    }
  }
  if (pos[1] < n.radius) {
    pos[1] = n.radius;
    if (vel[1] < 0) {
      vel[1] = -vel[1] * n.restitution;
      if (vel[1] < 1) vel[1] = 0;
    }
    vel[0] *= 0.8;
    vel[2] *= 0.8;
  }
  if (pos[1] <= n.radius + 1e-9 && vel[1] === 0) {
    vel[0] *= 0.94;
    vel[2] *= 0.94;
  }
  const bd = map.bounds;
  if (pos[0] < bd.minX + n.radius || pos[0] > bd.maxX - n.radius) {
    pos[0] = Math.min(Math.max(pos[0], bd.minX + n.radius), bd.maxX - n.radius);
    vel[0] = -vel[0] * n.restitution;
  }
  if (pos[2] < bd.minZ + n.radius || pos[2] > bd.maxZ - n.radius) {
    pos[2] = Math.min(Math.max(pos[2], bd.minZ + n.radius), bd.maxZ - n.radius);
    vel[2] = -vel[2] * n.restitution;
  }
}

export class Grenades {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.flight = new Map(); // id -> {mesh, target}
    this.clouds = new Map(); // key -> {sprites, left, total}
    this.fx = []; // short explosion sprites/lights
    this.ball = new THREE.SphereGeometry(0.07, 10, 8);
    // predicted throw path (see preview())
    this.arcGeo = new THREE.BufferGeometry();
    this.arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 200), 3));
    this.arcMat = new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85 });
    this.arc = new THREE.Line(this.arcGeo, this.arcMat);
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.arcEnd = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 20), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.arcEnd.visible = false;
    this.boomLight = new THREE.PointLight(0xffa850, 0, 25, 2); // explosion glow (see boom)
    this.boomLight.visible = false;
    this.boomT = 0;
    this.group.add(this.arc, this.arcEnd, this.boomLight);
    this.texFire = glow([[0, 'rgba(255,250,220,1)'], [0.25, 'rgba(255,170,60,0.95)'], [0.6, 'rgba(200,60,10,0.5)'], [1, 'rgba(60,20,0,0)']]);
    this.texFlash = glow([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(235,240,255,0.8)'], [1, 'rgba(200,210,255,0)']]);
    this.texSmoke = glow([[0, 'rgba(205,208,212,0.95)'], [0.55, 'rgba(165,170,176,0.7)'], [1, 'rgba(140,145,150,0)']]);
  }

  // Draw where a thrown grenade would go: same launch rules and integration as the server (world.go throwNade / grenades.go moveNade),
  // up to its fuse. preview(null) hides it. k = speed factor from the throw power; bright = a throw is being charged.
  preview(eye, yaw, pitch, gs, k, bright) {
    if (!eye) {
      this.arc.visible = this.arcEnd.visible = false;
      this._arcKey = '';
      return;
    }
    const key = `${eye[0]},${eye[1]},${eye[2]},${yaw},${pitch},${k},${gs.id}`;
    if (key === this._arcKey && this.arc.visible) {
      this.arcMat.opacity = bright ? 0.95 : 0.4; // same throw as the last frame: the path is still valid, only the brightness may change
      return;
    }
    this._arcKey = key;
    const game = this.game;
    const n = game.spec.nades;
    const map = game.map;
    const dt = 1 / game.spec.tickRate;
    const cp = Math.cos(pitch);
    const dir = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    let pos = [eye[0], eye[1], eye[2]];
    if (rayWorld(map, pos, dir, 0.6) >= 0.6) pos = [pos[0] + dir[0] * 0.5, pos[1] + dir[1] * 0.5, pos[2] + dir[2] * 0.5];
    const sp = gs.speed * k;
    const vel = [dir[0] * sp, dir[1] * sp + gs.upBias * k, dir[2] * sp];
    const a = this.arcGeo.attributes.position;
    let count = 0;
    const put = () => {
      a.setXYZ(count++, pos[0], pos[1], pos[2]);
    };
    put();
    for (let tick = 0; tick < gs.fuseTicks && count < 199; tick++) {
      stepNade(map, n, pos, vel, dt);
      put();
    }
    a.needsUpdate = true;
    this.arcGeo.setDrawRange(0, count);
    this.arc.visible = true;
    this.arcMat.opacity = bright ? 0.95 : 0.4;
    this.arcEnd.visible = true;
    this.arcEnd.position.set(pos[0], Math.max(0.03, pos[1] - n.radius + 0.03), pos[2]);
    this.arcEnd.rotation.x = -Math.PI / 2;
  }

  kindOf(g) {
    return (this.game.spec.grenades[g] || {}).kind || 'frag';
  }

  setFlight(list) {
    const seen = new Set();
    for (const s of list || []) {
      seen.add(s.i);
      let f = this.flight.get(s.i);
      if (!f) {
        const mesh = new THREE.Mesh(this.ball, new THREE.MeshStandardMaterial({ color: KIND_COLOR[this.kindOf(s.g)], roughness: 0.5, metalness: 0.4 }));
        mesh.position.set(s.x, s.y, s.z);
        mesh.castShadow = true;
        this.group.add(mesh);
        f = { mesh, target: new THREE.Vector3() };
        this.flight.set(s.i, f);
      }
      f.target.set(s.x, s.y, s.z);
    }
    for (const [id, f] of this.flight) {
      if (!seen.has(id)) {
        this.group.remove(f.mesh);
        f.mesh.material.dispose();
        this.flight.delete(id);
      }
    }
  }

  setSmokes(list) {
    const seen = new Set();
    for (const s of list || []) {
      const key = `${s.x.toFixed(1)},${s.z.toFixed(1)}`;
      seen.add(key);
      let c = this.clouds.get(key);
      if (!c) {
        const gs = this.game.spec.grenades[s.g];
        const total = gs.duration * this.game.spec.tickRate;
        const sprites = [];
        for (let i = 0; i < 16; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texSmoke, transparent: true, depthWrite: false, opacity: 0 }));
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * gs.radius * 0.7;
          sp.userData = { dx: Math.cos(a) * r, dz: Math.sin(a) * r, dy: Math.random() * 1.8, size: gs.radius * (0.9 + Math.random() * 0.5), spin: Math.random() * 6 };
          sp.position.set(s.x + sp.userData.dx, s.y + sp.userData.dy, s.z + sp.userData.dz);
          this.group.add(sp);
          sprites.push(sp);
        }
        c = { sprites, left: s.l, total, x: s.x, y: s.y, z: s.z };
        this.clouds.set(key, c);
      }
      c.left = s.l;
    }
    for (const [key, c] of this.clouds) {
      if (!seen.has(key)) {
        for (const sp of c.sprites) {
          this.group.remove(sp);
          sp.material.dispose();
        }
        this.clouds.delete(key);
      }
    }
  }

  sprite(tex, pos, size, life, additive = true) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    sp.position.set(pos[0], pos[1], pos[2]);
    sp.scale.setScalar(size * 0.2);
    this.group.add(sp);
    const f = { sp, life, t: 0, size };
    this.fx.push(f);
    return f;
  }

  // Server event: a grenade went off at ev.at.
  boom(ev) {
    const game = this.game;
    const kind = this.kindOf(ev.g || 0);
    const at = ev.at;
    const e = game.eye();
    const d = Math.hypot(at[0] - e[0], at[1] - e[1], at[2] - e[2]);
    if (kind === 'frag') {
      this.sprite(this.texFire, at, (game.spec.grenades[ev.g || 0].radius || 7) * 1.3, 0.45);
      this.boomLight.position.set(at[0], at[1] + 0.5, at[2]);
      this.boomLight.visible = true; // one pooled light: creating a light mid-match changes the light count and recompiles every lit material
      this.boomLight.intensity = 40;
      this.boomT = 0.25;
      game.shake = Math.max(game.shake, 1.2 / (1 + d / 5));
      game.playAt('boom', at);
    } else if (kind === 'flash') {
      this.sprite(this.texFlash, at, 6, 0.3);
      game.playAt('flashbang', at);
    } else {
      this.sprite(this.texSmoke, at, 3, 0.5, false);
      game.playAt('smoke', at);
    }
  }

  update(dt) {
    for (const f of this.flight.values()) {
      f.mesh.position.lerp(f.target, 1 - Math.exp(-dt * 30));
      f.mesh.rotation.x += dt * 9;
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = f.t / f.life;
      if (f.sp) {
        f.sp.scale.setScalar(f.size * (0.2 + 0.8 * Math.min(1, k * 2)));
        f.sp.material.opacity = Math.max(0, 1 - k);
      }
      if (k >= 1) {
        this.group.remove(f.sp);
        f.sp.material.dispose();
        this.fx.splice(i, 1);
      }
    }
    if (this.boomT > 0) {
      this.boomT -= dt;
      this.boomLight.intensity = 40 * Math.max(0, this.boomT / 0.25);
      if (this.boomT <= 0) this.boomLight.visible = false;
    }
    const tr = this.game.spec.tickRate;
    for (const c of this.clouds.values()) {
      const age = (c.total - c.left) / tr; // seconds since it went off
      const out = c.left / tr; // seconds until it is gone
      const grow = Math.min(1, age / 1.0);
      const alpha = Math.min(1, age / 0.5) * Math.min(1, out / 2.5);
      for (const sp of c.sprites) {
        const u = sp.userData;
        sp.scale.setScalar(u.size * (0.35 + 0.65 * grow));
        sp.position.set(c.x + u.dx * grow, c.y + u.dy * grow + 0.5, c.z + u.dz * grow);
        sp.material.opacity = 0.85 * alpha;
        sp.material.rotation = u.spin + age * 0.1;
      }
    }
  }

  clear() {
    this.setFlight([]);
    this.setSmokes([]);
    for (const f of this.fx) {
      this.group.remove(f.sp);
      f.sp.material.dispose();
    }
    this.fx.length = 0;
    this.boomT = 0;
    this.boomLight.visible = false;
  }
}
