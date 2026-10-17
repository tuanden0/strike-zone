// The five maps added with the "five maps" feature (piazza, pyramid, canyon, harbor, bunker) in Practice mode: the map loads on
// demand, the player spawns inside the bounds on free floor, the practice dummies stand on free floor, and two screenshots per map
// (overview + street level, free camera via game.debugCam) are saved. Needs a running server.
//   BASE_URL=http://localhost:18080 node maps.mjs [outDir]      (default outDir: ../docs/screenshots)
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const out = process.argv[2] || fileURLToPath(new URL('../docs/screenshots', import.meta.url));
mkdirSync(out, { recursive: true });

// overview: high oblique over the south-west corner; street: eye-level views from places a player actually stands
const MAPS = {
  piazza: { half: 28, overview: [[-36, 36, 44], [0, 0, 2]], street: [[-6, 1.7, 11.5], [0, 1.3, 0]] },
  pyramid: { half: 30, overview: [[-38, 38, 44], [0, 0, 2]], street: [[0, 1.7, 19.2], [0, 1.6, 0]] },
  canyon: { half: 30, overview: [[-38, 38, 44], [0, 0, 2]], street: [[0, 1.7, 13.5], [0, 1.5, -10]] },
  harbor: { half: 30, overview: [[-38, 38, 44], [0, 0, 2]], street: [[-27.5, 1.7, 5.5], [20, 1.6, 5.5]] },
  bunker: { half: 28, overview: [[-36, 36, 42], [0, 0, 2]], street: [[-11.5, 1.7, 19.5], [-11.5, 1.6, -18]] },
};

const browser = await launch();
const errors = [];
const settle = (p, n = 8) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

try {
  for (const [id, cfg] of Object.entries(MAPS)) {
    const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
    p.setDefaultTimeout(240000);
    watchErrors(p, errors);
    await p.goto(BASE);
    await p.waitForFunction(() => window.__sz && window.__sz.assets);
    check(`${id}: listed in the practice map select`, await p.evaluate((id) => [...document.getElementById('practice-map').options].some((o) => o.value === id), id));
    await p.selectOption('#practice-map', id);
    await p.click('#btn-practice');
    await p.click('#btn-resume');
    await p.waitForFunction(() => document.pointerLockElement);
    await p.waitForFunction(() => window.__sz.game.tickNo > 30);

    check(`${id}: map id`, await p.evaluate((id) => window.__sz.game.mapId === id, id));
    const info = await p.evaluate(() => {
      const g = window.__sz.game;
      const b = g.map.bounds;
      let meshes = 0, tris = 0;
      g.world.traverse((o) => { if (o.isMesh) { meshes++; const gm = o.geometry; tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; } });
      const hw = g.spec.player.halfWidth, H = g.spec.player.height;
      const hits = (x, z, r) => g.map.boxes.some((o) => x + r > o[0] && x - r < o[3] && 0 + H > o[1] && 0 < o[4] && z + r > o[2] && z - r < o[5]);
      const badSpots = [];
      g.mode.targets.forEach((t, i) => {
        const xs = t.mx ? Array.from({ length: 21 }, (_, k) => t.x + t.mx * (k - 10) / 10) : [t.x];
        if (xs.some((x) => hits(x, t.z, hw))) badSpots.push(i);
      });
      return { x: g.kin.x, z: g.kin.z, bounds: b, boxes: g.map.boxes.length, meshes, tris: Math.round(tris), inside: hits(g.kin.x, g.kin.z, hw), badSpots, targets: g.mode.targets.length };
    });
    const bd = info.bounds;
    check(`${id}: player spawned inside the bounds on free floor`, info.x > bd.minX && info.x < bd.maxX && info.z > bd.minZ && info.z < bd.maxZ && !info.inside && Math.abs(bd.maxX) === cfg.half, JSON.stringify({ x: info.x, z: info.z }));
    check(`${id}: collision boxes and visual meshes loaded`, info.boxes > 50 && info.meshes >= 1 && info.tris > 3000, `${info.boxes} boxes, ${info.meshes} meshes, ${info.tris} tris`);
    check(`${id}: all practice dummies stand on free floor`, info.targets === 8 && info.badSpots.length === 0, JSON.stringify(info.badSpots));

    await p.evaluate(({ pos, look }) => { const g = window.__sz.game; for (const t of g.mode.targets) t.mx = 0; g.debugCam = { pos, look }; for (const q of g.puffs) q.visible = false; }, { pos: cfg.overview[0], look: cfg.overview[1] });
    await settle(p);
    await p.screenshot({ path: `${out}/maps_${id}_overview.jpg`, type: 'jpeg', quality: 88 });
    await p.evaluate(({ pos, look }) => { window.__sz.game.debugCam = { pos, look }; }, { pos: cfg.street[0], look: cfg.street[1] });
    await settle(p);
    await p.screenshot({ path: `${out}/maps_${id}_street.jpg`, type: 'jpeg', quality: 88 });
    console.log(`saved maps_${id}_overview.jpg, maps_${id}_street.jpg`);
    await p.close();
  }
  // ---- server side: a room can be created on every new map and the server announces the map's 10 weapon pickups ----
  const w = await browser.newPage({ viewport: { width: 400, height: 300 } });
  watchErrors(w, errors);
  await w.goto(BASE);
  const online = await w.evaluate(async (ids) => {
    const res = {};
    for (const id of ids) {
      res[id] = await new Promise((resolve) => {
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
        const got = { map: null, pk: null };
        const timer = setTimeout(() => { ws.close(); resolve({ ...got, timeout: true }); }, 15000);
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', nick: 'MapCheck' }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.t === 'welcome' || m.t === 'hello' || m.t === 'lobby') {
            if (!got.sent) { got.sent = true; ws.send(JSON.stringify({ t: 'create', name: `mc-${id}`, password: '', max: 4, timeLimit: 120, scoreLimit: 10, map: id, team: 'A' })); }
          }
          if (m.t === 'joined') got.map = m.room.map;
          if (m.t === 'pk') got.pk = m.list.length;
          if (m.t === 'error') { got.error = m.msg; }
          if (got.map && got.pk !== null || got.error) { clearTimeout(timer); ws.send(JSON.stringify({ t: 'leave' })); ws.close(); resolve(got); }
        };
      });
    }
    return res;
  }, Object.keys(MAPS));
  for (const id of Object.keys(MAPS)) check(`${id}: server creates a room on this map and lists 10 pickups`, online[id].map === id && online[id].pk === 10, JSON.stringify(online[id]));
  await w.close();
  check('no console errors / JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('maps run', false, String(e && e.stack ? e.stack : e));
} finally {
  await browser.close();
}
done();
