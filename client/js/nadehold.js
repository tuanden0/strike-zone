// Holding a grenade: X/C/V (touch: NADE) equips it like a weapon, hold FIRE to charge the throw (power bar + predicted arc), release
// to throw, RIGHT CLICK (scope) while charging cancels. The server only sees the release: `nade` (type + 1) and `np` (power 0..1).
import * as THREE from '../vendor/three.module.js';

const MIN_POWER_SENT = 0.02; // np 0 means "full power" on the wire
const THROW_TIME = 0.35; // seconds of throw animation

// The grenade in the player's hand: body, spoon lever, and a gloved fist on a sleeve (first-person scene).
function buildGrenadeModel(kind) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: { frag: 0x3c4a2e, smoke: 0x8a8f94, flash: 0xc9ccd6 }[kind] || 0x555555, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8, metalness: 0.1 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5448, roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.8 });
  const core = kind === 'frag' ? new THREE.SphereGeometry(0.05, 14, 10) : new THREE.CylinderGeometry(0.035, 0.035, 0.13, 14);
  const b = new THREE.Mesh(core, body);
  if (kind === 'frag') b.scale.y = 1.2;
  g.add(b);
  if (kind !== 'frag') {
    for (const y of [-0.045, 0.045]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0365, 0.0365, 0.012, 14), dark);
      band.position.y = y;
      g.add(band);
    }
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.03, 10), metal);
  top.position.y = kind === 'frag' ? 0.07 : 0.08;
  g.add(top);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.085, 0.02), metal);
  lever.position.set(0.04, 0.03, 0);
  lever.rotation.z = -0.08;
  g.add(lever);
  const pin = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 12), metal);
  pin.position.set(0.0, top.position.y + 0.012, 0.022);
  g.add(pin);
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.07, 0.09), dark);
  fist.position.set(0.0, -0.045, 0.06);
  g.add(fist);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), sleeve);
  arm.position.set(0.02, -0.14, 0.32);
  arm.rotation.x = 0.55;
  g.add(arm);
  return g;
}

export class NadeHold {
  constructor(game) {
    this.game = game;
    this.eq = -1; // equipped grenade type, -1 = a weapon is in hand
    this.charge = 0; // 0..1
    this.charging = false;
    this.coolUntil = 0; // tick when the next throw may start (mirrors the server cooldown)
    this.refire = false; // fire is still held after a cancel/throw: ignore it until released
    this.anim = 0; // seconds left of the throw animation
    this.models = game.spec.grenades.map((gs) => {
      const m = buildGrenadeModel(gs.kind);
      m.visible = false;
      m.scale.setScalar(0.8);
      game.viewScene.add(m);
      return m;
    });
  }

  reset() {
    this.eq = -1;
    this.charging = false;
    this.charge = 0;
    this.refire = false;
    this.anim = 0;
  }

  // Per tick, before the command is simulated/sent. counts = grenades left per type, or null when the mode has none.
  tick(cmd, counts, tickNo) {
    const spec = this.game.spec;
    const key = cmd.nadeKey;
    cmd.nadeKey = 0;
    if (!this.game.alive || !counts || (this.game.mode && this.game.mode.frozen)) {
      this.reset();
      return;
    }
    const inp = this.game.input;
    if (!(inp.locked && inp.enabled)) { // paused / menu: drop a half-charged throw instead of releasing it
      this.charging = false;
      this.charge = 0;
      return;
    }
    if (key) {
      const g = key - 1;
      if (g < spec.grenades.length && (this.eq === g || counts[g] > 0)) {
        this.eq = this.eq === g ? -1 : g;
        this.charging = false;
        this.charge = 0;
        this.refire = cmd.fire;
        this.game.switchT = 0.25; // lowers/raises the view model like a weapon switch
      }
    }
    if (cmd.weapon >= 0 && this.eq >= 0) this.reset(); // picking a weapon slot puts the grenade away
    if (this.eq >= 0 && !this.charging && counts[this.eq] <= 0) this.reset(); // none left
    if (this.eq < 0) return;

    const fire = cmd.fire;
    const cancel = cmd.scope;
    cmd.fire = false; // the grenade is not a gun
    cmd.reload = false;
    cmd.scope = false;
    inp.scopeHeld = false; // right click is "cancel" here, not a zoom toggle
    if (cancel && this.charging) {
      this.charging = false;
      this.charge = 0;
      this.refire = fire;
      return;
    }
    if (!fire) {
      this.refire = false;
      if (this.charging) {
        cmd.nade = this.eq + 1;
        cmd.np = Math.max(MIN_POWER_SENT, this.charge);
        this.coolUntil = tickNo + spec.nades.cooldownTicks;
        this.anim = THROW_TIME;
        this.charging = false;
        this.charge = 0;
      }
      return;
    }
    if (this.refire || tickNo < this.coolUntil) return;
    this.charging = true;
    this.charge = Math.min(1, this.charge + 1 / (spec.tickRate * spec.nades.chargeSeconds));
  }

  // Per frame: pose the held grenade in the first-person scene and update the arc preview.
  frame(dt, base, drop, bob) {
    this.anim = Math.max(0, this.anim - dt);
    const game = this.game;
    this.models.forEach((m, i) => (m.visible = game.alive && !game.scoped && i === this.eq));
    if (this.eq < 0 || !game.alive) {
      game.grenades.preview(null);
      return;
    }
    const m = this.models[this.eq];
    const c = this.charging ? this.charge : 0;
    const t = this.anim > 0 ? 1 - this.anim / THROW_TIME : 0; // 0..1 through the throw
    const swing = this.anim > 0 ? Math.sin(Math.min(1, t * 1.2) * Math.PI) : 0;
    const shake = this.charging ? Math.sin(performance.now() / 45) * 0.002 * c : 0;
    m.position.set(base[0] + shake, base[1] - drop + Math.abs(Math.cos(bob)) * 0.004 + c * 0.03 + swing * 0.04, base[2] + c * 0.07 - swing * 0.3);
    m.rotation.set(-0.15 - c * 0.18 + swing * 0.9, 0.1 + c * 0.15, -0.1);
    this.previewArc();
  }

  // The predicted path of a throw at the current charge (or half power while only holding it), drawn in the world.
  previewArc() {
    const game = this.game;
    const spec = game.spec;
    const gs = spec.grenades[this.eq];
    const power = this.charging ? this.charge : 0.5;
    game.grenades.preview(game.eye(), game.input.yaw, game.input.pitch, gs, spec.nades.minPower + (1 - spec.nades.minPower) * power, this.charging);
  }
}
