import * as THREE from 'three';
import { extendMaterial, U } from '../engine/materials';
import { facadeMaterial } from '../city/facade';
import { MeshBuilder } from '../city/meshBuilder';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';

/** Superellipse ring (rounded rectangle) with CCW-positive x/z winding. */
export function superRing(cx: number, cz: number, a: number, b: number, n = 3.2, segs = 56, ang = 0): Float32Array {
  const out = new Float32Array(segs * 2);
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    const x = a * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n), z = b * Math.sign(st) * Math.pow(Math.abs(st), 2 / n);
    out[i * 2] = cx + x * c - z * s; out[i * 2 + 1] = cz + x * s + z * c;
  }
  return out;
}

export interface LoftSection { y: number; ring: ArrayLike<number> }

/**
 * Smooth skin through a stack of rings (all with the same vertex count), shaded by the facade material.
 * uv = (metres around the perimeter, height) so the procedural curtain wall wraps the curved form.
 */
export function loftGeometry(sections: LoftSection[], row: number, surf: number, seed: number, bayW: number, capTop = true, topY?: number): THREE.BufferGeometry {
  const n = sections[0].ring.length / 2, m = sections.length;
  // snap the perimeter of the widest ring to whole bays
  let per = 0;
  const widest = sections.reduce((a, b) => (ringPerimeter(b.ring) > ringPerimeter(a.ring) ? b : a)).ring;
  const cum = [0];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; per += Math.hypot(widest[j * 2] - widest[i * 2], widest[j * 2 + 1] - widest[i * 2 + 1]); cum.push(per); }
  const k = bayW > 0 ? (Math.max(1, Math.round(per / bayW)) * bayW) / per : 1;
  const cols = n + 1;
  const pos = new Float32Array(cols * m * 3), uv = new Float32Array(cols * m * 2), sty = new Float32Array(cols * m * 3);
  const idx: number[] = [];
  const top = topY ?? sections[m - 1].y;
  for (let r = 0; r < m; r++) {
    const s = sections[r];
    for (let i = 0; i < cols; i++) {
      const o = r * cols + i, ii = i % n;
      pos[o * 3] = s.ring[ii * 2]; pos[o * 3 + 1] = s.y; pos[o * 3 + 2] = s.ring[ii * 2 + 1];
      uv[o * 2] = cum[i] * k; uv[o * 2 + 1] = s.y;
      sty[o * 3] = row + surf * 1024; sty[o * 3 + 1] = seed; sty[o * 3 + 2] = top;
    }
  }
  for (let r = 0; r < m - 1; r++) for (let i = 0; i < n; i++) {
    const a = r * cols + i, b = a + 1, c = a + cols + 1, d = a + cols;
    idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aStyle', new THREE.BufferAttribute(sty, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam normals
  const na = g.attributes.normal as THREE.BufferAttribute;
  for (let r = 0; r < m; r++) {
    const a = r * cols, b = r * cols + n;
    const x = na.getX(a) + na.getX(b), y = na.getY(a) + na.getY(b), z = na.getZ(a) + na.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    na.setXYZ(a, x / l, y / l, z / l); na.setXYZ(b, x / l, y / l, z / l);
  }
  if (!capTop) return g;
  const mb = new MeshBuilder(256);
  mb.style(row, 1, seed, top);
  mb.cap(sections[m - 1].ring, sections[m - 1].y);
  return mergeFacade([g, mb.build()]);
}

function ringPerimeter(r: ArrayLike<number>) {
  let p = 0; const n = r.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; p += Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1]); }
  return p;
}

