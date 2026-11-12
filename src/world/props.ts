import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CityData, streetOf } from '../city/geo';
import type { GroundBuild } from '../city/ground';
import { extendMaterial } from '../engine/materials';
import { beacon } from '../landmarks/kit';
import { hash2, mulberry32 } from '../util/rng';

/** A compact saloon car: body + glasshouse + wheels, vertex-coloured so one instanced draw gives painted body & dark glass. */
export function carGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, c: number) => {
    const n = g.attributes.position.count, col = new Float32Array(n * 3).fill(c);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const prof = (pts: [number, number][], width: number) => {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2);      // length along +Z
    return g;
  };
  const body = paint(prof([[-2.2, 0.32], [2.15, 0.32], [2.25, 0.62], [2.0, 0.84], [1.0, 0.92], [-1.3, 0.92], [-2.2, 0.82]], 1.62), 1);
  const cabin = paint(prof([[-1.45, 0.9], [0.95, 0.9], [0.42, 1.38], [-0.95, 1.38]], 1.42), 0.07);
  const parts = [body, cabin];
  for (const [x, z] of [[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.4], [0.8, -1.4]]) {
    const w = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10).rotateZ(Math.PI / 2).translate(x, 0.33, z);
    parts.push(paint(w, 0.035));
  }
  const g = mergeGeometries(parts.map((p) => { p.computeVertexNormals(); return p; }))!;
  return g;
}

const CAR_COLORS = [0x0c0d0f, 0x1a1c20, 0xd9dadc, 0x9a9da2, 0x5c6066, 0x1b2a4a, 0x6a1418, 0x2a3a2e, 0xb8b4a8, 0x3a3d42, 0x22262c, 0xe8e6e0];
const TAXI = 0xd9a50c;

interface Tile { cx: number; cz: number; r: number; objs: THREE.Object3D[] }

