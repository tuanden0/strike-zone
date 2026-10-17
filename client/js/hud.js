// DOM HUD. All user-controlled strings go through textContent (never innerHTML).

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const TEAM_NAMES = { A: 'Ember', B: 'Cobalt' };

export class Hud {
  constructor() {
    this.root = $('hud');
    this.scopeEl = $('scope');
    this.hpFill = $('hp-fill');
    this.hpNum = $('hp-num');
    this.ammo = $('ammo');
    this.wname = $('weapon-name');
    this.slots = $('weapon-slots');
    this.timer = $('timer');
    this.sa = $('score-a');
    this.sb = $('score-b');
    this.feed = $('killfeed');
    this.hit = $('hitmarker');
    this.dmg = $('damage');
    this.banner = $('banner');
    this.board = $('scoreboard');
    this.practice = $('practice-stats');
    this.promptEl = $('prompt');
    this.fps = $('fps');
    this.pingEl = $('ping');
    this._hitT = 0;
    this._dmgT = 0;
    this._slotsKey = '';
  }

  show(v) {
    this.root.hidden = !v;
    if (!v) {
      this.feed.replaceChildren();
      this.banner.textContent = '';
      this.board.hidden = true;
    }
  }

  setHealth(hp, max = 100) {
    const h = Math.max(0, Math.round(hp));
    this.hpNum.textContent = String(h);
    this.hpFill.style.width = `${Math.min(100, (h / max) * 100)}%`;
    this.hpFill.style.background = h > 60 ? '#4ade80' : h > 30 ? '#facc15' : '#f87171';
  }

  setWeapons(weapons, cur, has) {
    const key = `${weapons.length}:${cur}:${has ? has.join('') : ''}`;
    if (key !== this._slotsKey) {
      this._slotsKey = key;
      this.slots.replaceChildren(
        ...weapons.map((w, i) => el('span', `${i === cur ? 'cur' : ''}${has && !has[i] ? ' empty' : ''}`.trim(), `${i + 1} ${w.id}`)),
      );
    }
    this.wname.textContent = weapons[cur].name;
  }

  setAmmo(w, mag, res, reloading) {
    this.ammo.replaceChildren();
    if (w.magSize === 0) {
      this.ammo.textContent = '—';
      return;
    }
    this.ammo.append(reloading ? 'RELOADING ' : `${mag} `, el('small', '', reloading ? '' : `/ ${res}`));
  }

  setTimer(sec) {
    if (sec < 0) {
      this.timer.textContent = '--:--';
      return;
    }
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    this.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  setScore(a, b) {
    this.sa.textContent = String(a);
    this.sb.textContent = String(b);
  }

  setBanner(text) {
    this.banner.textContent = text || '';
  }

  setPing(ms) {
    this.pingEl.textContent = ms >= 0 ? `ping ${Math.round(ms)} ms` : '';
  }

  setFps(f) {
    this.fps.textContent = `${f} fps`;
  }

  hitmarker(head) {
    this.hit.classList.toggle('head', !!head);
    this.hit.classList.add('on');
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => this.hit.classList.remove('on'), 90);
  }

  damageFlash() {
    this.dmg.classList.add('on');
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => this.dmg.classList.remove('on'), 80);
  }

  // killer/victim: {nick, team}
  addKill(killer, victim, weaponName, head) {
    const row = el('div', 'k');
    const nameEl = (p) => el('span', p.team === 'A' ? 'team-a' : p.team === 'B' ? 'team-b' : '', p.nick);
    row.append(nameEl(killer), ` [${weaponName}${head ? ' HS' : ''}] `, nameEl(victim));
    this.feed.append(row);
    while (this.feed.children.length > 6) this.feed.firstChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  showBoard(v) {
    this.board.hidden = !v;
  }

  // rows: [{id,nick,team,kills,deaths}]
  renderBoard(rows, meId) {
    const cols = ['A', 'B'].map((team) => {
      const box = el('div');
      box.append(el('h4', team === 'A' ? 'team-a' : 'team-b', TEAM_NAMES[team]));
      const t = el('table');
      const head = el('tr');
      head.append(el('th', '', 'Player'), el('th', '', 'K'), el('th', '', 'D'));
      t.append(head);
      rows
        .filter((r) => r.team === team)
        .sort((x, y) => y.kills - x.kills || x.deaths - y.deaths)
        .forEach((r) => {
          const tr = el('tr', r.id === meId ? 'me' : '');
          tr.append(el('td', '', r.nick), el('td', 'n', String(r.kills)), el('td', 'n', String(r.deaths)));
          t.append(tr);
        });
      box.append(t);
      return box;
    });
    this.board.replaceChildren(...cols);
  }

  // Context hint under the crosshair, e.g. '[E] Pick up AR-7 Rifle'.
  // t: 0 (no scope) .. 1 (fully zoomed). The overlay fades in over the last part of the zoom.
  setScope(t) {
    const v = Math.max(0, (t - 0.35) / 0.65);
    this.scopeEl.style.opacity = String(v);
    this.scopeEl.hidden = v <= 0;
    this.root.classList.toggle('scoped', t > 0.5);
  }

  setPrompt(text) {
    this.promptEl.textContent = text || '';
    this.promptEl.hidden = !text;
    const use = document.getElementById('t-use');
    if (use) use.classList.toggle('hot', !!text); // touch: highlight the USE button while a weapon is in reach
  }

  setPractice(text) {
    this.practice.hidden = !text;
    this.practice.textContent = text || '';
  }
}
