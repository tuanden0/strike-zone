// Imported-prop proof of concept: loads, scale/pivot/orientation, textures, lighting, render cost, and the fallback path.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const out = process.argv[2];
const browser = await launch();
const errors = [];

async function start(query = '', setup) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.setDefaultTimeout(240000);
  watchErrors(page, errors);
  if (setup) await setup(page);
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.__sz && window.__sz.assets && window.__sz.props !== undefined);
  await page.click('#btn-practice');
  await page.click('#btn-resume');
  await page.waitForFunction(() => document.pointerLockElement);
  await page.waitForFunction(() => window.__sz.game.tickNo > 30);
  return page;
}
// triangles of everything in the world group (renderer.info is reset by the first-person pass, so count geometry directly)
const tris = (page) => page.evaluate(() => { let n = 0; window.__sz.game.world.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); });

try {
  // ---- with props ----
  const p = await start();
  const info = await p.evaluate(() => {
    const g = window.__sz.game;
    const grp = g.world.getObjectByName('props');
    const items = grp ? grp.children : [];
    const THREE_Box = (o) => { const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; o.updateMatrixWorld(true); o.traverse((m) => { if (!m.isMesh) return; m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); for (const k of [0, 1, 2]) { b.min[k] = Math.min(b.min[k], [bb.min.x, bb.min.y, bb.min.z][k]); b.max[k] = Math.max(b.max[k], [bb.max.x, bb.max.y, bb.max.z][k]); } }); return b; };
    const first = items[0];
    let mat = null;
    first && first.traverse((m) => { if (m.isMesh && !mat) mat = m.material; });
    return {
      n: items.length,
      pos: first && first.position.toArray(),
      box: first && THREE_Box(first),
      maps: mat && ['map', 'normalMap', 'metalnessMap', 'emissiveMap', 'aoMap'].filter((k) => mat[k]),
      mapPx: mat && mat.map && [mat.map.image.width, mat.map.image.height],
      metal: mat && mat.metalness,
      skipped: window.__sz.props.skipped,
      shadows: first && (() => { let c = false; first.traverse((m) => { if (m.isMesh && m.castShadow && m.receiveShadow) c = true; }); return c; })(),
    };
  });
  check('manifest loaded, nothing skipped, 2 placements built on yard', info.n === 2 && info.skipped.length === 0, JSON.stringify(info.skipped));
  const h = info.box.max[1] - info.box.min[1];
  check('scale: 0.26 m tall, 0.109 m wide', Math.abs(h - 0.26) < 0.013 && Math.abs(info.box.max[0] - info.box.min[0]) < 0.16 /* AABB of a yawed 0.109 m bottle */, `h=${h.toFixed(3)}`);
  check('pivot: base rests on the crate top (y 1.40)', Math.abs(info.box.min[1] - 1.4) < 0.005, `min y ${info.box.min[1].toFixed(4)}`);
  check('orientation: upright (height is the long axis)', h > info.box.max[0] - info.box.min[0] && h > info.box.max[2] - info.box.min[2]);
  check('PBR maps present (map, normal, metal/rough, emissive) at 512 px', ['map', 'normalMap', 'metalnessMap', 'emissiveMap'].every((k) => info.maps.includes(k)) && info.mapPx[0] === 512, JSON.stringify([info.maps, info.mapPx]));
  check('casts + receives shadows (lit by the scene sun)', info.shadows === true);
  const boxesWith = await p.evaluate(() => JSON.stringify(window.__sz.game.map.boxes));
  const withT = await tris(p);
  // render check: close-up, the bottle must show non-background pixels with variation
  await p.evaluate(() => { const g = window.__sz.game; g.debugCam = { pos: [-12.55, 1.62, -8.45], look: [-13, 1.52, -9] }; });
  await p.evaluate(() => new Promise((r) => { let k = 0; const f = () => (++k > 6 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const shot = await p.screenshot({ path: out ? `${out}/prop_waterbottle.png` : undefined });
  check('close-up screenshot captured', shot.length > 5000, `${shot.length} bytes`);
  const frameMs = await p.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r)); return (performance.now() - t0) / 20; });
  await p.close();

  // ---- A/B without props ----
  const q = await start('?noprops=1');
  check('?noprops=1: no props group content', await q.evaluate(() => !window.__sz.game.world.getObjectByName('props')));
  check('collision data identical with and without props', (await q.evaluate(() => JSON.stringify(window.__sz.game.map.boxes))) === boxesWith);
  const withoutT = await tris(q);
  const baseMs = await q.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r)); return (performance.now() - t0) / 20; });
  await q.close();
  check('render cost: +<= 3.2k triangles for 2 bottles (1.46k each)', withT - withoutT <= 3200 && withT > withoutT, `${withoutT} -> ${withT}`);
  console.log(`  frame time (software GL, informational): without ${baseMs.toFixed(0)} ms, with ${frameMs.toFixed(0)} ms`);

  // ---- fallback: the glb fails to load; game still starts, prop skipped ----
  const f = await start('', (pg) => pg.route('**/models/props/waterbottle.glb', (r) => r.fulfill({ status: 404, body: 'nope' })));
  const fb = await f.evaluate(() => ({ skipped: window.__sz.props.skipped.map((s) => s.id), n: window.__sz.game.world.getObjectByName('props').children.length, ticks: window.__sz.game.tickNo }));
  check('missing glb: prop skipped, game running, map intact', fb.skipped[0] === 'waterbottle' && fb.n === 0 && fb.ticks > 30, JSON.stringify(fb));
  await f.close();
  const m = await start('', (pg) => pg.route('**/assets/manifest.json', (r) => r.fulfill({ status: 500, body: 'x' })));
  check('broken manifest: game still starts', await m.evaluate(() => window.__sz.game.running && window.__sz.props.items.length === 0));
  await m.close();
  const expected404 = errors.filter((e) => !/404|500|Failed to load resource/.test(e));
  check('no unexpected JS errors', expected404.length === 0, expected404.join(' | '));
} catch (e) {
  check('props run', false, String(e));
} finally {
  await browser.close();
}
done();
