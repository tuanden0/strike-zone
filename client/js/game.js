// Rendering + fixed-tick local simulation. Mode objects (practice.js / online.js) plug in game rules.
import * as THREE from '../vendor/three.module.js';
import { stepMove, createKin, aimDir, rayWorld, eyeOf } from './physics.js';
import { Loadout, burstKick, spread } from './weapons.js';
import { buildWorld, buildLights, buildEnvironment, fitShadow } from './world.js';
import { Pickups } from './pickups.js';
import { isTouch } from './input.js';
import { Decals } from './decals.js';
import { Grenades } from './grenades.js';
import { NadeHold } from './nadehold.js';
import { PostFx } from './postfx.js';
import { Footsteps } from './footsteps.js';
import { Radar } from './radar.js';
import { Soldier, nameSprite, applyAnisotropy, flashTexture } from './models.js';
import { clone } from '../vendor/SkeletonUtils.js';

export const INTERP_MS = 100; // remote players are drawn this far in the past (also what lag compensation rewinds to)
// Knife swings as keyframes [progress, dx, dy, dz, rx, ry, rz] (offsets from the held pose, radians), eased between keys.
const KNIFE_SWINGS = [
  [[0, 0, 0, 0, 0, 0, 0], [0.28, 0.12, 0.1, 0.05, 0.5, 0.9, -0.6], [0.55, -0.13, -0.08, -0.08, -0.6, -0.8, 0.5], [1, 0, 0, 0, 0, 0, 0]], // slash, right to left
  [[0, 0, 0, 0, 0, 0, 0], [0.28, -0.18, -0.02, 0.04, 0.2, -0.9, 0.7], [0.55, 0.16, 0.08, -0.1, -0.5, 0.9, -0.5], [1, 0, 0, 0, 0, 0, 0]], // backhand, left to right
  [[0, 0, 0, 0, 0, 0, 0], [0.3, 0, -0.04, 0.12, 0.3, 0, 0], [0.48, 0, 0.02, -0.28, 1.0, 0, 0], [0.66, 0, 0.02, -0.28, 1.0, 0, 0], [1, 0, 0, 0, 0, 0, 0]], // stab
];

function knifePose(keys, t) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      const u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
      const k = u * u * (3 - 2 * u);
      return [1, 2, 3, 4, 5, 6].map((j) => a[j] + (b[j] - a[j]) * k);
    }
  }
  return [0, 0, 0, 0, 0, 0];
}

const NADE_POS = [0.15, -0.17, -0.56]; // held grenade in the view-model scene
const FP_WEAPONS = ['rifle', 'pistol', 'knife', 'sniper'];
const BASE_FOV = 78;
// first-person placement per weapon: camera-space position + scale + muzzle (model space) + ejection port
const FP = {
  rifle: { pos: [0.2, -0.25, -0.66], scale: 0.8, muzzle: [0, 0.066, -0.7], port: [0.03, 0.085, -0.03] },
  pistol: { pos: [0.1, -0.13, -0.5], scale: 0.9, muzzle: [0, 0.062, -0.2], port: [0.017, 0.075, -0.03] },
  knife: { pos: [0.13, -0.12, -0.45], scale: 1.0, muzzle: null, port: null },
  sniper: { pos: [0.2, -0.25, -0.66], scale: 0.8, muzzle: [0, 0.07, -0.99], port: [0.03, 0.085, -0.02] },
};

