// Grenades + bots in a real room (server simulates both). Usage: node nades_bots.mjs [screenshotDir]
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [];
const settle = (p, n = 6) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const snap = async (p, name) => { if (out) { await settle(p); await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 85 }); } };
// bots shoot back, so the human can die mid-test: wait to be alive, throw, and retry if the effect never shows up
async function throwUntil(p, key, ready, effect, tries = 6) {
  for (let i = 0; i < tries; i++) {
    await p.waitForFunction(() => window.__sz.game.mode.me.a, null, { timeout: 60000 });
    await p.evaluate(ready);
    await p.keyboard.press(key);
    if (await p.waitForFunction(effect, null, { timeout: 12000 }).then(() => true, () => false)) return true;
  }
  return false;
}
try {
  const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.map);
  await p.fill('#nick', 'Human');
  await p.click('#btn-online');
  await p.waitForSelector('#screen-lobby:not([hidden])');
  await p.fill('#c-name', 'Bot Room');
  await p.selectOption('#c-bots', '3');
  await p.selectOption('#c-skill', 'normal');
  await p.click('#create-form button[type=submit]');
  await p.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement && window.__sz.game.mode.me);
  await p.waitForFunction(() => window.__sz.game.remotes.size === 3);
  check('room created with 3 bots: all three rendered as remote players', true);
  check('scoreboard rows carry the [BOT] tag', await p.evaluate(() => [...window.__sz.game.mode.roster.values()].filter((r) => r.nick.startsWith('[BOT]')).length === 3));

  // bots move on their own (server AI)
  const pos0 = await p.evaluate(() => [...window.__sz.game.remotes.values()].map((r) => [r.group.position.x, r.group.position.z]));
  await p.waitForFunction((p0) => [...window.__sz.game.remotes.values()].some((r, i) => Math.hypot(r.group.position.x - p0[i][0], r.group.position.z - p0[i][1]) > 3), pos0);
  check('bots walk by themselves', true);

  // grenades: HUD counts, flight, explosion, smoke cloud, flash blindness
  check('HUD shows 3 grenade types with 1 each', await p.evaluate(() => { const e = document.getElementById('nades'); return !e.hidden && e.children.length === 3 && window.__sz.game.mode.me.gn.join() === '1,1,1'; }));
  check('X throws a frag: it flies, the inventory drops and it goes off', await throwUntil(p, 'KeyX', () => { const g = window.__sz.game; g.input.yaw = 0; g.input.pitch = 0.15; }, () => window.__sz.game.grenades.flight.size >= 1));
  await p.waitForFunction(() => window.__sz.game.grenades.flight.size === 0, null, { timeout: 30000 });
  check('the frag is gone from the air after its fuse', true);

  check('C throws a smoke: a cloud stands on the map', await throwUntil(p, 'KeyC', () => { const g = window.__sz.game; g.input.pitch = 0.15; }, () => window.__sz.game.grenades.clouds.size === 1 || window.__sz.game.mode.me.gn[1] === 0 && window.__sz.game.grenades.clouds.size >= 1));
  await p.evaluate(() => { const g = window.__sz.game; const c = [...g.grenades.clouds.values()][0]; g.debugCam = { pos: [c.x + 5, 1.7, c.z + 5], look: [c.x, 1.2, c.z] }; });
  await snap(p, 'nade_smoke');
  await p.evaluate(() => { window.__sz.game.debugCam = null; });

  const flashed = await throwUntil(p, 'KeyV', () => { const g = window.__sz.game; g.input.pitch = -1.45; }, () => !document.getElementById('flash').hidden);
  check('a flashbang at your feet whites out the screen', flashed);
  await snap(p, 'nade_flash');
  await p.waitForFunction(() => document.getElementById('flash').hidden, null, { timeout: 60000 });
  check('the flash fades away', true);

  // pause menu: add / remove bots
  await p.evaluate(() => document.exitPointerLock());
  await p.waitForSelector('#screen-pause:not([hidden])');
  check('pause menu shows bot controls online', await p.isVisible('#pause-bots'));
  await p.selectOption('#bot-skill', 'hard');
  const before = await p.evaluate(() => window.__sz.game.mode.roster.size);
  await p.click('#btn-bot-rm');
  await p.waitForFunction((n) => window.__sz.game.mode.roster.size === n - 1, before);
  check('- Bot removes one', true);
  await p.click('#btn-bot-b');
  await p.waitForFunction((n) => window.__sz.game.mode.roster.size === n, before);
  check('+ Bot Cobalt adds one', await p.evaluate(() => [...window.__sz.game.mode.roster.values()].filter((r) => r.nick.startsWith('[BOT]')).length === 3));

  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('nades+bots run', false, String(e));
} finally {
  await browser.close();
}
done();
