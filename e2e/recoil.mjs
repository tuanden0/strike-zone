// Recoil model in the browser (practice mode): kick scales with damage, sustained fire ramps kick and widens spread.
import { launch, watchErrors, check, done } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await launch();
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 480, height: 270 } });
  p.setDefaultTimeout(240000);
  watchErrors(p, errors);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__sz && window.__sz.assets);
  await p.click('#btn-practice');
  await p.click('#btn-resume');
  await p.waitForFunction(() => document.pointerLockElement);
  await p.waitForFunction(() => window.__sz.game.tickNo > 30);

  // log the view-pitch kick of every locally fired shot
  await p.evaluate(() => {
    const g = window.__sz.game;
    g.__kicks = [];
    const orig = g.onLocalWeapon.bind(g);
    g.onLocalWeapon = (res, cmd) => {
      const before = g.input.pitch;
      const p0 = g.punch;
      orig(res, cmd);
      if (res.fired) g.__kicks.push({ w: g.loadout.cur, burst: g.loadout.burst, dp: g.punch - p0 });
    };
    g.mode.targets.forEach((t) => { t.alive = false; t.respawnAt = 1e9; }); // nothing to hit: only the view matters
  });

  const static_ = await p.evaluate(async () => {
    const { kick, bloom, spread } = await import('/js/weapons.js');
    const spec = window.__sz.spec;
    const guns = spec.weapons.map((w, i) => ({ i, id: w.id, dmg: w.damage, melee: w.melee, kick: kick(spec, w), bloom12: bloom(spec, w, 12), sp12: spread(spec, w, false, 0, 12), sp1: spread(spec, w, false, 0, 1) }));
    return guns;
  });
  const fire = static_.filter((g) => !g.melee).sort((a, b) => a.dmg - b.dmg);
  check('kick grows with damage across firearms', fire.every((g, i) => i === 0 || g.kick > fire[i - 1].kick), JSON.stringify(fire.map((g) => [g.id, g.dmg, +g.kick.toFixed(4)])));
  check('knife has no kick', static_.find((g) => g.melee).kick === 0);
  const rifle = static_.find((g) => g.id === 'rifle');
  check('rifle spread widens with sustained fire (burst 12 > burst 1)', rifle.sp12 > rifle.sp1 * 3, `${rifle.sp1} -> ${rifle.sp12.toFixed(4)}`);
  check('sniper does not bloom (scope/movement handle its accuracy)', static_.find((g) => g.id === 'sniper').sp12 === static_.find((g) => g.id === 'sniper').sp1);

  // hold the trigger: kick per shot must ramp up, first kick must equal the damage-derived value
  await p.evaluate(() => { const g = window.__sz.game; g.input.yaw = 0; g.input.pitch = 0; g.__kicks.length = 0; });
  await p.mouse.down();
  await p.waitForFunction(() => window.__sz.game.__kicks.length >= 11);
  await p.mouse.up();
  const ks = await p.evaluate(() => window.__sz.game.__kicks.slice(0, 11));
  check('first shot kicks exactly kick(rifle) = perDamage * damage', Math.abs(ks[0].dp - rifle.kick) < 1e-6, `${ks[0].dp} vs ${rifle.kick}`);
  check('burst counter climbs 1..11 while the trigger is held', ks.every((k, i) => k.burst === i + 1), JSON.stringify(ks.map((k) => k.burst)));
  check('kick ramps up during the burst (shot 11 > 1.5x shot 1)', ks[10].dp > ks[0].dp * 1.5, `${ks[0].dp.toFixed(4)} -> ${ks[10].dp.toFixed(4)}`);
  await p.waitForFunction(() => window.__sz.game.loadout.burstUntil < window.__sz.game.tickNo);
  await p.evaluate(() => { const g = window.__sz.game; g.__kicks.length = 0; });
  await p.mouse.click(240, 135);
  await p.waitForFunction(() => window.__sz.game.__kicks.length >= 1);
  check('after a pause the next shot starts a fresh burst (kick back to base)', await p.evaluate((k) => { const x = window.__sz.game.__kicks[0]; return x.burst === 1 && Math.abs(x.dp - k) < 1e-6; }, rifle.kick));

  // sniper (practice owns one): its single shot kicks more than the rifle's first shot
  await p.keyboard.press('Digit4');
  await p.waitForFunction(() => window.__sz.game.loadout.cur === 3 && window.__sz.game.switchT === 0);
  await p.evaluate(() => { const g = window.__sz.game; g.__kicks.length = 0; });
  await p.waitForFunction(() => window.__sz.game.loadout.nextFire <= window.__sz.game.tickNo);
  await p.mouse.click(240, 135);
  await p.waitForFunction(() => window.__sz.game.__kicks.length >= 1);
  const sk = await p.evaluate(() => window.__sz.game.__kicks[0]);
  check('sniper shot kicks harder than a rifle shot (damage 100 vs 30)', sk.dp > rifle.kick * 2.5, `${sk.dp.toFixed(4)} vs ${rifle.kick.toFixed(4)}`);
  // the sniper's kick is a visible jolt: aim climbs >= 4 degrees, the camera trails behind the aim at first (no snap), shakes, then settles back
  check('sniper kick is at least 4 degrees', sk.dp > 0.07, `${(sk.dp * 57.3).toFixed(1)} deg`);
  const vis = await p.evaluate(() => { const g = window.__sz.game; return { lag: g.camLag, shake: g.shake, punch: g.punch }; });
  check('right after the shot the camera trails the aim and the view shakes', vis.shake > 0.1 && vis.punch > 0.05, JSON.stringify(vis));
  await p.waitForFunction(() => window.__sz.game.punch < 0.001, null, { timeout: 60000 });
  const settled = await p.evaluate(() => window.__sz.game.camLag);
  check('the kick settles: aim and camera come back', settled < 0.002, `lag ${settled}`);
  check('no JS errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('recoil run', false, String(e));
} finally {
  await browser.close();
}
done();
