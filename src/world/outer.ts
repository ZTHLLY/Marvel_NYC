import * as THREE from 'three';
import { CityData, ll, pointInPoly } from '../city/geo';
import type { GroundBuild } from '../city/ground';
import { Family, facadeInstancedMaterial, VARIANTS } from '../city/facade';
import type { Params } from '../state/params';
import { hash2, mulberry32 } from '../util/rng';

/** Unit box (x,z in ±0.5, y in 0..1) without a bottom face. */
function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // drop the -Y face (group 3 in BoxGeometry order: +x,-x,+y,-y,+z,-z → indices 18..23)
  const idx = Array.from(g.index!.array as ArrayLike<number>);
  idx.splice(18, 6);
  g.setIndex(idx);
  g.clearGroups();
  g.deleteAttribute('uv');
  return g;
}

interface Box { x: number; z: number; w: number; d: number; h: number; ang: number; row: number; seed: number }

const JC_CLUSTERS: { lat: number; lon: number; r: number; peak: number; n: number }[] = [
  { lat: 40.7163, lon: -74.0345, r: 420, peak: 250, n: 46 },   // Exchange Place
  { lat: 40.7268, lon: -74.0352, r: 380, peak: 190, n: 34 },   // Newport
  { lat: 40.733, lon: -74.0627, r: 300, peak: 170, n: 14 },    // Journal Square
  { lat: 40.7440, lon: -74.0290, r: 260, peak: 70, n: 12 },    // Hoboken waterfront
  { lat: 40.7640, lon: -74.0220, r: 300, peak: 90, n: 12 },    // Weehawken / Lincoln Harbor
  { lat: 40.7790, lon: -74.0090, r: 320, peak: 110, n: 12 },   // Port Imperial
  { lat: 40.851, lon: -73.9685, r: 520, peak: 130, n: 26 },    // Fort Lee
  { lat: 40.735, lon: -74.168, r: 700, peak: 150, n: 30 },     // Newark (far field)
  { lat: 40.759, lon: -73.832, r: 600, peak: 90, n: 26 },      // Flushing (far field)
  { lat: 40.702, lon: -73.80, r: 600, peak: 80, n: 22 },       // Jamaica (far field)
  { lat: 40.64, lon: -73.95, r: 900, peak: 60, n: 30 },        // central Brooklyn (far field)
  { lat: 40.86, lon: -73.89, r: 900, peak: 70, n: 30 },        // the Bronx (far field)
];

/**
 * Level C / D city: instanced low-detail buildings that line the real street network of
 * Brooklyn, Queens and the Bronx, a synthetic street grid for New Jersey, and far-field skyline clusters.
 */
export class OuterCity {
  readonly group = new THREE.Group();
  private geo = unitBox();
  private meshes: THREE.InstancedMesh[] = [];

  constructor(private data: CityData, private ground: GroundBuild) {
    this.group.name = 'outer-city';
  }