/** Merge facade-layout geometries (position / normal / uv / aStyle + index). */
export function mergeFacade(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index!.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), sty = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  const v = new THREE.Vector3();
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal as THREE.BufferAttribute, u = g.attributes.uv, s = g.attributes.aStyle;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      v.fromBufferAttribute(n, i).normalize();
      nrm[(vo + i) * 3] = v.x; nrm[(vo + i) * 3 + 1] = v.y; nrm[(vo + i) * 3 + 2] = v.z;
      uv[(vo + i) * 2] = u.getX(i); uv[(vo + i) * 2 + 1] = u.getY(i);
      sty[(vo + i) * 3] = s.getX(i); sty[(vo + i) * 3 + 1] = s.getY(i); sty[(vo + i) * 3 + 2] = s.getZ(i);
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx[io + i] = ix.getX(i) + vo;
    vo += p.count; io += ix.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('aStyle', new THREE.BufferAttribute(sty, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export function facadeMesh(geo: THREE.BufferGeometry): THREE.Mesh {
  const m = new THREE.Mesh(geo, facadeMaterial());
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---- signage -------------------------------------------------------------------

export interface SignSpec {
  w: number; h: number;             // canvas pixels
  bg: string | [string, string];    // colour or vertical gradient
  draw?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  lines?: { text: string; size: number; y: number; color?: string; font?: string; weight?: number | string; spacing?: number; align?: CanvasTextAlign; x?: number; italic?: boolean }[];
}

export function signTexture(spec: SignSpec): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = spec.w; c.height = spec.h;
  const ctx = c.getContext('2d')!;
  if (Array.isArray(spec.bg)) {
    const g = ctx.createLinearGradient(0, 0, 0, spec.h);
    g.addColorStop(0, spec.bg[0]); g.addColorStop(1, spec.bg[1]);
    ctx.fillStyle = g;
  } else ctx.fillStyle = spec.bg;
  ctx.fillRect(0, 0, spec.w, spec.h);
  spec.draw?.(ctx, spec.w, spec.h);
  for (const l of spec.lines || []) {
    ctx.font = `${l.italic ? 'italic ' : ''}${l.weight ?? 800} ${l.size}px ${l.font ?? '"Helvetica Neue", "Arial Narrow", Arial, sans-serif'}`;
    ctx.fillStyle = l.color ?? '#fff';
    ctx.textAlign = l.align ?? 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${l.spacing ?? 0}px`;
    ctx.fillText(l.text, (l.x ?? 0.5) * spec.w, l.y * spec.h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Self-lit sign material: reads as a printed/painted surface by day (lit by the scene),
 * and glows at night. `always` keeps LED screens bright during the day too.
 */
export function signMaterial(map: THREE.Texture, opts: { night?: number; day?: number; scaleWith?: 'landmark' | 'none'; transparent?: boolean } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 1, transparent: opts.transparent ?? false, alphaTest: opts.transparent ? 0.02 : 0 });
  const uni = { uSignNight: { value: opts.night ?? 2.2 }, uSignDay: { value: opts.day ?? 0.25 }, uGlowScale: opts.scaleWith === 'landmark' ? U.uLandmarkGlow : { value: 1 } };
  return extendMaterial(m, {
    key: 'sign', weather: false, uniforms: uni,
    fPars: 'uniform float uSignNight; uniform float uSignDay; uniform float uGlowScale;',
    fSurface: 'totalEmissiveRadiance *= mix(uSignDay, uSignNight, uNight) * uGlowScale;',
  });
}

/** Emissive material whose strength follows night-time & the landmark glow slider. */
export function beacon(color: THREE.ColorRepresentation, day: number, night: number, landmark = true): THREE.MeshBasicMaterial {
  // lights that are off by day are additive, so they simply vanish instead of rendering black
  const add = day < 0.1;
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: add, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !add });
  return extendMaterial(m, {
    key: 'beacon' + (landmark ? 'L' : ''), noFog: add, uniforms: { uBDay: { value: day }, uBNight: { value: night }, uGlowScale: landmark ? U.uLandmarkGlow : { value: 1 } },
    fPars: 'uniform float uBDay; uniform float uBNight; uniform float uGlowScale;',
    fFinal: 'gl_FragColor.rgb *= mix(uBDay, uBNight, uNight) * uGlowScale;',
  });
}

/** Oriented flat panel (two triangles) facing +Z in local space. */
export function panel(w: number, h: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return m;
}

/** yaw (rotation.y) that makes a mesh's local +Z face the horizontal direction (nx, nz). */
export const yawFacing = (nx: number, nz: number) => Math.atan2(nx, nz);

// ---- hand-modelling helpers (mouldings, profiles, merged prop parts) ---------------------------------

export type V3 = [number, number, number];

/** Triangle with a flat normal; flips the winding so the normal agrees with `want` (if given). */
export function tri3(mb: MeshBuilder, a: V3, b: V3, c: V3, want?: V3) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) return;
  nx /= l; ny /= l; nz /= l;
  let p = a, q = b, r = c;
  if (want && nx * want[0] + ny * want[1] + nz * want[2] < 0) { q = c; r = b; nx = -nx; ny = -ny; nz = -nz; }
  const uv = (P: V3): [number, number] => {
    if (Math.abs(ny) > 0.7) return [P[0], P[2]];
    const tl = Math.hypot(nx, nz) || 1;
    return [P[0] * (nz / tl) - P[2] * (nx / tl), P[1]];
  };
  const [u0, v0] = uv(p), [u1, v1] = uv(q), [u2, v2] = uv(r);
  const i0 = mb.vert(p[0], p[1], p[2], nx, ny, nz, u0, v0);
  const i1 = mb.vert(q[0], q[1], q[2], nx, ny, nz, u1, v1);
  const i2 = mb.vert(r[0], r[1], r[2], nx, ny, nz, u2, v2);
  mb.tri(i0, i1, i2);
}

export function quad3(mb: MeshBuilder, a: V3, b: V3, c: V3, d: V3, want?: V3) {
  if (!want) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    want = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }
  tri3(mb, a, b, c, want); tri3(mb, a, c, d, want);
}

/**
 * Extrude a 2D polygon (flat x,y list, any winding, may be concave) living in the plane spanned by u/v around origin o,
 * along direction w from t0 to t1. Used for mouldings (profile runs), brackets, keystones, voussoirs, pediments.
 */
export function extrude(mb: MeshBuilder, poly: ArrayLike<number>, o: V3, u: V3, v: V3, w: V3, t0: number, t1: number, caps = true) {
  const n = poly.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1]; }
  const sgn = area >= 0 ? 1 : -1;
  const P = (i: number, t: number): V3 => {
    const a = poly[i * 2], b = poly[i * 2 + 1];
    return [o[0] + u[0] * a + v[0] * b + w[0] * t, o[1] + u[1] * a + v[1] * b + w[1] * t, o[2] + u[2] * a + v[2] * b + w[2] * t];
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = poly[j * 2] - poly[i * 2], ey = poly[j * 2 + 1] - poly[i * 2 + 1];
    const out: V3 = [(u[0] * ey - v[0] * ex) * sgn, (u[1] * ey - v[1] * ex) * sgn, (u[2] * ey - v[2] * ex) * sgn];
    quad3(mb, P(i, t0), P(j, t0), P(j, t1), P(i, t1), out);
  }
  if (!caps) return;
  const tris = earcut(Array.from(poly));
  const wn: V3 = t1 >= t0 ? w : [-w[0], -w[1], -w[2]];
  const wb: V3 = [-wn[0], -wn[1], -wn[2]];
  for (let k = 0; k < tris.length; k += 3) {
    tri3(mb, P(tris[k], t1), P(tris[k + 1], t1), P(tris[k + 2], t1), wn);
    tri3(mb, P(tris[k], t0), P(tris[k + 1], t0), P(tris[k + 2], t0), wb);
  }
}

/** Axis-aligned box given by min/max corners (all six faces). */
export function aabb(mb: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bottom = false) {
  quad3(mb, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad3(mb, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  quad3(mb, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  quad3(mb, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  quad3(mb, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  if (bottom) quad3(mb, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
}

/**
 * Buckets of three.js primitive geometries per material, merged into one mesh each.
 * Every added geometry is transformed in place (position, Euler rotation, scale) in the caller's local frame.
 */
export class Parts {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private s = new THREE.Vector3(); private p = new THREE.Vector3();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
    this.e.set(rx, ry, rz, 'YXZ'); this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    geo.applyMatrix4(this.m);
    let list = this.buckets.get(mat);
    if (!list) { list = []; this.buckets.set(mat, list); }
    list.push(geo);
    return geo;
  }
  /** Centered box. */
  box(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(sx, sy, sz), mat, cx, cy, cz, rx, ry, rz);
  }
  /** Cylinder standing on y0. */
  cyl(mat: THREE.Material, x: number, y0: number, z: number, r0: number, r1: number, h: number, segs = 10) {
    return this.add(new THREE.CylinderGeometry(r1, r0, h, segs), mat, x, y0 + h / 2, z);
  }
  /** Rod between two points. */
  rod(mat: THREE.Material, a: V3, b: V3, r: number, segs = 6) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = d.length(); if (L < 1e-4) return;
    const g = new THREE.CylinderGeometry(r, r, L, segs, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    let list = this.buckets.get(mat);
    if (!list) { list = []; this.buckets.set(mat, list); }
    list.push(g);
  }
  build(group: THREE.Object3D, shadows = true) {
    for (const [mat, list] of this.buckets) {
      const norm = list.map((g) => {
        let h = g.index ? g.toNonIndexed() : g;
        if (h !== g) g.dispose();
        for (const k of Object.keys(h.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') h.deleteAttribute(k);
        if (!h.attributes.normal) h.computeVertexNormals();
        if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
        h.morphAttributes = {};
        return h;
      });
      const merged = mergeGeometries(norm, false);
      for (const g of norm) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      const isLight = (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial || mat.transparent;
      mesh.castShadow = shadows && !isLight; mesh.receiveShadow = !isLight;
      group.add(mesh);
    }
    this.buckets.clear();
  }
}

/** Mesh from a MeshBuilder with an arbitrary (non-facade) material. */
export function builderMesh(mb: MeshBuilder, mat: THREE.Material, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(mb.build(), mat);
  m.castShadow = shadows; m.receiveShadow = true;
  return m;
}

/** Repeating canvas texture (metres → texture via geometry uvs). */
export function tileTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Small seeded PRNG for deterministic hand-placed detail. */
export function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
