import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface FitBox { minX: number; maxX: number; minZ: number; maxZ: number }
export type Preset = 'overview' | 'top' | 'low';

const ELEV: Record<Preset, number> = {
  overview: THREE.MathUtils.degToRad(38),
  top: THREE.MathUtils.degToRad(76),
  low: THREE.MathUtils.degToRad(14),
};
const MIN_DIST = 4, MIN_Y = 0.6;

/**
 * Camera control on top of OrbitControls: fits the whole scene into the part of the screen the shed
 * doesn't cover, eases between views, and adds keyboard control. Nothing here allocates per frame.
 */
export class CameraRig {
  /** True once the user orbited/panned/zoomed by hand; stops automatic re-fitting until Reframe. */
  userMoved = false;
  private goalTarget = new THREE.Vector3();
  private goalPos = new THREE.Vector3();
  private hasGoal = false;
  private keys = new Set<string>();
  private reserved = 0;
  private reservedB = 0;
  private lastBox: FitBox = { minX: -10, maxX: 10, minZ: -6, maxZ: 8 };
  private lastPreset: Preset = 'overview';
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private off = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  calm = false;
  /** True while a cinematic push-in (botanist) owns the camera. */
  cinema = false;
  private saved?: { pos: THREE.Vector3; target: THREE.Vector3 };

