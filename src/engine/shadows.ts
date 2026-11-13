import * as THREE from 'three';
import * as CSMShaderModule from 'three/examples/jsm/csm/CSMShader.js';

const CSMShader = (CSMShaderModule as unknown as { CSMShader: { lights_fragment_begin: string; lights_pars_begin: string } }).CSMShader;

/**
 * Cascaded sun shadows.
 *
 * Phase 1 stretched one shadow map over whatever the camera could see (often several kilometres), so anything near
 * the lens — kerbs, cars, awnings, rooftop kit — had no crisp shadow. Now three small camera-centred cascades give
 * centimetre-scale texels up close and the original "whole view" map is kept as the last cascade for the skyline.
 *
 * The GLSL comes from three's CSM addon (`CSMShader`); the light fitting is our own:
 *  - near cascades are spheres centred on the camera, so turning the camera never re-renders or shimmers them;
 *    they only refresh when the camera has travelled out of their padded coverage;
 *  - the far cascade follows the ground the view is aimed at, exactly as the single map did before.
 */
export const CSM_CASCADES = 4;
const NEAR_RANGES = [34, 150, 640];            // view-depth limits (m) of the camera-centred cascades
const PAD = [1.3, 1.25, 1.2];
const SHADOW_FAR = 90000;                      // normalising distance for the cascade uniforms
const BACK = 6500;                             // how far up-light the shadow cameras sit (tall towers, low sun)

/** Shared by every lit material (see `extendMaterial`). */
export const csmUniforms = {
  CSM_cascades: { value: Array.from({ length: CSM_CASCADES }, () => new THREE.Vector2()) },
  cameraNear: { value: 0 },
  shadowFar: { value: SHADOW_FAR },
};
export const csmDefines = { USE_CSM: 1, CSM_CASCADES, CSM_FADE: '' };

let injected = false;
/** Swap three's light chunks for the cascade-aware ones. Must run before the first material compiles. */
export function injectCsmChunks() {
  if (injected) return;
  injected = true;
  THREE.ShaderChunk.lights_fragment_begin = CSMShader.lights_fragment_begin;
  THREE.ShaderChunk.lights_pars_begin = CSMShader.lights_pars_begin;
}

const NEAR_SIZE = [0, 1024, 2048, 2048], FAR_SIZE = [0, 2048, 4096, 4096];

