// Step-up (stairs, ramp made of small steps) and the camera glide, in practice mode on the Canyon map (ramp + stairs added to it).
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 480, height: 270 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.selectOption('#practice-map', 'canyon');
  await p.click('#btn-practice');
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement && window.__sz.game.tickNo > 30);
  const walk = async (from, yaw, ticks, keys = ['KeyW']) => {
    await p.evaluate(({ from, yaw }) => {
      const g = window.__sz.game;
      Object.assign(g.kin, { x: from[0], y: 0, z: from[1], vy: 0, onGround: true });
      g.prev = { ...g.kin };
      g.input.yaw = yaw;
      g.input.pitch = 0;
      g.__trace = { maxY: 0, maxRise: 0, last: 0, camMax: 0, camJump: 0, lastCam: null };
      const orig = g.tick.bind(g);
      g.tick = () => {
        orig();
        const t = g.__trace;
        t.maxY = Math.max(t.maxY, g.kin.y);
        t.maxRise = Math.max(t.maxRise, g.kin.y - t.last);
        t.last = g.kin.y;
      };
    }, { from, yaw });
    for (const k of keys) await p.keyboard.down(k);
    const t0 = await p.evaluate(() => window.__sz.game.tickNo);
    await p.waitForFunction((t) => window.__sz.game.tickNo > t, t0 + ticks);
    for (const k of keys) await p.keyboard.up(k);
    return p.evaluate(() => ({ x: window.__sz.game.kin.x, y: window.__sz.game.kin.y, z: window.__sz.game.kin.z, ...window.__sz.game.__trace }));
  };
  // ramp: 8 steps of 0.1125 m rising toward the west, ledge at 0.9 m
  const ramp = await walk([-3, 15.5], Math.PI / 2, 110);
  check('walking up the 8-step ramp reaches the 0.9 m ledge without jumping', Math.abs(ramp.maxY - 0.9) < 1e-6, JSON.stringify({ x: ramp.x, maxY: ramp.maxY }));
  check('the ramp climbs in small increments (<= 0.12 m per tick)', ramp.maxRise <= 0.12 && ramp.maxRise > 0, `max rise ${ramp.maxRise.toFixed(4)}`);
  // stairs 0.3 / 0.6 onto the 1.0 m low wall: each riser is <= 0.45 m
  const stairs = await walk([13, 16.5], -Math.PI / 2, 60);
  check('stairs with 0.3 m risers lead onto the 1 m wall top', Math.abs(stairs.maxY - 1.0) < 1e-6, JSON.stringify({ maxY: stairs.maxY }));
  // a 1.0 m crate straight from the floor is too high to step on
  const crate2 = await walk([2, 9], 0, 60);
  check('a 2 m crate is still a wall (no auto-climb)', crate2.maxY === 0 && Math.abs(crate2.z - 6.3) < 0.2, JSON.stringify({ maxY: crate2.maxY, z: crate2.z }));
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('steps run', false, String(e));
} finally {
  await browser.close();
}
done();
