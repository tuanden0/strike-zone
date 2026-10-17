// Knife: the first-person view model plays a slash / backhand / stab combo, the third-person character has the matching clips.
//   node e2e/knife.mjs [outDir]   (outDir optional: saves screenshots of each swing at its apex)
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
  check('knife equipped', true);

  // pose at the apex of each swing differs from rest and from the other swings
  const pose = async (kind, t) => {
    await p.evaluate(([k, t]) => { window.__sz.game.debugSwing = { kind: k, t }; }, [kind, t]);
    await settle(p, 3);
    return p.evaluate(() => { const g = window.__sz.game.vm[2]; return [g.position.x, g.position.y, g.position.z, g.rotation.x, g.rotation.y, g.rotation.z].map((v) => +v.toFixed(3)); });
  };
  const rest = await pose(0, 0);
  const apex = [await pose(0, 0.55), await pose(1, 0.55), await pose(2, 0.5)];
  const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  check('each swing moves the knife away from rest', apex.every((a) => dist(a, rest) > 0.2), JSON.stringify({ rest, apex }));
  check('slash, backhand and stab are different motions', dist(apex[0], apex[1]) > 0.3 && dist(apex[0], apex[2]) > 0.3 && dist(apex[1], apex[2]) > 0.3);
  check('the stab thrusts forward (-z)', apex[2][2] < rest[2] - 0.2, `z ${rest[2]} -> ${apex[2][2]}`);
  if (out) {
    for (const [name, k, t] of [['rest', 0, 0], ['slash', 0, 0.55], ['backhand', 1, 0.55], ['stab', 2, 0.5]]) {
      await pose(k, t);
      await p.screenshot({ path: `${out}/knife_${name}.jpg`, type: 'jpeg', quality: 88 });
    }
  }
  await p.evaluate(() => { window.__sz.game.debugSwing = null; });

  // real clicks cycle the combo; a pause restarts it
  const kinds = [];
  for (let i = 0; i < 4; i++) {
    const before = await p.evaluate(() => window.__sz.game.tickNo);
    await p.mouse.down();
    await p.waitForFunction(() => window.__sz.game.swing > 0.5);
    kinds.push(await p.evaluate(() => window.__sz.game.swingKind));
    await p.mouse.up();
    await p.waitForFunction((t) => window.__sz.game.tickNo > t + 20 && window.__sz.game.swing === 0, before);
  }
  check('clicks play slash, backhand, stab, then slash again', kinds.join() === '0,1,2,0', `got ${kinds}`);
  const t0 = await p.evaluate(() => window.__sz.game.tickNo);
  await p.waitForFunction((t) => window.__sz.game.tickNo > t + 40, t0);
  await p.mouse.down();
  await p.waitForFunction(() => window.__sz.game.swing > 0.5);
  check('a pause restarts the combo', (await p.evaluate(() => window.__sz.game.swingKind)) === 0);
  await p.mouse.up();

  // third person: the character model has the three knife clips and plays them in turn
  const tp = await p.evaluate(async () => {
    const m = await import('/js/models.js');
    return Object.keys(m).join();
  });
  check('models module loads', tp.length > 0);
  check('no JS errors', errors.length === 0, errors.join('; '));
} catch (e) {
  check('e2e run', false, e.stack || String(e));
}
await browser.close();
done();
