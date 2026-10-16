// Regenerates server/internal/game/testdata/golden_move.json from the JS physics.
// Run: node scripts/gen-golden.mjs   (the Go test then proves Go == JS)
import { readFileSync, writeFileSync } from 'node:fs';
import { stepMove, createKin, prepareMap } from '../client/js/physics.js';

const spec = JSON.parse(readFileSync(new URL('../client/shared/spec.json', import.meta.url)));
const map = prepareMap(JSON.parse(readFileSync(new URL('../client/shared/map.json', import.meta.url))));
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

function run(start, gen, n) {
  const k = createKin(...start);
  const inputs = [];
  const expect = [];
  for (let i = 0; i < n; i++) {
    const c = gen(i);
    inputs.push(c);
    stepMove(spec, map, k, c);
    expect.push({ x: k.x, y: k.y, z: k.z, vy: k.vy, g: k.onGround });
  }
  return { start, inputs, expect };
}

let yaw = 0;
const scenarios = [
  // random walk with jumps from team A spawn
  run([0, 0, 20], (i) => {
    if (i % 40 === 0) yaw += (rnd() - 0.5) * 3;
    return { f: rnd() < 0.7 ? 1 : rnd() < 0.5 ? -1 : 0, s: rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0, yaw, jump: rnd() < 0.05, walk: rnd() < 0.1 };
  }, 1500),
  // run at the centre crate (0.9 high) while jumping: lands on top, then keeps walking
  run([0, 0, 3], (i) => ({ f: 1, s: 0, yaw: 0, jump: i % 12 === 0, walk: false }), 150),
  // run diagonally into the left divider wall, slide along it
  run([-5, 0, 10], () => ({ f: 1, s: -1, yaw: Math.PI / 2 + 0.3, jump: false, walk: false }), 120),
  // run into the outer wall, jump into ceiling-less sky edge, strafe
  run([20, 0, -20], (i) => ({ f: 1, s: i % 30 < 15 ? 1 : -1, yaw: -Math.PI / 4, jump: i % 20 === 0, walk: i > 100 }), 200),
];
writeFileSync(new URL('../server/internal/game/testdata/golden_move.json', import.meta.url), JSON.stringify(scenarios));
for (const sc of scenarios) console.log('scenario steps', sc.inputs.length, 'final', JSON.stringify(sc.expect.at(-1)));
