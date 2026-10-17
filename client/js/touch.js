// On-screen controls for phones/tablets: floating move stick (left), floating aim stick or drag-to-look (right), action buttons.
// Pointer Lock does not exist on mobile, so Input swaps `locked` for "touch UI is active" (see input.js).

const STICK_R = 56; // px of travel for full deflection
const DEAD = 0.3; // fraction of STICK_R before an axis registers (server takes -1/0/1 only)
const LOOK_GAIN = 2.2;
// Aim stick: view turn rate at full deflection (rad/s) at the default sensitivity; small deflections are eased (power curve) for fine aim.
const AIM_YAW = 3.4;
const AIM_PITCH = 2.2;
const AIM_DEAD = 0.12;
const AIM_CURVE = 1.7;
const LOOK_KEY = 'sz.look'; // touch drag px -> radians relative to the mouse sensitivity setting
// Fire lives inside the aim control: a short tap shoots once, holding still in the dead zone engages auto-fire, pushing steers.
const HOLD_MS = 300; // tap = finger up before this; still in the dead zone after this = auto-fire
const DRAG_DEAD = 10; // swipe mode: px of travel that count as "leaving the dead zone"
// A tap is `tap` (one fire tick) plus Input.firePulse = 1 more tick: counted in simulation ticks, not milliseconds, so a late frame cannot stretch it into a burst.

const $ = (id) => document.getElementById(id);

