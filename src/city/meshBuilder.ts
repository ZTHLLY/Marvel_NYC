import * as THREE from 'three';
import earcut from 'earcut';

/**
 * Growable merged-geometry builder for facade-shaded architecture.
 * Vertex layout: position(3f) normal(3 x int8) uv(2f: metres along wall, metres up) aStyle(3f: code, seed, topY)
 * where code = paletteRow + surface * 1024.
 */
export class MeshBuilder {
  pos: Float32Array; nrm: Int8Array; uv: Float32Array; sty: Float32Array; idx: Uint32Array;
  nv = 0; ni = 0;
  // current style state
  row = 0; surf = 0; seed = 0; topY = 0;

  constructor(vertCap = 4096) {
    this.pos = new Float32Array(vertCap * 3);
    this.nrm = new Int8Array(vertCap * 3);
    this.uv = new Float32Array(vertCap * 2);
    this.sty = new Float32Array(vertCap * 3);
    this.idx = new Uint32Array(vertCap * 2);
  }

  style(row: number, surf: number, seed: number, topY: number) { this.row = row; this.surf = surf; this.seed = seed; this.topY = topY; return this; }

  private growV(n: number) {
    if ((this.nv + n) * 3 <= this.pos.length) return;
    const cap = Math.max((this.nv + n) * 2, this.pos.length / 3 * 2);
    const g = <T extends Float32Array | Int8Array>(a: T, k: number): T => { const b = new (a.constructor as any)(cap * k) as T; b.set(a); return b; };
    this.pos = g(this.pos, 3); this.nrm = g(this.nrm, 3); this.uv = g(this.uv, 2); this.sty = g(this.sty, 3);
  }
  private growI(n: number) {
    if (this.ni + n <= this.idx.length) return;
    const b = new Uint32Array(Math.max((this.ni + n) * 2, this.idx.length * 2)); b.set(this.idx); this.idx = b;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    this.growV(1);
    const i = this.nv++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.nrm[i * 3] = Math.round(nx * 127); this.nrm[i * 3 + 1] = Math.round(ny * 127); this.nrm[i * 3 + 2] = Math.round(nz * 127);
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.sty[i * 3] = this.row + this.surf * 1024; this.sty[i * 3 + 1] = this.seed; this.sty[i * 3 + 2] = this.topY;
    return i;
  }
  tri(a: number, b: number, c: number) { this.growI(3); this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  quad(a: number, b: number, c: number, d: number) { this.tri(a, b, c); this.tri(a, c, d); }

  /** Arbitrary planar quad given 4 corners in CCW order (as seen from the front). */
  face(p: number[][], uvs?: number[][]) {
    const [a, b, c, d] = p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
    const t = uvs ?? [[0, a[1]], [lu, b[1]], [lu, c[1]], [0, d[1]]];
    if (!uvs && Math.abs(ny) > 0.7) { t[0] = [0, 0]; t[1] = [lu, 0]; t[2] = [lu, lv]; t[3] = [0, lv]; }
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, t[0][0], t[0][1]);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, t[1][0], t[1][1]);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, t[2][0], t[2][1]);
    const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, t[3][0], t[3][1]);
    this.quad(i0, i1, i2, i3);
  }

  /**
   * Vertical walls around a closed CCW (positive x/z area) polygon.
   * bayW > 0 snaps the facade grid so every wall holds a whole number of bays.
   * topFn optionally gives a per-vertex top height (sloped crowns).
   */
  walls(pts: ArrayLike<number>, y0: number, y1: number, bayW = 0, topFn?: (x: number, z: number) => number, blankShort = true) {
    const n = pts.length / 2;
    let uAcc = Math.floor(this.seed * 37) * (bayW || 1);
    const surf0 = this.surf;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const nx = dz / L, nz = -dx / L;
      let uLen = L;
      if (bayW > 0) {
        if (L < bayW * 0.62 && blankShort && surf0 === 0) this.surf = 8;
        else uLen = Math.max(1, Math.round(L / bayW)) * bayW;
      }
      const ya = topFn ? topFn(ax, az) : y1, yb = topFn ? topFn(bx, bz) : y1;
      const i0 = this.vert(ax, y0, az, nx, 0, nz, uAcc, y0);
      const i1 = this.vert(bx, y0, bz, nx, 0, nz, uAcc + uLen, y0);
      const i2 = this.vert(bx, yb, bz, nx, 0, nz, uAcc + uLen, yb);
      const i3 = this.vert(ax, ya, az, nx, 0, nz, uAcc, ya);
      this.tri(i0, i2, i1); this.tri(i0, i3, i2);
      uAcc += bayW > 0 ? Math.ceil(uLen / bayW + 1) * bayW : uLen;
      this.surf = surf0;
    }
  }

  /** Horizontal cap (roof) over a polygon, optionally with holes ring (annulus) and per-vertex height. */
  cap(pts: ArrayLike<number>, y: number, hole?: ArrayLike<number>, yFn?: (x: number, z: number) => number, down = false) {
    const n = pts.length / 2;
    const flat: number[] = Array.from(pts as ArrayLike<number>);
    let holes: number[] | undefined;
    if (hole) { holes = [n]; for (let i = 0; i < hole.length; i++) flat.push(hole[i]); }
    const tris = earcut(flat, holes, 2);
    const base = this.nv;
    const total = flat.length / 2;
    for (let i = 0; i < total; i++) {
      const x = flat[i * 2], z = flat[i * 2 + 1];
      this.vert(x, yFn ? yFn(x, z) : y, z, 0, down ? -1 : 1, 0, x, z);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[c * 2] - flat[a * 2]) * (flat[b * 2 + 1] - flat[a * 2 + 1]);
      // positive x/z cross => normal points down in a Y-up frame; flip so the visible side matches `down`
      if (cr > 0 !== down) this.tri(base + a, base + c, base + b); else this.tri(base + a, base + b, base + c);
    }
  }

  /** Box centred at (cx, cz) sitting on y0, rotated by `ang` around Y. */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, ang = 0, bottom = false) {
    const c = Math.cos(ang), s = Math.sin(ang), hx = sx / 2, hz = sz / 2;
    const P = (lx: number, lz: number): [number, number] => [cx + lx * c - lz * s, cz + lx * s + lz * c];
    // corners ordered so the ring has positive x/z area
    const r = [P(-hx, -hz), P(hx, -hz), P(hx, hz), P(-hx, hz)];
    const ring = [r[0][0], r[0][1], r[1][0], r[1][1], r[2][0], r[2][1], r[3][0], r[3][1]];
    this.walls(ring, y0, y0 + sy, 0);
    const s0 = this.surf;
    if (this.surf === 0 || this.surf === 8) this.surf = 1;
    this.cap(ring, y0 + sy);
    if (bottom) this.cap(ring, y0, undefined, undefined, true);
    this.surf = s0;
  }

  /** Square-section beam between two arbitrary points (railings, braces, cables, antennas). */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, t = w) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz); if (L < 1e-4) return;
    dx /= L; dy /= L; dz /= L;
    // side vector: horizontal perpendicular (or X if the beam is vertical)
    let sx = -dz, sy = 0, sz = dx; let sl = Math.hypot(sx, sz);
    if (sl < 1e-4) { sx = 1; sz = 0; sl = 1; }
    sx /= sl; sz /= sl;
    const ux = sy * dz - sz * dy, uy = sz * dx - sx * dz, uz = sx * dy - sy * dx; // up = s x d
    const hw = w / 2, ht = t / 2;
    const corner = (px: number, py: number, pz: number, a: number, b: number) => [px + sx * a * hw + ux * b * ht, py + uy * b * ht, pz + sz * a * hw + uz * b * ht];
    const A = [corner(ax, ay, az, -1, -1), corner(ax, ay, az, 1, -1), corner(ax, ay, az, 1, 1), corner(ax, ay, az, -1, 1)];
    const B = [corner(bx, by, bz, -1, -1), corner(bx, by, bz, 1, -1), corner(bx, by, bz, 1, 1), corner(bx, by, bz, -1, 1)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.face([A[j], A[i], B[i], B[j]]);
    }
    this.face([A[0], A[1], A[2], A[3]]);
    this.face([B[1], B[0], B[3], B[2]]);
  }

  /** Vertical cylinder / cone frustum (r1 = top radius). */
  cyl(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, segs = 12, capTop = true) {
    const ring0: number[] = [], ring1: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      // clockwise in angle => positive x/z area ordering
      ring0.push(cx + Math.cos(a) * r0, cz + Math.sin(a) * r0);
      ring1.push(cx + Math.cos(a) * r1, cz + Math.sin(a) * r1);
    }
    const slope = (r0 - r1) / Math.max(h, 1e-3);
    const circ = Math.PI * 2 * Math.max(r0, r1);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const n0 = new THREE.Vector3(Math.cos(a0), slope, Math.sin(a0)).normalize();
      const n1 = new THREE.Vector3(Math.cos(a1), slope, Math.sin(a1)).normalize();
      const u0 = (i / segs) * circ, u1 = ((i + 1) / segs) * circ;
      const i0 = this.vert(ring0[i * 2], y0, ring0[i * 2 + 1], n0.x, n0.y, n0.z, u0, y0);
      const i1 = this.vert(ring0[j * 2], y0, ring0[j * 2 + 1], n1.x, n1.y, n1.z, u1, y0);
      const i2 = this.vert(ring1[j * 2], y0 + h, ring1[j * 2 + 1], n1.x, n1.y, n1.z, u1, y0 + h);
      const i3 = this.vert(ring1[i * 2], y0 + h, ring1[i * 2 + 1], n0.x, n0.y, n0.z, u0, y0 + h);
      this.tri(i0, i2, i1); this.tri(i0, i3, i2);
    }
    if (capTop && r1 > 0.01) this.cap(ring1, y0 + h);
  }

  /** Pyramid / hip from a polygon up to an apex point. */
  pyramid(pts: ArrayLike<number>, y0: number, ax: number, ay: number, az: number) {
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p0 = [pts[i * 2], y0, pts[i * 2 + 1]], p1 = [pts[j * 2], y0, pts[j * 2 + 1]], ap = [ax, ay, az];
      const ux = p1[0] - p0[0], uz = p1[2] - p0[2];
      const vx = ap[0] - p0[0], vy = ap[1] - p0[1], vz = ap[2] - p0[2];
      // outward normal = v x u  (edge runs CCW-positive, outward is right-hand side)
      let nx = vy * uz - vz * 0, ny = vz * ux - vx * uz, nz = vx * 0 - vy * ux;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const L = Math.hypot(ux, uz);
      const i0 = this.vert(p0[0], p0[1], p0[2], nx, ny, nz, 0, y0);
      const i1 = this.vert(p1[0], p1[1], p1[2], nx, ny, nz, L, y0);
      const i2 = this.vert(ap[0], ap[1], ap[2], nx, ny, nz, L / 2, ay);
      this.tri(i0, i2, i1);
    }
  }

  get empty() { return this.ni === 0; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.nv * 2), 2));
    g.setAttribute('aStyle', new THREE.BufferAttribute(this.sty.slice(0, this.nv * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.nv > 65535 ? this.idx.slice(0, this.ni) : new Uint16Array(this.idx.subarray(0, this.ni)), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---- polygon helpers ---------------------------------------------------------

/** Inward (d > 0) or outward (d < 0) mitre offset of a CCW-positive polygon. Returns null if it degenerates. */
export function insetPoly(pts: ArrayLike<number>, d: number): Float32Array | null {
  const n = pts.length / 2;
  if (n < 3) return null;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    const x = pts[i * 2], z = pts[i * 2 + 1];
    let e0x = x - pts[p * 2], e0z = z - pts[p * 2 + 1], e1x = pts[q * 2] - x, e1z = pts[q * 2 + 1] - z;
    const l0 = Math.hypot(e0x, e0z) || 1, l1 = Math.hypot(e1x, e1z) || 1;
    e0x /= l0; e0z /= l0; e1x /= l1; e1z /= l1;
    // inward normals for CCW-positive: (-dz, dx)
    const n0x = -e0z, n0z = e0x, n1x = -e1z, n1z = e1x;
    const k = 1 + n0x * n1x + n0z * n1z;
    const s = d / Math.max(k, 0.35);
    out[i * 2] = x + (n0x + n1x) * s;
    out[i * 2 + 1] = z + (n0z + n1z) * s;
  }
  if (d > 0) {
    let a = 0, a0 = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += out[i * 2] * out[j * 2 + 1] - out[j * 2] * out[i * 2 + 1];
      a0 += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    }
    if (a <= 0 || a > a0 * 0.98 || a < a0 * 0.08) return null;
    // every edge must keep its direction (no flipped/collapsed edges)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ox = pts[j * 2] - pts[i * 2], oz = pts[j * 2 + 1] - pts[i * 2 + 1];
      const nx = out[j * 2] - out[i * 2], nz = out[j * 2 + 1] - out[i * 2 + 1];
      if (ox * nx + oz * nz < 0) return null;
    }
  }
  return out;
}

