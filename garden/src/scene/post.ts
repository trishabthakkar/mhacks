// Optional post-processing: ambient occlusion (things sit in the ground) and a gentle bloom (only over-bright
// highlights: the botanist's light shaft, fireflies). Any failure falls back to a plain render, for good.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Post {
  ok = false;
  private composer?: EffectComposer;
  private ao?: GTAOPass;
  constructor(private r: THREE.WebGLRenderer, private scene: THREE.Scene, private cam: THREE.PerspectiveCamera, o: { ao: boolean; bloom: boolean }) {
    try {
      const size = r.getSize(new THREE.Vector2());
      const c = new EffectComposer(r);
      c.addPass(new RenderPass(scene, cam));
      if (o.ao) {
        this.ao = new GTAOPass(scene, cam, size.x, size.y);
        this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1, samples: 12 });
        this.ao.blendIntensity = 0.85;
        c.addPass(this.ao);
      }
      if (o.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.5, 1.0));
      c.addPass(new OutputPass());
      this.composer = c; this.ok = true;
    } catch (e) { console.warn('post-processing unavailable, rendering plain:', e); }
  }
  /** AO breaks down (dark slabs on the horizon and clouds) when the camera is very far: big gardens zoomed out skip it. */
  setAO(on: boolean) { if (this.ao && this.ao.enabled !== on) this.ao.enabled = on; }
  setSize(w: number, h: number) { if (this.ok) { this.composer!.setPixelRatio(this.r.getPixelRatio()); this.composer!.setSize(w, h); } }
  render() {
    if (this.ok) { try { this.composer!.render(); return; } catch (e) { console.warn('post-processing failed, rendering plain from now on:', e); this.ok = false; } }
    this.r.render(this.scene, this.cam);
  }
}
