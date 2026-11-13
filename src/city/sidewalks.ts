import * as THREE from 'three';
import { CURB_H, RoadRec } from './geo';
import { analyseJunctions, hasSidewalk, Junctions, swFlat, SW_RAMP } from './streets';
import { extendMaterial } from '../engine/materials';
import { hash2 } from '../util/rng';

/**
 * Raised concrete sidewalks with granite kerbs along Manhattan streets. Each side of each street is a strip:
 * a vertical kerb face from road level to CURB_H, a flat walk, and a shallow ramp back to grade (so plazas and
 * building bases never show a back step). Strips stop where crossing roadways begin (see streets.ts).
 */

export const SIDEWALK_SURFACE = /* glsl */ `
{
  vec2 wp = vFogWorld.xz;
  float u = vSW.x, w = vSW.y, flatW = vSW2.x, seed = vSW2.y;
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  float face = 1.0 - smoothstep(0.55, 0.75, wN.y);
  float capD = min(u - vSW.z, vSW.w - u);
  float fw = max(fwidth(u), fwidth(w)) + 1e-4;               // metres per pixel
  float detail = 1.0 - smoothstep(0.025, 0.1, fw);
  float kerbW = 0.36;
  float kerb = max(face, 1.0 - smoothstep(kerbW - fw, kerbW, min(w, capD)));
  float grain = vnoise(wp * 7.0) * 0.5 + vnoise(wp * 23.0) * 0.5;

  // ---- concrete flags (5 ft squares) aligned to the kerb
  vec2 fl = vec2(u, w - kerbW) / 1.52;
  vec2 fid = floor(fl), ff = fract(fl);
  float fh = h21(fid + seed);
  vec3 conc = vec3(0.4, 0.392, 0.375) * (0.86 + 0.18 * fh);
  conc = mix(conc, vec3(0.40, 0.395, 0.38), step(0.84, fh));              // older replaced flags
  conc = mix(conc, vec3(0.56, 0.55, 0.52), step(0.94, h21(fid + seed + 7.1)));  // fresh pour
  float st = fbm2(wp * 0.3 + seed * 0.1);
  conc *= 0.72 + 0.36 * smoothstep(0.2, 0.8, st);
  conc *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 1.2, w)) * (0.6 + 0.4 * vnoise(wp * 0.9));   // kerbside grime
  conc *= 1.0 - 0.24 * smoothstep(0.6, 0.78, vnoise(wp * 1.1 + 3.0)) * (0.5 + 0.5 * vnoise(wp * 6.0));   // stains, drips
  conc *= 0.9 + 0.16 * mix(0.5, grain, detail);
  vec2 jd = min(ff, 1.0 - ff) * 1.52;
  float joint = 1.0 - smoothstep(0.004, 0.012 + fw * 0.8, min(jd.x, jd.y));
  conc *= 1.0 - 0.42 * joint * (1.0 - smoothstep(0.03, 0.15, fw));
  // hairline cracks in some flags
  float crk = abs(vnoise(fl * 2.4 + fid * 3.7) - 0.5);
  conc *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.015 + fw * 0.6, crk)) * step(0.72, h21(fid + 3.3)) * detail;
  // chewing gum and dark spots
  vec2 gc = wp * 2.4; vec2 gi = floor(gc); vec2 gf = fract(gc) - 0.5 - (vec2(h21(gi + 2.0), h21(gi + 5.0)) - 0.5) * 0.6;
  float gum = step(0.9, h21(gi + 11.0)) * (1.0 - smoothstep(0.03, 0.06, length(gf)));
  conc = mix(conc, vec3(0.16, 0.16, 0.16), gum * 0.55 * detail);
  // the ramp back to grade blends into the plaza paving tone
  float rough = 0.86;
  float metal = 0.0;

  // ---- cellar doors (steel diamond plate) and sidewalk vault grates near the building line
  float door = 0.0, grate = 0.0;
  if (flatW > 3.3) {
    float cell = floor(u / 13.0);
    float cu = u - cell * 13.0;
    float hd = h21(vec2(cell, seed + 4.0));
    if (hd < 0.3) {
      float d0 = 5.0 + hd * 12.0;
      vec2 q = vec2(cu - d0, w - (flatW - 1.15));
      door = step(abs(q.x), 0.9) * step(abs(q.y), 0.78);
      float plate = step(0.5, fract((u + w) * 9.0)) * 0.5 + step(0.5, fract((u - w) * 9.0)) * 0.5;
      vec3 steel = vec3(0.17, 0.165, 0.16) * (0.75 + 0.5 * vnoise(wp * 5.0));
      steel = mix(steel, vec3(0.32, 0.18, 0.1), 0.35 * smoothstep(0.55, 0.8, vnoise(wp * 3.0 + 9.0)));   // rust
      steel *= 0.9 + 0.2 * mix(0.5, plate, detail * 0.8);
      float seam = 1.0 - smoothstep(0.0, 0.015 + fw, abs(q.x));
      steel *= 1.0 - 0.6 * seam * detail;
      float rim = 1.0 - smoothstep(0.0, 0.03 + fw, min(0.9 - abs(q.x), 0.78 - abs(q.y)));
      steel *= 1.0 - 0.4 * rim;
      conc = mix(conc, steel, door);
      rough = mix(rough, 0.55, door); metal = mix(metal, 0.65, door);
    } else if (hd > 0.9 && flatW > 3.9) {
      vec2 q = vec2(cu - 6.5, w - flatW * 0.55);
      grate = step(abs(q.x), 1.6) * step(abs(q.y), 0.62);
      float bars = 1.0 - smoothstep(0.25, 0.45, abs(fract(q.y * 14.0) - 0.5) * 2.0);
      bars = mix(0.45, bars, detail);
      vec3 g = mix(vec3(0.02), vec3(0.2, 0.19, 0.18), bars);
      conc = mix(conc, g, grate);
      rough = mix(rough, 0.6, grate); metal = mix(metal, 0.7 * bars, grate);
    }
  }

  // ---- granite kerb stones
  float sid = floor(u / 2.3 + seed);
  vec3 gran = vec3(0.52, 0.515, 0.5) * (0.86 + 0.16 * h21(vec2(sid, seed)));
  gran *= 0.86 + 0.28 * mix(0.5, vnoise(wp * 45.0) * 0.6 + vnoise(wp * 13.0) * 0.4, detail);
  float sj = 1.0 - smoothstep(0.004, 0.01 + fw, abs(fract(u / 2.3 + seed) - 0.5) * 2.3 - 1.135);
  gran *= 1.0 - 0.35 * sj * detail;
  // traffic grime creeps up the face, the arris is polished by feet and tyres
  gran *= mix(0.5, 1.0, smoothstep(-0.16, -0.02, w));
  gran *= 1.0 + 0.12 * (1.0 - smoothstep(0.0, 0.06, abs(w)));
  vec3 col = mix(conc, gran, kerb);
  rough = mix(rough, 0.7, kerb);

  // ---- snow: shovelled path down the middle, banks along the kerb and building line
  float sn = vnoise(wp * 0.7) * 0.5 + vnoise(wp * 4.1) * 0.5;
  float path = smoothstep(0.7, 1.5, w) * (1.0 - smoothstep(flatW - 1.4, flatW - 0.5, w));
  float sAmt = uSnow * (1.0 - 0.8 * path * smoothstep(0.3, 0.7, uSnow)) * (1.0 - 0.6 * face);
  float snow = smoothstep(0.08, 0.5, sAmt + (sn - 0.5) * 0.45 * uSnow);
  col = mix(col, vec3(0.6, 0.6, 0.6) * col + 0.12, path * uSnow * 0.5);   // salt crust on the shovelled path
  col = mix(col, vec3(0.84, 0.87, 0.93) * (0.92 + 0.08 * sn), snow);
  rough = mix(rough, 0.9, snow);

  // ---- rain: darkened concrete, shallow puddles by the kerb and in sunken flags
  float wet = uWet * (1.0 - snow);
  float puddle = smoothstep(0.52, 0.72, vnoise(wp * 0.5 + 2.0) * 0.7 + vnoise(wp * 2.3) * 0.3 + 0.3 * (1.0 - smoothstep(0.2, 1.0, w)) + 0.15 * step(0.84, fh)) * (1.0 - face);
  col *= 1.0 - wet * (0.42 - 0.12 * metal);
  diffuseColor.rgb = col;
  roughnessFactor = mix(rough, mix(0.32, 0.05, puddle), wet);
  metalnessFactor = metal * (1.0 - snow);

  // ---- night: lamp pools (in step with the poles and the road shader) and warm shop-window spill
  float seg = u / 31.0; float ph = fract(seg) - 0.5;
  float lside = mod(floor(seg), 2.0) * 2.0 - 1.0;
  float pool = exp(-ph * ph * 31.0 * 31.0 / 70.0) * exp(-(w - 1.0) * (w - 1.0) / 9.0) * (lside == vSW2.z ? 1.0 : 0.25);
  vec3 lampC = mix(vec3(1.0, 0.62, 0.3), vec3(0.85, 0.92, 1.0), step(0.6, h21(vec2(floor(vSW2.w), 2.0))));
  float shop = smoothstep(flatW - 2.5, flatW, w) * (0.4 + 0.6 * vnoise(vec2(u * 0.15, seed)));
  totalEmissiveRadiance += min(col, vec3(0.7)) * (lampC * (0.08 + 1.1 * pool) + vec3(1.0, 0.75, 0.5) * shop * 0.25) * uNight;
  #ifdef FORGE_REFL
  if (uReflStrength > 0.001) {
    vec3 Vv = normalize(cameraPosition - vFogWorld);
    float fres = 0.04 + 0.96 * pow(1.0 - max(Vv.y, 0.0), 4.0);
    vec2 dn = (vec2(vnoise(wp * 13.0), vnoise(wp * 13.0 + 19.0)) - 0.5) * (1.0 - 0.85 * puddle);
    vec3 rf = planarRefl(vFogWorld, dn * vec2(0.004, 0.02));
    totalEmissiveRadiance += min(rf, vec3(24.0)) * fres * wet * uReflStrength * (0.05 + 0.75 * puddle) * (1.0 - face);
  }
  #endif
}
`;

