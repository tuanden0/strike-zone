import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const d of readdirSync(root).sort().reverse()) {
      const p = `${root}/${d}/chrome-linux/chrome`;
      if (existsSync(p)) return p;
    }
  }
  return undefined; // let playwright-core resolve its own browser
}

// Software GL (no GPU in CI/sandboxes) cannot afford shadows + PBR at full size, so tests default to the game's
// "low" graphics option; set E2E_QUALITY=high to exercise the shadow path (screenshots, perf).
export async function launch() {
  const quality = ['high', 'ultra'].includes(process.env.E2E_QUALITY) ? process.env.E2E_QUALITY : 'low';
  const b = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const newContext = b.newContext.bind(b);
  b.newContext = async (o = {}) => {
    const c = await newContext(o);
    await c.addInitScript((q) => {
      try {
        localStorage.setItem('sz.quality', q);
      } catch {
        // storage blocked: default quality
      }
    }, quality);
    return c;
  };
  b.newPage = async (o = {}) => (await b.newContext(o)).newPage();
  return b;
}

export function watchErrors(page, sink) {
  page.on('console', (m) => {
    if (m.type() === 'error') sink.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
}

let failed = 0;
export function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failed++;
}
export function done() {
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
}
