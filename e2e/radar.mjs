// Radar: canvas exists and draws, teammate / enemy visibility rules, pickups, dead players, shot ping, M / tap toggle.
// Practice (dummies are enemies, synthetic teammates) and two real browsers online. Needs a running server.
//   BASE_URL=http://localhost:18081 SHOTS_DIR=../docs/screenshots node radar.mjs
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await launch();
const errors = [];

// wait until the radar has redrawn n more times (it redraws at ~20 Hz, but frames are slow under software GL)
const redraw = (p, n = 2) => p.evaluate((n) => new Promise((r) => { const rd = window.__sz.game.radar; const d0 = rd.drawn; const f = () => (rd.drawn >= d0 + n ? r() : requestAnimationFrame(f)); f(); }), n);
const ids = (p) => p.evaluate(() => window.__sz.game.radar.shown.map((e) => `${e.id}:${e.why}`));
// count canvas pixels matching a colour test (given as a source string)
const count = (p, test) => p.evaluate((src) => { const c = document.getElementById('radar'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const f = new Function('r', 'g', 'b', 'a', `return ${src}`); let n = 0; for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2], d[i + 3])) n++; return n; }, test);

async function practice(mapId, viewport = { width: 960, height: 540 }, touch = false) {
  const ctx = await browser.newContext(touch ? { viewport, hasTouch: true, isMobile: true } : { viewport });
  const p = await ctx.newPage();
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(touch ? `${BASE}/?touch=1` : BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.selectOption('#practice-map', mapId);
  await p.evaluate(() => document.getElementById('btn-practice').click());
  await p.waitForSelector('#screen-pause:not([hidden])');
  await p.evaluate(() => document.getElementById('btn-resume').click());
  if (touch) await p.waitForFunction(() => window.__sz.input.locked);
  else await p.waitForFunction(() => document.pointerLockElement);
  await p.waitForFunction(() => window.__sz.game.tickNo > 20);
  return p;
}

try {
  // ---- practice: pixels, rules, toggle ----
  const p = await practice('yard');
  await redraw(p);
  const dim = await p.evaluate(() => { const c = document.getElementById('radar'); const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cw: Math.round(r.width), vis: r.width > 0 && getComputedStyle(c).display !== 'none', top: Math.round(r.top), fpsBottom: Math.round(document.getElementById('hud-info').getBoundingClientRect().bottom) }; });
  check('radar canvas exists, visible, ~170 px on desktop, under the fps line', dim.vis && dim.cw === 170 && dim.top >= dim.fpsBottom, JSON.stringify(dim));
  const nonEmpty = await count(p, 'a > 0');
  const mapPx = await count(p, 'a > 200 && r > 40 && r < 140 && Math.abs(r - g) < 20');
  check('radar has pixels: disc, map boxes, arrow', nonEmpty > 5000 && mapPx > 300, `${nonEmpty} opaque, ${mapPx} map-grey`);
  const white = await count(p, 'r > 235 && g > 235 && b > 235 && a > 200');
  check('white player arrow is drawn', white > 10, `${white} white px`);
  const hasStatic = await p.evaluate(() => { const s = window.__sz.game.radar.stat; return !!s && s.img.width > 200 && window.__sz.game.radar.statMap === window.__sz.game.map; });
  check('static layer pre-rendered for this map (offscreen canvas)', hasStatic);

  // rules with dummies (enemies): open line shown, behind a wall hidden, dead hidden
  const setup = await p.evaluate(async () => {
    const { rayWorld } = await import('./js/physics.js');
    const g = window.__sz.game;
    const m = g.mode;
    for (const t of m.targets) { t.mx = 0; t.alive = false; t.respawnAt = 1e9; t.px = 500; t.pz = 500; }
    const eyeAt = (x, z) => [x, 1.62, z];
    // pick the player spot with the most open + most blocked ring points at radius 12
    let best = null;
    for (let gx = -16; gx <= 16; gx += 4) {
      for (let gz = -16; gz <= 16; gz += 4) {
        const e = eyeAt(gx, gz);
        let open = null;
        let blocked = null;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const x = gx + Math.cos(a) * 12;
          const z = gz + Math.sin(a) * 12;
          if (Math.abs(x) > 22 || Math.abs(z) > 22) continue;
          const d = [x - e[0], 1.1 - e[1], z - e[2]];
          const len = Math.hypot(...d);
          const t = rayWorld(g.map, e, d.map((v) => v / len), len);
          const free = !g.map.boxes.some((b) => x > b[0] - 0.4 && x < b[3] + 0.4 && z > b[2] - 0.4 && z < b[5] + 0.4 && b[4] > 0);
          if (!free) continue;
          if (t >= len - 0.05 && !open) open = [x, z];
          if (t < len - 1.5 && !blocked) blocked = [x, z];
        }
        if (open && blocked) { best = { gx, gz, open, blocked }; break; }
      }
      if (best) break;
    }
    return best;
  });
  check('found a spot with one open and one walled-off ring point', !!setup, JSON.stringify(setup));
  await p.evaluate((s) => {
    const g = window.__sz.game;
    g.kin.x = s.gx; g.kin.z = s.gz; g.kin.y = 0; g.input.yaw = 0;
    const t = g.mode.targets;
    t[0].alive = true; t[0].px = s.open[0]; t[0].pz = s.open[1];
    t[1].alive = true; t[1].px = s.blocked[0]; t[1].pz = s.blocked[1];
    t[2].alive = false; t[2].px = s.open[0] + 0.5; t[2].pz = s.open[1]; // dead, in the open
  }, setup);
  await p.waitForFunction(() => window.__sz.game.mode.targets[0].view.group.position.x !== 500);
  await redraw(p, 3);
  let got = await ids(p);
  check('enemy in clear sight is shown (seen)', got.includes('1:seen'), got.join());
  check('enemy behind a wall is NOT shown', !got.some((x) => x.startsWith('2:')), got.join());
  check('dead enemy is hidden', !got.some((x) => x.startsWith('3:')), got.join());
  const blue = await count(p, 'b > 200 && r < 110 && g > 90 && g < 160 && a > 200');
  check('the seen enemy is a team-coloured (Cobalt blue) dot on the canvas', blue > 8, `${blue} px`);
  // fired from behind the wall: ping shows it for 2 s, then it disappears again
  const pingLeft = await p.evaluate(() => { const rd = window.__sz.game.radar; rd.ping(2); return rd.pings.get(2) - performance.now(); });
  check('a shot pings the shooter for 2 s', pingLeft > 1900 && pingLeft <= 2000, `${pingLeft.toFixed(0)} ms`);
  await p.evaluate(() => { const rd = window.__sz.game.radar; rd.pingMs = 8000; rd.ping(2); }); // slow frames: stretch the window for the drawing checks
  await redraw(p, 2);
  got = await ids(p);
  check('an enemy that just fired is shown even behind a wall (ping)', got.includes('2:ping'), got.join());
  await p.evaluate(() => { const rd = window.__sz.game.radar; rd.pingMs = 2000; rd.pings.set(2, performance.now() + 1500); });
  await p.waitForFunction(() => !window.__sz.game.radar.pings.has(2) || window.__sz.game.radar.pings.get(2) < performance.now());
  await redraw(p, 2);
  got = await ids(p);
  check('...and is gone again when the ping runs out', !got.some((x) => x.startsWith('2:')), got.join());
  // teammates: always, even behind walls and beyond range (clamped to the rim)
  await p.evaluate((s) => {
    const g = window.__sz.game;
    const mate = g.addRemote(77, 'Mate', 'A', true);
    mate.setNow({ x: s.blocked[0], y: 0, z: s.blocked[1], yaw: 0, alive: true, w: 0, c: false });
    const far = g.addRemote(78, 'Far', 'A', true);
    far.setNow({ x: s.gx + 55, y: 0, z: s.gz, yaw: 0, alive: true, w: 0, c: false });
    const dead = g.addRemote(79, 'Dead', 'A', true);
    dead.setNow({ x: s.open[0], y: 0, z: s.open[1], yaw: 0, alive: false, w: 0, c: false });
  }, setup);
  await p.waitForFunction(() => { const r = window.__sz.game.remotes.get(77); return r && r.alive; });
  await redraw(p, 3);
  got = await ids(p);
  check('teammate behind a wall is shown', got.includes('77:team'), got.join());
  check('teammate beyond the 35 m range stays on the rim', got.includes('78:team'), got.join());
  check('dead teammate is hidden', !got.some((x) => x.startsWith('79:')), got.join());
  const red = await count(p, 'r > 220 && g < 110 && b < 110 && a > 200');
  check('teammates are drawn in the team colour (Ember red)', red > 15, `${red} px`);
  // pickups: yellow squares
  const y0 = await count(p, 'r > 235 && g > 190 && g < 235 && b < 90 && a > 200');
  await p.evaluate((s) => window.__sz.game.pickups.setList([{ id: 1, w: 0, x: s.gx + 6, y: 0, z: s.gz - 3, m: 30, r: 90 }, { id: 2, w: 1, x: s.gx - 5, y: 0, z: s.gz + 8, m: 12, r: 36 }]), setup);
  await redraw(p, 3);
  const y1 = await count(p, 'r > 235 && g > 190 && g < 235 && b < 90 && a > 200');
  check('weapon pickups show as yellow squares', y1 > y0 + 8, `${y0} -> ${y1} px`);
  await p.evaluate(() => window.__sz.game.pickups.setList([]));
  // rotation: turning 90 degrees moves a point that was straight ahead to the side (static layer + dots rotate, arrow stays up)
  await p.evaluate((s) => { const g = window.__sz.game; g.remotes.delete(78); g.remotes.delete(79); g.input.yaw = 0; const m = g.remotes.get(77); m.setNow({ x: s.gx, y: 0, z: s.gz - 20, yaw: 0, alive: true, w: 0, c: false }); }, setup);
  await redraw(p, 3);
  const redAt = (ya) => p.evaluate((ya) => { const c = document.getElementById('radar'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let sx = 0, sy = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i + 1] < 110 && d[i + 2] < 110 && d[i + 3] > 200) { const k = i / 4; sx += k % c.width; sy += Math.floor(k / c.width); n++; } return { x: sx / n - c.width / 2, y: sy / n - c.height / 2, n }; }, ya);
  const ahead = await redAt();
  await p.evaluate(() => { window.__sz.game.input.yaw = Math.PI / 2; }); // turn left 90 degrees: the point 20 m north is now on the right
  await redraw(p, 3);
  const turned = await redAt();
  check('radar rotates with the view (a point ahead is up; after a left turn it is on the right)', ahead.n > 5 && ahead.y < -20 && Math.abs(ahead.x) < 6 && turned.x > 20 && Math.abs(turned.y) < 8, JSON.stringify({ ahead, turned }));
  if (SHOTS) {
    await p.evaluate((s) => { const g = window.__sz.game; g.input.yaw = 0.4; g.remotes.delete(77); const t = g.mode.targets; t[0].px = s.open[0]; t[0].pz = s.open[1]; g.pickups.setList([{ id: 1, w: 0, x: s.gx + 6, y: 0, z: s.gz - 3, m: 30, r: 90 }]); const a = g.addRemote(80, 'Mate', 'A', true); a.setNow({ x: s.gx - 7, y: 0, z: s.gz - 9, yaw: 0, alive: true, w: 0, c: false }); }, setup);
    await redraw(p, 3);
    await p.screenshot({ path: `${SHOTS}/radar_desktop.jpg`, type: 'jpeg', quality: 85 });
    await p.screenshot({ path: `${SHOTS}/radar_closeup.png`, clip: { x: 0, y: 0, width: 220, height: 220 } });
  }
  // M toggles and is remembered
  await p.keyboard.press('KeyM');
  await p.waitForFunction(() => !window.__sz.game.radar.on);
  check('M hides the radar and remembers it in localStorage sz.radar', await p.evaluate(() => getComputedStyle(document.getElementById('radar')).display === 'none' && localStorage.getItem('sz.radar') === '0' && document.getElementById('hud').classList.contains('radar-off')));
  await p.keyboard.press('KeyM');
  await p.waitForFunction(() => window.__sz.game.radar.on);
  await redraw(p, 2);
  check('M shows it again', await p.evaluate(() => getComputedStyle(document.getElementById('radar')).display !== 'none' && localStorage.getItem('sz.radar') === '1') && (await count(p, 'a > 0')) > 5000);
  await p.keyboard.press('KeyM');
  await p.waitForFunction(() => !window.__sz.game.radar.on);
  await p.reload();
  await p.waitForFunction(() => window.__sz && window.__sz.assets && !document.getElementById('btn-practice').disabled);
  await p.evaluate(() => document.getElementById('btn-practice').click());
  await p.waitForSelector('#screen-pause:not([hidden])');
  check('the off state survives a reload', await p.evaluate(() => !window.__sz.game.radar.on));
  await p.evaluate(() => localStorage.setItem('sz.radar', '1'));
  await p.context().close();

  // ---- touch: smaller, tap toggles, chip to bring it back ----
  const t = await practice('yard', { width: 800, height: 360 }, true);
  await redraw(t, 2);
  const td = await t.evaluate(() => { const r = document.getElementById('radar').getBoundingClientRect(); const hp = document.getElementById('hud-bl').getBoundingClientRect(); return { w: Math.round(r.width), x: r.left + r.width / 2, y: r.top + r.height / 2, bottom: r.bottom, hpTop: hp.top }; });
  check('touch radar is ~120 px and the HP bar sits below it', td.w === 120 && td.hpTop >= td.bottom - 1, JSON.stringify(td));
  if (SHOTS) await t.screenshot({ path: `${SHOTS}/radar_touch.jpg`, type: 'jpeg', quality: 85 });
  await t.touchscreen.tap(td.x, td.y);
  await t.waitForFunction(() => !window.__sz.game.radar.on);
  await redraw(t, 2);
  const chip = await t.evaluate(() => { const r = document.getElementById('radar').getBoundingClientRect(); return { w: Math.round(r.width), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  check('tapping the radar hides it, leaving a small RADAR chip', chip.w < 80, JSON.stringify(chip));
  await t.touchscreen.tap(chip.x, chip.y);
  await t.waitForFunction(() => window.__sz.game.radar.on);
  check('tapping the chip brings it back', true);
  check('a radar tap did not fire or turn the view', await t.evaluate(() => window.__sz.game.loadout.mag[0] === 30));
  await t.context().close();

  // ---- online: two real browsers, bunker (spawns far apart behind walls) ----
  const open = async (nick) => {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 300 } });
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(240000);
    watchErrors(pg, errors);
    await pg.goto(BASE);
    await pg.waitForFunction(() => window.__sz && window.__sz.map);
    await pg.fill('#nick', nick);
    await pg.click('#btn-online');
    await pg.waitForSelector('#screen-lobby:not([hidden])');
    return pg;
  };
  const a = await open('RadA');
  const b = await open('RadB');
  await a.selectOption('#pref-team', 'A');
  await a.fill('#c-name', 'Radar Room');
  await a.selectOption('#c-map', 'bunker');
  await a.click('#create-form button[type=submit]');
  await a.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  await b.selectOption('#pref-team', 'B');
  await b.waitForSelector('#room-body button');
  await b.click('#room-body button');
  await b.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  for (const pg of [a, b]) {
    await pg.waitForSelector('#screen-pause:not([hidden])');
    await pg.click('#btn-resume', { timeout: 30000 }).catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} state ${JSON.stringify(await pg.evaluate(() => ({ s: ['title', 'lobby', 'pause'].map((n) => document.getElementById('screen-' + n).hidden), run: window.__sz.game.running, z: document.querySelector('#screen-pause .panel').style.zoom })))}`); });
    await pg.waitForFunction(() => document.pointerLockElement);
  }
  await a.waitForFunction(() => window.__sz.game.remotes.size === 1 && window.__sz.game.mode.me && window.__sz.game.mode.me.a);
  await b.waitForFunction(() => window.__sz.game.mode.me && window.__sz.game.mode.me.a);
  const bId = await b.evaluate(() => window.__sz.game.mode.myId);
  const aId = await a.evaluate(() => window.__sz.game.mode.myId);
  await redraw(a, 3);
  check('online: both on the radar canvas, opposite teams', (await a.evaluate(() => window.__sz.game.myTeam)) !== (await b.evaluate(() => window.__sz.game.myTeam)) && (await count(a, 'a > 0')) > 3000);
  let ga = await ids(a);
  check('online: an enemy far away behind walls is not on the radar', !ga.some((x) => x.startsWith(`${bId}:`)), ga.join());
  // B shoots: A sees the shooter for ~2 s
  await a.evaluate(() => { window.__sz.game.radar.pingMs = 5000; });
  await b.mouse.click(240, 150);
  await a.waitForFunction((id) => window.__sz.game.radar.pings.has(id), bId);
  await redraw(a, 2);
  ga = await ids(a);
  check('online: after B fires, A sees B on the radar (ping)', ga.includes(`${bId}:ping`), ga.join());
  await a.waitForFunction((id) => !window.__sz.game.radar.pings.has(id) || window.__sz.game.radar.pings.get(id) < performance.now(), bId);
  await redraw(a, 2);
  ga = await ids(a);
  check('online: ...and B is hidden again 2 s later', !ga.some((x) => x.startsWith(`${bId}:`)), ga.join());
  // B joins A's team: always shown (also behind walls)
  await b.evaluate(() => document.getElementById('btn-team-a').click());
  await a.waitForFunction((id) => { const r = window.__sz.game.remotes.get(id); return r && r.team === window.__sz.game.myTeam; }, bId);
  await redraw(a, 3);
  ga = await ids(a);
  check('online: a teammate is always on the radar', ga.includes(`${bId}:team`), ga.join());
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('radar run', false, String(e));
} finally {
  await browser.close();
}
done();
