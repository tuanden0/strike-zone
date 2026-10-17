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
// menu buttons: under software GL a touch tap can be acknowledged late and then retried against an element that already hid
// (the first tap worked); a DOM click is the same handler without that race
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const sz = (page, fn, arg) => page.evaluate(fn, arg);
const wait = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms); // real time on purpose: the hold-to-fire window is 300 ms
const mag = (page, w = 0) => sz(page, (i) => window.__sz.game.loadout.mag[i], w);
const ticks = (page, n) => page.evaluate((n) => new Promise((r) => { const t = window.__sz.game.tickNo; const f = () => (window.__sz.game.tickNo >= t + n ? r() : requestAnimationFrame(f)); f(); }), n);

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
  check('gesture + double-tap events are cancelled; two-finger touches are left alone (CSS touch-action stops the pinch, and the two thumbs must not be cancelled)', zoom.gesture && zoom.dbl && zoom.pinch === false);
  check('inputs are 16 px (no iOS focus zoom)', zoom.input === '16px', zoom.input);
  check('the old FIRE buttons are gone (fire lives in the aim control)', await sz(p, () => !document.getElementById('t-fire') && !document.getElementById('t-fire2')));
  for (let i = 0; i < 12; i++) await p.touchscreen.tap(560, 150); // rapid taps on the aim zone must not zoom the page
  check('12 rapid taps on the aim zone: page scale stays 1 and the HUD is still reachable', await p.evaluate(() => (!window.visualViewport || window.visualViewport.scale === 1) && window.__sz.input.locked && !document.getElementById('touch').hidden));

  // DUCK button toggles the crouch stance
  await tap(p, '#t-crouch');
  await p.waitForFunction(() => window.__sz.input.crouchHeld === true && window.__sz.game.kin.crouch === true);
  await tap(p, '#t-crouch');
  await p.waitForFunction(() => window.__sz.game.kin.crouch === false);
  check('DUCK button toggles crouch on and off', true);

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

  // Right thumb = aim stick: hold right of the touch point -> the view keeps turning right; release -> it stops.
  const sampleYaw = () => sz(p, () => window.__sz.input.yaw);
  await sz(p, () => { window.__sz.input.touchUi.holdMs = 2500; }); // pure steering tests: no hold-fire however late the browser delivers the touch
  await p.waitForFunction(() => window.__sz.game.punch < 1e-4 && window.__sz.game.sinceFire > 0.5); // earlier test taps leave view recoil that recovers over time
  const y0 = await sampleYaw();
  await touch('touchStart', [[600, 200, 5]]);
  await touch('touchMove', [[670, 200, 5]]);
  await p.waitForFunction((y) => Math.abs(window.__sz.input.yaw - y) > 0.6, y0);
  const yHeld = await sampleYaw();
  await p.waitForFunction((y) => Math.abs(window.__sz.input.yaw - y) > 0.3, yHeld);
  check('holding the aim stick right keeps turning the view right (yaw decreases)', (await sampleYaw()) < y0 - 0.9, `${y0.toFixed(2)} -> ${(await sampleYaw()).toFixed(2)}`);
  const p0 = await sz(p, () => window.__sz.input.pitch);
  await touch('touchMove', [[600, 140, 5]]);
  await p.waitForFunction((v) => window.__sz.input.pitch > v + 0.25, p0);
  check('pushing the aim stick up looks up', true);
  await touch('touchEnd', []);
  const yEnd = await sampleYaw();
  const pEnd = await sz(p, () => window.__sz.input.pitch);
  await ticks(p, 20); // game ticks, not milliseconds: software GL renders about one frame a second, so 700 ms could be zero frames
  check('releasing the aim stick stops the turn', (await sampleYaw()) === yEnd && (await sz(p, () => window.__sz.input.pitch)) === pEnd);
  await touch('touchStart', [[600, 200, 6]]);
  await touch('touchMove', [[606, 200, 6]]); // a 6 px nudge sits in the dead zone: no creeping
  await ticks(p, 15);
  check('a tiny nudge (dead zone) does not turn the view', (await sampleYaw()) === yEnd);
  await touch('touchEnd', []);
  await ticks(p, 10); // the nudge above ended as a tap: let its shot (and recoil) happen before the ammo is reset
  await p.waitForFunction(() => window.__sz.game.punch < 1e-4 && window.__sz.game.sinceFire > 0.5);
  await sz(p, () => { window.__sz.game.loadout.mag[0] = 30; window.__sz.input.touchUi.holdMs = 2500; }); // taps/steers must not turn into a hold when the browser delivers the touch late
  // Aim control = fire: a short tap shoots exactly once (no double fire from the synthesized mouse events), the ring flashes
  await touch('touchStart', [[600, 200, 7]]);
  await touch('touchEnd', []);
  await p.waitForFunction(() => window.__sz.game.loadout.mag[0] < 30);
  await ticks(p, 12);
  check('a tap on the right half fires exactly one shot', (await mag(p)) === 29, `mag ${await mag(p)}`);
  check('a tap leaves no sticky fire state', await sz(p, () => !window.__sz.input.mouseDown && !document.getElementById('t-lstick').classList.contains('fire')));
  // rapid repeated taps = repeated shots
  for (let i = 0; i < 4; i++) {
    await touch('touchStart', [[600, 200, 8 + i]]);
    await touch('touchEnd', []);
    await ticks(p, 5);
  }
  await ticks(p, 5);
  check('four quick taps fire four shots', (await mag(p)) === 25, `mag ${await mag(p)}`);
  // a tap that leaves the dead zone is a steer, not a shot
  const y1 = await sampleYaw();
  await sz(p, () => { window.__sz.input.touchUi.holdMs = 300; }); // the real hold window, so that the check below can fail
  await touch('touchStart', [[600, 200, 20]]);
  await touch('touchMove', [[670, 200, 20]]);
  await p.waitForFunction((y) => Math.abs(window.__sz.input.yaw - y) > 0.2, y1);
  await wait(p, 450); // well past the 300 ms hold window
  check('pushing out of the dead zone steers and never fires', (await mag(p)) === 25 && (await sz(p, () => !window.__sz.input.mouseDown)), `mag ${await mag(p)}`);
  await touch('touchEnd', []);
  await ticks(p, 6);
  check('lifting a steering finger does not shoot', (await mag(p)) === 25);
  // hold still in the dead zone: auto-fire engages after ~300 ms, ring turns red
  await sz(p, () => { window.__sz.input.touchUi.holdMs = 300; });
  await touch('touchStart', [[600, 200, 21]]);
  await p.waitForFunction(() => window.__sz.input.mouseDown && document.getElementById('t-lstick').classList.contains('fire'));
  await p.waitForFunction(() => window.__sz.game.loadout.mag[0] <= 22);
  check('holding still in the dead zone auto-fires and the aim ring turns red', true);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await p.screenshot({ path: `${SHOTS}/touch_aim_fire.jpg`, type: 'jpeg', quality: 80 });
  }
  // keeps firing while steering, until the finger lifts
  const yh = await sampleYaw();
  await touch('touchMove', [[670, 200, 21]]);
  await p.waitForFunction((y) => Math.abs(window.__sz.input.yaw - y) > 0.3, yh);
  const mh = await mag(p);
  await p.waitForFunction((m) => window.__sz.game.loadout.mag[0] < m, mh);
  check('auto-fire stays on while the thumb then steers', await sz(p, () => window.__sz.input.mouseDown));
  await touch('touchEnd', []);
  await p.waitForFunction(() => !window.__sz.input.mouseDown && !document.getElementById('t-lstick').classList.contains('fire'));
  await ticks(p, 6);
  const mEnd = await mag(p);
  await ticks(p, 10);
  check('lifting the thumb stops the fire', (await mag(p)) === mEnd);
  await sz(p, () => { window.__sz.input.touchUi.holdMs = 2500; });
  // semi-auto pistol: every tap is its own shot (server edge detection)
  await sz(p, () => { window.__sz.game.loadout.cur = 1; window.__sz.game.loadout.nextFire = 0; window.__sz.game.loadout.mag[1] = 12; });
  for (let i = 0; i < 3; i++) {
    await touch('touchStart', [[600, 200, 30 + i]]);
    await touch('touchEnd', []);
    await ticks(p, 8);
  }
  check('three taps with the semi-auto pistol fire three shots', (await mag(p, 1)) === 9, `mag ${await mag(p, 1)}`);
  await sz(p, () => { window.__sz.game.loadout.cur = 0; window.__sz.game.loadout.nextFire = 0; });
  // Swipe mode (pause menu option) still available
  await sz(p, () => window.__sz.input.touchUi.setMode('drag'));

  // Right thumb: drag to look.
  const yaw0 = await sz(p, () => window.__sz.input.yaw);
  const swipeMag = await mag(p);
  await touch('touchStart', [[600, 150, 2]]);
  await touch('touchMove', [[680, 150, 2]]);
  await touch('touchEnd', []);
  const yaw1 = await sz(p, () => window.__sz.input.yaw);
  check('swipe mode: dragging the right half turns the view', Math.abs(yaw1 - yaw0) > 0.1, `${yaw0.toFixed(3)} -> ${yaw1.toFixed(3)}`);
  await ticks(p, 6);
  check('swipe mode: a drag does not shoot', (await mag(p)) === swipeMag);
  const tm = await mag(p);
  await touch('touchStart', [[600, 150, 3]]);
  await touch('touchEnd', []);
  await p.waitForFunction((m) => window.__sz.game.loadout.mag[0] < m, tm);
  check('swipe mode: a tap shoots too', true);
  await sz(p, () => window.__sz.input.touchUi.setMode('stick'));

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
  await click(p, '#btn-resume');
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
  await click(q, '#btn-resume');
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
