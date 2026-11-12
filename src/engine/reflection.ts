import * as THREE from 'three';
import { U } from './materials';

/**
 * Planar reflection of the world about the ground plane (y = 0).
 * A single mirrored render feeds both the rivers and wet streets.
 */
export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  private cam = new THREE.PerspectiveCamera();
  private normal = new THREE.Vector3(0, 1, 0);
  private view = new THREE.Vector3(); private look = new THREE.Vector3(); private tgt = new THREE.Vector3();
  private rot = new THREE.Matrix4(); private camPos = new THREE.Vector3();
  enabled = true;

  constructor(w: number, h: number) {
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.generateMipmaps = false;
    U.uReflTex.value = this.target.texture;
    this.cam.layers.set(0);
  }

  setSize(w: number, h: number) { this.target.setSize(Math.max(64, Math.floor(w)), Math.max(64, Math.floor(h))); }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    if (this.camPos.y <= 0.05) return;
    this.rot.extractRotation(camera.matrixWorld);
    this.view.copy(this.camPos).negate().reflect(this.normal).negate();        // mirrored eye position
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.tgt.copy(this.look).negate().reflect(this.normal).negate();           // mirrored look-at
    const v = this.cam;
    v.position.copy(this.view);
    v.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    v.lookAt(this.tgt);
    v.near = camera.near; v.far = camera.far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);
    v.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    U.uReflMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, v);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
  }

  dispose() { this.target.dispose(); }
}
