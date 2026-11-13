import * as THREE from 'three';
import earcut from 'earcut';
import { CityData, ll, GRID_ANGLE, pointInPoly, PolyRec } from './geo';
import { extendMaterial, U, GLSL_NOISE } from '../engine/materials';
import { hash2, mulberry32 } from '../util/rng';
import { laneKind, roadDir, streetNet } from './streets';
import { buildSidewalks, sidewalkMaterial } from './sidewalks';

/** Hand-traced New Jersey bank of the Hudson (south → north). NYC Open Data stops at the state line. */
const NJ_SHORE: [number, number][] = [
  [40.56, -74.11], [40.645, -74.085], [40.668, -74.08], [40.685, -74.072], [40.692, -74.058], [40.6935, -74.045],
  [40.703, -74.04], [40.709, -74.036], [40.7125, -74.0335], [40.7165, -74.0318], [40.7215, -74.0322], [40.7275, -74.03],
  [40.733, -74.0262], [40.7365, -74.0255], [40.741, -74.0245], [40.7455, -74.0228], [40.75, -74.0225], [40.7555, -74.0232],
  [40.76, -74.02], [40.765, -74.0168], [40.772, -74.0118], [40.78, -74.0055], [40.79, -73.998], [40.8, -73.991],
  [40.81, -73.9842], [40.82, -73.9778], [40.83, -73.972], [40.845, -73.964], [40.8635, -73.955],
];

const FAR = 70000;

/** Coarse raster masks used by procedural placement (roads, occupied lots). */
export class CityGrid {
  readonly cell = 5;
  readonly w: number; readonly h: number;
  readonly road: Uint8Array;   // 1 = roadway
  readonly occ: Uint8Array;    // 1 = occupied by a real building / park / reserved
  constructor(readonly minX: number, readonly minZ: number, maxX: number, maxZ: number) {
    this.w = Math.ceil((maxX - minX) / this.cell); this.h = Math.ceil((maxZ - minZ) / this.cell);
    this.road = new Uint8Array(this.w * this.h); this.occ = new Uint8Array(this.w * this.h);
  }
  idx(x: number, z: number) {
    const i = Math.floor((x - this.minX) / this.cell), j = Math.floor((z - this.minZ) / this.cell);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }
  isRoad = (x: number, z: number) => { const k = this.idx(x, z); return k >= 0 && this.road[k] === 1; };
  isOcc = (x: number, z: number) => { const k = this.idx(x, z); return k < 0 || this.occ[k] === 1; };
  stamp(arr: Uint8Array, x: number, z: number, r: number) {
    const c = this.cell;
    for (let dz = -r; dz <= r; dz += c) for (let dx = -r; dx <= r; dx += c) { const k = this.idx(x + dx, z + dz); if (k >= 0) arr[k] = 1; }
  }
  fillPoly(arr: Uint8Array, pts: ArrayLike<number>, minX: number, maxX: number, minZ: number, maxZ: number) {
    const c = this.cell;
    for (let z = Math.floor(minZ / c) * c + c / 2; z <= maxZ; z += c)
      for (let x = Math.floor(minX / c) * c + c / 2; x <= maxX; x += c)
        if (pointInPoly(x, z, pts)) { const k = this.idx(x, z); if (k >= 0) arr[k] = 1; }
  }
}

