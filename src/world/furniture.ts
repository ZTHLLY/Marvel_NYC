import * as THREE from 'three';
import { extendMaterial } from '../engine/materials';

/**
 * NYC street furniture geometry. Every piece is one merged BufferGeometry with per-vertex colour and a per-vertex
 * `aRM` = (roughness, metalness, tint, flag): tint 1 multiplies by the instance colour (newspaper boxes, hydrant caps),
 * flag 1 = wire-mesh (cut-out pattern), flag 2 = back-lit panel (emissive at night). One shared material draws them all.
 */

class FB {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; rm: number[] = []; idx: number[] = [];
  put(g: THREE.BufferGeometry, color: number, rough: number, metal: number, tint = 0, flag = 0) {
    const base = this.pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.rm.push(rough, metal, tint, flag);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.rm, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const cyl = (r0: number, r1: number, h: number, seg: number, y = 0, open = false) => new THREE.CylinderGeometry(r1, r0, h, Math.min(seg, 8), 1, open).translate(0, y + h / 2, 0);
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** tube through points (local), radius tapering r0→r1 */
function tube(pts: THREE.Vector3[], r0: number, r1: number, seg = 6, steps = 12) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, steps, 1, seg, false);
  // taper: scale each ring around the curve point
  const p = g.attributes.position, n = g.attributes.normal;
  const ring = seg + 1;
  for (let i = 0; i <= steps; i++) {
    const c = curve.getPointAt(i / steps), r = r0 + (r1 - r0) * (i / steps);
    for (let k = 0; k < ring; k++) {
      const vi = i * ring + k;
      p.setXYZ(vi, c.x + n.getX(vi) * r, c.y + n.getY(vi) * r, c.z + n.getZ(vi) * r);
    }
  }
  g.deleteAttribute('uv');
  return g;
}

const GALV = 0x6c6f70, DARK = 0x1d2220, SIGNAL_Y = 0xc9a019;

/** Cobra-head lamp on a tapered octagonal pole (arm reaches toward local +Z). Head lens: see lampLens(). */
export function cobraLamp() {
  const b = new FB();
  b.put(cyl(0.3, 0.26, 0.85, 8), GALV, 0.55, 0.6);
  b.put(cyl(0.34, 0.34, 0.06, 8), GALV, 0.5, 0.6);
  b.put(cyl(0.14, 0.085, 8.0, 8, 0.85), GALV, 0.45, 0.65);
  const arm = [new THREE.Vector3(0, 8.55, 0), new THREE.Vector3(0, 9.0, 0.5), new THREE.Vector3(0, 9.15, 1.3), new THREE.Vector3(0, 9.12, 2.4)];
  b.put(tube(arm, 0.075, 0.05, 5, 6), GALV, 0.45, 0.65);
  // the cobra head: a flattened teardrop housing
  const head = new THREE.SphereGeometry(1, 8, 5).scale(0.24, 0.13, 0.48).translate(0, 9.08, 2.75);
  b.put(head, 0x7b7e80, 0.4, 0.55);
  return b.build();
}

/** Bishop's crook: fluted cast-iron base, slim pole, crook arm over the kerb and a hanging luminaire. */
export function crookLamp() {
  const b = new FB();
  b.put(cyl(0.24, 0.2, 0.3, 12), DARK, 0.6, 0.4);
  b.put(cyl(0.2, 0.13, 1.2, 12, 0.3), DARK, 0.6, 0.4);
  b.put(cyl(0.16, 0.16, 0.08, 12, 1.5), DARK, 0.6, 0.4);
  b.put(cyl(0.09, 0.065, 6.3, 10, 1.55), DARK, 0.55, 0.45);
  const crook: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 0.95; crook.push(new THREE.Vector3(0, 7.85 + Math.sin(a) * 0.75, 0.75 - Math.cos(a) * 0.75)); }
  b.put(tube(crook, 0.06, 0.045, 5, 9), DARK, 0.55, 0.45);
  // scroll inside the crook
  const scroll: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 1.6; const r = 0.25 * (1 - i / 14); scroll.push(new THREE.Vector3(0, 7.9 + Math.sin(a) * r, 0.3 - Math.cos(a) * r)); }
  b.put(tube(scroll, 0.02, 0.015, 3, 6), DARK, 0.55, 0.45);
  b.put(cyl(0.03, 0.03, 0.35, 6, 7.4).translate(0, 0, 1.47), DARK, 0.5, 0.4);
  b.put(new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.3, 0.2, 0.3).translate(0, 7.15, 1.47), DARK, 0.5, 0.4);
  return b.build();
}

