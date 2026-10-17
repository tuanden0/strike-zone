// New-asset checks in real Chromium: every .glb loads without console errors, budgets hold, the character fits the shared
// hitbox spec, and shooting the new models' head vs body is scored correctly by the (unchanged) hit code.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchErrors(page, errors);
  page.on('console', (m) => { if (m.type() === 'warning' && /glTF|GLTF|three/i.test(m.text())) errors.push('warning: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__sz && window.__sz.assets, null, { timeout: 60000 });

  // ---- A. every glb loads; triangle + size budgets ---------------------------------------------
  const info = await page.evaluate(async () => {
    const { loadAssets, MODEL_FILES } = await import('/js/assets.js');
    const all = await loadAssets(MODEL_FILES);
    const out = {};
    for (const [name, g] of Object.entries(all)) {
      let tris = 0, meshes = 0, bones = 0;
      g.scene.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) { meshes++; const gm = o.geometry; tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; }
        if (o.isBone) bones++;
      });
      const bytes = (await fetch(`/assets/models/${name}.glb`)).headers.get('content-length');
      out[name] = { tris: Math.round(tris), meshes, bones, bytes: Number(bytes), clips: g.animations.map((a) => a.name) };
    }
    return out;
  });
  let total = 0;
  for (const [n, i] of Object.entries(info)) { total += i.bytes; console.log(`  ${n.padEnd(13)} tris=${String(i.tris).padStart(6)} bytes=${String(i.bytes).padStart(8)} clips=${i.clips.join(',')}`); }
  check('all 9 glb models load', Object.keys(info).length === 9);
  check('total asset size <= 20 MB', total <= 20 * 1024 * 1024, `${(total / 1048576).toFixed(2)} MB`);
  const charBody = info.character_a.tris - 1480 - 796 - 429; // minus the three low-poly weapons parented to the hand
  check('character body <= 5000 tris', charBody <= 5000, `${charBody}`);
  check('rifle <= 3000 tris', info.rifle.tris <= 3000, `${info.rifle.tris}`);
  check('pistol <= 1500 tris', info.pistol.tris <= 1500, `${info.pistol.tris}`);
  check('knife <= 800 tris', info.knife.tris <= 800, `${info.knife.tris}`);
  const need = ['idle', 'run', 'crouch', 'death', 'hold_rifle', 'hold_pistol', 'hold_knife', 'shoot_rifle', 'shoot_pistol', 'shoot_knife'];
  check('character has idle/run/crouch/shoot/death clips', need.every((c) => info.character_a.clips.includes(c) && info.character_b.clips.includes(c)));

  // ---- B. character fits the hitbox spec --------------------------------------------------------
  const fit = await page.evaluate(async () => {
    const { Soldier, fitScale } = await import('/js/models.js');
    const sz = window.__sz;
    const spec = sz.spec;
    const res = { scale: fitScale(sz.assets.character_a.scene, spec), bad: [] };
    const bodyHB = spec.player.body;
    const headHB = spec.player.head;
    const s = new Soldier(sz.assets.character_a, spec);
    s.group.updateMatrixWorld(true);
    const sms = [];
    s.model.traverse((o) => { if (o.isSkinnedMesh) sms.push(o); }); // one SkinnedMesh per material
    const stat = { head: { lo: 9, hi: -9, mx: 0, mz: 0 }, torso: { lo: 9, hi: -9, mx: 0, mz: 0 }, legs: { lo: 9, hi: -9, mx: 0, mz: 0 } };
    for (const sm of sms) {
      const names = sm.skeleton.bones.map((b) => b.name);
      const pos = sm.geometry.attributes.position, si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
      const v = new sm.position.constructor();
      for (let i = 0; i < pos.count; i++) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); best = si.getComponent(i, k); }
        const bn = names[best];
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(sm.matrixWorld);
        const grp = bn === 'head' ? 'head' : /^(hips|spine|chest)$/.test(bn) ? 'torso' : /^(thigh|shin|foot)/.test(bn) ? 'legs' : null;
        if (!grp) continue;
        const st = stat[grp];
        st.lo = Math.min(st.lo, v.y); st.hi = Math.max(st.hi, v.y); st.mx = Math.max(st.mx, Math.abs(v.x)); st.mz = Math.max(st.mz, Math.abs(v.z));
      }
    }
    res.stat = stat; res.bodyHB = bodyHB; res.headHB = headHB;
    return res;
  });
  check('model scale == 1.0 (authored at hitbox size)', Math.abs(fit.scale - 1) < 0.01, fit.scale.toFixed(4));
  const H = fit.headHB, B = fit.bodyHB;
  check('head mesh inside head hitbox (y 1.45..1.80, half-width 0.18)', fit.stat.head.lo >= H.y0 + 0.05 - 0.2 && fit.stat.head.hi <= H.y1 + 0.005 && fit.stat.head.mx <= H.halfWidth && fit.stat.head.mz <= H.halfWidth, JSON.stringify(fit.stat.head));
  check('torso mesh inside body hitbox (y<=1.45, half-width 0.30)', fit.stat.torso.hi <= B.y1 + 0.005 && fit.stat.torso.mx <= B.halfWidth && fit.stat.torso.mz <= B.halfWidth, JSON.stringify(fit.stat.torso));
  check('legs reach the floor and stay inside the body hitbox', fit.stat.legs.lo >= -0.005 && fit.stat.legs.lo <= 0.03 && fit.stat.legs.mx <= B.halfWidth, JSON.stringify(fit.stat.legs));

  // ---- C. shots at the new model's head / torso are scored by the unchanged hit code ---------------
  await page.click('#btn-practice');
  await page.waitForFunction(() => window.__sz.game && window.__sz.game.mode && window.__sz.game.mode.targets);
  const shots = await page.evaluate(async () => {
    const g = window.__sz.game;
    const m = g.mode;
    g.loadout.cur = 0;
    const tg = m.targets[0]; // static dummy at (0, -14)
    g.kin.x = tg.px; g.kin.z = tg.pz + 12; g.kin.y = 0; // 12 m in front of it
    g.speed = 0;
    for (const t of m.targets.slice(1)) t.alive = false; // only the first dummy counts
    const view = tg.view;
    view.update(performance.now() + 1000, 0.016);
    view.char.update(0.5, 0); // let the pose settle
    const sms = [];
    view.group.traverse((o) => { if (o.isSkinnedMesh) sms.push(o); });
    view.group.updateMatrixWorld(true);
    const centroid = (pred) => {
      const acc = new sms[0].position.constructor(); let n = 0; const v = new sms[0].position.constructor();
      for (const sm of sms) {
        const names = sm.skeleton.bones.map((b) => b.name);
        const si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
        for (let i = 0; i < sm.geometry.attributes.position.count; i++) {
          let best = 0, bw = -1;
          for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); best = si.getComponent(i, k); }
          if (!pred(names[best])) continue;
          sm.getVertexPosition(i, v); v.applyMatrix4(sm.matrixWorld); acc.add(v); n++;
        }
      }
      return acc.multiplyScalar(1 / n);
    };
    const aimAt = (p) => {
      const e = g.eye();
      const dx = p.x - e[0], dy = p.y - e[1], dz = p.z - e[2];
      return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    };
    const out = {};
    const head = centroid((b) => b === 'head');
    const chest = centroid((b) => b === 'chest' || b === 'spine');
    out.headY = head.y; out.chestY = chest.y;
    const run = (label, p, n) => {
      const a = aimAt(p);
      const before = { hits: m.hits, heads: m.heads };
      for (let i = 0; i < n; i++) { tg.alive = true; tg.hp = 100; m.fire({ yaw: a.yaw, pitch: a.pitch }, g); }
      out[label] = { hits: m.hits - before.hits, heads: m.heads - before.heads };
    };
    run('headshots', head, 20);
    run('chestshots', chest, 20);
    return out;
  });
  console.log('  shot test:', JSON.stringify(shots));
  check('aiming at the head of the new model scores headshots', shots.headshots.heads >= 18 && shots.headshots.hits >= 18, JSON.stringify(shots.headshots));
  check('aiming at the chest scores body hits, not headshots', shots.chestshots.hits >= 18 && shots.chestshots.heads === 0, JSON.stringify(shots.chestshots));
  check('head centroid is above the body hitbox top, chest below it', shots.headY > 1.45 && shots.chestY < 1.45, `${shots.headY.toFixed(2)} / ${shots.chestY.toFixed(2)}`);
  check('no console errors/warnings while loading and rendering models', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('assets run', false, String(e));
} finally {
  await browser.close();
}
done();
