// Firefox extensions that hook Function.prototype.toString break three.js' shader cache key ("Permission denied to access object").
// Simulate one: toString throws for onBeforeCompile. The renderer must still start and practice must run.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
  p.setDefaultTimeout(120000);
  watchErrors(p, errors);
  await p.addInitScript(() => {
    const orig = Function.prototype.toString;
    Function.prototype.toString = function () {
      if (this.name === 'onBeforeCompile') throw new Error('Permission denied to access object');
      return orig.call(this);
    };
  });
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.click('#btn-practice');
  await p.click('#btn-resume');
  await p.waitForFunction(() => window.__sz.game && window.__sz.game.running && window.__sz.game.tickNo > 20);
  check('game runs although Function.prototype.toString throws for onBeforeCompile', true);
  check('no JS errors', errors.length === 0, errors.join('; '));
} catch (e) {
  check('game runs although Function.prototype.toString throws for onBeforeCompile', false, String(e).slice(0, 300));
}
await browser.close();
done();
