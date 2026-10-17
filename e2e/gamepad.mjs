// Gamepad: a fake standard-mapping pad (navigator.getGamepads overridden) drives move, aim rate, fire, jump, crouch, weapons,
// scope, grenades, pause / resume in pad mode, scoreboard; a pad inside its dead zone does nothing. Practice mode.
//   BASE_URL=http://localhost:18081 SHOTS_DIR=../docs/screenshots node gamepad.mjs
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await launch();
const errors = [];

const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(240000);
watchErrors(page, errors);
await page.addInitScript(() => {
  // standard layout: 17 buttons, 4 axes. The test mutates window.__pad; __padOn plugs it in / out.
  window.__pad = { id: 'Fake Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__padOn = false;
  navigator.getGamepads = () => [window.__padOn ? window.__pad : null, null, null, null];
});
await page.goto(BASE);
await page.waitForFunction(() => window.__sz && window.__sz.assets && !document.getElementById('btn-practice').disabled);

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const set = (patch) => page.evaluate((p) => {
  const pad = window.__pad;
  if (p.axes) p.axes.forEach((v, i) => { if (v !== null) pad.axes[i] = v; });
  for (const [i, v] of Object.entries(p.btn || {})) pad.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v };
}, patch);
const press = (n) => set({ btn: { [BTN[n]]: 1 } });
const release = (n) => set({ btn: { [BTN[n]]: 0 } });
const frames = (n = 2) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const ticks = (n) => page.evaluate((n) => new Promise((r) => { const t = window.__sz.game.tickNo; const f = () => (window.__sz.game.tickNo >= t + n ? r() : requestAnimationFrame(f)); f(); }), n);
const g = (fn, arg) => page.evaluate(fn, arg);
// tap a button: held until the pad poll has seen it (poll = animation frame), then released
async function tap(n) {
  await press(n);
  await frames(3);
  await release(n);
  await frames(2);
}

