// Right click with the knife = overhead stab (practice): windup, damage by where it lands, cooldown, animation.
//   node e2e/heavy.mjs [outDir]   (outDir optional: screenshots of the animation)
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [];
const settle = (p, n = 6) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
try {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.click('#btn-practice');
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement);
  await p.waitForFunction(() => window.__sz.game.tickNo > 30);
  await p.keyboard.press('Digit3');
  await p.waitForFunction(() => window.__sz.game.loadout.weapon.melee);

  const tg = () => p.evaluate(() => { const t = window.__sz.game.mode.targets[3]; return { hp: t.hp, alive: t.alive, x: t.px, z: t.pz }; });
  // record the dummy's hp when a stab starts and when it lands (polling is too slow under software GL to catch the windup)
  await p.evaluate(() => {
    const g = window.__sz.game;
    window.__hv = [];
    const orig = g.onLocalWeapon.bind(g);
    g.onLocalWeapon = (res, cmd) => {
      const hp = g.mode.targets[3].hp;
      if (res.heavy) window.__hv.push({ e: 'start', hp, tick: g.tickNo });
      if (res.heavyLand) window.__hv.push({ e: 'land', hp, tick: g.tickNo });
      orig(res, cmd);
    };
  });
  const ready = () => p.waitForFunction(() => window.__sz.game.loadout.nextFire <= window.__sz.game.tickNo && window.__sz.game.heavyT === 0, null, { timeout: 30000 }).catch(async () => { throw new Error(`not ready: ${await p.evaluate(() => JSON.stringify({ nf: window.__sz.game.loadout.nextFire, tick: window.__sz.game.tickNo, heavyT: window.__sz.game.heavyT, run: window.__sz.game.running, alive: window.__sz.game.alive }))}`); });
  const stabAt = async (pitch) => { // right click the dummy at (0, -3) from 1.6 m, aiming at `pitch`
    await ready();
    await p.evaluate((pitch) => { const g = window.__sz.game; const t = g.mode.targets[3]; t.hp = 100; t.alive = true; g.kin.x = t.px; g.kin.z = t.pz + 1.6; g.input.yaw = 0; g.input.pitch = pitch; window.__hv.length = 0; }, pitch);
    await p.mouse.down({ button: 'right' });
    await p.mouse.up({ button: 'right' });
    await p.waitForFunction(() => window.__hv.some((x) => x.e === 'land'), null, { timeout: 30000 }).catch(async (e) => { throw new Error(`stab never landed: ${await p.evaluate(() => JSON.stringify({ hv: window.__hv, nf: window.__sz.game.loadout.nextFire, tick: window.__sz.game.tickNo, heavyAt: window.__sz.game.heavyAt, heavyT: window.__sz.game.heavyT, alive: window.__sz.game.alive, sc: window.__sz.game.input.scopeHeld, lock: window.__sz.game.input.locked }))}`); });
    const t0 = await p.evaluate(() => window.__hv.find((x) => x.e === 'land').tick);
    await p.waitForFunction((t) => window.__sz.game.tickNo > t + 2, t0);
    const log = await p.evaluate(() => window.__hv.slice());
    const after = await tg();
    return { log, after, windupOk: log[0].hp === 100 && log[1].hp === 100 && log[1].tick - log[0].tick === 9 };
  };

  const legs = await stabAt(-0.65);
  check('windup: no damage until 9 ticks after the press', legs.windupOk, JSON.stringify(legs.log));
  check('stab at the legs deals 50 (40 +25%)', legs.after.hp === 50, JSON.stringify(legs));
  await p.waitForFunction(() => window.__sz.game.tickNo > 0 && window.__sz.game.loadout.nextFire <= window.__sz.game.tickNo);
  const chest = await stabAt(-0.257);
  check('stab at the chest deals 80 (x2)', chest.after.hp === 20, JSON.stringify(chest.after));
  await ready();
  const head = await stabAt(0);
  check('stab at the head is a headshot kill (x4)', !head.after.alive, JSON.stringify(head.after));
  check('a kill by a head stab shows the HEADSHOT medal', (await p.evaluate(() => document.getElementById('medal').innerText)).includes('HEADSHOT'));

  // the cooldown blocks a second stab and normal slashes
  await ready();
  await p.evaluate(() => { window.__hv.length = 0; });
  await p.mouse.down({ button: 'right' });
  await p.mouse.up({ button: 'right' });
  await p.waitForFunction(() => window.__hv.some((x) => x.e === 'start'));
  const cd = await p.evaluate(() => window.__sz.game.loadout.nextFire - window.__sz.game.tickNo);
  check('the stab has a long cooldown (about 1.2 s)', cd > 20, `${cd} ticks left`);
  // it did not zoom the view
  check('right click with the knife does not zoom', await p.evaluate(() => window.__sz.game.scopeT === 0 && !window.__sz.game.input.scopeHeld));

  // a normal slash to the head is a headshot too
  await ready();
  await p.evaluate(() => { const g = window.__sz.game; const t = g.mode.targets[3]; t.hp = 100; t.alive = true; g.kin.x = t.px; g.kin.z = t.pz + 1.6; g.input.yaw = 0; g.input.pitch = 0; });
  await p.mouse.down();
  await p.waitForFunction(() => !window.__sz.game.mode.targets[3].alive);
  await p.mouse.up();
  check('a slash to the head kills as a headshot', (await p.evaluate(() => document.getElementById('medal').innerText)).includes('HEADSHOT'));

  if (out) {
    await p.waitForFunction(() => window.__sz.game.heavyT === 0);
    for (const [name, t] of [['rest', 0], ['raise', 0.3], ['strike', 0.45], ['hold', 0.6]]) {
      await p.evaluate((t) => { window.__sz.game.debugHeavy = { t }; }, t);
      await settle(p, 3);
      await p.screenshot({ path: `${out}/heavy_${name}.jpg`, type: 'jpeg', quality: 88 });
    }
    await p.evaluate(() => { window.__sz.game.debugHeavy = null; });
  }
  check('no JS errors', errors.length === 0, errors.join('; '));
} catch (e) {
  check('e2e run', false, e.stack || String(e));
}
await browser.close();
done();
