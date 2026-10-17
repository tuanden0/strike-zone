// Online game mode: sends inputs, predicts locally, reconciles with server snapshots.
import { stepMove } from './physics.js';
import { TEAM_NAMES } from './hud.js';

const MAX_PENDING = 120;

export class Online {
  constructor({ spec, net, myId, room, team, hud, sfx, pickups }) {
    this.initialPickups = pickups || [];
    this.spec = spec;
    this.net = net;
    this.myId = myId;
    this.room = room;
    this.team = team;
    this.hud = hud;
    this.sfx = sfx;
    this.seq = 0;
    this.pending = []; // {seq, tick, cmd}
    this.roster = new Map();
    this.state = 'playing';
    this.frozen = false;
    this.needSpawn = true;
    this.hudT = 0;
    this.offs = [];
    this.me = null;
    this.maxCorr = 0;
  }

  onStart(game) {
    this.game = game;
    game.myTeam = this.team;
    game.alive = false;
    game.loadout.reset();
    this.hud.setScore(0, 0);
    this.hud.setTimer(-1);
    this.hud.setBanner('');
    this.hud.setPractice('');
    this.hud.setHealth(this.spec.player.maxHealth);
    game.pickups.setList(this.initialPickups);
    this.offs = [
      this.net.on('pk', (m) => game.pickups.setList(m.list)),
      this.net.on('snap', (m) => this.onSnap(m)),
      this.net.on('roster', (m) => this.onRoster(m)),
    ];
  }

  stop() {
    this.offs.forEach((off) => off());
    this.offs = [];
  }