try {
  await page.fill('#nick', 'Pad');
  await page.click('#btn-practice');
  await page.waitForSelector('#screen-pause:not([hidden])');
  await g(() => {
    const gm = window.__sz.game;
    for (const t of gm.mode.targets) { t.mx = 0; t.alive = false; t.respawnAt = 1e9; } // quiet range
    window.__cmds = []; // spy on the commands the game simulates
    const inp = window.__sz.input;
    const orig = inp.sample.bind(inp);
    inp.sample = () => { const c = orig(); window.__cmds.push(c); return c; };
  });
  check('no pad plugged in: no pad hint on the pause screen', await g(() => document.getElementById('pause-pad').hidden));
  await frames(3);
  check('A on the pause screen without a pad does nothing', await g(() => !window.__sz.input.locked));

  // ---- plug in: hint shows; A resumes in pad mode (no Pointer Lock) ----
  await g(() => { window.__padOn = true; });
  await page.waitForFunction(() => !document.getElementById('pause-pad').hidden);
  check('"Gamepad connected" hint on the pause screen', (await g(() => document.getElementById('pause-pad').textContent)).startsWith('Gamepad connected'));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/gamepad_pause.jpg`, type: 'jpeg', quality: 85 });
  await press('A');
  await page.waitForFunction(() => window.__sz.input.locked);
  const lk = await g(() => ({ pad: window.__sz.input.padLocked, pl: !!document.pointerLockElement, pause: document.getElementById('screen-pause').hidden, hud: !document.getElementById('hud').hidden }));
  check('A resumes in pad mode: locked without Pointer Lock, pause screen gone', lk.pad && !lk.pl && lk.pause && lk.hud, JSON.stringify(lk));
  await frames(3);
  await release('A');
  await frames(2);
  await page.waitForFunction(() => window.__sz.game.tickNo > 40);
  check('the resuming A press did not also jump', await g(() => window.__sz.game.kin.y === 0 && !window.__cmds.some((c) => c.jump)));
  const here = () => g(() => ({ x: window.__sz.game.kin.x, z: window.__sz.game.kin.z, yaw: window.__sz.input.yaw, pitch: window.__sz.input.pitch, speed: window.__sz.game.speed, mag: window.__sz.game.loadout.mag[0] }));
  await g(() => { const k = window.__sz.game.kin; const sp = window.__sz.game.map.spawns.A[0]; k.x = sp.x; k.z = sp.z; window.__sz.input.yaw = sp.yaw; window.__sz.input.pitch = 0; window.__cmds.length = 0; });

  // ---- dead zone: tiny stick values do nothing ----
  await set({ axes: [0.1, -0.1, 0.1, 0.1] }); // radial 0.14 < 0.15
  const d0 = await here();
  await ticks(40);
  const d1 = await here();
  check('left + right stick inside the 0.15 dead zone: no movement, no turning', d1.x === d0.x && d1.z === d0.z && d1.yaw === d0.yaw && d1.pitch === d0.pitch, JSON.stringify([d0, d1]));
  check('...and the commands are all zero', await g(() => window.__cmds.length > 30 && window.__cmds.every((c) => c.f === 0 && c.s === 0 && !c.fire && !c.jump && !c.crouch && c.nade === 0 && c.weapon === -1 && !c.reload)));
  await set({ axes: [0.149, 0, 0, -0.149] });
  await ticks(10);
  check('just under the dead zone on one axis: still nothing', await g(() => window.__cmds.slice(-8).every((c) => c.f === 0 && c.s === 0)));

  // ---- left stick: analog move ----
  await set({ axes: [0, -1, 0, 0] });
  const m0 = await here();
  await page.waitForFunction((o) => Math.hypot(window.__sz.game.kin.x - o.x, window.__sz.game.kin.z - o.z) > 2, m0);
  const run = await here();
  check('left stick up runs forward at full speed (f = 1)', Math.abs(run.speed - 5.5) < 0.2 && (await g(() => window.__cmds.slice(-3).every((c) => Math.abs(c.f - 1) < 1e-9 && c.s === 0))), `${run.speed.toFixed(2)} m/s`);
  await set({ axes: [0, -0.5, 0, 0] });
  await ticks(8);
  const half = await here();
  const f = await g(() => window.__cmds[window.__cmds.length - 1].f);
  check('half deflection is analog: slower (dead zone rescaled, f ~ 0.41)', f > 0.3 && f < 0.5 && half.speed > 1.5 && half.speed < 3.2, `f ${f.toFixed(3)} speed ${half.speed.toFixed(2)}`);
  await set({ axes: [1, 0, 0, 0] });
  await ticks(6);
  check('left stick right strafes (s = 1)', await g(() => window.__cmds.slice(-3).every((c) => Math.abs(c.s - 1) < 1e-9 && c.f === 0)));
  await set({ axes: [0, 1, 0, 0] });
  await ticks(6);
  check('left stick down moves back (f = -1)', await g(() => window.__cmds.slice(-3).every((c) => Math.abs(c.f + 1) < 1e-9)));
  await set({ axes: [0, 0, 0, 0] });
  await ticks(4);
  check('centring the stick stops the movement', await g(() => window.__cmds.slice(-2).every((c) => c.f === 0 && c.s === 0)));

  // ---- right stick: aim at a rate ----
  const K = await g(async () => { const m = await import('./js/gamepad.js'); return { yaw: m.PAD_YAW, pitch: m.PAD_PITCH, curve: m.PAD_CURVE }; });
  // software GL runs ~2 fps and the pad clamps one step to 0.1 s, so wall-clock rates would be wrong: measure turn per poll / dt used by that poll
  await g(() => {
    const inp = window.__sz.input;
    const pad = inp.pad;
    const orig = pad.poll.bind(pad);
    window.__aim = [];
    let last = 0;
    pad.poll = (now) => {
      const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
      last = now;
      const y = inp.yaw;
      const p = inp.pitch;
      orig(now);
      window.__aim.push({ dt: dt > 0 ? dt : 0, dyaw: inp.yaw - y, dpitch: inp.pitch - p });
    };
  });
  const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const rate = async (axes) => {
    await g(() => { window.__aim.length = 0; });
    await set({ axes });
    await page.waitForFunction(() => window.__aim.filter((e) => e.dt > 0.02).length >= 6);
    await set({ axes: [0, 0, 0, 0] });
    const log = (await g(() => window.__aim.slice(1))).filter((e) => e.dt > 0.02);
    await frames(2);
    return { yaw: median(log.map((e) => e.dyaw / e.dt)), pitch: median(log.map((e) => e.dpitch / e.dt)) };
  };
  await g(() => { window.__sz.input.pitch = 0; });
  const full = await rate([0, 0, 1, 0]);
  check(`right stick full right turns right at ~${K.yaw} rad/s (yaw decreases)`, full.yaw < 0 && Math.abs(-full.yaw - K.yaw) < K.yaw * 0.2, `${full.yaw.toFixed(2)} rad/s`);
  const halfAim = await rate([0, 0, 0.5, 0]);
  const expect = K.yaw * Math.pow((0.5 - 0.15) / 0.85, K.curve);
  check('half deflection turns much slower (power curve): ~22 % of full', halfAim.yaw < 0 && Math.abs(-halfAim.yaw - expect) < expect * 0.3 + 0.05, `${halfAim.yaw.toFixed(2)} vs ${-expect.toFixed(2)}`);
  const up = await rate([0, 0, 0, -1]);
  check(`right stick up looks up at ~${K.pitch} rad/s`, Math.abs(up.pitch - K.pitch) < K.pitch * 0.25, `${up.pitch.toFixed(2)} rad/s`);
  await g(() => { window.__sz.input.pitch = 0; window.__sz.input.setSens(0.0044); }); // twice the default sensitivity
  const fast = await rate([0, 0, 1, 0]);
  check('the sensitivity slider scales the stick (2x sens = 2x rate)', Math.abs(fast.yaw / full.yaw - 2) < 0.4, `${fast.yaw.toFixed(2)} / ${full.yaw.toFixed(2)}`);
  await g(() => { window.__sz.input.setSens(0.0022); });

  // ---- jump, crouch ----
  await press('A');
  await page.waitForFunction(() => window.__sz.game.kin.y > 0.3);
  await release('A');
  await page.waitForFunction(() => window.__sz.game.kin.onGround);
  check('A jumps', true);
  await press('B');
  await page.waitForFunction(() => window.__sz.game.kin.crouch === true);
  check('B crouches while held', true);
  await release('B');
  await page.waitForFunction(() => window.__sz.game.kin.crouch === false);
  check('releasing B stands up', true);

  // ---- fire (RT, analog value) ----
  const a0 = (await here()).mag;
  await set({ btn: { [BTN.RT]: 0.3 } }); // half pull below the threshold
  await ticks(10);
  check('RT below its threshold does not fire', (await here()).mag === a0);
  await set({ btn: { [BTN.RT]: 1 } });
  await page.waitForFunction((a) => window.__sz.game.loadout.mag[0] <= a - 4, a0);
  check('holding RT auto-fires', true);
  await release('RT');
  await frames(2);
  await ticks(6);
  const stopped = (await here()).mag;
  await ticks(10);
  check('releasing RT stops', (await here()).mag === stopped);
  await set({ btn: { [BTN.RT]: 1 } });
  await frames(1);
  await set({ btn: { [BTN.RT]: 0 } });
  await ticks(10);
  check('a quick RT pull fires at least once (tap flag)', (await here()).mag < stopped);

  // ---- weapons: Y / RB next, LB previous (skips weapons you do not own), X reload ----
  await g(() => { const l = window.__sz.game.loadout; l.cur = 0; l.nextFire = 0; });
  await tap('Y');
  await page.waitForFunction(() => window.__sz.game.loadout.cur === 1);
  await tap('RB');
  await page.waitForFunction(() => window.__sz.game.loadout.cur === 2);
  await tap('LB');
  await page.waitForFunction(() => window.__sz.game.loadout.cur === 1);
  check('Y / RB next weapon, LB previous (rifle > pistol > knife > pistol)', true);
  await g(() => { window.__sz.game.loadout.has[3] = false; });
  await tap('RB'); // knife
  await page.waitForFunction(() => window.__sz.game.loadout.cur === 2);
  await tap('Y'); // sniper not owned: wraps to the rifle
  await page.waitForFunction(() => window.__sz.game.loadout.cur === 0);
  check('next weapon skips one you do not own and wraps around', true);
  await g(() => { window.__sz.game.loadout.has[3] = true; });
  await tap('LB');
  await page.waitForFunction(() => window.__sz.game.loadout.cur === 3);
  check('LB from the rifle wraps to the sniper', true);
  await g(() => { const l = window.__sz.game.loadout; l.nextFire = 0; });
  await page.waitForFunction(() => window.__sz.game.switchT === 0 && window.__sz.game.loadout.nextFire <= window.__sz.game.tickNo);
  await tap('LT');
  await page.waitForFunction(() => window.__sz.game.scoped);
  check('LT toggles the scope on (stays on after release)', await g(() => window.__sz.input.scopeHeld));
  await tap('LT');
  await page.waitForFunction(() => !window.__sz.game.scoped);
  check('LT again leaves the scope', true);
  await g(() => { const l = window.__sz.game.loadout; l.cur = 0; l.nextFire = 0; l.mag[0] = 10; });
  await ticks(5);
  await tap('X');
  await page.waitForFunction(() => window.__sz.game.loadout.reloading || window.__sz.game.loadout.mag[0] > 10);
  check('X reloads', true);

  // ---- grenades (D-pad), drop, use ----
  const seen = (key, val) => g(([k, v]) => window.__cmds.some((c) => c[k] === v), [key, val]);
  await g(() => { window.__cmds.length = 0; });
  await tap('UP');
  await tap('LEFT');
  await tap('RIGHT');
  const nades = await g(() => window.__cmds.map((c) => c.nade).filter((n) => n));
  check('D-pad up / left / right = frag / smoke / flash (nade 1 / 2 / 3)', nades.join() === '1,2,3', nades.join());
  await tap('DOWN');
  check('D-pad down drops the weapon', await seen('drop', true));
  await tap('R3');
  check('R3 = use / pick up', await seen('use', true));

  // ---- Back = scoreboard while held ----
  await press('BACK');
  await page.waitForFunction(() => !document.getElementById('scoreboard').hidden);
  await release('BACK');
  await page.waitForFunction(() => document.getElementById('scoreboard').hidden);
  check('Back shows the scoreboard while held', true);

  // ---- mouse + keyboard still work while pad-locked ----
  const kz = (await here()).z;
  await page.keyboard.down('KeyW');
  await page.waitForFunction((z) => Math.abs(window.__sz.game.kin.z - z) > 1.5, kz);
  await page.keyboard.up('KeyW');
  check('keyboard W moves while playing in pad mode', true);

  // ---- Start pauses, Start / A resumes ----
  await tap('START');
  await page.waitForSelector('#screen-pause:not([hidden])');
  check('Start pauses (pause screen, not locked, hint still shown)', await g(() => !window.__sz.input.locked && !window.__sz.input.padLocked && !document.getElementById('pause-pad').hidden));
  await set({ axes: [0, -1, 0, 0] });
  const p0 = await here();
  await ticks(10);
  check('paused: the stick does not move you', (await here()).z === p0.z);
  await set({ axes: [0, 0, 0, 0] });
  await press('START');
  await page.waitForFunction(() => window.__sz.input.locked);
  await frames(2);
  await release('START');
  check('Start on the pause screen resumes', await g(() => window.__sz.input.padLocked && document.getElementById('screen-pause').hidden));
  await frames(3);
  check('the resuming Start did not pause again', await g(() => window.__sz.input.locked));
  // Esc pauses too (pad mode has no pointer lock to release)
  await page.keyboard.press('Escape');
  await page.waitForSelector('#screen-pause:not([hidden])');
  check('Escape pauses a pad-locked game', await g(() => !window.__sz.input.locked));
  // unplug: hint goes away; unplugging while playing pauses
  await g(() => { window.__padOn = false; });
  await page.waitForFunction(() => document.getElementById('pause-pad').hidden);
  check('unplugging hides the hint', true);
  await g(() => { window.__padOn = true; });
  await page.waitForFunction(() => !document.getElementById('pause-pad').hidden);
  await tap('A');
  await page.waitForFunction(() => window.__sz.input.locked);
  await g(() => { window.__padOn = false; });
  await page.waitForSelector('#screen-pause:not([hidden])');
  check('unplugging the pad while playing with it pauses', await g(() => !window.__sz.input.locked));

  // ---- the old paths still work: Resume button -> Pointer Lock, mouse look only with the lock ----
  await page.click('#btn-resume');
  await page.waitForFunction(() => document.pointerLockElement);
  check('Resume button still gives Pointer Lock (not pad mode)', await g(() => !window.__sz.input.padLocked && window.__sz.input.locked));
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('gamepad run', false, String(e));
} finally {
  await browser.close();
}
done();
