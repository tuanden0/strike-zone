// Players are solid: practice dummies, and two real browsers in one room walking into each other. Needs a running server.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
const ROOM = `Collide ${Date.now()}`;

try {
  // ---- practice: walk into the static dummy at (0, -3)
  const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.click('#btn-practice');
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement);
  await p.waitForFunction(() => window.__sz.game.tickNo > 30);
  await p.evaluate(() => { const g = window.__sz.game; g.kin.x = 0; g.kin.z = 1.5; g.input.yaw = 0; g.input.pitch = 0; });
  await p.keyboard.down('KeyW');
  const t0 = await p.evaluate(() => window.__sz.game.tickNo);
  await p.waitForFunction((t) => window.__sz.game.tickNo > t + 60, t0);
  await p.keyboard.up('KeyW');
  const z = await p.evaluate(() => window.__sz.game.kin.z);
  check('you cannot walk through a practice dummy (stops a body width in front of it)', z > -3 + 0.59 && z < -3 + 0.8, `z=${z.toFixed(3)} (dummy at -3)`);
  // a dead dummy is not an obstacle
  await p.evaluate(() => { const t = window.__sz.game.mode.targets[3]; t.alive = false; t.respawnAt = 1e9; });
  await p.keyboard.down('KeyW');
  const t1 = await p.evaluate(() => window.__sz.game.tickNo);
  await p.waitForFunction((t) => window.__sz.game.tickNo > t + 30, t1);
  await p.keyboard.up('KeyW');
  check('a dead dummy can be walked over', (await p.evaluate(() => window.__sz.game.kin.z)) < -3.2);

  // ---- online: Alice walks into Bob, who stands still. Both see a stop, and Alice's prediction matches the server.
  async function open(nick) {
    const pg = await browser.newPage({ viewport: { width: 480, height: 300 } });
    pg.setDefaultTimeout(240000);
    watchErrors(pg, errors);
    await pg.goto(BASE);
    await pg.waitForFunction(() => window.__sz && window.__sz.map);
    await pg.fill('#nick', nick);
    await pg.click('#btn-online');
    await pg.waitForSelector('#screen-lobby:not([hidden])');
    return pg;
  }
  const a = await open('Alice');
  const b = await open('Bob');
  await a.fill('#c-name', ROOM);
  await a.selectOption('#pref-team', 'A');
  await a.click('#create-form button[type=submit]');
  await a.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  await b.selectOption('#pref-team', 'A'); // same team: nobody shoots
  const row = b.locator('#room-body tr', { hasText: ROOM });
  await row.waitFor();
  await row.locator('button').click();
  await b.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  for (const pg of [a, b]) {
    await pg.click('#btn-resume');
    await pg.waitForFunction(() => document.pointerLockElement);
  }
  await a.waitForFunction(() => window.__sz.game.remotes.size === 1 && window.__sz.game.mode.me && window.__sz.game.mode.me.a);
  await b.waitForFunction(() => window.__sz.game.mode.me && window.__sz.game.mode.me.a);
  // spawns are a few metres apart (same team): face Bob and walk until blocked, re-aiming every 100 ms
  const bobAt = await b.evaluate(() => ({ x: window.__sz.game.kin.x, z: window.__sz.game.kin.z }));
  const steer = async () => a.evaluate((t) => { const g = window.__sz.game; g.input.yaw = Math.atan2(-(t.x - g.kin.x), -(t.z - g.kin.z)); g.input.pitch = 0; return Math.hypot(t.x - g.kin.x, t.z - g.kin.z); }, bobAt);
  await a.keyboard.down('KeyW');
  let dist = 99;
  const until = Date.now() + 300000; // software GL runs the game slowly: wait on state, not on a fixed number of steps
  while (dist > 0.7 && Date.now() < until) {
    dist = await steer();
    await a.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  }
  const t2 = await a.evaluate(() => window.__sz.game.tickNo);
  await a.waitForFunction((t) => window.__sz.game.tickNo > t + 45, t2); // keep pushing against him
  dist = await steer();
  await a.keyboard.up('KeyW');
  check('Alice walking into Bob stops against him (a body width apart, not inside)', dist > 0.55 && dist < 1.0, `distance ${dist.toFixed(2)} m`);
  const me = await a.evaluate(() => ({ x: window.__sz.game.kin.x, z: window.__sz.game.kin.z, sx: window.__sz.game.mode.me.x, sz: window.__sz.game.mode.me.z }));
  check('the server agrees with her predicted position (within 15 cm)', Math.hypot(me.x - me.sx, me.z - me.sz) < 0.15, JSON.stringify(me));
  check('Bob did not move', Math.hypot((await b.evaluate(() => window.__sz.game.kin.x)) - bobAt.x, (await b.evaluate(() => window.__sz.game.kin.z)) - bobAt.z) < 0.01);
  check('no JS errors', errors.length === 0, errors.join('; '));
} catch (e) {
  check('e2e run', false, e.stack || String(e));
}
await browser.close();
done();
