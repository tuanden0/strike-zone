// Low-poly characters and weapons assembled from primitives. Hitbox dims come from spec.json.
import * as THREE from '../vendor/three.module.js';

const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const part = (w, h, d, color, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
};

// Weapon models point down -Z, grip at origin. Used for both view model and held weapon.
export function createWeaponModel(id) {
  const g = new THREE.Group();
  if (id === 'rifle') {
    g.add(part(0.06, 0.1, 0.55, 0x2d3036, 0, 0, -0.2));
    g.add(part(0.035, 0.035, 0.3, 0x15171a, 0, 0.02, -0.62));
    g.add(part(0.05, 0.16, 0.08, 0x1d1f23, 0, -0.12, -0.15));
    g.add(part(0.05, 0.12, 0.22, 0x4a3b2a, 0, -0.02, 0.18));
    g.add(part(0.04, 0.06, 0.1, 0x15171a, 0, 0.08, -0.1));
    g.add(part(0.045, 0.1, 0.05, 0x1d1f23, 0, -0.1, 0.03));
  } else if (id === 'pistol') {
    g.add(part(0.045, 0.07, 0.24, 0x3a3d44, 0, 0.02, -0.1));
    g.add(part(0.04, 0.12, 0.06, 0x1d1f23, 0, -0.07, 0.0));
    g.add(part(0.025, 0.025, 0.06, 0x15171a, 0, 0.03, -0.24));
  } else {
    g.add(part(0.025, 0.05, 0.3, 0xcfd6dd, 0, 0.0, -0.22));
    g.add(part(0.03, 0.035, 0.12, 0x222428, 0, -0.01, 0.0));
    g.add(part(0.06, 0.02, 0.025, 0x888e96, 0, 0, -0.06));
  }
  return g;
}

const SKIN = 0xe0b48f;

// Returns {group, setWeapon(idx), animate(speed, t), muzzle, setDead(bool, k)}.
export function createCharacter(spec, teamColor, weaponIds) {
  const p = spec.player;
  const g = new THREE.Group();
  const bw = p.body.halfWidth * 2;
  const legH = 0.72;
  const torsoH = p.body.y1 - legH;
  const dark = new THREE.Color(teamColor).multiplyScalar(0.55).getHex();

  const rig = new THREE.Group();
  g.add(rig);
  const legL = part(0.26, legH, 0.28, 0x2c313a, -0.15, -legH / 2, 0);
  const legR = part(0.26, legH, 0.28, 0x2c313a, 0.15, -legH / 2, 0);
  const hipL = new THREE.Group();
  hipL.position.set(0, legH, 0);
  hipL.add(legL);
  const hipR = new THREE.Group();
  hipR.position.set(0, legH, 0);
  hipR.add(legR);
  rig.add(hipL, hipR);
  rig.add(part(bw, torsoH, 0.34, teamColor, 0, legH + torsoH / 2, 0));
  rig.add(part(bw + 0.02, 0.12, 0.36, dark, 0, legH + 0.06, 0));

  const hh = p.head.y1 - p.head.y0;
  const hw = p.head.halfWidth * 2;
  const head = part(hw, hh, hw, SKIN, 0, p.head.y0 + hh / 2, 0);
  rig.add(head);
  rig.add(part(hw + 0.02, hh * 0.45, hw + 0.02, dark, 0, p.head.y0 + hh * 0.8, 0)); // helmet
  rig.add(part(hw - 0.04, 0.07, 0.03, 0x10141a, 0, p.head.y0 + hh * 0.5, -hw / 2 - 0.005)); // visor

  const shoulderY = legH + torsoH - 0.18;
  const armR = part(0.12, 0.12, 0.5, teamColor, 0.3, shoulderY, -0.22);
  const armL = part(0.12, 0.12, 0.45, teamColor, -0.22, shoulderY, -0.28);
  armL.rotation.y = -0.35;
  rig.add(armR, armL);

  const weapons = weaponIds.map((id) => {
    const m = createWeaponModel(id);
    m.position.set(0.3, shoulderY - 0.02, -0.5);
    m.visible = false;
    rig.add(m);
    return m;
  });
  const muzzle = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  );
  muzzle.position.set(0.3, shoulderY, -1.2);
  muzzle.visible = false;
  rig.add(muzzle);

  return {
    group: g,
    muzzle,
    setWeapon(i) {
      weapons.forEach((w, k) => (w.visible = k === i));
    },
    animate(speed, t) {
      const a = Math.sin(t * 9) * Math.min(1, speed / 5) * 0.8;
      hipL.rotation.x = a;
      hipR.rotation.x = -a;
    },
    // k in 0..1: 0 standing, 1 fully fallen.
    setDead(k) {
      rig.rotation.x = -k * (Math.PI / 2);
      rig.position.y = k * 0.25;
    },
  };
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