export interface OBB { cx: number; cz: number; hx: number; hz: number; ang: number }

/** Oriented bounding box aligned to the polygon's longest edge. */
export function obbOf(pts: ArrayLike<number>): OBB {
  const n = pts.length / 2;
  let best = 0, ang = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = pts[j * 2] - pts[i * 2], dz = pts[j * 2 + 1] - pts[i * 2 + 1];
    const l = dx * dx + dz * dz;
    if (l > best) { best = l; ang = Math.atan2(dz, dx); }
  }
  const c = Math.cos(ang), s = Math.sin(ang);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    const u = pts[i * 2] * c + pts[i * 2 + 1] * s, v = -pts[i * 2] * s + pts[i * 2 + 1] * c;
    if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
  return { cx: mu * c - mv * s, cz: mu * s + mv * c, hx: (maxU - minU) / 2, hz: (maxV - minV) / 2, ang };
}

/** Rectangle (optionally chamfered into an octagon) as a CCW-positive ring. */
export function rectRing(cx: number, cz: number, hx: number, hz: number, ang: number, chamfer = 0): Float32Array {
  const c = Math.cos(ang), s = Math.sin(ang);
  const local: number[] = chamfer > 0
    ? [-hx + chamfer, -hz, hx - chamfer, -hz, hx, -hz + chamfer, hx, hz - chamfer, hx - chamfer, hz, -hx + chamfer, hz, -hx, hz - chamfer, -hx, -hz + chamfer]
    : [-hx, -hz, hx, -hz, hx, hz, -hx, hz];
  const out = new Float32Array(local.length);
  for (let i = 0; i < local.length; i += 2) {
    out[i] = cx + local[i] * c - local[i + 1] * s;
    out[i + 1] = cz + local[i] * s + local[i + 1] * c;
  }
  return out;
}

export function scaleRing(pts: ArrayLike<number>, cx: number, cz: number, k: number): Float32Array {
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) { out[i] = cx + (pts[i] - cx) * k; out[i + 1] = cz + (pts[i + 1] - cz) * k; }
  return out;
}

export function ringArea(p: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) { const j = (i + 1) % n; a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
  return a / 2;
}
