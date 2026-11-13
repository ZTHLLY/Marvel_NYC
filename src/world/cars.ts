import * as THREE from 'three';
import { extendMaterial } from '../engine/materials';
import { HIDE_PARS, HIDE_VERT } from '../city/instLod';

/**
 * Procedural cars built from lofted cross-sections (not extrusions): every body is a smooth skin through a set of
 * station sections whose sill, belt line, roof line and tumblehome vary along the length; wheel arches are cut into
 * the sill. A per-vertex material id (aMat) keeps glass, tyres, rims, trim and lamps independent of the paint colour.
 *
 * Material ids: 0 paint · 1 glass · 2 tyre · 3 rim · 4 black trim/grille · 5 head lamp · 6 tail lamp · 7 chrome ·
 *               8 taxi roof sign · 9 underbody · 10 licence plate
 */

export type CarKind = 'sedan' | 'suv' | 'taxi' | 'van';
export const CAR_KINDS: CarKind[] = ['sedan', 'suv', 'taxi', 'van'];

interface Spec {
  L: number; W: number; wheelR: number; axles: [number, number];
  /** t (0 rear → 1 front), sill y, belt y, top y, body half-width (× W/2), top half-width (× W/2) */
  keys: [number, number, number, number, number, number][];
  rearGlass: [number, number]; roof: [number, number]; windshield: [number, number];
  side: [number, number]; pillars: [number, number][];
  lampY: number; tailY: number;
}

const SPECS: Record<'sedan' | 'suv' | 'van', Spec> = {
  sedan: {
    L: 4.85, W: 1.84, wheelR: 0.33, axles: [0.205, 0.8],
    keys: [
      [0.0, 0.42, 0.74, 0.8, 0.8, 0.68], [0.025, 0.3, 0.86, 0.93, 0.93, 0.8], [0.09, 0.27, 0.92, 1.0, 0.97, 0.84],
      [0.2, 0.27, 0.94, 1.03, 0.995, 0.85], [0.37, 0.27, 0.95, 1.43, 1.0, 0.76], [0.6, 0.27, 0.95, 1.45, 1.0, 0.77],
      [0.765, 0.27, 0.93, 0.99, 0.99, 0.86], [0.9, 0.28, 0.87, 0.91, 0.97, 0.84], [0.975, 0.33, 0.78, 0.81, 0.91, 0.76],
      [1.0, 0.42, 0.68, 0.71, 0.8, 0.66],
    ],
    rearGlass: [0.2, 0.37], roof: [0.37, 0.6], windshield: [0.6, 0.765], side: [0.28, 0.72], pillars: [[0.47, 0.5]],
    lampY: 0.74, tailY: 0.82,
  },
  suv: {
    L: 4.75, W: 1.93, wheelR: 0.375, axles: [0.19, 0.81],
    keys: [
      [0.0, 0.5, 0.86, 0.92, 0.84, 0.72], [0.025, 0.38, 0.98, 1.08, 0.95, 0.8], [0.07, 0.36, 1.02, 1.58, 0.99, 0.8],
      [0.11, 0.36, 1.03, 1.72, 1.0, 0.8], [0.62, 0.36, 1.03, 1.74, 1.0, 0.8], [0.785, 0.36, 1.01, 1.13, 0.99, 0.87],
      [0.92, 0.37, 0.98, 1.06, 0.97, 0.86], [0.98, 0.43, 0.9, 0.97, 0.92, 0.8], [1.0, 0.52, 0.8, 0.86, 0.85, 0.72],
    ],
    rearGlass: [0.025, 0.11], roof: [0.11, 0.62], windshield: [0.62, 0.785], side: [0.07, 0.75], pillars: [[0.2, 0.235], [0.45, 0.48]],
    lampY: 0.88, tailY: 1.0,
  },
  van: {
    L: 5.9, W: 2.02, wheelR: 0.36, axles: [0.2, 0.84],
    keys: [
      [0.0, 0.46, 1.0, 2.3, 0.97, 0.92], [0.015, 0.4, 1.02, 2.42, 1.0, 0.94], [0.7, 0.4, 1.04, 2.46, 1.0, 0.94],
      [0.84, 0.42, 1.06, 1.26, 1.0, 0.9], [0.9, 0.42, 1.02, 1.14, 0.98, 0.88], [0.97, 0.45, 0.95, 1.03, 0.94, 0.82],
      [1.0, 0.52, 0.86, 0.92, 0.87, 0.76],
    ],
    rearGlass: [0.0, 0.0], roof: [0.015, 0.7], windshield: [0.7, 0.84], side: [0.735, 0.84], pillars: [],
    lampY: 0.95, tailY: 1.05,
  },
};

