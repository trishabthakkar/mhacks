import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/** One animated character instance: its root, and a cross-fading `play`. */
export interface Character { root: THREE.Object3D; play(clip: string): void; update(dt: number): void; bone(name: string): THREE.Object3D | undefined }

/**
 * Rigged, animated people (Kenney "Mini Characters", CC0) loaded from /models/kenney/. Loading is lazy and fails open:
 * until a model arrives (or if it never does) the procedural figure stays.
 */
export class CharacterKit {
  private loader = new GLTFLoader();
  private models = new Map<string, Promise<GLTF | undefined>>();

  /** Resolves to a fresh animated copy of `name`, or undefined if it couldn't load. */
  async make(name: string): Promise<Character | undefined> {
    let p = this.models.get(name);
    if (!p) {
      p = this.loader.loadAsync(`${import.meta.env.BASE_URL}models/kenney/${name}.glb`).catch((e) => { console.warn('character failed to load', name, e); return undefined; });
      this.models.set(name, p);
    }
    const gltf = await p;
    if (!gltf) return undefined;
    const root = SkeletonUtils.clone(gltf.scene);
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(root);
    const clips = new Map(gltf.animations.map((c) => [c.name, c]));
    let current: THREE.AnimationAction | undefined, currentName = '';
    return {
      root,
      play(clip: string) {
        if (clip === currentName) return;
        const c = clips.get(clip) ?? clips.get('idle'); if (!c) return;
        const next = mixer.clipAction(c);
        next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
        current?.fadeOut(0.2);
        current = next; currentName = clip;
      },
      update(dt: number) { mixer.update(dt); },
      bone(name: string) { return root.getObjectByName(name); },
    };
  }
}
