// On-screen controls for phones/tablets: floating move stick (left), drag-to-look (right), action buttons.
// Pointer Lock does not exist on mobile, so Input swaps `locked` for "touch UI is active" (see input.js).

const STICK_R = 56; // px of travel for full deflection
const DEAD = 0.3; // fraction of STICK_R before an axis registers (server takes -1/0/1 only)
const LOOK_GAIN = 2.2; // touch drag px -> radians relative to the mouse sensitivity setting

const $ = (id) => document.getElementById(id);

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.root = $('touch');
    this.zone = $('t-zone');
    this.stick = $('t-stick');
    this.knob = $('t-knob');
    this.move = { id: null, x0: 0, y0: 0 };
    this.look = { id: null, x: 0, y: 0 };
    this.bindZone();
    this.bindHold('t-fire', (down) => {
      input.mouseDown = down;
      if (down) input.tap = true;
    });
    this.bindHold('t-jump', (down) => input.setKey('Space', down));
    this.bindPress('t-reload', () => (input.reload = true));
    this.bindPress('t-use', () => (input.use = true));
    this.bindPress('t-nade', () => (input.nade = input.nadeSel + 1));
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

  show(on) {
    this.root.hidden = !on;
    if (!on) this.reset();
  }

  reset() {
    this.move.id = this.look.id = null;
    this.input.mv.f = this.input.mv.s = 0;
    this.stick.classList.remove('on');
    this.input.mouseDown = false;
    this.input.keys.delete('Space');
    this.input.scopeHeld = false;
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
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
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
        this.input.turn((e.clientX - this.look.x) * LOOK_GAIN, (e.clientY - this.look.y) * LOOK_GAIN);
        this.look.x = e.clientX;
        this.look.y = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId === this.move.id) {
        this.move.id = null;
        this.input.mv.f = this.input.mv.s = 0;
        this.stick.classList.remove('on');
      } else if (e.pointerId === this.look.id) {
        this.look.id = null;
      }
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  // The HUD weapon list sits under the touch layer, so hit-test it by rectangle.
  tapSlot(x, y) {
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
