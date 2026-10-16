// Keyboard/mouse + Pointer Lock. Pointer Lock works on plain http:// (no secure context needed).

const SENS_KEY = 'sz.sens';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.sens = 0.0022;
    try {
      const s = parseFloat(localStorage.getItem(SENS_KEY));
      if (s > 0.0003 && s < 0.02) this.sens = s;
    } catch {
      // skip: storage may be blocked; default sensitivity is fine
    }
    this.mouseDown = false;
    this.tap = false;
    this.reload = false;
    this.weapon = -1;
    this.onLockChange = () => {};
    this.onScoreboard = () => {};
    this.enabled = false;

    document.addEventListener('pointerlockchange', () => this.onLockChange(this.locked));
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = Math.max(-300, Math.min(300, e.movementX));
      const dy = Math.max(-300, Math.min(300, e.movementY));
      this.yaw -= dx * this.sens;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * this.sens));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || e.button !== 0) return;
      this.mouseDown = true;
      this.tap = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    document.addEventListener('keydown', (e) => {
      if (!this.enabled || !this.locked) return;
      if (e.code === 'Tab') {
        e.preventDefault();
        this.onScoreboard(true);
        return;
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.reload = true;
      if (e.code === 'Digit1') this.weapon = 0;
      if (e.code === 'Digit2') this.weapon = 1;
      if (e.code === 'Digit3') this.weapon = 2;
      if (e.code === 'Space') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') {
        e.preventDefault();
        this.onScoreboard(false);
      }
    });
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // skip: user may press Esc immediately; overlay stays visible
    } catch {
      // skip: browser refused lock; pause overlay remains so user can click again
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  setSens(s) {
    this.sens = s;
    try {
      localStorage.setItem(SENS_KEY, String(s));
    } catch {
      // skip: persisting sensitivity is a convenience only
    }
  }

  // Called once per fixed tick. Consumes one-shot flags.
  sample() {
    const k = this.keys;
    const live = this.locked && this.enabled;
    const cmd = {
      f: live ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0,
      s: live ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0,
      jump: live && k.has('Space'),
      walk: live && (k.has('ShiftLeft') || k.has('ShiftRight')),
      fire: live && (this.mouseDown || this.tap),
      reload: live && this.reload,
      weapon: live ? this.weapon : -1,
      yaw: this.yaw,
      pitch: this.pitch,
    };
    this.tap = false;
    this.reload = false;
    this.weapon = -1;
    return cmd;
  }
}