  build(p: Params) {
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = [];
    const grid = this.ground.grid;
    const occ = new Uint8Array(grid.occ); // private copy so rebuilding stays deterministic
    const r = mulberry32(p.seed * 31 + 7);
    const boxes: Box[] = [];
    const isOcc = (x: number, z: number) => { const k = grid.idx(x, z); return k < 0 ? false : occ[k] === 1 || grid.road[k] === 1; };
    const mark = (x: number, z: number, rad: number) => { for (let dz = -rad; dz <= rad; dz += grid.cell) for (let dx = -rad; dx <= rad; dx += grid.cell) { const k = grid.idx(x + dx, z + dz); if (k >= 0) occ[k] = 1; } };
    const rowOf = (fam: Family) => fam * VARIANTS + Math.floor(r() * (1 + p.archVariation * (VARIANTS - 1)));
    const hs = p.heightScale;

    // ---- boroughs: row buildings lining the real streets
    for (const rd of this.data.roads) {
      if (rd.b === 1 || rd.t !== 1) continue;
      const n = rd.pts.length / 2;
      for (let i = 0; i < n - 1; i++) {
        const ax = rd.pts[i * 2], az = rd.pts[i * 2 + 1], bx = rd.pts[i * 2 + 2], bz = rd.pts[i * 2 + 3];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 24) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L, ang = Math.atan2(tz, tx);
        // closer to Manhattan the fabric is taller and denser
        const prox = Math.max(0, 1 - Math.hypot(ax, az - 1500) / 9000);
        for (const side of [-1, 1]) {
          let s = 9 + r() * 6;
          while (s < L - 9) {
            const w = 7 + r() * 16, d = 10 + r() * 7;
            const off = rd.w / 2 + 3 + d / 2;
            const x = ax + tx * (s + w / 2) - tz * side * off, z = az + tz * (s + w / 2) + tx * side * off;
            s += w + (r() < 0.12 ? 4 + r() * 10 : 0.4);
            if (s > L - 6) break;
            if (isOcc(x, z) || isOcc(x - tz * side * d * 0.4, z + tx * side * d * 0.4)) continue;
            let h = 7 + r() * 7 + prox * r() * 14;
            if (r() < 0.05 + prox * 0.1) h += 10 + r() * 22;
            const fam = h > 22 ? (r() < 0.5 ? Family.BrickApartment : Family.ModernResidential) : r() < 0.2 ? Family.Industrial : Family.OuterGeneric;
            boxes.push({ x, z, w, d, h: h * hs, ang, row: rowOf(fam), seed: r() });
            mark(x, z, Math.max(w, d) * 0.45);
          }
        }
      }
    }
    // ---- New Jersey: a synthetic grid over the hand-traced land polygon
    const nj = this.ground.landPolys.find((l) => l.boro === 9)!.pts;
    const gAng = 0.18; // Hoboken's grid leans a little east of north
    const c = Math.cos(gAng), s = Math.sin(gAng);
    const BW = 78, BL = 142;
    const [ox, oz] = ll(40.74, -74.03);
    for (let i = -78; i <= 84; i++) for (let j = -84; j <= 96; j++) {
      const bx = ox + (i * BW) * c - (j * BL) * s, bz = oz + (i * BW) * s + (j * BL) * c;
      if (bx < -9800 || bz < this.data.bbox.minZ - 3000 || bz > this.data.bbox.maxZ + 2200) continue;
      if (!pointInPoly(bx, bz, nj) || !pointInPoly(bx + 60, bz, nj)) continue;
      const hv = hash2(i * 13 + 5, j * 7 + p.seed);
      if (hv < 0.12) continue; // parks, yards, rail cuts
      const depth = Math.hypot(bx - ox, bz - oz);
      const lots = depth > 3200 ? 2 : 3 + Math.floor(hv * 3);
      for (let k = 0; k < lots; k++) for (const sd of [-1, 1]) {
        const lw = (BL - 16) / lots, ly = -BL / 2 + 8 + lw * (k + 0.5), lx = sd * (BW / 2 - 9 - 7);
        const x = bx + lx * c - ly * s, z = bz + lx * s + ly * c;
        let h = 8 + r() * 8 + Math.max(0, 1 - depth / 2500) * r() * 12;
        if (r() < 0.04) h += 14 + r() * 25;
        boxes.push({ x, z, w: BW / 2 - 12, d: lw - 1.2, h: h * hs, ang: gAng, row: rowOf(h > 24 ? Family.ModernResidential : r() < 0.25 ? Family.Industrial : Family.OuterGeneric), seed: r() });
      }
    }
    // ---- skyline clusters
    for (const cl of JC_CLUSTERS) {
      const [cx, cz] = ll(cl.lat, cl.lon);
      for (let k = 0; k < cl.n; k++) {
        const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * cl.r;
        const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad * 1.25;
        if (cl.lon < -73.96 && cl.lat < 40.84 && !pointInPoly(x, z, nj)) continue;
        const h = (28 + cl.peak * Math.pow(r(), 1.7) * (1 - 0.55 * rad / cl.r)) * hs;
        const w = 22 + r() * 22, d = 20 + r() * 18;
        const fam = r() < 0.5 ? Family.GlassOffice : r() < 0.6 ? Family.ModernResidential : Family.LuxuryCondo;
        boxes.push({ x, z, w, d, h, ang: gAng + (r() < 0.3 ? 0.5 : 0), row: rowOf(fam), seed: r() });
        if (h > 110 && r() < 0.6) boxes.push({ x, z, w: w * 0.6, d: d * 0.6, h: h * 1.12, ang: gAng, row: rowOf(fam), seed: r() });
      }
    }

    // ---- bake into per-tile instanced meshes
    const TILE = 3000;
    const tiles = new Map<string, Box[]>();
    for (const b of boxes) { const k = Math.floor(b.x / TILE) + ',' + Math.floor(b.z / TILE); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k)!.push(b); }
    const mat = facadeInstancedMaterial();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const list of tiles.values()) {
      const geo = this.geo.clone();
      const inst = new Float32Array(list.length * 3);
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((b, i) => {
        q.setFromAxisAngle(up, -b.ang);
        m4.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
        im.setMatrixAt(i, m4);
        inst[i * 3] = b.row; inst[i * 3 + 1] = b.seed; inst[i * 3 + 2] = 0;
      });
      geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 3));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.meshes.push(im);
    }
    return boxes.length;
  }

  dispose() { for (const m of this.meshes) m.dispose(); this.geo.dispose(); }
}
