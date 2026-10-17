// Grenade as a held item: equip, charge (power bar + arc), throw power, cancel, pause safety. Needs a running server.
//   node e2e/nade.mjs [outDir]
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [];
const ROOM = `Nade ${Date.now()}`;
const settle = (p, n = 6) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

try {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.map);
  await p.fill('#nick', 'Thrower');
  await p.click('#btn-online');
  await p.waitForSelector('#screen-lobby:not([hidden])');
  await p.fill('#c-name', ROOM);
  await p.click('#create-form button[type=submit]');
  await p.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement && document.pointerLockElement.id === 'view');
  await p.waitForFunction(() => window.__sz.game.mode.me && window.__sz.game.mode.me.a && window.__sz.game.mode.me.gn.join() === '1,1,1');
  const state = () => p.evaluate(() => { const g = window.__sz.game; return { eq: g.nadeHold.eq, charging: g.nadeHold.charging, charge: g.nadeHold.charge, gn: g.mode.me.gn.join(), flight: g.grenades.flight.size, cur: g.loadout.cur, power: !document.getElementById('nade-power').hidden, arc: g.grenades.arc.visible, wname: document.getElementById('weapon-name').textContent, vmKnife: g.vm[g.loadout.cur].visible, vmNade: g.nadeHold.models.map((m) => m.visible).join() }; });

  const s0 = await state();
  await p.keyboard.press('KeyX');
  await p.waitForFunction(() => window.__sz.game.nadeHold.eq === 0);
  await settle(p, 4);
  const s1 = await state();
  check('X equips the frag instead of throwing it', s1.eq === 0 && s1.gn === '1,1,1' && s1.flight === 0, JSON.stringify(s1));
  check('the weapon in hand is the grenade (HUD name, view model, arc preview)', s1.wname === 'HE Grenade' && !s1.vmKnife && s1.vmNade === 'true,false,false' && s1.arc, JSON.stringify(s1));
  if (out) await p.screenshot({ path: `${out}/nade_equipped.jpg`, type: 'jpeg', quality: 88 });

  // a held button does not fire the previously selected weapon
  const ammo0 = await p.evaluate(() => window.__sz.game.loadout.mag[window.__sz.game.loadout.cur]);
  await p.mouse.down();
  await p.waitForFunction(() => window.__sz.game.nadeHold.charge > 0.3);
  const s2 = await state();
  check('holding fire charges (power bar visible) and does not shoot the gun', s2.charging && s2.power && s2.flight === 0 && (await p.evaluate(() => window.__sz.game.loadout.mag[window.__sz.game.loadout.cur])) === ammo0, JSON.stringify(s2));
  if (out) await p.screenshot({ path: `${out}/nade_charging.jpg`, type: 'jpeg', quality: 88 });
  // the arc grows with the charge
  const reach = () => p.evaluate(() => { const a = window.__sz.game.grenades.arcGeo.attributes.position; const n = window.__sz.game.grenades.arcGeo.drawRange.count; const e = [a.getX(n - 1), a.getZ(n - 1)]; const s = [a.getX(0), a.getZ(0)]; return Math.hypot(e[0] - s[0], e[1] - s[1]); });
  const r1 = await reach();
  await p.waitForFunction(() => window.__sz.game.nadeHold.charge > 0.95);
  const r2 = await reach();
  check('a full charge predicts a longer throw than a part charge', r2 > r1 + 1, `${r1.toFixed(1)} m -> ${r2.toFixed(1)} m`);

  // right click cancels the charge: nothing is thrown
  await p.mouse.down({ button: 'right' });
  await p.mouse.up({ button: 'right' });
  await p.waitForFunction(() => !window.__sz.game.nadeHold.charging);
  await p.mouse.up();
  const t0 = await p.evaluate(() => window.__sz.game.tickNo);
  await p.waitForFunction((t) => window.__sz.game.tickNo > t + 15, t0);
  const s3 = await state();
  check('right click cancels the throw (still equipped, inventory unchanged)', s3.eq === 0 && s3.gn === '1,1,1' && s3.flight === 0, JSON.stringify(s3));

  // pausing mid-charge does not throw
  await p.mouse.down();
  await p.waitForFunction(() => window.__sz.game.nadeHold.charge > 0.2);
  await p.evaluate(() => window.__sz.game.input.unlock());
  await p.waitForFunction(() => !document.pointerLockElement);
  await p.mouse.up();
  const t1 = await p.evaluate(() => window.__sz.game.tickNo);
  await p.waitForFunction((t) => window.__sz.game.tickNo > t + 15, t1);
  const s4 = await state();
  check('opening the menu while charging drops the throw', !s4.charging && s4.gn === '1,1,1' && s4.flight === 0, JSON.stringify(s4));
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement && document.pointerLockElement.id === 'view');

  // a quick tap throws a short lob, a full charge a long throw: distance from the thrower 0.5 s after the grenade appears
  const watchFlight = () => p.evaluate(() => new Promise((res) => {
    let t0 = -1;
    let last = -1;
    const f = () => {
      const g = window.__sz.game;
      const fl = [...g.grenades.flight.values()][0];
      if (fl) {
        if (t0 < 0) t0 = g.tickNo;
        last = Math.hypot(fl.target.x - g.kin.x, fl.target.z - g.kin.z);
        if (g.tickNo >= t0 + 12) return res(last); // 0.4 s of game time after it appeared
      } else if (t0 >= 0) return res(last); // went off first
      requestAnimationFrame(f);
    };
    f();
  }));
  const aimFlat = () => p.evaluate(() => { const g = window.__sz.game; g.input.yaw = 0; g.input.pitch = 0.1; });
  await aimFlat();
  const w1 = watchFlight();
  await p.mouse.down();
  await p.mouse.up(); // a tap
  const weak = await w1;
  check('a tap throws a short lob (frag used up)', weak >= 0 && weak < 6 && (await state()).gn === '0,1,1', `${weak.toFixed(1)} m`);
  await p.waitForFunction(() => window.__sz.game.grenades.flight.size === 0, null, { timeout: 30000 });
  const s5 = await state();
  check('with none left the weapon comes back', s5.eq === -1 && s5.wname !== 'HE Grenade' && s5.vmKnife, JSON.stringify(s5));

  await p.keyboard.press('KeyC');
  await p.waitForFunction(() => window.__sz.game.nadeHold.eq === 1);
  await aimFlat();
  const w2 = watchFlight();
  await p.mouse.down();
  await p.waitForFunction(() => window.__sz.game.nadeHold.charge > 0.99);
  await p.mouse.up();
  const strong = await w2;
  check('a full charge throws much farther than a tap', strong > weak * 2, `${weak.toFixed(1)} m vs ${strong.toFixed(1)} m`);
  await p.waitForFunction(() => window.__sz.game.grenades.flight.size === 0, null, { timeout: 30000 });

  await p.keyboard.press('KeyV');
  await p.waitForFunction(() => window.__sz.game.nadeHold.eq === 2);
  await p.keyboard.press('KeyV');
  await p.waitForFunction(() => window.__sz.game.nadeHold.eq === -1);
  check('pressing the same key again puts the grenade away', true);
  await p.keyboard.press('KeyV');
  await p.waitForFunction(() => window.__sz.game.nadeHold.eq === 2);
  await p.keyboard.press('Digit1');
  await p.waitForFunction(() => window.__sz.game.nadeHold.eq === -1);
  check('a weapon key puts the grenade away', true);
  check('no JS errors', errors.length === 0, errors.join('; '));
} catch (e) {
  check('e2e run', false, e.stack || String(e));
}
await browser.close();
done();
