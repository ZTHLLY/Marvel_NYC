import * as THREE from 'three';
import { aveOf, CityData, CROSSTOWN, CURB_H, RoadRec, streetOf, UPTOWN } from '../city/geo';
import type { GroundBuild } from '../city/ground';
import { LodField, LodItem } from '../city/instLod';
import { hasSidewalk, laneKind, laneLayout, roadDir, sidewalkRange, streetNet, treeSlots } from '../city/streets';
import { beacon } from '../landmarks/kit';
import { hash2, mulberry32 } from '../util/rng';
import { CarKind, carGeometry as heroCarGeometry, carGeometryOf, carMaterial, CAR_KINDS } from './cars';
import * as F from './furniture';

/** Hero saloon geometry (lofted body, wheels, glass, lamps); see cars.ts. */
export function carGeometry(): THREE.BufferGeometry { return heroCarGeometry(); }

const CAR_COLORS = [0x0c0d0f, 0x1a1c20, 0xd9dadc, 0x9a9da2, 0x5c6066, 0x1b2a4a, 0x6a1418, 0x2a3a2e, 0xb8b4a8, 0x3a3d42, 0x22262c, 0xe8e6e0, 0x8a8f96, 0x4a1c22, 0x2c3f5c];
const TAXI = 0xd9a50c;
const NEWS_COLORS = [0xb3261e, 0x1c4fa0, 0xe0b820, 0xe8e6e0, 0x2a6a3a, 0x1a1a1a];
const ROAD_Y = 0.05;

const AVES: [number, string][] = [[-1675, '11 Av'], [-1395, '10 Av'], [-1115, '9 Av'], [-840, '8 Av'], [-557, '7 Av'], [-285, '6 Av'], [27, '5 Av'], [182, 'Madison Av'], [329, 'Park Av'], [470, 'Lexington Av'], [612, '3 Av'], [760, '2 Av'], [910, '1 Av'], [1060, 'York Av']];
const DOWNTOWN = ['Prince St', 'Spring St', 'Broome St', 'Grand St', 'Bleecker St', 'Bond St', 'Great Jones St', 'Houston St', 'Kenmare St', 'Delancey St', 'Rivington St', 'Stanton St', 'Hester St', 'Canal St', 'Mercer St', 'Greene St', 'Wooster St', 'Thompson St', 'Sullivan St', 'MacDougal St', 'Hudson St', 'Bedford St', 'Christopher St', 'Perry St', 'Charles St', 'Bank St', 'Jane St'];

/** a plausible street-sign label for a road */
function labelOf(r: RoadRec): string {
  if (r.n) {
    if (r.n === 'AVE OF THE AMERICAS') return '6 Av';
    if (r.n === 'FDR DR') return 'FDR Dr';
    return r.n.replace(/ AVE$/, ' Av').replace(/ ST$/, ' St').replace(/ DR$/, ' Dr').split(' ').map((w) => (/^\d/.test(w) || w.length <= 1 ? w : w[0] + w.slice(1).toLowerCase())).join(' ').replace('Broadway', 'Broadway');
  }
  const n = r.pts.length / 2, mx = (r.pts[0] + r.pts[n * 2 - 2]) / 2, mz = (r.pts[1] + r.pts[n * 2 - 1]) / 2;
  const dx = r.pts[n * 2 - 2] - r.pts[0], dz = r.pts[n * 2 - 1] - r.pts[1];
  const up = Math.abs(dx * UPTOWN[0] + dz * UPTOWN[1]), east = Math.abs(dx * CROSSTOWN[0] + dz * CROSSTOWN[1]);
  const a = aveOf(mx, mz), s = streetOf(mx, mz);
  if (up > east * 1.6) {
    let best = AVES[0];
    for (const av of AVES) if (Math.abs(av[0] - a) < Math.abs(best[0] - a)) best = av;
    if (Math.abs(best[0] - a) < 70 && s > 1) return best[1];
    if (Math.abs(up - east) / (up + east) < 0.5) return 'Broadway';
  }
  const num = Math.round(s);
  if (num >= 1 && s > 0.6 && east > up * 1.6) return `${a < 27 ? 'W' : 'E'} ${num} St`;
  return DOWNTOWN[Math.floor(hash2(Math.round(mx / 50), Math.round(mz / 50)) * DOWNTOWN.length)];
}

