import * as THREE from 'three';
import { CityData, CURB_H, pointInPoly } from './geo';
import type { CityGrid } from './ground';
import { extendMaterial, U } from '../engine/materials';
import { hash2, mulberry32 } from '../util/rng';
import { hasSidewalk, sidewalkRange, streetNet, TREE_W, treeSlots } from './streets';
import { HIDE_PARS, HIDE_VERT, hideDepthMaterial, LodField, LodItem } from './instLod';

/**
 * Street & park trees: a tapered trunk that forks into main limbs (plus secondary branches near the camera) and an
 * airy canopy of many small alpha-cut leaf cards clustered around the limb ends. Cards are lit with a crown-shaped
 * normal (soft volume), darker inside, translucent toward the sun. In snow most cards switch to a bare-twig pattern
 * with snow on the upper side, so winter trees read as dark lacy crowns rather than white-painted balls.
 *
 * aT = (kind: 0 bark / 1 leaf, ambient occlusion, per-card random, unused); aLUv = card uv.
 */

interface Species { H: number; clear: number; rx: number; ry: number; limbs: number; leader: boolean; vase: number; leaf: number }
const SPECIES: Species[] = [
  { H: 11, clear: 3.0, rx: 4.2, ry: 3.6, limbs: 4, leader: false, vase: 0.55, leaf: 1.0 },   // London plane
  { H: 9.5, clear: 2.7, rx: 4.0, ry: 2.8, limbs: 5, leader: false, vase: 0.85, leaf: 0.75 }, // honey locust: open vase, fine leaves
  { H: 11.5, clear: 2.8, rx: 3.0, ry: 4.6, limbs: 6, leader: true, vase: 0.35, leaf: 0.9 },  // pin oak: central leader, pyramidal
];

class TB {
  pos: number[] = []; nrm: number[] = []; t: number[] = []; uv: number[] = []; idx: number[] = [];
  v(p: THREE.Vector3, n: THREE.Vector3, kind: number, ao: number, rnd: number, u = 0, w = 0) {
    this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.t.push(kind, ao, rnd, 0); this.uv.push(u, w);
    return this.pos.length / 3 - 1;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 4));
    g.setAttribute('aLUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** tapered limb from a to b (quadratic bow toward c) */
function limb(B: TB, a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg: number, steps: number) {
  const curve = new THREE.QuadraticBezierCurve3(a, c, b);
  const base = B.pos.length / 3;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), Bn = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    curve.getPoint(u, p); curve.getTangent(u, T).normalize();
    N.set(0, 1, 0); if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
    Bn.crossVectors(T, N).normalize(); N.crossVectors(Bn, T).normalize();
    const r = r0 + (r1 - r0) * u;
    for (let k = 0; k <= seg; k++) {
      const ang = (k / seg) * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(ang)).addScaledVector(Bn, Math.sin(ang));
      B.v(p.clone().addScaledVector(n, r), n, 0, 0.6 + 0.4 * Math.min(1, p.y / 6), 0);
    }
  }
  for (let i = 0; i < steps; i++) for (let k = 0; k < seg; k++) {
    const a0 = base + i * (seg + 1) + k, b0 = a0 + seg + 1;
    B.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
  }
}

