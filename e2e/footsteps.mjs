// Footsteps: surface-specific steps at stride intervals, alternating feet, silent when standing / walking / crouching, landing thuds that
// scale with the fall, steps of other players (positional, ~25 m range). Practice mode, needs a running server.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];

async function practice(mapId) {
  const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.selectOption('#practice-map', mapId);
  await p.click('#btn-practice');
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement);
  await p.waitForFunction(() => window.__sz.game.tickNo > 20);
  await p.evaluate(() => {
    const g = window.__sz.game;
    for (const t of g.mode.targets) { t.mx = 0; t.alive = false; t.respawnAt = 1e9; } // quiet range: no patrolling dummies
    // spy: every footstep / landing call with the tick, the player's position and the options the game passed
    window.__log = [];
    const sfx = window.__sz.sfx;
    const orig = sfx.play.bind(sfx);
    sfx.play = (n, pos, l, o) => { if (n.startsWith('step') || n === 'land') window.__log.push({ n, pos, o: o ? { ...o } : null, tick: g.tickNo, x: g.kin.x, y: g.kin.y, z: g.kin.z }); return orig(n, pos, l, o); };
  });
  return p;
}

// teleport onto a straight, obstacle-free run (>= len m) and face along it
const openRun = (p, len = 18) =>
  p.evaluate(async (len) => {
    const { rayWorld, aimDir } = await import('./js/physics.js');
    const g = window.__sz.game;
    const sp = g.map.spawns.A[0];
    let best = null;
    for (let i = 0; i < 24; i++) {
      const yaw = (i / 24) * Math.PI * 2;
      const d = aimDir(yaw, 0);
      const t = Math.min(rayWorld(g.map, [sp.x, 0.5, sp.z], d, 40), rayWorld(g.map, [sp.x + 0.35, 0.5, sp.z], d, 40), rayWorld(g.map, [sp.x - 0.35, 0.5, sp.z], d, 40));
      if (!best || t > best.t) best = { yaw, t };
    }
    g.kin.x = sp.x; g.kin.z = sp.z; g.kin.y = 0; g.kin.vy = 0;
    g.input.yaw = best.yaw; g.input.pitch = 0;
    window.__log.length = 0;
    return best.t;
  }, len);

const local = (p) => p.evaluate(() => window.__log.filter((e) => !e.pos && e.n.startsWith('step')));
const waitTicks = (p, n) => p.evaluate((n) => new Promise((r) => { const t = window.__sz.game.tickNo; const f = () => (window.__sz.game.tickNo >= t + n ? r() : requestAnimationFrame(f)); f(); }), n);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

