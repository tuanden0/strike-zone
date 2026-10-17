// Captures the in-game screenshots listed in docs/REPORT: first person per weapon, enemies at 5 m / 20 m,
// third-person close-ups (all weapons, death) and a map overview. Needs a running server.
//   E2E_QUALITY=high node screenshots.mjs [outDir]
import { launch } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const out = process.argv[2] || '../docs/screenshots';
mkdirSync(out, { recursive: true });
const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.setDefaultTimeout(240000);
const errs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
await p.goto(BASE);
await p.waitForFunction(() => window.__sz && window.__sz.assets);
await p.click('#btn-practice');
await p.click('#btn-resume');
await p.waitForFunction(() => document.pointerLockElement);
await p.waitForFunction(() => window.__sz.game.tickNo > 30);
const settle = (n = 6) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const snap = async (name, clip) => { await settle(); await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88, ...(clip ? { clip } : {}) }); console.log('saved', name); };
const weapon = async (key, idx) => { await p.keyboard.press(key); await p.waitForFunction((i) => window.__sz.game.loadout.cur === i && window.__sz.game.switchT === 0, idx); };

// ---- first person ----------------------------------------------------------------------------------
await p.evaluate(() => { const g = window.__sz.game; g.input.yaw = 0; g.input.pitch = -0.08; });
await snap('fp_rifle');
await weapon('Digit2', 1); await snap('fp_pistol');
await weapon('Digit3', 2); await snap('fp_knife');
await weapon('Digit1', 0);
await p.evaluate(() => { const g = window.__sz.game; g.flashT = 5; g.kick = 1; g.ejectCasing(); });
await snap('fp_rifle_muzzle_flash');
await p.evaluate(() => { const g = window.__sz.game; g.flashT = 0; });

// ---- opponents ----------------------------------------------------------------------------------------
await p.evaluate(() => { for (const t of window.__sz.game.mode.targets) t.mx = 0; }); // freeze the moving dummies
const cam = async (pos, look) => { await p.evaluate(([pos, look]) => { window.__sz.game.debugCam = { pos, look }; }, [pos, look]); await settle(10); };
await cam([0, 1.62, -9], [0, 1.2, -14]); await snap('enemy_5m_back');
await cam([0, 1.62, -19], [0, 1.2, -14]); await snap('enemy_5m_front');
await cam([0, 1.62, 6], [0, 1.2, -14]); await snap('enemy_20m_back');
const tp = { x: 200, y: 50, width: 600, height: 620 };
for (const [n, c] of Object.entries({ front: [[0, 1.45, -17.2], [0, 1.15, -14]], threequarter: [[2.6, 1.5, -16.2], [0, 1.1, -14]], side: [[3.2, 1.3, -14], [0, 1.1, -14]], back: [[0, 1.5, -10.8], [0, 1.1, -14]] })) {
  await cam(...c); await snap(`tp_rifle_${n}`, tp);
}
// third-person pistol / knife holders are dummies 2 and 3
for (const [n, i, off] of [['pistol', 2, [-2.4, -3.2]], ['knife', 3, [0.9, -3.2]]]) { // cameras placed in free floor space
  const t = await p.evaluate((i) => { const t = window.__sz.game.mode.targets[i]; return [t.px, t.pz]; }, i);
  await cam([t[0] + off[0], 1.5, t[1] + off[1]], [t[0], 1.1, t[1]]); await snap(`tp_${n}`, tp);
}
// death pose
await p.evaluate(() => { const t = window.__sz.game.mode.targets[0]; t.alive = false; t.respawnAt = 1e9; });
await cam([2.6, 1.2, -16.2], [0, 0.6, -14]);
await p.waitForFunction(() => window.__sz.game.mode.targets[0].view.char.death.time > 1.3);
await snap('tp_death', tp);
await p.evaluate(() => { window.__sz.game.mode.targets[0].respawnAt = 0; });

// ---- map ---------------------------------------------------------------------------------------------------
await cam([-30, 20, 36], [0, 0, 0]); await snap('map_overview');
await cam([0, 36, 0.1], [0, 0, 0]); await snap('map_top');
await cam([-3, 1.6, 21], [0, 1.2, 14]); await snap('map_spawn_view');
console.log(errs.slice(0, 8).join('\n') || 'no console errors');
await b.close();
process.exit(errs.length ? 1 : 0);
