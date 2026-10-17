// Grenades in flight, explosions, flash and standing smoke clouds. All state comes from the server (snapshot `gr`/`sm`, events
// `throw`/`boom`); this only draws it. Purely visual: nothing here feeds back into the simulation.
import * as THREE from '../vendor/three.module.js';

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

export class Grenades {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.flight = new Map(); // id -> {mesh, target}
    this.clouds = new Map(); // key -> {sprites, left, total}
    this.fx = []; // short explosion sprites/lights
    this.ball = new THREE.SphereGeometry(0.07, 10, 8);
    this.texFire = glow([[0, 'rgba(255,250,220,1)'], [0.25, 'rgba(255,170,60,0.95)'], [0.6, 'rgba(200,60,10,0.5)'], [1, 'rgba(60,20,0,0)']]);
    this.texFlash = glow([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(235,240,255,0.8)'], [1, 'rgba(200,210,255,0)']]);
    this.texSmoke = glow([[0, 'rgba(205,208,212,0.95)'], [0.55, 'rgba(165,170,176,0.7)'], [1, 'rgba(140,145,150,0)']]);
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
      const l = new THREE.PointLight(0xffa850, 40, 25, 2);
      l.position.set(at[0], at[1] + 0.5, at[2]);
      this.group.add(l);
      this.fx.push({ light: l, life: 0.25, t: 0 });
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
      } else if (f.light) {
        f.light.intensity = 40 * Math.max(0, 1 - k);
      }
      if (k >= 1) {
        if (f.sp) {
          this.group.remove(f.sp);
          f.sp.material.dispose();
        } else {
          this.group.remove(f.light);
          f.light.dispose();
        }
        this.fx.splice(i, 1);
      }
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
      this.group.remove(f.sp || f.light);
      if (f.sp) f.sp.material.dispose();
      else f.light.dispose();
    }
    this.fx.length = 0;
  }
}