interface Tile { cx: number; cz: number; r: number; objs: THREE.Object3D[]; small: THREE.Object3D[] }
type Mats = THREE.Matrix4[];

/** Street-level set dressing for the Manhattan core: parked & stopped cars, lamps, signals, signs and kerb furniture. */
export class StreetProps {
  readonly group = new THREE.Group();
  private tiles: Tile[] = [];
  readonly carGeo = heroCarGeometry();
  readonly carMat = carMaterial();
  private cars: LodField[] = [];

  constructor(data: CityData, ground: GroundBuild, reserved: { x: number; z: number; r: number }[]) {
    this.group.name = 'street-props';
    const r = mulberry32(90210);
    const TILE = 420;
    const net = streetNet(data.roads);
    const { roads, J } = net;
    const grid = ground.grid;
    const atlas = new F.SignAtlas();

    // ---- per-tile accumulators
    const KEYS = ['cobra', 'crook', 'lensW', 'lensC', 'lensCrook', 'sig4', 'sig5', 'sig7', 'red', 'amber', 'green', 'walk', 'hand',
      'signPole', 'hydrant', 'basket', 'bollard', 'parking', 'mailbox', 'news', 'bike', 'shelter'] as const;
    type Key = typeof KEYS[number];
    type Acc = Record<Key, Mats> & { blades: { m: THREE.Matrix4; row: number }[]; newsC: THREE.Color[]; hydC: THREE.Color[] };
    const acc = new Map<string, Acc>();
    const get = (x: number, z: number) => {
      const k = Math.floor(x / TILE) + ',' + Math.floor(z / TILE);
      let a = acc.get(k);
      if (!a) { a = Object.fromEntries(KEYS.map((k2) => [k2, []])) as unknown as Acc; a.blades = []; a.newsC = []; a.hydC = []; acc.set(k, a); }
      return a;
    };
    const carItems: Record<CarKind, LodItem[]> = { sedan: [], suv: [], taxi: [], van: [] };
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const bx = new THREE.Vector3(), bz = new THREE.Vector3(), mb = new THREE.Matrix4();
    /** rotation whose local +X points along (xx, xz) on the ground */
    const basis = (xx: number, xz: number) => {
      bx.set(xx, 0, xz).normalize(); bz.set(-bx.z, 0, bx.x);
      return q.setFromRotationMatrix(mb.makeBasis(bx, up, bz));
    };
    const at = (x: number, y: number, z: number, rot: THREE.Quaternion, s = one) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), rot, s);
    const blocked = (x: number, z: number) => reserved.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r);
    const pickKind = (taxiP: number): CarKind => { const u = r(); return u < taxiP ? 'taxi' : u < taxiP + 0.08 ? 'van' : u < taxiP + 0.45 ? 'suv' : 'sedan'; };
    const addCar = (kind: CarKind, x: number, z: number, yaw: number, lit: number, color: number) => {
      const s = 0.96 + r() * 0.08;
      carItems[kind].push({ m: at(x, ROAD_Y, z, q.setFromAxisAngle(up, yaw), new THREE.Vector3(s, s, s)), c: new THREE.Color(kind === 'taxi' ? TAXI : kind === 'van' && r() < 0.6 ? 0xe4e4e0 : color), a: lit });
    };

    roads.forEach((rd, ri) => {
      if (rd.b !== 1 || rd.t !== 1) return;
      const st = streetOf(rd.pts[0], rd.pts[1]);
      if (st < -13 || st > 68) return;                     // core only
      const n = rd.pts.length / 2, halfW = rd.w / 2;
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(rd.pts[i * 2] - rd.pts[i * 2 - 2], rd.pts[i * 2 + 1] - rd.pts[i * 2 - 1]));
      const len = cum[n - 1];
      if (len < 4) return;
      const dir = roadDir(rd), kind = laneKind(rd);
      const { lanes, drive } = laneLayout(halfW, dir);
      const pointAt = (s: number) => {
        let i = 0; while (i < n - 2 && cum[i + 1] < s) i++;
        const sl = cum[i + 1] - cum[i] || 1, f = Math.max(0, Math.min(1, (s - cum[i]) / sl));
        const ax = rd.pts[i * 2], az = rd.pts[i * 2 + 1], tx = (rd.pts[i * 2 + 2] - ax) / sl, tz = (rd.pts[i * 2 + 3] - az) / sl;
        return { x: ax + tx * sl * f, z: az + tz * sl * f, tx, tz };
      };
      /** world position at distance s along the road, lateral offset o (+ = left/+x side) */
      const P = (s: number, o: number) => { const p = pointAt(s); return { x: p.x - p.tz * o, z: p.z + p.tx * o, tx: p.tx, tz: p.tz }; };
      const label = labelOf(rd);
      const i0 = J.roadInset(ri, 0), i1 = J.roadInset(ri, 1);
      const rs = Math.max(0, i0) + 6, re = len - Math.max(0, i1) - 6;

      // ---- kerbside parking (both sides, except bus / bike lanes)
      if (halfW > 3.6) for (const side of [-1, 1]) {
        if ((kind === 1 && side > 0) || (kind === 2 && side < 0)) continue;
        for (let s = rs + 4 + r() * 3; s < re - 4; s += 6.2 + r() * 1.2) {
          if (r() > 0.68) continue;
          const p = P(s, side * (halfW - 1.15));
          if (blocked(p.x, p.z)) continue;
          // parked with the flow of traffic on that side
          const fwd = dir === 0 ? side > 0 : dir > 0;
          const yaw = Math.atan2(p.tx, p.tz) + (fwd ? 0 : Math.PI) + (r() - 0.5) * 0.03;
          addCar(pickKind(0.03), p.x, p.z, yaw, 0, CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]);
        }
      }
      // ---- traffic stopped in the travel lanes, lamps on
      if (drive > 1.2) for (let ln = 0; ln < lanes; ln++) {
        const lx = lanes === 1 ? 0 : -drive + ((ln + 0.5) * drive * 2) / lanes;
        const fwd = dir === 0 ? lx > 0 : dir > 0;
        const busy = halfW > 7 ? 11 : 26;
        let s = rs + r() * 20;
        while (s < re) {
          const p = P(s, lx);
          s += 6.2 + r() * busy * (r() < 0.3 ? 3 : 1);
          if (blocked(p.x, p.z)) continue;
          addCar(pickKind(halfW > 7 ? 0.32 : 0.16), p.x, p.z, Math.atan2(p.tx, p.tz) + (fwd ? 0 : Math.PI), 1, CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]);
        }
      }

      if (!hasSidewalk(rd)) return;
      const village = st < 15 && aveOf(rd.pts[0], rd.pts[1]) < 350;
      const crookP = village ? 0.75 : halfW < 6 ? 0.3 : 0;
      for (const side of [1, -1] as const) {
        const { s0, s1, cap0, cap1 } = sidewalkRange(net, ri, side, len);
        if (s1 - s0 < 3) continue;
        const trees = treeSlots(rd, side, s0, s1);
        const taken: number[] = [...trees];
        const free = (s: number, gap = 1.6) => s > s0 + 0.6 && s < s1 - 0.6 && taken.every((t) => Math.abs(t - s) > gap);
        const kerb = (s: number, w: number) => P(s, side * (halfW + w));
        const nW = (p: { tx: number; tz: number }) => [-p.tz * side, p.tx * side];

        // street lamps every 31 m, alternating kerbs in step with the light pools painted on the road and sidewalk
        for (let k = Math.max(0, Math.floor(s0 / 31 - 0.5)); (k + 0.5) * 31 < s1; k++) {
          if ((((k % 2) + 2) % 2) * 2 - 1 !== side) continue;
          let s = (k + 0.5) * 31;
          if (s < s0 + 1 || s > s1 - 1) continue;
          if (!free(s, 1.2)) s += 2.2;
          const p = kerb(s, 0.5);
          if (blocked(p.x, p.z)) continue;
          taken.push(s);
          const [nx, nz] = nW(p);
          const crook = hash2(Math.round(s0 * 7) + ri, 5) < crookP;
          const rot = basis(-nz, nx);            // local +Z reaches over the roadway
          const a = get(p.x, p.z);
          (crook ? a.crook : a.cobra).push(at(p.x, CURB_H, p.z, rot));
          const cool = hash2(Math.floor(len), 2) > 0.6;
          (crook ? a.lensCrook : cool ? a.lensC : a.lensW).push(at(p.x, CURB_H, p.z, rot));
        }

        // corners: signal mast on the approach side of junctions with signals, otherwise a sign pole; blades on both
        for (const end of [0, 1] as const) {
          const capped = end === 0 ? cap0 : cap1;
          if (!capped) continue;
          const sC = end === 0 ? s0 + 0.9 : s1 - 0.9;
          const p = kerb(sC, 0.55);
          if (blocked(p.x, p.z)) continue;
          const [nx, nz] = nW(p);
          const a = get(p.x, p.z);
          const tSign = end === 0 ? -1 : 1;                 // direction toward the junction
          const approach = dir === 0 ? (end === 1 ? side > 0 : side < 0) : (dir > 0 ? end === 1 && side > 0 : end === 0 && side < 0);
          const signal = approach && halfW >= 3.4 && J.degree(ri, end) >= 3;
          const cr = J.crossRoad(ri, end);
          const go = halfW > 7 || (cr >= 0 && roads[cr].w / 2 < halfW - 0.5);
          let poleTop = 3.6;
          if (signal) {
            const want = Math.min(halfW * 1.25, 7.2);
            const arm = want < 4.7 ? 4 : want < 6.2 ? 5.5 : 7;
            const rot = basis(nx, nz);                       // local -X reaches over the road, heads face oncoming traffic
            const m = at(p.x, CURB_H, p.z, rot);
            (arm === 4 ? a.sig4 : arm === 5.5 ? a.sig5 : a.sig7).push(m);
            for (const [lxp, ly, lz] of F.signalLensPositions(arm, go ? 2 : 0)) {
              const v = new THREE.Vector3(lxp, ly, lz).applyMatrix4(m);
              (go ? a.green : a.red).push(at(v.x, v.y, v.z, rot));
            }
            const pv = new THREE.Vector3(...F.PED_LENS_POS).applyMatrix4(m);
            (go ? a.walk : a.hand).push(at(pv.x, pv.y, pv.z, rot));
            poleTop = 4.4;
          } else if (hash2(ri * 3 + end, side + 9) < 0.75) {
            a.signPole.push(at(p.x, CURB_H, p.z, q.identity()));
          } else poleTop = -1;
          if (poleTop > 0) {
            // blade parallel to this street (cantilevered back from the corner), and one for the crossing street over the walk
            const off = 0.52;
            a.blades.push({ m: at(p.x - p.tx * tSign * off, CURB_H + poleTop + 0.12, p.z - p.tz * tSign * off, basis(p.tx, p.tz)), row: atlas.index(label) });
            if (cr >= 0) a.blades.push({ m: at(p.x + nx * off, CURB_H + poleTop - 0.12, p.z + nz * off, basis(nx, nz)), row: atlas.index(labelOf(roads[cr])) });
          }
          taken.push(sC);
          // corner kit: litter basket, hydrant, sometimes a mailbox and a cluster of news boxes
          const sB = sC + (end === 0 ? 2.2 : -2.2);
          if (free(sB, 1.0) && hash2(ri + end * 13, side + 21) < 0.65) {
            const pb = kerb(sB, 0.6); a.basket.push(at(pb.x, CURB_H, pb.z, q.identity())); taken.push(sB);
          }
          const sH = sC + (end === 0 ? 5.0 : -5.0);
          if (free(sH, 1.0) && hash2(ri + end * 17, side + 31) < 0.45) {
            const ph = kerb(sH, 0.45); a.hydrant.push(at(ph.x, CURB_H, ph.z, q.setFromAxisAngle(up, r() * 6.28))); a.hydC.push(new THREE.Color(r() < 0.6 ? 0xb8b8b2 : 0xc8a420)); taken.push(sH);
          }
          const sM = sC + (end === 0 ? 7.5 : -7.5);
          if (free(sM, 1.2) && hash2(ri + end * 23, side + 41) < 0.3) {
            const pm = kerb(sM, 0.85);
            const rotK = basis(nz, -nx);           // faces the building line
            if (r() < 0.5) a.mailbox.push(at(pm.x, CURB_H, pm.z, rotK));
            const cnt = 1 + Math.floor(r() * 3);
            for (let c = 0; c < cnt; c++) {
              const pn = kerb(sM + (end === 0 ? 1 : -1) * (0.6 + c * 0.48), 0.85);
              a.news.push(at(pn.x, CURB_H, pn.z, rotK)); a.newsC.push(new THREE.Color(NEWS_COLORS[Math.floor(r() * NEWS_COLORS.length)]));
            }
            taken.push(sM, sM + (end === 0 ? 1.5 : -1.5));
          }
        }

        // mid-block: hydrant, parking-regulation signs, bike racks, bollards, bus shelters
        const parks = halfW > 3.6 && !((kind === 1 && side > 0) || (kind === 2 && side < 0));
        if (parks) for (let s = s0 + 9 + r() * 6; s < s1 - 9; s += 22 + r() * 14) {
          if (!free(s, 1.0)) continue;
          const p = kerb(s, 0.32); get(p.x, p.z).parking.push(at(p.x, CURB_H, p.z, basis(p.tz, -p.tx))); taken.push(s);
        }
        const mid = (s0 + s1) / 2 + (r() - 0.5) * 20;
        if (s1 - s0 > 40 && free(mid, 1.2) && r() < 0.35) {
          const p = kerb(mid, 0.45); get(p.x, p.z).hydrant.push(at(p.x, CURB_H, p.z, q.setFromAxisAngle(up, r() * 6.28))); get(p.x, p.z).hydC.push(new THREE.Color(0xb8b8b2)); taken.push(mid);
        }
        const sR = s0 + (s1 - s0) * (0.25 + 0.5 * r());
        if (s1 - s0 > 30 && r() < 0.28 && free(sR, 2.0) && free(sR + 1, 2.0) && free(sR - 1, 2.0)) {
          const p = kerb(sR, 1.0);
          if (!grid.isOcc(p.x, p.z)) { get(p.x, p.z).bike.push(at(p.x, CURB_H, p.z, basis(p.tx, p.tz))); taken.push(sR - 1, sR, sR + 1); }
        }
        if (halfW > 7 && r() < 0.12) {
          const sb = s0 + (s1 - s0) * (0.3 + 0.4 * r());
          for (let b = 0; b < 4; b++) {
            const s = sb + b * 1.5;
            if (!free(s, 0.8)) continue;
            const p = kerb(s, 0.7); get(p.x, p.z).bollard.push(at(p.x, CURB_H, p.z, q.identity())); taken.push(s);
          }
        }
        if (halfW > 7 && side > 0 && s1 - s0 > 50 && hash2(ri, 61) < 0.22) {
          const sS = s0 + 12;
          if (free(sS, 2.6) && free(sS + 2, 2.6) && free(sS - 2, 2.6)) {
            const p = kerb(sS, 1.2);
            const [nx, nz] = nW(p);
            if (!grid.isOcc(P(sS, side * (halfW + 2.3)).x, P(sS, side * (halfW + 2.3)).z)) {
              get(p.x, p.z).shelter.push(at(p.x - nx * -0.85, CURB_H, p.z - nz * -0.85, basis(-nz, nx)));
              taken.push(sS - 2, sS, sS + 2);
            }
          }
        }
      }
    });

    // ---- cars: instanced with a hero / mid / far LOD per body type
    for (const kind of CAR_KINDS) {
      if (!carItems[kind].length) continue;
      const f = new LodField({
        items: carItems[kind], hi: carGeometryOf(kind, 0), mid: carGeometryOf(kind, 1), lo: carGeometryOf(kind, 2),
        material: this.carMat, tile: TILE, nearR: 60, midR: -100, capacity: 260, attr: 'aLit', cull: true, castShadow: true,
      });
      this.cars.push(f);
      this.group.add(f.group);
    }

    // ---- geometry & materials shared by all tiles
    const furn = F.furnitureMaterial();
    const geos: Partial<Record<Key, THREE.BufferGeometry>> = {
      cobra: F.cobraLamp(), crook: F.crookLamp(), lensW: F.cobraLens(), lensC: F.cobraLens(), lensCrook: F.crookLens(),
      sig4: F.signalMast(4), sig5: F.signalMast(5.5), sig7: F.signalMast(7), red: F.signalLens(), amber: F.signalLens(), green: F.signalLens(),
      walk: F.pedLens(), hand: F.pedLens(), signPole: F.signPole(), hydrant: F.hydrant(), basket: F.litterBasket(), bollard: F.bollard(),
      parking: F.parkingSign(), mailbox: F.mailbox(), news: F.newsBox(), bike: F.bikeRack(), shelter: F.busShelter(),
    };
    const warm = beacon(0xffb060, 0, 9, false), coolL = beacon(0xdfeaff, 0, 8, false), crookM = beacon(0xffc27a, 0.05, 7, false);
    const redM = beacon(0xff2418, 1.4, 9, false), greenM = beacon(0x22ff9a, 1.2, 8, false), amberM = beacon(0xffa020, 1.2, 8, false);
    const walkM = beacon(0xf4f4ff, 1.0, 6, false), handM = beacon(0xff7a1a, 1.2, 7, false);
    const mats: Partial<Record<Key, THREE.Material>> = { lensW: warm, lensC: coolL, lensCrook: crookM, red: redM, amber: amberM, green: greenM, walk: walkM, hand: handM };
    const SMALL = new Set<Key>(['hydrant', 'basket', 'bollard', 'parking', 'mailbox', 'news', 'bike']);
    const SHADOW = new Set<Key>(['cobra', 'crook', 'sig4', 'sig5', 'sig7', 'signPole', 'shelter', 'mailbox', 'hydrant', 'basket', 'bike', 'news']);
    const bladeGeo = F.bladeGeometry(), bladeMat = atlas.material();
    const white = new THREE.Color(1, 1, 1);
    for (const [k, a] of acc) {
      const [ix, iz] = k.split(',').map(Number);
      const tile: Tile = { cx: (ix + 0.5) * TILE, cz: (iz + 0.5) * TILE, r: TILE * 0.75, objs: [], small: [] };
      for (const key of KEYS) {
        const ms = a[key];
        if (!ms.length) continue;
        const im = new THREE.InstancedMesh(geos[key]!, mats[key] ?? furn, ms.length);
        const cols = key === 'news' ? a.newsC : key === 'hydrant' ? a.hydC : null;
        ms.forEach((m, i) => { im.setMatrixAt(i, m); if (!mats[key]) im.setColorAt(i, cols ? cols[i] : white); });
        im.castShadow = SHADOW.has(key); im.receiveShadow = !mats[key];
        im.computeBoundingSphere();
        (SMALL.has(key) ? tile.small : tile.objs).push(im);
      }
      if (a.blades.length) {
        const g = new THREE.BufferGeometry();
        for (const n of Object.keys(bladeGeo.attributes)) g.setAttribute(n, bladeGeo.attributes[n]);
        g.setIndex(bladeGeo.index);
        g.setAttribute('aRow', new THREE.InstancedBufferAttribute(new Float32Array(a.blades.map((b) => b.row)), 1));
        g.boundingSphere = bladeGeo.boundingSphere;
        const im = new THREE.InstancedMesh(g, bladeMat, a.blades.length);
        a.blades.forEach((b, i) => im.setMatrixAt(i, b.m));
        im.computeBoundingSphere();
        tile.small.push(im);
      }
      for (const o of [...tile.objs, ...tile.small]) { o.visible = false; this.group.add(o); }
      if (tile.objs.length || tile.small.length) this.tiles.push(tile);
    }
  }

  /** A single car mesh for hand-placed hero scenes (yellow gets the taxi body). */
  car(color: number): THREE.Mesh {
    const m = new THREE.Mesh(color === TAXI ? carGeometryOf('taxi', 0) : this.carGeo, carMaterial(color));
    m.castShadow = true; m.receiveShadow = true;
    m.position.y = ROAD_Y;
    return m;
  }

  update(cam: THREE.Vector3, range: number) {
    for (const t of this.tiles) {
      const d = Math.hypot(t.cx - cam.x, t.cz - cam.z, cam.y * 0.8);
      const vis = d < Math.min(range, 700) + t.r;
      const near = d < 340 + t.r;
      for (const o of t.objs) if (o.visible !== vis) o.visible = vis;
      for (const o of t.small) if (o.visible !== near) o.visible = near;
    }
    for (const f of this.cars) f.update(cam, Math.min(range, 650));
  }
}