export class SunShadows {
  readonly lights: THREE.DirectionalLight[] = [];
  /** plain light used when shadows are switched off (Low quality) */
  readonly fallback = new THREE.DirectionalLight(0xffffff, 1);
  private centers = NEAR_RANGES.map(() => new THREE.Vector3(1e9, 0, 0));
  private radii = NEAR_RANGES.map(() => 0);
  private enabled = true;
  private quality = -1;
  private captureBoost = false;
  private lastDir = new THREE.Vector3();
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3();
  private lightView = new THREE.Matrix4(); private lightViewInv = new THREE.Matrix4();

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    injectCsmChunks();
    for (let i = 0; i < CSM_CASCADES; i++) {
      const l = new THREE.DirectionalLight(0xffffff, 1);
      l.castShadow = true;
      l.shadow.autoUpdate = false;
      l.shadow.camera.near = 50; l.shadow.camera.far = BACK * 2;
      scene.add(l, l.target);
      this.lights.push(l);
    }
    this.fallback.castShadow = false; this.fallback.visible = false;
    scene.add(this.fallback, this.fallback.target);
    const u = csmUniforms.CSM_cascades.value;
    let prev = 0;
    for (let i = 0; i < CSM_CASCADES; i++) {
      const end = i < NEAR_RANGES.length ? NEAR_RANGES[i] / SHADOW_FAR : 1;
      u[i].set(prev, end); prev = end;
    }
  }

  get far() { return this.lights[CSM_CASCADES - 1]; }
  get castsShadows() { return this.enabled; }

  setLight(color: THREE.Color, intensity: number) {
    for (const l of this.lights) { l.color.copy(color); l.intensity = intensity; }
    this.fallback.color.copy(color); this.fallback.intensity = intensity;
  }

  /** shadowQuality 0 disables shadows (one plain light); 1..3 choose the map sizes. Returns true if maps were re-allocated. */
  setQuality(q: number, capture = false, hugeFar = false): boolean {
    const key = q * 4 + (capture ? 2 : 0) + (hugeFar ? 1 : 0);
    if (key === this.quality) return false;
    this.quality = key; this.captureBoost = capture;
    this.enabled = q > 0;
    for (const l of this.lights) l.visible = this.enabled;
    this.fallback.visible = !this.enabled;
    if (!this.enabled) return true;
    const max = this.renderer.capabilities.maxTextureSize;
    const near = Math.min(max, capture ? 4096 : NEAR_SIZE[q] || 2048);
    const far = Math.min(max, capture ? (hugeFar ? 8192 : 4096) : FAR_SIZE[q] || 4096);
    this.lights.forEach((l, i) => {
      const s = i === CSM_CASCADES - 1 ? far : near;
      if (l.shadow.mapSize.x !== s) { l.shadow.mapSize.set(s, s); l.shadow.map?.dispose(); (l.shadow as any).map = null; }
    });
    for (const c of this.centers) c.set(1e9, 0, 0);
    return true;
  }

  /**
   * Fit the cascades. `force` re-renders everything (light moved, geometry streamed in).
   * `farFit` is the whole-view region computed by the engine; pass null to leave the far cascade as it is.
   */
  update(camera: THREE.PerspectiveCamera, lightDir: THREE.Vector3, force: boolean, farFit: { center: THREE.Vector3; extent: number } | null) {
    if (!this.enabled) {
      this.fallback.target.position.copy(camera.position); this.fallback.position.copy(camera.position).addScaledVector(lightDir, 1000);
      this.fallback.target.updateMatrixWorld();
      return;
    }
    let any = false;
    if (this.lastDir.distanceToSquared(lightDir) > 1e-10) { this.lastDir.copy(lightDir); force = true; }
    // light-space basis for texel snapping
    this.lightView.lookAt(this.tmp.copy(lightDir), this.tmp2.set(0, 0, 0), THREE.Object3D.DEFAULT_UP);
    this.lightViewInv.copy(this.lightView).invert();
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const diag = Math.atan(Math.tan(halfV) * Math.hypot(1, camera.aspect));
    const reach = 1 / Math.max(0.35, Math.cos(Math.min(diag, 1.2)));     // slice corners are further than the slice depth
    for (let i = 0; i < NEAR_RANGES.length; i++) {
      const need = NEAR_RANGES[i] * reach * 1.04;
      const c = this.centers[i];
      const inside = c.distanceTo(camera.position) + need <= this.radii[i];
      if (inside && !force) continue;
      const l = this.lights[i];
      const r = need * (this.captureBoost ? 1.05 : PAD[i]);
      const texel = (2 * r) / l.shadow.mapSize.x;
      // snap the centre to whole texels in light space so the map does not crawl as the camera travels
      this.tmp.copy(camera.position).applyMatrix4(this.lightViewInv);
      this.tmp.x = Math.round(this.tmp.x / texel) * texel; this.tmp.y = Math.round(this.tmp.y / texel) * texel;
      this.tmp.applyMatrix4(this.lightView);
      c.copy(this.tmp); this.radii[i] = r;
      this.place(l, c, r, lightDir, texel, 0.02 + texel * 0.6, texel * 1.8, i === 0 ? 3.2 : 2.4);
      any = true;
    }
    if (farFit) {
      const l = this.far;
      const texel = (farFit.extent * 2) / l.shadow.mapSize.x;
      this.place(l, farFit.center, farFit.extent, lightDir, texel, 1.5, texel * 1.6, 1.8);
      any = true;
    } else if (force) { this.far.shadow.needsUpdate = true; any = true; }
    if (any) this.renderer.shadowMap.needsUpdate = true;
  }

  private place(l: THREE.DirectionalLight, center: THREE.Vector3, r: number, dir: THREE.Vector3, _texel: number, biasM: number, normalBias: number, radius: number) {
    l.target.position.copy(center);
    l.position.copy(center).addScaledVector(dir, BACK);
    const sc = l.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r;
    sc.near = 50; sc.far = BACK * 2;
    sc.updateProjectionMatrix();
    l.shadow.bias = -biasM / (sc.far - sc.near);
    l.shadow.normalBias = normalBias;
    l.shadow.radius = radius;
    l.target.updateMatrixWorld();
    l.shadow.needsUpdate = true;
  }

  dispose() { for (const l of this.lights) l.shadow.map?.dispose(); }
}