try {
  // ---- sand (pyramid): run = steps at stride intervals, alternating feet ----
  const p = await practice('pyramid');
  check('pyramid floor surface is sand', await p.evaluate(() => window.__sz.game.footsteps.floor === 'sand'));
  const room = await openRun(p);
  check('found an open run to test on', room > 14, `${room.toFixed(1)} m`);
  await p.keyboard.down('KeyW');
  await p.waitForFunction(() => window.__log.filter((e) => !e.pos && e.n.startsWith('step')).length >= 5);
  await p.keyboard.up('KeyW');
  const run = await local(p);
  check('running on sand plays step_sand only', run.every((e) => e.n === 'step_sand'), [...new Set(run.map((e) => e.n))].join());
  const gaps = run.slice(1).map((e, i) => dist(e, run[i]));
  check('steps fall one stride (~2.2 m) apart at a run', gaps.length >= 4 && gaps.every((d) => d > 2.1 && d < 2.6), gaps.map((d) => d.toFixed(2)).join(' '));
  check('left / right foot alternate (pitch and pan flip every step)', run.slice(1).every((e, i) => e.o.foot !== run[i].o.foot && Math.sign(e.o.pan) !== Math.sign(run[i].o.pan) && e.o.pitch !== run[i].o.pitch), JSON.stringify(run.map((e) => [e.o.foot, e.o.pan])));
  check('running is full volume', run.every((e) => e.o.gain > 0.99), run.map((e) => e.o.gain.toFixed(2)).join(' '));

  // slower analog speed: shorter stride, quieter
  await openRun(p);
  await p.evaluate(() => { window.__sz.input.mv.f = 0.75; });
  await p.waitForFunction(() => window.__log.filter((e) => !e.pos && e.n.startsWith('step')).length >= 4);
  await p.evaluate(() => { window.__sz.input.mv.f = 0; });
  const jog = await local(p);
  const jgaps = jog.slice(1).map((e, i) => dist(e, jog[i]));
  check('half-speed analog movement: shorter stride and quieter than a run', jgaps.every((d) => d > 1.4 && d < 2.0) && jog.every((e) => e.o.gain < 0.95 && e.o.gain > 0.45), `${jgaps.map((d) => d.toFixed(2)).join(' ')} gain ${jog[0].o.gain.toFixed(2)}`);

  // silent cases: Alt-walk, crouch, standing still
  for (const [name, keys] of [['Alt-walk', ['AltLeft', 'KeyW']], ['crouching', ['ShiftLeft', 'KeyW']]]) {
    await openRun(p);
    const z0 = await p.evaluate(() => ({ x: window.__sz.game.kin.x, z: window.__sz.game.kin.z }));
    for (const k of keys) await p.keyboard.down(k);
    await p.waitForFunction((o) => Math.hypot(window.__sz.game.kin.x - o.x, window.__sz.game.kin.z - o.z) > 6, z0);
    for (const k of keys.reverse()) await p.keyboard.up(k);
    check(`${name} for 6+ m plays no steps`, (await p.evaluate(() => window.__log.filter((e) => e.n.startsWith('step')).length)) === 0);
    await p.waitForFunction(() => !window.__sz.game.kin.crouch);
  }
  await openRun(p);
  await waitTicks(p, 60);
  check('standing still for 2 s plays no steps', (await p.evaluate(() => window.__log.length)) === 0);

  // ---- landing: louder for harder falls, deeper pitch ----
  await openRun(p);
  await p.keyboard.down('Space');
  await p.waitForFunction(() => window.__log.some((e) => e.n === 'land'));
  await p.keyboard.up('Space');
  const hop = await p.evaluate(() => window.__log.find((e) => e.n === 'land'));
  await openRun(p);
  await p.evaluate(() => { const k = window.__sz.game.kin; k.y = 4; k.vy = 0; k.onGround = false; });
  await p.waitForFunction(() => window.__log.some((e) => e.n === 'land'));
  const drop = await p.evaluate(() => window.__log.find((e) => e.n === 'land'));
  check('a 4 m drop lands harder than a hop (gain and lower pitch)', drop.o.gain > hop.o.gain + 0.15 && drop.o.pitch < hop.o.pitch, `hop ${hop.o.gain.toFixed(2)}/${hop.o.pitch.toFixed(2)} drop ${drop.o.gain.toFixed(2)}/${drop.o.pitch.toFixed(2)}`);
  check('landing uses the map floor surface', drop.o.surface === 'sand' && hop.o.surface === 'sand');

  // ---- other players: positional, ~25 m range, silent when crouching or walking ----
  await openRun(p);
  const at = await p.evaluate(() => {
    const g = window.__sz.game;
    const r = g.addRemote(99, 'R', 'B', false);
    window.__drive = { x: g.kin.x, z: g.kin.z - 6, v: 5.5, c: false, dx: 1, last: performance.now() };
    const f = () => {
      const d = window.__drive;
      const now = performance.now();
      const dt = Math.min(0.1, (now - d.last) / 1000);
      d.last = now;
      d.x += d.dx * d.v * dt;
      r.setNow({ x: d.x, y: 0, z: d.z, yaw: -Math.PI / 2, alive: true, w: 0, c: d.c });
      window.__rafId = requestAnimationFrame(f);
    };
    f();
    return { x: g.kin.x, z: g.kin.z };
  });
  const remoteSteps = () => p.evaluate(() => window.__log.filter((e) => e.pos && Math.abs(e.pos[2] - window.__drive.z) < 0.2));
  await p.evaluate(() => { window.__log.length = 0; window.__drive.x = window.__sz.game.kin.x - 12; });
  await p.waitForFunction(() => window.__log.filter((e) => e.pos).length >= 5);
  const rs = await remoteSteps();
  const rgaps = rs.slice(1).map((e, i) => Math.hypot(e.pos[0] - rs[i].pos[0], e.pos[2] - rs[i].pos[2]));
  check('a running player nearby is heard: positional step_sand calls', rs.length >= 5 && rs.every((e) => e.n === 'step_sand' && e.pos.length === 3), `${rs.length} steps`);
  check('their steps are one stride apart and alternate feet', rgaps.every((d) => d > 1.9 && d < 2.9) && rs.slice(1).every((e, i) => e.o.foot !== rs[i].o.foot), rgaps.map((d) => d.toFixed(2)).join(' '));
  for (const [name, m] of [['crouching', { c: true, v: 5.5 }], ['walking (2.8 m/s)', { c: false, v: 2.8 }]]) {
    await p.evaluate((m) => { const d = window.__drive; const k = window.__sz.game.kin; d.c = m.c; d.v = m.v; d.z = k.z - 6; d.x = k.x - 8; window.__log.length = 0; }, m);
    await p.waitForFunction(() => window.__drive.x > window.__sz.game.kin.x + 4);
    check(`a ${name} player nearby makes no steps`, (await remoteSteps()).length === 0);
  }
  // range: 40 m away is silent, 20 m is heard
  await p.evaluate(() => { const d = window.__drive; d.c = false; d.v = 5.5; d.z = window.__sz.game.kin.z - 40; d.x = window.__sz.game.kin.x - 8; window.__log.length = 0; });
  await p.waitForFunction(() => window.__drive.x > window.__sz.game.kin.x + 8);
  check('a runner 40 m away is out of earshot (no calls)', (await p.evaluate(() => window.__log.filter((e) => e.pos).length)) === 0);
  await p.evaluate(() => { const d = window.__drive; d.z = window.__sz.game.kin.z - 20; d.x = window.__sz.game.kin.x - 8; window.__log.length = 0; });
  await p.waitForFunction(() => window.__log.filter((e) => e.pos).length >= 3);
  check('a runner 20 m away is still heard', true);
  await p.evaluate(() => cancelAnimationFrame(window.__rafId));
  await p.close();

  // ---- surface by what you stand on: crate = wood, container = metal, map floor otherwise ----
  const h = await practice('harbor');
  const info = await h.evaluate(() => {
    const g = window.__sz.game;
    const fs = g.footsteps;
    const raw = g.map.raw;
    const cont = raw.filter((b) => b.mat.startsWith('cont_')).sort((a, b) => Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) - Math.max(a.max[0] - a.min[0], a.max[2] - a.min[2]))[0];
    const wood = raw.find((b) => b.mat === 'bigcrate' || b.mat === 'pallet' || b.mat === 'crate');
    const c = (b) => [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];
    return {
      floor: fs.floor,
      ground: fs.surfaceAt(0, 0, 0),
      air: fs.surfaceAt(0, 1.5, 0),
      onCont: fs.surfaceAt(...c(cont)), onWood: wood ? fs.surfaceAt(...c(wood)) : 'none', woodMat: wood && wood.mat,
      cont: { min: cont.min, max: cont.max },
    };
  });
  check('harbor: floor = concrete, in the air = none', info.floor === 'concrete' && info.air === null && (info.ground === 'concrete' || info.ground === 'metal'), JSON.stringify(info));
  check(`standing on a container is metal, on a ${info.woodMat} is wood`, info.onCont === 'metal' && info.onWood === 'wood', JSON.stringify(info));
  // really walk along the top of the longest container: step_metal; back on the ground: step_concrete
  await h.evaluate((c) => {
    const g = window.__sz.game;
    const alongX = c.max[0] - c.min[0] > c.max[2] - c.min[2];
    const cx = (c.min[0] + c.max[0]) / 2;
    const cz = (c.min[2] + c.max[2]) / 2;
    g.kin.y = c.max[1]; g.kin.vy = 0; g.kin.onGround = true;
    g.kin.x = alongX ? c.min[0] + 0.6 : cx; g.kin.z = alongX ? cz : c.min[2] + 0.6;
    g.input.yaw = alongX ? -Math.PI / 2 : Math.PI; g.input.pitch = 0;
    window.__log.length = 0;
  }, info.cont);
  await h.keyboard.down('KeyW');
  await h.waitForFunction(() => window.__log.filter((e) => !e.pos && e.n.startsWith('step')).length >= 2);
  await h.keyboard.up('KeyW');
  const top = await h.evaluate(() => window.__log.filter((e) => !e.pos && e.n.startsWith('step')));
  check('walking along a container top plays step_metal', top.every((e) => e.n === 'step_metal' && e.y > 1), top.map((e) => `${e.n}@y${e.y.toFixed(1)}`).join(' '));
  await h.evaluate(() => { const g = window.__sz.game; g.kin.x = g.map.spawns.A[0].x; g.kin.z = g.map.spawns.A[0].z; g.kin.y = 0; });
  await openRun(h);
  await h.keyboard.down('KeyW');
  await h.waitForFunction(() => window.__log.filter((e) => !e.pos && e.n.startsWith('step')).length >= 2);
  await h.keyboard.up('KeyW');
  const gnd = await h.evaluate(() => window.__log.filter((e) => !e.pos && e.n.startsWith('step')));
  check('back on the ground: step_concrete', gnd.every((e) => e.n === 'step_concrete'), gnd.map((e) => e.n).join(' '));
  await h.close();

  // every surface synthesizes (also bare, as the smoke test does)
  const s = await practice('yard');
  const ok = await s.evaluate(() => {
    const sfx = window.__sz.sfx;
    try {
      for (const n of ['step', 'step_concrete', 'step_sand', 'step_stone', 'step_wood', 'step_metal', 'land']) { sfx.play(n); sfx.play(n, [4, 1, -3], { x: 0, y: 1.6, z: 0, yaw: 0.3 }, { gain: 0.5, pitch: 0.9, pan: 0.1, surface: 'wood' }); }
      return sfx.ctx.state;
    } catch (e) { return String(e); }
  });
  check('all footstep sounds synthesize (AudioContext running)', ok === 'running', ok);
  await s.close();
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('footsteps run', false, String(e));
} finally {
  await browser.close();
}
done();
