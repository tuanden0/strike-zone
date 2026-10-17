// Joining a room on a map that is not loaded yet: the roster the server sends right after `joined` must not be lost while the map downloads
// (the joiner used to see "?" names, no scoreboard and every remote as team A).
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
const ROOM = `Roster ${Date.now()}`;
async function open(nick) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 300 } }); // a fresh context: nothing cached, the canyon glb is downloaded on join
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
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
  await a.selectOption('#c-map', 'canyon');
  await a.selectOption('#pref-team', 'A');
  await a.click('#create-form button[type=submit]');
  await a.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  await b.selectOption('#pref-team', 'B');
  const row = b.locator('#room-body tr', { hasText: ROOM });
  await row.waitFor();
  await row.locator('button').click();
  await b.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  const r = await b.evaluate(() => { const m = window.__sz.game.mode; return { roster: [...m.roster.values()].map((p) => `${p.nick}:${p.team}`).sort(), board: document.getElementById('board') ? document.getElementById('board').innerText : '' }; });
  check('the joiner knows both players right after entering (roster not lost during the map download)', r.roster.join() === 'Alice:A,Bob:B', JSON.stringify(r.roster));
  await b.waitForFunction(() => window.__sz.game.remotes.size === 1);
  const alice = await b.evaluate(() => { const v = [...window.__sz.game.remotes.values()][0]; return { team: v.team, nick: v.nick, label: !!v.label }; });
  check('Alice is shown as team A with her name (not "?" / default team)', alice.team === 'A' && alice.nick === 'Alice', JSON.stringify(alice));
  check('no JS errors', errors.length === 0, errors.join('; '));
} catch (e) {
  check('e2e run', false, e.stack || String(e));
}
await browser.close();
done();
