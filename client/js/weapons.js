// Client mirror of server weapon state machine (server/internal/game/weapons.go).
// Used for instant feedback online and as the authority in offline practice mode.

// Recoil model (mirrors Spec.Kick/Bloom/Spread in server/internal/game/spec.go; spec.recoil + per-weapon scales).
// Kick = view kick of the first shot, proportional to damage: harder-hitting weapons kick harder.
export function kick(spec, w) {
  return spec.recoil.perDamage * w.damage * w.recoilScale;
}

// Kick of the burst-th consecutive shot: ramps up while the trigger is held.
export function burstKick(spec, w, burst) {
  const r = spec.recoil;
  return kick(spec, w) * (1 + r.rampPerShot * (Math.min(Math.max(burst, 1), r.maxShots) - 1));
}

// Extra spread (rad) on the burst-th consecutive shot (1 = first shot: none).
export function bloom(spec, w, burst) {
  if (burst < 2) return 0;
  return spec.recoil.bloomRatio * kick(spec, w) * w.bloomScale * (Math.min(burst, spec.recoil.maxShots) - 1);
}

// Half-angle (rad) of the cone a shot is fired in. moveFrac: 0 standing .. 1 running/airborne.
export function spread(spec, w, scoped, moveFrac, burst) {
  return (scoped ? w.scopedSpread || 0 : w.spread) + w.moveSpread * moveFrac + bloom(spec, w, burst);
}

// Name shown in the kill feed: real weapons come first, grenades follow them (server event convention).
export function weaponName(spec, w) {
  if (w < spec.weapons.length) return spec.weapons[w].name;
  const gi = w - spec.weapons.length;
  if (gi === (spec.grenades || []).length) return 'Fall'; // fall damage comes after the grenades
  const g = spec.grenades && spec.grenades[gi];
  return g ? g.name : 'Grenade';
}

export class Loadout {
  constructor(spec) {
    this.spec = spec;
    this.reset();
  }

  reset() {
    this.cur = 0;
    this.has = this.spec.weapons.map((w) => !w.pickupOnly);
    this.mag = this.spec.weapons.map((w) => (w.pickupOnly ? 0 : w.magSize));
    this.res = this.spec.weapons.map((w) => (w.pickupOnly ? 0 : w.reserve));
    this.nextFire = 0;
    this.reloadDone = 0;
    this.prevFire = false;
    this.prevHeavy = false;
    this.burst = 0; // consecutive shots; drives spread bloom and view-kick ramp
    this.burstUntil = 0;
  }

  get weapon() {
    return this.spec.weapons[this.cur];
  }

  get reloading() {
    return this.reloadDone > 0;
  }

  // Overwrite from authoritative server state as of local tick `tAck` (the acked input's tick).
  // Caller then replays unacknowledged inputs through step().
  sync(you, tAck) {
    this.cur = you.w;
    if (you.has) this.has = you.has.slice();
    this.mag = you.mag.slice();
    this.res = you.res.slice();
    this.nextFire = tAck + you.cd;
    this.reloadDone = you.rl > 0 ? tAck + you.rl : 0;
    this.prevFire = you.pf;
    this.prevHeavy = false; // the pulse is one tick long and `cd` already covers a started stab
    this.burst = you.bu || 0;
    this.burstUntil = tAck + (you.bx || 0);
  }

  // One fixed tick. Returns {fired, empty, reloadStarted, reloadDone, switched, heavy} (heavy: a melee stab was started).
  step(inp, tick) {
    const out = { fired: false, empty: false, reloadStarted: false, reloadDone: false, switched: false, heavy: false };
    let w = this.weapon;
    if (this.reloadDone > 0 && tick >= this.reloadDone) {
      const n = Math.min(w.magSize - this.mag[this.cur], this.res[this.cur]);
      this.mag[this.cur] += n;
      this.res[this.cur] -= n;
      this.reloadDone = 0;
      out.reloadDone = true;
    }
    if (inp.weapon >= 0 && inp.weapon < this.spec.weapons.length && inp.weapon !== this.cur && this.has[inp.weapon]) {
      this.cur = inp.weapon;
      w = this.weapon;
      this.reloadDone = 0;
      this.burst = 0;
      this.nextFire = Math.max(this.nextFire, tick + this.spec.switchTicks);
      out.switched = true;
    }
    if (inp.reload && this.canReload(w) && tick >= this.nextFire) {
      this.reloadDone = tick + w.reloadTicks;
      this.burst = 0;
      out.reloadStarted = true;
    }
    const heavy = !!inp.heavy && !this.prevHeavy;
    this.prevHeavy = !!inp.heavy;
    if (heavy && w.heavy && tick >= this.nextFire && this.reloadDone === 0) {
      this.nextFire = tick + w.heavy.intervalTicks;
      this.burst = 0;
      out.heavy = true;
    }
    const wants = inp.fire && (w.auto || !this.prevFire);
    this.prevFire = inp.fire;
    if (wants && tick >= this.nextFire && this.reloadDone === 0) {
      if (w.magSize > 0 && this.mag[this.cur] === 0) {
        this.burst = 0;
        if (this.res[this.cur] > 0) {
          this.reloadDone = tick + w.reloadTicks;
          out.reloadStarted = true;
        } else {
          out.empty = true;
        }
        this.nextFire = tick + w.intervalTicks;
      } else {
        if (w.magSize > 0) this.mag[this.cur]--;
        this.nextFire = tick + w.intervalTicks;
        this.burst = this.burst > 0 && tick <= this.burstUntil ? this.burst + 1 : 1;
        this.burstUntil = tick + w.intervalTicks + this.spec.recoil.graceTicks;
        out.fired = true;
      }
    }
    return out;
  }

  canReload(w) {
    return w.magSize > 0 && this.mag[this.cur] < w.magSize && this.res[this.cur] > 0 && this.reloadDone === 0;
  }
}
