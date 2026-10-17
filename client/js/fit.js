// Menus (.screen > .panel) fit the window instead of scrolling: CSS `zoom` (it affects layout, unlike transform) shrinks a panel to the
// visible area, never below FLOOR; below that the screen scrolls as before. Runs on resize, when a screen is shown and when a panel's content changes.

export const FLOOR = 0.5;

let queued = false;

export function fitScreens() {
  for (const scr of document.querySelectorAll('.screen')) {
    if (scr.hidden) continue;
    const panel = scr.querySelector(':scope > .panel');
    if (!panel) continue;
    panel.style.zoom = ''; // measure at natural size
    const cs = getComputedStyle(scr);
    const availW = window.innerWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
    const availH = window.innerHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 1;
    const natW = Math.max(panel.offsetWidth, panel.scrollWidth);
    const natH = Math.max(panel.offsetHeight, panel.scrollHeight);
    if (!natW || !natH) continue;
    let z = Math.min(1, availH / natH, availW / natW);
    z = Math.max(FLOOR, Math.floor(z * 1000) / 1000); // below the floor the screen scrolls instead
    if (z < 0.999) {
      panel.style.zoom = String(z);
      // zoomed layout rounds line boxes, so the first guess can be a few px too tall: refine against the real box
      for (let i = 0; i < 3 && z > FLOOR; i++) {
        const r = panel.getBoundingClientRect();
        if (r.height <= availH && r.width <= availW) break;
        z = Math.max(FLOOR, Math.floor(z * Math.min(availH / r.height, availW / r.width) * 1000) / 1000);
        panel.style.zoom = String(z);
      }
    }
    scr.dataset.fit = String(Math.min(1, z));
  }
}

// Coalesce bursts (a resize drag, a table re-render) into one fit per frame.
export function queueFit() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    fitScreens();
  });
}

export function initFit() {
  window.addEventListener('resize', queueFit);
  window.addEventListener('orientationchange', queueFit);
  window.addEventListener('load', queueFit);
  const mo = new MutationObserver(queueFit);
  // hidden toggles (screens, pause sub-sections) and content changes; not `style`, so setting the zoom cannot retrigger the fit
  for (const scr of document.querySelectorAll('.screen')) mo.observe(scr, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true });
  queueFit();
}