function treeGeometry(sp: Species, lod: number, seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const B = new TB();
  const seg = [6, 4, 3][lod];
  const top = new THREE.Vector3(0, sp.clear, 0);
  const cc = new THREE.Vector3(0, sp.H - sp.ry, 0);          // crown centre
  limb(B, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, sp.clear * 0.5, 0), top, 0.2, 0.14, seg + 1, lod === 2 ? 1 : 3);
  const ends: THREE.Vector3[] = [];
  const nL = lod === 2 ? Math.min(3, sp.limbs) : sp.limbs;
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * Math.PI * 2 + r() * 0.8;
    const out = sp.rx * (0.55 + 0.25 * r()) * (sp.leader ? 0.7 : 1);
    const end = new THREE.Vector3(Math.cos(a) * out, cc.y + sp.ry * (0.15 + 0.5 * r()) * (sp.leader ? 0.3 + i / nL : 1), Math.sin(a) * out);
    const start = sp.leader ? new THREE.Vector3(0, sp.clear + (sp.H - sp.clear) * 0.6 * (i / nL), 0) : top;
    const mid = start.clone().lerp(end, 0.5); mid.y += sp.vase * 1.2; mid.x *= 0.7; mid.z *= 0.7;
    limb(B, start, mid, end, sp.leader ? 0.07 : 0.11, 0.035, seg, lod === 2 ? 1 : 4);
    ends.push(end);
    if (lod === 0) for (let k = 0; k < 2; k++) {
      // secondary branches off each limb
      const s0 = start.clone().lerp(end, 0.45 + 0.3 * k);
      const dirv = new THREE.Vector3(r() - 0.5, 0.4 + r() * 0.5, r() - 0.5).normalize().multiplyScalar(1.4 + r() * 1.4);
      const e2 = s0.clone().add(dirv);
      limb(B, s0, s0.clone().lerp(e2, 0.5).add(new THREE.Vector3(0, 0.3, 0)), e2, 0.04, 0.015, 3, 2);
      ends.push(e2);
    }
  }
  if (sp.leader) { const e = new THREE.Vector3(0, sp.H - 0.6, 0); limb(B, top, new THREE.Vector3(0.1, (sp.clear + sp.H) / 2, 0), e, 0.11, 0.03, seg, 3); ends.push(e); }
  // leaf cards in clusters spread through the crown shell, denser near the limb ends
  const clusters = [58, 26, 10][lod], cards = [6, 4, 3][lod], size = [1.25, 1.9, 2.8][lod] * (0.85 + 0.15 * sp.leaf);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), ax = new THREE.Vector3(), ay = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let c = 0; c < clusters; c++) {
    const center = new THREE.Vector3();
    if (c < ends.length && r() < 0.7) center.copy(ends[c]);
    else {
      // random point in the crown, biased toward the outer shell; oaks taper toward the top
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = Math.pow(r(), 0.35);
      const s = Math.sqrt(1 - u * u);
      const taper = sp.leader ? 1 - 0.55 * Math.max(0, u) : 1;
      center.set(Math.cos(th) * s * sp.rx * rad * taper, cc.y + u * sp.ry * rad, Math.sin(th) * s * sp.rx * rad * taper);
    }
    const cr = 0.6 + 0.6 * r();
    for (let k = 0; k < cards; k++) {
      p.set((r() - 0.5) * 2, (r() - 0.5) * 1.4, (r() - 0.5) * 2).multiplyScalar(cr).add(center);
      q.setFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28));
      ax.set(1, 0, 0).applyQuaternion(q).multiplyScalar(size * (0.8 + 0.4 * r()) / 2);
      ay.set(0, 1, 0).applyQuaternion(q).multiplyScalar(size * (0.8 + 0.4 * r()) / 2);
      // crown-shaped normal: soft volume shading, slightly lifted so the top catches the sky
      n.copy(p).sub(cc).multiply(new THREE.Vector3(1 / sp.rx, 1 / sp.ry, 1 / sp.rx));
      const depth = Math.min(1, n.length());
      n.normalize().lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize();
      const ao = 0.35 + 0.65 * depth * (0.7 + 0.3 * Math.min(1, (p.y - sp.clear) / (sp.H - sp.clear)));
      const rnd = r();
      const i0 = B.v(p.clone().sub(ax).sub(ay), n, 1, ao, rnd, 0, 0), i1 = B.v(p.clone().add(ax).sub(ay), n, 1, ao, rnd, 1, 0);
      const i2 = B.v(p.clone().add(ax).add(ay), n, 1, ao, rnd, 1, 1), i3 = B.v(p.clone().sub(ax).add(ay), n, 1, ao, rnd, 0, 1);
      B.idx.push(i0, i1, i2, i0, i2, i3);
    }
  }
  return B.build();
}

