// Keyboard/mouse + Pointer Lock. Pointer Lock works on plain http:// (no secure context needed).

import { TouchControls, lockPageZoom } from './touch.js';

const SENS_KEY = 'sz.sens';

// Phones/tablets (primary pointer is a finger). `?touch=1` forces it for desktop testing.
export const isTouch = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
  } catch {
    return false; // skip: no matchMedia, assume mouse + keyboard
  }
})();

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
    this.drop = false;
    this.use = false;
    this.nade = 0; // grenade type + 1 to throw this tick
    this.nadeSel = 0; // touch: selected grenade type
    this.nadeNames = [];
    this.weapon = -1;
    this.onLockChange = () => {};
    this.onScoreboard = () => {};
    this.enabled = false;
    this.touch = isTouch;
    this.touchLocked = false;
    this.mv = { f: 0, s: 0 }; // touch stick axes
    this.crouchHeld = false; // touch CROUCH toggle
    this.scopeHeld = false; // scope toggled on (right click / touch SCOPE button)
    this.sensScale = 1; // < 1 while zoomed (set by Game.updateScope)
    if (this.touch) {
      document.body.classList.add('touch');
      document.documentElement.classList.add('touch');
      this.resetZoom = lockPageZoom();
      this.touchUi = new TouchControls(this);
    }

    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.scopeHeld = false; // pause / Esc leaves the scope
      this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.touch) return;
      this.turn(e.movementX, e.movementY);
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || this.touch) return; // touch: synthesized mouse events would double-fire
      if (e.button === 2 && !e.repeat) this.scopeHeld = !this.scopeHeld; // toggle: click to scope in, click again to leave
      if (e.button !== 0) return;
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
      this.scopeHeld = false;
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
      if (e.code === 'KeyG') this.drop = true;
      if (e.code === 'KeyE') this.use = true;
      if (e.code === 'KeyX') this.nade = 1;
      if (e.code === 'KeyC') this.nade = 2;
      if (e.code === 'KeyV') this.nade = 3;
      if (e.code === 'Digit1') this.weapon = 0;
      if (e.code === 'Digit2') this.weapon = 1;
      if (e.code === 'Digit3') this.weapon = 2;
      if (e.code === 'Digit4') this.weapon = 3;
      if (e.code === 'Space' || e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); // Alt would focus the browser menu
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
    return this.touch ? this.touchLocked : document.pointerLockElement === this.canvas;
  }

  setKey(code, down) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  // Relative look in mouse-pixel units (shared by mouse and touch).
  turn(dx, dy) {
    dx = Math.max(-300, Math.min(300, dx));
    dy = Math.max(-300, Math.min(300, dy));
    this.yaw -= dx * this.sens * this.sensScale;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * this.sens * this.sensScale));
  }

  lock() {
    if (this.touch) {
      this.resetZoom();
      this.touchLocked = true;
      this.touchUi.show(true);
      try {
        const el = document.documentElement;
        if (el.requestFullscreen && !document.fullscreenElement) {
          el.requestFullscreen({ navigationUI: 'hide' })
            .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
            .catch(() => {}); // skip: fullscreen/orientation lock are optional niceties (iOS Safari has neither)
        }
      } catch {
        // skip: same as above
      }
      this.onLockChange(true);
      return;
    }
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // skip: user may press Esc immediately; overlay stays visible
    } catch {
      // skip: browser refused lock; pause overlay remains so user can click again
    }
  }

  unlock() {
    if (this.touch) {
      if (!this.touchLocked) return;
      this.touchLocked = false;
      this.touchUi.show(false);
      Promise.resolve().then(() => this.onLockChange(false)); // async like pointerlockchange
      return;
    }
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
    this.yaw -= Math.PI * 2 * Math.round(this.yaw / (Math.PI * 2)); // keep within [-pi, pi]
    const k = this.keys;
    const live = this.locked && this.enabled;
    const cmd = {
      f: live ? Math.max(-1, Math.min(1, (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) + this.mv.f)) : 0,
      s: live ? Math.max(-1, Math.min(1, (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.mv.s)) : 0,
      jump: live && k.has('Space'),
      walk: live && (k.has('AltLeft') || k.has('AltRight')), // Alt = quiet slow walk
      crouch: live && (k.has('ShiftLeft') || k.has('ShiftRight') || this.crouchHeld), // Shift = crouch (touch: CROUCH toggle)
      fire: live && (this.mouseDown || this.tap),
      reload: live && this.reload,
      drop: live && this.drop,
      use: live && this.use,
      scope: live && this.scopeHeld,
      nade: live ? this.nade : 0,
      weapon: live ? this.weapon : -1,
      yaw: this.yaw,
      pitch: this.pitch,
    };
    this.tap = false;
    this.reload = false;
    this.drop = false;
    this.use = false;
    this.nade = 0;
    this.weapon = -1;
    return cmd;
  }
}
