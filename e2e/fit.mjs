// Menus fit the window: no scrollbars on html/body (and none on the screen above the 0.5 zoom floor) at several window sizes for the
// title, lobby and pause screens; HUD / touch controls stay inside the window at the small sizes. Needs a running server.
//   BASE_URL=http://localhost:18081 SHOTS_DIR=../docs/screenshots node fit.mjs
import { launch, watchErrors, check, done } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const SIZES = [[1280, 720], [1024, 600], [800, 360], [480, 300]];
const browser = await launch();
const errors = [];

const settle = (p) => p.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => res())))));
const metrics = (p) =>
  p.evaluate(() => {
    const de = document.documentElement;
    const b = document.body;
    const scr = [...document.querySelectorAll('.screen')].find((s) => !s.hidden);
    const panel = scr && scr.querySelector('.panel');
    const r = panel && panel.getBoundingClientRect();
    return {
      docOk: de.scrollHeight <= innerHeight && de.scrollWidth <= innerWidth && b.scrollHeight <= innerHeight && b.scrollWidth <= innerWidth,
      doc: [de.scrollWidth, de.scrollHeight, b.scrollWidth, b.scrollHeight],
      scrollbar: scr ? scr.scrollHeight > scr.clientHeight + 1 || scr.scrollWidth > scr.clientWidth + 1 : false,
      zoom: panel ? panel.style.zoom || '1' : '-',
      panel: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] : null,
      inside: r ? r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 : true,
    };
  });

async function sweep(p, name) {
  for (const [w, h] of SIZES) {
    await p.setViewportSize({ width: w, height: h });
    await settle(p);
    const m = await metrics(p);
    const floored = Number(m.zoom) <= 0.5001; // below the floor the screen scrolls by design
    check(`${name} @${w}x${h}: no scrollbars on html/body`, m.docOk, JSON.stringify(m.doc));
    check(`${name} @${w}x${h}: panel fits the window (zoom ${m.zoom}) without a menu scrollbar${floored ? ' [at the 0.5 floor: scrolling is the fallback]' : ''}`, floored || (!m.scrollbar && m.inside), JSON.stringify(m));
    if (SHOTS && (name !== 'pause (online)' || w === 480)) await p.screenshot({ path: `${SHOTS}/fit_${name.replace(/[^a-z]+/g, '_')}_${w}x${h}.jpg`, type: 'jpeg', quality: 80 });
  }
}

// HUD + touch controls inside the window
async function hudInside(p, name) {
  const bad = await p.evaluate(() => {
    const out = [];
    const roots = [document.getElementById('hud'), document.getElementById('touch')];
    for (const root of roots) {
      if (root.hidden) continue;
      for (const el of root.querySelectorAll('*')) {
        if (el.closest('[hidden]') || el.id === 't-rotate' || el.id === 'scoreboard') continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${el.id || el.className || el.tagName}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
    }
    return out;
  });
  check(`${name}: HUD / touch elements stay inside the window`, bad.length === 0, bad.join(' '));
}

try {
  // ---- title + practice pause + HUD, desktop and touch ----
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.setDefaultTimeout(180000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.map && !document.getElementById('btn-practice').disabled);
  await sweep(p, 'title');
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.fill('#nick', 'Fit');
  await p.click('#btn-online');
  await p.waitForSelector('#screen-lobby:not([hidden])');
  await sweep(p, 'lobby');
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.fill('#c-name', 'Fit Room');
  await p.click('#create-form button[type=submit]');
  await p.waitForFunction(() => window.__sz.game && window.__sz.game.running);
  await p.waitForSelector('#screen-pause:not([hidden])');
  check('online pause screen shows team + bot controls', await p.evaluate(() => !document.getElementById('pause-team').hidden && !document.getElementById('pause-bots').hidden));
  await sweep(p, 'pause (online)');
  await p.setViewportSize({ width: 800, height: 360 });
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement);
  await p.waitForFunction(() => window.__sz.game.tickNo > 10);
  await hudInside(p, 'desktop HUD @800x360');
  await p.setViewportSize({ width: 480, height: 300 });
  await settle(p);
  await hudInside(p, 'desktop HUD @480x300');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/fit_hud_480x300.jpg`, type: 'jpeg', quality: 80 });
  await p.close();

  const q = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  q.setDefaultTimeout(180000);
  watchErrors(q, errors);
  await q.goto(BASE);
  await q.waitForFunction(() => window.__sz && window.__sz.map && !document.getElementById('btn-practice').disabled);
  await q.click('#btn-practice');
  await q.waitForSelector('#screen-pause:not([hidden])');
  await sweep(q, 'pause (practice)');
  await q.close();

  // touch phone: HUD + controls at 800x360 and 480x300
  for (const [w, h] of [[800, 360], [480, 300]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const t = await ctx.newPage();
    t.setDefaultTimeout(180000);
    watchErrors(t, errors);
    await t.goto(`${BASE}/?touch=1`);
    await t.waitForFunction(() => window.__sz && window.__sz.map && !document.getElementById('btn-practice').disabled);
    await t.evaluate(() => document.getElementById('btn-practice').click());
    await t.waitForSelector('#screen-pause:not([hidden])');
    const m = await metrics(t);
    check(`touch pause @${w}x${h}: no scrollbars on html/body`, m.docOk, JSON.stringify(m));
    await t.evaluate(() => document.getElementById('btn-resume').click());
    await t.waitForFunction(() => window.__sz.input.locked && window.__sz.game.tickNo > 10);
    await hudInside(t, `touch HUD @${w}x${h}`);
    if (SHOTS) await t.screenshot({ path: `${SHOTS}/fit_touch_${w}x${h}.jpg`, type: 'jpeg', quality: 80 });
    await ctx.close();
  }
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('fit run', false, String(e));
} finally {
  await browser.close();
}
done();
