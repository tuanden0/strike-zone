// Weapons lying on the ground (map spawn points + dropped weapons). The list comes from the server (`pk` messages);
// this only renders it and works out which one is in reach for the "[E] pick up" prompt.
import * as THREE from '../vendor/three.module.js';
import { clone } from '../vendor/SkeletonUtils.js';

const RING_COLORS = [0xffa63a, 0x4ad0ff, 0xcccccc, 0xb06bff];

export class Pickups {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.items = new Map(); // id -> {data, root, pivot, ring, phase}
    this.nearest = null;
    this.t = 0;
    this.ringGeo = new THREE.RingGeometry(0.5, 0.68, 40);
  }

  clear() {
    for (const it of this.items.values()) this.group.remove(it.root);
    this.items.clear();
    this.nearest = null;
  }

  _make(p) {
    const game = this.game;
    const wid = game.spec.weapons[p.w].id;
    const src = game.assets[wid];
    const root = new THREE.Group();
    const pivot = new THREE.Group();
    const model = clone(src.scene);
    model.rotation.z = Math.PI / 2; // lie on its side
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.frustumCulled = false;
      }
    });
    root.add(pivot);
    pivot.add(model);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -box.min.y, -c.z);
    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: RING_COLORS[p.w] ?? 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    root.add(ring);
    root.position.set(p.x, p.y, p.z);
    this.group.add(root);
    return { data: p, root, pivot, ring, phase: p.id * 1.7 };
  }

  // Replace the whole list (server sends it whole whenever anything changes).
  setList(list) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, it] of this.items) {
      if (!ids.has(id)) {
        this.group.remove(it.root);
        this.items.delete(id);
      }
    }
    for (const p of list) {
      const it = this.items.get(p.id);
      if (it) it.data = p;
      else this.items.set(p.id, this._make(p));
    }
  }

  update(dt) {
    this.t += dt;
    const r = this.game.spec.pickups.radius;
    const k = this.game.kin;
    let best = null;
    let bd = Infinity;
    for (const it of this.items.values()) {
      const ph = this.t * 1.4 + it.phase;
      it.pivot.rotation.y = this.t * 0.9 + it.phase;
      it.pivot.position.y = 0.16 + Math.sin(ph) * 0.05;
      it.ring.material.opacity = 0.45 + 0.25 * Math.sin(ph * 1.5);
      const d = Math.hypot(it.data.x - k.x, it.data.z - k.z);
      if (this.game.alive && d <= r && Math.abs(it.data.y - k.y) < 1.6 && d < bd) {
        best = it.data;
        bd = d;
      }
    }
    this.nearest = best;
  }
}
