// Phone emulation: touch stick / look / buttons in practice, then drop + pick up a weapon online on the crossroads map.
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = process.env.SHOTS_DIR || '';
const browser = await launch();
const errors = [];
const W = 800;
const H = 360;

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  watchErrors(page, errors);
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${BASE}/?touch=1`);
  await page.waitForFunction(() => window.__sz && window.__sz.map);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  return { page, touch };
}
// force: skip Playwright's "element is stable" wait, which never settles on the pulsing USE button
const tap = (page, sel) => page.tap(sel, { force: true });
const sz = (page, fn, arg) => page.evaluate(fn, arg);

try {
  const { page: p, touch } = await phone();
  check('touch mode detected', await sz(p, () => document.body.classList.contains('touch') && window.__sz.input.touch));
  check('quality defaults to low on touch', await sz(p, () => window.__sz.game === null || window.__sz.game.quality === 'low') && (await p.inputValue('#quality')) === 'low');
  await p.fill('#nick', 'Phone');
  await tap(p, '#btn-practice');
  await p.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  await tap(p, '#btn-resume');
  await p.waitForFunction(() => window.__sz.input.locked && !document.getElementById('touch').hidden);
  check('Resume shows touch controls without pointer lock', await sz(p, () => !document.pointerLockElement && !document.getElementById('touch').hidden));
  await p.waitForFunction(() => window.__sz.game.tickNo > 20);

  // page zoom must be impossible: CSS touch-action, JS guards, 16 px inputs, and rapid FIRE taps leave the scale at 1
  const zoom = await p.evaluate(() => {
    const ta = (el) => getComputedStyle(el).touchAction;
    const prevented = (make) => { const e = make(); document.body.dispatchEvent(e); return e.defaultPrevented; };
    const canvas = document.getElementById('view');
    const touch = (id) => new Touch({ identifier: id, target: canvas, clientX: 100 + id * 50, clientY: 100 });
    return {
      html: ta(document.documentElement), body: ta(document.body), layer: ta(document.getElementById('touch')), menu: ta(document.getElementById('screen-pause')),
      gesture: prevented(() => new Event('gesturestart', { cancelable: true, bubbles: true })),
      dbl: prevented(() => new MouseEvent('dblclick', { cancelable: true, bubbles: true })),
      pinch: (() => { const e = new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [touch(1), touch(2)], targetTouches: [touch(1), touch(2)], changedTouches: [touch(2)] }); canvas.dispatchEvent(e); return e.defaultPrevented; })(),
      input: getComputedStyle(document.getElementById('nick')).fontSize,
    };
  });
  check('touch-action none on page + controls, pan-y on menus', zoom.html === 'none' && zoom.body === 'none' && zoom.layer === 'none' && zoom.menu === 'pan-y', JSON.stringify(zoom));
  check('pinch / double-tap / gesture events are cancelled', zoom.gesture && zoom.dbl && zoom.pinch);
  check('inputs are 16 px (no iOS focus zoom)', zoom.input === '16px', zoom.input);
  for (let i = 0; i < 12; i++) await p.tap('#t-fire', { force: true });
  check('12 rapid FIRE taps: page scale stays 1 and the HUD is still reachable', await p.evaluate(() => (!window.visualViewport || window.visualViewport.scale === 1) && window.__sz.input.locked && !document.getElementById('touch').hidden));

  // Left thumb: drag the stick up -> walk forward.
  const z0 = await sz(p, () => ({ x: window.__sz.game.kin.x, z: window.__sz.game.kin.z }));
  await touch('touchStart', [[100, 250, 1]]);
  await touch('touchMove', [[100, 190, 1]]);
  await p.waitForFunction((o) => Math.hypot(window.__sz.game.kin.x - o.x, window.__sz.game.kin.z - o.z) > 1.5, z0);
  check('stick moves the player', true);
  const mv = await sz(p, () => ({ ...window.__sz.input.mv }));
  check('stick forward gives f=1,s=0', mv.f === 1 && mv.s === 0, JSON.stringify(mv));
  await touch('touchEnd', []);
  check('releasing the stick stops input', await sz(p, () => window.__sz.input.mv.f === 0 && window.__sz.input.mv.s === 0));

  // Right thumb: drag to look.
  const yaw0 = await sz(p, () => window.__sz.input.yaw);
  await touch('touchStart', [[600, 150, 2]]);
  await touch('touchMove', [[680, 150, 2]]);
  await touch('touchEnd', []);
  const yaw1 = await sz(p, () => window.__sz.input.yaw);
  check('dragging right half turns the view', Math.abs(yaw1 - yaw0) > 0.1, `${yaw0.toFixed(3)} -> ${yaw1.toFixed(3)}`);

  // Fire button (hold with one finger while another looks).
  const m0 = await sz(p, () => window.__sz.game.loadout.mag[0]);
  await tap(p, '#t-fire');
  await p.waitForFunction((a) => window.__sz.game.loadout.mag[0] < a, m0);
  check('FIRE button shoots exactly via touch (no double fire from synthesized mouse)', await sz(p, (a) => a - window.__sz.game.loadout.mag[0] <= 2, m0));

  // Weapon slot tap, jump, reload.
  const slot = await p.locator('#weapon-slots span').nth(1).boundingBox();
  await touch('touchStart', [[slot.x + slot.width / 2, slot.y + slot.height / 2, 3]]);
  await touch('touchEnd', []);
  await p.waitForFunction(() => window.__sz.game.loadout.cur === 1);
  check('tapping a weapon slot switches weapon', true);
  await touch('touchStart', [[W - 100, 150, 4]]); // sanity: touching the look area while firing finger is free
  await touch('touchEnd', []);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await p.screenshot({ path: `${SHOTS}/mobile_hud.jpg`, type: 'jpeg', quality: 80 });
  }

  // Menu button -> pause overlay -> resume again.
  await tap(p, '#t-menu');
  await p.waitForSelector('#screen-pause:not([hidden])');
  check('menu button pauses', await sz(p, () => document.getElementById('touch').hidden && !window.__sz.input.locked));
  await tap(p, '#btn-resume');
  await p.waitForFunction(() => window.__sz.input.locked);
  check('resume works again', true);

  // ---- online (fresh phone): drop and pick up a weapon on the crossroads map ----
  const { page: q } = await phone();
  await q.fill('#nick', 'Phone2');
  await q.tap('#btn-online');
  await q.waitForSelector('#screen-lobby:not([hidden])');
  await q.fill('#c-name', 'Phone Room');
  await q.selectOption('#c-map', 'crossroads');
  await q.tap('#create-form button[type=submit]');
  await q.waitForFunction(() => window.__sz.game && window.__sz.game.running && window.__sz.game.mapId === 'crossroads');
  check('joined a crossroads room', true);
  await tap(q, '#btn-resume');
  await q.waitForFunction(() => window.__sz.input.locked && window.__sz.game.tickNo > 20 && window.__sz.game.mode.me);
  check('weapon pickups known on crossroads', await sz(q, () => window.__sz.game.pickups.items.size > 0));
  await tap(q, '#t-drop');
  await q.waitForFunction(() => window.__sz.game.mode.me.has[0] === false);
  check('DROP button drops the rifle', true);
  await q.waitForFunction(() => window.__sz.game.pickups.nearest && document.getElementById('t-use').classList.contains('hot'));
  check('dropped weapon in reach: prompt shown and USE button highlighted', await sz(q, () => document.getElementById('prompt').textContent.includes('tap USE')));
  if (SHOTS) await q.screenshot({ path: `${SHOTS}/mobile_pickup.jpg`, type: 'jpeg', quality: 80 });
  await tap(q, '#t-use');
  await q.waitForFunction(() => window.__sz.game.mode.me.has[0] === true);
  check('USE button picks the weapon back up', true);

  // Portrait shows the rotate hint.
  await q.setViewportSize({ width: 360, height: 800 });
  check('portrait shows rotate hint', await sz(q, () => getComputedStyle(document.getElementById('t-rotate')).display !== 'none'));
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('mobile run', false, String(e));
} finally {
  await browser.close();
}
done();