/** Street-level set dressing for the Manhattan core: parked & queued cars, street lamps. Tiles are distance-culled. */
export class StreetProps {
  readonly group = new THREE.Group();
  private tiles: Tile[] = [];
  readonly carGeo = carGeometry();
  readonly carMat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.32, metalness: 0.55 }), { key: 'car', weather: true });

  constructor(data: CityData, ground: GroundBuild, reserved: { x: number; z: number; r: number }[]) {
    this.group.name = 'street-props';
    const r = mulberry32(90210);
    const TILE = 420;
    type Acc = { cars: { m: THREE.Matrix4; c: THREE.Color }[]; head: THREE.Matrix4[]; tail: THREE.Matrix4[]; poles: THREE.Matrix4[]; lampsW: THREE.Matrix4[]; lampsC: THREE.Matrix4[]; sig: THREE.Matrix4[]; red: THREE.Matrix4[]; green: THREE.Matrix4[] };
    const acc = new Map<string, Acc>();
    const get = (x: number, z: number) => {
      const k = Math.floor(x / TILE) + ',' + Math.floor(z / TILE);
      let a = acc.get(k);
      if (!a) { a = { cars: [], head: [], tail: [], poles: [], lampsW: [], lampsC: [], sig: [], red: [], green: [] }; acc.set(k, a); }
      return a;
    };
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const blocked = (x: number, z: number) => reserved.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r);
    // junctions: nodes where three or more street ends meet get traffic signals
    const nodeKey = (x: number, z: number) => `${Math.round(x / 1.5)},${Math.round(z / 1.5)}`;
    const nodes = new Map<string, number>();
    for (const rd of data.roads) { if (rd.b !== 1 || rd.t !== 1) continue; const n = rd.pts.length / 2; for (const e of [0, n - 1]) { const k = nodeKey(rd.pts[e * 2], rd.pts[e * 2 + 1]); nodes.set(k, (nodes.get(k) || 0) + 1); } }
    for (const rd of data.roads) {
      if (rd.b !== 1 || rd.t !== 1) continue;
      const st = streetOf(rd.pts[0], rd.pts[1]);
      if (st < -13 || st > 68) continue;                     // core only
      const n = rd.pts.length / 2, halfW = rd.w / 2;
      const oneWay = hash2(Math.round(rd.pts[0]), Math.round(rd.pts[1])) < 0.5 ? 1 : -1;
      // a signal mast on the approach to each junction (wide avenues run on green, cross streets wait on red)
      for (const e of [0, n - 1]) {
        if ((nodes.get(nodeKey(rd.pts[e * 2], rd.pts[e * 2 + 1])) || 0) < 3 || halfW < 3.4) continue;
        const o = e === 0 ? 1 : n - 2;
        const ex = rd.pts[e * 2], ez = rd.pts[e * 2 + 1];
        let dx = ex - rd.pts[o * 2], dz = ez - rd.pts[o * 2 + 1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;   // travelling toward the junction
        if (dl < 26) continue;
        const back = 8.5 + (halfW > 7 ? 0 : 4), sx = ex - dx * back + dz * (halfW + 0.7), sz = ez - dz * back - dx * (halfW + 0.7);
        if (blocked(sx, sz)) continue;
        q.setFromAxisAngle(up, Math.atan2(-dz, dx) + Math.PI / 2);
        const a = get(sx, sz);
        a.sig.push(new THREE.Matrix4().compose(new THREE.Vector3(sx, 0, sz), q, one));
        // lamp sits on the mast arm, facing oncoming traffic
        const lx = sx - dz * 3.4 - dx * 0.19, lz = sz + dx * 3.4 - dz * 0.19;
        const go = halfW > 7;
        (go ? a.green : a.red).push(new THREE.Matrix4().compose(new THREE.Vector3(lx, go ? 5.42 : 6.02, lz), q, one));
      }
      let v0 = 0;
      for (let i = 0; i < n - 1; i++) {
        const ax = rd.pts[i * 2], az = rd.pts[i * 2 + 1], bx = rd.pts[i * 2 + 2], bz = rd.pts[i * 2 + 3];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        const yaw = Math.atan2(tx, tz);
        // --- kerb-side parking on both sides
        if (halfW > 3.6) for (const side of [-1, 1]) {
          for (let s = 13; s < L - 13; s += 5.5) {
            if (r() > 0.6) continue;
            const o = halfW - 1.15, x = ax + tx * s - tz * side * o, z = az + tz * s + tx * side * o;
            if (blocked(x, z)) continue;
            q.setFromAxisAngle(up, yaw + (side * oneWay > 0 ? 0 : 0) + (r() - 0.5) * 0.04);
            const sc = 0.92 + r() * 0.16;
            get(x, z).cars.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(sc, sc * (0.95 + r() * 0.2), sc)), c: new THREE.Color(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]) });
          }
        }
        // --- traffic frozen in the travel lanes
        const lanes = Math.max(1, Math.round((halfW * 2 - 4.4) / 3.3));
        const drive = halfW - 2.2;
        if (drive > 1.2) for (let ln = 0; ln < lanes; ln++) {
          const lx = lanes === 1 ? 0 : -drive + ((ln + 0.5) * drive * 2) / lanes;
          let s = 16 + r() * 30;
          while (s < L - 16) {
            const x = ax + tx * s - tz * lx, z = az + tz * s + tx * lx;
            const busy = halfW > 7 ? 13 : 30;
            s += 6 + r() * busy * (r() < 0.3 ? 3 : 1);
            if (blocked(x, z)) continue;
            const yawD = yaw + (oneWay > 0 ? 0 : Math.PI);
            q.setFromAxisAngle(up, yawD);
            const taxi = r() < (halfW > 7 ? 0.3 : 0.14);
            const a = get(x, z);
            a.cars.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, one), c: new THREE.Color(taxi ? TAXI : CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]) });
            const fx = Math.sin(yawD), fz = Math.cos(yawD);
            for (const sd of [-0.58, 0.58]) {
              a.head.push(new THREE.Matrix4().compose(new THREE.Vector3(x + fx * 2.27 + fz * sd, 0.66, z + fz * 2.27 - fx * sd), q, one));
              a.tail.push(new THREE.Matrix4().compose(new THREE.Vector3(x - fx * 2.22 + fz * sd, 0.78, z - fz * 2.22 - fx * sd), q, one));
            }
          }
        }
        // --- street lamps, alternating kerbs in step with the road shader's light pools
        for (let k = Math.ceil((v0 - 15.5) / 31); (k + 0.5) * 31 < v0 + L; k++) {
          const s = (k + 0.5) * 31 - v0;
          if (s < 0) continue;
          const side = (((k % 2) + 2) % 2) * 2 - 1;
          const o = halfW + 0.75, x = ax + tx * s - tz * side * o, z = az + tz * s + tx * side * o;
          if (blocked(x, z)) continue;
          // arm reaches back over the roadway
          q.setFromAxisAngle(up, Math.atan2(tz * side, -tx * side));
          const a = get(x, z);
          a.poles.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, one));
          const hx = x + tz * side * 2.1, hz = z - tx * side * 2.1;
          (hash2(Math.floor(v0 + L), 2) > 0.6 ? a.lampsC : a.lampsW).push(new THREE.Matrix4().compose(new THREE.Vector3(hx, 8.05, hz), q, one));
        }
        v0 += L;
      }
    }
    void ground;
    // geometry shared by all tiles
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.11, 8.2, 6).translate(0, 4.1, 0),
      new THREE.BoxGeometry(0.1, 0.1, 2.3).translate(0, 8.2, 1.1),
      new THREE.BoxGeometry(0.34, 0.14, 0.7).translate(0, 8.13, 2.1),
    ])!;
    const poleMat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.6 }), { key: 'pole', weather: true });
    const lampGeo = new THREE.BoxGeometry(0.3, 0.06, 0.6);
    const lightGeo = new THREE.BoxGeometry(0.26, 0.12, 0.05);
    const warm = beacon(0xffb060, 0, 9, false), coolL = beacon(0xdfeaff, 0, 8, false);
    const headM = beacon(0xfff2d8, 0.25, 8, false), tailM = beacon(0xff1a10, 0.35, 5, false);
    const sigGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6).translate(0, 3.2, 0),
      new THREE.BoxGeometry(3.7, 0.1, 0.1).translate(-1.85, 6.3, 0),
      new THREE.BoxGeometry(0.34, 1.05, 0.3).translate(-3.4, 5.72, 0),
    ])!;
    const sigMat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.6, metalness: 0.5 }), { key: 'pole', weather: true });
    const bulb = new THREE.SphereGeometry(0.13, 8, 6);
    const redM = beacon(0xff2418, 1.2, 9, false), greenM = beacon(0x22ff88, 1.1, 8, false);
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[], shadow = false) => {
      const im = new THREE.InstancedMesh(geo, mat, ms.length);
      ms.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = shadow; im.receiveShadow = shadow;
      im.computeBoundingSphere();
      return im;
    };
    for (const [k, a] of acc) {
      const [ix, iz] = k.split(',').map(Number);
      const tile: Tile = { cx: (ix + 0.5) * TILE, cz: (iz + 0.5) * TILE, r: TILE * 0.75, objs: [] };
      if (a.cars.length) {
        const im = new THREE.InstancedMesh(this.carGeo, this.carMat, a.cars.length);
        a.cars.forEach((c, i) => { im.setMatrixAt(i, c.m); im.setColorAt(i, c.c); });
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
        tile.objs.push(im);
      }
      if (a.head.length) tile.objs.push(inst(lightGeo, headM, a.head), inst(lightGeo, tailM, a.tail));
      if (a.poles.length) tile.objs.push(inst(pole, poleMat, a.poles, true));
      if (a.lampsW.length) tile.objs.push(inst(lampGeo, warm, a.lampsW));
      if (a.lampsC.length) tile.objs.push(inst(lampGeo, coolL, a.lampsC));
      if (a.sig.length) tile.objs.push(inst(sigGeo, sigMat, a.sig, true));
      if (a.red.length) tile.objs.push(inst(bulb, redM, a.red));
      if (a.green.length) tile.objs.push(inst(bulb, greenM, a.green));
      for (const o of tile.objs) { o.visible = false; this.group.add(o); }
      if (tile.objs.length) this.tiles.push(tile);
    }
  }

  /** A single car mesh for hand-placed hero scenes. */
  car(color: number): THREE.Mesh {
    const m = new THREE.Mesh(this.carGeo, extendMaterial(new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.3, metalness: 0.55 }), { key: 'car', weather: true }));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  update(cam: THREE.Vector3, range: number) {
    for (const t of this.tiles) {
      const d = Math.hypot(t.cx - cam.x, t.cz - cam.z, cam.y * 0.8);
      const vis = d < range + t.r;
      if (t.objs[0].visible !== vis) for (const o of t.objs) o.visible = vis;
    }
  }
}
