// Procedural map rendering: geometry from shared/map.json, textures drawn on canvas.
import * as THREE from '../vendor/three.module.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size, rng(size * 7 + 13));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noise(g, s, r, amt) {
  for (let i = 0; i < s * s * 0.06; i++) {
    const v = Math.floor(r() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${amt})`;
    g.fillRect(r() * s, r() * s, 2, 2);
  }
}

const painters = {
  wall(g, s, r) {
    g.fillStyle = '#7d848e';
    g.fillRect(0, 0, s, s);
    const bh = s / 8;
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? s / 8 : 0;
      for (let col = -1; col < 4; col++) {
        const sh = 110 + Math.floor(r() * 40);
        g.fillStyle = `rgb(${sh},${sh + 6},${sh + 14})`;
        g.fillRect(col * (s / 4) + off + 2, row * bh + 2, s / 4 - 4, bh - 4);
      }
    }
    noise(g, s, r, 0.12);
  },
  crate(g, s, r) {
    g.fillStyle = '#a0723b';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) {
      const sh = 130 + Math.floor(r() * 30);
      g.fillStyle = `rgb(${sh + 20},${sh - 15},${sh - 60})`;
      g.fillRect(0, (i * s) / 6 + 1, s, s / 6 - 2);
    }
    g.strokeStyle = '#4a2f12';
    g.lineWidth = s / 14;
    g.strokeRect(s / 28, s / 28, s - s / 14, s - s / 14);
    g.lineWidth = s / 24;
    g.beginPath();
    g.moveTo(s / 10, s / 10);
    g.lineTo(s - s / 10, s - s / 10);
    g.moveTo(s - s / 10, s / 10);
    g.lineTo(s / 10, s - s / 10);
    g.stroke();
    noise(g, s, r, 0.1);
  },
  floor(g, s, r) {
    g.fillStyle = '#9aa0a6';
    g.fillRect(0, 0, s, s);
    const n = 4;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const sh = 150 + Math.floor(r() * 22);
        g.fillStyle = `rgb(${sh},${sh + 2},${sh + 6})`;
        g.fillRect((x * s) / n + 2, (y * s) / n + 2, s / n - 4, s / n - 4);
      }
    noise(g, s, r, 0.14);
  },
  outer(g, s, r) {
    g.fillStyle = '#394252';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#2b3342';
    for (let i = 0; i < 4; i++) g.fillRect(0, (i * s) / 4, s, 4);
    g.fillStyle = '#e0b43a';
    for (let i = 0; i < s; i += s / 4) {
      g.beginPath();
      g.moveTo(i, s - 12);
      g.lineTo(i + s / 8, s - 12);
      g.lineTo(i + s / 8 - 10, s);
      g.lineTo(i - 10, s);
      g.fill();
    }
    noise(g, s, r, 0.1);
  },
};

export const TEAM_COLORS = { A: 0x3b82f6, B: 0xef4444 };

export function buildWorld(map) {
  const group = new THREE.Group();
  const base = {};
  for (const k of Object.keys(painters)) base[k] = canvasTexture(128, painters[k]);

  const mats = (mat, w, h, d) => {
    const t = base[mat].clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(Math.max(w, d) / 2)), Math.max(1, Math.round(h / 2)));
    return new THREE.MeshLambertMaterial({ map: t });
  };

  for (const b of map.raw) {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats(b.mat, w, h, d));
    mesh.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
    group.add(mesh);
  }

  const bd = map.bounds;
  const fw = bd.maxX - bd.minX;
  const fd = bd.maxZ - bd.minZ;
  const ft = base.floor.clone();
  ft.needsUpdate = true;
  ft.repeat.set(fw / 4, fd / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), new THREE.MeshLambertMaterial({ map: ft }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((bd.minX + bd.maxX) / 2, 0, (bd.minZ + bd.maxZ) / 2);
  group.add(floor);

  // Team spawn zone markings.
  for (const [team, z] of [['A', 20], ['B', -20]]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 4),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.28 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(0.5, 0.01, z);
    group.add(m);
  }
  return group;
}

export function buildLights(scene) {
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x707070, 1.4));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
  sun.position.set(-20, 40, 15);
  scene.add(sun);
  scene.background = new THREE.Color(0x9cc3e6);
  scene.fog = new THREE.Fog(0x9cc3e6, 40, 110);
}
