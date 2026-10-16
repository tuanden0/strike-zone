// Client mirror of server weapon state machine (server/internal/game/weapons.go).
// Used for instant feedback online and as the authority in offline practice mode.

export class Loadout {
  constructor(spec) {
    this.spec = spec;
    this.reset();
  }

  reset() {
    this.cur = 0;
    this.mag = this.spec.weapons.map((w) => w.magSize);
    this.res = this.spec.weapons.map((w) => w.reserve);
    this.nextFire = 0;
    this.reloadDone = 0;
    this.prevFire = false;
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
    this.mag = you.mag.slice();
    this.res = you.res.slice();
    this.nextFire = tAck + you.cd;
    this.reloadDone = you.rl > 0 ? tAck + you.rl : 0;
    this.prevFire = you.pf;
  }

  // One fixed tick. Returns {fired, empty, reloadStarted, reloadDone, switched}.
  step(inp, tick) {
    const out = { fired: false, empty: false, reloadStarted: false, reloadDone: false, switched: false };
    let w = this.weapon;
    if (this.reloadDone > 0 && tick >= this.reloadDone) {
      const n = Math.min(w.magSize - this.mag[this.cur], this.res[this.cur]);
      this.mag[this.cur] += n;
      this.res[this.cur] -= n;
      this.reloadDone = 0;
      out.reloadDone = true;
    }
    if (inp.weapon >= 0 && inp.weapon < this.spec.weapons.length && inp.weapon !== this.cur) {
      this.cur = inp.weapon;
      w = this.weapon;
      this.reloadDone = 0;
      this.nextFire = Math.max(this.nextFire, tick + this.spec.switchTicks);
      out.switched = true;
    }
    if (inp.reload && this.canReload(w) && tick >= this.nextFire) {
      this.reloadDone = tick + w.reloadTicks;
      out.reloadStarted = true;
    }
    const wants = inp.fire && (w.auto || !this.prevFire);
    this.prevFire = inp.fire;
    if (wants && tick >= this.nextFire && this.reloadDone === 0) {
      if (w.magSize > 0 && this.mag[this.cur] === 0) {
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
        out.fired = true;
      }
    }
    return out;
  }

  canReload(w) {
    return w.magSize > 0 && this.mag[this.cur] < w.magSize && this.res[this.cur] > 0 && this.reloadDone === 0;
  }
}