/** Segment hash of all roadways so a sidewalk never spills over a neighbouring carriageway (medians, slip roads). */
class RoadIndex {
  private cells = new Map<number, number[]>();   // flat [ri, ax, az, bx, bz, h, ...]
  private readonly C = 32;
  constructor(roads: RoadRec[]) {
    roads.forEach((r, ri) => {
      const n = r.pts.length / 2, h = r.w / 2;
      for (let i = 0; i < n - 1; i++) {
        const ax = r.pts[i * 2], az = r.pts[i * 2 + 1], bx = r.pts[i * 2 + 2], bz = r.pts[i * 2 + 3];
        const x0 = Math.floor((Math.min(ax, bx) - h) / this.C), x1 = Math.floor((Math.max(ax, bx) + h) / this.C);
        const z0 = Math.floor((Math.min(az, bz) - h) / this.C), z1 = Math.floor((Math.max(az, bz) + h) / this.C);
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
          const k = cx * 100003 + cz;
          let l = this.cells.get(k);
          if (!l) { l = []; this.cells.set(k, l); }
          l.push(ri, ax, az, bx, bz, h);
        }
      }
    });
  }
  /** is (x,z) inside a roadway other than `self`, by at least `margin` metres? */
  inside(x: number, z: number, self: number, margin: number) {
    const l = this.cells.get(Math.floor(x / this.C) * 100003 + Math.floor(z / this.C));
    if (!l) return false;
    for (let i = 0; i < l.length; i += 6) {
      if (l[i] === self) continue;
      const ax = l[i + 1], az = l[i + 2], dx = l[i + 3] - ax, dz = l[i + 4] - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const ex = ax + dx * t - x, ez = az + dz * t - z;
      const h = l[i + 5] - margin;
      if (h > 0 && ex * ex + ez * ez < h * h) return true;
    }
    return false;
  }
}

