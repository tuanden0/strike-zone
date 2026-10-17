// Headless-browser smoke test. Usage: BASE_URL=http://localhost:8080 node smoke.mjs
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchErrors(page, errors);
  page.setDefaultTimeout(120000); // software GL: frames take ~0.5 s, so wait on state, never on sleeps
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
  await page.waitForFunction(() => window.__sz.game.tickNo > 20);
  const ammo0 = await page.evaluate(() => window.__sz.game.loadout.mag[0]);
  await page.mouse.click(640, 360);
  await page.waitForFunction((a) => window.__sz.game.loadout.mag[0] < a, ammo0);
  const ammo1 = await page.evaluate(() => window.__sz.game.loadout.mag[0]);
  check('firing consumes ammo', ammo1 < ammo0, `${ammo0} -> ${ammo1}`);

  // WebAudio works on plain http (no secure context needed) and every synthesized sound plays without throwing.
  const audio = await page.evaluate(() => {
    const sfx = window.__sz.sfx;
    const names = ['rifle', 'pistol', 'knife', 'reload', 'empty', 'hit', 'headshot', 'hurt', 'kill', 'death', 'spawn', 'step', 'land', 'jump', 'switch', 'impact', 'end'];
    try {
      for (const n of names) {
        sfx.play(n);
        sfx.play(n, [3, 1, -4], { x: 0, y: 1.6, z: 0, yaw: 0.5 });
      }
    } catch (e) {
      return { ok: false, err: String(e) };
    }
    return { ok: true, state: sfx.ctx && sfx.ctx.state, secure: window.isSecureContext, n: names.length };
  });
  check('all sounds synthesize (AudioContext running)', audio.ok && audio.state === 'running', JSON.stringify(audio));

  // Weapon switching: keys 1/2/3 select rifle/pistol/knife.
  for (const [key, idx] of [['Digit2', 1], ['Digit3', 2], ['Digit1', 0]]) {
    await page.keyboard.press(key);
    const ok = await page.waitForFunction((i) => window.__sz.game.loadout.cur === i, idx, { timeout: 3000 }).then(() => true, () => false);
    check(`key ${key} selects weapon ${idx}`, ok);
  }
  await page.waitForFunction(() => window.__sz.game.loadout.cur === 0 && window.__sz.game.switchT === 0 && window.__sz.game.loadout.nextFire <= window.__sz.game.tickNo); // switch delay blocks reload
  await page.keyboard.press('KeyR');
  const reloading = await page.waitForFunction(() => window.__sz.game.loadout.reloading, null, { timeout: 3000 }).then(() => true, () => false);
  check('R starts reload when mag not full', reloading);

  // Walk forward 1s: position changes.
  const z0 = await page.evaluate(() => window.__sz.game.kin.z);
  await page.keyboard.down('KeyW');
  await page.waitForFunction((z) => Math.abs(window.__sz.game.kin.z - z) > 1, z0);
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