/** emissive lens under each luminaire (local coordinates match the lamp geometry) */
export const cobraLens = () => new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5).scale(0.2, 0.06, 0.4).translate(0, 9.05, 2.75);
export const crookLens = () => new THREE.CylinderGeometry(0.19, 0.12, 0.3, 10).translate(0, 7.0, 1.47);

/**
 * Traffic-signal mast: pole + tapered mast arm over the road (local -X), two hanging 3-lens heads, a pole-mounted
 * head and a pedestrian head. Heads face local +Z (oncoming traffic).
 */
export function signalMast(arm: number) {
  const b = new FB();
  b.put(cyl(0.32, 0.28, 0.5, 8), GALV, 0.55, 0.6);
  b.put(cyl(0.17, 0.12, 6.6, 10, 0.5), GALV, 0.45, 0.65);
  b.put(tube([new THREE.Vector3(0, 6.4, 0), new THREE.Vector3(-arm * 0.5, 6.62, 0), new THREE.Vector3(-arm, 6.75, 0)], 0.1, 0.06, 5, 4), GALV, 0.45, 0.65);
  b.put(tube([new THREE.Vector3(0, 5.6, 0), new THREE.Vector3(-1.2, 6.42, 0)], 0.04, 0.04, 4, 1), GALV, 0.45, 0.65);
  const head = (x: number, y: number, z: number, hang: boolean) => {
    b.put(box(0.36, 1.05, 0.26, x, y, z), SIGNAL_Y, 0.5, 0.15);
        for (let i = 0; i < 3; i++) {
      const ly = y + 0.33 - i * 0.33;
      b.put(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 5, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(x, ly + 0.02, z + 0.22), SIGNAL_Y, 0.5, 0.15);
      b.put(cyl(0.125, 0.125, 0.02, 6).rotateX(Math.PI / 2).translate(x, ly, z + 0.14), 0x080808, 0.3, 0);
    }
    if (hang) b.put(cyl(0.02, 0.02, 0.3, 4, y + 0.52).translate(x, 0, z), 0x222222, 0.6, 0.5);
  };
  head(-arm * 0.55, 5.95, 0.0, true);
  head(-arm * 0.95, 6.02, 0.0, true);
  head(0.0, 3.4, 0.2, false);
  // pedestrian signal, facing back along the sidewalk
  b.put(box(0.36, 0.36, 0.3, 0, 2.75, 0.3), SIGNAL_Y, 0.5, 0.15);
  b.put(box(0.32, 0.32, 0.02, 0, 2.75, 0.46), 0x080808, 0.3, 0);
  return b.build();
}
/** lens positions within signalMast(arm) for a given lamp row: 0 red, 1 amber, 2 green */
export function signalLensPositions(arm: number, row: number): [number, number, number][] {
  const dy = 0.33 - row * 0.33;
  return [[-arm * 0.55, 5.95 + dy, 0.155], [-arm * 0.95, 6.02 + dy, 0.155], [0, 3.4 + dy, 0.355]];
}
export const signalLens = () => new THREE.CircleGeometry(0.115, 10).translate(0, 0, 0.001);
export const pedLens = () => new THREE.PlaneGeometry(0.24, 0.24);
export const PED_LENS_POS: [number, number, number] = [0, 2.75, 0.475];

