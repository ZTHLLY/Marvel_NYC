import * as THREE from 'three';
import { extendMaterial, U } from '../engine/materials';
import { mulberry32, rr, pick, Rng, lerp } from '../util/rng';

/** Architectural families (see docs/architecture.md). */
export enum Family {
  GlassOffice, ArtDeco, BrickApartment, Brownstone, ModernResidential, LuxuryCondo,
  Hotel, OfficeComplex, MixedUse, Industrial, Waterfront, OuterGeneric,
}
export const FAMILY_COUNT = 12;
export const VARIANTS = 48;
export const STYLE_ROWS = FAMILY_COUNT * VARIANTS;
/** Extra hand-authored rows appended after the procedural ones (hero buildings). */
export const CUSTOM_ROWS = 24;
const TEX_W = 8;

/** Surface codes packed into the style attribute (code = row + surface * 1024). */
export enum Surf { Wall = 0, Roof = 1, Trim = 2, Metal = 3, Wood = 4, Dark = 5, Glass = 6, Steel = 7, Blank = 8, Awning = 9, Painted = 10 }

export interface StyleInfo { floorH: number; groundH: number; bayW: number; family: Family; roofLight: number }

interface FamDef {
  win: [number, number];        // canonical window width / height fraction
  winVar: [number, number];
  bay: [number, number];
  floor: [number, number];
  walls: [number, number][];    // [hex, wallType]
  glass: number[];
  glassRough: [number, number];
  frames: number[];
  frameW: number;
  ground: [number, number];
  lit: number; warm: number; coh: number;
  pier: number; spandrel: number; sill: number; crown: number;
  storefront: number; feature: number;
}

// wall types: 0 brick, 1 limestone, 2 concrete / painted, 3 metal panel, 4 spandrel glass, 5 brownstone, 6 cast iron
const FAMS: FamDef[] = [
  /* GlassOffice */ { win: [0.94, 0.72], winVar: [0.03, 0.14], bay: [1.25, 1.9], floor: [3.8, 4.25],
    walls: [[0x55687a, 4], [0x5b7068, 4], [0x6a7278, 4], [0x5c4d3a, 4], [0x2b3a4c, 4], [0x3f6068, 4], [0x8a9096, 4], [0x23282e, 4]],
    glass: [0x86a2c0, 0x8caea2, 0xa4b0b8, 0x967c5c, 0x4a6584, 0x6898a0, 0xbcc6cc, 0x56626e], glassRough: [0.05, 0.13],
    frames: [0x2c3036, 0xb4b8bc, 0x17191c, 0x6a6e72], frameW: 0.035, ground: [5.5, 7.5], lit: 0.42, warm: 0.22, coh: 0.75,
    pier: 0, spandrel: 0.3, sill: 0, crown: 0.45, storefront: 0.5, feature: 0 },
  /* ArtDeco */ { win: [0.42, 0.6], winVar: [0.08, 0.08], bay: [2.2, 3.2], floor: [3.5, 3.9],
    walls: [[0xcbbfa6, 1], [0xd9cfba, 1], [0xb9a88a, 1], [0xa8876a, 0], [0x9a7a62, 0], [0xbdb3a0, 1], [0x8e6f58, 0], [0xc9b79a, 0]],
    glass: [0x3a4550, 0x44505a, 0x2e3840], glassRough: [0.12, 0.2],
    frames: [0x2a2a28, 0x3a3a34, 0x4a4438], frameW: 0.07, ground: [5.5, 7], lit: 0.3, warm: 0.6, coh: 0.35,
    pier: 0.55, spandrel: 0.5, sill: 0.3, crown: 0.95, storefront: 0.8, feature: 0 },
  /* BrickApartment */ { win: [0.4, 0.52], winVar: [0.07, 0.07], bay: [2.6, 3.6], floor: [2.95, 3.25],
    walls: [[0x8e4a38, 0], [0x7a3d2f, 0], [0xa5674a, 0], [0xb89572, 0], [0x6b4a3c, 0], [0xc7b79c, 0], [0x93928c, 0], [0xd9d2c4, 0], [0x9c5a40, 0], [0x84503c, 0]],
    glass: [0x2f3840, 0x38424a, 0x283038], glassRough: [0.14, 0.24],
    frames: [0xe6e2d8, 0x25282b, 0x5a2e22, 0xcfc8b8], frameW: 0.08, ground: [3.8, 4.6], lit: 0.46, warm: 0.82, coh: 0.04,
    pier: 0, spandrel: 0, sill: 0.9, crown: 0, storefront: 0.55, feature: 0 },
  /* Brownstone */ { win: [0.34, 0.62], winVar: [0.04, 0.05], bay: [1.9, 2.5], floor: [3.3, 3.7],
    walls: [[0x6e4a3a, 5], [0x5c4033, 5], [0x7d5a48, 5], [0x8a4b3a, 0], [0x9c8a78, 1], [0x4a3a34, 5], [0x7a3f30, 0], [0xb8a48c, 1]],
    glass: [0x2c343a, 0x343c42], glassRough: [0.14, 0.22],
    frames: [0x1e1e1c, 0xe0dccf, 0x33261e], frameW: 0.1, ground: [3.2, 3.8], lit: 0.5, warm: 0.92, coh: 0.02,
    pier: 0, spandrel: 0, sill: 1, crown: 0, storefront: 0.08, feature: 0 },
  /* ModernResidential */ { win: [0.84, 0.74], winVar: [0.1, 0.1], bay: [2.8, 4.0], floor: [2.95, 3.2],
    walls: [[0xdcdcd8, 2], [0xb9bcc0, 2], [0x8f9498, 2], [0xc9b9a4, 2], [0x4a4e54, 3], [0xa24f3a, 0], [0xe6e2da, 2]],
    glass: [0x6f8aa5, 0x7c9a9a, 0x556b80, 0x8fa0ae], glassRough: [0.07, 0.14],
    frames: [0x25282c, 0x8a8e92, 0x15171a], frameW: 0.04, ground: [4.5, 5.6], lit: 0.5, warm: 0.76, coh: 0.04,
    pier: 0.1, spandrel: 0.1, sill: 0, crown: 0.2, storefront: 0.5, feature: 1 },
  /* LuxuryCondo */ { win: [0.88, 0.84], winVar: [0.08, 0.08], bay: [2.2, 4.4], floor: [3.5, 4.4],
    walls: [[0x2a2c30, 3], [0x4a3d30, 3], [0xcfcac0, 2], [0x1c1e22, 3], [0x8c8478, 1], [0x5a5e64, 3]],
    glass: [0x4a6078, 0x6a8296, 0x38444e, 0x7a8f9a, 0x5a5044], glassRough: [0.04, 0.1],
    frames: [0x1a1b1e, 0x4c4034, 0x74787c], frameW: 0.04, ground: [5.5, 7.5], lit: 0.32, warm: 0.86, coh: 0.03,
    pier: 0.2, spandrel: 0.15, sill: 0, crown: 0.5, storefront: 0.3, feature: 0 },
  /* Hotel */ { win: [0.5, 0.6], winVar: [0.08, 0.06], bay: [3.0, 3.8], floor: [2.9, 3.2],
    walls: [[0xd2c6b0, 1], [0xa56a4f, 0], [0xbfb8ac, 2], [0x80868c, 2], [0xc4ad8c, 1], [0x8a5642, 0]],
    glass: [0x3a444e, 0x4a5660, 0x54483c], glassRough: [0.1, 0.18],
    frames: [0x2a2a2a, 0x8a7a5a, 0xd8d4c8], frameW: 0.07, ground: [5, 6.5], lit: 0.62, warm: 0.88, coh: 0.03,
    pier: 0.25, spandrel: 0.2, sill: 0.5, crown: 0.75, storefront: 0.7, feature: 0 },
  /* OfficeComplex */ { win: [0.97, 0.5], winVar: [0.02, 0.16], bay: [1.4, 1.8], floor: [3.6, 3.9],
    walls: [[0xe2e0d8, 2], [0xcfd2d4, 3], [0x3b3c3e, 3], [0x9aa0a0, 3], [0xb7a58c, 1], [0x5a4a3a, 3], [0xc8c4b8, 2]],
    glass: [0x4f6470, 0x6d8088, 0x7b6a52, 0x39424a, 0x5a7078], glassRough: [0.07, 0.15],
    frames: [0x2a2c2e, 0x9a9ea2, 0x4a3c2c], frameW: 0.05, ground: [5, 7], lit: 0.48, warm: 0.18, coh: 0.88,
    pier: 0.15, spandrel: 0.2, sill: 0, crown: 0.25, storefront: 0.4, feature: 3 },
  /* MixedUse */ { win: [0.74, 0.74], winVar: [0.06, 0.06], bay: [1.7, 2.4], floor: [3.7, 4.3],
    walls: [[0xd8d2c2, 6], [0xb9b4a8, 6], [0x8a8f94, 6], [0x4c4f55, 6], [0xa24a3a, 0], [0xc9b28e, 1], [0x7a4a3a, 0], [0xe4dfd2, 6]],
    glass: [0x38424a, 0x424c54, 0x2e363c], glassRough: [0.12, 0.2],
    frames: [0x26282a, 0xe2ddd0, 0x3c2c24], frameW: 0.09, ground: [4.6, 5.6], lit: 0.4, warm: 0.7, coh: 0.25,
    pier: 0.35, spandrel: 0.25, sill: 0.6, crown: 0.1, storefront: 1, feature: 0 },
  /* Industrial */ { win: [0.78, 0.62], winVar: [0.08, 0.1], bay: [3.8, 5.2], floor: [4.0, 4.8],
    walls: [[0x7d4534, 0], [0x8c5a44, 0], [0x6a655f, 2], [0x9a8f80, 2], [0x5e4034, 0], [0x85807a, 2]],
    glass: [0x4a565c, 0x55626a, 0x3a4448], glassRough: [0.18, 0.3],
    frames: [0x2a2c2c, 0x4a3a30, 0x5a5e60], frameW: 0.05, ground: [4.5, 5.5], lit: 0.2, warm: 0.45, coh: 0.5,
    pier: 0.3, spandrel: 0, sill: 0.4, crown: 0, storefront: 0.25, feature: 2 },
  /* Waterfront */ { win: [0.5, 0.34], winVar: [0.2, 0.2], bay: [4.5, 7], floor: [4.2, 5.5],
    walls: [[0x5e7a86, 3], [0x8b8f92, 3], [0xb5b0a4, 2], [0x7a5a48, 3], [0x6f8a80, 3], [0x9a4a3a, 0]],
    glass: [0x55666e, 0x6a8088], glassRough: [0.12, 0.22],
    frames: [0x2c3034, 0xd0d0cc], frameW: 0.05, ground: [5, 6], lit: 0.18, warm: 0.4, coh: 0.4,
    pier: 0, spandrel: 0, sill: 0, crown: 0, storefront: 0.2, feature: 2 },
  /* OuterGeneric */ { win: [0.42, 0.5], winVar: [0.1, 0.08], bay: [2.8, 3.6], floor: [3.0, 3.3],
    walls: [[0x8a5a48, 0], [0xa08878, 0], [0xb8b0a2, 2], [0x77706a, 2], [0x9c6a52, 0], [0xc4bcae, 2], [0x6f5446, 0], [0x8f8a84, 2]],
    glass: [0x303a42, 0x3a444c], glassRough: [0.14, 0.24],
    frames: [0xd8d4c8, 0x2a2c2e], frameW: 0.08, ground: [3.8, 4.5], lit: 0.4, warm: 0.8, coh: 0.05,
    pier: 0, spandrel: 0, sill: 0.6, crown: 0, storefront: 0.3, feature: 0 },
];

