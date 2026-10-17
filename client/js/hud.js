// DOM HUD. All user-controlled strings go through textContent (never innerHTML).

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const TEAM_NAMES = { A: 'Ember', B: 'Cobalt' };

const STREAK_MS = 4000;

export class Hud {
  constructor() {
    this.root = $('hud');
    this.scopeEl = $('scope');
    this.flashEl = $('flash');
    this.nadesEl = $('nades');
    this.powerEl = $('nade-power');
    this.powerFill = $('nade-power-fill');
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
    this.medalEl = $('medal');
    this.streak = { n: 0, t: 0 };
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

  // Holding a grenade (def) instead of a weapon: name + count in the weapon box, a power bar while charging (charge 0..1, -1 = not charging).
  setNadeHold(def, charge, counts, eq) {
    this.nadeDef = def;
    this.nadeEq = def ? eq : -1;
    this.nadeCount = def && counts ? counts[eq] : 0;
    const on = !!def && charge >= 0;
    this.powerEl.hidden = !on;
    if (on) this.powerFill.style.width = `${Math.round(charge * 100)}%`;
    if (def) {
      this.wname.textContent = def.name;
      this.ammo.replaceChildren(`${this.nadeCount} `, el('small', '', 'hold FIRE to charge, release to throw'));
    }
  }

  setWeapons(weapons, cur, has) {
    const key = `${weapons.length}:${cur}:${has ? has.join('') : ''}`;
    if (key !== this._slotsKey) {
      this._slotsKey = key;
      this.slots.replaceChildren(
        ...weapons.map((w, i) => el('span', `${i === cur ? 'cur' : ''}${has && !has[i] ? ' empty' : ''}`.trim(), `${i + 1} ${w.id}`)),
      );
    }
    if (!this.nadeDef) this.wname.textContent = weapons[cur].name;
  }

  setAmmo(w, mag, res, reloading) {
    if (this.nadeDef) return;
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

  // Centre-screen medal for a kill you made: HEADSHOT / KNIFE KILL / GRENADE KILL / KILL, plus DOUBLE / TRIPLE / MULTI KILL when
  // kills follow each other within 4 s. how = 'head' | 'knife' | 'nade' | 'body'; victim = nick shown under it.
  killMedal(how, victim) {
    const now = performance.now();
    this.streak.n = now - this.streak.t < STREAK_MS ? this.streak.n + 1 : 1;
    this.streak.t = now;
    const base = { head: 'HEADSHOT', knife: 'KNIFE KILL', nade: 'GRENADE KILL', body: 'KILL' }[how] || 'KILL';
    const multi = this.streak.n >= 4 ? 'MULTI KILL' : this.streak.n === 3 ? 'TRIPLE KILL' : this.streak.n === 2 ? 'DOUBLE KILL' : '';
    const m = this.medalEl;
    m.replaceChildren(el('div', `m-main ${how}`, base), ...(multi ? [el('div', 'm-multi', `${multi}`)] : []), el('div', 'm-sub', victim));
    m.classList.remove('on');
    void m.offsetWidth; // restart the CSS animation
    m.classList.add('on');
    clearTimeout(this._medalT);
    this._medalT = setTimeout(() => m.classList.remove('on'), 1600);
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

  // counts: grenades left per type (online only; practice has none and hides the row)
  setNades(defs, counts) {
    const key = `${counts ? counts.join(',') : ''}:${this.nadeEq}`;
    if (key === this._nadeKey) return;
    this._nadeKey = key;
    const keys = ['X', 'C', 'V', 'B', 'N', 'M'];
    this.nadesEl.hidden = !counts;
    this.nadesEl.replaceChildren(...(counts ? defs.map((d, i) => el('span', (counts[i] > 0 ? '' : 'empty') + (i === this.nadeEq ? ' cur' : ''), `${keys[i]} ${d.id} ${counts[i]}`)) : []));
  }

  // fl: ticks of flashbang blindness left (full white for the first part, then fades)
  setFlash(fl) {
    const a = Math.min(1, fl / 18);
    this.flashEl.style.opacity = String(a);
    this.flashEl.hidden = a <= 0;
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
