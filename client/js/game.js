// Rendering + fixed-tick local simulation. Mode objects (practice.js / online.js) plug in game rules.
import * as THREE from '../vendor/three.module.js';
import { stepMove, createKin, aimDir, rayWorld } from './physics.js';
import { Loadout } from './weapons.js';
import { buildWorld, buildLights, TEAM_COLORS } from './world.js';
import { createCharacter, createWeaponModel, nameSprite } from './models.js';

const INTERP_MS = 100;
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
    this.fall = 0;
    this.flash = 0;
    this.stepDist = 0;
    this.last = null;
    this.t = 0;
    const ids = game.spec.weapons.map((w) => w.id);
    this.char = createCharacter(game.spec, TEAM_COLORS[team] ?? 0xcccccc, ids);
    this.group = this.char.group;
    this.char.setWeapon(0);
    game.scene.add(this.group);
    this.label = null;
    if (showLabel) {
      this.label = nameSprite(nick, '#bcd8ff');
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
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;
    this.fall = Math.max(0, Math.min(1, this.fall + (this.alive ? -dt * 4 : dt * 3)));
    this.char.setDead(this.fall);
    this.t += dt;
    let speed = 0;
    if (this.last && dt > 0) {
      const dx = s.x - this.last.x;
      const dz = s.z - this.last.z;
      const d = Math.hypot(dx, dz);
      speed = d / dt;
      if (this.alive && s.y < 0.05 && speed > 3.5) {
        this.stepDist += d;
        if (this.stepDist > 2.4) {
          this.stepDist = 0;
          this.game.playAt('step', [s.x, s.y, s.z]);
        }
      }
    }
    this.last = { x: s.x, y: s.y, z: s.z };
    this.char.animate(this.alive ? speed : 0, this.t);
    this.flash -= dt;
    this.char.muzzle.visible = this.flash > 0;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

export class Game {
  constructor({ canvas, spec, map, sfx, hud, input }) {
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    buildLights(this.scene);
    this.scene.add(buildWorld(map));
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 200);
    this.scene.add(this.camera);

    this.viewScene = new THREE.Scene();
    this.viewScene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
    const vl = new THREE.DirectionalLight(0xffffff, 1.2);
    vl.position.set(1, 2, 1);
    this.viewScene.add(vl);
    this.viewCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vm = spec.weapons.map((w) => {
      const g = new THREE.Group();
      const model = createWeaponModel(w.id);
      model.scale.setScalar(0.7);
      g.add(model);
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.45),
        new THREE.MeshLambertMaterial({ color: 0x3a4a63 }),
      );
      arm.position.set(0.02, -0.07, w.melee ? 0.12 : 0.2);
      arm.rotation.x = 0.25;
      g.add(arm);
      g.visible = false;
      this.viewScene.add(g);
      return g;
    });
    this.vmFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.vmFlash.visible = false;
    this.viewScene.add(this.vmFlash);

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
    this.kin = createKin();
    this.prev = { ...this.kin };
    this.alive = false;
    this.tickNo = 0;
    this.acc = 0;
    this.last = 0;
    this.kick = 0;
    this.punch = 0;
    this.sinceFire = 99;
    this.flashT = 0;
    this.swing = 0;
    this.switchT = 0;
    this.bob = 0;
    this.stepDist = 0;
    this.deadT = 0;
    this.frames = 0;
    this.fpsT = 0;
    this.speed = 0;
    this.myTeam = 'A';
    this.rng = Math.random;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.viewCam.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCam.updateProjectionMatrix();
  }

  start(mode) {
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
    this.hud.show(false);
    this.mode = null;
  }

  // Place local player. cmd of server/mode decides when.
  spawn(x, y, z, yaw) {
    this.kin = createKin(x, y, z);
    this.prev = { ...this.kin };
    this.input.yaw = yaw;
    this.input.pitch = 0;
    this.alive = true;
    this.deadT = 0;
    this.punch = 0;
    this.sfx.play('spawn');
  }

  eye() {
    return [this.kin.x, this.kin.y + this.spec.player.eyeHeight, this.kin.z];
  }

  listener() {
    return { x: this.kin.x, y: this.kin.y + this.spec.player.eyeHeight, z: this.kin.z, yaw: this.input.yaw };
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
    if (!this.alive || (this.mode && this.mode.frozen)) {
      Object.assign(cmd, { f: 0, s: 0, jump: false, fire: false, reload: false, weapon: -1 });
    }
    this.prev = { ...this.kin };
    let res = null;
    if (this.alive) {
      const wasGround = this.kin.onGround;
      stepMove(this.spec, this.map, this.kin, cmd);
      const dx = this.kin.x - this.prev.x;
      const dz = this.kin.z - this.prev.z;
      const d = Math.hypot(dx, dz);
      this.speed = d * this.spec.tickRate;
      if (this.kin.onGround && !wasGround && this.prev.y - this.kin.y > 0.05) this.playAt('land', this.eye());
      if (cmd.jump && wasGround && !this.kin.onGround) this.playAt('jump', this.eye());
      if (this.kin.onGround && !cmd.walk) {
        this.stepDist += d;
        if (this.stepDist > 2.2) {
          this.stepDist = 0;
          this.playAt('step', this.eye());
        }
      }
      res = this.loadout.step(cmd, this.tickNo);
      this.onLocalWeapon(res, cmd);
    }
    if (this.mode && this.mode.onTick) this.mode.onTick(cmd, res, this);
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
      if (w.melee) this.swing = 1;
      else this.flashT = 0.05;
      const rp = w.recoilPitch;
      this.input.pitch = Math.min(1.55, this.input.pitch + rp);
      this.input.yaw += (Math.random() - 0.5) * 2 * w.recoilYaw;
      this.punch += rp;
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

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    if (this.alive) this.renderer.render(this.viewScene, this.viewCam);

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
    const eyeH = this.spec.player.eyeHeight;
    let ey = lerp(p.y, k.y, alpha) + eyeH;
    if (!this.alive) {
      this.deadT = Math.min(1, this.deadT + dt * 2);
      ey = lerp(ey, k.y + 0.3, this.deadT);
    }
    this.camera.position.set(lerp(p.x, k.x, alpha), ey, lerp(p.z, k.z, alpha));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.input.pitch, this.input.yaw, this.alive ? 0 : this.deadT * 0.6);

    // view model
    this.bob += dt * (this.alive && k.onGround ? this.speed : 0) * 1.6;
    const cur = this.loadout.cur;
    this.vm.forEach((g, i) => (g.visible = this.alive && i === cur));
    const g = this.vm[cur];
    this.kick = Math.max(0, this.kick - dt * 9);
    this.swing = Math.max(0, this.swing - dt * 4.5);
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
    if (this.swing > 0) {
      const s = Math.sin((1 - this.swing) * Math.PI);
      rotY -= s * 0.9;
      rotX -= s * 0.6;
    }
    const base = this.loadout.weapon.melee ? [0.2, -0.2, -0.42] : cur === 1 ? [0.17, -0.16, -0.4] : [0.18, -0.17, -0.5];
    g.position.set(
      base[0] + Math.sin(this.bob) * 0.008,
      base[1] - drop + Math.abs(Math.cos(this.bob)) * 0.006,
      base[2] + this.kick * 0.05,
    );
    g.rotation.set(rotX, rotY, rotZ);

    this.flashT -= dt;
    this.vmFlash.visible = this.alive && this.flashT > 0;
    if (this.vmFlash.visible) {
      this.vmFlash.position.set(g.position.x, g.position.y + 0.02, g.position.z - (cur === 1 ? 0.22 : 0.55));
      this.vmFlash.rotation.z = Math.random() * 3;
    }
  }

  updateEffects(dt) {
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

  // Direction for the player's shot (adds server-identical spread model).
  aimWithSpread(cmd) {
    const w = this.loadout.weapon;
    const hs = Math.min(1, this.speed / this.spec.player.runSpeed);
    const sp = w.spread + w.moveSpread * (this.kin.onGround ? hs : 1);
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