/** monotone cubic (Fritsch–Carlson) through the keyframes: smooth without overshooting the roof/bonnet breaks */
function monotone(ts: number[], ys: number[]) {
  const n = ts.length, d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (ts[i + 1] - ts[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (ts[i + 1] - ts[i - 1])) / ((2 * ts[i + 1] - ts[i] - ts[i - 1]) / d[i - 1] + (ts[i + 1] + ts[i] - 2 * ts[i - 1]) / d[i]);
  return (t: number) => {
    let i = 0; while (i < n - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], s = Math.max(0, Math.min(1, (t - ts[i]) / h));
    const h00 = 2 * s ** 3 - 3 * s * s + 1, h10 = s ** 3 - 2 * s * s + s, h01 = -2 * s ** 3 + 3 * s * s, h11 = s ** 3 - s * s;
    return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
  };
}

class Builder {
  pos: number[] = []; nrm: number[] = []; mat: number[] = []; aux: number[] = []; idx: number[] = [];
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, m: number, a = 0, b = 0) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.mat.push(m); this.aux.push(a, b);
    return this.pos.length / 3 - 1;
  }
  /** triangle wound to agree with its vertex normals */
  tri(a: number, b: number, c: number) {
    const P = this.pos, N = this.nrm;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  /** append a three.js primitive with a material id */
  add(g: THREE.BufferGeometry, m: number) {
    const base = this.pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) this.v(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), m);
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(this.aux, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** lod 0 = hero (~2.5k tris), 1 = mid (~700), 2 = far (~250) */
function buildCar(kind: CarKind, lod: number): THREE.BufferGeometry {
  const S = SPECS[kind === 'taxi' ? 'sedan' : kind];
  const B = new Builder();
  const L = S.L, hw = S.W / 2, z0 = -L / 2;
  const K = S.keys, ts = K.map((k) => k[0]);
  const fYb = monotone(ts, K.map((k) => k[1])), fBelt = monotone(ts, K.map((k) => k[2])), fTop = monotone(ts, K.map((k) => k[3]));
  const fWb = monotone(ts, K.map((k) => k[4])), fWt = monotone(ts, K.map((k) => k[5]));
  const R = S.wheelR, archR = R + 0.06;
  const axZ = S.axles.map((a) => z0 + a * L);
  // stations: uniform samples + every material boundary + extra samples around the wheel arches
  const st = new Set<number>();
  const nU = [26, 8, 5][lod];
  for (let i = 0; i <= nU; i++) st.add(i / nU);
  if (lod < 2) for (const v of [...S.rearGlass, ...S.roof, ...S.windshield, ...S.side, ...S.pillars.flat()]) st.add(v);
  const archN = [8, 2, 0][lod];
  if (archN > 0) for (const az of axZ) for (let i = 0; i <= archN; i++) st.add((az - z0 + archR * Math.cos(Math.PI * (1 - i / archN))) / L);
  const T = [...st].filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.004);
  // the sill rises over each wheel to form the arch
  const sill = (t: number) => {
    const z = z0 + t * L;
    let y = fYb(t);
    for (const az of axZ) { const dz = z - az; if (Math.abs(dz) < archR) y = Math.max(y, R + Math.sqrt(archR * archR - dz * dz) - 0.02); }
    return y;
  };
  // half-profile from bottom centre to top centre
  const prof = (t: number): [number, number][] => {
    const yb = sill(t), belt = Math.max(fBelt(t), yb + 0.2), top = Math.max(fTop(t), belt + 0.04);
    const wb = fWb(t) * hw, wt = Math.min(fWt(t) * hw, wb * 0.97);
    const lowY = Math.max(fYb(t), 0.2);
    const pts: [number, number][] = [
      [0, lowY], [wb * 0.82, lowY], [wb * 0.96, yb + 0.03], [wb, yb + (belt - yb) * 0.42], [wb * 0.99, belt - 0.035], [wb * 0.955, belt + 0.01],
      [wb * 0.955 + (wt - wb * 0.955) * 0.62, belt + (top - belt) * 0.6], [wt, top - Math.min(0.06, (top - belt) * 0.3)], [wt * 0.86, top - 0.006], [0, top + 0.012],
    ];
    if (lod === 2) return [pts[0], pts[2], pts[3], pts[5], pts[7], pts[9]];
    if (lod === 1) return [pts[0], pts[1], pts[2], pts[3], pts[5], pts[6], pts[7], pts[8], pts[9]];
    return pts;
  };
  const P = T.map(prof);
  const J = P[0].length;
  // which material does profile edge j (point j → j+1) take in the segment that starts at station t?
  const inZ = (t: number, z: [number, number]) => t >= z[0] - 1e-4 && t < z[1] - 1e-4;
  // indices of the first greenhouse-side edge and of the A/C-pillar (top-side) edge for this LOD's profile
  const [sideIdx, topIdx] = [[5, 7], [4, 6], [3, 4]][lod];
  const edgeMat = (t: number, j: number) => {
    if (j === 0) return 9;
    if (j === 1 && lod < 2) return 4;
    const cabin = inZ(t, S.rearGlass) || inZ(t, S.roof) || inZ(t, S.windshield);
    const glassSide = inZ(t, S.side) && !S.pillars.some((p) => inZ(t, p));
    if (j >= sideIdx && j < topIdx) return glassSide && cabin ? 1 : 0;
    if (j >= topIdx) {
      if (!(inZ(t, S.windshield) || inZ(t, S.rearGlass))) return 0;
      return lod < 2 && j === topIdx ? 0 : 1;   // pillar strip, then the glass
    }
    return 0;
  };
  // smooth normals over the parametric grid (both halves mirrored)
  const pos = (i: number, j: number, s: number) => { const p = P[i][j]; return [p[0] * s, p[1], z0 + T[i] * L]; };
  const normalAt = (i: number, j: number, s: number) => {
    const a = pos(Math.min(T.length - 1, i + 1), j, s), b = pos(Math.max(0, i - 1), j, s);
    const c = pos(i, Math.min(J - 1, j + 1), s), d = pos(i, Math.max(0, j - 1), s);
    const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // make it point away from the body axis
    const p = pos(i, j, s);
    if (nx * p[0] + ny * (p[1] - 0.7) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    return [nx, ny, nz];
  };
  for (const s of [1, -1]) {
    for (let i = 0; i < T.length - 1; i++) {
      for (let j = 0; j < J - 1; j++) {
        const m = edgeMat((T[i] + T[i + 1]) / 2, j);
        const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => {
          const p = pos(a, b, s), n = normalAt(a, b, s);
          return B.v(p[0], p[1], p[2], n[0], n[1], n[2], m);
        });
        if (s > 0) { B.tri(q[0], q[2], q[1]); B.tri(q[0], q[3], q[2]); } else { B.tri(q[0], q[1], q[2]); B.tri(q[0], q[2], q[3]); }
      }
    }
  }
  // end caps (rear panel / front fascia), fanned from the section centre
  for (const [i, dir] of [[0, -1], [T.length - 1, 1]] as const) {
    const ring: [number, number][] = [...P[i], ...[...P[i]].reverse().slice(1, -1).map(([x, y]) => [-x, y] as [number, number])];
    const z = z0 + T[i] * L;
    const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const c = B.v(0, cy, z, 0, 0, dir, 0);
    const ids = ring.map(([x, y]) => B.v(x, y, z, 0, 0, dir, y < P[i][2][1] + 0.02 ? 4 : 0));
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k], b = ids[(k + 1) % ids.length];
      if (dir > 0) B.tri(c, a, b); else B.tri(c, b, a);
    }
  }
  // wheels: tyre (lathe) + rim disc with polar coordinates for the spoke pattern
  const seg = [18, 7, 4][lod];
  const tw = kind === 'van' ? 0.24 : 0.23;
  for (const az of axZ) for (const s of [1, -1]) {
    const xc = s * (hw * 0.93 - tw / 2);
    const rimR = R * 0.64;
    const profT: [number, number][] = lod === 2 ? [[R, -tw / 2], [R, tw / 2]]
      : [[rimR, -tw / 2], [R * 0.93, -tw / 2], [R, -tw * 0.35], [R, tw * 0.35], [R * 0.93, tw / 2], [rimR * 1.04, tw / 2 + 0.005], [rimR, tw / 2 - 0.01]];
    const base = B.pos.length / 3;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let p = 0; p < profT.length; p++) {
        const [r, x] = profT[p];
        const pn = profT[Math.min(profT.length - 1, p + 1)], pp = profT[Math.max(0, p - 1)];
        // profile normal (radial, axial)
        let nr = -(pn[1] - pp[1]), nx = pn[0] - pp[0]; const l = Math.hypot(nr, nx) || 1; nr /= l; nx /= l;
        B.v(xc + x * s, R + sa * r, az + ca * r, nx * s, sa * nr, ca * nr, 2);
      }
    }
    const np = profT.length;
    for (let k = 0; k < seg; k++) for (let p = 0; p < np - 1; p++) {
      const a = base + k * np + p, b = a + np;
      if (s > 0) { B.tri(a, b, a + 1); B.tri(a + 1, b, b + 1); } else { B.tri(a, a + 1, b); B.tri(a + 1, b + 1, b); }
    }
    // rim face, slightly dished
    const rx = xc + s * (tw / 2 - 0.03);
    const hub = B.v(rx + s * 0.015, R, az, s, 0, 0, 3, 0, 0);
    if (lod === 2) continue;
    const rs = lod === 0 ? seg * 2 : seg;
    const r0 = B.pos.length / 3;
    for (let k = 0; k <= rs; k++) {
      const a = (k / rs) * Math.PI * 2;
      B.v(rx, R + Math.sin(a) * rimR, az + Math.cos(a) * rimR, s * 0.9, Math.sin(a) * 0.3, Math.cos(a) * 0.3, 3, Math.cos(a), Math.sin(a));
    }
    for (let k = 0; k < rs; k++) { if (s > 0) B.tri(hub, r0 + k, r0 + k + 1); else B.tri(hub, r0 + k + 1, r0 + k); }
  }
  if (lod === 2) {
    // a hint of lamps for distant traffic
    for (const s of [1, -1]) {
      B.add(new THREE.PlaneGeometry(0.34, 0.1).translate(s * hw * 0.62, S.lampY, L / 2 + 0.01), 5);
      B.add(new THREE.PlaneGeometry(0.3, 0.1).rotateY(Math.PI).translate(s * hw * 0.68, S.tailY, -L / 2 - 0.01), 6);
    }
    return B.build();
  }
  // lamps, grille, bumpers, plates, mirrors
  const tEnd = (t: number) => prof(t);
  const front = tEnd(0.985), rear = tEnd(0.015);
  const fw = front[3][0], rw = rear[3][0];
  for (const s of [1, -1]) {
    const hl = kind === 'van' ? new THREE.BoxGeometry(0.3, 0.2, 0.12) : new THREE.BoxGeometry(0.42, 0.13, 0.16);
    B.add(hl.translate(s * (fw - 0.27), S.lampY, L / 2 - 0.06), 5);
    const tl = kind === 'suv' || kind === 'van' ? new THREE.BoxGeometry(0.14, 0.34, 0.1) : new THREE.BoxGeometry(0.4, 0.13, 0.1);
    B.add(tl.translate(s * (rw - (kind === 'sedan' || kind === 'taxi' ? 0.25 : 0.1)), S.tailY, -L / 2 + 0.03), 6);
    // side mirrors at the base of the A-pillar
    const tm = S.windshield[1] - 0.02, mp = prof(tm), my = mp[sideIdx][1] + 0.1;
    B.add(new THREE.BoxGeometry(0.2, 0.12, 0.1).translate(s * (mp[sideIdx][0] + 0.09), my, z0 + tm * L), 0);
    B.add(new THREE.BoxGeometry(0.1, 0.04, 0.06).translate(s * (mp[sideIdx][0] + 0.02), my - 0.03, z0 + tm * L + 0.02), 4);
  }
  // grille between the head lamps, bumper rub strips, plates
  const gy = S.lampY - (kind === 'van' ? 0.05 : 0.08);
  B.add(new THREE.BoxGeometry(fw * 2 - 0.95, kind === 'van' ? 0.3 : 0.16, 0.1).translate(0, gy, L / 2 - 0.035), 4);
  B.add(new THREE.BoxGeometry(fw * 2 - 0.85, 0.025, 0.11).translate(0, gy + (kind === 'van' ? 0.16 : 0.09), L / 2 - 0.035), 7);
  B.add(new THREE.BoxGeometry(fw * 1.9, 0.12, 0.12).translate(0, 0.38 + (kind === 'suv' ? 0.08 : 0), L / 2 - 0.04), 4);
  B.add(new THREE.BoxGeometry(rw * 1.9, 0.12, 0.12).translate(0, 0.4 + (kind === 'suv' ? 0.08 : 0), -L / 2 + 0.04), 4);
  B.add(new THREE.BoxGeometry(0.52, 0.11, 0.02).translate(0, 0.52 + (kind === 'suv' ? 0.08 : 0), -L / 2 - 0.005), 10);
  if (kind === 'taxi') {
    // roof light & a chequer-free modern NYC cab sign
    const top = fTop(0.5);
    B.add(new THREE.BoxGeometry(0.85, 0.28, 0.2).translate(0, top + 0.16, 0.05 * L), 8);
    B.add(new THREE.BoxGeometry(0.95, 0.03, 0.26).translate(0, top + 0.02, 0.05 * L), 4);
  }
  if (kind === 'van' && lod === 0) {
    // roof rails and a rear-door seam read as a working van
    for (const s of [1, -1]) B.add(new THREE.BoxGeometry(0.04, 0.04, L * 0.6).translate(s * hw * 0.7, fTop(0.4) + 0.03, -0.3), 4);
  }
  return B.build();
}