const ROOFS = [0x2a2a2c, 0x38393b, 0x4a4b4e, 0x77787a, 0xa3a39e, 0x8b8f8a, 0x5a5048, 0x6a6c6e, 0xb8b6ae, 0x3a3432];
const ACCENTS = [0xb03a2e, 0x2e6a4a, 0x1f4f8a, 0xd8a038, 0x26282c, 0x7a2a4a, 0xd8d2c0, 0x2a7a8a, 0xc85a28, 0x4a3a7a];

export class StylePalette {
  readonly data: Float32Array;
  readonly texture: THREE.DataTexture;
  readonly info: StyleInfo[] = [];
  private custom = 0;

  constructor() {
    const rows = STYLE_ROWS + CUSTOM_ROWS;
    this.data = new Float32Array(TEX_W * rows * 4);
    this.texture = new THREE.DataTexture(this.data, TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
  }

  private put(row: number, k: number, a: number, b: number, c: number, d: number) {
    const o = (row * TEX_W + k) * 4;
    this.data[o] = a; this.data[o + 1] = b; this.data[o + 2] = c; this.data[o + 3] = d;
  }
  private putColor(row: number, k: number, col: THREE.Color, w: number) { this.put(row, k, col.r, col.g, col.b, w); }

  /** Regenerate all procedural style rows. `variation` 0..1 widens the range of each family. */
  generate(seed: number, variation: number) {
    const col = new THREE.Color(), col2 = new THREE.Color();
    for (let f = 0; f < FAMILY_COUNT; f++) {
      const F = FAMS[f];
      for (let v = 0; v < VARIANTS; v++) {
        const row = f * VARIANTS + v;
        const r: Rng = mulberry32(seed * 7919 + f * 131 + v * 17 + 5);
        const vv = v === 0 ? 0 : variation; // variant 0 is the canonical look
        const jitter = (base: number, amp: number) => base + (r() * 2 - 1) * amp * vv;
        const winW = Math.min(0.98, Math.max(0.22, jitter(F.win[0], F.winVar[0])));
        const winH = Math.min(0.92, Math.max(0.24, jitter(F.win[1], F.winVar[1])));
        const bayW = lerp((F.bay[0] + F.bay[1]) / 2, rr(r, F.bay[0], F.bay[1]), vv);
        const floorH = lerp((F.floor[0] + F.floor[1]) / 2, rr(r, F.floor[0], F.floor[1]), vv);
        const nW = Math.max(1, Math.round(1 + (F.walls.length - 1) * vv));
        const wi = v === 0 ? 0 : Math.floor(r() * nW) % F.walls.length;
        const [wHex, wType] = F.walls[wi];
        col.setHex(wHex);
        // subtle per-variant tone shift so two buildings of the same material rarely match exactly
        const tone = 1 + (r() * 2 - 1) * 0.12 * vv;
        col.multiplyScalar(tone);
        if (wType !== 4) { const hsl = { h: 0, s: 0, l: 0 }; col.getHSL(hsl); col.setHSL(hsl.h, hsl.s * 0.62, hsl.l * 0.94); }
        this.put(row, 0, winW, winH, bayW, floorH);
        this.putColor(row, 1, col, wType);
        // glass: curtain walls take the glass matching their spandrel index
        const gi = wType === 4 ? wi % F.glass.length : Math.floor(r() * F.glass.length);
        col2.setHex(F.glass[v === 0 ? 0 : gi]);
        this.putColor(row, 2, col2, rr(r, F.glassRough[0], F.glassRough[1]));
        col2.setHex(v === 0 ? F.frames[0] : pick(r, F.frames));
        this.putColor(row, 3, col2, F.frameW);
        const groundH = rr(r, F.ground[0], F.ground[1]);
        this.put(row, 4, groundH, Math.max(0.05, F.lit + (r() - 0.5) * 0.3 * vv), Math.min(1, Math.max(0, F.warm + (r() - 0.5) * 0.4)), F.coh);
        this.put(row, 5, F.pier * (0.6 + 0.8 * r()), F.spandrel * (0.5 + r()), F.sill, F.crown * (r() < 0.55 ? 1 : 0.15));
        col2.setHex(pick(r, ROOFS));
        this.putColor(row, 6, col2, F.storefront);
        col2.setHex(pick(r, ACCENTS));
        this.putColor(row, 7, col2, F.feature);
        this.info[row] = { floorH, groundH, bayW, family: f as Family, roofLight: 0 };
      }
    }
    this.texture.needsUpdate = true;
  }

  /** Register a hand-authored style (hero buildings). Returns its row index. */
  addCustom(s: {
    win: [number, number]; bay: number; floor: number; wall: number; wallType: number; glass: number; glassRough: number;
    frame: number; frameW: number; ground: number; lit: number; warm: number; coh: number; pier: number; spandrel: number;
    sill: number; crown: number; roof: number; storefront: number; accent: number; feature: number;
  }): number {
    const row = STYLE_ROWS + this.custom++;
    if (this.custom > CUSTOM_ROWS) throw new Error('too many custom styles');
    const c = new THREE.Color();
    this.put(row, 0, s.win[0], s.win[1], s.bay, s.floor);
    this.putColor(row, 1, c.setHex(s.wall), s.wallType);
    this.putColor(row, 2, c.setHex(s.glass), s.glassRough);
    this.putColor(row, 3, c.setHex(s.frame), s.frameW);
    this.put(row, 4, s.ground, s.lit, s.warm, s.coh);
    this.put(row, 5, s.pier, s.spandrel, s.sill, s.crown);
    this.putColor(row, 6, c.setHex(s.roof), s.storefront);
    this.putColor(row, 7, c.setHex(s.accent), s.feature);
    this.info[row] = { floorH: s.floor, groundH: s.ground, bayW: s.bay, family: Family.GlassOffice, roofLight: 0 };
    this.texture.needsUpdate = true;
    return row;
  }
}

const V_PARS = /* glsl */ `
uniform sampler2D uPalette;
#ifdef FORGE_INSTANCED
attribute vec3 aInst;
#else
attribute vec3 aStyle;
#endif
flat varying vec4 vS0; flat varying vec4 vS1; flat varying vec4 vS2; flat varying vec4 vS3;
flat varying vec4 vS4; flat varying vec4 vS5; flat varying vec4 vS6; flat varying vec4 vS7;
flat varying vec3 vInfo;
varying vec2 vFUv;
`;

const V_MAIN = /* glsl */ `
{
  #ifdef FORGE_INSTANCED
    vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    float isRoof = step(0.5, normal.y);
    float along = abs(normal.x) > 0.5 ? position.z * sc.z : position.x * sc.x;
    vFUv = mix(vec2(along + aInst.y * 40.0 + (normal.x + normal.z) * 7.0, position.y * sc.y), position.xz * sc.xz, isRoof);
    float code = aInst.x; float surf = isRoof; float seedv = aInst.y; float topY = sc.y;
  #else
    float surf = floor(aStyle.x / 1024.0 + 0.001);
    float code = aStyle.x - surf * 1024.0; float seedv = aStyle.y; float topY = aStyle.z;
    vFUv = uv;
  #endif
  int row = int(code + 0.5);
  vS0 = texelFetch(uPalette, ivec2(0, row), 0); vS1 = texelFetch(uPalette, ivec2(1, row), 0);
  vS2 = texelFetch(uPalette, ivec2(2, row), 0); vS3 = texelFetch(uPalette, ivec2(3, row), 0);
  vS4 = texelFetch(uPalette, ivec2(4, row), 0); vS5 = texelFetch(uPalette, ivec2(5, row), 0);
  vS6 = texelFetch(uPalette, ivec2(6, row), 0); vS7 = texelFetch(uPalette, ivec2(7, row), 0);
  vInfo = vec3(surf, seedv, topY);
}
`;

const F_PARS = /* glsl */ `
uniform float uWindowLight; uniform float uDetail; uniform float uStreetGlow;
uniform sampler2D uSignAtlas;
flat varying vec4 vS0; flat varying vec4 vS1; flat varying vec4 vS2; flat varying vec4 vS3;
flat varying vec4 vS4; flat varying vec4 vS5; flat varying vec4 vS6; flat varying vec4 vS7;
flat varying vec3 vInfo;
varying vec2 vFUv;
float rectMask(vec2 f, vec2 a, vec2 b, vec2 fw){
  fw = max(fw, vec2(1e-4));
  vec2 lo = smoothstep(a - fw, a + fw, f); vec2 hi = 1.0 - smoothstep(b - fw, b + fw, f);
  return lo.x * lo.y * hi.x * hi.y;
}
// distance (m) to the nearest edge of a running-bond cell, plus the cell id
vec3 bondCell(vec2 uv, vec2 size, out vec2 cid){
  vec2 b = uv / size; b.x += 0.5 * mod(floor(b.y), 2.0);
  cid = floor(b); vec2 bf = fract(b);
  vec2 d = min(bf, 1.0 - bf) * size;
  return vec3(d, 0.0);
}
// screen-space bump mapping from a procedural height field given in metres (Mikkelsen)
vec3 forgeBump(vec3 N, float h){
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, N), r2 = cross(N, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  vec3 o = abs(det) * N - g;
  float l = length(o);
  return l > 1e-9 ? o / l : N;
}
`;

const F_SURFACE = /* glsl */ `
{
  float surf = vInfo.x; float seed = vInfo.y; float topY = vInfo.z;
  vec3 wN = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 toCam = cameraPosition - vFogWorld;
  vec3 V = normalize(toCam);
  vec2 uvm = vFUv;
  vec3 albedo = vS1.rgb; float rough = 0.86; float metal = 0.0; vec3 emis = vec3(0.0);
  float hgt = 0.0;                                        // procedural relief (m), bump-mapped after the branches
  float pix = max(fwidth(uvm.x), fwidth(uvm.y));         // metres per pixel on this surface
  float fine = 1.0 - smoothstep(0.008, 0.04, pix);        // brick-scale detail visibility (fades before it can moiré)
  float mid = 1.0 - smoothstep(0.03, 0.25, pix);          // block / panel scale
  float n1 = vnoise(uvm * 0.31 + seed * 97.0);
  float n2 = vnoise(vec2(uvm.x * 2.3, uvm.y * 0.23) + seed * 31.0);
  float bSeed = h21(vec2(seed * 61.7, 4.3));              // per-building randoms
  float bSeed2 = h21(vec2(seed * 17.3, 9.1));
  if (surf < 0.5 || (surf > 7.5 && surf < 8.5)) {
    // ================= FACADE =================
    float bayW = vS0.z, floorH = vS0.w, groundH = vS4.x;
    float wallType = vS1.a;
    float curtain = step(3.5, wallType) * step(wallType, 4.5);
    vec3 wallCol = vS1.rgb * (0.86 + 0.18 * n1) * (0.94 + 0.1 * n2);
    float wallRough = 0.88;
    float weatherK = 1.0;
    if (wallType < 0.5) {            // ---- brick, running bond
      vec2 cid; vec3 d = bondCell(uvm, vec2(0.215, 0.073), cid);
      float mortar = 1.0 - smoothstep(0.0035, 0.0035 + max(pix, 0.003), min(d.x, d.y));
      float bv = h21(cid + seed * 13.0), bv2 = h21(cid * 1.7 + 3.3 + seed);
      // brick-to-brick tone fades out before single bricks shrink to a few pixels (otherwise it reads as noise)
      float fineB = 1.0 - smoothstep(0.005, 0.02, pix);
      vec3 brick = wallCol * mix(1.0, 0.76 + 0.46 * bv, fineB);
      brick = mix(brick, brick * vec3(0.6, 0.58, 0.64), step(0.9, bv2) * fineB);   // burnt headers
      brick = mix(brick, brick * vec3(1.2, 1.12, 1.0), step(bv2, 0.07) * fineB);   // pale replacements
      brick *= 0.92 + 0.16 * vnoise(uvm * 41.0);
      vec3 mortarCol = mix(vec3(0.46, 0.44, 0.4), vS1.rgb * 0.5, 0.3 + 0.5 * bSeed) * (0.85 + 0.3 * n1);
      wallCol = mix(wallCol, mix(brick, mortarCol, mortar), fine);
      hgt += (0.003 * bv - 0.007 * mortar) * fine;
      wallRough = 0.92 - 0.14 * bv * fine;
    } else if (wallType < 1.5) {     // ---- limestone ashlar
      vec2 cid; vec3 d = bondCell(uvm, vec2(1.22, 0.61), cid);
      float joint = 1.0 - smoothstep(0.005, 0.005 + max(pix, 0.006), min(d.x, d.y));
      float bv = h21(cid + seed);
      wallCol *= mix(1.0, 0.9 + 0.2 * bv, mid);
      wallCol *= 1.0 - 0.1 * fine * vnoise(vec2(uvm.x * 3.0, uvm.y * 23.0) + bv * 9.0);       // bedding veins
      wallCol = mix(wallCol, wallCol * 0.5, joint * mid);
      hgt += -0.012 * joint * mid;
      wallRough = 0.76;
    } else if (wallType < 2.5) {     // ---- concrete / painted stucco
      wallCol *= 0.93 + 0.1 * vnoise(uvm * 4.0) + 0.05 * fine * vnoise(uvm * 37.0);
      float pour = 1.0 - smoothstep(0.0, 0.012 + pix, abs(fract((uvm.y - groundH) / floorH + 0.5) - 0.5) * floorH);
      wallCol *= 1.0 - 0.2 * pour * mid;
      hgt += -0.006 * pour * mid + 0.002 * fine * vnoise(uvm * 23.0);
      wallRough = 0.84;
      weatherK = 1.25;
    } else if (wallType < 3.5) {     // ---- metal panel
      vec2 ps = vec2(1.5, floorH); vec2 b = uvm / ps; vec2 cid = floor(b); vec2 d = min(fract(b), 1.0 - fract(b)) * ps;
      float joint = 1.0 - smoothstep(0.006, 0.006 + max(pix, 0.006), min(d.x, d.y));
      float pv = h21(cid + seed * 3.0);
      wallCol *= mix(1.0, 0.93 + 0.14 * pv, mid);
      wallCol = mix(wallCol, wallCol * 0.4, joint * mid);
      hgt += -0.01 * joint * mid;
      wallRough = 0.36 + 0.14 * pv; metal = 0.78;
      weatherK = 0.3;
    } else if (wallType < 4.5) {     // ---- spandrel glass
      wallRough = 0.16; metal = 0.85; weatherK = 0.0;
    } else if (wallType < 5.5) {     // ---- brownstone
      float course = 1.0 - smoothstep(0.0, 0.006 + pix, abs(fract(uvm.y / 0.42) - 0.5) * 0.42);
      wallCol *= 0.9 + 0.16 * vnoise(uvm * 6.0);
      float spall = smoothstep(0.62, 0.75, vnoise(uvm * 1.3 + seed * 5.0));
      wallCol = mix(wallCol, wallCol * vec3(0.82, 0.8, 0.8), spall * 0.6);
      wallCol *= 1.0 - 0.25 * course * mid;
      hgt += (0.004 * vnoise(uvm * 17.0) - 0.006 * spall) * fine - 0.008 * course * mid;
      wallRough = 0.93;
    } else {                         // ---- painted cast iron
      wallCol *= 0.96 + 0.06 * vnoise(uvm * 9.0);
      wallRough = 0.55; weatherK = 0.6;
    }
    // ---- weathering: rain wash under the coping, soot streaks, street grime
    float streak = vnoise(vec2(uvm.x * 1.9 + seed * 7.0, uvm.y * 0.07));
    float streakF = vnoise(vec2(uvm.x * 8.0, uvm.y * 0.3 + seed * 3.0));
    float wash = exp(-max(topY - uvm.y, 0.0) / 6.0);
    float dirt = weatherK * (0.6 * wash * smoothstep(0.25, 0.8, streak) + 0.2 * smoothstep(0.45, 0.9, streak * streakF * 1.9));
    wallCol *= 1.0 - 0.42 * dirt;
    wallCol *= mix(0.72, 1.0, smoothstep(0.0, 22.0, uvm.y));            // street grime & canyon occlusion
    wallRough = mix(wallRough, 0.95, dirt * 0.6);
    albedo = wallCol; rough = wallRough;
    float wallMetal = metal;

    float aboveG = uvm.y - groundH;
    float isParapet = step(topY - 0.02, uvm.y);
    if (surf > 7.5) isParapet = 1.0;
    float lit = 0.0; vec3 litCol = vec3(0.0); float win = 0.0;
    vec2 id; vec2 f; vec2 fw; vec2 a; vec2 b2; float winW; float winH; float isGround = 0.0; float shop = 0.0;
    // screen-space derivatives are taken up front: they are undefined inside divergent branches
    float gbay = bayW * max(1.0, floor(4.6 / bayW + 0.5));
    vec2 fwUp = max(fwidth(vec2(uvm.x / bayW, aboveG / floorH)), vec2(1e-5)) * 0.75;
    vec2 fwGd = max(fwidth(vec2(uvm.x / gbay, uvm.y / groundH)), vec2(1e-5)) * 0.75;
    float cellW = bayW, cellH = floorH;
    if (aboveG >= 0.0) {
      vec2 cell = vec2(uvm.x / bayW, aboveG / floorH);
      id = floor(cell); f = fract(cell); fw = fwUp;
      winW = vS0.x; winH = vS0.y;
      a = vec2(0.5 - winW * 0.5, (1.0 - winH) * 0.42); b2 = a + vec2(winW, winH);
    } else {
      // storefront / lobby level: wide bays
      vec2 cell = vec2(uvm.x / gbay, uvm.y / groundH);
      id = floor(cell) + vec2(0.0, -7.0); f = fract(cell); fw = fwGd;
      cellW = gbay; cellH = groundH;
      shop = step(h21(vec2(id.x * 0.37, seed * 5.0)), max(vS6.a, curtain));
      winW = mix(vS0.x * 0.6, 0.9, shop); winH = mix(0.5, 0.7, shop);
      a = vec2(0.5 - winW * 0.5, mix(0.3, 0.45 / groundH, shop)); b2 = a + vec2(winW, winH);
      isGround = 1.0;
    }
    float lodc = clamp(max(fw.x, fw.y) * 1.33, 0.0, 1.0);
    float nearK = 1.0 - smoothstep(0.08, 0.3, lodc);
    if (isGround > 0.5) {
      // fascia sign above the shop window: a lettered band, lit after dark
      float sw = 0.62 + 0.28 * h21(id + 2.3);
      float sh0 = b2.y + 0.035, sh1 = min(sh0 + 0.62 / groundH, 0.97);
      float hasSign = shop * step(0.22, h21(id + 6.1));
      float band = rectMask(f, vec2(0.5 - sw * 0.5, sh0), vec2(0.5 + sw * 0.5, sh1), fw) * hasSign;
      vec2 sUv = vec2((f.x - 0.5) / sw, (f.y - sh0) / max(sh1 - sh0, 1e-3));
      float sAsp = (sw * gbay) / max((sh1 - sh0) * groundH, 0.05);
      sUv.x = 0.5 - sUv.x * sAsp / 4.3;                 // wall u runs right-to-left seen from the street
      float cellN = floor(h21(id * 1.31 + seed * 23.0) * 32.0);
      vec2 aUv = (vec2(mod(cellN, 4.0), floor(cellN / 4.0)) + clamp(vec2(sUv.x, sUv.y), 0.02, 0.98)) / vec2(4.0, 8.0);
      float ink = texture2D(uSignAtlas, aUv).r * step(0.02, sUv.x) * step(sUv.x, 0.98);
      float sStyle = h21(id + 8.8 + seed);
      vec3 hue = mix(vS7.rgb, vec3(h21(id + 1.7), h21(id + 4.1), h21(id + 9.3)), 0.45);
      vec3 bg = sStyle < 0.4 ? vec3(0.035, 0.036, 0.04) : (sStyle < 0.75 ? hue * 0.4 + 0.02 : vec3(0.74, 0.72, 0.66));
      vec3 fg = sStyle < 0.4 ? mix(vec3(0.85, 0.8, 0.68), hue + 0.25, step(0.2, sStyle)) : (sStyle < 0.75 ? vec3(0.88, 0.86, 0.8) : hue * 0.3);
      vec3 signCol = mix(bg, fg, ink);
      albedo = mix(albedo, signCol, band);
      rough = mix(rough, 0.45, band);
      hgt += 0.04 * band;
      float signOn = step(0.35, h21(id + seed * 3.0));
      emis += (sStyle < 0.4 ? fg * ink * 2.2 : signCol * 0.9) * band * uNight * signOn;
      // polished stone bulkhead under the glass, and a plinth course along the whole street wall
      float kick = step(f.y, a.y) * shop * step(a.x - 0.02, f.x) * step(f.x, b2.x + 0.02);
      albedo = mix(albedo, mix(vec3(0.045, 0.045, 0.05), vS3.rgb * 0.6, 0.35), kick);
      rough = mix(rough, 0.28, kick);
    }
    float plinth = (1.0 - smoothstep(0.75, 0.78 + pix, uvm.y)) * (1.0 - curtain);
    albedo = mix(albedo, albedo * 0.62, plinth * (1.0 - isParapet));
    hgt += 0.03 * plinth;
    // recessed glazing: the glass sits behind the wall plane, so the reveals show with parallax
    vec3 T = normalize(cross(wN, vec3(0.0, 1.0, 0.0)));
    vec3 vt = vec3(dot(V, T), V.y, max(dot(V, wN), 0.06));
    float recess = mix(0.26, 0.07, curtain) * nearK * (isGround > 0.5 ? 1.6 : 1.0);
    vec2 fG = f - vt.xy / vt.z * recess / vec2(cellW, cellH);
    // minification: fade each axis to its own coverage so floor bands survive long after bays blur
    vec2 fwS = max(fw, vec2(1e-4));
    vec2 lo2 = smoothstep(a - fwS, a + fwS, f); vec2 hi2 = 1.0 - smoothstep(b2 - fwS, b2 + fwS, f);
    vec2 axis = lo2 * hi2;
    vec2 fade = smoothstep(vec2(0.28), vec2(0.8), fw * 1.33);
    axis = mix(axis, vec2(winW, winH), fade);
    float open = axis.x * axis.y * (1.0 - isParapet);
    float glassM = mix(rectMask(fG, a, b2, fw), 1.0, 1.0 - nearK);
    win = open * glassM;
    float reveal = open * (1.0 - glassM);
    // reveals: lit sill, shaded jambs and soffit
    float sillSide = step(fG.y, a.y);
    albedo = mix(albedo, wallCol * mix(0.42, 1.12, sillSide), reveal);
    hgt -= 0.05 * open * nearK;

    // --- masonry articulation (piers, spandrels, lintels, sills, cornice frieze)
    float inX = step(a.x, f.x) * step(f.x, b2.x);
    float inXs = smoothstep(a.x - fwS.x, a.x + fwS.x, f.x) * (1.0 - smoothstep(b2.x - fwS.x, b2.x + fwS.x, f.x));
    float notWin = (1.0 - win) * (1.0 - isParapet) * (1.0 - isGround);
    albedo *= 1.0 + vS5.x * 0.14 * (1.0 - inX) * notWin;                            // piers catch light
    hgt += vS5.x * 0.14 * (1.0 - inXs) * (1.0 - isGround) * (1.0 - isParapet) * nearK;
    albedo = mix(albedo, albedo * 0.62 + vS3.rgb * 0.12, vS5.y * inX * notWin);     // spandrel panels
    float masonry = step(wallType, 1.5) + step(4.5, wallType) * step(wallType, 5.5);
    float trimSel = masonry * (1.0 - isGround) * nearK * step(bSeed, 0.72);
    vec3 trimCol = mix(vec3(0.6, 0.57, 0.5) * (0.85 + 0.25 * n1), vS1.rgb * 0.62, step(0.42, bSeed));
    float lintelH = 0.24 / floorH;
    float lintel = rectMask(f, vec2(a.x - 0.035, b2.y), vec2(b2.x + 0.035, b2.y + lintelH), fw) * trimSel * (1.0 - open);
    albedo = mix(albedo, trimCol * (1.0 - 0.3 * dirt), lintel);
    hgt += 0.025 * lintel;
    float sill = rectMask(f, vec2(a.x - 0.04, a.y - 0.07), vec2(b2.x + 0.04, a.y), fw) * vS5.z * nearK * (1.0 - isGround);
    albedo = mix(albedo, mix(albedo * 1.25 + 0.08, trimCol * 1.1, trimSel), sill * (1.0 - win));
    hgt += 0.05 * sill * (1.0 - win);
    // drip stains under sills
    float drip = rectMask(f, vec2(a.x - 0.02, a.y - 0.07 - 0.9 / floorH), vec2(b2.x + 0.02, a.y - 0.07), fw * 2.0) * vS5.z * nearK * (1.0 - isGround);
    albedo *= 1.0 - 0.16 * drip * weatherK * smoothstep(0.3, 0.7, streakF);
    albedo = mix(albedo, vec3(0.88, 0.91, 0.96), sill * (1.0 - win) * smoothstep(0.1, 0.5, uSnow));   // snow on sills
    // cornice frieze with dentils below the parapet (masonry) — reads at every distance as a light band
    float frz = masonry * step(12.0, topY) * (1.0 - smoothstep(0.03, 0.4, pix));
    float frieze = smoothstep(topY - 0.62, topY - 0.58, uvm.y) * (1.0 - smoothstep(topY + 0.3, topY + 0.34, uvm.y)) * frz;
    float dentil = smoothstep(topY - 0.95, topY - 0.92, uvm.y) * (1.0 - step(topY - 0.62, uvm.y)) * step(0.5, fract(uvm.x / 0.42)) * frz * fine;
    albedo = mix(albedo, mix(trimCol * 1.08, wallCol * 1.16, step(0.72, bSeed)) * (1.0 - 0.35 * dirt), max(frieze, dentil) * (1.0 - win));
    hgt += 0.07 * frieze + 0.05 * dentil;
    float feat = vS7.a;
    if (feat > 0.5 && feat < 1.5) { // slab edge / balcony line
      float slab = (1.0 - smoothstep(0.045, 0.045 + fw.y, f.y)) * (1.0 - isGround);
      albedo = mix(albedo, vec3(0.78, 0.78, 0.76) * (0.85 + 0.2 * n1) * (1.0 - 0.3 * dirt), slab * nearK);
      win *= 1.0 - slab * nearK;
      hgt += 0.06 * slab * nearK;
    }
    if (isParapet > 0.5) { albedo *= 1.08; }

    // --- glazing
    if (win > 0.001) {
      vec2 wf = clamp((fG - a) / (b2 - a), 0.0, 1.0);     // 0..1 inside the window
      float loft = step(1.5, feat) * step(feat, 2.5);
      float sash = (1.0 - curtain) * step(winW, 0.62) * (1.0 - isGround);
      // frames, mullions, sash meeting rails, shopfront transoms
      float subx = loft > 0.5 ? 4.0 : (isGround > 0.5 ? mix(1.0, 3.0, shop) : (winW > 0.55 ? 2.0 : (sash * step(0.62, bSeed2) > 0.5 ? 2.0 : 1.0)));
      float suby = loft > 0.5 ? 3.0 : (sash > 0.5 ? 2.0 : 1.0);
      vec2 pf = fract(wf * vec2(subx, suby));
      if (isGround > 0.5 && shop > 0.5) pf.y = wf.y < 0.74 ? wf.y / 0.74 : (wf.y - 0.74) / 0.26;
      vec2 fwid = vec2(vS3.a * subx / max(winW, 0.2), vS3.a * suby * cellW / (cellH * max(winH, 0.2)));
      vec2 fe = min(pf, 1.0 - pf);
      float frame = 1.0 - smoothstep(fwid.x * 0.5, fwid.x * 0.5 + fw.x * subx / winW, fe.x) * smoothstep(fwid.y * 0.5, fwid.y * 0.5 + fw.y * suby / winH, fe.y);
      frame *= nearK;
      // room behind the glass
      float rCell = h21(id * 1.37 + seed * 13.0);
      float rFloor = h21(vec2(id.y * 3.1, seed * 91.0));
      float rr2 = h21(id * 0.73 + seed * 51.0);
      float coh = vS4.w;
      // ---- who is home: sleepy / busy buildings, tenant blocks of floors, whole lit office floors
      float activity = bSeed < 0.22 ? 0.18 : (bSeed > 0.8 ? 1.7 : 0.55 + 0.75 * bSeed);
      float zone = h21(vec2(floor(id.y / (3.0 + floor(bSeed2 * 7.0))) * 1.7, seed * 37.0));
      activity *= mix(1.0, zone < 0.3 ? 0.12 : (zone > 0.78 ? 1.9 : 0.9), coh);
      float litRand = mix(rCell, rFloor * 0.72 + rCell * 0.28, coh);
      float litFrac = vS4.y * uWindowLight * (isGround > 0.5 ? 1.5 : 0.6 * activity);
      lit = step(litRand, litFrac);
      float wT = clamp(vS4.z + (rr2 - 0.5) * 0.55 + (bSeed2 - 0.5) * 0.35, 0.0, 1.0);
      litCol = wT < 0.5 ? mix(vec3(0.74, 0.88, 1.0), vec3(1.0, 0.9, 0.76), wT * 2.0) : mix(vec3(1.0, 0.9, 0.76), vec3(1.0, 0.6, 0.27), wT * 2.0 - 1.0);
      litCol = mix(litCol, vec3(0.45, 0.6, 1.0), step(0.965, rr2) * (1.0 - coh));   // the odd television
      float inten = 0.1 + 0.9 * pow(h21(id + seed * 7.0), 2.2);
      inten = mix(inten, 0.3 + 0.35 * rFloor, coh * 0.7);                            // office floors are evenly lit
      // ---- blinds, shades and curtains (drawn at every distance: they are what makes windows differ by day)
      float sType = h21(id * 2.31 + seed * 29.0), sLen = h21(id * 0.91 + seed * 3.7);
      float eY = max(fw.y / winH, 0.004), eX = max(fw.x / winW, 0.004);
      float roller = smoothstep(1.0 - sLen * 0.85 - eY, 1.0 - sLen * 0.85 + eY, wf.y);
      float drapes = 1.0 - smoothstep(0.1 + 0.2 * sLen - eX, 0.1 + 0.2 * sLen + eX, 0.5 - abs(wf.x - 0.5));
      float blindM = curtain > 0.5
        ? roller * step(sType, 0.5) * mix(1.0, step(0.35, rFloor), 0.5)
        : (sType < 0.28 ? 0.0 : (sType < 0.6 ? roller : (sType < 0.86 ? drapes : 0.92)));
      blindM *= (1.0 - isGround) * mix(1.0, 0.4, smoothstep(0.08, 0.45, lodc));     // far away they merge into the glass tone
      vec3 blindCol = mix(vec3(0.74, 0.72, 0.66), vec3(0.62, 0.56, 0.48), step(0.7, rr2)) * (0.85 + 0.15 * rCell);
      if (sType >= 0.86 && curtain < 0.5) blindCol *= 0.82 + 0.18 * step(0.5, fract(wf.y * winH * floorH / 0.05)) * fine;   // venetian slats
      vec3 room = vec3(0.6);
      if (uDetail > 0.5 && lodc < 0.3) {
        // interior mapping: intersect the view ray with a virtual room box
        vec3 rd = vec3(-vt.x, -vt.y, vt.z);
        vec3 rsz = vec3(cellW, cellH, isGround > 0.5 ? 6.0 + 7.0 * rCell : 3.5 + 4.0 * rCell);
        vec3 ro = vec3(clamp(fG.x, 0.001, 0.999) * rsz.x, clamp(fG.y, 0.001, 0.999) * rsz.y, 0.0);
        vec3 tA = (step(vec3(0.0), rd) * rsz - ro) / rd;
        float tt = min(tA.x, min(tA.y, tA.z));
        vec3 hp = ro + rd * tt;
        float back = step(tA.z, min(tA.x, tA.y));
        float cf = (1.0 - back) * step(tA.y, tA.x);
        float shade = back * (0.62 + 0.25 * step(0.45, hp.y / rsz.y)) + cf * (rd.y > 0.0 ? 1.0 : 0.36) + (1.0 - back) * (1.0 - cf) * 0.5;
        // furniture / partitions silhouettes on the back wall
        float furn = step(hp.y / rsz.y, 0.32 + 0.2 * h21(floor(vec2(hp.x * 1.6, 1.0)) + id)) * back;
        shade *= 1.0 - 0.45 * furn;
        shade *= 1.0 - 0.4 * (hp.z / rsz.z);
        // ceiling light panels for offices
        shade += cf * step(0.0, rd.y) * step(0.5, fract(hp.z * 0.7)) * coh * 0.8;
        room = mix(vec3(0.75, 0.72, 0.66), vec3(0.6, 0.66, 0.74), rr2) * shade;
        if (isGround > 0.5) {
          // shop interiors: shelves of merchandise on the back wall, darker floor displays
          // deep shop floor: shelving on the back and side walls, strip lights overhead, dark polished floor
          float side = (1.0 - back) * (1.0 - cf);
          vec2 sh = back > 0.5 ? vec2(hp.x * 4.5, hp.y * 2.6) : vec2(hp.z * 4.5, hp.y * 2.6);
          vec2 mc = floor(sh);
          vec3 merch = mix(vec3(0.42, 0.4, 0.37), vec3(h21(mc + id * 3.0), h21(mc + id * 3.0 + 3.1), h21(mc + id * 3.0 + 7.7)), 0.3) * (0.6 + 0.6 * h21(mc * 1.3 + 2.0));
          float shelf = step(0.16, fract(sh.y)) * step(0.08, fract(sh.x)) * step(hp.y, rsz.y * 0.6);
          merch = mix(vec3(0.4, 0.38, 0.35) * (0.7 + 0.5 * h21(mc * 1.3 + 2.0)), merch, step(0.7, h21(mc * 2.3 + 5.0)));   // mostly neutral stock, a few bright packs
          room *= mix(vec3(0.85), merch * (0.35 + 0.65 * shelf), (back + side) * 0.8);
          float strip = cf * step(0.0, rd.y) * step(0.72, fract(hp.x * 0.55 + 0.2)) * step(0.15, fract(hp.z * 0.33));
          room += vec3(1.6) * strip;
          room *= mix(1.0, 0.3, cf * step(rd.y, 0.0));
          // goods standing in the window itself
          float disp = step(wf.y, 0.2 + 0.16 * h21(vec2(floor(fG.x * cellW * 1.3), id.x))) * step(0.3, h21(vec2(floor(fG.x * cellW * 1.3) + 5.0, id.x + seed)));
          room = mix(room, merch.gbr * 0.55, disp * 0.85);
        }
        room = mix(room, vec3(0.6), smoothstep(0.15, 0.3, lodc));
      }
      float nightGain = mix(0.1, 1.0, smoothstep(0.0, 0.85, uNight)) * (isGround > 0.5 ? mix(4.5, 0.75, uNight) : 1.0);
      float glow = lit * inten * 1.9 * nightGain;
      vec3 interior = room * (glow * litCol + (1.0 - uNight) * 0.13 * (0.45 + 0.55 * rr2)) * (1.0 - 0.85 * blindM);
      interior += blindCol * litCol * glow * 0.42 * blindM;                           // drawn shades glow evenly
      float fres = pow(1.0 - max(dot(V, wN), 0.0), 3.0);
      vec3 glassCol = vS2.rgb * (0.9 + 0.2 * rCell);
      // punched windows are dark but still mirror ~15% of the sky, which is what catches the evening light
      vec3 gAlb = mix(max(glassCol * 0.5, vec3(0.15, 0.17, 0.19)), glassCol * 0.85, curtain);
      gAlb *= mix(0.4, 1.0, smoothstep(2.0, 70.0, uvm.y));                              // street canyons hide the sky
      gAlb = mix(gAlb, blindCol * mix(0.85, 0.5, curtain), blindM * 0.9);
      gAlb *= 1.0 - 0.55 * smoothstep(0.8, 1.0, wf.y) * (1.0 - curtain) * nearK;       // lintel shadow
      albedo = mix(albedo, mix(gAlb, vS3.rgb, frame), win);
      float gMetal = mix(mix(0.86, 0.9, curtain), mix(0.2, 0.6, curtain), blindM);
      metal = mix(wallMetal, mix(gMetal, 0.5, frame), win);
      rough = mix(rough, mix(vS2.a + 0.05 * rr2, 0.5, frame), win);
      emis += interior * win * (1.0 - frame) * (1.0 - 0.6 * fres);
      hgt += 0.03 * frame * win;
      // per-pane tilt: real curtain walls are never perfectly flat
      vec2 tilt = (vec2(h21(id + 3.1 + seed), h21(id + 7.7 + seed)) - 0.5) * 0.05 * win * nearK * (1.0 - frame);
      vec3 wN2 = normalize(wN + T * tilt.x + vec3(0.0, 1.0, 0.0) * tilt.y);
      normal = normalize((viewMatrix * vec4(wN2, 0.0)).xyz);
    }
    // --- night: crown up-lighting and street-level glow on masonry
    float crown = vS5.w * smoothstep(topY - 16.0, topY + 1.0, uvm.y) * step(40.0, topY);
    vec3 crownCol = mix(vec3(1.0, 0.82, 0.6), vS7.rgb * 1.2 + 0.2, 0.25 * step(0.8, h21(vec2(seed * 77.0, 3.0))));
    emis += albedo * crownCol * crown * uNight * 1.6 * (1.0 - win) * uWindowLight * step(0.45, bSeed2);
    emis += albedo * vec3(1.0, 0.7, 0.42) * uNight * uStreetGlow * exp(-uvm.y / 6.5) * 0.55 * (1.0 - win);
  } else if (surf < 1.5) {
    // ================= ROOF =================
    vec2 wp = vFogWorld.xz;
    float rn = vnoise(wp * 0.21 + seed * 40.0); float rn2 = vnoise(wp * 2.7);
    albedo = vS6.rgb * (0.6 + 0.32 * rn) * (0.92 + 0.14 * rn2);
    #ifdef FORGE_INSTANCED
    albedo = mix(albedo, vec3(0.3, 0.29, 0.28) * (0.7 + 0.6 * h21(vec2(seed * 31.0, 4.0))), 0.6);
    #else
    // membrane seams / gravel ballast / silver-coated patches, aligned with the street grid
    vec2 gp = vec2(wp.x * 0.8755 + wp.y * 0.4833, -wp.x * 0.4833 + wp.y * 0.8755);
    float lum = dot(vS6.rgb, vec3(0.33));
    float seamW = mix(0.95, 1.9, bSeed);
    float seamD = abs(fract(gp.x / seamW + seed) - 0.5) * seamW;
    float seam = (1.0 - smoothstep(0.03, 0.06 + pix, seamD)) * mid;
    // repair patches: rectangles of newer / older felt
    vec2 pc2 = floor(gp / vec2(5.5, 3.7) + seed * 3.0);
    float patchR = h21(pc2 + seed * 11.0);
    albedo *= mix(1.0, patchR < 0.5 ? 0.72 : 1.22, step(0.72, h21(pc2 * 1.9 + 2.0)) * (1.0 - smoothstep(0.1, 0.6, pix)));
    float gravel = vnoise(wp * 23.0) * fine;
    float kind = step(0.5, bSeed2);                       // 0 built-up gravel roof, 1 membrane sheets
    albedo *= mix(0.86 + 0.3 * gravel, 1.0 - 0.3 * seam, kind);
    float pond = smoothstep(0.58, 0.66, vnoise(wp * 0.16 + seed * 9.0));
    albedo = mix(albedo, albedo * 0.62, pond);                                         // ponding stains
    albedo = mix(albedo, albedo * 1.25 + 0.03, pond * (1.0 - smoothstep(0.66, 0.7, vnoise(wp * 0.16 + seed * 9.0))) * 0.0);
    float coat = smoothstep(0.6, 0.64, vnoise(wp * 0.05 + seed * 3.0)) * step(lum, 0.3);
    albedo = mix(albedo, vec3(0.5, 0.51, 0.52) * (0.85 + 0.2 * rn2), coat * 0.75);     // aluminium roof coating
    hgt += 0.006 * gravel * (1.0 - kind) + 0.01 * seam * kind;
    #endif
    rough = 0.92;
  } else if (surf < 2.5) {       // trim / stone coping
    albedo = vS1.rgb * 1.08 * (0.88 + 0.16 * n1); rough = 0.8;
    float cj = 1.0 - smoothstep(0.0, 0.008 + pix, abs(fract(uvm.x / 1.1) - 0.5) * 1.1);
    albedo *= 1.0 - 0.35 * cj * mid;
    albedo *= 0.9 + 0.14 * vnoise(uvm * 5.0);
    hgt += -0.01 * cj * mid;
    if (vS1.a > 3.5 && vS1.a < 4.5) { albedo = vS3.rgb; rough = 0.45; metal = 0.6; }
  } else if (surf < 3.5) {       // mechanical metal with louvres
    float lv = fract(uvm.y * 3.3);
    float lou = smoothstep(0.42, 0.5, lv) * (1.0 - smoothstep(0.92, 1.0, lv));
    albedo = vec3(0.42, 0.44, 0.46) * (0.72 + 0.3 * lou * fine + 0.2 * n1); rough = 0.5; metal = 0.7;
    albedo *= 1.0 - 0.25 * smoothstep(0.5, 0.9, vnoise(vec2(uvm.x * 3.0, uvm.y * 0.4) + seed));   // rust & runoff
    hgt += 0.02 * lou * fine;
  } else if (surf < 4.5) {       // cedar water tank staves
    float sx = uvm.x * 5.0;
    float st = h21(vec2(floor(sx), seed));
    float gap = 1.0 - smoothstep(0.0, 0.06, min(fract(sx), 1.0 - fract(sx)));
    albedo = vec3(0.3, 0.2, 0.13) * (0.66 + 0.5 * st) * (0.85 + 0.2 * n1) * (1.0 - 0.5 * gap * fine); rough = 0.9;
    albedo = mix(albedo, albedo * 0.6, smoothstep(0.4, 0.9, vnoise(vec2(uvm.x * 2.0, uvm.y * 0.35) + seed)) * 0.6);   // damp streaks
    float hoop = step(0.9, fract(uvm.y * 1.3)); albedo = mix(albedo, vec3(0.1, 0.09, 0.085), hoop * mid);
    metal = 0.6 * hoop * mid;
    hgt += (-0.008 * gap + 0.012 * hoop) * fine;
  } else if (surf < 5.5) {       // dark voids / tar
    albedo = vec3(0.035, 0.035, 0.04); rough = 0.95;
  } else if (surf < 6.5) {       // plain glass (skylights, screens)
    albedo = vS2.rgb * 0.8; rough = 0.08; metal = 0.9;
    emis += vec3(1.0, 0.8, 0.55) * uNight * 0.25 * uWindowLight;
  } else if (surf > 9.5) {       // painted plywood & pipe (sidewalk sheds, hoardings)
    float pj = 1.0 - smoothstep(0.0, 0.012 + pix, abs(fract(uvm.x / 1.22) - 0.5) * 1.22);
    vec3 pc = bSeed < 0.6 ? vec3(0.035, 0.12, 0.075) : (bSeed < 0.85 ? vec3(0.04, 0.07, 0.16) : vec3(0.3, 0.3, 0.29));
    albedo = pc * (0.75 + 0.4 * n1) * (1.0 - 0.45 * pj * mid) * (0.9 + 0.16 * vnoise(uvm * 7.0)); rough = 0.78;
    hgt += -0.008 * pj * mid;
  } else if (surf > 8.5) {       // canvas awnings
    vec3 ac = mix(vS7.rgb, vec3(h21(vec2(seed * 91.0, 1.0)), h21(vec2(seed * 53.0, 2.0)), h21(vec2(seed * 17.0, 3.0))) * 0.6, 0.5);
    float stripe = step(0.5, fract(uvm.x * 1.6)) * step(0.5, h21(vec2(seed * 7.0, 9.0)));
    albedo = mix(ac, vec3(0.8, 0.78, 0.72), stripe * 0.85) * (0.82 + 0.2 * vnoise(uvm * 3.0)); rough = 0.9;
  } else {                       // polished steel (spires, crowns)
    albedo = vec3(0.78, 0.8, 0.82); rough = 0.24; metal = 1.0;
    emis += vec3(1.0, 0.9, 0.75) * uNight * 0.22 * uWindowLight;
  }
  // ---- relief
  normal = forgeBump(normal, hgt);
  // ---- weather
  float upf = smoothstep(0.5, 0.85, wN.y);
  float sNoise = vnoise(vFogWorld.xz * 0.6) * 0.6 + vnoise(vFogWorld.xz * 4.0) * 0.4;
  float snow = upf * smoothstep(0.0, 0.5, uSnow * 1.25 - sNoise * 0.35 * (1.0 - uSnow));
  snow = max(snow, (1.0 - upf) * uSnow * 0.22 * smoothstep(0.35, 0.8, vnoise(uvm * vec2(0.5, 0.12) + seed)) * step(surf, 0.5) * (1.0 - metal));
  albedo = mix(albedo, vec3(0.84, 0.88, 0.95), snow);
  rough = mix(rough, 0.88, snow); metal *= 1.0 - snow;
  float wet = uWet * (1.0 - snow) * (0.25 + 0.75 * upf);
  float puddle = smoothstep(0.42, 0.62, vnoise(vFogWorld.xz * 0.35 + 3.0)) * upf;
  albedo *= 1.0 - 0.32 * wet * (1.0 - metal);
  rough = mix(rough, min(rough, mix(0.32, 0.06, puddle)), wet);
  diffuseColor.rgb = albedo;
  roughnessFactor = clamp(rough, 0.04, 1.0);
  metalnessFactor = clamp(metal, 0.0, 1.0);
  totalEmissiveRadiance += emis;
}
`;

/** Shop names for fascia signs: 4 x 8 cells of white lettering on black (sampled as a mask). Generic NYC trades plus a few in-universe nods (text only). */
const SIGN_NAMES = [
  'DELI · GROCERY', 'PIZZA', 'BAGELS', 'COFFEE', 'PHARMACY', 'CLEANERS', 'HARDWARE', 'WINE & LIQUORS',
  'FLOWERS', 'BOOKS', 'BARBER SHOP', 'NAIL SALON', 'DINER', 'BAKERY', 'MARKET', 'OPTICAL',
  'SHOE REPAIR', 'TAILOR', 'LAUNDROMAT', 'GALLERY', 'RECORDS', 'NOODLE BAR', 'TAQUERIA', 'SUSHI',
  "DELMAR'S DELI", "JOSIE'S BAR", 'ALIAS INVESTIGATIONS', 'NELSON & MURDOCK', 'BANK', 'HOTEL', 'BAR & GRILL', 'NEWS · CANDY',
];
const SIGN_FONTS = ['700 78px "Helvetica Neue", Arial, sans-serif', '700 76px Georgia, "Times New Roman", serif', '800 84px "Arial Narrow", "Helvetica Neue", Arial, sans-serif', 'italic 700 78px Georgia, serif', '500 74px Futura, "Trebuchet MS", Arial, sans-serif'];

function makeSignAtlas(): THREE.Texture {
  if (typeof document === 'undefined') {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t;
  }
  const cw = 512, ch = 128;
  const cv = document.createElement('canvas'); cv.width = cw * 4; cv.height = ch * 8;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  SIGN_NAMES.forEach((name, i) => {
    const x = (i % 4) * cw, y = Math.floor(i / 4) * ch;
    c.font = SIGN_FONTS[i % SIGN_FONTS.length];
    const w = c.measureText(name).width;
    c.save(); c.translate(x + cw / 2, y + ch / 2 + 4);
    const k = Math.min(1, (cw - 44) / w); c.scale(k, Math.max(k, 0.8));
    c.fillText(name, 0, 0); c.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export const facadeUniforms = { uPalette: { value: null as THREE.Texture | null }, uStreetGlow: { value: 1 }, uSignAtlas: { value: null as THREE.Texture | null } };

function makeFacade(instanced: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  facadeUniforms.uSignAtlas.value ??= makeSignAtlas();
  extendMaterial(m, {
    key: instanced ? 'facade-inst' : 'facade',
    uniforms: { uPalette: facadeUniforms.uPalette, uWindowLight: U.uWindowLight, uDetail: U.uDetail, uStreetGlow: facadeUniforms.uStreetGlow, uSignAtlas: facadeUniforms.uSignAtlas },
    vPars: V_PARS, vMain: V_MAIN, fPars: F_PARS, fSurface: F_SURFACE,
    defines: instanced ? { FORGE_INSTANCED: 1 } : {},
  });
  return m;
}

let _facade: THREE.MeshStandardMaterial | null = null;
let _facadeInst: THREE.MeshStandardMaterial | null = null;
export const facadeMaterial = () => (_facade ??= makeFacade(false));
export const facadeInstancedMaterial = () => (_facadeInst ??= makeFacade(true));
