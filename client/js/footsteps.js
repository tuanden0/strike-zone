// Footsteps: which surface is under a player, when a step falls (stride length depends on speed), left/right feet, landing thuds.
// Sounds are synthesized in audio.js (`step_<surface>`, `land`); this file only decides what to play and when. Cosmetic, client-only.

export const SURFACES = ['concrete', 'sand', 'stone', 'wood', 'metal'];

// What a box is made of, by its `mat` name in the map json (anything not listed is the map's floor surface).
const MAT_SURFACE = {
  crate: 'wood', mcrate: 'wood', bigcrate: 'wood', pallet: 'wood', stall: 'wood',
  cont_a: 'metal', cont_b: 'metal', cont_c: 'metal', steelpillar: 'metal', warehouse: 'metal',
  tier: 'stone', block: 'stone', rubble: 'stone', obelisk: 'stone', pillar: 'stone', fountain: 'stone', fountain_col: 'stone', lowwall: 'stone', boulder: 'stone',
  concrete: 'concrete', wall: 'concrete', building: 'concrete', barrier: 'concrete', lowcover: 'concrete',
};

const MIN_SPEED = 3.4; // m/s: slower than this is a walk (silent, as is Alt-walk and crouching)
const RUN_SPEED = 5.5;
export const HEAR_RANGE = 25; // m: other players' steps are not played beyond this
const TOP_EPS = 0.06; // feet this close to a box top = standing on it

const cache = new WeakMap(); // map -> boxes with a known material, as [x0,z0,x1,z1,top,surface]

function stepBoxes(map) {
  let l = cache.get(map);
  if (!l) {
    l = [];
    for (const b of map.raw || []) {
      const s = MAT_SURFACE[b.mat];
      if (s) l.push([b.min[0], b.min[2], b.max[0], b.max[2], b.max[1], s]);
    }
    cache.set(map, l);
  }
  return l;
}

// stride (m between footfalls) grows with speed: ~2.2 m at a full run, shorter for slower analog-stick movement
export function strideFor(speed) {
  return Math.max(0.9, Math.min(2.2, 0.4 * speed));
}

// run loudness 1.0, analog half-speed ~0.5
export function loudness(speed) {
  return 0.5 + 0.5 * Math.max(0, Math.min(1, (speed - MIN_SPEED) / (RUN_SPEED - MIN_SPEED)));
}

export class Footsteps {
  constructor(game) {
    this.game = game;
    this.floor = 'concrete';
    this.foot = 0; // local player's next foot (alternates)
    this.stride = 0;
  }

  setFloor(f) {
    this.floor = SURFACES.includes(f) ? f : 'concrete';
  }

  // Surface under feet at (x, y, z): the box top being stood on, else the map floor when on the ground; null = in the air.
  surfaceAt(x, y, z) {
    const map = this.game.map;
    if (map) {
      for (const [x0, z0, x1, z1, top, s] of stepBoxes(map)) {
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && Math.abs(y - top) < TOP_EPS) return s;
      }
      // standing on some other box (unknown material): the floor sound is the best guess
      for (const b of map.boxes) if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && Math.abs(y - b[4]) < TOP_EPS && b[4] <= 8) return this.floor;
    }
    return y < TOP_EPS ? this.floor : null;
  }

  // ---- local player: once per simulation tick, after stepMove ----
  // d: horizontal distance moved this tick; fallVy: vertical speed before the step (negative = falling); wasGround: before the step.
  local(cmd, kin, d, speed, wasGround, fallVy) {
    const g = this.game;
    if (kin.onGround && !wasGround && g.prev.y - kin.y > 0.05) {
      this.land(this.surfaceAt(kin.x, kin.y, kin.z) || this.floor, -fallVy + 0.7);
      this.stride = 0;
      return;
    }
    if (!kin.onGround) {
      this.stride = 0;
      return;
    }
    if (cmd.walk || kin.crouch || speed < MIN_SPEED) return; // walking and crouching are silent
    this.stride += d;
    if (this.stride >= strideFor(speed)) {
      this.stride = 0;
      this.step(this.surfaceAt(kin.x, kin.y, kin.z) || this.floor, null, loudness(speed));
    }
  }

  // impact: vertical speed at touchdown (m/s). A hop is ~7 (gain ~0.7), a 1 m ledge ~5, a 4 m drop ~12 (gain 1).
  land(surface, impact) {
    const k = Math.max(0, Math.min(1, impact / 12)); // 12 m/s ~ a 4 m drop
    this.game.sfx.play('land', null, null, { surface, gain: 0.25 + 0.75 * k, pitch: 1.15 - 0.3 * k });
  }

  // One footfall. pos null = the local player (non-positional, panned by foot), else a world position.
  step(surface, pos, gain, view) {
    const g = this.game;
    const foot = view ? (view.foot ^= 1) : (this.foot ^= 1);
    const opts = { gain, pitch: foot ? 1.0 : 0.93, pan: pos ? 0 : foot ? 0.14 : -0.14, foot };
    if (pos) g.sfx.play(`step_${surface}`, pos, g.listener(), opts);
    else g.sfx.play(`step_${surface}`, null, null, opts);
  }

  // ---- another player, once per frame from RemoteView.update (s = interpolated position, d = horizontal distance this frame) ----
  remote(view, s, d, dt) {
    if (d > 2) { // a respawn / teleport, not running
      view.speedS = view.stepDist = 0;
      return;
    }
    const speed = dt > 0 ? d / dt : 0;
    view.speedS = (view.speedS || 0) + (speed - (view.speedS || 0)) * Math.min(1, dt * 10); // frame times jitter: smooth the speed
    if (!view.alive || view.char.crouch || view.speedS < MIN_SPEED) { // walking and crouching are silent
      view.stepDist = 0;
      return;
    }
    view.stepDist += d;
    if (view.stepDist < strideFor(view.speedS)) return;
    view.stepDist = 0;
    const surface = this.surfaceAt(s.x, s.y, s.z);
    if (!surface) return; // in the air
    const l = this.game.listener();
    if (Math.hypot(s.x - l.x, s.y - l.y, s.z - l.z) > HEAR_RANGE) return; // out of earshot
    this.step(surface, [s.x, s.y + 0.1, s.z], loudness(view.speedS), view);
  }
}