  onTick(cmd, res, game) {
    this.seq++;
    this.net.send({
      t: 'in', seq: this.seq, f: cmd.f, s: cmd.s, yaw: cmd.yaw, pitch: cmd.pitch,
      jump: cmd.jump, walk: cmd.walk, fire: cmd.fire, reload: cmd.reload, weapon: cmd.weapon, drop: cmd.drop, use: cmd.use, scope: cmd.scope,
    });
    this.pending.push({ seq: this.seq, tick: game.tickNo, cmd: { ...cmd } });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  onFrame(dt, now, game) {
    this.hudT -= dt;
    if (this.hudT > 0) return;
    this.hudT = 0.1;
    const l = game.loadout;
    this.hud.setWeapons(this.spec.weapons, l.cur, l.has);
    this.hud.setAmmo(l.weapon, l.mag[l.cur], l.res[l.cur], l.reloading);
    const pk = game.pickups.nearest;
    const keys = this.game.input.touch ? 'tap USE' : '[E]';
    this.hud.setPrompt(pk ? `${keys} Pick up ${this.spec.weapons[pk.w].name} (${pk.m}/${pk.r})` : '');
    this.hud.setPing(this.net.rtt);
  }

  nameOf(id) {
    const r = this.roster.get(id);
    return r ? { nick: r.nick, team: r.team } : { nick: '?', team: '' };
  }

  onRoster(m) {
    const game = this.game;
    this.roster = new Map(m.players.map((p) => [p.id, p]));
    this.hud.setScore(m.sc[0], m.sc[1]);
    this.hud.renderBoard(m.players, this.myId);
    const me = this.roster.get(this.myId);
    if (me && me.team !== game.myTeam) {
      game.myTeam = me.team;
      this.team = me.team;
      this.needSpawn = true; // server respawned us on the new team
      for (const id of [...game.remotes.keys()]) game.removeRemote(id); // labels depend on team
    }
    for (const p of m.players) {
      if (p.id === this.myId) continue;
      const v = game.remotes.get(p.id);
      if (!v || v.team !== p.team || v.nick !== p.nick) game.addRemote(p.id, p.nick, p.team, p.team === game.myTeam);
    }
    for (const id of [...game.remotes.keys()]) if (!this.roster.has(id)) game.removeRemote(id);
  }

  onSnap(m) {
    const game = this.game;
    const now = performance.now();
    const you = m.you;
    if (you) {
      this.reconcile(you);
      this.me = you;
      this.hud.setHealth(you.hp, this.spec.player.maxHealth);
    }
    for (const p of m.ps) {
      if (p.i === this.myId) continue;
      let v = game.remotes.get(p.i);
      if (!v) {
        const r = this.nameOf(p.i);
        v = game.addRemote(p.i, r.nick, r.team || 'A', r.team === game.myTeam);
      }
      v.push(now, { x: p.x, y: p.y, z: p.z, yaw: p.yw, alive: p.a, w: p.w });
    }
    for (const ev of m.ev || []) this.onEvent(ev);

    this.hud.setTimer(m.tl);
    this.hud.setScore(m.sc[0], m.sc[1]);
    this.frozen = m.st === 'ended';
    if (m.st !== this.state) {
      this.state = m.st;
      this.hud.showBoard(this.frozen);
      if (this.frozen) this.sfx.play('end');
      else game.decals.clear(); // new match
    }
    if (this.frozen) {
      this.hud.setBanner(m.win === 'draw' ? 'Draw' : `${TEAM_NAMES[m.win] || ''} wins!`);
    } else if (you && !you.a) {
      const secs = Math.ceil(you.resp / this.spec.tickRate);
      this.hud.setBanner(`${this.killedBy ? `Killed by ${this.killedBy} · ` : ''}Respawn in ${secs}`);
    } else {
      this.killedBy = '';
      this.hud.setBanner(you && you.prot ? 'Spawn protection' : '');
    }
  }

  reconcile(you) {
    const game = this.game;
    const ack = you.ack;
    let tAck = game.tickNo - this.pending.length;
    while (this.pending.length && this.pending[0].seq <= ack) tAck = this.pending.shift().tick;

    if (you.a) {
      if (!game.alive || this.needSpawn) {
        game.spawn(you.x, you.y, you.z, you.yw);
        this.pending = [];
        this.needSpawn = false;
        tAck = game.tickNo;
      }
      const k = game.kin;
      const px = k.x;
      const py = k.y;
      const pz = k.z;
      k.x = you.x;
      k.y = you.y;
      k.z = you.z;
      k.vy = you.vy;
      k.onGround = you.g;
      for (const p of this.pending) stepMove(this.spec, game.map, k, p.cmd);
      this.maxCorr = Math.max(this.maxCorr, Math.hypot(k.x - px, k.y - py, k.z - pz)); // prediction error, for diagnostics
      game.loadout.sync(you, tAck);
      for (const p of this.pending) game.loadout.step(p.cmd, p.tick);
    } else {
      game.alive = false;
      Object.assign(game.kin, { x: you.x, y: you.y, z: you.z, vy: 0 });
      game.prev = { ...game.kin };
      this.needSpawn = true;
    }
  }

  onEvent(ev) {
    const game = this.game;
    const me = this.myId;
    switch (ev.e) {
      case 'shot': {
        const w = this.spec.weapons[ev.w];
        if (ev.by !== me) {
          const v = game.remotes.get(ev.by);
          if (v) v.fire();
          game.playAt(w.id, ev.from);
          if (!w.melee) game.tracer([ev.from[0], ev.from[1] - 0.2, ev.from[2]], ev.to);
        }
        const dir = [ev.to[0] - ev.from[0], ev.to[1] - ev.from[1], ev.to[2] - ev.from[2]];
        if (ev.hit === 'wall') {
          game.puff(ev.to, 0xbbbbbb);
          game.playAt('impact', ev.to);
          if (!w.melee) game.decals.bulletHole(ev.to, dir);
        } else if (ev.hit === 'body' || ev.hit === 'head') {
          game.puff(ev.to, 0xcc2222);
          game.decals.blood(ev.to, dir, ev.hit === 'head');
        }
        break;
      }
      case 'hit':
        if (ev.by === me) {
          this.hud.hitmarker(ev.head);
          this.sfx.play(ev.head ? 'headshot' : 'hit');
        }
        if (ev.v === me) {
          this.hud.damageFlash();
          this.sfx.play('hurt');
        }
        break;
      case 'kill': {
        const k = this.nameOf(ev.by);
        const v = this.nameOf(ev.v);
        this.hud.addKill(k, v, this.spec.weapons[ev.w].name, ev.head);
        const rv = game.remotes.get(ev.v);
        if (rv) game.decals.bloodPool(rv.group.position.x, rv.group.position.z);
        else if (ev.v === me) game.decals.bloodPool(game.kin.x, game.kin.z);
        if (ev.v === me) {
          this.killedBy = k.nick;
          this.sfx.play('death');
        } else if (ev.by === me) {
          this.sfx.play('kill');
        }
        break;
      }
      default:
    }
  }
}
