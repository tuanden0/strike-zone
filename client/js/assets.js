// Loads the generated .glb models (see tools/assets/). Everything is local; no network beyond this server.
import { TextureLoader } from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const BASE = 'assets/models/';
// Needed for every match; other maps are loaded on demand (see main.js ensureMap).
export const CORE_FILES = ['map', 'character_a', 'character_b', 'rifle_fp', 'pistol_fp', 'knife_fp', 'sniper_fp', 'rifle', 'pistol', 'sniper'];
export const MODEL_FILES = [...CORE_FILES, 'knife', 'map_crossroads', 'map_piazza', 'map_pyramid', 'map_canyon', 'map_harbor', 'map_bunker', 'map_office'];

function loadOne(loader, name, onBytes) {
  return new Promise((resolve, reject) => {
    loader.load(
      `${BASE}${name}.glb`,
      (gltf) => resolve(gltf),
      (ev) => onBytes && onBytes(name, ev.loaded, ev.total),
      (err) => reject(new Error(`${name}.glb: ${err && err.message ? err.message : 'failed to load'}`)),
    );
  });
}

// files: subset of MODEL_FILES to load (the game needs CORE_FILES; tests load all).
//
// safeImages: decode embedded textures through <img> elements instead of createImageBitmap/fetch(blob:). GLTFLoader picks
// ImageBitmapLoader on modern Firefox/Chrome; some browsers/extensions block that path, so main.js retries with this.
export async function loadAssets(files = CORE_FILES, onProgress = () => {}, { safeImages = false } = {}) {
  const loader = new GLTFLoader();
  if (safeImages) {
    loader.register((parser) => {
      parser.textureLoader = new TextureLoader(parser.options.manager);
      return { name: 'sz_safe_images' };
    });
  }
  const loaded = {};
  const total = {};
  const report = (name, l, t) => {
    loaded[name] = l;
    total[name] = t || total[name] || 0;
    const L = Object.values(loaded).reduce((a, b) => a + b, 0);
    const T = Object.values(total).reduce((a, b) => a + b, 0);
    onProgress(T ? L / T : 0);
  };
  const res = await Promise.all(files.map((n) => loadOne(loader, n, report)));
  const out = {};
  files.forEach((n, i) => (out[n] = res[i]));
  onProgress(1);
  return out;
}
