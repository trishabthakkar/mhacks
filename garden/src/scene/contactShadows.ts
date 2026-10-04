// Soft dark blobs under characters and pots: one instanced quad with a radial-gradient texture (grounds things cheaply).
import * as THREE from 'three';

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class ContactShadows {
  private im: THREE.InstancedMesh;
  private n = 0;
  private d = new THREE.Object3D();
  constructor(scene: THREE.Scene, private max = 96) {
    const m = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.7 });
    this.im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), m, max);
    this.im.frustumCulled = false; this.im.renderOrder = 1; this.im.count = 0; scene.add(this.im);
  }
  set visible(v: boolean) { this.im.visible = v; }
  begin() { this.n = 0; }
  add(x: number, z: number, r: number) {
    if (this.n >= this.max) return;
    this.d.position.set(x, 0.035, z); this.d.scale.set(r * 2, 1, r * 2); this.d.updateMatrix();
    this.im.setMatrixAt(this.n++, this.d.matrix);
  }
  end() { this.im.count = this.n; this.im.instanceMatrix.needsUpdate = true; }
}
