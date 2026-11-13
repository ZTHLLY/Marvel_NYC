#!/usr/bin/env node
/**
 * Visual validation harness: drives the running app in headless Chrome (real GPU) and saves screenshots.
 *   node tools/shots.mjs [--url http://127.0.0.1:5173] [--out shots] [--w 1600 --h 900] shot1 shot2 ...
 * A shot is  name[:bookmark][:preset][:json-params]  e.g.  "skyline:skyline:golden"
 * or         name@x,y,z@tx,ty,tz[@fov][:preset]       for an explicit camera.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const url = opt('url', 'http://127.0.0.1:5173/?fresh=1');
const out = opt('out', 'shots');
const W = +opt('w', 1600), H = +opt('h', 900);
const settle = +opt('settle', 1200);
const dpr = +opt('dpr', 1);
const evalJs = opt('eval', '');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', ...(dpr === 1 ? ['--force-device-scale-factor=1'] : [])],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
await page.waitForFunction(() => window.__forge && window.__forge.engine.ready, null, { timeout: 180000 }).catch(() => errors.push('TIMEOUT waiting for engine.ready'));
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.waitForTimeout(1500); // let the first-run help appear so each shot can dismiss it
if (evalJs) console.log('eval →', await page.evaluate(evalJs));

const waitSettled = async () => {
  await page.waitForFunction(() => window.__forge.engine.settled, null, { timeout: 60000 }).catch(() => errors.push('TIMEOUT settle'));
  await page.waitForTimeout(settle);
};

for (const spec of args) {
  const [head, ...rest] = spec.split(':');
  const parts = head.split('@');
  const name = parts[0];
  const ui = name.endsWith('+ui');
  await page.evaluate(({ parts, rest, ui }) => {
    const { engine, store, bus } = window.__forge;
    const st = store.getState();
    st.ui({ uiHidden: !ui, showHelp: false, photoMode: parts[0].includes('photo'), activeGroup: (parts[0].match(/tab-(\w+)/) || [])[1] || st.activeGroup });
    let i = 0;
    if (parts.length >= 3) {
      const pos = parts[1].split(',').map(Number), target = parts[2].split(',').map(Number);
      const fov = parts[3] ? +parts[3] : st.params.fov;
      if (rest[0]) st.applyScenePreset(rest[0]);
      if (rest[1]) st.patch(JSON.parse(rest.slice(1).join(':')));
      engine.goto({ pos, target, fov }, true);
    } else {
      const bm = rest[i++] || parts[0];
      const preset = rest[i++];
      if (preset) st.applyScenePreset(preset);
      const extra = rest.slice(i).join(':');
      if (extra) st.patch(JSON.parse(extra));
      const b = window.__forge.bookmarks?.find((x) => x.id === bm);
      if (b) { st.ui({ activeBookmark: bm }); st.patch({ fov: b.fov }); engine.goto(b, true); }
    }
    engine.wake();
  }, { parts, rest, ui });
  await page.waitForTimeout(700);
  await waitSettled();
  const file = path.join(out, name.replace('+ui', '') + '.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  const info = await page.evaluate(() => { const r = window.__forge.engine.renderer.info; return `${r.render.calls} calls, ${(r.render.triangles / 1e6).toFixed(2)}M tris`; });
  console.log('saved', file, '|', info);
}
if (errors.length) console.log('--- console issues ---\n' + [...new Set(errors)].slice(0, 25).join('\n'));
await browser.close();
