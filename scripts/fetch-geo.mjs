#!/usr/bin/env node
/**
 * Reproducible geographic preprocessing pipeline.
 *
 * Downloads public NYC Open Data (Socrata) layers and converts them into the compact
 * world-space files consumed by the app:
 *   public/data/buildings.bin  Int32Array  [count, (heightDm, year, tier, n, x0,z0 ... )*]
 *   public/data/city.json      land polygons, parks, road centerlines (decimetres)
 *
 * Sources (all NYC Open Data, https://opendata.cityofnewyork.us/):
 *   Building Footprints  5zhs-2jue
 *   Borough Boundaries   gthc-hcne  (clipped to shoreline)
 *   Centerline (CSCL)    inkn-q76z
 *   Parks Properties     enfh-gkve
 *
 * Raw responses are cached in data-cache/ so re-runs are offline & deterministic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data-cache');
const OUT = path.join(ROOT, 'public', 'data');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// ---- world definition (keep in sync with src/city/geo.ts) -------------------
export const LAT0 = 40.7527, LON0 = -73.9772; // Grand Central / 200 Park Ave
const M_PER_LAT = 110574 + 0; // metres per degree latitude (approx @40.75N: 111047, use precise below)
const MLAT = 111047.0;
const MLON = 84395.0; // metres per degree longitude at 40.75N
const toXZ = (lon, lat) => [(lon - LON0) * MLON, -(lat - LAT0) * MLAT];

const BBOX = { s: 40.678, n: 40.832, w: -74.075, e: -73.895 };
const CORE = { s: 40.7185, n: 40.7725 }; // Canal St .. ~66th St, river to river

const SOC = 'https://data.cityofnewyork.us/resource';

async function getJSON(name, url) {
  const file = path.join(CACHE, name + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'city-forge-geo/0.1' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      const data = JSON.parse(txt);
      fs.writeFileSync(file, txt);
      return data;
    } catch (e) {
      console.warn(`  retry ${name} (${e.message})`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw new Error('failed to fetch ' + name);
}

async function paged(name, base, pageSize = 20000) {
  const all = [];
  for (let page = 0; ; page++) {
    const url = `${base}&$order=objectid&$limit=${pageSize}&$offset=${page * pageSize}`;
    const rows = await getJSON(`${name}-${page}`, url);
    all.push(...rows);
    console.log(`  ${name} page ${page}: ${rows.length}`);
    if (rows.length < pageSize) break;
  }
  return all;
}

// ---- geometry helpers --------------------------------------------------------
function area2(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % n];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}
function dp(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, az] = points[a], [bx, bz] = points[b];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dz - (points[i][1] - az) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
function simplifyRing(ring, tol) {
  // ring: closed (first==last) list of [x,z]; returns open ring
  let pts = ring.slice();
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length < 3) return null;
  // split at farthest point to simplify a closed ring robustly
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = dp(pts.slice(0, far + 1), tol);
  const b = dp(pts.slice(far).concat([pts[0]]), tol);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : null;
}
function clipRing(ring, rect) {
  // Sutherland–Hodgman against axis-aligned rect {x0,x1,z0,z1}
  const edges = [
    [(p) => p[0] >= rect.x0, (a, b) => { const t = (rect.x0 - a[0]) / (b[0] - a[0]); return [rect.x0, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= rect.x1, (a, b) => { const t = (rect.x1 - a[0]) / (b[0] - a[0]); return [rect.x1, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= rect.z0, (a, b) => { const t = (rect.z0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), rect.z0]; }],
    [(p) => p[1] <= rect.z1, (a, b) => { const t = (rect.z1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), rect.z1]; }],
  ];
  let out = ring;
  for (const [inside, inter] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const ia = inside(a), ib = inside(b);
      if (ia && ib) out.push(b);
      else if (ia && !ib) out.push(inter(a, b));
      else if (!ia && ib) { out.push(inter(a, b)); out.push(b); }
    }
    if (out.length < 3) return null;
  }
  return out;
}
const dm = (v) => Math.round(v * 10);

// ---- main --------------------------------------------------------------------
const box = `within_box(the_geom,${BBOX.n},${BBOX.w},${BBOX.s},${BBOX.e})`;
const wkt = `POLYGON((${BBOX.w} ${BBOX.s},${BBOX.e} ${BBOX.s},${BBOX.e} ${BBOX.n},${BBOX.w} ${BBOX.n},${BBOX.w} ${BBOX.s}))`;
const inter = (col) => `intersects(${col},'${wkt}')`;
const enc = encodeURIComponent;

console.log('Buildings: Manhattan (all)');
const bSel = '$select=the_geom,height_roof,construction_year,bin,objectid';
const manh = await paged('bldg-manhattan', `${SOC}/5zhs-2jue.json?${bSel}&$where=${enc(`${box} AND bin >= 1000000 AND bin < 2000000`)}`);
console.log('Buildings: other boroughs (>= 55 ft)');
const other = await paged('bldg-other', `${SOC}/5zhs-2jue.json?${bSel}&$where=${enc(`${box} AND (bin < 1000000 OR bin >= 2000000) AND height_roof >= 55`)}`);

const ints = [0];
let count = 0, coreCount = 0;
const stats = { skippedSmall: 0, noHeight: 0 };
function addBuilding(row, manhattan) {
  const g = row.the_geom;
  if (!g) return;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  let h = parseFloat(row.height_roof) * 0.3048;
  if (!(h > 0)) { h = 10; stats.noHeight++; }
  const year = parseInt(row.construction_year) || 0;
  for (const poly of polys) {
    const ring = poly[0].map(([lon, lat]) => toXZ(lon, lat));
    let pts = simplifyRing(ring, h > 60 ? 0.35 : 0.6);
    if (!pts) continue;
    let a = area2(pts);
    if (Math.abs(a) < 14 || h < 2.6) { stats.skippedSmall++; continue; }
    if (a < 0) pts.reverse();
    // centroid latitude decides tier
    let cz = 0; for (const p of pts) cz += p[1]; cz /= pts.length;
    const lat = LAT0 - cz / MLAT;
    const tier = manhattan && lat >= CORE.s && lat <= CORE.n ? 0 : manhattan ? 1 : 2;
    if (tier === 0) coreCount++;
    ints.push(dm(h), year, tier, pts.length);
    for (const p of pts) ints.push(dm(p[0]), dm(p[1]));
    count++;
  }
}
manh.forEach((r) => addBuilding(r, true));
other.forEach((r) => addBuilding(r, false));
ints[0] = count;
fs.writeFileSync(path.join(OUT, 'buildings.bin'), Buffer.from(new Int32Array(ints).buffer));
console.log(`buildings: ${count} (core ${coreCount})`, stats, `${(ints.length * 4 / 1e6).toFixed(1)} MB`);

console.log('Borough boundaries (land polygons)');
const boros = await getJSON('boroughs', `${SOC}/gthc-hcne.json?$limit=10`);
const [wx0, wz1] = toXZ(BBOX.w, BBOX.s);
const [wx1, wz0] = toXZ(BBOX.e, BBOX.n);
const PAD = 3500;
const rect = { x0: wx0 - PAD, x1: wx1 + PAD, z0: wz0 - PAD, z1: wz1 + PAD };
const land = [];
for (const b of boros) {
  for (const poly of b.the_geom.coordinates) {
    const ring = poly[0].map(([lon, lat]) => toXZ(lon, lat));
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of ring) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    if (maxx < rect.x0 || minx > rect.x1 || maxz < rect.z0 || minz > rect.z1) continue;
    let pts = simplifyRing(ring, 1.5);
    if (!pts) continue;
    pts = clipRing(pts, rect);
    if (!pts || Math.abs(area2(pts)) < 400) continue;
    if (area2(pts) < 0) pts.reverse();
    land.push({ boro: +b.borocode, pts: pts.flatMap((p) => [dm(p[0]), dm(p[1])]) });
  }
}
console.log(`land polygons: ${land.length}, verts ${land.reduce((s, l) => s + l.pts.length / 2, 0)}`);

console.log('Parks');
const parksRaw = await paged('parks', `${SOC}/enfh-gkve.json?$select=multipolygon,acres,signname,typecategory,objectid&$where=${enc(`${inter('multipolygon')} AND acres > 0.35`)}`, 5000);
const parks = [];
for (const p of parksRaw) {
  if (!p.multipolygon) continue;
  if (/Parkway|Mall|Strip|Triangle\/Plaza|Lot|Undeveloped|Building/i.test(p.typecategory || '') && parseFloat(p.acres) < 2) continue;
  for (const poly of p.multipolygon.coordinates) {
    const ring = poly[0].map(([lon, lat]) => toXZ(lon, lat));
    let pts = simplifyRing(ring, 2);
    if (!pts || Math.abs(area2(pts)) < 900) continue;
    pts = clipRing(pts, rect);
    if (!pts) continue;
    if (area2(pts) < 0) pts.reverse();
    parks.push({ name: p.signname || '', pts: pts.flatMap((q) => [dm(q[0]), dm(q[1])]) });
  }
}
console.log(`parks: ${parks.length}`);

console.log('Street centerlines');
const roadsRaw = await paged('roads', `${SOC}/inkn-q76z.json?$select=the_geom,streetwidth,rw_type,boroughcode,number_travel_lanes,trafdir,full_street_name,objectid&$where=${enc(`${inter('the_geom')} AND rw_type in ('1','2','3','9','13')`)}`, 25000);
const roads = [];
const NAMED = /^(BROADWAY|5 AVE|PARK AVE|7 AVE|6 AVE|AVE OF THE AMERICAS|MADISON AVE|LEXINGTON AVE|3 AVE|8 AVE|W 42 ST|E 42 ST|W 34 ST|E 34 ST|W 57 ST|E 57 ST|BLEECKER ST|W 14 ST|E 14 ST|W 23 ST|E 23 ST|FDR DR|WEST ST|12 AVE)$/;
for (const r of roadsRaw) {
  if (!r.the_geom) continue;
  let w = parseFloat(r.streetwidth) * 0.3048;
  const rw = parseInt(r.rw_type) || 1;
  if (!(w > 3)) w = rw === 2 || rw === 3 ? 14 : 9;
  for (const line of r.the_geom.coordinates) {
    let pts = dp(line.map(([lon, lat]) => toXZ(lon, lat)), 0.5);
    if (pts.length < 2) continue;
    const o = { w: dm(w), t: rw, b: +r.boroughcode, pts: pts.flatMap((q) => [dm(q[0]), dm(q[1])]) };
    if (NAMED.test(r.full_street_name || '')) o.n = r.full_street_name;
    roads.push(o);
  }
}
console.log(`road segments: ${roads.length}`);

const city = {
  meta: {
    lat0: LAT0, lon0: LON0, mPerLat: MLAT, mPerLon: MLON, bbox: BBOX, core: CORE,
    units: 'decimetres; x east, z south',
    generated: new Date().toISOString().slice(0, 10),
    sources: 'NYC Open Data: Building Footprints, Borough Boundaries, Centerline, Parks Properties',
  },
  land, parks, roads,
};
fs.writeFileSync(path.join(OUT, 'city.json'), JSON.stringify(city));
console.log('city.json', (fs.statSync(path.join(OUT, 'city.json')).size / 1e6).toFixed(1), 'MB');
