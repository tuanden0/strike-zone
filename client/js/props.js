// Optional imported props (client/assets/manifest.json). Everything here is non-fatal: if the manifest, a glb or a
// browser feature (e.g. webp textures) is missing, the prop is skipped and the generated map renders as before.
// Props are visual only: no collision, never part of the simulation, placed on surfaces the player cannot reach.
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone } from '../vendor/SkeletonUtils.js';
import { applyAnisotropy } from './models.js';

const BASE = 'assets/';

export class Props {
  constructor() {
    this.items = []; // {def, scene}
    this.skipped = []; // {id, reason}
  }

  // Loads the manifest and every prop, each independently. Never throws.
  static async load() {
    const p = new Props();
    let manifest;
    try {
      const r = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      manifest = await r.json();
    } catch (e) {
      p.skipped.push({ id: '*', reason: `manifest: ${e.message}` });
      return p;
    }
    const loader = new GLTFLoader();
    await Promise.all(
      (manifest.props || []).map(async (def) => {
        try {
          const gltf = await loader.loadAsync(`${BASE}${def.file}`);
          p.items.push({ def, scene: p.normalize(def, gltf.scene) });
        } catch (e) {
          p.skipped.push({ id: def.id, reason: String(e && e.message ? e.message : e) });
        }
      }),
    );
    if (p.skipped.length) console.warn('props skipped:', p.skipped);
    return p;
  }

  // Apply the manifest's scale and move the pivot to bottom-centre so a placement's y is the surface height.
  normalize(def, scene) {
    const root = new THREE.Group();
    scene.scale.multiplyScalar(def.scale || 1);
    root.add(scene);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (def.expectedSize) {
      const bad = size.toArray().some((v, i) => Math.abs(v - def.expectedSize[i]) > 0.05 * def.expectedSize[i] + 1e-3);
      if (bad) throw new Error(`size ${size.toArray().map((v) => v.toFixed(3))} != expected ${def.expectedSize}`);
    }
    if (def.pivot === 'bottom-center') scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    return root;
  }

  // Group of clones for one map id (added to the world group, so it goes away with the map).
  build(mapId, aniso = 1) {
    const g = new THREE.Group();
    g.name = 'props';
    for (const { def, scene } of this.items) {
      for (const pl of def.placements || []) {
        if (pl.map !== mapId) continue;
        const o = clone(scene);
        o.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
        o.rotation.y = pl.yaw || 0;
        o.traverse((m) => {
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        applyAnisotropy(o, aniso);
        o.userData.propId = def.id;
        g.add(o);
      }
    }
    return g;
  }
}