interface Acc { pos: number[]; nrm: number[]; sw: number[]; sw2: number[]; idx: number[] }

export function buildSidewalks(roads: RoadRec[], junctions: Junctions | null, material: THREE.Material, tile = 2500): THREE.Mesh[] {
  const J = junctions ?? analyseJunctions(roads);
  const index = new RoadIndex(roads);
  const tiles = new Map<string, Acc>();
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const tri = (t: Acc, a: number, b: number, c: number, nx: number, ny: number, nz: number) => {
    // wind every triangle to face its intended normal
    v0.fromArray(t.pos, a * 3); v1.fromArray(t.pos, b * 3).sub(v0); v2.fromArray(t.pos, c * 3).sub(v0);
    const cx = v1.y * v2.z - v1.z * v2.y, cy = v1.z * v2.x - v1.x * v2.z, cz = v1.x * v2.y - v1.y * v2.x;
    if (cx * nx + cy * ny + cz * nz < 0) t.idx.push(a, c, b); else t.idx.push(a, b, c);
  };

  roads.forEach((r, ri) => {
    if (!hasSidewalk(r) || r.pts.length < 4) return;
    const n = r.pts.length / 2, halfW = r.w / 2;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]));
    const len = cum[n - 1];
    if (len < 2) return;
    const tk = `${Math.floor(r.pts[0] / tile)},${Math.floor(r.pts[1] / tile)}`;
    let t = tiles.get(tk);
    if (!t) { t = { pos: [], nrm: [], sw: [], sw2: [], idx: [] }; tiles.set(tk, t); }
    const flat0 = swFlat(halfW);
    const seed = Math.floor(hash2(ri, 77) * 97);
    // point & tangent at distance s along the polyline
    const at = (s: number) => {
      let i = 0;
      while (i < n - 2 && cum[i + 1] < s) i++;
      const sl = cum[i + 1] - cum[i] || 1, f = Math.max(0, Math.min(1, (s - cum[i]) / sl));
      const ax = r.pts[i * 2], az = r.pts[i * 2 + 1], bx = r.pts[i * 2 + 2], bz = r.pts[i * 2 + 3];
      return [ax + (bx - ax) * f, az + (bz - az) * f];
    };
    const tangent = (i: number) => {
      const px = r.pts[Math.max(0, i - 1) * 2], pz = r.pts[Math.max(0, i - 1) * 2 + 1];
      const qx = r.pts[Math.min(n - 1, i + 1) * 2], qz = r.pts[Math.min(n - 1, i + 1) * 2 + 1];
      const dx = qx - px, dz = qz - pz, L = Math.hypot(dx, dz) || 1;
      return [dx / L, dz / L];
    };
    for (const side of [1, -1] as const) {
      const a = J.sidewalkStart(ri, 0, side), b = J.sidewalkStart(ri, 1, side);
      const s0 = a.s, s1 = len - b.s;
      if (s1 - s0 < 1.5) continue;
      // samples: trimmed ends plus interior vertices (long straight runs are subdivided so the width probe can follow medians)
      const samples: { s: number; i: number }[] = [{ s: s0, i: -1 }];
      for (let i = 1; i < n - 1; i++) if (cum[i] > s0 + 0.3 && cum[i] < s1 - 0.3) samples.push({ s: cum[i], i });
      samples.push({ s: s1, i: -1 });
      for (let k = 0; k < samples.length - 1; k++) {
        const gap = samples[k + 1].s - samples[k].s;
        if (gap > 24) {
          const m = Math.ceil(gap / 20);
          const extra = [];
          for (let j = 1; j < m; j++) extra.push({ s: samples[k].s + (gap * j) / m, i: -1 });
          samples.splice(k + 1, 0, ...extra);
          k += extra.length;
        }
      }
      const base0 = t.pos.length / 3;
      const capS = a.cap ? s0 : -1e4, capE = b.cap ? s1 : 1e4;
      for (const smp of samples) {
        let cx: number, cz: number, tx: number, tz: number;
        if (smp.i >= 0) { cx = r.pts[smp.i * 2]; cz = r.pts[smp.i * 2 + 1]; [tx, tz] = tangent(smp.i); }
        else {
          [cx, cz] = at(smp.s);
          let i = 0; while (i < n - 2 && cum[i + 1] < smp.s) i++;
          const dx = r.pts[i * 2 + 2] - r.pts[i * 2], dz = r.pts[i * 2 + 3] - r.pts[i * 2 + 1], L = Math.hypot(dx, dz) || 1;
          tx = dx / L; tz = dz / L;
        }
        const nx = -tz * side, nz = tx * side;
        // clamp the width where another carriageway runs alongside
        let oMax = halfW + flat0 + SW_RAMP;
        for (let o = halfW + 0.6; o < oMax; o += 0.8) {
          if (index.inside(cx + nx * o, cz + nz * o, ri, 0.25)) { oMax = Math.max(halfW + 0.5, o - 0.6); break; }
        }
        const flat = Math.min(flat0, oMax - halfW);
        const ramp = Math.max(0.02, Math.min(SW_RAMP, oMax - halfW - flat));
        const P = (o: number, y: number) => [cx + nx * o, y, cz + nz * o];
        const K0 = P(halfW, 0), K1 = P(halfW, CURB_H), F = P(halfW + flat, CURB_H), R = P(halfW + flat + ramp, 0);
        const rl = Math.hypot(ramp, CURB_H);
        const rn = [nx * CURB_H / rl, ramp / rl, nz * CURB_H / rl];
        t.pos.push(...K0, ...K1, ...K1, ...F, ...R);
        t.nrm.push(-nx, 0, -nz, -nx, 0, -nz, 0, 1, 0, 0, 1, 0, ...rn);
        t.sw.push(smp.s, -CURB_H, capS, capE, smp.s, 0, capS, capE, smp.s, 0, capS, capE, smp.s, flat, capS, capE, smp.s, flat + ramp, capS, capE);
        for (let q = 0; q < 5; q++) t.sw2.push(flat, seed, side, len);
      }
      const cnt = samples.length;
      for (let k = 0; k < cnt - 1; k++) {
        const A = base0 + k * 5, B = A + 5;
        const nx = t.nrm[A * 3], nz = t.nrm[A * 3 + 2];
        tri(t, A, B, A + 1, nx, 0, nz); tri(t, A + 1, B, B + 1, nx, 0, nz);                 // kerb face
        tri(t, A + 2, B + 2, A + 3, 0, 1, 0); tri(t, A + 3, B + 2, B + 3, 0, 1, 0);         // walk
        tri(t, A + 3, B + 3, A + 4, 0, 1, 0); tri(t, A + 4, B + 3, B + 4, 0, 1, 0);         // ramp
      }
      // kerb faces across the ends that front a crossing roadway
      const cap = (k: number, dir: number, s: number) => {
        const A = base0 + k * 5;
        const [tx, tz] = (() => { const p = at(Math.max(0, s - 0.5)), q = at(Math.min(len, s + 0.5)); const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1; return [dx / L * dir, dz / L * dir]; })();
        const c0 = t.pos.length / 3;
        for (const vi of [A, A + 1, A + 3, A + 4]) {
          t.pos.push(t.pos[vi * 3], t.pos[vi * 3 + 1], t.pos[vi * 3 + 2]);
          t.nrm.push(tx, 0, tz);
          t.sw.push(s, -CURB_H * (vi === A || vi === A + 4 ? 1 : 0), s, s);
          t.sw2.push(t.sw2[vi * 4], seed, side, len);
        }
        tri(t, c0, c0 + 1, c0 + 2, tx, 0, tz); tri(t, c0, c0 + 2, c0 + 3, tx, 0, tz);
      };
      if (a.cap) cap(0, -1, s0);
      if (b.cap) cap(cnt - 1, 1, s1);
    }
  });

  const meshes: THREE.Mesh[] = [];
  for (const t of tiles.values()) {
    if (!t.idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nrm, 3));
    g.setAttribute('aSW', new THREE.Float32BufferAttribute(t.sw, 4));
    g.setAttribute('aSW2', new THREE.Float32BufferAttribute(t.sw2, 4));
    g.setIndex(t.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    m.layers.set(1);
    m.name = 'sidewalk';
    meshes.push(m);
  }
  return meshes;
}

export function sidewalkMaterial(reflPars: string, reflUniforms: Record<string, THREE.IUniform>) {
  return extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), {
    key: 'sidewalk', uniforms: reflUniforms, defines: { FORGE_REFL: 1 },
    vPars: 'attribute vec4 aSW; attribute vec4 aSW2; varying vec4 vSW; varying vec4 vSW2;',
    vMain: 'vSW = aSW; vSW2 = aSW2;',
    fPars: reflPars + '\nvarying vec4 vSW; varying vec4 vSW2;',
    fSurface: SIDEWALK_SURFACE,
  });
}
