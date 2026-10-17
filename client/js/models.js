// Characters (skinned glTF with layered animation clips) and name tags.
import * as THREE from '../vendor/three.module.js';
import { clone } from '../vendor/SkeletonUtils.js';

const WEAPON_IDS = ['rifle', 'pistol', 'knife'];
// Muzzle position in each third-person weapon node's local (glTF) space: Blender (x,y,z) -> (x,z,-y).
const MUZZLE = { rifle: [0, 0.066, -0.68], pistol: [0, 0.062, -0.18], knife: null };

function clipMap(gltf) {
  const m = {};
  for (const c of gltf.animations) m[c.name] = c;
  return m;
}

// Scale so the standing model is exactly spec.player.height tall (the hitboxes in spec.json are the truth).
export function fitScale(scene, spec) {
  scene.updateMatrixWorld(true);
  let lo = Infinity;
  let hi = -Infinity;
  scene.traverse((o) => {
    if (o.isSkinnedMesh) {
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
  });
  return spec.player.height / (hi - lo);
}

export function applyAnisotropy(root, aniso) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) for (const k of ['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = aniso;
  });
}

export class Soldier {
  constructor(gltf, spec) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.model = clone(gltf.scene);
    const s = fitScale(this.model, spec);
    this.model.scale.setScalar(s);
    this.group.add(this.model);
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned bounds are rest-pose; avoids pop-out when the pose moves them
      }
    });
    this.weapons = WEAPON_IDS.map((id) => this.model.getObjectByName('w_' + id));
    this.muzzles = WEAPON_IDS.map((id, i) => {
      const m = MUZZLE[id];
      if (!m || !this.weapons[i]) return null;
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, 0.35),
        new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      f.position.set(m[0], m[1], m[2]);
      f.visible = false;
      this.weapons[i].add(f);
      return f;
    });

    const clips = clipMap(gltf);
    this.mixer = new THREE.AnimationMixer(this.model);
    const act = (n, loop = THREE.LoopRepeat) => {
      const a = this.mixer.clipAction(clips[n]);
      a.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
      return a;
    };
    this.idle = act('idle');
    this.run = act('run');
    this.hold = WEAPON_IDS.map((id) => act('hold_' + id));
    this.shootA = WEAPON_IDS.map((id) => act('shoot_' + id, THREE.LoopOnce));
    this.death = act('death', THREE.LoopOnce);
    this.death.clampWhenFinished = true;
    this.idle.play();
    this.run.play();
    this.idle.setEffectiveWeight(1);
    this.run.setEffectiveWeight(0);
    this.cur = -1;
    this.setWeapon(0);
    this.shootT = 0;
    this.dead = false;
    this.flashT = 0;
    this.shadow = true;
  }

  // Distant characters stop casting shadows (cheap LOD for the shadow pass).
  setShadow(on) {
    if (on === this.shadow) return;
    this.shadow = on;
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) o.castShadow = on;
    });
  }

  setWeapon(i) {
    if (i === this.cur) return;
    this.weapons.forEach((w, k) => w && (w.visible = k === i));
    this.hold.forEach((a, k) => {
      if (k === i) a.reset().setEffectiveWeight(1).play();
      else a.stop();
    });
    this.cur = i;
  }

  // Third-person fire: arm recoil clip + muzzle flash.
  fire() {
    const a = this.shootA[this.cur];
    a.reset().play();
    this.shootT = a.getClip().duration;
    this.flashT = 0.05;
  }

  setDead(dead) {
    if (dead === this.dead) return;
    this.dead = dead;
    if (dead) {
      this.death.reset().play();
    } else {
      this.death.stop();
      this.setWeapon(this.cur);
    }
  }

  // speed in m/s on the ground; dt seconds.
  update(dt, speed) {
    if (!this.dead) {
      const w = Math.min(1, speed / 3.5);
      this.run.setEffectiveWeight(w);
      this.idle.setEffectiveWeight(1 - w);
      this.run.setEffectiveTimeScale(Math.min(1.35, Math.max(0.6, speed / 5.5)));
      const shooting = this.shootT > 0;
      this.shootT = Math.max(0, this.shootT - dt);
      this.hold[this.cur].setEffectiveWeight(shooting ? 0 : 1);
      this.shootA[this.cur].setEffectiveWeight(shooting ? 1 : 0);
    } else {
      this.run.setEffectiveWeight(0);
      this.idle.setEffectiveWeight(0);
      this.hold[this.cur].setEffectiveWeight(0);
      this.shootA[this.cur].setEffectiveWeight(0);
    }
    this.mixer.update(dt);
    this.flashT -= dt;
    const mf = this.muzzles[this.cur];
    this.muzzles.forEach((m) => m && (m.visible = false));
    if (mf && this.flashT > 0 && !this.dead) {
      mf.visible = true;
      mf.rotation.set(0, 0, Math.random() * 3);
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.muzzles.forEach((m) => m && (m.material.dispose(), m.geometry.dispose()));
  }
}

let _flashTex = null;
export function flashTexture() {
  if (_flashTex) return _flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 60);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.25, 'rgba(255,200,90,0.85)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  g.fillStyle = 'rgba(255,230,160,0.9)';
  for (let i = 0; i < 6; i++) {
    g.rotate((Math.PI * 2) / 6);
    g.beginPath();
    g.moveTo(-5, 0);
    g.lineTo(0, -62);
    g.lineTo(5, 0);
    g.fill();
  }
  _flashTex = new THREE.CanvasTexture(c);
  _flashTex.colorSpace = THREE.SRGBColorSpace;
  return _flashTex;
}

export function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 28px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(text, 128, 24);
  g.fillStyle = color;
  g.fillText(text, 128, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.3, 1);
  s.renderOrder = 10;
  return s;
}