  constructor(private camera: THREE.PerspectiveCamera, private controls: OrbitControls, private host: HTMLElement) {
    controls.minDistance = MIN_DIST;
    controls.maxDistance = 90;
    controls.addEventListener('start', () => { this.userMoved = true; this.hasGoal = false; });
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.keys.clear());
  }

  /** Pixels on the right covered by the shed; the scene is centered in the remaining space. */
  setReserved(px: number, bottom = 0) {
    this.reserved = Math.max(0, px);
    this.reservedB = Math.max(0, bottom);
    this.applyViewOffset();
  }

  applyViewOffset() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    if (this.reserved > 0 || this.reservedB > 0) this.camera.setViewOffset(w, h, this.reserved / 2, this.reservedB / 2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e', '+', '=', '-', '_'].includes(k)) {
      if (down) this.keys.add(k); else this.keys.delete(k);
      if (down) { this.userMoved = true; this.hasGoal = false; }
    } else if (down && (k === '1' || k === '2' || k === '3')) {
      this.fit(this.lastBox, k === '1' ? 'overview' : k === '2' ? 'top' : 'low');
    }
  }

  get reservedRight() { return this.reserved; }
  get reservedBottom() { return this.reservedB; }

  /** Glide to look at `point`, keeping the current distance and direction. */
  flyTo(point: THREE.Vector3) {
    if (this.cinema) return;
    this.off.subVectors(this.camera.position, this.controls.target);
    this.goalTarget.set(point.x, 0.4, point.z);
    this.goalPos.copy(this.goalTarget).add(this.off);
    this.hasGoal = true; this.userMoved = true;
  }

  get keyboardActive() { return this.keys.size > 0; }

  /** Ease in to a close shot of `point`, keeping the current viewing direction. Remembers the old view for release(). */
  pushIn(point: THREE.Vector3, dist = 6) {
    if (this.cinema) return;
    this.saved = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    this.cinema = true;
    this.off.subVectors(this.camera.position, this.controls.target).setY(0);
    if (this.off.lengthSq() < 1e-6) this.off.set(0, 0, 1);
    this.off.normalize();
    this.goalTarget.set(point.x, 0.7, point.z);
    this.goalPos.set(point.x + this.off.x * dist, 3.0, point.z + this.off.z * dist);
    this.hasGoal = true;
  }

  /** Return to the view from before pushIn(), unless the user took over in the meantime. */
  release() {
    if (!this.cinema) return;
    this.cinema = false;
    if (this.saved && !this.userMoved) { this.goalPos.copy(this.saved.pos); this.goalTarget.copy(this.saved.target); this.hasGoal = true; }
    this.saved = undefined;
  }

  /**
   * Fit the box into the usable area. `instant` jumps; otherwise the camera eases there.
   * Distance is set so the box fills the free width/height with a small margin.
   */
  /** Returns the viewing distance the fit needs (the world scales fog and limits to it). */
  fit(box: FitBox, preset: Preset = this.lastPreset, instant = false): number {
    this.lastBox = box; this.lastPreset = preset;
    if (this.cinema) return this.camera.position.distanceTo(this.controls.target); // box remembered; release() restores the view
    const w = (this.host.clientWidth || innerWidth), h = (this.host.clientHeight || innerHeight);
    const freeAspect = Math.max(0.5, (w - this.reserved) / Math.max(120, h - this.reservedB));
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * freeAspect);
    const elev = ELEV[preset];
    const halfW = (box.maxX - box.minX) / 2, halfD = (box.maxZ - box.minZ) / 2;
    const dH = (halfW * 1.03) / Math.tan(hfov / 2);
    // Near rows look bigger than far ones, so deeper gardens need extra room at the bottom.
    const dV = ((halfD * Math.sin(elev) + 1.6 * Math.cos(elev)) * (1.08 + Math.min(0.4, halfD / 70))) / Math.tan(vfov / 2);
    const dist = Math.max(9, Math.max(dH, dV));
    this.controls.maxDistance = Math.max(90, dist * 1.5);
    this.goalTarget.set((box.minX + box.maxX) / 2, 0.4, (box.minZ + box.maxZ) / 2);
    this.goalPos.set(this.goalTarget.x, this.goalTarget.y + Math.sin(elev) * dist, this.goalTarget.z + Math.cos(elev) * dist);
    this.userMoved = false;
    if (instant) {
      this.camera.position.copy(this.goalPos); this.controls.target.copy(this.goalTarget); this.hasGoal = false; this.controls.update();
    } else this.hasGoal = true;
    return dist;
  }

  /** Per-frame: ease toward the goal, apply held keys, keep the camera above ground. */
  update(dt: number) {
    if (this.hasGoal) {
      const t = 1 - Math.exp(-dt * (this.calm ? 8 : 3.5));
      this.camera.position.lerp(this.goalPos, t);
      this.controls.target.lerp(this.goalTarget, t);
      if (this.camera.position.distanceToSquared(this.goalPos) < 1e-4) this.hasGoal = false;
    }
    if (this.keys.size) {
      const dist = this.camera.position.distanceTo(this.controls.target);
      this.fwd.subVectors(this.controls.target, this.camera.position).setY(0);
      if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1); else this.fwd.normalize();
      this.right.crossVectors(this.fwd, this.up);
      const pan = dist * 0.7 * dt;
      let dx = 0, dz = 0;
      if (this.keys.has('arrowup')) { dx += this.fwd.x; dz += this.fwd.z; }
      if (this.keys.has('arrowdown')) { dx -= this.fwd.x; dz -= this.fwd.z; }
      if (this.keys.has('arrowright')) { dx += this.right.x; dz += this.right.z; }
      if (this.keys.has('arrowleft')) { dx -= this.right.x; dz -= this.right.z; }
      if (dx || dz) { this.camera.position.x += dx * pan; this.camera.position.z += dz * pan; this.controls.target.x += dx * pan; this.controls.target.z += dz * pan; }
      const spin = (this.keys.has('q') ? 1 : 0) - (this.keys.has('e') ? 1 : 0);
      if (spin) {
        this.off.subVectors(this.camera.position, this.controls.target);
        const a = spin * 1.1 * dt, c = Math.cos(a), s = Math.sin(a);
        const x = this.off.x * c + this.off.z * s, z = -this.off.x * s + this.off.z * c;
        this.camera.position.set(this.controls.target.x + x, this.camera.position.y, this.controls.target.z + z);
      }
      const zoom = (this.keys.has('+') || this.keys.has('=') ? 1 : 0) - (this.keys.has('-') || this.keys.has('_') ? 1 : 0);
      if (zoom) {
        this.off.subVectors(this.camera.position, this.controls.target);
        const k = THREE.MathUtils.clamp(Math.exp(-zoom * 1.0 * dt), 0.9, 1.1);
        const len = THREE.MathUtils.clamp(this.off.length() * k, MIN_DIST, this.controls.maxDistance);
        this.off.setLength(len);
        this.camera.position.copy(this.controls.target).add(this.off);
      }
    }
    if (this.camera.position.y < MIN_Y) this.camera.position.y = MIN_Y;
  }
}