function triangulate(polys: ArrayLike<number>[], y: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const p of polys) {
    const base = pos.length / 3;
    const flat = Array.from(p as ArrayLike<number>);
    const tris = earcut(flat, undefined, 2);
    for (let i = 0; i < flat.length; i += 2) pos.push(flat[i], y, flat[i + 1]);
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[c * 2] - flat[a * 2]) * (flat[b * 2 + 1] - flat[a * 2 + 1]);
      if (cr > 0) idx.push(base + a, base + c, base + b); else idx.push(base + a, base + b, base + c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

const REFL_PARS = /* glsl */ `
uniform sampler2D uReflTex; uniform mat4 uReflMatrix; uniform float uReflStrength;
vec3 planarRefl(vec3 wp, vec2 distort){
  vec4 rc = uReflMatrix * vec4(wp, 1.0);
  rc.xy += distort * rc.w;
  return texture2DProj(uReflTex, rc).rgb;
}
`;

const GROUND_SURFACE = /* glsl */ `
{
  vec2 wp = vFogWorld.xz;
  float dist = length(cameraPosition - vFogWorld);
  float n = vnoise(wp * 0.02) * 0.6 + vnoise(wp * 0.21) * 0.4;
  vec3 col = mix(vec3(0.23, 0.225, 0.215), vec3(0.34, 0.33, 0.31), n);
  // sidewalk flags aligned with the Manhattan grid, visible up close
  vec2 g = vec2(wp.x * ${Math.cos(GRID_ANGLE).toFixed(5)} + wp.y * ${Math.sin(GRID_ANGLE).toFixed(5)}, -wp.x * ${Math.sin(GRID_ANGLE).toFixed(5)} + wp.y * ${Math.cos(GRID_ANGLE).toFixed(5)});
  vec2 pf = fract(g / 1.52); float joint = max(step(pf.x, 0.025), step(pf.y, 0.025));
  float near = 1.0 - smoothstep(25.0, 110.0, dist);
  col *= 1.0 - 0.28 * joint * near;
  col *= 0.9 + 0.2 * h21(floor(g / 1.52)) * near;
  col *= 0.86 + 0.28 * vnoise(wp * 1.7);
  float snowN = vnoise(wp * 0.5) * 0.5 + vnoise(wp * 3.1) * 0.5;
  float snow = smoothstep(0.0, 0.45, uSnow * 1.3 - snowN * 0.3 * (1.0 - uSnow));
  col = mix(col, vec3(0.83, 0.87, 0.94) * (0.9 + 0.1 * snowN), snow);
  float puddle = smoothstep(0.5, 0.68, vnoise(wp * 0.33 + 7.0));
  float wet = uWet * (1.0 - snow);
  col *= 1.0 - 0.38 * wet;
  diffuseColor.rgb = col;
  roughnessFactor = mix(mix(0.92, mix(0.4, 0.07, puddle), wet), 0.9, snow);
  metalnessFactor = 0.0;
  // warm spill from street lighting & shop windows at night
  totalEmissiveRadiance += col * vec3(1.0, 0.72, 0.45) * uNight * 0.16 * (0.5 + vnoise(wp * 0.05));
  #ifdef FORGE_REFL
  if (uReflStrength > 0.001) {
    vec3 Vv = normalize(cameraPosition - vFogWorld);
    float fres = 0.04 + 0.96 * pow(1.0 - max(Vv.y, 0.0), 4.0);
    vec2 dn = (vec2(vnoise(wp * 11.0), vnoise(wp * 11.0 + 19.0)) - 0.5) * (1.0 - 0.8 * puddle);
    vec3 rf = planarRefl(vFogWorld, dn * vec2(0.004, 0.02));
    totalEmissiveRadiance += rf * fres * wet * uReflStrength * (0.1 + 0.9 * puddle);
  }
  #endif
}
`;

/** anti-aliased helpers for painted markings and cast-iron details */
const ROAD_PARS = /* glsl */ `
float aaBox(float d, float hw, float fw){ return 1.0 - smoothstep(hw - fw, hw + fw, abs(d)); }
// periodic bars of width w every p metres, faded to their mean coverage once they get sub-pixel
float aaBars(float c, float p, float w, float fw){
  float d = (fract(c / p) - 0.5) * p;
  return mix(aaBox(d, w * 0.5, fw), w / p, smoothstep(0.2, 0.6, fw / p));
}
`;

const ROAD_SURFACE = /* glsl */ `
{
  vec2 wp = vFogWorld.xz;
  float halfW = vRoad.x, len = vRoad.y;
  float x = vRUv.x, v = vRUv.y;
  float dir = vRoad2.x, seed = vRoad2.y, kind = vRoad2.z;
  float fw = max(fwidth(x), fwidth(v)) + 1e-4;              // metres per pixel
  float detail = 1.0 - smoothstep(0.02, 0.08, fw);
  float fine = 1.0 - smoothstep(0.004, 0.02, fw);
  float ax = abs(x);
  float eS = vRoad.z < 0.0 ? 1000.0 : v - vRoad.z;
  float eE = vRoad.w < 0.0 ? 1000.0 : (len - vRoad.w) - v;
  float e = min(eS, eE);
  float n = vnoise(wp * 0.35) * 0.55 + vnoise(wp * 2.9) * 0.45;

  // ---- asphalt: aggregate grain, bleached older surface, fresh black overlays
  vec3 col = vec3(0.075, 0.076, 0.079) * (0.82 + 0.36 * n);
  float agg = h21(floor(wp * 38.0)) * 0.6 + h21(floor(wp * 13.0) + 3.0) * 0.4;
  col *= 0.86 + 0.28 * mix(0.5, agg, fine);
  float age = smoothstep(0.35, 0.8, fbm2(wp * 0.018 + seed));
  col = mix(col, col * 1.55 + 0.012, age * 0.7);
  float rough = 0.9;

  // lanes (kept in step with the traffic props)
  float drive = halfW - 2.2;
  float lanes = max(1.0, floor((halfW * 2.0 - 4.4) / 3.3 + 0.5));
  if (dir == 0.0) lanes = max(2.0, 2.0 * floor(lanes * 0.5 + 0.5));
  float lw = (drive * 2.0) / lanes;
  float lx = (fract((x + drive) / lw) - 0.5) * lw;            // offset from the lane centre
  float inLane = step(ax, drive) * step(1.2, drive);
  // wheel paths: polished, slightly lighter, a little sunken; an oil-dark strip between them
  float wheel = (aaBox(abs(lx) - 0.85, 0.32, 0.25)) * inLane;
  float oil = aaBox(lx, 0.38, 0.3) * inLane;
  col *= 1.0 + 0.1 * wheel;
  col *= 1.0 - 0.22 * oil * (0.6 + 0.4 * vnoise(wp * 1.7 + 2.0));
  rough -= 0.12 * wheel;
  // drip stains under parked cars
  float parkZ = step(drive, ax) * step(ax, halfW - 0.3);
  float drip = smoothstep(0.55, 0.85, vnoise(vec2(v * 0.9, ax * 2.0) + seed)) * parkZ;
  col *= 1.0 - 0.3 * drip;

  // utility-cut patches: rectangles of newer (darker) or older (greyer) asphalt with sealed seams
  vec2 pc = vec2(floor(v / 8.0), floor((x + halfW) / 3.1));
  float ph = h21(pc + seed * 1.37);
  float patchM = 0.0, seam = 0.0;
  if (ph < 0.14) {
    vec2 pf = vec2(fract(v / 8.0) * 8.0, fract((x + halfW) / 3.1) * 3.1);
    vec2 c0 = vec2(1.0 + 3.0 * h21(pc + 1.0), 0.3 + 0.8 * h21(pc + 2.0));
    vec2 sz = vec2(2.0 + 3.0 * h21(pc + 3.0), 1.0 + 1.0 * h21(pc + 4.0));
    vec2 q = abs(pf - c0 - sz * 0.5) - sz * 0.5;
    float d = max(q.x, q.y);
    patchM = 1.0 - smoothstep(-fw, fw, d);
    seam = (1.0 - smoothstep(0.0, 0.04 + fw, abs(d))) * detail;
  }
  // long trench repairs across the roadway
  float tc = floor(v / 47.0);
  float th = h21(vec2(tc, seed + 9.0));
  if (th < 0.25) {
    float tv = fract(v / 47.0) * 47.0 - 10.0 - 20.0 * th;
    float inX = step(-halfW + halfW * h21(vec2(tc, 3.0)), x);
    float tr = (1.0 - smoothstep(0.45 - fw, 0.45 + fw, abs(tv))) * inX;
    seam = max(seam, (1.0 - smoothstep(0.0, 0.04 + fw, abs(abs(tv) - 0.45))) * detail * inX);
    patchM = max(patchM, tr);
  }
  col = mix(col, ph < 0.07 ? vec3(0.05, 0.05, 0.053) : col * 1.3 + 0.01, patchM);
  // tar snakes: glossy black crack sealant, meandering plus along the longitudinal joints
  float tv0 = vnoise(wp * 0.21 + seed * 3.1) - 0.5;
  float tv1 = vnoise(wp * 0.5 + 40.0 + seed) - 0.5;
  float tfw0 = fwidth(tv0) + 1e-4, tfw1 = fwidth(tv1) + 1e-4;
  float tar = (1.0 - smoothstep(0.0035, 0.0035 + tfw0 * 1.2, abs(tv0))) * smoothstep(0.45, 0.6, vnoise(wp * 0.045 + 5.0));
  tar = max(tar, (1.0 - smoothstep(0.003, 0.003 + tfw1 * 1.2, abs(tv1))) * smoothstep(0.55, 0.7, vnoise(wp * 0.06 + 1.0)));
  float jl = abs(abs(lx) - lw * 0.5 + 0.12 + 0.08 * (vnoise(vec2(v * 0.4, x)) - 0.5));
  tar = max(tar, (1.0 - smoothstep(0.02, 0.02 + fw, jl)) * smoothstep(0.5, 0.65, vnoise(vec2(v * 0.03, floor((x + drive) / lw)) + seed)) * inLane);
  tar = max(tar, seam);
  tar *= detail;
  col = mix(col, vec3(0.022, 0.022, 0.024), tar * 0.85);
  rough = mix(rough, 0.42, tar);

  // ---- paint
  float paint = 0.0, yellow = 0.0;
  float atJ = step(e, 999.0);
  if (e > 0.0) {
    // lane dashes (10 ft dash, 30 ft gap)
    if (lanes > 1.5 && ax < drive && e > 7.0) {
      float bnd = (fract((x + drive) / lw + 0.5) - 0.5) * lw;   // distance to the nearest lane boundary
      float onB = step(lw * 0.5, x + drive) * step(x + drive, drive * 2.0 - lw * 0.5);
      float centre = dir == 0.0 ? 1.0 - step(0.3, ax) : 0.0;
      paint = max(paint, aaBox(bnd, 0.06, fw) * aaBars(v, 12.0, 3.0, fw) * onB * (1.0 - centre));
    }
    // double yellow on two-way streets
    if (dir == 0.0 && e > 1.0) yellow = max(aaBox(x - 0.13, 0.055, fw), aaBox(x + 0.13, 0.055, fw));
    // high-visibility crosswalk bars, parallel to traffic
    float xw = step(1.0, e) * step(e, 4.4) * atJ * step(ax, halfW - 0.5) * step(3.0, halfW);
    paint = max(paint, xw * aaBars(x + halfW, 1.2, 0.6, fw) * aaBox(e - 2.7, 1.7, fw));
    // stop bar on the approach side
    float atEnd = step(eE, eS);
    float appr = dir > 0.5 ? atEnd : dir < -0.5 ? 1.0 - atEnd : (atEnd > 0.5 ? step(0.0, x) : step(x, 0.0));
    paint = max(paint, atJ * appr * aaBox(e - 5.4, 0.3, fw) * step(ax, halfW - 0.4) * step(3.4, halfW));
    // kerbside lanes
    if (kind > 0.5) {
      float sideX = kind < 1.5 ? x : -x;
      float zone = step(drive - 0.2, sideX) * step(sideX, halfW - 0.4) * step(5.0, e);
      vec3 lane = kind < 1.5 ? vec3(0.32, 0.075, 0.05) : vec3(0.09, 0.26, 0.13);
      col = mix(col, lane * (0.75 + 0.35 * n) * (1.0 + 0.15 * age), zone * (0.75 + 0.25 * smoothstep(0.2, 0.6, vnoise(wp * 1.4))));
      paint = max(paint, aaBox(sideX - drive + 0.2, 0.08, fw) * step(5.0, e));
    }
  }
  // wear: paint scuffed off in the wheel paths and by age
  float wear = smoothstep(0.2, 0.62, vnoise(wp * 3.3) * 0.55 + vnoise(wp * 0.7) * 0.45 + 0.2 - 0.25 * wheel - 0.15 * age);
  wear = mix(0.75, wear, detail);
  paint *= wear; yellow *= wear;
  col = mix(col, vec3(0.6, 0.6, 0.57), paint);
  col = mix(col, vec3(0.62, 0.44, 0.07), yellow);
  rough = mix(rough, 0.65, max(paint, yellow));

  // ---- cast iron: manholes in the lanes, storm drains at the kerb, utility plates
  float iron = 0.0; vec3 ironC = vec3(0.0);
  {
    float mc = floor(v / 23.0);
    float mh = h21(vec2(mc, seed + 21.0));
    if (mh < 0.55 && drive > 1.2) {
      vec2 mp = vec2(mc * 23.0 + 4.0 + 15.0 * h21(vec2(mc, 5.0)), -drive + 2.0 * drive * h21(vec2(mc, 6.0 + seed)));
      vec2 dq = vec2(v, x) - mp;
      float r = length(dq);
      float disc = 1.0 - smoothstep(0.34 - fw, 0.34 + fw, r);
      float ring = 1.0 - smoothstep(0.0, 0.02 + fw, abs(r - 0.3));
      float hatch = mix(0.5, step(0.5, fract(dq.x * 9.0)) * step(0.5, fract(dq.y * 9.0)), fine);
      iron = max(iron, disc);
      ironC = vec3(0.075, 0.07, 0.065) * (0.75 + 0.35 * hatch) * (1.0 - 0.4 * ring) + vec3(0.06, 0.03, 0.01) * vnoise(dq * 6.0);
    }
    // storm drain grates just before each corner
    if (atJ > 0.5 && halfW > 3.0) {
      vec2 dq = vec2(e - 7.2, ax - (halfW - 0.42));
      float g = aaBox(dq.x, 0.55, fw) * aaBox(dq.y, 0.3, fw);
      float bars = mix(0.45, aaBars(e, 0.09, 0.045, fw), fine);
      if (g > iron) { iron = g; ironC = mix(vec3(0.01), vec3(0.12, 0.1, 0.085), bars); }
    }
    // small rectangular utility plates
    float uc = floor(v / 31.0);
    if (h21(vec2(uc, seed + 33.0)) < 0.35) {
      vec2 up = vec2(uc * 31.0 + 6.0 + 18.0 * h21(vec2(uc, 7.0)), -halfW + 1.2 + (halfW * 2.0 - 2.4) * h21(vec2(uc, 8.0)));
      vec2 dq = vec2(v, x) - up;
      float g = aaBox(dq.x, 0.45, fw) * aaBox(dq.y, 0.3, fw);
      if (g > iron) { iron = g; ironC = vec3(0.11, 0.1, 0.09) * (0.8 + 0.4 * mix(0.5, step(0.5, fract((dq.x + dq.y) * 8.0)), fine)); }
    }
  }
  iron *= 1.0 - smoothstep(0.03, 0.12, fw);
  col = mix(col, ironC, iron);
  rough = mix(rough, 0.45, iron);

  // gutter grime against the kerb
  float gutter = smoothstep(halfW - 0.9, halfW - 0.05, ax);
  col *= 1.0 - 0.25 * gutter * (0.5 + 0.5 * vnoise(wp * 2.0));

  // ---- snow: ploughed tracks of grey slush, banks against the kerb
  float track = clamp(wheel + oil * 0.5, 0.0, 1.0) * inLane;
  float bank = smoothstep(halfW - 2.2, halfW - 0.3, ax);
  float sAmt = uSnow * (0.5 + 0.7 * bank - 0.45 * track) + (n - 0.5) * 0.3 * uSnow;
  float snow = smoothstep(0.08, 0.55, sAmt);
  vec3 slush = vec3(0.3, 0.29, 0.27) * (0.8 + 0.4 * n);
  col = mix(col, slush, smoothstep(0.1, 0.4, uSnow) * track * 0.6);
  col = mix(col, vec3(0.8, 0.83, 0.88) * (0.85 + 0.15 * n), snow);
  rough = mix(rough, 0.85, snow);

  // ---- rain: darker asphalt, puddles collect in the ruts, the gutters and sunken patches; not a uniform mirror
  float wet = uWet * (1.0 - snow);
  float low = vnoise(wp * 0.27 + 3.0) * 0.6 + vnoise(wp * 1.1 + 8.0) * 0.4;
  float puddle = smoothstep(0.56, 0.74, low + 0.24 * gutter + 0.12 * wheel + 0.1 * patchM - 0.1 * paint);
  col *= 1.0 - wet * (0.5 - 0.25 * paint - 0.2 * iron);
  diffuseColor.rgb = col;
  roughnessFactor = mix(rough, mix(0.36 - 0.12 * wheel, 0.035, puddle), wet);
  metalnessFactor = 0.25 * iron * (1.0 - snow);

  // ---- sodium / LED street-lamp pools alternate along both kerbs
  float seg = v / 31.0; float lph = fract(seg) - 0.5;
  float side = mod(floor(seg), 2.0) * 2.0 - 1.0;
  float px = (x - side * halfW * 0.8) / (halfW * 0.9 + 2.0);
  float pool = exp(-(lph * lph) * 31.0 * 31.0 / 150.0) * exp(-px * px);
  vec3 lampC = mix(vec3(1.0, 0.62, 0.3), vec3(0.85, 0.92, 1.0), step(0.6, h21(vec2(floor(len), 2.0))));
  totalEmissiveRadiance += (min(col, vec3(0.7)) + 0.012) * lampC * uNight * (0.35 + 2.4 * pool);
  #ifdef FORGE_REFL
  if (uReflStrength > 0.001) {
    vec3 Vv = normalize(cameraPosition - vFogWorld);
    float fres = 0.05 + 0.95 * pow(1.0 - max(Vv.y, 0.0), 3.5);
    // fine asphalt grain breaks the mirror into long vertical smears; puddles stay sharp
    vec2 dn = (vec2(vnoise(wp * 14.0), vnoise(wp * 14.0 + 31.0)) - 0.5) * (1.0 - 0.85 * puddle) + (vec2(vnoise(wp * 55.0), vnoise(wp * 55.0 + 5.0)) - 0.5) * 0.6 * (1.0 - puddle);
    vec3 rf = planarRefl(vFogWorld, dn * vec2(0.004, 0.028));
    totalEmissiveRadiance += min(rf, vec3(24.0)) * fres * wet * uReflStrength * (0.1 + 0.9 * puddle);
  }
  #endif
}
`;

const PARK_SURFACE = /* glsl */ `
{
  vec2 wp = vFogWorld.xz;
  float n = vnoise(wp * 0.05) * 0.5 + vnoise(wp * 0.4) * 0.3 + vnoise(wp * 3.0) * 0.2;
  vec3 col = mix(vec3(0.07, 0.13, 0.045), vec3(0.16, 0.22, 0.07), n);
  float path = smoothstep(0.47, 0.5, vnoise(wp * 0.03 + 5.0)) * (1.0 - smoothstep(0.5, 0.53, vnoise(wp * 0.03 + 5.0)));
  col = mix(col, vec3(0.3, 0.28, 0.24), path);
  float snow = smoothstep(0.0, 0.4, uSnow * 1.4 - n * 0.2);
  col = mix(col, vec3(0.86, 0.9, 0.96), snow);
  col *= 1.0 - 0.25 * uWet * (1.0 - snow);
  diffuseColor.rgb = col; roughnessFactor = 0.95; metalnessFactor = 0.0;
}
`;

const WATER_VERT = /* glsl */ `
varying vec3 vFogWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vFogWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WATER_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uFogColor; uniform vec3 uFogSunColor; uniform vec4 uFogParams; uniform vec3 uSunDir;
uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon; uniform vec3 uSunColor;
uniform float uNight; uniform float uTime; uniform float uSnow; uniform float uWet;
uniform sampler2D uReflTex; uniform mat4 uReflMatrix; uniform float uReflOn;
varying vec3 vFogWorld;
${GLSL_NOISE}
vec3 applyCityFog(vec3 col){
  vec3 d = vFogWorld - cameraPosition; float L = length(d); vec3 rd = d / max(L, 1e-4);
  float a = exp(-max(cameraPosition.y, 0.0) * uFogParams.z); float b = exp(-max(vFogWorld.y, 0.0) * uFogParams.z);
  float hInt = abs(d.y) > 1.0 ? (a - b) / (d.y * uFogParams.z) : a;
  float f = 1.0 - exp(-L * (uFogParams.x + uFogParams.y * hInt));
  float sd0 = max(dot(rd, uSunDir), 0.0);
  float s = pow(sd0, 6.0) + 0.45 * sd0 * sd0;
  return mix(col, mix(uFogColor, uFogSunColor, clamp(s * uFogParams.w, 0.0, 1.0)), f);
}
float waveH(vec2 p){
  float t = uTime * 0.35;
  return vnoise(p * 0.035 + vec2(t * 0.11, t * 0.07)) * 1.0 + vnoise(p * 0.11 - vec2(t * 0.17, 0.0)) * 0.42 + vnoise(p * 0.37 + vec2(0.0, t * 0.3)) * 0.16 + vnoise(p * 1.3 + t * 0.4) * 0.05;
}
void main(){
  vec2 p = vFogWorld.xz;
  vec3 toCam = cameraPosition - vFogWorld; float dist = length(toCam); vec3 V = toCam / dist;
  float eps = 0.6 + dist * 0.004;
  float h0 = waveH(p), hx = waveH(p + vec2(eps, 0.0)), hz = waveH(p + vec2(0.0, eps));
  float amp = mix(0.5, 0.16, smoothstep(300.0, 6000.0, dist)) * (1.0 + 0.6 * uWet);
  vec3 N = normalize(vec3(-(hx - h0) / eps * amp * 3.0, 1.0, -(hz - h0) / eps * amp * 3.0));
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.8));
  float sd = max(dot(R, uSunDir), 0.0);
  sky += uFogSunColor * pow(sd, 8.0) * 0.5 * uFogParams.w;
  vec3 refl = sky;
  if (uReflOn > 0.5) {
    vec4 rc = uReflMatrix * vec4(vFogWorld.x, 0.0, vFogWorld.z, 1.0);
    rc.xy += N.xz * vec2(0.035, 0.11) * rc.w;
    vec3 pr = texture2DProj(uReflTex, rc).rgb;
    refl = mix(pr, sky, smoothstep(0.0, 0.5, length(N.xz) * 1.6));
  }
  // estuary water: the reflected sky loses some saturation (micro-roughness, silt), the body is olive-grey
  float rl = dot(refl, vec3(0.2126, 0.7152, 0.0722));
  refl = mix(vec3(rl), refl, 0.72);
  vec3 deep = mix(uSkyHorizon, uSkyZenith, 0.35) * 0.07 + vec3(0.006, 0.012, 0.012) * (1.0 - uNight * 0.85);
  deep = mix(deep, vec3(0.045, 0.055, 0.048) * (1.0 - uNight * 0.85), 0.45);     // estuary silt
  vec3 col = mix(deep, refl, fres);
  // sun / moon glitter
  float glit = pow(sd, 380.0) * 26.0 + pow(sd, 60.0) * 0.6;
  col += uSunColor * glit * (0.35 + 0.65 * vnoise(p * 0.9 + uTime * 0.6));
  // ice floes when it snows
  float ice = smoothstep(0.62, 0.7, vnoise(p * 0.012) * 0.6 + vnoise(p * 0.08) * 0.4) * smoothstep(0.5, 1.0, uSnow);
  col = mix(col, vec3(0.7, 0.75, 0.82) * (uSkyHorizon * 0.6 + 0.25), ice * 0.7);
  gl_FragColor = vec4(min(max(applyCityFog(col), vec3(0.0)), vec3(48.0)), 1.0);
}`;

export interface GroundBuild {
  group: THREE.Group;
  grid: CityGrid;
  landPolys: PolyRec[];
  waterMaterial: THREE.ShaderMaterial;
  /** materials that sample the planar reflection (toggled with quality) */
  reflMaterials: THREE.Material[];
  isLand: (x: number, z: number) => boolean;
}

export function buildGround(data: CityData): GroundBuild {
  const group = new THREE.Group();
  group.name = 'ground';
  const { bbox } = data;
  const grid = new CityGrid(bbox.minX - 600, bbox.minZ - 600, bbox.maxX + 600, bbox.maxZ + 600);

  // ---- land polygons (boroughs + New Jersey + far-field skirts)
  const nj: number[] = [];
  for (const [lat, lon] of NJ_SHORE) { const [x, z] = ll(lat, lon); nj.push(x, z); }
  const last = [nj[nj.length - 2], nj[nj.length - 1]];
  const chan = [Math.sin(0.35), -Math.cos(0.35)];
  nj.push(last[0] + chan[0] * FAR, last[1] + chan[1] * FAR, -FAR, last[1] + chan[1] * FAR, -FAR, nj[1]);
  const njPoly = new Float32Array(nj);
  const zN = bbox.minZ - 3500, zS = bbox.maxZ + 3500, xE = bbox.maxX + 3500;
  const [hx] = ll(40.8635, -73.9345);
  const farNorth = new Float32Array([hx, zN + 40, hx + chan[0] * FAR, zN + chan[1] * FAR, FAR, zN + chan[1] * FAR, FAR, zN + 40]);
  const farEast = new Float32Array([xE - 40, zN, FAR, zN, FAR, zS, xE - 40, zS]);
  const farSouth = new Float32Array([-3300, zS - 40, FAR, zS - 40, FAR, FAR, -3300, FAR]);
  const fix = (p: Float32Array) => {
    let a = 0; for (let i = 0, n = p.length / 2; i < n; i++) { const j = (i + 1) % n; a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
    if (a < 0) { const q = new Float32Array(p.length); for (let i = 0, n = p.length / 2; i < n; i++) { q[i * 2] = p[(n - 1 - i) * 2]; q[i * 2 + 1] = p[(n - 1 - i) * 2 + 1]; } return q; }
    return p;
  };
  const landPolys: PolyRec[] = [...data.land, { pts: fix(njPoly), boro: 9 }];
  const allLand = [...landPolys.map((l) => l.pts), fix(farNorth), fix(farEast), fix(farSouth)];

  const reflMaterials: THREE.Material[] = [];
  const reflUniforms = { uReflTex: U.uReflTex, uReflMatrix: U.uReflMatrix, uReflStrength: U.uReflStrength };

  const groundMat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), {
    key: 'ground', fPars: REFL_PARS, fSurface: GROUND_SURFACE, uniforms: reflUniforms, defines: { FORGE_REFL: 1 },
  });
  reflMaterials.push(groundMat);
  const land = new THREE.Mesh(triangulate(allLand, 0), groundMat);
  land.receiveShadow = true;
  land.layers.set(1);
  land.name = 'land';
  group.add(land);

  // ---- bulkhead / seawall skirt so shorelines have a physical edge
  {
    const pos: number[] = [], idx: number[] = [], nrm: number[] = [];
    for (const l of landPolys) {
      const p = l.pts, n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
        if (Math.abs(ax) > 30000 || Math.abs(bx) > 30000) continue;
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
        const b = pos.length / 3;
        pos.push(ax, 0, az, bx, 0, bz, bx, -2.6, bz, ax, -2.6, az);
        for (let k = 0; k < 4; k++) nrm.push(dz / L, 0, -dx / L);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    const m = extendMaterial(new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.9, side: THREE.DoubleSide }), { key: 'seawall' });
    group.add(new THREE.Mesh(g, m));
  }

  // ---- water
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    uniforms: {
      uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogParams: U.uFogParams, uSunDir: U.uSunDir,
      uSkyZenith: U.uSkyZenith, uSkyHorizon: U.uSkyHorizon, uSunColor: U.uSunColor, uNight: U.uNight, uTime: U.uTime,
      uSnow: U.uSnow, uWet: U.uWet, uReflTex: U.uReflTex, uReflMatrix: U.uReflMatrix, uReflOn: { value: 0 },
    },
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(FAR * 2, FAR * 2).rotateX(-Math.PI / 2), waterMaterial);
  water.position.y = -1.6;
  water.layers.set(1);
  water.name = 'water';
  group.add(water);

  // ---- parks
  const parkMat = extendMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  }), { key: 'park', fSurface: PARK_SURFACE });
  const parks = new THREE.Mesh(triangulate(data.parks.map((p) => p.pts), 0.04), parkMat);
  parks.receiveShadow = true;
  parks.layers.set(1);
  group.add(parks);
  for (const p of data.parks) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.pts.length; i += 2) { minX = Math.min(minX, p.pts[i]); maxX = Math.max(maxX, p.pts[i]); minZ = Math.min(minZ, p.pts[i + 1]); maxZ = Math.max(maxZ, p.pts[i + 1]); }
    grid.fillPoly(grid.occ, p.pts, minX, maxX, minZ, maxZ);
  }

  // ---- roads
  const roadMat = extendMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  }), {
    key: 'road', uniforms: reflUniforms, defines: { FORGE_REFL: 1 },
    vPars: 'attribute vec4 aRoad; attribute vec2 aRUv; attribute vec3 aRoad2; varying vec4 vRoad; varying vec2 vRUv; varying vec3 vRoad2;',
    vMain: 'vRoad = aRoad; vRUv = aRUv; vRoad2 = aRoad2;',
    fPars: REFL_PARS + ROAD_PARS + '\nvarying vec4 vRoad; varying vec2 vRUv; varying vec3 vRoad2;',
    fSurface: ROAD_SURFACE,
  });
  reflMaterials.push(roadMat);
  // junction geometry shared with the sidewalks and props: where each crossing roadway's kerb line meets this one
  const { roads, J: junctions } = streetNet(data.roads);
  const TILE = 2500;
  const tiles = new Map<string, { pos: number[]; ruv: number[]; road: number[]; road2: number[]; idx: number[] }>();
  roads.forEach((r, ri) => {
    const n = r.pts.length / 2;
    const halfW = r.w / 2;
    let len = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) { len += Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]); cum.push(len); }
    if (len < 1) return;
    const inset = (e: 0 | 1) => { const v = junctions.roadInset(ri, e); return v < 0 ? -1 : Math.min(v, len * 0.45); };
    const i0 = inset(0), i1 = inset(1);
    const dir = roadDir(r), kind = laneKind(r), seed = Math.floor(hash2(ri, 91) * 61);
    const tk = `${Math.floor(r.pts[0] / TILE)},${Math.floor(r.pts[1] / TILE)}`;
    if (!tiles.has(tk)) tiles.set(tk, { pos: [], ruv: [], road: [], road2: [], idx: [] });
    const t = tiles.get(tk)!;
    const base = t.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
      const px = r.pts[Math.max(0, i - 1) * 2], pz = r.pts[Math.max(0, i - 1) * 2 + 1];
      const qx = r.pts[Math.min(n - 1, i + 1) * 2], qz = r.pts[Math.min(n - 1, i + 1) * 2 + 1];
      let dx = qx - px, dz = qz - pz; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx;
      t.pos.push(x + nx * halfW, 0.05, z + nz * halfW, x - nx * halfW, 0.05, z - nz * halfW);
      t.ruv.push(halfW, cum[i], -halfW, cum[i]);
      t.road.push(halfW, len, i0, i1, halfW, len, i0, i1);
      t.road2.push(dir, seed, kind, dir, seed, kind);
      if (i < n - 1) { const a = base + i * 2; t.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      // raster the roadway into the grid
      if (i < n - 1) {
        const sx = r.pts[(i + 1) * 2] - x, sz = r.pts[(i + 1) * 2 + 1] - z, sl = Math.hypot(sx, sz);
        for (let s = 0; s <= sl; s += 2.5) grid.stamp(grid.road, x + (sx / sl) * s, z + (sz / sl) * s, halfW);
      }
    }
  });
  for (const t of tiles.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    const nrm = new Float32Array(t.pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aRUv', new THREE.Float32BufferAttribute(t.ruv, 2));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(t.road, 4));
    g.setAttribute('aRoad2', new THREE.Float32BufferAttribute(t.road2, 3));
    g.setIndex(t.idx);
    const m = new THREE.Mesh(g, roadMat);
    m.receiveShadow = true;
    m.layers.set(1);
    group.add(m);
  }

  // ---- raised sidewalks & granite kerbs along Manhattan streets
  const swMat = sidewalkMaterial(REFL_PARS, reflUniforms);
  reflMaterials.push(swMat);
  for (const m of buildSidewalks(roads, junctions, swMat, TILE)) group.add(m);

  // ---- occupancy from real buildings
  for (const b of data.buildings) grid.fillPoly(grid.occ, b.pts, b.minX, b.maxX, b.minZ, b.maxZ);

  const isLand = (x: number, z: number) => {
    for (const l of landPolys) if (pointInPoly(x, z, l.pts)) return true;
    return false;
  };
  return { group, grid, landPolys, waterMaterial, reflMaterials, isLand };
}

// ---- trees: see trees.ts (branching trunk + leaf-card canopy, three species, three LODs)
export { buildTrees } from './trees';
