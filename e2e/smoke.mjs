// Headless-browser smoke test. Usage: BASE_URL=http://localhost:8080 node smoke.mjs
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchErrors(page, errors);
  await page.goto(BASE);
  await page.waitForFunction(() => window.__sz && window.__sz.map, null, { timeout: 15000 });
  check('title screen visible', await page.isVisible('#screen-title'));

  // Practice mode: start, lock pointer, shoot, ammo drops.
  await page.fill('#nick', 'Tester');
  await page.click('#btn-practice');
  check('pause overlay shown before lock', await page.isVisible('#screen-pause'));
  await page.click('#btn-resume');
  await page.waitForFunction(() => document.pointerLockElement && document.pointerLockElement.id === 'view', null, { timeout: 5000 });
  check('pointer lock acquired', true);
  const ammo0 = await page.evaluate(() => window.__sz.game.loadout.mag[0]);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  const ammo1 = await page.evaluate(() => window.__sz.game.loadout.mag[0]);
  check('firing consumes ammo', ammo1 < ammo0, `${ammo0} -> ${ammo1}`);

  // Walk forward 1s: position changes.
  const z0 = await page.evaluate(() => window.__sz.game.kin.z);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  const z1 = await page.evaluate(() => window.__sz.game.kin.z);
  check('WASD moves player', Math.abs(z1 - z0) > 1, `z ${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('smoke run', false, String(e));
} finally {
  await browser.close();
}
done();
