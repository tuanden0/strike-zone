// Gamepad (standard mapping) -> Input. Polled every animation frame (the Gamepad API has no input events).
// Pointer Lock cannot be requested from a gamepad button, so a pad has its own "locked" state (Input.padLocked, see input.js):
// A or Start on the pause screen resumes in pad mode, Start pauses again. Mouse + keyboard keep working at the same time.
//
//   left stick  move (analog, 0.15 radial dead zone)     right stick  aim (rate, power curve, scaled by sens / scope zoom)
//   RT fire   LT scope toggle   A jump   B crouch (hold)   X reload   Y next weapon   LB / RB previous / next weapon
//   D-pad up / left / right  frag / smoke / flash   D-pad down  drop weapon   R3  use / pick up   Start  pause / resume   Back  scoreboard (hold)

const DEAD = 0.15; // radial dead zone of both sticks
// Aim stick: view turn rate at full deflection (rad/s) at the default sensitivity; small deflections are eased for fine aim (same idea as the touch aim stick).
export const PAD_YAW = 3.4;
export const PAD_PITCH = 2.2;
export const PAD_CURVE = 1.7;
const TRIGGER = 0.5; // analog trigger value that counts as pressed

const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, BACK = 8, START = 9, R3 = 11, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const NADE = { [UP]: 1, [LEFT]: 2, [RIGHT]: 3 }; // D-pad -> Input.nadeKey (grenade type + 1: equips it), same values as the X / C / V keys

// Stick -> [-1, 1]^2 with a radial dead zone, rescaled so the output starts at 0 right after it (no jump when leaving the zone).
export function stick(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k];
}

// aim axis (already dead-zoned, -1..1) -> eased -1..1
export const aimCurve = (v) => Math.sign(v) * Math.pow(Math.abs(v), PAD_CURVE);

export class GamepadInput {
  constructor(input, onConnect = () => {}) {
    this.input = input;
    this.onConnect = onConnect; // (connected: boolean) -> pause screen hint
    this.connected = false;
    this.prev = [];
    this.mask = new Set(); // buttons ignored until released (the A / Start press that resumed or paused)
    this.move = { f: 0, s: 0 };
    this.jump = false;
    this.crouch = false;
    this.fire = false;
    this.board = false;
    this.last = 0;
    window.addEventListener('gamepadconnected', () => this.poll(performance.now()));
    window.addEventListener('gamepaddisconnected', () => this.poll(performance.now()));
    if (navigator.getGamepads) requestAnimationFrame((t) => this.loop(t));
  }

  loop(t) {
    requestAnimationFrame((n) => this.loop(n));
    this.poll(t);
  }

  find() {
    let pads = [];
    try {
      pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    } catch {
      // skip: Gamepad API blocked (permissions policy): no pad
    }
    return pads.find((p) => p && p.connected && p.mapping === 'standard') || null;
  }

  release() {
    this.move.f = this.move.s = 0;
    this.jump = this.crouch = this.fire = false;
    if (this.board) {
      this.board = false;
      this.input.onScoreboard(false);
    }
  }

  poll(now) {
    const input = this.input;
    const dt = Math.min(0.1, Math.max(0, (now - (this.last || now)) / 1000));
    this.last = now;
    const pad = this.find();
    if (!!pad !== this.connected) {
      this.connected = !!pad;
      this.onConnect(this.connected);
      if (!pad && input.padLocked) input.unlock(); // pad unplugged while playing with it: pause
    }
    if (!pad) {
      this.release();
      this.prev = [];
      return;
    }
    const down = (i) => {
      const b = pad.buttons[i];
      const d = !!b && (b.pressed || b.value > TRIGGER);
      if (this.mask.has(i)) {
        if (d) return false;
        this.mask.delete(i);
      }
      return d;
    };
    const state = pad.buttons.map((_, i) => down(i));
    const wasPrev = this.prev;
    this.prev = state;
    const pressed = (i) => state[i] && !wasPrev[i];

    if (!(input.locked && input.enabled)) {
      this.release();
      // pause screen with a game running: A or Start resumes in pad mode
      if (input.enabled && (pressed(A) || pressed(START))) {
        this.mask.add(A).add(START); // the press that resumed must not also jump / pause
        input.padLock();
      }
      return;
    }
    if (pressed(START)) {
      this.mask.add(A).add(START);
      this.release();
      input.unlock();
      return;
    }
    const [lx, ly] = stick(pad.axes[0] || 0, pad.axes[1] || 0);
    this.move.s = lx;
    this.move.f = -ly;
    const [rx, ry] = stick(pad.axes[2] || 0, pad.axes[3] || 0);
    if (rx || ry) {
      const g = (input.sens / 0.0022) * input.sensScale; // mouse-sensitivity slider and scope zoom apply, like the touch aim stick
      input.yaw -= aimCurve(rx) * PAD_YAW * g * dt;
      input.pitch = Math.max(-1.55, Math.min(1.55, input.pitch - aimCurve(ry) * PAD_PITCH * g * dt));
    }
    this.jump = state[A];
    this.crouch = state[B];
    this.fire = state[RT];
    if (pressed(RT)) input.tap = true; // a quick pull between two ticks still fires once
    if (pressed(LT)) {
      input.scopeHeld = !input.scopeHeld;
      input.altPress = true; // with a knife LT is the overhead stab
    }
    if (pressed(X)) input.reload = true;
    if (pressed(Y) || pressed(RB)) input.cycleWeapon(1);
    if (pressed(LB)) input.cycleWeapon(-1);
    for (const k of [UP, LEFT, RIGHT]) if (pressed(k)) input.nadeKey = NADE[k];
    if (pressed(DOWN)) input.drop = true;
    if (pressed(R3)) input.use = true;
    if (state[BACK] !== this.board) {
      this.board = state[BACK];
      input.onScoreboard(this.board);
    }
  }
}