/** Street-name blade pair (two perpendicular double-sided blades) on a short sleeve; blades get their own material. */
export function bladeGeometry() {
  // 0.95 x 0.2 blade, double-sided, UV across the whole blade; the back face is mirrored so text reads correctly
  const f = new THREE.PlaneGeometry(0.95, 0.2), bk = new THREE.PlaneGeometry(0.95, 0.2).rotateY(Math.PI);
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const [p, off] of [[f, 0.006], [bk, -0.006]] as const) {
    const base = pos.length / 3;
    const pa = p.attributes.position, na = p.attributes.normal, ua = p.attributes.uv;
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i) + off); nrm.push(na.getX(i), na.getY(i), na.getZ(i));
      uv.push(off > 0 ? ua.getX(i) : 1 - ua.getX(i), ua.getY(i));
    }
    for (let i = 0; i < p.index!.count; i++) idx.push(base + p.index!.getX(i));
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aSUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // a thin green edge so the blade has thickness
  const edge = new THREE.BoxGeometry(0.95, 0.2, 0.01);
  for (const k of ['uv']) edge.deleteAttribute(k);
  const e = edge.toNonIndexed();
  const merged = new THREE.BufferGeometry();
  const ep = e.attributes.position, en = e.attributes.normal;
  const P = [...pos], N = [...nrm], UV = [...uv], I = [...idx];
  const b0 = P.length / 3;
  for (let i = 0; i < ep.count; i++) { P.push(ep.getX(i), ep.getY(i), ep.getZ(i)); N.push(en.getX(i), en.getY(i), en.getZ(i)); UV.push(-1, -1); I.push(b0 + i); }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  merged.setAttribute('aSUv', new THREE.Float32BufferAttribute(UV, 2));
  merged.setIndex(I);
  merged.computeBoundingSphere();
  g.dispose(); f.dispose(); bk.dispose(); edge.dispose(); e.dispose();
  return merged;
}

/** short sign pole for corners without a signal mast */
export function signPole() {
  const b = new FB();
  b.put(cyl(0.05, 0.045, 4.3, 8), GALV, 0.45, 0.6);
  b.put(cyl(0.06, 0.06, 0.12, 8, 3.55), GALV, 0.45, 0.6);
  return b.build();
}

export function hydrant() {
  const b = new FB();
  b.put(cyl(0.17, 0.17, 0.06, 12), 0x3a3a3a, 0.6, 0.5);
  b.put(cyl(0.13, 0.12, 0.5, 12, 0.06), 0xb8b8b2, 0.45, 0.5, 1);
  b.put(cyl(0.155, 0.155, 0.05, 12, 0.5), 0xb8b8b2, 0.45, 0.5, 1);
  b.put(new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.55, 0), 0xb0201a, 0.4, 0.3);
  b.put(cyl(0.035, 0.03, 0.08, 5, 0.66), 0xb0201a, 0.4, 0.4);
  for (const s of [1, -1]) b.put(cyl(0.055, 0.055, 0.12, 8).rotateZ(Math.PI / 2).translate(s * 0.17, 0.38, 0), 0xb8b8b2, 0.45, 0.5, 1);
  b.put(cyl(0.075, 0.075, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0.36, 0.16), 0xb0201a, 0.4, 0.4);
  return b.build();
}

/** NYC green wire-mesh litter basket */
export function litterBasket() {
  const b = new FB();
  b.put(cyl(0.25, 0.3, 0.82, 16, 0.03, true), 0x1f4a2a, 0.55, 0.45, 0, 1);
  b.put(new THREE.TorusGeometry(0.3, 0.018, 4, 16).rotateX(Math.PI / 2).translate(0, 0.85, 0), 0x1f4a2a, 0.5, 0.5);
  b.put(new THREE.TorusGeometry(0.25, 0.015, 4, 16).rotateX(Math.PI / 2).translate(0, 0.05, 0), 0x1f4a2a, 0.5, 0.5);
  b.put(cyl(0.24, 0.24, 0.02, 12, 0.03), 0x1a1a1a, 0.8, 0);
  b.put(cyl(0.22, 0.24, 0.3, 10, 0.05), 0x161616, 0.4, 0);     // bag of rubbish inside
  return b.build();
}

export function bollard() {
  const b = new FB();
  b.put(cyl(0.11, 0.11, 0.85, 10), 0x2a2c2e, 0.45, 0.6);
  b.put(new THREE.SphereGeometry(0.11, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.85, 0), 0x2a2c2e, 0.45, 0.6);
  b.put(cyl(0.115, 0.115, 0.05, 10, 0.68), 0xb59a2a, 0.5, 0.2);
  return b.build();
}

