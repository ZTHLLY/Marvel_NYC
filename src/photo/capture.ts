import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import { useStore } from '../state/store';
import { ASPECTS, RESOLUTIONS } from '../state/params';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Output pixel size for the current resolution + aspect selection. */
export function outputSize(resolution: keyof typeof RESOLUTIONS, aspect: keyof typeof ASPECTS, viewAspect: number): [number, number] {
  let [w, h] = RESOLUTIONS[resolution];
  const a = ASPECTS[aspect];
  if (a) {
    if (a >= 1) h = Math.round(w / a);
    else { h = w; w = Math.round(h * a); }
  } else if (Math.abs(viewAspect - w / h) > 0.6) {
    // "viewport" framing on an unusual window shape: keep the pixel budget, follow the window
    const px = w * h; w = Math.round(Math.sqrt(px * viewAspect)); h = Math.round(w / viewAspect);
  }
  return [w - (w % 2), h - (h % 2)];
}

/**
 * High-quality still capture. Unlike the interactive path this renders off the display cadence:
 * detail radius, shadow resolution, AO and anti-aliasing are raised, streaming is allowed to finish,
 * then the frame is rendered at the exact export resolution and encoded as PNG.
 */
export async function capturePhoto(engine: Engine, preview: boolean): Promise<Blob | null> {
  const store = useStore.getState();
  if (store.capture.busy || !engine.ready) return null;
  const p = store.params;
  const { renderer, camera, post } = engine;
  const gl = renderer.getContext();
  const view = engine.viewport;
  const viewAspect = view.w / view.h;
  let [w, h] = outputSize(p.resolution, p.aspect, viewAspect);
  if (preview) { const k = 1600 / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
  const maxDim = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), 16384);
  let note = '';
  if (w > maxDim || h > maxDim) {
    const k = maxDim / Math.max(w, h); w = Math.floor(w * k); h = Math.floor(h * k);
    note = ` (limited to ${w}×${h} by this GPU)`;
  }
  const setMsg = (message: string, busy = true) => useStore.getState().ui({ capture: { ...useStore.getState().capture, busy, message } });
  setMsg(preview ? 'Rendering preview…' : `Rendering ${w} × ${h}…`);
  await nextFrame(); await nextFrame();

  const prevFov = camera.fov, prevAspect = camera.aspect;
  let blob: Blob | null = null;
  engine.capturing = true;
  try {
    // --- raise quality for the still
    if (engine.chunks) {
      engine.chunks.detailBoost = preview ? 1.25 : 1.8;
      for (let i = 0; i < 400; i++) {
        if (!engine.chunks.update(camera.position, p, 40)) break;
        if (i % 4 === 3) await nextFrame();
      }
    }
    if (!preview && p.shadowQuality > 0) engine.shadows.setQuality(p.shadowQuality, true, maxDim >= 8192);
    engine.invalidateShadow();
    post.apply(p, engine.atmo, true);
    // --- frame exactly what the on-screen crop shows
    const outAspect = w / h;
    if (outAspect > viewAspect) {
      const t = Math.tan(THREE.MathUtils.degToRad(prevFov / 2)) * (viewAspect / outAspect);
      camera.fov = THREE.MathUtils.radToDeg(Math.atan(t)) * 2;
    }
    camera.aspect = outAspect;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    engine.refl.setSize(Math.min(w, 4096) * 0.75, Math.min(h, 4096) * 0.75);
    const now = performance.now();
    engine.renderFrame(1 / 60, now);      // warm-up: shadows, environment, AO
    engine.renderFrame(1 / 60, now + 16);
    blob = await new Promise<Blob | null>((res) => engine.renderer.domElement.toBlob(res, 'image/png'));
    if (!blob) throw new Error('The browser could not encode the image');
  } catch (err) {
    console.error(err);
    setMsg(`Capture failed: ${(err as Error).message}. Try a lower resolution.`, false);
  } finally {
    engine.shadows.setQuality(p.shadowQuality);
    engine.invalidateShadow();
    if (engine.chunks) engine.chunks.detailBoost = 1;
    camera.fov = prevFov; camera.aspect = prevAspect; camera.updateProjectionMatrix();
    post.apply(useStore.getState().params, engine.atmo, false);
    engine.capturing = false;
    engine.restoreSize();
    engine.invalidateShadow();
  }
  if (!blob) return null;
  const s = useStore.getState();
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const name = `city-forge-${s.activeBookmark ?? 'custom'}-${w}x${h}-${stamp}.png`;
  const url = URL.createObjectURL(blob);
  const size = `${w} × ${h} · ${(blob.size / 1e6).toFixed(1)} MB`;
  if (preview) {
    if (s.capture.previewUrl) URL.revokeObjectURL(s.capture.previewUrl);
    s.ui({ capture: { busy: false, message: 'Preview ready' + note, previewUrl: url, previewName: name, previewSize: size } });
  } else {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    s.ui({ capture: { ...s.capture, busy: false, message: `Saved ${size}${note}` } });
  }
  return blob;
}
