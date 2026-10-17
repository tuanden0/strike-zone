// High vs Ultra (ambient occlusion + bloom): same cameras, saved side by side, plus sanity checks. Usage: node postfx.mjs [outDir]
import { launch, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const browser = await launch();
const views = {
  corridor: { pos: [-3, 1.6, 21], look: [0, 1.2, 8] },
  crates: { pos: [3.5, 1.7, -2.5], look: [-1.5, 0.6, -7] },
  overview: { pos: [-26, 18, 30], look: [0, 0, 0] },
};
const settle = (p, n = 8) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const results = {};
try {
  for (const q of (process.env.QUALS || 'high,ultra').split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    await ctx.addInitScript((qq) => localStorage.setItem('sz.quality', qq), q);
    const p = await ctx.newPage();
    p.setDefaultTimeout(300000);
    const msgs = [];
    p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) msgs.push(`${m.type()}: ${m.text()}`); });
    p.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));
    await p.goto(BASE);
    await p.waitForFunction(() => window.__sz && window.__sz.assets);
    await p.click('#btn-practice');
    await p.click('#btn-resume');
    await p.waitForFunction(() => document.pointerLockElement);
    await p.waitForFunction(() => window.__sz.game.tickNo > 30);
    console.log('  ', q, 'running');
    const info = await p.evaluate(() => ({ quality: window.__sz.game.quality, postfx: !!window.__sz.game.postfx, select: document.getElementById('quality').value }));
    results[q] = { info, msgs, shots: {} };
    for (const [name, v] of Object.entries(views)) {
      await p.evaluate((v) => { const g = window.__sz.game; g.debugCam = v; for (const t of g.mode.targets) t.mx = 0; }, v);
      await settle(p);
      const buf = await p.screenshot({ path: out ? `${out}/fx_${q}_${name}.jpg` : undefined, type: 'jpeg', quality: 88 });
      results[q].shots[name] = buf.length;
    }
    const ms = await p.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r)); return (performance.now() - t0) / 10; });
    results[q].ms = ms;
    await ctx.close();
  }
  check('High: plain path (no post-processing)', results.high.info.quality === 'high' && !results.high.info.postfx);
  check('Ultra: composer active and selectable', results.ultra.info.quality === 'ultra' && results.ultra.info.postfx && results.ultra.info.select === 'ultra', JSON.stringify(results.ultra.info));
  check('Ultra renders without GL errors or warnings', results.ultra.msgs.length === 0, results.ultra.msgs.slice(0, 3).join(' | '));
  check('High still renders without errors', results.high.msgs.length === 0, results.high.msgs.slice(0, 3).join(' | '));
  check('Ultra frames differ from High (effects are visible)', Object.keys(views).every((n) => results.ultra.shots[n] !== results.high.shots[n]), JSON.stringify([results.high.shots, results.ultra.shots]));
  console.log(`  frame time under software GL (no GPU here, informational only): High ${results.high.ms.toFixed(0)} ms, Ultra ${results.ultra.ms.toFixed(0)} ms`);
} catch (e) {
  check('postfx run', false, String(e));
} finally {
  await browser.close();
}
done();