/** parking-regulation sign post with two plates (faces ±Z) */
export function parkingSign() {
  const b = new FB();
  b.put(box(0.05, 2.6, 0.05, 0, 1.3, 0), GALV, 0.5, 0.6);
  b.put(box(0.3, 0.45, 0.01, 0, 2.3, 0.035), 0xe8e6de, 0.5, 0);
  b.put(box(0.28, 0.1, 0.012, 0, 2.44, 0.036), 0xa01818, 0.5, 0);
  b.put(box(0.3, 0.3, 0.01, 0, 1.88, 0.035), 0xe8e6de, 0.5, 0);
  b.put(box(0.28, 0.07, 0.012, 0, 1.94, 0.036), 0x1c6a2e, 0.5, 0);
  return b.build();
}

export function mailbox() {
  const b = new FB();
  b.put(box(0.5, 0.95, 0.46, 0, 0.62, 0), 0x163a74, 0.45, 0.3);
  b.put(new THREE.CylinderGeometry(0.25, 0.25, 0.46, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 1.095, 0), 0x163a74, 0.45, 0.3);
  for (const [x, z] of [[0.21, 0.19], [-0.21, 0.19], [0.21, -0.19], [-0.21, -0.19]]) b.put(box(0.05, 0.16, 0.05, x, 0.08, z), 0x14244a, 0.6, 0.4);
  b.put(box(0.36, 0.06, 0.02, 0, 0.98, 0.235), 0x0c1a36, 0.4, 0.5);
  b.put(box(0.2, 0.12, 0.01, 0, 0.75, 0.235), 0xd8d8d8, 0.5, 0);
  return b.build();
}

/** newspaper / free-paper box; the body takes the instance colour */
export function newsBox() {
  const b = new FB();
  b.put(box(0.42, 0.62, 0.4, 0, 0.62, 0), 0xffffff, 0.45, 0.2, 1);
  b.put(box(0.44, 0.04, 0.42, 0, 0.95, 0), 0xffffff, 0.45, 0.2, 1);
  b.put(box(0.32, 0.3, 0.01, 0, 0.7, 0.205), 0x3a4044, 0.08, 0.2);
  b.put(cyl(0.05, 0.04, 0.31, 6), 0x3a3a3a, 0.6, 0.5);
  return b.build();
}

/** CityRacks hoops: three inverted U's along local X */
export function bikeRack() {
  const b = new FB();
  for (const x of [-1, 0, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push(new THREE.Vector3(x * 0.95, 0.55 + Math.sin(a) * 0.32, -Math.cos(a) * 0.32)); }
    pts.unshift(new THREE.Vector3(x * 0.95, 0, -0.32)); pts.push(new THREE.Vector3(x * 0.95, 0, 0.32));
    b.put(tube(pts, 0.025, 0.025, 6, 14), 0x8a8d8f, 0.3, 0.9);
  }
  return b.build();
}

/** bus shelter: steel frame, roof, back-lit advertising panel at one end; opening faces local +Z (the kerb) */
export function busShelter() {
  const b = new FB();
  const L = 4.2, D = 1.45, H = 2.55;
  for (const x of [-L / 2, 0, L / 2]) for (const z of [-D / 2, D / 2 - 0.1]) b.put(box(0.07, H, 0.07, x, H / 2, z), 0x3a3d40, 0.4, 0.7);
  b.put(box(L + 0.3, 0.1, D + 0.25, 0, H + 0.05, 0.05), 0x2e3134, 0.45, 0.6);
  b.put(box(L, 0.04, D, 0, H - 0.03, 0), 0xb8bcc0, 0.4, 0.3);
  // rear glass (dark, reflective) and the ad panel
  b.put(box(L, H - 0.35, 0.02, 0, H / 2 + 0.1, -D / 2), 0x1a2226, 0.05, 0.2);
  b.put(box(0.08, H - 0.4, 1.25, L / 2, H / 2 + 0.05, 0.0), 0x2a2d30, 0.4, 0.6);
  b.put(box(0.02, 1.75, 1.15, L / 2 + 0.05, 1.3, 0.0), 0xd9d2c4, 0.3, 0, 1, 2);
  b.put(box(0.02, 1.75, 1.15, L / 2 - 0.05, 1.3, 0.0), 0xd9d2c4, 0.3, 0, 1, 2);
  b.put(box(L * 0.6, 0.05, 0.36, 0, 0.45, -D / 2 + 0.22), 0x6a6e72, 0.4, 0.7);
  return b.build();
}