const cache = new Map<string, THREE.BufferGeometry>();
export function carGeometryOf(kind: CarKind, lod: number) {
  const k = kind + lod;
  let g = cache.get(k);
  if (!g) { g = buildCar(kind, lod); cache.set(k, g); }
  return g;
}

const CAR_SURFACE = /* glsl */ `
{
  float id = floor(vMat + 0.5);
  vec3 paint = diffuseColor.rgb;
  vec3 c = paint;
  float rough = 0.2, metal = 0.0;
  vec3 em = vec3(0.0);
  float lit = vCarLit;
  if (id < 0.5) {
    // two-coat paint: solid colours read as a glossy clear coat, mid tones as metallic flake
    float lum = dot(paint, vec3(0.3, 0.59, 0.11));
    float metallic = step(0.5, fract(paint.r * 41.0 + paint.g * 17.0 + paint.b * 7.0)) * step(0.03, lum) * step(lum, 0.75);
    metal = metallic * 0.55; rough = mix(0.12, 0.3, metallic);
    // road grime on the lower body
    c *= mix(0.72, 1.0, smoothstep(0.25, 0.65, vCarP.y));
  } else if (id < 1.5) {
    c = vec3(0.018, 0.022, 0.026); rough = 0.03; metal = 0.1;
  } else if (id < 2.5) {
    c = vec3(0.03, 0.03, 0.032); rough = 0.86;
  } else if (id < 3.5) {
    // 5-spoke alloy: spokes polished, openings dark, hub cap and rim lip
    float r = length(vCarA);
    float ang = atan(vCarA.y, vCarA.x + 1e-5);
    float spoke = smoothstep(0.3, 0.36, abs(fract(ang * 0.7958) - 0.5));
    float m = max(spoke, max(1.0 - smoothstep(0.24, 0.3, r), smoothstep(0.84, 0.9, r)));
    c = mix(vec3(0.015), vec3(0.55, 0.56, 0.58), m); metal = 0.9 * m; rough = 0.28;
  } else if (id < 4.5) {
    c = vec3(0.028, 0.029, 0.031); rough = 0.5;
  } else if (id < 5.5) {
    c = vec3(0.55, 0.56, 0.58); rough = 0.06; metal = 0.6;
    em = vec3(1.0, 0.93, 0.82) * (0.25 + 9.0 * uNight) * lit + vec3(0.9, 0.95, 1.0) * 0.6 * lit;
  } else if (id < 6.5) {
    c = vec3(0.28, 0.012, 0.01); rough = 0.12;
    em = vec3(1.0, 0.05, 0.02) * (0.3 + 4.0 * uNight) * lit;
  } else if (id < 7.5) {
    c = vec3(0.7, 0.71, 0.72); metal = 1.0; rough = 0.14;
  } else if (id < 8.5) {
    c = vec3(0.85, 0.83, 0.75); rough = 0.4;
    em = vec3(1.0, 0.85, 0.55) * (0.3 + 2.5 * uNight);
  } else if (id < 9.5) {
    c = vec3(0.015); rough = 0.9;
  } else {
    c = vec3(0.72, 0.72, 0.68); rough = 0.5;
  }
  diffuseColor.rgb = c;
  roughnessFactor = rough;
  metalnessFactor = metal;
  totalEmissiveRadiance += min(em, vec3(30.0));
}
`;

/** Shared car material: paint comes from material colour × instance colour; everything else ignores it. */
export function carMaterial(color: THREE.ColorRepresentation = 0xffffff) {
  return extendMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0 }), {
    key: 'car2', weather: true,
    vPars: `attribute float aMat; attribute vec2 aAux; attribute float aLit; ${HIDE_PARS}
      varying float vMat; varying vec2 vCarA; varying vec3 vCarP; varying float vCarLit;`,
    vMain: `vMat = aMat; vCarA = aAux; vCarP = position; vCarLit = aLit; ${HIDE_VERT}`,
    fPars: 'varying float vMat; varying vec2 vCarA; varying vec3 vCarP; varying float vCarLit;',
    fSurface: CAR_SURFACE,
  });
}

/** Default hero geometry (kept for callers that want a single saloon). */
export function carGeometry(): THREE.BufferGeometry {
  return carGeometryOf('sedan', 0);
}
