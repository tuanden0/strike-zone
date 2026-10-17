// Bullet holes / blood decals and the crossroads map in practice mode (desktop). Needs a running server.
//   E2E_QUALITY=high node extras.mjs [outDir]    (outDir optional: saves screenshots)
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [];
const settle = (p, n = 6) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const snap = async (p, name) => { if (out) { await settle(p); await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 }); } };

async function practice(mapId) {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.selectOption('#practice-map', mapId);
  await p.click('#btn-practice');
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement);
  await p.waitForFunction(() => window.__sz.game.tickNo > 30);
  return p;
}

try {
  // ---- yard: holes on wall/floor/crate, blood on a dummy ----
  const p = await practice('yard');
  check('yard map selected', await p.evaluate(() => window.__sz.game.mapId === 'yard'));
  const r = await p.evaluate(() => {
    const g = window.__sz.game, m = g.mode;
    for (const t of m.targets) t.mx = 0;
    const aim = (x, y, z) => { const e = g.eye(); return { yaw: Math.atan2(-(x - e[0]), -(z - e[2])), pitch: Math.atan2(y - e[1], Math.hypot(x - e[0], z - e[2])) }; };
    const fire = (pt, n) => { const a = aim(...pt); for (let i = 0; i < n; i++) m.fire(a, g); };
    g.loadout.cur = 0;
    g.kin.x = -3; g.kin.z = -9;
    for (let i = 0; i < 10; i++) fire([-7.5, 1.2 + (i % 4) * 0.35, -9 + (i % 5) * 0.4 - 1], 1); // divider wall
    const wall = g.decals.holes.count;
    g.kin.x = 0; g.kin.z = -3;
    for (let i = 0; i < 6; i++) fire([-1 + i * 0.4, 0, -5], 1); // floor
    const floor = g.decals.holes.count - wall;
    const t = m.targets[3]; t.alive = true; t.hp = 1e9;
    g.kin.x = 0; g.kin.z = -9.6;
    for (let i = 0; i < 3; i++) fire([t.px, 1.2, t.pz], 1);
    return { wall, floor, blood: g.decals.splats[0].count + g.decals.splats[1].count };
  });
  check('bullet holes appear on walls', r.wall >= 8, JSON.stringify(r));
  check('bullet holes appear on the floor', r.floor >= 4, JSON.stringify(r));
  check('blood splats appear when a dummy is hit', r.blood >= 1, JSON.stringify(r));
  await p.evaluate(() => { const g = window.__sz.game; g.debugCam = { pos: [-5.6, 1.6, -9.2], look: [-7.5, 1.5, -9.5] }; for (const q of g.puffs) q.visible = false; });
  await snap(p, 'decals_wall');
  await p.evaluate(() => { window.__sz.game.debugCam = { pos: [1.8, 1.7, -6.6], look: [0, 0.2, -3.2] }; });
  await snap(p, 'decals_blood');

  // ---- sniper + scope (practice gives it; online it is pickup-only) ----
  const sn = await p.evaluate(() => { const g = window.__sz.game; return { n: g.spec.weapons.length, has: g.loadout.has.slice(), fov: g.camera.fov }; });
  check('four weapons, sniper available in practice', sn.n === 4 && sn.has[3] === true, JSON.stringify(sn));
  await p.evaluate(() => { const g = window.__sz.game; g.debugCam = null; g.kin.x = 0; g.kin.z = -20; g.input.yaw = 0; g.input.pitch = 0; });
  await p.keyboard.press('Digit4');
  await p.waitForFunction(() => window.__sz.game.loadout.cur === 3 && window.__sz.game.switchT === 0);
  check('key 4 selects the sniper', true);
  await snap(p, 'fp_sniper');
  await p.mouse.down({ button: 'right' });
  await p.waitForFunction(() => window.__sz.game.scoped && window.__sz.game.camera.fov < 14.5);
  const sc = await p.evaluate(() => { const g = window.__sz.game; return { fov: g.camera.fov, sens: g.input.sensScale, overlay: !document.getElementById('scope').hidden, cross: getComputedStyle(document.getElementById('crosshair')).display, vm: g.vm[3].visible }; });
  check('right mouse zooms: fov narrows, overlay shown, crosshair + viewmodel hidden', sc.fov < 20 && sc.overlay && sc.cross === 'none' && !sc.vm, JSON.stringify(sc));
  check('look sensitivity drops while zoomed', sc.sens < 0.3, `x${sc.sens.toFixed(3)}`);
  await snap(p, 'scope_view');
  const ammo = await p.evaluate(() => window.__sz.game.loadout.mag[3]);
  await p.mouse.click(480, 270, { button: 'left' });
  await p.waitForFunction((a) => window.__sz.game.loadout.mag[3] < a, ammo);
  check('scoped shot fires', true);
  await p.mouse.up({ button: 'right' });
  await p.waitForFunction(() => !window.__sz.game.scoped && Math.abs(window.__sz.game.camera.fov - 78) < 0.5);
  check('releasing right mouse restores the view', await p.evaluate(() => document.getElementById('scope').hidden && window.__sz.input.sensScale > 0.99));
  // third person: a dummy holding the sniper (attached to the rifle's hand slot; must look held, not floating)
  await p.evaluate(() => { const g = window.__sz.game; const t = g.mode.targets[5]; t.alive = true; t.mx = 0; g.debugCam = { pos: [t.px + 1.6, 1.5, t.pz + 2.2], look: [t.px, 1.1, t.pz] }; });
  await snap(p, 'tp_sniper');
  await p.evaluate(() => { const g = window.__sz.game; const t = g.mode.targets[5]; g.debugCam = { pos: [t.px + 2.4, 1.3, t.pz - 0.4], look: [t.px, 1.2, t.pz - 0.4] }; });
  await snap(p, 'tp_sniper_side');
  await p.close();

  // ---- crossroads ----
  const q = await practice('crossroads');
  check('crossroads map selected', await q.evaluate(() => window.__sz.game.mapId === 'crossroads'));
  const spawns = await q.evaluate(() => { const g = window.__sz.game; return { x: g.kin.x, z: g.kin.z, boxes: g.map.boxes.length }; });
  check('player spawned inside the crossroads arena', Math.abs(spawns.x) < 60 && Math.abs(spawns.z) < 60 && spawns.boxes > 50, JSON.stringify(spawns));
  await q.evaluate(() => { window.__sz.game.debugCam = { pos: [0, 2.2, 28], look: [0, 1.6, 0] }; });
  await snap(q, 'crossroads_game');
  await q.evaluate(() => { window.__sz.game.debugCam = { pos: [-40, 30, 40], look: [0, 0, 0] }; });
  await snap(q, 'crossroads_overview');
  await q.close();
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('extras run', false, String(e));
} finally {
  await browser.close();
}
done();
