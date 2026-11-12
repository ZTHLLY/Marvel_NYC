import * as THREE from 'three';
import type { CameraMode, CamReadout } from '../state/store';
import { clamp } from '../util/rng';

const DEG = Math.PI / 180;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export interface Shot { pos: [number, number, number]; target: [number, number, number]; fov?: number }

/** look direction from heading (deg clockwise from north) & pitch (deg, + up) */
function lookDir(yaw: number, pitch: number, out = new THREE.Vector3()) {
  const y = yaw * DEG, p = pitch * DEG;
  return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}

/**
 * Cinematic camera: damped orbit + free-fly modes sharing one pose, with eased
 * transitions to bookmarks / landmarks.
 */
export class CameraRig {
  mode: CameraMode = 'orbit';
  // goal state
  target = new THREE.Vector3(0, 120, 0);
  dist = 1800; yaw = 30; pitch = -18; roll = 0;
  pos = new THREE.Vector3();
  // smoothed state
  private sTarget = new THREE.Vector3(); private sDist = 1800; private sYaw = 30; private sPitch = -18; private sRoll = 0;
  private sPos = new THREE.Vector3();
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number; shift: boolean; alt: boolean } | null = null;
  private vel = new THREE.Vector3();
  speedMult = 1;
  private trans: { t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Quaternion; q1: THREE.Quaternion; shot: Shot; arc: number } | null = null;
  moving = false;
  /** optional scene picker for double-click focus */
  pick: ((ndcX: number, ndcY: number) => THREE.Vector3 | null) | null = null;
  onUserInput: (() => void) | null = null;
  private disposers: (() => void)[] = [];

  constructor(public camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(dom, 'pointerdown', (e: PointerEvent) => {
      dom.setPointerCapture(e.pointerId);
      this.drag = { button: e.button, x: e.clientX, y: e.clientY, shift: e.shiftKey, alt: e.altKey };
      this.cancelTransition();
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    on(dom, 'pointermove', (e: PointerEvent) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.onDrag(dx, dy, this.drag.button, this.drag.shift || e.shiftKey, this.drag.alt || e.altKey);
    });
    const up = (e: PointerEvent) => { this.drag = null; try { dom.releasePointerCapture(e.pointerId); } catch { /* not captured */ } };
    on(dom, 'pointerup', up); on(dom, 'pointercancel', up);
    on(dom, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      this.cancelTransition();
      if (this.mode === 'orbit') this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.0011), 2.5, 40000);
      else this.speedMult = clamp(this.speedMult * Math.exp(-e.deltaY * 0.0012), 0.05, 40);
      this.onUserInput?.();
    }, { passive: false });
    on(dom, 'dblclick', (e: MouseEvent) => {
      if (!this.pick) return;
      const r = dom.getBoundingClientRect();
      const hit = this.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (!hit) return;
      if (this.mode === 'orbit') { this.target.copy(hit); this.dist = clamp(this.camera.position.distanceTo(hit) * 0.75, 6, 40000); }
      this.onUserInput?.();
    });
    const isTyping = () => { const el = document.activeElement; return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName); };
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (isTyping() || e.metaKey || e.ctrlKey) return;
      const k = e.code;
      if (/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Space|ShiftLeft|ShiftRight)$/.test(k)) {
        this.keys.add(k);
        if (k !== 'ShiftLeft' && k !== 'ShiftRight') { this.cancelTransition(); this.onUserInput?.(); }
        if (k === 'Space' || k.startsWith('Arrow')) e.preventDefault();
      }
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    this.syncSmooth();
  }

  private onDrag(dx: number, dy: number, button: number, shift: boolean, alt: boolean) {
    this.onUserInput?.();
    if (this.mode === 'orbit') {
      if (button === 0 && !shift && !alt) {
        this.yaw -= dx * 0.22; this.pitch = clamp(this.pitch - dy * 0.18, -89, 60);
      } else if (button === 1 || alt) {
        this.target.y = Math.max(0, this.target.y + dy * this.dist * 0.0012);
      } else {
        // pan along the ground plane
        const k = this.dist * 0.0011;
        const y = this.yaw * DEG;
        const rx = Math.cos(y), rz = Math.sin(y);          // right
        const fx = Math.sin(y), fz = -Math.cos(y);         // forward (flat)
        this.target.x += -dx * k * rx + dy * k * fx;
        this.target.z += -dx * k * rz + dy * k * fz;
      }
    } else {
      this.yaw += dx * 0.14; this.pitch = clamp(this.pitch - dy * 0.14, -89, 89);
    }
  }

  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    const dir = lookDir(this.sYaw, this.sPitch, tmp);
    if (mode === 'fly') {
      this.pos.copy(this.camera.position); this.sPos.copy(this.pos);
    } else {
      // pivot where the view ray meets the ground (bounded)
      const h = this.camera.position.y;
      const d = dir.y < -0.05 ? clamp(h / -dir.y, 10, 6000) : clamp(h * 2 + 150, 60, 3000);
      this.dist = this.sDist = d;
      this.target.copy(this.camera.position).addScaledVector(dir, d);
      this.sTarget.copy(this.target);
    }
    this.yaw = this.sYaw; this.pitch = this.sPitch;
    this.mode = mode;
  }

  cancelTransition() {
    if (!this.trans) return;
    this.adoptCameraPose();
    this.trans = null;
  }

  /** Read the current camera transform back into rig state (after a transition / external set). */
  private adoptCameraPose(targetHint?: THREE.Vector3) {
    this.camera.updateMatrixWorld();
    const dir = this.camera.getWorldDirection(tmp);
    const yaw = Math.atan2(dir.x, -dir.z) / DEG, pitch = Math.asin(clamp(dir.y, -1, 1)) / DEG;
    this.yaw = this.sYaw = yaw; this.pitch = this.sPitch = pitch;
    this.pos.copy(this.camera.position); this.sPos.copy(this.pos);
    const d = targetHint ? this.camera.position.distanceTo(targetHint) : this.sDist;
    this.dist = this.sDist = d;
    this.target.copy(this.camera.position).addScaledVector(dir, d);
    this.sTarget.copy(this.target);
  }

  private syncSmooth() {
    this.sTarget.copy(this.target); this.sDist = this.dist; this.sYaw = this.yaw; this.sPitch = this.pitch; this.sRoll = this.roll;
    this.pos.copy(this.target).addScaledVector(lookDir(this.yaw, this.pitch, tmp), -this.dist);
    this.sPos.copy(this.pos);
  }

  /** Jump or glide to a composed shot. */
  flyTo(shot: Shot, instant = false) {
    const p1 = new THREE.Vector3(...shot.pos), tg = new THREE.Vector3(...shot.target);
    const m = new THREE.Matrix4().lookAt(p1, tg, new THREE.Vector3(0, 1, 0));
    const q1 = new THREE.Quaternion().setFromRotationMatrix(m);
    this.roll = 0;
    if (instant) {
      this.camera.position.copy(p1); this.camera.quaternion.copy(q1);
      this.trans = null; this.sRoll = 0;
      this.adoptCameraPose(tg);
      return;
    }
    const p0 = this.camera.position.clone();
    const d = p0.distanceTo(p1);
    this.trans = { t: 0, dur: clamp(1.3 + d / 2600, 1.5, 4.4), p0, p1, q0: this.camera.quaternion.clone(), q1, shot, arc: d > 700 ? Math.min(d * 0.12, 450) : 0 };
  }

  setPose(p: Partial<CamReadout>) {
    this.cancelTransition();
    const cur = this.readout();
    const n = { ...cur, ...p };
    this.roll = n.roll;
    this.yaw = this.sYaw = n.heading; this.pitch = this.sPitch = clamp(n.pitch, -89, 89);
    const dir = lookDir(this.yaw, this.pitch, tmp);
    this.pos.set(n.x, Math.max(1, n.y), n.z); this.sPos.copy(this.pos);
    this.target.copy(this.pos).addScaledVector(dir, this.dist); this.sTarget.copy(this.target);
  }

  readout(): CamReadout {
    const c = this.camera.position;
    let h = this.sYaw % 360; if (h < 0) h += 360;
    return { x: c.x, y: c.y, z: c.z, heading: h, pitch: this.sPitch, roll: this.sRoll };
  }

  get transitioning() { return !!this.trans; }

  update(dt: number) {
    const cam = this.camera;
    const before = tmp2.copy(cam.position);
    const qBefore = cam.quaternion.clone();
    if (this.trans) {
      const tr = this.trans;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const e = tr.t < 0.5 ? 4 * tr.t ** 3 : 1 - Math.pow(-2 * tr.t + 2, 3) / 2;
      cam.position.lerpVectors(tr.p0, tr.p1, e);
      cam.position.y += Math.sin(Math.PI * e) * tr.arc;
      cam.quaternion.slerpQuaternions(tr.q0, tr.q1, e);
      if (tr.t >= 1) { this.trans = null; this.adoptCameraPose(new THREE.Vector3(...tr.shot.target)); }
      this.moving = true;
      return;
    }
    const k = 1 - Math.exp(-dt * 9);
    if (this.mode === 'fly') {
      const dir = lookDir(this.yaw, this.pitch, tmp);
      const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      const wish = new THREE.Vector3();
      const K = this.keys;
      if (K.has('KeyW') || K.has('ArrowUp')) wish.add(dir);
      if (K.has('KeyS') || K.has('ArrowDown')) wish.sub(dir);
      if (K.has('KeyD') || K.has('ArrowRight')) wish.add(right);
      if (K.has('KeyA') || K.has('ArrowLeft')) wish.sub(right);
      if (K.has('KeyE') || K.has('Space')) wish.y += 1;
      if (K.has('KeyQ')) wish.y -= 1;
      const base = clamp(this.pos.y * 0.55, 7, 700) * this.speedMult * (K.has('ShiftLeft') || K.has('ShiftRight') ? 4 : 1);
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(base);
      this.vel.lerp(wish, 1 - Math.exp(-dt * 6));
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = Math.max(1.2, this.pos.y);
      this.sPos.lerp(this.pos, 1 - Math.exp(-dt * 14));
    } else {
      // WASD pans the orbit pivot
      const K = this.keys;
      if (K.size) {
        const y = this.yaw * DEG, sp = this.dist * 0.9 * dt * (K.has('ShiftLeft') || K.has('ShiftRight') ? 3 : 1);
        const f = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
        const s = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
        this.target.x += (Math.sin(y) * f + Math.cos(y) * s) * sp; this.target.z += (-Math.cos(y) * f + Math.sin(y) * s) * sp;
        this.target.y = Math.max(0, this.target.y + ((K.has('KeyE') || K.has('Space') ? 1 : 0) - (K.has('KeyQ') ? 1 : 0)) * sp * 0.6);
      }
      this.sTarget.lerp(this.target, k);
      this.sDist += (this.dist - this.sDist) * k;
    }
    this.sYaw += (this.yaw - this.sYaw) * k;
    this.sPitch += (this.pitch - this.sPitch) * k;
    this.sRoll += (this.roll - this.sRoll) * k;
    const dir = lookDir(this.sYaw, this.sPitch, tmp);
    if (this.mode === 'orbit') {
      cam.position.copy(this.sTarget).addScaledVector(dir, -this.sDist);
      if (cam.position.y < 1.2) cam.position.y = 1.2;
      this.pos.copy(cam.position);
    } else cam.position.copy(this.sPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(dir.x + cam.position.x, dir.y + cam.position.y, dir.z + cam.position.z);
    if (Math.abs(this.sRoll) > 0.01) cam.rotateZ(-this.sRoll * DEG);
    this.moving = before.distanceToSquared(cam.position) > 1e-6 || Math.abs(qBefore.dot(cam.quaternion)) < 0.9999999;
  }

  dispose() { this.disposers.forEach((d) => d()); }
}
