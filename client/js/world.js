// Map rendering from the generated map.glb + lighting/environment (PBR, ACES, shadows).
import * as THREE from '../vendor/three.module.js';
import { applyAnisotropy } from './models.js';

export const TEAM_COLORS = { A: 0xef4444, B: 0x3b82f6 };
export const SHADOW_EXTENT = 32;

export function buildWorld(map, glbScene, aniso) {
  const group = new THREE.Group();
  const model = glbScene;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.matrixAutoUpdate = false; // static
    }
  });
  applyAnisotropy(model, aniso);
  group.add(model);

  // Team spawn zone markings (painted on the floor), sized from the spawn points of each team.
  for (const team of ['A', 'B']) {
    const sp = map.spawns[team];
    const xs = sp.map((s) => s.x);
    const zs = sp.map((s) => s.z);
    const x0 = Math.min(...xs) - 2;
    const x1 = Math.max(...xs) + 2;
    const z0 = Math.min(...zs) - 2;
    const z1 = Math.max(...zs) + 2;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, z1 - z0),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    m.renderOrder = 1;
    m.userData.own = true; // geometry and material belong to this world (Game.setMap disposes them)
    group.add(m);
  }
  return group;
}

// Fit the sun's shadow frustum to the map (diagonal of the bounds).
export function fitShadow(sun, map) {
  const b = map.bounds;
  const ext = Math.hypot(Math.max(Math.abs(b.minX), b.maxX), Math.max(Math.abs(b.minZ), b.maxZ)) * 1.03;
  const sc = sun.shadow.camera;
  sc.left = -ext;
  sc.right = ext;
  sc.top = ext;
  sc.bottom = -ext;
  sc.updateProjectionMatrix();
}

// Procedural sky dome -> PMREM environment so metals/polymers get reflections (no HDR files needed).
export function buildEnvironment(renderer) {
  const sky = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 24, 16);
  const col = [];
  const p = geo.attributes.position;
  const top = new THREE.Color(0.30, 0.52, 0.95);
  const hor = new THREE.Color(0.88, 0.92, 1.0);
  const gnd = new THREE.Color(0.30, 0.29, 0.28);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 50;
    if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
    else c.copy(hor).lerp(gnd, Math.min(1, -y * 3));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  sky.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // a bright "sun" patch so specular highlights have something to reflect
  const sun = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7.2, 6) }));
  sun.position.set(-25, 38, 18);
  sky.add(sun);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(sky, 0.02).texture;
  pm.dispose();
  return tex;
}

export function buildLights(scene, env, shadows) {
  scene.environment = env;
  scene.environmentIntensity = 0.75;
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b665e, 0.5));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.position.set(-20, 38, 17);
  sun.castShadow = shadows;
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_EXTENT;
  sc.right = SHADOW_EXTENT;
  sc.top = SHADOW_EXTENT;
  sc.bottom = -SHADOW_EXTENT;
  sc.near = 5;
  sc.far = 100;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.08;
  scene.add(sun);
  scene.add(sun.target);
  scene.background = new THREE.Color(0x9cc3e6);
  scene.fog = new THREE.Fog(0xaecbe6, 45, 120);
  return sun;
}
