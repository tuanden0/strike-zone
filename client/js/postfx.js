// Optional "Ultra" look: screen-space ambient occlusion (GTAO) + a touch of bloom, tone-mapped by OutputPass.
// Only used when Graphics = Ultra; High/Low keep the plain renderer path. The first-person weapon pass is drawn after this
// (see Game.frame), so weapons are not darkened by AO. MSAA render targets keep edges clean.
import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from '../vendor/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

export class PostFx {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, s.x, s.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 1.8; // default 1 is barely visible on this map's light floors
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.5, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(s.x, s.y), 0.22, 0.55, 0.92); // strength, radius, threshold: only hot highlights glow
    this.composer.addPass(this.bloom);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass); // tone mapping + sRGB, from renderer.toneMapping
  }

  // Call after renderer.setSize / setPixelRatio.
  resize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.outputPass.dispose();
    this.gtao.dispose();
    this.bloom.dispose();
  }
}
