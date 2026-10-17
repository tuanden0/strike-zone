// Kill medals in Practice: a headshot kill shows HEADSHOT, a body kill KILL, quick kills stack DOUBLE / TRIPLE / MULTI KILL.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
const text = (p) => p.evaluate(() => document.getElementById('medal').innerText.replace(/\s+/g, ' ').trim());
try {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.click('#btn-practice');
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement);
  await p.waitForFunction(() => window.__sz.game.tickNo > 30);
  check('no medal before any kill', (await text(p)) === '');

  // stand 8 m in front of the static dummy at (0, -14), look straight at its head, pull the trigger
  await p.evaluate(() => { const g = window.__sz.game; g.kin.x = 0; g.kin.z = -6; g.input.yaw = 0; g.input.pitch = 0; });
  await p.mouse.down();
  await p.waitForFunction(() => window.__sz.game.mode.kills >= 1);
  await p.mouse.up();
  check('headshot kill shows HEADSHOT with the victim', (await text(p)).startsWith('HEADSHOT') && (await text(p)).includes('Dummy'), await text(p));
  const cls = await p.evaluate(() => document.querySelector('#medal .m-main').className);
  check('headshot medal is styled as head', cls.includes('head'), cls);

  // knife kill: stand 1.4 m from the dummy at (-5, -12) and slash at its legs/belly (auto-fire, 40 damage, three hits)
  await p.keyboard.press('Digit3');
  await p.waitForFunction(() => window.__sz.game.loadout.weapon.melee);
  await p.evaluate(() => { const g = window.__sz.game; g.kin.x = -5; g.kin.z = -10.6; g.input.yaw = 0; g.input.pitch = -0.7; });
  const k0 = await p.evaluate(() => window.__sz.game.mode.kills);
  await p.mouse.down();
  await p.waitForFunction((k) => window.__sz.game.mode.kills > k, k0);
  await p.mouse.up();
  const knife = await text(p);
  check('knife kill shows KNIFE KILL (DOUBLE KILL when it follows within 4 s)', knife.includes('KNIFE KILL') && knife.includes('Dummy'), knife);

  // streak labels
  const labels = await p.evaluate(() => {
    const h = window.__sz.game.hud;
    h.streak = { n: 0, t: 0 };
    const out = [];
    for (let i = 0; i < 5; i++) { h.killMedal('body', 'X'); out.push(document.querySelector('#medal').innerText.replace(/\s+/g, ' ').trim()); }
    h.streak.t -= 5000; // a pause longer than 4 s starts over
    h.killMedal('knife', 'X');
    out.push(document.querySelector('#medal').innerText.replace(/\s+/g, ' ').trim());
    return out;
  });
  check('streak: KILL, DOUBLE, TRIPLE, MULTI, MULTI, then KNIFE KILL after a pause', labels.join(' | ') === 'KILL X | KILL DOUBLE KILL X | KILL TRIPLE KILL X | KILL MULTI KILL X | KILL MULTI KILL X | KNIFE KILL X', labels.join(' | '));
  check('no JS errors', errors.length === 0, errors.join('; '));
} catch (e) {
  check('e2e run', false, e.stack || String(e));
}
await browser.close();
done();