const FURN_SURFACE = /* glsl */ `
{
  float tint = vFRM.z, flag = vFRM.w;
  // vertex colour already multiplies the instance colour; undo that where the part must keep its own colour
  if (tint < 0.5) diffuseColor.rgb = vFCol;
  if (flag > 0.5 && flag < 1.5) {
    // diamond wire mesh: holes are cut away
    float a = atan(vFLoc.z, vFLoc.x) * 0.27;
    vec2 q = vec2(a * 12.0 + vFLoc.y * 9.0, a * 12.0 - vFLoc.y * 9.0);
    vec2 f = abs(fract(q) - 0.5);
    if (max(f.x, f.y) < 0.36 && vFLoc.y > 0.08 && vFLoc.y < 0.8) discard;
  }
  roughnessFactor = vFRM.x;
  metalnessFactor = vFRM.y;
  if (flag > 1.5) {
    // back-lit poster: a soft graphic, glowing at night
    vec2 p = vFLoc.yz;
    vec3 art = mix(vec3(0.85, 0.82, 0.76), vec3(0.9, 0.3, 0.2), smoothstep(0.4, 0.42, vnoise(p * 3.0 + vFRM.z)));
    diffuseColor.rgb = art * 0.6;
    totalEmissiveRadiance += art * (0.15 + 2.2 * uNight);
  }
}
`;

/** shared material for all furniture pieces */
export function furnitureMaterial() {
  return extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }), {
    key: 'furn', weather: true,
    vPars: 'attribute vec4 aRM; varying vec4 vFRM; varying vec3 vFLoc; varying vec3 vFCol;',
    vMain: 'vFRM = aRM; vFLoc = position; vFCol = color.rgb;',
    fPars: 'varying vec4 vFRM; varying vec3 vFLoc; varying vec3 vFCol;',
    fSurface: FURN_SURFACE,
  });
}

/** green street-name blades: text from a shared canvas atlas, row chosen per instance */
export class SignAtlas {
  readonly cols = 4; readonly rows = 48;
  private labels = new Map<string, number>();
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 48 * this.rows;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }
  /** index of a label in the atlas (drawn on first use; falls back to a hash once full) */
  index(label: string): number {
    let i = this.labels.get(label);
    if (i !== undefined) return i;
    const cap = this.cols * this.rows;
    if (this.labels.size >= cap) { let h = 0; for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % cap; }
    i = this.labels.size;
    this.labels.set(label, i);
    const ctx = this.canvas.getContext('2d')!;
    const w = 256, h = 48, x = (i % this.cols) * w, y = Math.floor(i / this.cols) * h;
    ctx.fillStyle = '#0f5a32'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#e8efe8'; ctx.lineWidth = 2.5; ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
    ctx.fillStyle = '#f2f5f0';
    ctx.font = '600 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1, w - 20);
    this.texture.needsUpdate = true;
    return i;
  }
  material() {
    return extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.1 }), {
      key: 'blade', weather: true,
      uniforms: { uAtlas: { value: this.texture } },
      vPars: 'attribute vec2 aSUv; attribute float aRow; varying vec2 vSUv; varying float vRow;',
      vMain: 'vSUv = aSUv; vRow = aRow;',
      fPars: `uniform sampler2D uAtlas; varying vec2 vSUv; varying float vRow;`,
      fSurface: `
      {
        if (vSUv.x < -0.5) { diffuseColor.rgb = vec3(0.03, 0.17, 0.08); }
        else {
          float c = mod(vRow, ${this.cols}.0), r = floor(vRow / ${this.cols}.0);
          vec2 uv = vec2((c + vSUv.x) / ${this.cols}.0, 1.0 - (r + 1.0 - vSUv.y) / ${this.rows}.0);
          diffuseColor.rgb = texture2D(uAtlas, uv).rgb;
        }
        roughnessFactor = 0.45;
        // retro-reflective sheeting catches headlights and street lamps at night
        totalEmissiveRadiance += diffuseColor.rgb * 0.25 * uNight;
      }`,
    });
  }
}
