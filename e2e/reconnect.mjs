// A client whose socket drops mid-match gets its seat back (same player id, rotated token) without going through the lobby.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
const ROOM = `Drop ${Date.now()}`; // a room left by an earlier run stays listed for the 30 s seat hold
const gameReady = () => window.__sz && window.__sz.game && window.__sz.game.running;

async function open(nick) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 300 } });
  const page = await ctx.newPage();
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
  await a.fill('#c-name', ROOM);
  await a.selectOption('#pref-team', 'A');
  await a.click('#create-form button[type=submit]');
  await a.waitForFunction(gameReady);
  await b.selectOption('#pref-team', 'B');
  const row = b.locator('#room-body tr', { hasText: ROOM });
  await row.waitFor();
  await row.locator('button').click();
  await b.waitForFunction(gameReady);
  for (const p of [a, b]) {
    await p.click('#btn-resume');
    await p.waitForFunction(() => document.pointerLockElement && document.pointerLockElement.id === 'view');
  }
  await a.waitForFunction(() => window.__sz.game.remotes.size === 1);

  const before = await a.evaluate(() => ({ id: window.__sz.game.mode.myId, tok: window.__sz.net.token, z: window.__sz.game.kin.z }));
  check('token issued at welcome', /^[0-9a-f]{32}$/.test(before.tok));

  // the network dies: cut Alice's socket from the client side
  await a.evaluate(() => {
    window.__sz.connLog = [];
    window.__sz.net.onStatus0 = window.__sz.net.onStatus;
    window.__sz.net.onStatus = (s) => {
      window.__sz.connLog.push(s);
      window.__sz.net.onStatus0(s);
    };
    window.__sz.net.ws.close();
  });
  await a.waitForFunction(() => window.__sz.connLog.includes('down'));
  check('client reported the link as down', true);
  await a.waitForFunction(() => window.__sz.connLog.includes('up'));
  check('overlay hidden after resume', await a.evaluate(() => document.getElementById('conn').hidden));
  const after = await a.evaluate(() => ({ id: window.__sz.game.mode.myId, tok: window.__sz.net.token, running: window.__sz.game.running, online: window.__sz.online }));
  check('still in the match, not bounced to the lobby', after.running && after.online);
  check('token rotated by the server', /^[0-9a-f]{32}$/.test(after.tok) && after.tok !== before.tok);

  // snapshots reach the new socket and inputs are accepted: walk, and the server-confirmed position follows
  await a.keyboard.down('KeyW');
  await a.waitForFunction((z) => Math.abs(window.__sz.game.kin.z - z) > 2, before.z);
  await a.keyboard.up('KeyW');
  const z1 = await a.evaluate(() => window.__sz.game.kin.z);
  check('moves after resume', Math.abs(z1 - before.z) > 2, `z ${before.z} -> ${z1}`);
  const corr = await a.evaluate(() => window.__sz.game.mode.maxCorr);
  check('prediction stays near the server after resume (< 50 cm)', corr < 0.5, `max ${corr.toFixed(3)} m`);

  // Bob never lost Alice (seat held while away) and still sees her
  check('Bob still sees Alice', (await b.evaluate(() => window.__sz.game.remotes.size)) === 1);
  const myId = await a.evaluate(() => window.__sz.game.mode.myId);
  check('same player id', myId === before.id);

  check('no JS errors', errors.length === 0, errors.join('; '));
} catch (e) {
  check('e2e run', false, e.stack || String(e));
}
await browser.close();
done();