const TREE_SURFACE = /* glsl */ `
{
  float leaf = step(0.5, vTT.x);
  float dist = length(cameraPosition - vFogWorld);
  float winter = step(vTT.z, uSnow * 1.15 - 0.12);
  if (leaf > 0.5) {
    // leaf clusters: jittered small leaves inside the card; far away the cut-out fills in so it does not shimmer
    vec2 uv = vLUv * 7.5;
    vec2 ci = floor(uv), cf = fract(uv) - 0.5;
    float m = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = vec2(h21(ci + o + vTT.z * 13.0), h21(ci + o + 7.7 + vTT.z * 5.0));
      vec2 d = cf - o - (h - 0.5) * 0.8;
      float a = h.x * 6.28; vec2 rd = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
      m = max(m, 1.0 - length(rd * vec2(1.0, 2.1)) / 0.42);
    }
    vec2 e = abs(vLUv - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.55, 1.0, max(e.x, e.y));
    float twig = 0.0;
    if (winter > 0.5) {
      float t1 = abs(vnoise(vLUv * 5.0 + vTT.z * 9.0) - 0.5), t2 = abs(vnoise(vLUv * 11.0 + 3.0) - 0.5);
      m = max(1.0 - t1 / 0.035, (1.0 - t2 / 0.03) * 0.8) * (1.0 - smoothstep(0.7, 1.0, length(vLUv - 0.5) * 2.0));
    }
    float thr = mix(0.25, 0.02, smoothstep(25.0, 260.0, dist));
    if (m * edge < thr) discard;
    vec3 base = diffuseColor.rgb * (0.85 + 0.3 * vTT.z);
    vec3 col = base * (0.45 + 0.55 * vTT.y);
    col = mix(col, vec3(0.1, 0.085, 0.07) * (0.6 + 0.4 * vTT.y), winter);
    normal = normalize(vNormal);
    diffuseColor.rgb = col;
    roughnessFactor = 0.8;
    // light through the leaves when looking toward the sun
    vec3 V = normalize(vFogWorld - cameraPosition);
    float tr = pow(max(dot(V, uSunDir), 0.0), 4.0) * vTT.y;
    totalEmissiveRadiance += col * uSunColor * tr * 0.35 * (1.0 - winter);
  } else {
    float bark = vnoise(vFogWorld.xz * 9.0 + vFogWorld.y * 3.0);
    diffuseColor.rgb = vec3(0.12, 0.105, 0.09) * (0.7 + 0.5 * bark) * (0.6 + 0.4 * vTT.y);
    roughnessFactor = 0.9;
  }
  metalnessFactor = 0.0;
}
`;