// Browsers zoom the page on double-tap, pinch and (iOS) when an input under 16 px gets focus; user-scalable=no is ignored by
// iOS Safari and Firefox. In a shooter that means a few quick FIRE taps can blow the page up with no way back. Block every path
// (CSS touch-action does most of it) and undo a zoom that still slips through. Menus (.screen) keep vertical scrolling.
export function lockPageZoom() {
  const stop = (e) => e.preventDefault();
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false }); // iOS Safari pinch
  document.addEventListener('dblclick', stop, { passive: false });
  const inMenu = (e) => e.target && e.target.closest && e.target.closest('.screen');
  // Pinch is stopped by CSS touch-action: none (page + controls). The two thumbs on the sticks must never have their touches cancelled in JS.
  let lastEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastEnd < 350 && !inMenu(e)) e.preventDefault(); // second tap of a double-tap
      lastEnd = now;
    },
    { passive: false },
  );
  const meta = document.querySelector('meta[name=viewport]');
  const content = meta ? meta.content : '';
  const reset = () => {
    const vv = window.visualViewport;
    if (!meta || !vv || vv.scale <= 1.02) return;
    meta.content = 'width=device-width, initial-scale=1, maximum-scale=1'; // re-applying the viewport makes the browser drop the zoom
    requestAnimationFrame(() => (meta.content = content));
  };
  if (window.visualViewport) window.visualViewport.addEventListener('resize', reset);
  return reset;
}

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.root = $('touch');
    this.zone = $('t-zone');
    this.stick = $('t-stick');
    this.knob = $('t-knob');
    this.move = { id: null, x0: 0, y0: 0 };
    this.look = { id: null, x: 0, y: 0, x0: 0, y0: 0, ax: 0, ay: 0, t0: 0, left: false, auto: false };
    this.holdMs = HOLD_MS; // (a field so e2e can stretch it: under software GL a CDP touch can reach the page hundreds of ms late)
    this.lstick = $('t-lstick');
    this.lknob = $('t-lknob');
    this.mode = 'stick'; // right thumb: 'stick' (hold-and-steer, like the left one) or 'drag' (relative swipe)
    try {
      if (localStorage.getItem(LOOK_KEY) === 'drag') this.mode = 'drag';
    } catch {
      // skip: storage blocked, stick is the default
    }
    this.bindZone();
    this.bindHold('t-jump', (down) => input.setKey('Space', down));
    this.bindPress('t-reload', () => (input.reload = true));
    this.bindPress('t-crouch', () => {
      input.crouchHeld = !input.crouchHeld;
      $('t-crouch').classList.toggle('down', input.crouchHeld);
    });
    this.bindPress('t-use', () => (input.use = true));
    this.bindPress('t-nade', () => (input.nadeKey = input.nadeSel + 1)); // equip; then hold FIRE to charge, release to throw
    this.bindPress('t-nadesel', () => {
      if (!input.nadeNames.length) return;
      input.nadeSel = (input.nadeSel + 1) % input.nadeNames.length;
      $('t-nadesel').textContent = input.nadeNames[input.nadeSel].toUpperCase();
    });
    this.bindPress('t-drop', () => (input.drop = true));
    this.bindPress('t-scope', () => {
      input.scopeHeld = !input.scopeHeld;
      $('t-scope').classList.toggle('down', input.scopeHeld);
    });
    this.bindPress('t-menu', () => input.unlock());
    this.bindPress('t-board', () => {
      this.boardOn = !this.boardOn;
      input.onScoreboard(this.boardOn);
    });
  }

  setMode(m) {
    this.mode = m === 'drag' ? 'drag' : 'stick';
    this.endLook(true);
    try {
      localStorage.setItem(LOOK_KEY, this.mode);
    } catch {
      // skip: remembering the choice is a convenience only
    }
  }

  show(on) {
    this.root.hidden = !on;
    if (on) {
      this.last = performance.now();
      this.loop = requestAnimationFrame(() => this.frame());
    } else {
      cancelAnimationFrame(this.loop);
      this.reset();
    }
  }

  // Aim stick: turn the view at a rate proportional to the deflection, every animation frame (not every 30 Hz tick, so it is smooth).
  frame() {
    if (this.root.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { ax, ay } = this.look;
    const lk = this.look;
    if (lk.id !== null && !lk.left && !lk.auto && now - lk.t0 >= this.holdMs) this.setAuto(true); // held still in the dead zone: auto-fire
    if (this.mode === 'stick' && (ax || ay)) {
      const g = (this.input.sens / 0.0022) * this.input.sensScale; // mouse-sensitivity slider and scope zoom apply to the stick too
      const inp = this.input;
      inp.yaw -= ax * AIM_YAW * g * dt;
      inp.pitch = Math.max(-1.55, Math.min(1.55, inp.pitch - ay * AIM_PITCH * g * dt));
    }
    this.loop = requestAnimationFrame(() => this.frame());
  }

  // stick axes in -1..1 from a displacement in px: dead zone, then a power curve for fine control near the centre
  static axis(d) {
    const a = Math.abs(d);
    if (a < AIM_DEAD) return 0;
    return Math.sign(d) * Math.pow((a - AIM_DEAD) / (1 - AIM_DEAD), AIM_CURVE);
  }

  reset() {
    this.move.id = null;
    this.endLook(true);
    this.input.mouseDown = false;
    this.input.mv.f = this.input.mv.s = 0;
    this.stick.classList.remove('on');
    this.input.keys.delete('Space');
    this.input.scopeHeld = false;
    this.input.crouchHeld = false;
    $('t-crouch').classList.remove('down');
    $('t-scope').classList.remove('down');
    this.boardOn = false;
    this.input.onScoreboard(false);
  }

  bindZone() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.tapSlot(e.clientX, e.clientY)) return;
      if (e.clientX < window.innerWidth * 0.45) {
        if (this.move.id !== null) return;
        this.move = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
        this.stick.style.left = `${e.clientX}px`;
        this.stick.style.top = `${e.clientY}px`;
        this.knob.style.transform = 'translate(0,0)';
        this.stick.classList.add('on');
      } else if (this.look.id === null) {
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, ax: 0, ay: 0, t0: performance.now(), left: false, auto: false };
        this.lstick.style.left = `${e.clientX}px`;
        this.lstick.style.top = `${e.clientY}px`;
        if (this.mode === 'stick') {
          this.lknob.style.transform = 'translate(0,0)';
          this.lstick.classList.add('on');
        }
      } else {
        return;
      }
      z.setPointerCapture(e.pointerId);
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.move.id) {
        let dx = e.clientX - this.move.x0;
        let dy = e.clientY - this.move.y0;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R) {
          dx = (dx / len) * STICK_R;
          dy = (dy / len) * STICK_R;
        }
        this.knob.style.transform = `translate(${dx}px,${dy}px)`;
        const t = STICK_R * DEAD;
        this.input.mv.s = dx > t ? 1 : dx < -t ? -1 : 0;
        this.input.mv.f = dy < -t ? 1 : dy > t ? -1 : 0;
      } else if (e.pointerId === this.look.id) {
        if (this.mode === 'drag') {
          this.input.turn((e.clientX - this.look.x) * LOOK_GAIN, (e.clientY - this.look.y) * LOOK_GAIN);
          this.look.x = e.clientX;
          this.look.y = e.clientY;
          if (Math.hypot(e.clientX - this.look.x0, e.clientY - this.look.y0) > DRAG_DEAD) this.look.left = true;
        } else {
          let dx = e.clientX - this.look.x0;
          let dy = e.clientY - this.look.y0;
          const len = Math.hypot(dx, dy);
          if (len > STICK_R) {
            dx = (dx / len) * STICK_R;
            dy = (dy / len) * STICK_R;
          }
          this.lknob.style.transform = `translate(${dx}px,${dy}px)`;
          this.look.ax = TouchControls.axis(dx / STICK_R);
          this.look.ay = TouchControls.axis(dy / STICK_R);
          if (this.look.ax || this.look.ay) this.look.left = true; // out of the dead zone: steering, never a tap or a hold-fire
        }
      }
    });
    const end = (e) => {
      if (e.pointerId === this.move.id) {
        this.move.id = null;
        this.input.mv.f = this.input.mv.s = 0;
        this.stick.classList.remove('on');
      } else if (e.pointerId === this.look.id) {
        this.endLook(e.type === 'pointercancel');
      }
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  // The right thumb lifted (or was cancelled). A quick lift that never left the dead zone is a tap = one shot.
  endLook(cancelled) {
    const lk = this.look;
    const tap = !cancelled && lk.id !== null && !lk.left && !lk.auto; // (a hold whose frame never ran before the lift still counts as one shot)
    if (lk.auto) this.setAuto(false);
    lk.id = null;
    lk.ax = lk.ay = 0;
    lk.left = lk.auto = false;
    this.lstick.classList.remove('on', 'fire');
    if (tap) this.tapShot();
  }

  // Hold-fire: mouseDown stays on while the finger is down, including while it then steers.
  setAuto(on) {
    this.look.auto = on;
    this.input.mouseDown = on;
    if (on) {
      this.input.tap = true;
      this.lstick.classList.add('on'); // swipe mode has no ring otherwise; it doubles as the fire indicator
    }
    this.lstick.classList.toggle('fire', on);
  }

  // One shot: `tap` guarantees a fire tick, one more pulse tick spans the server's semi-auto edge detection.
  tapShot() {
    const inp = this.input;
    inp.tap = true;
    inp.firePulse = 2; // (the tap tick itself uses one: the sample decrements it)
    const ring = this.lstick;
    ring.classList.add('on', 'fire', 'tapshot');
    setTimeout(() => {
      ring.classList.remove('tapshot');
      if (this.look.id === null) ring.classList.remove('on', 'fire'); // (a new touch may already own the ring)
    }, 140);
  }

  // The HUD weapon list sits under the touch layer, so hit-test it by rectangle.
  tapSlot(x, y) {
    if (this.input.hudTap && this.input.hudTap(x, y)) return true; // the radar
    const slots = [...$('weapon-slots').children];
    const i = slots.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (i < 0) return false;
    this.input.weapon = i;
    return true;
  }

  // Held button: callback(true) on press, callback(false) on release/cancel.
  bindHold(id, cb) {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      cb(true);
    });
    const up = () => {
      b.classList.remove('down');
      cb(false);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  bindPress(id, cb) {
    $(id).addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cb();
    });
  }
}
