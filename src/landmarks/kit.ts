import * as THREE from 'three';
import { extendMaterial, U } from '../engine/materials';
import { facadeMaterial } from '../city/facade';
import { MeshBuilder } from '../city/meshBuilder';

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
