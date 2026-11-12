import * as THREE from 'three';
import earcut from 'earcut';
import { CityData, ll, GRID_ANGLE, pointInPoly, PolyRec } from './geo';
import { extendMaterial, U, GLSL_NOISE } from '../engine/materials';
import { hash2, mulberry32 } from '../util/rng';

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
    vec2 dn = (vec2(vnoise(wp * 2.3), vnoise(wp * 2.3 + 19.0)) - 0.5);
    vec3 rf = planarRefl(vFogWorld, dn * vec2(0.012, 0.03));
    totalEmissiveRadiance += rf * fres * wet * uReflStrength * (0.25 + 0.75 * puddle);
  }
  #endif
}
`;

const ROAD_SURFACE = /* glsl */ `
{
  vec2 wp = vFogWorld.xz;
  float halfW = vRoad.x, len = vRoad.y;
  float x = vRUv.x, v = vRUv.y;
  float dist = length(cameraPosition - vFogWorld);
  float near = 1.0 - smoothstep(120.0, 420.0, dist);
  float n = vnoise(wp * 0.35) * 0.55 + vnoise(wp * 2.9) * 0.45;
  vec3 col = vec3(0.058, 0.06, 0.064) * (0.75 + 0.6 * n);
  col = mix(col, col * 1.35, smoothstep(0.55, 0.8, vnoise(wp * 0.06 + 11.0)) * 0.6);   // resurfaced patches
  float eS = vRoad.z < 0.0 ? 1000.0 : v - vRoad.z;
  float eE = vRoad.w < 0.0 ? 1000.0 : (len - vRoad.w) - v;
  float e = min(eS, eE);
  float paint = 0.0;
  float ax = abs(x);
  if (e > 0.0) {
    float lanes = max(1.0, floor((halfW * 2.0 - 4.2) / 3.3 + 0.5));
    float drive = halfW - 2.2;
    if (lanes > 1.5 && ax < drive) {
      float lw = (drive * 2.0) / lanes;
      float lx = fract((x + drive) / lw);
      float line = 1.0 - smoothstep(0.06, 0.1, min(lx, 1.0 - lx) * lw);
      float dash = step(fract(v / 9.0), 0.34);
      float edge = step(lw * 0.5, x + drive) * step(x + drive, drive * 2.0 - lw * 0.5);
      paint = max(paint, line * dash * edge * step(7.0, e));
    }
    // zebra crossing & stop bar
    float zebra = step(0.9, e) * step(e, 4.2) * step(ax, halfW - 0.7) * step(fract(x / 1.25), 0.5);
    float stopb = step(5.2, e) * step(e, 5.65) * step(ax, halfW - 0.4) * step(eS < eE ? x : -x, 0.0) * step(4.0, halfW);
    paint = max(paint, max(zebra, stopb) * step(3.4, halfW));
  }
  paint *= near * (0.55 + 0.45 * vnoise(wp * 3.7));
  col = mix(col, vec3(0.62, 0.62, 0.58), paint);
  // gutter / curb edge
  float curb = smoothstep(halfW - 0.32, halfW - 0.2, ax);
  col = mix(col, vec3(0.3, 0.3, 0.29) * (0.8 + 0.3 * n), curb);
  // snow with darker wheel tracks
  float track = smoothstep(0.25, 0.5, abs(fract(x / 3.3) - 0.5)) ;
  float snow = smoothstep(0.05, 0.6, uSnow * (0.55 + 0.75 * track) + (n - 0.5) * 0.25 * uSnow);
  col = mix(col, vec3(0.8, 0.84, 0.9) * (0.82 + 0.18 * n), snow);
  float wet = uWet * (1.0 - snow);
  float puddle = smoothstep(0.45, 0.7, vnoise(wp * 0.27 + 3.0) + 0.25 * curb);
  col *= 1.0 - 0.45 * wet * (1.0 - paint);
  diffuseColor.rgb = col;
  roughnessFactor = mix(mix(0.88, mix(0.3, 0.05, puddle), wet), 0.85, snow);
  metalnessFactor = 0.0;
  // sodium / LED street-lamp pools alternate along both kerbs
  float seg = v / 31.0; float ph = fract(seg) - 0.5;
  float side = mod(floor(seg), 2.0) * 2.0 - 1.0;
  float pool = exp(-(ph * ph) * 31.0 * 31.0 / 150.0) * exp(-pow((x - side * halfW * 0.8) / (halfW * 0.9 + 2.0), 2.0));
  vec3 lampC = mix(vec3(1.0, 0.62, 0.3), vec3(0.85, 0.92, 1.0), step(0.6, h21(vec2(floor(len), 2.0))));
  totalEmissiveRadiance += (col + 0.012) * lampC * uNight * (0.35 + 2.4 * pool);
  #ifdef FORGE_REFL
  if (uReflStrength > 0.001) {
    vec3 Vv = normalize(cameraPosition - vFogWorld);
    float fres = 0.05 + 0.95 * pow(1.0 - max(Vv.y, 0.0), 3.5);
    vec2 dn = (vec2(vnoise(wp * 1.9), vnoise(wp * 1.9 + 31.0)) - 0.5) + (vec2(vnoise(wp * 9.0), vnoise(wp * 9.0 + 5.0)) - 0.5) * 0.35;
    vec3 rf = planarRefl(vFogWorld, dn * vec2(0.01, 0.045));
    totalEmissiveRadiance += rf * fres * wet * uReflStrength * (0.45 + 0.55 * puddle);
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
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  float sd = max(dot(R, uSunDir), 0.0);
  sky += uFogSunColor * pow(sd, 8.0) * 0.5 * uFogParams.w;
  vec3 refl = sky;
  if (uReflOn > 0.5) {
    vec4 rc = uReflMatrix * vec4(vFogWorld.x, 0.0, vFogWorld.z, 1.0);
    rc.xy += N.xz * vec2(0.035, 0.11) * rc.w;
    vec3 pr = texture2DProj(uReflTex, rc).rgb;
    refl = mix(pr, sky, smoothstep(0.0, 0.5, length(N.xz) * 1.6));
  }
  vec3 deep = uSkyZenith * 0.16 + vec3(0.004, 0.014, 0.018) * (1.0 - uNight * 0.85);
  deep = mix(deep, vec3(0.05, 0.065, 0.06) * (1.0 - uNight * 0.8), 0.35);     // estuary silt
  vec3 col = mix(deep, refl, fres);
  // sun / moon glitter
  float glit = pow(sd, 380.0) * 26.0 + pow(sd, 60.0) * 0.6;
  col += uSunColor * glit * (0.35 + 0.65 * vnoise(p * 0.9 + uTime * 0.6));
  // ice floes when it snows
  float ice = smoothstep(0.62, 0.7, vnoise(p * 0.012) * 0.6 + vnoise(p * 0.08) * 0.4) * smoothstep(0.5, 1.0, uSnow);
  col = mix(col, vec3(0.7, 0.75, 0.82) * (uSkyHorizon * 0.6 + 0.25), ice * 0.7);
  gl_FragColor = vec4(applyCityFog(col), 1.0);
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
    vPars: 'attribute vec4 aRoad; attribute vec2 aRUv; varying vec4 vRoad; varying vec2 vRUv;',
    vMain: 'vRoad = aRoad; vRUv = aRUv;',
    fPars: REFL_PARS + '\nvarying vec4 vRoad; varying vec2 vRUv;',
    fSurface: ROAD_SURFACE,
  });
  reflMaterials.push(roadMat);
  const roads = data.roads.filter((r) => r.t !== 3 && r.pts.length >= 4);
  // node → widest half-widths meeting there
  const nodes = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.round(x / 1.5)},${Math.round(z / 1.5)}`;
  for (const r of roads) {
    const n = r.pts.length / 2;
    for (const e of [0, n - 1]) {
      const k = key(r.pts[e * 2], r.pts[e * 2 + 1]);
      if (!nodes.has(k)) nodes.set(k, []);
      nodes.get(k)!.push(r.w / 2);
    }
  }
  const TILE = 2500;
  const tiles = new Map<string, { pos: number[]; ruv: number[]; road: number[]; idx: number[] }>();
  for (const r of roads) {
    const n = r.pts.length / 2;
    const halfW = r.w / 2;
    let len = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) { len += Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]); cum.push(len); }
    if (len < 1) continue;
    const inset = (e: number) => {
      const list = nodes.get(key(r.pts[e * 2], r.pts[e * 2 + 1]))!;
      if (list.length < 3) return -1;
      // widest *other* road at this node
      const sorted = [...list].sort((a, b) => b - a);
      const other = sorted[0] === halfW ? sorted[1] : sorted[0];
      return Math.min(other, len * 0.45);
    };
    const i0 = inset(0), i1 = inset(n - 1);
    const tk = `${Math.floor(r.pts[0] / TILE)},${Math.floor(r.pts[1] / TILE)}`;
    if (!tiles.has(tk)) tiles.set(tk, { pos: [], ruv: [], road: [], idx: [] });
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
      if (i < n - 1) { const a = base + i * 2; t.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      // raster the roadway into the grid
      if (i < n - 1) {
        const sx = r.pts[(i + 1) * 2] - x, sz = r.pts[(i + 1) * 2 + 1] - z, sl = Math.hypot(sx, sz);
        for (let s = 0; s <= sl; s += 2.5) grid.stamp(grid.road, x + (sx / sl) * s, z + (sz / sl) * s, halfW);
      }
    }
  }
  for (const t of tiles.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    const nrm = new Float32Array(t.pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aRUv', new THREE.Float32BufferAttribute(t.ruv, 2));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(t.road, 4));
    g.setIndex(t.idx);
    const m = new THREE.Mesh(g, roadMat);
    m.receiveShadow = true;
    m.layers.set(1);
    group.add(m);
  }

  // ---- occupancy from real buildings
  for (const b of data.buildings) grid.fillPoly(grid.occ, b.pts, b.minX, b.maxX, b.minZ, b.maxZ);

  const isLand = (x: number, z: number) => {
    for (const l of landPolys) if (pointInPoly(x, z, l.pts)) return true;
    return false;
  };
  return { group, grid, landPolys, waterMaterial, reflMaterials, isLand };
}

// ---- trees ---------------------------------------------------------------------

function treeGeometry(): THREE.BufferGeometry {
  // lumpy canopy + trunk, merged; vertex colours darken the underside for cheap AO
  const canopy = new THREE.IcosahedronGeometry(1, 1);
  const p = canopy.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  const pos: number[] = [], nor: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.78 + 0.44 * hash2(Math.round(v.x * 50) + 7, Math.round(v.y * 50 + v.z * 91));
    v.multiplyScalar(k); v.y = v.y * 0.85 + 1.75;
    pos.push(v.x, v.y, v.z);
    const sh = 0.45 + 0.55 * Math.min(1, Math.max(0, (v.y - 0.9) / 1.6));
    col.push(sh, sh, sh);
  }
  const g = new THREE.BufferGeometry();
  // trunk (4 sides)
  const tr = 0.09;
  const trunk = [[-tr, -tr], [tr, -tr], [tr, tr], [-tr, tr]];
  const idx: number[] = [];
  for (let i = 0; i < p.count; i += 3) idx.push(i, i + 1, i + 2);
  const base = pos.length / 3;
  for (let i = 0; i < 4; i++) {
    const a = trunk[i], b = trunk[(i + 1) % 4];
    const o = pos.length / 3;
    pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], 1.3, b[1], a[0], 1.3, a[1]);
    for (let k = 0; k < 4; k++) col.push(0.2, 0.15, 0.1);
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  void base;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // smooth, spherical canopy normals (soft shading instead of facets)
  const na = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { v.set(pos[i * 3], pos[i * 3 + 1] - 1.6, pos[i * 3 + 2]).normalize(); na.setXYZ(i, v.x, v.y, v.z); }
  void nor;
  return g;
}

export function buildTrees(data: CityData, grid: CityGrid, isLand: (x: number, z: number) => boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const geo = treeGeometry();
  const mat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, vertexColors: true, flatShading: false }), { key: 'tree', weather: true });
  const TILE = 1200;
  const tiles = new Map<string, { m: THREE.Matrix4; c: THREE.Color }[]>();
  const r = mulberry32(4242);
  const add = (x: number, z: number, s: number, hue: number) => {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    if (!tiles.has(k)) tiles.set(k, []);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(s * (0.85 + 0.3 * r()), s, s * (0.85 + 0.3 * r())));
    const c = new THREE.Color().setHSL(0.2 + hue * 0.09, 0.28 + 0.18 * r(), 0.075 + 0.06 * r());
    tiles.get(k)!.push({ m, c });
  };
  // park trees
  for (const p of data.parks) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.pts.length; i += 2) { minX = Math.min(minX, p.pts[i]); maxX = Math.max(maxX, p.pts[i]); minZ = Math.min(minZ, p.pts[i + 1]); maxZ = Math.max(maxZ, p.pts[i + 1]); }
    const area = (maxX - minX) * (maxZ - minZ);
    const count = Math.min(5200, Math.floor(area / 230));
    for (let i = 0; i < count; i++) {
      const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ);
      if (!pointInPoly(x, z, p.pts) || grid.isRoad(x, z)) continue;
      // clearings: lawns stay open
      if (hash2(Math.floor(x / 60), Math.floor(z / 60)) < 0.3) continue;
      add(x, z, 3.2 + 3.4 * r(), r());
    }
  }
  // street trees along quieter streets (kerb line, both sides)
  for (const rd of data.roads) {
    if (rd.t !== 1 || rd.w > 13 || rd.b !== 1) continue;
    const n = rd.pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const ax = rd.pts[i * 2], az = rd.pts[i * 2 + 1], bx = rd.pts[i * 2 + 2], bz = rd.pts[i * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 30) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      if (hash2(Math.round(ax), Math.round(az)) < 0.35) continue;
      for (let s = 16; s < L - 14; s += 11 + r() * 9) {
        for (const side of [-1, 1]) {
          if (r() < 0.4) continue;
          const x = ax + tx * s - tz * side * (rd.w / 2 + 1.3), z = az + tz * s + tx * side * (rd.w / 2 + 1.3);
          if (grid.isOcc(x, z)) continue;
          add(x, z, 2.2 + 1.5 * r(), r());
        }
      }
    }
  }
  for (const list of tiles.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => { im.setMatrixAt(i, t.m); im.setColorAt(i, t.c); });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}
