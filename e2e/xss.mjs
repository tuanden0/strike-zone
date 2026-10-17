// Hostile nicknames / room names must render as plain text everywhere (textContent only).
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
const NICK = '<b>bold</b>';
const ROOM = '<img src=x onerror=_x=1>';

async function open(nick) {
  const page = await (await browser.newContext({ viewport: { width: 480, height: 300 } })).newPage();
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
  const evil = await open(NICK);
  const victim = await open('Victim');
  await evil.fill('#c-name', ROOM);
  await evil.click('#create-form button[type=submit]');
  await evil.waitForFunction(() => window.__sz.game && window.__sz.game.running);

  await victim.waitForSelector('#room-body tr');
  check('room name shown literally in lobby', (await victim.textContent('#room-body')).includes(ROOM));
  check('no element injected into room list', (await victim.locator('#room-body img, #room-body b').count()) === 0);
  await victim.click('#room-body button');
  await victim.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  await victim.click('#btn-resume');
  await victim.waitForFunction(() => document.pointerLockElement);
  await victim.keyboard.down('Tab');
  await victim.waitForSelector('#scoreboard:not([hidden])');
  const board = await victim.textContent('#scoreboard');
  check('hostile nick shown literally on scoreboard', board.includes(NICK), board);
  check('no element injected into scoreboard', (await victim.locator('#scoreboard b, #scoreboard img').count()) === 0);
  await victim.evaluate(() => {
    const m = window.__sz.game.mode;
    const evilId = [...m.roster.keys()].find((k) => k !== m.myId);
    m.onEvent({ e: 'kill', by: evilId, v: m.myId, w: 0, head: false });
  });
  check('no element injected into kill feed', (await victim.locator('#killfeed b, #killfeed img').count()) === 0);
  check('no script ran', (await victim.evaluate(() => window._x)) === undefined && (await evil.evaluate(() => window._x)) === undefined);
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('xss run', false, String(e));
} finally {
  await browser.close();
}
done();
