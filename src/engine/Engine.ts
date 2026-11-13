import * as THREE from 'three';
import { useStore, bus } from '../state/store';
import { Params, REGEN_KEYS } from '../state/params';
import { BOOKMARKS } from '../state/presets';
import { SITES } from '../landmarks/sites';
import { loadCityData, CityData } from '../city/geo';
import { StylePalette, facadeUniforms } from '../city/facade';
import { ChunkManager } from '../city/chunks';
import { buildGround, buildTrees, GroundBuild } from '../city/ground';
import { computeAtmosphere, Sky, AtmoState } from './atmosphere';
import { U } from './materials';
import { CameraRig } from './cameraRig';
import { Post } from './post';
import { PlanarReflection } from './reflection';
import { clamp } from '../util/rng';
import { WorldExtras, buildWorldExtras } from '../world';
import { capturePhoto } from '../photo/capture';

const PIXEL_RATIO: Record<string, number> = { low: 1, medium: 1.25, high: 1.5, ultra: 2 };
const SHADOW_SIZE = [0, 2048, 4096, 4096];

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 2, 90000);
  rig: CameraRig;
  post: Post;
  sky: Sky;
  refl: PlanarReflection;
  sun = new THREE.DirectionalLight(0xffffff, 1);
  hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
  atmo!: AtmoState;
  palette = new StylePalette();
  chunks: ChunkManager | null = null;
  ground: GroundBuild | null = null;
  extras: WorldExtras | null = null;
  data: CityData | null = null;
  private trees: THREE.Group | null = null;
  params: Params;
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private unsub: (() => void)[] = [];
  private regenTimer: ReturnType<typeof setTimeout> | undefined;
  private shadowDirty = true;
  private shadowCenter = new THREE.Vector3(1e9, 0, 0);
  private shadowExtent = 0;
  private lastShadow = 0;
  private frames = 0; private fpsT = 0; private lastCam = 0;
  private idleFrames = 0;
  private viewW = 1; private viewH = 1;
  capturing = false;
  ready = false;
  /** points the camera may approach closely at altitude (rooftop parapet, tower deck) — keeps the near plane from clipping them */
  closeTargets: THREE.Vector3[] = [];
  /** adaptive resolution: drops while navigation is slow, recovers when there is headroom or the view rests */
  private dynScale = 1;
  private frameAvg = 16;
  private lastDyn = 0;
  private probeDirty = true;
  private probePos = new THREE.Vector3(1e9, 0, 0);
  private probeTmp = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.params = useStore.getState().params;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;
    this.camera.layers.enable(1);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 14000;
    this.sky = new Sky(this.renderer, this.scene);
    this.rig = new CameraRig(this.camera, canvas);
    this.rig.pick = this.pick;
    this.rig.onUserInput = () => { if (useStore.getState().activeBookmark) useStore.getState().ui({ activeBookmark: null }); };
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.refl = new PlanarReflection(512, 512);
    facadeUniforms.uPalette.value = this.palette.texture;
    this.palette.generate(this.params.seed, this.params.archVariation);

    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.unsub.push(() => ro.disconnect());
    canvas.addEventListener('webglcontextlost', this.onContextLost);

    // initial shot: the skyline bookmark, instantly
    const start = BOOKMARKS[0];
    this.rig.flyTo(start, true);
    this.applyParams(this.params, null);

    this.unsub.push(useStore.subscribe((s) => s.params, (p, prev) => this.applyParams(p, prev)));
    this.unsub.push(useStore.subscribe((s) => s.cameraMode, (m) => this.rig.setMode(m)));
    this.unsub.push(bus.on('bookmark', (id) => { const b = BOOKMARKS.find((x) => x.id === id); if (b) this.goto(b); }));
    this.unsub.push(bus.on('focus', (id) => this.focusSite(id)));
    this.unsub.push(bus.on('setCamera', (p) => { this.rig.setPose(p); }));
    this.unsub.push(bus.on('resetCamera', () => this.goto(BOOKMARKS[0])));
    this.unsub.push(bus.on('capture', (o) => { void capturePhoto(this, o.preview); }));
    // automation hook for the visual-validation harness (dev server, or opt-in with ?forge on a build)
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('forge')) (window as any).__forge = { engine: this, store: useStore, bus, THREE, bookmarks: BOOKMARKS };

    this.raf = requestAnimationFrame(this.frame);
    void this.load();
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    const s = useStore.getState();
    s.ui({ capture: { ...s.capture, busy: false, message: 'Graphics context lost — reload the page (try a lower export resolution).' } });
  };

  private setLoading(progress: number, label: string, done = false) { useStore.getState().ui({ loading: { progress, label, done } }); }

  private async load() {
    const gone = () => this.disposed;
    try {
      this.setLoading(0.05, 'Downloading NYC Open Data footprints…');
      const data = await loadCityData();
      if (gone()) return;
      this.data = data;
      this.setLoading(0.2, 'Laying out streets, parks and rivers…');
      await nextFrame();
      if (gone()) return;
      this.ground = buildGround(data);
      this.scene.add(this.ground.group);
      await nextFrame();
      if (gone()) return;
      this.setLoading(0.32, 'Planting trees…');
      this.trees = buildTrees(data, this.ground.grid, this.ground.isLand);
      this.scene.add(this.trees);
      await nextFrame();
      if (gone()) return;
      this.setLoading(0.4, 'Raising landmarks…');
      const extras = await buildWorldExtras(this, data, this.ground);
      if (gone()) { disposeTree(extras.group); extras.dispose(); return; }
      this.extras = extras;
      const zones = Object.values(SITES).filter((s) => s.clear > 0).map((s) => ({ x: s.x, z: s.z, r: s.clear })).concat(this.extras.clearZones);
      this.chunks = new ChunkManager(data, this.palette, this.ground.grid, this.params, zones);
      this.scene.add(this.chunks.group);
      this.applyParams(this.params, null);
      // build the city nearest-first with a generous budget, keeping the page responsive
      const total = this.chunks.chunkCount;
      for (let guard = 0; guard < 4000; guard++) {
        const more = this.chunks.update(this.camera.position, this.params, 26);
        this.shadowDirty = true;
        const done = 1 - this.chunks.pending / Math.max(1, total);
        this.setLoading(0.45 + 0.54 * clamp(done, 0, 1), `Generating Manhattan… ${this.chunks.builtBuildings.toLocaleString()} buildings`);
        if (!more) break;
        await nextFrame();
        if (gone()) return;
      }
      this.ready = true;
      this.setLoading(1, 'Welcome to New York', true);
    } catch (err) {
      console.error(err);
      if (!gone()) this.setLoading(0, 'Failed to load city data: ' + (err as Error).message);
    }
  }

  private resize() {
    const w = Math.max(2, this.canvas.clientWidth), h = Math.max(2, this.canvas.clientHeight);
    this.viewW = w; this.viewH = h;
    if (this.capturing) return;
    const pr = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[this.params.quality] ?? 1.5) * this.dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.refl.setSize(w * pr * 0.5, h * pr * 0.5);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.idleFrames = 0;
  }

  /** React to any parameter change. Cheap paths are immediate; city regeneration is debounced. */
  applyParams(p: Params, prev: Params | null) {
    this.params = p;
    this.idleFrames = 0;
    const a = (this.atmo = computeAtmosphere(p));
    // shared uniforms
    U.uSunDir.value.copy(a.sunDir);
    U.uFogColor.value.copy(a.fogColor);
    U.uFogSunColor.value.copy(a.fogSunColor);
    U.uFogParams.value.set(a.fogBase, a.fogGround, 1 / a.fogScaleHeight, a.fogSun);
    U.uSnow.value = p.snowCoverage;
    U.uWet.value = p.wetness;
    U.uNight.value = a.night;
    U.uWindowLight.value = p.windowLighting * 2;
    U.uDetail.value = p.textureQuality;
    U.uMagic.value = p.magicIntensity;
    U.uLandmarkGlow.value = p.landmarkVisibility;
    U.uSkyZenith.value.copy(a.zenith);
    U.uSkyHorizon.value.copy(a.horizon);
    U.uSunColor.value.copy(a.lightColor).multiplyScalar(a.lightIntensity * (a.night > 0.9 ? 0.5 : 1) * a.sunDisc);
    facadeUniforms.uStreetGlow.value = 1;
    // lights
    this.sun.color.copy(a.lightColor);
    this.sun.intensity = a.lightIntensity * Math.PI * 0.8;
    this.hemi.color.copy(a.hemiSky);
    this.hemi.groundColor.copy(a.hemiGround);
    this.hemi.intensity = a.hemiIntensity * 0.9;
    this.scene.environmentIntensity = a.envIntensity;
    this.sky.apply(a, p);
    this.post.apply(p, a);
    const sdir = !prev || prev.sunElevation !== p.sunElevation || prev.timeOfDay !== p.timeOfDay;
    if (sdir || !prev || prev.shadowQuality !== p.shadowQuality) this.shadowDirty = true;
    // quality
    if (!prev || prev.quality !== p.quality) this.resize();
    const ss = SHADOW_SIZE[p.shadowQuality] || 0;
    this.sun.castShadow = ss > 0;
    if (ss > 0 && this.sun.shadow.mapSize.x !== ss) {
      this.sun.shadow.mapSize.set(ss, ss);
      this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null;
      this.shadowDirty = true;
    }
    this.refl.enabled = p.reflections;
    U.uReflStrength.value = p.reflections ? 1 : 0;
    if (this.ground) this.ground.waterMaterial.uniforms.uReflOn.value = p.reflections ? 1 : 0;
    this.extras?.apply(p, a, prev);
    // city regeneration
    if (prev && REGEN_KEYS.some((k) => prev[k] !== p[k])) {
      clearTimeout(this.regenTimer);
      this.regenTimer = setTimeout(() => { this.chunks?.regenerate(this.params); this.extras?.regenerate(this.params); this.idleFrames = 0; }, 280);
    }
    this.chunks?.setParams(p);
  }

  goto(b: { pos: [number, number, number]; target: [number, number, number]; fov: number }, instant = false) {
    const s = useStore.getState();
    if (useStore.getState().cameraMode !== 'orbit' && false) s.ui({ cameraMode: 'orbit' });
    if (Math.abs(s.params.fov - b.fov) > 0.01) s.patch({ fov: b.fov });
    this.rig.flyTo(b, instant);
    this.idleFrames = 0;
  }

  focusSite(id: string) {
    const site = SITES[id];
    if (!site) return;
    // approach from the south-west so the subject is lit by the evening sun and Midtown sits behind it
    const d = site.focus.dist;
    this.goto({ pos: [site.x - d * 0.55, site.focus.height, site.z + d * 0.83], target: [site.x, site.focus.lookY, site.z], fov: this.params.fov });
  }

  private ray = new THREE.Raycaster();
  private pick = (nx: number, ny: number): THREE.Vector3 | null => {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    this.ray.layers.enableAll();
    const targets: THREE.Object3D[] = [];
    if (this.chunks) targets.push(this.chunks.group);
    if (this.extras) targets.push(this.extras.group);
    const hits = this.ray.intersectObjects(targets, true);
    if (hits.length) return hits[0].point.clone();
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y < -1e-3) { const t = -o.y / d.y; if (t < 60000) return o.clone().addScaledVector(d, t); }
    return null;
  };

  private updateShadow(now: number) {
    if (!this.sun.castShadow) return;
    const cam = this.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    // focus point: where the view ray meets the ground, bounded
    let t = dir.y < -0.02 ? cam.position.y / -dir.y : 2500;
    t = clamp(t, 30, 3200);
    const focus = cam.position.clone().addScaledVector(dir, t * 0.75);
    focus.y = 0;
    const extent = clamp(Math.max(t * 0.95, cam.position.y * 0.9), 130, 4800);
    const moved = focus.distanceTo(this.shadowCenter) > this.shadowExtent * 0.14 || Math.abs(extent - this.shadowExtent) > this.shadowExtent * 0.22;
    if (!(this.shadowDirty || moved)) return;
    if (!this.capturing && now - this.lastShadow < (this.rig.moving ? 120 : 0)) return;
    this.lastShadow = now;
    this.shadowDirty = false;
    this.shadowCenter.copy(focus); this.shadowExtent = extent;
    const L = this.atmo.lightDir;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(L, 6000);
    const sc = this.sun.shadow.camera;
    sc.left = -extent; sc.right = extent; sc.top = extent; sc.bottom = -extent;
    sc.near = 100; sc.far = 12500;
    sc.updateProjectionMatrix();
    const texel = (extent * 2) / this.sun.shadow.mapSize.x;
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = texel * 1.6;
    this.sun.shadow.radius = 1.6;
    this.sun.target.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Render one frame at the current renderer size (also used by the capture path). */
  renderFrame(dt: number, now: number) {
    const cam = this.camera;
    // near plane: as far out as depth precision wants, but never beyond what the user is looking at up close
    let prox = cam.position.y;
    if (this.rig.mode === 'orbit' && !this.rig.transitioning) prox = Math.min(prox, this.rig.dist * 0.6);
    for (const t of this.closeTargets) prox = Math.min(prox, cam.position.distanceTo(t) * 0.5);
    cam.near = clamp(prox * 0.012, 0.2, 10);
    cam.far = 95000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.sky.follow(cam);
    this.updateShadow(now);
    if (this.sky.update(now, this.params.textureQuality, this.capturing)) this.probeDirty = true;
    // once the view has settled, replace the sky-only environment with a probe of the real surroundings
    if (this.params.textureQuality >= 2 && this.ready && (this.capturing || (this.idleFrames > 24 && !this.rig.transitioning))) {
      const p = this.probeTmp.set(cam.position.x, clamp(cam.position.y, 120, 900), cam.position.z);
      if (this.probeDirty || p.distanceTo(this.probePos) > 260) {
        this.sky.bakeLocal(this.scene, p);
        this.probePos.copy(p); this.probeDirty = false;
      }
    }
    this.extras?.update(dt, now, cam);
    this.trees?.userData.update?.(cam.position, 420 * this.params.lodBias * (this.capturing ? 2 : 1));
    if (this.refl.enabled) this.refl.render(this.renderer, this.scene, cam);
    this.post.render(dt);
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.capturing) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    U.uTime.value += dt;
    // smooth lens changes
    const fov = this.params.fov;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 7)); this.idleFrames = 0; }
    this.rig.update(dt);
    let working = false;
    if (this.chunks && this.ready) {
      working = this.chunks.update(this.camera.position, this.params, this.rig.moving ? 5 : 12);
      if (working) { this.shadowDirty = true; this.probeDirty = true; }
    }
    if (this.rig.moving || working) this.idleFrames = 0; else this.idleFrames++;
    // adaptive quality: keep navigation responsive on slower GPUs, restore full resolution at rest
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.08;
    if (now - this.lastDyn > 1500 && this.ready) {
      let next = this.dynScale;
      if (this.rig.moving && this.frameAvg > 30) next = Math.max(0.6, this.dynScale * 0.85);
      else if (this.dynScale < 1 && (this.idleFrames > 30 || this.frameAvg < 15)) next = Math.min(1, this.dynScale / 0.85);
      if (next !== this.dynScale) { this.dynScale = next; this.lastDyn = now; this.resize(); this.idleFrames = Math.min(this.idleFrames, 31); }
    }
    // static world: once everything has settled, drop to a slow shimmer cadence to save power
    const idle = this.idleFrames > 90;
    if (!idle || this.frames % 3 === 0) {
      this.renderer.info.reset();
      this.renderFrame(dt * (idle ? 3 : 1), now);
    }
    this.frames++;
    if (now - this.fpsT > 500) {
      const s = useStore.getState();
      const fps = Math.round((this.frames * 1000) / (now - this.fpsT));
      this.frames = 0; this.fpsT = now;
      if (s.params.showFps) s.ui({ fps, stats: { buildings: this.chunks?.builtBuildings ?? 0, chunks: this.chunks?.chunkCount ?? 0, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles } });
    }
    if (now - this.lastCam > 110) { this.lastCam = now; const r = this.rig.readout(); const c = useStore.getState().cam; if (Math.abs(c.x - r.x) + Math.abs(c.y - r.y) + Math.abs(c.z - r.z) + Math.abs(c.heading - r.heading) + Math.abs(c.pitch - r.pitch) + Math.abs(c.roll - r.roll) > 0.01) useStore.getState().ui({ cam: r }); }
  };

  /** True when streaming, transitions and environment bakes have settled (used by capture & tests). */
  get settled() { return this.ready && !this.rig.transitioning && (this.chunks?.pending ?? 0) === 0; }
  get viewport() { return { w: this.viewW, h: this.viewH }; }
  wake() { this.idleFrames = 0; }
  invalidateShadow() { this.shadowDirty = true; this.idleFrames = 0; }
  restoreSize() { this.resize(); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.regenTimer);
    this.unsub.forEach((u) => u());
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.rig.dispose();
    // free every GPU resource still attached to the scene *before* the sub-systems detach their groups
    disposeTree(this.scene);
    this.chunks?.dispose();
    this.extras?.dispose();
    this.sky.dispose();
    this.refl.dispose();
    this.post.dispose();
    this.palette.texture.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if ((window as any).__forge?.engine === this) delete (window as any).__forge;
  }
}

/** Dispose geometries, materials and their textures below an object. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      mat.dispose();
    }
    (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose();
  });
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
