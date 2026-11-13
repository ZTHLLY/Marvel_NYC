#!/usr/bin/env node
/**
 * Frame-time probe: renders N frames synchronously (with gl.finish) at a few bookmarks, once with a resting camera
 * and once while the camera travels (which is what refreshes the near shadow cascades).
 *   node tools/perf.mjs [--url http://127.0.0.1:5173/?fresh=1] [--w 1600 --h 900] [--quality high] bookmark[:preset] ...
 */
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const url = opt('url', 'http://127.0.0.1:5173/?fresh=1');
const W = +opt('w', 1600), H = +opt('h', 900);
const quality = opt('quality', 'high');
const patch = JSON.parse(opt('patch', '{}'));   // extra params applied after the preset, e.g. --patch '{"shadowQuality":0}'
const views = args.length ? args : ['skyline:golden', 'overview:golden', 'times-square:rain', 'rooftop:rooftop', 'sanctum:sanctum'];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__forge && window.__forge.engine.ready, null, { timeout: 180000 });
await page.evaluate((q) => { const st = window.__forge.store.getState(); st.set('quality', q); st.ui({ uiHidden: true, showHelp: false }); }, quality);
console.log(`quality=${quality} ${W}x${H}`);
for (const v of views) {
  const [bm, preset] = v.split(':');
  await page.evaluate(({ bm, preset, patch }) => {
    const { engine, store, bookmarks } = window.__forge;
    if (preset) store.getState().applyScenePreset(preset);
    store.getState().patch(patch);
    const b = bookmarks.find((x) => x.id === bm);
    if (b) engine.goto(b, true);
    engine.wake();
  }, { bm, preset, patch });
  await page.waitForTimeout(800);
  await page.waitForFunction(() => window.__forge.engine.settled, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const { engine, THREE } = window.__forge;
    const gl = engine.renderer.getContext();
    const run = (n, move) => {
      const right = new THREE.Vector3().setFromMatrixColumn(engine.camera.matrixWorld, 0);
      const p0 = engine.camera.position.clone();
      const times = [];
      for (let i = 0; i < n; i++) {
        if (move) engine.camera.position.addScaledVector(right, 1.2);
        const t = performance.now();
        engine.renderer.info.reset();
        engine.renderFrame(1 / 60, t);
        gl.finish();
        times.push(performance.now() - t);
      }
      engine.camera.position.copy(p0);
      times.sort((a, b) => a - b);
      return { med: times[n >> 1], p90: times[Math.floor(n * 0.9)] };
    };
    run(6, false);
    const rest = run(40, false), travel = run(40, true);
    const info = engine.renderer.info.render;
    return { rest, travel, calls: info.calls, tris: info.triangles };
  });
  console.log(`${v.padEnd(24)} rest ${r.rest.med.toFixed(1)} ms (p90 ${r.rest.p90.toFixed(1)}) | travelling ${r.travel.med.toFixed(1)} ms (p90 ${r.travel.p90.toFixed(1)}) | ${r.calls} calls, ${(r.tris / 1e6).toFixed(2)}M tris`);
}
await browser.close();
