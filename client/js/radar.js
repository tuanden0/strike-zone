// Minimap / radar in the HUD: rotating (your view is up), centred on you, ~35 m range.
// Static layer = the map's boxes top-down, pre-rendered once per map; dynamic layer ~20 Hz:
//   you = white arrow; teammates = team-coloured dots, always; enemies only while you have a clear line to them (max 90 m)
//   or for 2 s after they fired (`ping`; beyond the range that is a hollow ring on the rim); dead players hidden; weapon pickups = small yellow squares.
// `M` toggles it (touch: tap the radar). Cosmetic and client-only: it only shows what the client already knows, and an enemy
// is never shown through a wall except right after a shot (the shot event is public to every client anyway).
import { rayWorld } from './physics.js';
import { TEAM_COLORS } from './world.js';

export const RANGE = 35; // m shown from centre to edge
export const SEE_MAX = 90; // m: farthest enemy that can be spotted by line of sight
export const PING_MS = 2000; // an enemy that fired stays visible this long
const KEY = 'sz.radar';
const HZ = 20;
const PX_PER_M = 6; // static layer resolution
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class Radar {
  constructor(game) {
    this.game = game;
    this.canvas = document.getElementById('radar');
    this.ctx = this.canvas.getContext('2d');
    this.hud = document.getElementById('hud');
    this.touch = !!game.input.touch;
    this.on = true;
    try {
      this.on = localStorage.getItem(KEY) !== '0';
    } catch {
      // skip: storage blocked, radar stays on
    }
    this.size = null; // CSS size of the canvas, refreshed by the observer (reading clientWidth every redraw forces a layout flush)
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => (this.size = null)).observe(this.canvas);
    this.pings = new Map(); // player id -> expiry (performance.now)
    this.pingMs = PING_MS; // (a field so e2e can stretch it: frames are slow under software GL)
    this.shown = []; // what the last redraw drew: [{id, team, why: 'team' | 'seen' | 'ping'}]
    this.stat = null; // pre-rendered static layer {img, x0, z0, w, h}
    this.statMap = null;
    this.acc = 0;
    this.drawn = 0; // redraw counter (diagnostics / e2e)
    this.apply();
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (game.running && game.input.locked) this.toggle();
    });
    game.input.hudTap = (x, y) => { // touch: the touch layer sits above the HUD, so Input asks us whether a tap hit the radar
      if (!this.touch || this.hud.hidden) return false;
      const r = this.canvas.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
      this.toggle();
      return true;
    };
  }

  toggle(v = !this.on) {
    this.on = v;
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      // skip: remembering the choice is a convenience only
    }
    this.apply();
    this.draw();
  }

  apply() {
    this.hud.classList.toggle('radar-off', !this.on);
    this.canvas.classList.toggle('off', !this.on);
  }

  // Pre-render the map top-down: dark boxes, taller = lighter (drawn low to high so tall walls end up on top).
  setMap(map) {
    this.statMap = map;
    const b = map.bounds;
    const m = 2; // margin (outer walls sit just outside the bounds)
    const x0 = b.minX - m;
    const z0 = b.minZ - m;
    const w = b.maxX - b.minX + 2 * m;
    const h = b.maxZ - b.minZ + 2 * m;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * PX_PER_M);
    c.height = Math.ceil(h * PX_PER_M);
    const g = c.getContext('2d');
    g.fillStyle = '#0d1219';
    g.fillRect(0, 0, c.width, c.height);
    const boxes = map.boxes.filter((o) => o[4] > 0.3).sort((p, q) => p[4] - q[4]);
    for (const o of boxes) {
      const k = Math.min(o[4], 6) / 6; // top height 0..6 m -> lightness
      const l = Math.round(34 + k * 70);
      g.fillStyle = `rgb(${l},${l + 4},${l + 10})`;
      g.fillRect((o[0] - x0) * PX_PER_M, (o[2] - z0) * PX_PER_M, (o[3] - o[0]) * PX_PER_M, (o[5] - o[2]) * PX_PER_M);
    }
    this.stat = { img: c, x0, z0, w, h };
  }

  ping(id) {
    this.pings.set(id, performance.now() + this.pingMs);
  }

  // called every rendered frame; redraws at ~20 Hz
  frame(dt) {
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc = 0;
    this.draw();
  }

  fit() {
    if (!this.size || this.size.w === 0 || typeof ResizeObserver !== 'function') this.size = { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
    const cssW = this.size.w;
    const cssH = this.size.h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w, h, s: dpr };
  }

  // Which players the radar shows right now (also the rules the e2e checks).
  visible() {
    const game = this.game;
    const out = [];
    const now = performance.now();
    const eye = game.eye();
    for (const [id, v] of game.remotes) {
      if (!v.alive) continue;
      const p = v.group.position;
      if (v.team === game.myTeam) {
        out.push({ id, team: v.team, x: p.x, z: p.z, why: 'team' });
        continue;
      }
      const dx = p.x - eye[0];
      const dz = p.z - eye[2];
      const dist = Math.hypot(dx, dz);
      let why = '';
      if (dist <= SEE_MAX && this.canSee(eye, p, v.char && v.char.crouch)) why = 'seen';
      else if ((this.pings.get(id) || 0) > now) why = 'ping';
      if (why) out.push({ id, team: v.team, x: p.x, z: p.z, why });
    }
    for (const [id, t] of this.pings) if (t <= now) this.pings.delete(id);
    return out;
  }

  // clear line from the eye to the head or the chest (map boxes + floor; players do not block)
  canSee(eye, p, crouch) {
    const map = this.game.map;
    for (const dy of crouch ? [0.85, 0.5] : [1.55, 0.95]) {
      const d = [p.x - eye[0], p.y + dy - eye[1], p.z - eye[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len < 0.01) return true;
      d[0] /= len;
      d[1] /= len;
      d[2] /= len;
      if (rayWorld(map, eye, d, len) >= len - 0.05) return true;
    }
    return false;
  }

  draw() {
    const game = this.game;
    this.drawn++;
    const { w, h, s } = this.fit();
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!this.on) {
      this.shown = [];
      if (this.touch) { // a small chip so a tap can bring it back
        g.fillStyle = 'rgba(8,12,18,0.6)';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#cfd6e2';
        g.font = `${Math.round(h * 0.5)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('RADAR', w / 2, h / 2 + 1);
      }
      return;
    }
    if (!this.stat || this.statMap !== game.map) this.setMap(game.map); // map swapped without setMap (tests)
    const R = Math.min(w, h) / 2 - 1.5 * s;
    const cx = w / 2;
    const cy = h / 2;
    const ppm = R / RANGE;
    const cam = game.camera.position;
    const px = game.debugCam ? game.kin.x : cam.x;
    const pz = game.debugCam ? game.kin.z : cam.z;
    const yaw = game.input.yaw;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    // world (x,z) -> radar px: right = (cos, -sin), forward = (-sin, -cos), forward is up
    const toR = (x, z) => [cx + ppm * (cs * (x - px) - sn * (z - pz)), cy + ppm * (sn * (x - px) + cs * (z - pz))];

    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(8,12,18,0.78)';
    g.fillRect(0, 0, w, h);
    g.save();
    g.setTransform(ppm * cs, ppm * sn, -ppm * sn, ppm * cs, cx - ppm * (cs * px - sn * pz), cy - ppm * (sn * px + cs * pz));
    g.globalAlpha = 0.95;
    g.drawImage(this.stat.img, this.stat.x0, this.stat.z0, this.stat.w, this.stat.h);
    g.restore();
    // view cone
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    g.closePath();
    g.fill();
    // pickups
    g.fillStyle = '#ffd23a';
    const q = 2.2 * s;
    for (const it of game.pickups.items.values()) {
      const [x, y] = toR(it.data.x, it.data.z);
      if (Math.hypot(x - cx, y - cy) < R - q) g.fillRect(x - q, y - q, q * 2, q * 2);
    }
    // players
    this.shown = [];
    const now = performance.now();
    for (const e of this.visible()) {
      let [x, y] = toR(e.x, e.z);
      let d = Math.hypot(x - cx, y - cy);
      let a = 1;
      if (d > R - 3 * s) { // teammates and shooters beyond the range stay on the rim, dimmed, in their direction
        if (e.why === 'seen') continue; // a spotted enemy out of range is simply off the radar
        x = cx + ((x - cx) / d) * (R - 3 * s);
        y = cy + ((y - cy) / d) * (R - 3 * s);
        a = 0.55;
      }
      this.shown.push(e);
      g.globalAlpha = a;
      const col = hex(TEAM_COLORS[e.team] || 0xffffff);
      const r = 3.6 * s;
      if (e.why === 'ping') { // fired but not in sight: hollow ring that fades with the 2 s
        const f = Math.max(0, ((this.pings.get(e.id) || 0) - now) / this.pingMs);
        g.globalAlpha = 0.35 + 0.65 * f;
        g.strokeStyle = col;
        g.lineWidth = 1.8 * s;
        g.beginPath();
        g.arc(x, y, r + 1.5 * s, 0, Math.PI * 2);
        g.stroke();
      } else {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = e.why === 'seen' ? '#fff' : 'rgba(0,0,0,0.6)'; // white outline = spotted enemy
        g.lineWidth = 1.2 * s;
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    // you: white arrow pointing up
    if (game.alive) {
      const u = 5.5 * s;
      g.fillStyle = '#fff';
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 1 * s;
      g.beginPath();
      g.moveTo(cx, cy - u);
      g.lineTo(cx + u * 0.75, cy + u * 0.8);
      g.lineTo(cx, cy + u * 0.35);
      g.lineTo(cx - u * 0.75, cy + u * 0.8);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.restore();
    // range ring (the 35 m limit) + half range
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 1.5 * s;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1 * s;
    g.beginPath();
    g.arc(cx, cy, R / 2, 0, Math.PI * 2);
    g.stroke();
  }
}