export function buildTrees(data: CityData, grid: CityGrid, isLand: (x: number, z: number) => boolean): THREE.Group {
  void isLand;
  const group = new THREE.Group();
  group.name = 'trees';
  const mat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }), {
    key: 'tree2', weather: true,
    uniforms: { uSunColor: U.uSunColor },
    vPars: `attribute vec4 aT; attribute vec2 aLUv; varying vec4 vTT; varying vec2 vLUv; ${HIDE_PARS}`,
    vMain: `vTT = aT; vLUv = aLUv; ${HIDE_VERT}`,
    fPars: 'uniform vec3 uSunColor; varying vec4 vTT; varying vec2 vLUv;',
    fSurface: TREE_SURFACE,
  });
  const depth = hideDepthMaterial('tree');
  const items: LodItem[][] = SPECIES.map(() => []);
  const pits: THREE.Matrix4[] = [];
  const r = mulberry32(4242);
  const up = new THREE.Vector3(0, 1, 0);
  const add = (x: number, y: number, z: number, s: number, sp: number) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, r() * 6.28), new THREE.Vector3(s * (0.88 + 0.24 * r()), s, s * (0.88 + 0.24 * r())));
    const hue = [0.27, 0.25, 0.3][sp] + (r() - 0.5) * 0.04;
    items[sp].push({ m, c: new THREE.Color().setHSL(hue, 0.38 + 0.15 * r(), 0.16 + 0.07 * r()) });
  };
  // park trees
  for (const p of data.parks) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.pts.length; i += 2) { minX = Math.min(minX, p.pts[i]); maxX = Math.max(maxX, p.pts[i]); minZ = Math.min(minZ, p.pts[i + 1]); maxZ = Math.max(maxZ, p.pts[i + 1]); }
    const count = Math.min(5200, Math.floor(((maxX - minX) * (maxZ - minZ)) / 230));
    for (let i = 0; i < count; i++) {
      const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ);
      if (!pointInPoly(x, z, p.pts) || grid.isRoad(x, z)) continue;
      if (hash2(Math.floor(x / 60), Math.floor(z / 60)) < 0.3) continue;   // lawns stay open
      add(x, 0.04, z, 0.75 + 0.6 * r(), r() < 0.55 ? 0 : r() < 0.5 ? 2 : 1);
    }
  }
  // street trees in pits along the sidewalks (positions shared with the furniture so nothing collides)
  const net = streetNet(data.roads);
  net.roads.forEach((rd, ri) => {
    if (!hasSidewalk(rd)) return;
    const n = rd.pts.length / 2;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(rd.pts[i * 2] - rd.pts[i * 2 - 2], rd.pts[i * 2 + 1] - rd.pts[i * 2 - 1]));
    const len = cum[n - 1];
    const blockSp = Math.floor(hash2(Math.round(rd.pts[0]), Math.round(rd.pts[1]) + 5) * 3);
    for (const side of [1, -1] as const) {
      const { s0, s1 } = sidewalkRange(net, ri, side, len);
      for (const s of treeSlots(rd, side, s0, s1)) {
        let i = 0; while (i < n - 2 && cum[i + 1] < s) i++;
        const sl = cum[i + 1] - cum[i] || 1, f = (s - cum[i]) / sl;
        const tx = (rd.pts[i * 2 + 2] - rd.pts[i * 2]) / sl, tz = (rd.pts[i * 2 + 3] - rd.pts[i * 2 + 1]) / sl;
        const o = rd.w / 2 + TREE_W;
        const x = rd.pts[i * 2] + tx * sl * f - tz * side * o, z = rd.pts[i * 2 + 1] + tz * sl * f + tx * side * o;
        if (grid.isOcc(x, z)) continue;
        add(x, CURB_H, z, 0.72 + 0.35 * r(), r() < 0.7 ? blockSp : Math.floor(r() * 3));
        pits.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB_H + 0.004, z), new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(tx, tz)), new THREE.Vector3(1, 1, 1)));
      }
    }
  });
  const fields = SPECIES.map((sp, i) => new LodField({
    items: items[i], hi: treeGeometry(sp, 0, 11 + i), mid: treeGeometry(sp, 1, 23 + i), lo: treeGeometry(sp, 2, 37 + i),
    material: mat, depthMaterial: depth, tile: 500, nearR: 85, midR: 420, capacity: 700, cull: false, castShadow: true,
  }));
  for (const f of fields) group.add(f.group);
  // tree pits: dark soil in a slightly raised steel edging, one instanced mesh per 500 m tile, near the camera only
  const pitGeo = new THREE.BoxGeometry(1.3, 0.025, 1.3);
  const pitMat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), {
    key: 'treepit', weather: true, vPars: 'varying vec3 vPL;', vMain: 'vPL = position;', fPars: 'varying vec3 vPL;',
    fSurface: `{ float e = max(abs(vPL.x), abs(vPL.z)); float rim = smoothstep(0.58, 0.6, e);
      diffuseColor.rgb = mix(vec3(0.06, 0.045, 0.035) * (0.7 + 0.6 * vnoise(vFogWorld.xz * 7.0)), vec3(0.16, 0.15, 0.14), rim);
      roughnessFactor = mix(0.98, 0.5, rim); metalnessFactor = 0.5 * rim; }`,
  });
  const pitTiles = new Map<string, THREE.Matrix4[]>();
  const v = new THREE.Vector3();
  for (const m of pits) { v.setFromMatrixPosition(m); const k = Math.floor(v.x / 500) + ',' + Math.floor(v.z / 500); if (!pitTiles.has(k)) pitTiles.set(k, []); pitTiles.get(k)!.push(m); }
  const pitMeshes: { cx: number; cz: number; m: THREE.InstancedMesh }[] = [];
  for (const [k, ms] of pitTiles) {
    const [ix, iz] = k.split(',').map(Number);
    const im = new THREE.InstancedMesh(pitGeo, pitMat, ms.length);
    ms.forEach((m, i) => im.setMatrixAt(i, m));
    im.receiveShadow = true; im.computeBoundingSphere(); im.visible = false;
    group.add(im);
    pitMeshes.push({ cx: (ix + 0.5) * 500, cz: (iz + 0.5) * 500, m: im });
  }
  group.userData.update = (cam: THREE.Vector3, range: number) => {
    for (const f of fields) f.update(cam, range);
    for (const p of pitMeshes) { const vis = Math.hypot(p.cx - cam.x, p.cz - cam.z, cam.y) < 650; if (p.m.visible !== vis) p.m.visible = vis; }
  };
  return group;
}
