// Offline practice range: static + moving dummies, local hit detection (same math as the server).
import { rayPlayer } from './physics.js';

const SPOTS_BY_MAP = {
  crossroads: [
    { x: 0, z: -14 }, { x: -4, z: -10 }, { x: 4, z: -10 }, { x: 0, z: -3 },
    { x: -16, z: 0 }, { x: 16, z: 0 },
    { x: 0, z: -20, mx: 4, sp: 1.6 }, { x: 0, z: 12, mx: 4, sp: 2.2 },
  ],
};
const SPOTS = [
  { x: 0, z: -14 },
  { x: -5, z: -12 },
  { x: 5, z: -12 },
  { x: 0, z: -3 },
  { x: -16, z: -6 },
  { x: 16, z: 6 },
  { x: 0, z: -18, mx: 5, sp: 1.6 },
  { x: 0, z: 11, mx: 5, sp: 2.2 },
];

const WEAPONS = [0, 0, 1, 2, 0, 3, 0, 2]; // dummies hold rifle / pistol / knife / sniper for variety

export class Practice {
  constructor(spec, map, mapId = 'yard') {
    this.spots = SPOTS_BY_MAP[mapId] || SPOTS;
    this.spec = spec;
    this.map = map;
    this.t = 0;
    this.shots = 0;
    this.hits = 0;
    this.heads = 0;
    this.kills = 0;
  }

  onStart(game) {
    const sp = this.map.spawns.A[0];
    game.myTeam = 'A';
    game.loadout.reset();
    this.giveSniper(game.loadout); // the range is for trying every weapon (online it is pickup-only)
    game.spawn(sp.x, 0, sp.z, sp.yaw);
    this.targets = this.spots.map((s, i) => {
      const view = game.addRemote(i + 1, `T${i + 1}`, 'B', false);
      return { ...s, id: i + 1, view, hp: 100, alive: true, respawnAt: 0, px: s.x, pz: s.z, vx: 0 };
    });
    game.hud.setHealth(this.spec.player.maxHealth);
    game.hud.setNades(this.spec.grenades, null); // grenades are server-simulated: online only
    game.hud.setFlash(0);
    game.hud.setScore(0, 0);
    game.hud.setTimer(-1);
    game.hud.setPing(-1);
    game.hud.setBanner('');
    this.refresh(game);
  }

  giveSniper(lo) {
    this.spec.weapons.forEach((w, i) => {
      if (!w.pickupOnly) return;
      lo.has[i] = true;
      lo.mag[i] = w.magSize;
      lo.res[i] = w.reserve;
    });
  }

  onTick(cmd, res, game) {
    this.t += 1 / this.spec.tickRate;
    for (const tg of this.targets) {
      if (!tg.alive && this.t >= tg.respawnAt) {
        tg.alive = true;
        tg.hp = 100;
      }
      if (tg.mx && tg.alive) { // a dead dummy lies where it fell instead of sliding along its patrol line
        const nx = tg.x + Math.sin(this.t * tg.sp) * tg.mx;
        tg.vx = nx - tg.px;
        tg.px = nx;
      } else if (!tg.alive) {
        tg.vx = 0;
      }
      tg.view.setNow({ x: tg.px, y: 0, z: tg.pz, yaw: tg.mx ? (tg.vx > 0 ? -Math.PI / 2 : Math.PI / 2) : 0, alive: tg.alive, w: WEAPONS[tg.id - 1] });
    }
    if (res && res.fired) this.fire(cmd, game);
    this.refresh(game);
  }

  fire(cmd, game) {
    const w = game.loadout.weapon;
    const o = game.eye();
    const d = game.aimWithSpread(cmd);
    const wallT = game.worldHit(o, d, w.range);
    let best = null;
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const h = rayPlayer(this.spec, o, d, Math.min(w.range, wallT), tg.px, 0, tg.pz);
      if (h && (!best || h.t < best.h.t)) best = { tg, h };
    }
    if (!w.melee) this.shots++;
    const t = best ? best.h.t : wallT;
    const to = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if (!w.melee) game.tracer(game.muzzlePos(d), to);
    if (best) {
      this.hits++;
      if (best.h.head) this.heads++;
      const dmg = w.damage * (best.h.head ? w.headMult : 1);
      best.tg.hp -= dmg;
      game.hud.hitmarker(best.h.head);
      game.sfx.play(best.h.head ? 'headshot' : 'hit');
      game.puff(to, 0xcc2222);
      game.decals.blood(to, d, best.h.head);
      if (best.tg.hp <= 0) {
        best.tg.alive = false;
        best.tg.respawnAt = this.t + this.spec.match.respawnSeconds;
        this.kills++;
        game.sfx.play('kill');
        game.decals.bloodPool(best.tg.px, best.tg.pz);
      }
    } else if (t < w.range) {
      game.puff(to, 0xbbbbbb);
      game.playAt('impact', to);
      if (!w.melee) game.decals.bulletHole(to, d);
    }
  }

  refresh(game) {
    const l = game.loadout;
    game.hud.setWeapons(this.spec.weapons, l.cur, l.has);
    game.hud.setPrompt('');
    game.hud.setAmmo(l.weapon, l.mag[l.cur], l.res[l.cur], l.reloading);
    const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    game.hud.setPractice(`Practice · kills ${this.kills} · hits ${this.hits} · headshots ${this.heads} · accuracy ${acc}%`);
  }
}
