// Regenerates server/internal/game/testdata/golden_move.json from the JS physics.
// Run: node scripts/gen-golden.mjs   (the Go test then proves Go == JS)
import { readFileSync, writeFileSync } from 'node:fs';
import { stepMove, createKin, prepareMap } from '../client/js/physics.js';
import { Loadout, burstKick, spread, bloom } from '../client/js/weapons.js';

const spec = JSON.parse(readFileSync(new URL('../client/shared/spec.json', import.meta.url)));
const map = prepareMap(JSON.parse(readFileSync(new URL('../client/shared/map.json', import.meta.url))));
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

function run(start, gen, n, extraBoxes = null) {
  const m = extraBoxes ? { ...map, boxes: [...map.boxes, ...extraBoxes] } : map;
  const k = createKin(...start);
  const inputs = [];
  const expect = [];
  for (let i = 0; i < n; i++) {
    const c = gen(i);
    inputs.push(c);
    stepMove(spec, m, k, c);
    expect.push({ x: k.x, y: k.y, z: k.z, vy: k.vy, g: k.onGround, c: k.crouch });
  }
  return { start, inputs, expect, boxes: extraBoxes };
}

let yaw = 0;
const scenarios = [
  // random walk with jumps from team A spawn
  run([0, 0, 20], (i) => {
    if (i % 40 === 0) yaw += (rnd() - 0.5) * 3;
    return { f: rnd() < 0.7 ? 1 : rnd() < 0.5 ? -1 : 0, s: rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0, yaw, jump: rnd() < 0.05, walk: rnd() < 0.1, crouch: (i >> 4) % 5 === 3 };
  }, 1500),
  // run at the centre crate (0.9 high) while jumping: lands on top, then keeps walking
  run([0, 0, 3], (i) => ({ f: 1, s: 0, yaw: 0, jump: i % 12 === 0, walk: false }), 150),
  // run diagonally into the left divider wall, slide along it
  run([-5, 0, 10], () => ({ f: 1, s: -1, yaw: Math.PI / 2 + 0.3, jump: false, walk: false }), 120),
  // run into the outer wall, jump into ceiling-less sky edge, strafe
  run([20, 0, -20], (i) => ({ f: 1, s: i % 30 < 15 ? 1 : -1, yaw: -Math.PI / 4, jump: i % 20 === 0, walk: i > 100 }), 200),
  // low beam (underside 1.3 m): walk under it crouched, release Shift underneath (must stay crouched), keep going, stand up outside
  run([0, 0, 12], (i) => ({ f: i < 100 ? 1 : 0.4, s: 0, yaw: 0, jump: i % 25 === 0, walk: false, crouch: i < 70 }), 140, [[-3, 1.3, 5, 3, 2.2, 7]]),
  // crouch-jump is impossible, crouch in the air does not start, landing then crouching works
  run([0, 0, 15], (i) => ({ f: 0.5, s: 0, yaw: 0.3, jump: i === 5, walk: false, crouch: i > 8 && i < 40 }), 60),
];
writeFileSync(new URL('../server/internal/game/testdata/golden_move.json', import.meta.url), JSON.stringify(scenarios));
for (const sc of scenarios) console.log('scenario steps', sc.inputs.length, 'final', JSON.stringify(sc.expect.at(-1)));

// ---- weapons: random fire/reload/switch sequence, state after every tick ------------------------
{
  const lo = new Loadout(spec);
  const inputs = [];
  const expect = [];
  let held = false;
  for (let tick = 1; tick <= 1500; tick++) {
    if (rnd() < 0.15) held = !held;
    const inp = {
      fire: held || rnd() < 0.05,
      reload: rnd() < 0.03,
      weapon: rnd() < 0.04 ? Math.floor(rnd() * 4) : -1,
    };
    inputs.push(inp);
    lo.step(inp, tick);
    expect.push({
      cur: lo.cur,
      mag: [...lo.mag],
      res: [...lo.res],
      cd: Math.max(0, lo.nextFire - tick),
      rl: lo.reloadDone > 0 ? lo.reloadDone - tick : 0,
      pf: lo.prevFire,
      bu: lo.burst,
      sp: [spread(spec, lo.weapon, false, 0, lo.burst), spread(spec, lo.weapon, true, 1, lo.burst)],
      kk: burstKick(spec, lo.weapon, lo.burst),
    });
  }
  // static table: kick / bloom / spread of every weapon at several burst lengths (covers weapons the random run never owns)
  const table = spec.weapons.map((w) => [1, 2, 5, 12, 40].map((b) => [burstKick(spec, w, b), bloom(spec, w, b), spread(spec, w, true, 0.5, b)]));
  writeFileSync(new URL('../server/internal/game/testdata/golden_weapons.json', import.meta.url), JSON.stringify({ inputs, expect, table }));
  console.log('weapons steps', inputs.length, 'final', JSON.stringify(expect.at(-1)));
}