// Phones default to the cheap path (no shadows, 1x pixel ratio); an explicit stored choice wins.
function readQuality() {
  const dflt = isTouch ? 'low' : 'high';
  try {
    const q = localStorage.getItem('sz.quality');
    return q === 'low' || q === 'high' || q === 'ultra' ? q : dflt;
  } catch {
    return dflt; // skip: storage blocked, default quality is fine
  }
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// Another player (or practice target) rendered with snapshot interpolation.
export class RemoteView {
  constructor(game, id, nick, team, showLabel) {
    this.game = game;
    this.id = id;
    this.nick = nick;
    this.team = team;
    this.buf = [];
    this.alive = true;
    this.stepDist = 0;
    this.foot = 0;
    this.last = null;
    this.t = 0;
    this.char = new Soldier(game.assets[team === 'B' ? 'character_b' : 'character_a'], game.spec, game.assets.sniper);
    this.group = this.char.group;
    game.scene.add(this.group);
    this.label = null;
    if (showLabel) {
      this.label = nameSprite(nick, team === 'A' ? '#ffc9c0' : '#bcd8ff');
      this.label.position.set(0, game.spec.player.height + 0.45, 0);
      this.group.add(this.label);
    }
  }

  push(t, s) {
    this.buf.push({ t, ...s });
    if (this.buf.length > 30) this.buf.shift();
  }

  setNow(s) {
    this.buf = [{ t: 0, ...s }];
  }

  update(now, dt) {
    const b = this.buf;
    if (!b.length) return;
    const rt = now - INTERP_MS;
    while (b.length > 2 && b[1].t <= rt) b.shift();
    let s;
    if (b.length === 1 || rt <= b[0].t) s = b[0];
    else if (rt >= b[1].t) s = b[1];
    else {
      const k = (rt - b[0].t) / (b[1].t - b[0].t);
      s = {
        x: lerp(b[0].x, b[1].x, k),
        y: lerp(b[0].y, b[1].y, k),
        z: lerp(b[0].z, b[1].z, k),
        yaw: lerpAngle(b[0].yaw, b[1].yaw, k),
      };
    }
    const latest = b[b.length - 1];
    this.alive = latest.alive;
    this.char.setWeapon(latest.w);
    this.char.setDead(!this.alive);
    this.char.setCrouch(!!latest.c && this.alive);
    if (this.label) this.label.position.y = this.game.spec.player.height + 0.45 - (this.char.crouch ? 0.6 : 0);
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;
    this.t += dt;
    let speed = 0;
    if (this.last && dt > 0) {
      const d = Math.hypot(s.x - this.last.x, s.z - this.last.z);
      speed = d / dt;
      this.game.footsteps.remote(this, s, d, dt); // surface-specific, positional, audible up to ~25 m
    }
    this.last = { x: s.x, y: s.y, z: s.z };
    this.char.update(dt, this.alive && s.y < 0.05 ? speed : 0);
    this.char.setShadow(Math.hypot(s.x - this.game.camera.position.x, s.z - this.game.camera.position.z) < 32);
  }

  fire() {
    this.char.fire();
  }

  dispose() {
    this.game.scene.remove(this.group);
    if (this.label) this.label.material.map.dispose(), this.label.material.dispose();
    this.char.dispose(); // geometries/materials are shared between clones: not disposed here
  }
}

export class Game {
  constructor({ canvas, spec, map, sfx, hud, input, assets }) {
    this.assets = assets;
    this.canvas = canvas;
    this.spec = spec;
    this.map = map;
    this.sfx = sfx;
    this.hud = hud;
    this.input = input;
    this.mode = null;
    this.running = false;
    this.remotes = new Map();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.quality = readQuality();
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.setPixelRatio(this.pixelRatio());
    this.postfx = null; // created on demand for Graphics = Ultra
    this.aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const env = buildEnvironment(this.renderer);

    this.scene = new THREE.Scene();
    this.sun = buildLights(this.scene, env, true);
    this.sun.castShadow = this.quality !== 'low';
    this.world = null;
    this.decals = new Decals(this.scene, map);
    this.pickups = new Pickups(this);
    this.grenades = new Grenades(this);
    this.shake = 0; // camera shake amount (explosions)
    this.radar = new Radar(this); // minimap (before the first setMap: it pre-renders the map layer)
    this.setMap('yard', map, assets.map.scene);
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 200);
    this.scene.add(this.camera);
    for (const k of ['character_a', 'character_b']) applyAnisotropy(assets[k].scene, this.aniso);

    // First-person pass (own scene/camera so the weapon never clips into walls).
    this.viewScene = new THREE.Scene();
    this.viewScene.environment = env;
    this.viewScene.environmentIntensity = 0.9;
    this.viewScene.add(new THREE.HemisphereLight(0xdfeaff, 0x7a7568, 0.7));
    const vl = new THREE.DirectionalLight(0xfff0dc, 2.2);
    vl.position.set(-1.5, 2, 1);
    this.viewScene.add(vl);
    this.viewCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vm = FP_WEAPONS.map((id) => {
      const g = new THREE.Group();
      const model = clone(assets[id + '_fp'].scene);
      applyAnisotropy(model, this.aniso);
      model.traverse((o) => {
        if (o.isMesh) o.frustumCulled = false;
      });
      g.add(model);
      g.userData.slide = model.getObjectByName('slide');
      g.userData.mag = model.getObjectByName('mag');
      g.userData.bolt = model.getObjectByName('bolt');
      for (const k of ['slide', 'mag', 'bolt']) if (g.userData[k]) g.userData[k + 'Rest'] = g.userData[k].position.clone();
      g.visible = false;
      this.viewScene.add(g);
      return g;
    });
    this.nadeHold = new NadeHold(this);
    this.vmFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.24),
      new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.vmFlash.visible = false;
    this.viewScene.add(this.vmFlash);
    // Ejected brass (first person only, purely cosmetic).
    this.casings = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.04, 6), new THREE.MeshStandardMaterial({ color: 0xc79a3a, metalness: 1, roughness: 0.35 }));
      m.visible = false;
      m.userData = { life: 0, v: new THREE.Vector3() };
      this.viewScene.add(m);
      return m;
    });

    this.tracers = Array.from({ length: 24 }, () => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.8 }),
      );
      m.visible = false;
      m.userData.life = 0;
      this.scene.add(m);
      return m;
    });
    this.puffs = Array.from({ length: 24 }, () => {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.08, 0),
        new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true }),
      );
      m.visible = false;
      m.userData.life = 0;
      this.scene.add(m);
      return m;
    });

    this.loadout = new Loadout(spec);
    this.input.cycleWeapon = (dir) => this.cycleWeapon(dir); // gamepad: next / previous weapon
    this.kin = createKin();
    this.eyeOff = spec.player.eyeHeight;
    this.prev = { ...this.kin };
    this.alive = false;
    this.tickNo = 0;
    this.acc = 0;
    this.last = 0;
    this.kick = 0;
    this.punch = 0;
    this.camLag = 0; // radians the camera still trails behind input.pitch after a kick (visual only)
    this.scopeT = 0; // 0..1 zoom blend
    this.scopeFov = BASE_FOV;
    this.sinceFire = 99;
    this.flashT = 0;
    this.swing = 0;
    this.swingKind = 0; // knife combo step: 0 slash right-to-left, 1 backhand, 2 stab
    this.swingTick = -1e9; // tick of the last knife swing; a pause of 27 ticks (0.9 s) restarts the combo
    this.switchT = 0;
    this.bob = 0;
    this.footsteps = new Footsteps(this);
    this.deadT = 0;
    this.frames = 0;
    this.fpsT = 0;
    this.speed = 0;
    this.myTeam = 'A';
    this.rng = Math.random;

    this.syncPostfx(); // Graphics = Ultra stored from an earlier session
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  // Compile every shader variant up front (characters, first-person models, shadows) so the first frame in a
  // match does not stall for seconds. Temporary soldiers are added to the scene only for the compile.
  async warmup() {
    const tmp = ['character_a', 'character_b'].map((k) => new Soldier(this.assets[k], this.spec, this.assets.sniper));
    tmp.forEach((t) => this.scene.add(t.group));
    this.vm.forEach((g) => (g.visible = true));
    try {
      if (this.renderer.extensions.has('KHR_parallel_shader_compile')) {
        await this.renderer.compileAsync(this.scene, this.camera);
        await this.renderer.compileAsync(this.viewScene, this.viewCam);
      } else {
        this.renderer.compile(this.scene, this.camera);
        this.renderer.compile(this.viewScene, this.viewCam);
      }
    } finally {
      this.vm.forEach((g) => (g.visible = false));
      tmp.forEach((t) => {
        this.scene.remove(t.group);
        t.dispose();
      });
    }
  }

  // Swap the playable map (collision data + rendered glb). Safe only while no match is running.
  setMap(id, map, glbScene) {
    if (this.world) {
      this.scene.remove(this.world); // geometry stays cached in the glb so switching back is instant
    }
    this.mapId = id;
    this.map = map;
    this.world = buildWorld(map, glbScene, this.aniso);
    this.scene.add(this.world);
    this.decals.map = map;
    this.decals.clear();
    this.pickups.clear();
    this.grenades.clear();
    fitShadow(this.sun, map);
    this.radar.setMap(map);
  }

  pixelRatio() {
    return this.quality !== 'low' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
  }

  setQuality(q) {
    this.quality = q === 'low' ? 'low' : q === 'ultra' ? 'ultra' : 'high';
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.sun.castShadow = this.quality !== 'low';
    this.syncPostfx();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.scene.traverse((o) => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true; // shadow shader variants
    });
    try {
      localStorage.setItem('sz.quality', this.quality);
    } catch {
      // skip: persisting the quality choice is a convenience only
    }
    this.resize();
  }

  // Ultra = post-processing; any failure (old GPU, missing float targets) falls back to the plain path instead of breaking the game.
  syncPostfx() {
    if (this.quality === 'ultra' && !this.postfx) {
      try {
        this.postfx = new PostFx(this.renderer, this.scene, this.camera);
      } catch (e) {
        console.warn('Ultra graphics unavailable, using High:', e);
        this.quality = 'high';
        this.postfx = null;
      }
    } else if (this.quality !== 'ultra' && this.postfx) {
      this.postfx.dispose();
      this.postfx = null;
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.postfx) this.postfx.resize(w, h);
    this.camera.aspect = this.viewCam.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCam.updateProjectionMatrix();
  }

  start(mode) {
    this.nadeHold.reset();
    this.mode = mode;
    this.running = true;
    this.input.enabled = true;
    this.last = performance.now();
    this.acc = 0;
    this.hud.show(true);
    this._raf = requestAnimationFrame((t) => this.frame(t));
    if (mode.onStart) mode.onStart(this);
  }

  stop() {
    this.running = false;
    this.input.enabled = false;
    cancelAnimationFrame(this._raf);
    if (this.mode && this.mode.stop) this.mode.stop();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.decals.clear();
    this.pickups.clear();
    this.grenades.clear();
    this.hud.show(false);
    this.mode = null;
  }

  // Place local player. cmd of server/mode decides when.
  spawn(x, y, z, yaw) {
    this.kin = createKin(x, y, z);
    this.eyeOff = this.spec.player.eyeHeight;
    this.prev = { ...this.kin };
    this.input.yaw = yaw;
    this.input.pitch = 0;
    this.alive = true;
    this.deadT = 0;
    this.punch = 0;
    this.camLag = 0;
    this.sfx.play('spawn');
  }

  eye() {
    return [this.kin.x, this.kin.y + eyeOf(this.spec, this.kin), this.kin.z];
  }

  listener() {
    return { x: this.kin.x, y: this.kin.y + eyeOf(this.spec, this.kin), z: this.kin.z, yaw: this.input.yaw };
  }

  playAt(name, pos) {
    this.sfx.play(name, pos, this.listener());
  }

  addRemote(id, nick, team, showLabel) {
    this.removeRemote(id);
    const r = new RemoteView(this, id, nick, team, showLabel);
    this.remotes.set(id, r);
    return r;
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (r) {
      r.dispose();
      this.remotes.delete(id);
    }
  }

  tracer(from, to) {
    const m = this.tracers.find((t) => !t.visible) || this.tracers[0];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;
    m.position.set(from[0] + dx / 2, from[1] + dy / 2, from[2] + dz / 2);
    m.scale.set(0.012, 0.012, len);
    m.lookAt(to[0], to[1], to[2]);
    m.userData.life = 0.07;
    m.visible = true;
  }

  puff(pos, color) {
    const m = this.puffs.find((t) => !t.visible) || this.puffs[0];
    m.position.set(pos[0], pos[1], pos[2]);
    m.material.color.setHex(color);
    m.material.opacity = 1;
    m.scale.setScalar(1);
    m.userData.life = 0.25;
    m.visible = true;
  }

  // ---- fixed tick -------------------------------------------------------------------------
  tick() {
    this.tickNo++;
    const cmd = this.input.sample();
    cmd.yaw = this.input.yaw;
    cmd.pitch = this.input.pitch;
    this.nadeHold.tick(cmd, this.mode && this.mode.nades, this.tickNo);
    if (!this.alive || (this.mode && (this.mode.frozen || this.mode.offline))) {
      Object.assign(cmd, { f: 0, s: 0, jump: false, fire: false, reload: false, weapon: -1, scope: false, nade: 0 });
    }
    this.prev = { ...this.kin };
    let res = null;
    if (this.alive) {
      const wasGround = this.kin.onGround;
      const fallVy = this.kin.vy; // vertical speed before the step (landing loudness)
      stepMove(this.spec, this.map, this.kin, cmd);
      const dx = this.kin.x - this.prev.x;
      const dz = this.kin.z - this.prev.z;
      const d = Math.hypot(dx, dz);
      this.speed = d * this.spec.tickRate;
      if (cmd.jump && wasGround && !this.kin.onGround) this.playAt('jump', this.eye());
      this.footsteps.local(cmd, this.kin, d, this.speed, wasGround, fallVy); // steps by surface, stride and landing thuds
      res = this.loadout.step(cmd, this.tickNo);
      this.onLocalWeapon(res, cmd);
    }
    if (this.mode && this.mode.onTick) this.mode.onTick(cmd, res, this);
  }

  // Select the next (dir 1) / previous (-1) weapon you own.
  cycleWeapon(dir) {
    const l = this.loadout;
    const n = this.spec.weapons.length;
    for (let i = 1; i < n; i++) {
      const j = (((l.cur + dir * i) % n) + n) % n;
      if (l.has[j]) {
        this.input.weapon = j;
        return;
      }
    }
  }

  onLocalWeapon(res, cmd) {
    const w = this.loadout.weapon;
    if (res.switched) {
      this.switchT = 0.25;
      this.playAt('switch', null);
    }
    if (res.reloadStarted) this.sfx.play('reload');
    if (res.empty) this.sfx.play('empty');
    if (res.fired) {
      this.sfx.play(w.id);
      this.kick = 1;
      this.sinceFire = 0;
      if (w.melee) {
        this.swingKind = this.tickNo - this.swingTick > 27 ? 0 : (this.swingKind + 1) % KNIFE_SWINGS.length;
        this.swingTick = this.tickNo;
        this.swing = 1;
      }
      else {
        this.flashT = 0.05;
        this.ejectCasing();
      }
      // view kick: proportional to the weapon's damage and growing while the trigger is held (see weapons.js burstKick)
      const rp = burstKick(this.spec, w, this.loadout.burst);
      this.input.pitch = Math.min(1.55, this.input.pitch + rp);
      this.input.yaw += (Math.random() - 0.5) * 2 * rp * this.spec.recoil.yawRatio;
      this.punch += rp;
      this.camLag += rp; // the camera climbs over a few frames instead of snapping (aim itself already moved)
      if (w.scopeFov > 0) this.shake = Math.max(this.shake, this.scoped ? 0.9 : 0.5); // bolt-action thump
    }
  }

  // ---- frame ------------------------------------------------------------------------------
  frame(nowMs) {
    if (!this.running) return;
    this._raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.acc += dt;
    const step = 1 / this.spec.tickRate;
    let n = 0;
    while (this.acc >= step && n < 5) {
      this.tick();
      this.acc -= step;
      n++;
    }
    if (n === 5) this.acc = 0;
    const alpha = this.acc / step;

    this.sinceFire += dt;
    if (this.sinceFire > 0.15 && this.punch > 0) {
      const r = Math.min(this.punch, 0.35 * dt);
      this.input.pitch -= r;
      this.punch -= r;
    }
    if (this.mode && this.mode.onFrame) this.mode.onFrame(dt, nowMs, this);
    for (const r of this.remotes.values()) r.update(nowMs, dt);
    this.updateCamera(dt, alpha);
    this.updateEffects(dt);
    this.radar.frame(dt);

    if (this.postfx) {
      this.postfx.render(dt);
    } else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.clearDepth();
    if (this.alive && !this.debugCam) this.renderer.render(this.viewScene, this.viewCam);

    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 1) {
      this.hud.setFps(this.frames);
      this.frames = 0;
      this.fpsT = 0;
    }
  }

  updateCamera(dt, alpha) {
    const p = this.prev;
    const k = this.kin;
    // the camera glides between standing and crouched eye height (the simulation switches instantly)
    this.eyeOff += (eyeOf(this.spec, k) - this.eyeOff) * (1 - Math.exp(-dt * 16));
    // walking up/down steps moves the feet instantly; glide the camera over small height changes (jumps and falls follow exactly)
    const rawY = lerp(p.y, k.y, alpha);
    if (this.camY === undefined || !k.onGround || Math.abs(rawY - this.camY) > 0.6) this.camY = rawY;
    else this.camY += (rawY - this.camY) * (1 - Math.exp(-dt * 18));
    let ey = this.camY + this.eyeOff;
    if (!this.alive) {
      this.deadT = Math.min(1, this.deadT + dt * 2);
      ey = lerp(ey, k.y + 0.3, this.deadT);
    }
    this.camera.position.set(lerp(p.x, k.x, alpha), ey, lerp(p.z, k.z, alpha));
    this.camera.rotation.order = 'YXZ';
    this.shake *= Math.exp(-dt * 6);
    const sh = this.shake > 0.01 ? this.shake * 0.05 : 0;
    this.camLag *= Math.exp(-dt * 28);
    this.camera.rotation.set(this.input.pitch - this.camLag + (sh ? (Math.random() - 0.5) * sh : 0), this.input.yaw + (sh ? (Math.random() - 0.5) * sh : 0), this.alive ? 0 : this.deadT * 0.6);
    if (this.debugCam) { // free camera for screenshots/tests: {pos:[x,y,z], look:[x,y,z]}
      this.camera.position.set(...this.debugCam.pos);
      this.camera.lookAt(...this.debugCam.look);
    }

    this.updateScope(dt);

    // view model
    this.bob += dt * (this.alive && k.onGround ? this.speed : 0) * 1.6;
    const cur = this.loadout.cur;
    const holdingNade = this.nadeHold.eq >= 0;
    this.vm.forEach((g, i) => (g.visible = this.alive && i === cur && !this.scoped && !holdingNade));
    const g = this.vm[cur];
    this.kick = Math.max(0, this.kick - dt * 9);
    this.swing = Math.max(0, this.swing - dt * 2.4); // a full swing takes ~0.42 s, about the knife's cooldown
    if (this.debugSwing) {
      // screenshots/tests: freeze a knife swing at {kind, t}
      this.swingKind = this.debugSwing.kind;
      this.swing = 1 - this.debugSwing.t;
    }
    this.switchT = Math.max(0, this.switchT - dt);
    let drop = this.switchT * 1.6;
    let rotX = this.kick * 0.1;
    let rotY = 0;
    let rotZ = 0;
    if (this.loadout.reloading) {
      const w = this.loadout.weapon;
      const prog = 1 - (this.loadout.reloadDone - this.tickNo) / w.reloadTicks;
      const s = Math.sin(Math.max(0, Math.min(1, prog)) * Math.PI);
      drop += s * 0.35;
      rotX -= s * 0.5;
      rotZ += s * 0.3;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    if (this.swing > 0 && this.loadout.weapon.melee) {
      const pose = knifePose(KNIFE_SWINGS[this.swingKind], 1 - this.swing);
      [sx, sy, sz] = pose;
      rotX += pose[3];
      rotY += pose[4];
      rotZ += pose[5];
    }
    // breathing sway so a held weapon is never perfectly still
    const sway = Math.sin(performance.now() / 1000 * 1.7);
    const fp = FP[FP_WEAPONS[cur]];
    g.scale.setScalar(fp.scale);
    g.position.set(
      fp.pos[0] + Math.sin(this.bob) * 0.008 + sx,
      fp.pos[1] - drop + Math.abs(Math.cos(this.bob)) * 0.006 + sway * 0.0015 + sy,
      fp.pos[2] + this.kick * 0.05 + sz,
    );
    g.rotation.set(rotX + (this.loadout.weapon.melee ? 0.25 : 0) + sway * 0.006, rotY + sway * 0.004, rotZ);

    // moving parts: pistol slide kicks back; rifle bolt + magazine move during a reload
    const u = g.userData;
    if (u.slide) u.slide.position.z = u.slideRest.z + this.kick * 0.03;
    if (u.mag || u.bolt) {
      let r = 0;
      if (this.loadout.reloading) {
        const w = this.loadout.weapon;
        const prog = Math.max(0, Math.min(1, 1 - (this.loadout.reloadDone - this.tickNo) / w.reloadTicks));
        r = prog < 0.25 ? prog / 0.25 : prog < 0.6 ? 1 : Math.max(0, 1 - (prog - 0.6) / 0.25);
      }
      if (u.mag) u.mag.position.y = u.magRest.y - r * 0.16;
      if (u.bolt) u.bolt.position.z = u.boltRest.z + (this.loadout.reloading ? 0.04 * Math.max(0, r - 0.5) * 2 : 0);
    }

    this.nadeHold.frame(dt, NADE_POS, drop, this.bob);
    this.hud.setNadeHold(holdingNade ? this.spec.grenades[this.nadeHold.eq] : null, this.nadeHold.charging ? this.nadeHold.charge : -1, this.mode && this.mode.nades, this.nadeHold.eq);

    this.flashT -= dt;
    this.vmFlash.visible = this.alive && !this.scoped && !holdingNade && this.flashT > 0 && !!fp.muzzle;
    if (this.vmFlash.visible) {
      const m = new THREE.Vector3(fp.muzzle[0], fp.muzzle[1], fp.muzzle[2]).multiplyScalar(fp.scale).applyEuler(g.rotation).add(g.position);
      this.vmFlash.position.copy(m);
      this.vmFlash.rotation.z = Math.random() * 3;
      this.vmFlash.scale.setScalar(0.8 + Math.random() * 0.5);
      this.vmFlash.quaternion.copy(this.viewCam.quaternion);
      this.vmFlash.rotateZ(Math.random() * 3);
    }
  }

  ejectCasing() {
    const fp = FP[FP_WEAPONS[this.loadout.cur]];
    if (!fp.port) return;
    const m = this.casings.find((c) => !c.visible) || this.casings[0];
    const g = this.vm[this.loadout.cur];
    const p = new THREE.Vector3(fp.port[0], fp.port[1], fp.port[2]).multiplyScalar(fp.scale).applyEuler(g.rotation).add(g.position);
    m.position.copy(p);
    m.userData.v.set(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.6 + Math.random() * 0.4);
    m.userData.life = 0.7;
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.visible = true;
  }

  updateEffects(dt) {
    this.decals.update(dt);
    this.pickups.update(dt);
    this.grenades.update(dt);
    for (const c of this.casings) {
      if (!c.visible) continue;
      c.userData.life -= dt;
      c.userData.v.y -= 6 * dt;
      c.position.addScaledVector(c.userData.v, dt);
      c.rotation.x += 14 * dt;
      c.rotation.z += 9 * dt;
      if (c.userData.life <= 0) c.visible = false;
    }
    for (const m of this.tracers) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      if (m.userData.life <= 0) m.visible = false;
    }
    for (const m of this.puffs) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      m.scale.multiplyScalar(1 + dt * 5);
      m.material.opacity = Math.max(0, m.userData.life / 0.25);
      if (m.userData.life <= 0) m.visible = false;
    }
  }

  // Looking through the scope (viewmodel hidden, overlay shown).
  get scoped() {
    return this.scopeT > 0.5;
  }

  // Scope zoom: right click toggles it (touch: SCOPE button) with a scoped weapon. Blends the camera FOV, scales look
  // sensitivity with the zoom and drives the overlay. The server applies the accuracy bonus from the `scope` input.
  updateScope(dt) {
    const w = this.loadout.weapon;
    const can = this.alive && w.scopeFov > 0 && !this.loadout.reloading && this.nadeHold.eq < 0;
    if (!can) this.input.scopeHeld = false; // toggled state ends when the scope stops being usable (reload, switch, death)
    const want = can && this.input.scopeHeld;
    if (want !== !!this._scopeWant) { // edge only: scope turned on / off (also by reload, weapon switch or pause)
      this._scopeWant = want;
      if (this.alive) this.sfx.play(want ? 'scope_in' : 'scope_out'); // local and non-positional
    }
    if (w.scopeFov > 0) this.scopeFov = w.scopeFov;
    this.scopeT = Math.max(0, Math.min(1, this.scopeT + (want ? 1 : -1) * dt * 7));
    if (!this.alive) this.scopeT = 0;
    const e = this.scopeT * this.scopeT * (3 - 2 * this.scopeT);
    const fov = BASE_FOV + (this.scopeFov - BASE_FOV) * e;
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.input.sensScale = Math.tan((fov * Math.PI) / 360) / Math.tan((BASE_FOV * Math.PI) / 360);
    this.hud.setScope(this.scopeT);
  }

  // Direction for the player's shot (adds server-identical spread model).
  aimWithSpread(cmd) {
    const w = this.loadout.weapon;
    const hs = Math.min(1, this.speed / this.spec.player.runSpeed);
    const scoped = cmd.scope && w.scopeFov > 0;
    const sp = spread(this.spec, w, scoped, this.kin.onGround ? hs : 1, this.loadout.burst);
    let yaw = cmd.yaw;
    let pitch = cmd.pitch;
    if (sp > 0) {
      const r = sp * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      yaw += r * Math.cos(a);
      pitch += r * Math.sin(a);
    }
    return aimDir(yaw, pitch);
  }

  muzzlePos(dir) {
    const e = this.eye();
    const y = this.input.yaw;
    const rx = Math.cos(y);
    const rz = -Math.sin(y);
    return [e[0] + dir[0] * 0.6 + rx * 0.18, e[1] + dir[1] * 0.6 - 0.14, e[2] + dir[2] * 0.6 + rz * 0.18];
  }

  worldHit(o, d, maxT) {
    return rayWorld(this.map, o, d, maxT);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
