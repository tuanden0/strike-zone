// Render-cost report for the new assets. NOTE: this sandbox has no GPU (software GL), so absolute FPS is NOT
// representative; the numbers that transfer to real hardware are draw calls, triangles and JS CPU time per frame.
import { launch, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__sz && window.__sz.assets, null, { timeout: 90000 });
  await page.click('#btn-practice');
  await page.click('#btn-resume');
  await page.waitForFunction(() => document.pointerLockElement);
  await page.waitForTimeout(1500);
  for (const q of ['high', 'low']) {
    const r = await page.evaluate(async (q) => {
      const g = window.__sz.game;
      g.setQuality(q);
      g.renderer.info.autoReset = false;
      await new Promise((res) => setTimeout(res, 600));
      g.renderer.info.reset();
      const f0 = g.frames + 0;
      let frames = 0;
      await new Promise((res) => { const t0 = performance.now(); const h = () => { frames++; if (performance.now() - t0 > 3000) res(); else requestAnimationFrame(h); }; requestAnimationFrame(h); });
      const info = g.renderer.info.render;
      const out = { frames, calls: info.calls / frames, triangles: info.triangles / frames, geometries: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures };
      // CPU cost of animating + posing every character (8 dummies) per frame, measured in isolation
      const t1 = performance.now();
      const N = 200;
      for (let i = 0; i < N; i++) for (const r of g.remotes.values()) r.char.update(1 / 60, 3);
      out.animMsPerFrame = (performance.now() - t1) / N;
      g.renderer.info.autoReset = true;
      out.characters = g.remotes.size;
      return out;
    }, q);
    console.log(`  quality=${q}: ${JSON.stringify(r)}`);
    check(`${q}: draw calls per frame (two passes: world + view model) <= 400`, r.calls <= 400, r.calls.toFixed(0));
  }
} catch (e) {
  check('perf run', false, String(e));
} finally {
  await browser.close();
}
done();
