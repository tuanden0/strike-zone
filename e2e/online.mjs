// Two real browsers join one room through the lobby UI and see each other. Needs a running server.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
const gameReady = () => window.__sz && window.__sz.game && window.__sz.game.running;

async function open(nick) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 300 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000); // software GL: wait on state, not sleeps
  page.setDefaultTimeout(180000); // software GL: wait on state, not sleeps
  watchErrors(page, errors);
  await page.goto(BASE);
  await page.waitForFunction(() => window.__sz && window.__sz.map);
  await page.fill('#nick', nick);
  await page.click('#btn-online');
  await page.waitForSelector('#screen-lobby:not([hidden])');
  return page;
}

try {
  const a = await open('Alice');
  const b = await open('Bob');
  check('lobby visible', await a.isVisible('#screen-lobby'));

  await a.fill('#c-name', 'E2E Room');
  await a.selectOption('#pref-team', 'A');
  await a.click('#create-form button[type=submit]');
  await a.waitForFunction(gameReady);
  check('creator entered the game', true);

  await b.selectOption('#pref-team', 'B');
  await b.waitForFunction(() => document.getElementById('room-body').textContent.includes('E2E Room')); // stale rooms of earlier runs can be listed first
  check('room listed for second client', (await b.textContent('#room-body')).includes('E2E Room'));
  await b.locator('#room-body tr', { hasText: 'E2E Room' }).locator('button').click();
  await b.waitForFunction(gameReady);
  check('joiner entered the game', true);

  for (const p of [a, b]) {
    await p.click('#btn-resume');
    await p.waitForFunction(() => document.pointerLockElement && document.pointerLockElement.id === 'view');
  }
  await a.waitForFunction(() => window.__sz.game.remotes.size === 1, null, { timeout: 8000 });
  check('each client renders the other player', true);
  check('opposite teams', (await a.evaluate(() => window.__sz.game.myTeam)) !== (await b.evaluate(() => window.__sz.game.myTeam)));

  // Alice walks; Bob must see Alice's remote view move (server-synced).
  const bobSees = () => b.evaluate(() => { const r = [...window.__sz.game.remotes.values()][0]; return r ? r.group.position.z : null; });
  const z0 = await bobSees();
  await a.keyboard.down('KeyW');
  await a.waitForFunction(() => Math.abs(window.__sz.game.kin.z - 20) > 2.5 && Math.abs(window.__sz.game.kin.z + 20) > 2.5);
  await a.keyboard.up('KeyW');
  await b.waitForFunction((z) => { const r = [...window.__sz.game.remotes.values()][0]; return r && Math.abs(r.group.position.z - z) > 1; }, z0);
  const z1 = await bobSees();
  check('Bob sees Alice move', z0 !== null && z1 !== null && Math.abs(z1 - z0) > 1, `z ${z0} -> ${z1}`);

  const posA = await a.evaluate(() => ({ z: window.__sz.game.kin.z }));
  check('Alice predicted position moved', Math.abs(posA.z - 20) > 1 || Math.abs(posA.z + 20) > 1);
  // Harder movement: strafe + jump + walk toggles, then compare prediction against the server.
  await a.keyboard.down('KeyD');
  await a.keyboard.down('Space');
  await a.keyboard.down('KeyW');
  const t0 = await a.evaluate(() => window.__sz.game.tickNo);
  await a.waitForFunction((t) => window.__sz.game.tickNo > t + 40, t0);
  await a.keyboard.down('ShiftLeft');
  await a.waitForFunction((t) => window.__sz.game.tickNo > t + 60, t0);
  await a.keyboard.up('ShiftLeft');
  for (const k of ['KeyD', 'Space', 'KeyW']) await a.keyboard.up(k);
  // Firing: client-predicted ammo must settle to the server's count.
  await a.mouse.down();
  await a.waitForFunction(() => window.__sz.game.loadout.mag[0] < 28);
  await a.mouse.up();
  const t1 = await a.evaluate(() => window.__sz.game.tickNo);
  await a.waitForFunction((t) => window.__sz.game.tickNo > t + 40, t1); // let snapshots catch up
  const ammo = await a.evaluate(() => ({ local: window.__sz.game.loadout.mag[0], server: window.__sz.game.mode.me.mag[0] }));
  check('predicted ammo equals server ammo after firing', ammo.local === ammo.server && ammo.server < 30, JSON.stringify(ammo));
  const corr = await a.evaluate(() => window.__sz.game.mode.maxCorr);
  check('prediction matches server (max correction < 5 cm)', corr < 0.05, `max ${corr.toFixed(4)} m`);

  // Lag compensation hint: the view tick sent with inputs is a little behind the newest snapshot (remote players are drawn ~100 ms late)
  const vt = await a.evaluate(() => { const m = window.__sz.game.mode; const k = m.snapLog.at(-1).k; return { vt: m.viewTick(), k }; });
  check('inputs carry a view tick 1..10 ticks behind the newest snapshot (lag compensation)', vt.vt > 0 && vt.k - vt.vt >= 0 && vt.k - vt.vt <= 10, JSON.stringify(vt));

  // Client reaction to server events (synthetic events through the real handler).
  await b.evaluate(() => {
    const m = window.__sz.game.mode;
    m.onEvent({ e: 'hit', by: m.myId, v: 99, w: 0, dmg: 120, head: true });
    m.onEvent({ e: 'kill', by: m.myId, v: [...m.roster.keys()].find((k) => k !== m.myId), w: 0, head: true });
  });
  check('hitmarker shown on hit event', await b.evaluate(() => document.getElementById('hitmarker').classList.contains('on')));
  const feed = await b.textContent('#killfeed');
  check('killfeed shows killer, weapon, headshot and victim', feed.includes('Bob') && feed.includes('Alice') && feed.includes('HS'), feed);
  check('HUD shows ping', (await a.textContent('#ping')).includes('ping'));
  // Crouch: Alice holds Shift; Bob must see her crouch (stance goes through the server), and prediction must still match
  await a.keyboard.down('ShiftLeft');
  await a.keyboard.down('KeyS');
  await a.waitForFunction(() => window.__sz.game.mode.me.cr === true && window.__sz.game.kin.crouch === true);
  await b.waitForFunction(() => { const r = [...window.__sz.game.remotes.values()][0]; return r.char.crouch === true && r.char.cw > 0.5; });
  check('Bob sees Alice crouch (stance synced; crouch pose blended in)', true);
  if (process.env.SHOTS_DIR) {
    await b.evaluate(() => { const g = window.__sz.game; const r = [...g.remotes.values()][0]; const p = r.group.position; g.debugCam = { pos: [p.x + 2.2, 1.2, p.z + 2.2], look: [p.x, 0.7, p.z] }; });
    await b.waitForFunction(() => new Promise((res) => { let k = 0; const f = () => (++k > 8 ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await b.screenshot({ path: `${process.env.SHOTS_DIR}/crouch_remote.jpg`, type: 'jpeg', quality: 85 });
    await b.evaluate(() => { window.__sz.game.debugCam = null; });
  }
  const t2 = await a.evaluate(() => window.__sz.game.tickNo);
  await a.waitForFunction((t) => window.__sz.game.tickNo > t + 45, t2);
  await a.keyboard.up('KeyS');
  await a.keyboard.up('ShiftLeft');
  await a.waitForFunction(() => window.__sz.game.mode.me.cr === false);
  await b.waitForFunction(() => { const r = [...window.__sz.game.remotes.values()][0]; return r.char.crouch === false; });
  const corr2 = await a.evaluate(() => window.__sz.game.mode.maxCorr);
  check('crouching and standing up keep the prediction within 5 cm of the server', corr2 < 0.05, `max ${corr2.toFixed(4)} m`);
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('online run', false, String(e));
} finally {
  await browser.close();
}
done();
