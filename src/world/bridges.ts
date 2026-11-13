import * as THREE from 'three';
import { ll } from '../city/geo';
import { StylePalette, Surf } from '../city/facade';
import { MeshBuilder } from '../city/meshBuilder';
import { beacon, facadeMesh, Parts, quad3, tri3, V3 } from '../landmarks/kit';
import { pbr } from '../engine/materials';
import earcut from 'earcut';

/** Slab with openings: outline + holes in the (u, up) plane at origin o, extruded along w from t0 to t1 (with reveals). */
function slabWithHoles(mb: MeshBuilder, outline: number[], holes: number[][], o: V3, u: V3, w: V3, t0: number, t1: number) {
  const all = [...outline], hi: number[] = [];
  for (const h of holes) { hi.push(all.length / 2); all.push(...h); }
  const P = (x: number, y: number, t: number): V3 => [o[0] + u[0] * x + w[0] * t, o[1] + y, o[2] + u[2] * x + w[2] * t];
  const tris = earcut(all, hi, 2);
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k] * 2, b = tris[k + 1] * 2, c = tris[k + 2] * 2;
    tri3(mb, P(all[a], all[a + 1], t1), P(all[b], all[b + 1], t1), P(all[c], all[c + 1], t1), w);
    tri3(mb, P(all[a], all[a + 1], t0), P(all[b], all[b + 1], t0), P(all[c], all[c + 1], t0), [-w[0], -w[1], -w[2]]);
  }
  const ring = (r: number[], inward: boolean) => {
    const n = r.length / 2;
    let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += r[i * 2]; cy += r[i * 2 + 1]; } cx /= n; cy /= n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, mx = (r[i * 2] + r[j * 2]) / 2 - cx, my = (r[i * 2 + 1] + r[j * 2 + 1]) / 2 - cy;
      const ex = r[j * 2] - r[i * 2], ey = r[j * 2 + 1] - r[i * 2 + 1];
      let nx = ey, ny = -ex; if ((nx * mx + ny * my > 0) === inward) { nx = -nx; ny = -ny; }
      quad3(mb, P(r[i * 2], r[i * 2 + 1], t0), P(r[j * 2], r[j * 2 + 1], t0), P(r[j * 2], r[j * 2 + 1], t1), P(r[i * 2], r[i * 2 + 1], t1), [u[0] * nx, ny, u[2] * nx]);
    }
  };
  ring(outline, false);
  for (const h of holes) ring(h, true);
}

/** Equilateral pointed (Gothic) arch opening centred at c, half-width hw, springing at ys, from sill y0. */
function gothic(c: number, hw: number, y0: number, ys: number): number[] {
  const p: number[] = [c - hw, y0, c + hw, y0, c + hw, ys];
  const R = hw * 2, S = 10;
  for (let k = 1; k <= S; k++) { const a = (k / S) * (Math.PI / 3); p.push(c - hw + Math.cos(a) * R, ys + Math.sin(a) * R); }
  for (let k = S - 1; k >= 1; k--) { const a = Math.PI - (k / S) * (Math.PI / 3); p.push(c + hw + Math.cos(a) * R, ys + Math.sin(a) * R); }
  p.push(c - hw, ys);
  return p;
}

interface BridgeSpec {
  name: string;
  /** main-span tower positions (lat, lon) */
  t1: [number, number]; t2: [number, number];
  deckY: number; towerH: number; width: number; side: number; approach: number;
  stone: boolean; truss?: boolean;
}

/** East River crossings. Tower positions are approximate (hand-placed from public maps). */
const BRIDGES: BridgeSpec[] = [
  { name: 'Brooklyn Bridge', t1: [40.7078, -73.9988], t2: [40.7044, -73.9948], deckY: 40, towerH: 84, width: 26, side: 280, approach: 330, stone: true },
  { name: 'Manhattan Bridge', t1: [40.7095, -73.9925], t2: [40.7058, -73.9899], deckY: 41, towerH: 102, width: 36, side: 220, approach: 360, stone: false },
  { name: 'Williamsburg Bridge', t1: [40.7147, -73.9755], t2: [40.7122, -73.9705], deckY: 41, towerH: 102, width: 36, side: 180, approach: 420, stone: false },
  { name: 'Queensboro Bridge', t1: [40.7590, -73.9590], t2: [40.7552, -73.9499], deckY: 40, towerH: 106, width: 30, side: 300, approach: 380, stone: false, truss: true },
];

export function buildBridges(palette: StylePalette): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bridges';
  const granite = palette.addCustom({ win: [0.3, 0.5], bay: 3, floor: 4, wall: 0x8a7f72, wallType: 1, glass: 0x333c44, glassRough: 0.2, frame: 0x26282a, frameW: 0.09, ground: 4, lit: 0, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 0, crown: 0, roof: 0x3c3a38, storefront: 0, accent: 0x2e6a4a, feature: 0 });
  const steel = palette.addCustom({ win: [0.3, 0.5], bay: 3, floor: 4, wall: 0x5f7482, wallType: 3, glass: 0x333c44, glassRough: 0.2, frame: 0x26282a, frameW: 0.09, ground: 4, lit: 0, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 0, crown: 0, roof: 0x2c2c2e, storefront: 0, accent: 0x2e6a4a, feature: 0 });
  const blue = palette.addCustom({ win: [0.3, 0.5], bay: 3, floor: 4, wall: 0x4f7898, wallType: 3, glass: 0x333c44, glassRough: 0.2, frame: 0x26282a, frameW: 0.09, ground: 4, lit: 0, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 0, crown: 0, roof: 0x2c2c2e, storefront: 0, accent: 0x2e6a4a, feature: 0 });
  const mb = new MeshBuilder(65536);
  const parts = new Parts();
  const finial = pbr({ color: 0x4f7898, roughness: 0.45, metalness: 0.7 });
  const lights: THREE.Vector3[] = [];
  for (const b of BRIDGES) {
    const [x1, z1] = ll(...b.t1), [x2, z2] = ll(...b.t2);
    const span = Math.hypot(x2 - x1, z2 - z1), tx = (x2 - x1) / span, tz = (z2 - z1) / span, nx = -tz, nz = tx;
    const at = (s: number, o = 0): [number, number] => [x1 + tx * s + nx * o, z1 + tz * s + nz * o];
    const row = b.stone ? granite : b.name.startsWith('Manhattan') ? blue : steel;
    const s0 = -b.side - b.approach, s1 = span + b.side + b.approach;
    // deck profile: level over the river, ramps down to grade at each end
    const deckAt = (s: number) => s < -b.side ? b.deckY * Math.max(0, (s - s0) / b.approach) : s > span + b.side ? b.deckY * Math.max(0, (s1 - s) / b.approach) : b.deckY + 3 * Math.sin((Math.PI * Math.min(Math.max(s, 0), span)) / span);
    mb.style(steel, Surf.Dark, 0.5, 0);
    const stepLen = 30;
    for (let s = s0; s < s1 - 1; s += stepLen) {
      const e = Math.min(s + stepLen, s1), [ax, az] = at(s), [bx, bz] = at(e);
      mb.style(steel, Surf.Dark, 0.5, 0);
      mb.beam(ax, deckAt(s) - 1.4, az, bx, deckAt(e) - 1.4, bz, b.width, 2.8);
      // approach piers
      if ((s < -b.side || s > span + b.side) && deckAt(s) > 6) { mb.style(row, Surf.Blank, 0.5, 100); mb.box(ax, 0, az, b.width * 0.7, deckAt(s) - 2.8, 3.5, Math.atan2(nz, nx)); }
      // stiffening truss / railings along both edges
      mb.style(steel, Surf.Metal, 0.5, 0);
      for (const o of [-1, 1]) { const [rx, rz] = at(s, o * b.width * 0.5), [qx, qz] = at(e, o * b.width * 0.5); mb.beam(rx, deckAt(s) + (b.truss ? 5 : 2.2), rz, qx, deckAt(e) + (b.truss ? 5 : 2.2), qz, 0.5, 0.5); mb.beam(rx, deckAt(s), rz, qx, deckAt(e) + (b.truss ? 5 : 2.2), qz, 0.35, 0.35); }
    }
    // towers
    for (const s of [0, span]) {
      const [cx, cz] = at(s);
      const ang = Math.atan2(nz, nx);
      if (b.stone) {
        // granite tower: battered slab pierced by twin pointed Gothic arches, pilastered faces, corniced top
        mb.style(row, Surf.Blank, 0.5, 200);
        const hb = 20.5, ht = 18.5, H = b.towerH - 6;
        const u: V3 = [nx, 0, nz], w: V3 = [tx, 0, tz], o: V3 = [cx, 0, cz];
        const outline = [-hb, -3, hb, -3, ht, H, -ht, H];
        const ys = b.deckY + 17;
        slabWithHoles(mb, outline, [gothic(-8.6, 5.2, b.deckY - 4, ys), gothic(8.6, 5.2, b.deckY - 4, ys)], o, u, w, -10.5, 10.5);
        // pilaster strips on both river faces and the corners
        mb.style(row, Surf.Trim, 0.5, 200);
        for (const a of [-hb + 1.6, 0, hb - 1.6]) { const [px, pz] = at(s, a); mb.box(px, -3, pz, a === 0 ? 4.4 : 3.2, H * 0.98 + 3, 22.4, ang); }
        // cornice: stepped cap with a deep overhang, and a parapet
        mb.box(cx, H, cz, ht * 2 + 2.4, 1.6, 23.6, ang); mb.box(cx, H + 1.6, cz, ht * 2 + 3.6, 1.2, 24.8, ang);
        mb.style(row, Surf.Blank, 0.5, 200); mb.box(cx, H + 2.8, cz, ht * 2 + 1.6, 3.2, 22.6, ang);
        mb.style(row, Surf.Trim, 0.5, 200); mb.box(cx, H + 6.0, cz, ht * 2 + 2.4, 0.8, 23.4, ang);
        // string course at the arch springing
        mb.box(cx, ys - 0.8, cz, hb * 2 + 0.6, 1.2, 21.6, ang);
      } else {
        mb.style(row, Surf.Blank, 0.5, 200);
        for (const o of [-1, 1]) { const [px, pz] = at(s, o * b.width * 0.5); mb.box(px, -3, pz, 5, b.towerH + 3, 7.5, ang); }
        for (const hy of [b.deckY - 9, b.deckY + 22, b.towerH - 7]) mb.box(cx, hy, cz, b.width, 5, 5, ang);
        for (const o of [-1, 1]) { const [px, pz] = at(s, o * b.width * 0.5), [qx, qz] = at(s, -o * b.width * 0.5); mb.beam(px, b.deckY + 27, pz, qx, b.towerH - 7, qz, 1.4, 1.4); }
        // lattice X-bracing on the leg faces
        mb.style(row, Surf.Dark, 0.5, 200);
        for (const o of [-1, 1]) for (let y = 4; y < b.towerH - 10; y += 12) for (const d of [-1, 1]) {
          const [ax, az] = at(s - 3.75 * d, o * b.width * 0.5), [bx, bz] = at(s + 3.75 * d, o * b.width * 0.5);
          mb.beam(ax, y, az, bx, y + 12, bz, 0.5, 0.5);
        }
        if (b.name.startsWith('Manhattan')) {
          for (const o of [-1, 1]) { const [px, pz] = at(s, o * b.width * 0.5); mb.style(row, Surf.Blank, 0.5, 200); mb.cyl(px, b.towerH, pz, 1.4, 0.9, 3, 10, true); parts.add(new THREE.SphereGeometry(2.1, 18, 12), finial, px, b.towerH + 4.6, pz); parts.add(new THREE.ConeGeometry(0.35, 3, 8), finial, px, b.towerH + 7.6, pz); }
          // arched portal between the legs above the roadway
          mb.style(row, Surf.Blank, 0.5, 200);
          for (let k = 0; k < 12; k++) { const a0 = (k / 12) * Math.PI, a1 = ((k + 1) / 12) * Math.PI, r = b.width * 0.5 - 2.5; const [p0x, p0z] = at(s, Math.cos(a0) * r), [p1x, p1z] = at(s, Math.cos(a1) * r); mb.beam(p0x, b.deckY + 12 + Math.sin(a0) * 9, p0z, p1x, b.deckY + 12 + Math.sin(a1) * 9, p1z, 1.6, 4.5); }
        } else {
          mb.style(steel, Surf.Steel, 0.5, 200);
          for (const o of [-1, 1]) { const [px, pz] = at(s, o * b.width * 0.5); mb.cyl(px, b.towerH, pz, 1.6, 0.2, 9, 8, false); }
        }
      }
    }
    // main cables (or the cantilever's top chord) + suspenders
    mb.style(steel, Surf.Dark, 0.5, 0);
    const cableY = (s: number) => {
      if (b.truss) { const u = ((s + b.side) / (span + 2 * b.side)) * Math.PI * 2; return b.deckY + 8 + (b.towerH - b.deckY - 8) * Math.pow(Math.abs(Math.cos(u)), 1.6) * (s < -b.side || s > span + b.side ? 0 : 1); }
      if (s < 0) return b.deckY + 2 + (b.towerH - b.deckY - 2) * Math.pow(Math.max(0, 1 + s / b.side), 1.7);
      if (s > span) return b.deckY + 2 + (b.towerH - b.deckY - 2) * Math.pow(Math.max(0, 1 - (s - span) / b.side), 1.7);
      const u = (s / span) * 2 - 1;
      return b.deckY + 7 + (b.towerH - b.deckY - 7) * u * u;
    };
    if (b.stone) {
      // masonry anchorages at the ends of the side spans
      mb.style(row, Surf.Blank, 0.5, 100);
      for (const s of [-b.side - 22, span + b.side + 22]) { const [ax, az] = at(s); mb.box(ax, 0, az, b.width + 16, b.deckY - 6, 48, Math.atan2(tz, tx)); mb.style(row, Surf.Trim, 0.5, 100); mb.box(ax, b.deckY - 6, az, b.width + 18, 1.6, 50, Math.atan2(tz, tx)); mb.style(row, Surf.Blank, 0.5, 100); }
      // inner pair of main cables, radiating diagonal stays from each tower, and close-set suspenders
      mb.style(steel, Surf.Dark, 0.5, 0);
      for (const o of [-0.17, 0.17]) for (let s = -b.side; s < span + b.side - 0.5; s += 12) {
        const e = Math.min(s + 12, span + b.side), [ax, az] = at(s, o * b.width), [bx, bz] = at(e, o * b.width);
        mb.beam(ax, cableY(s), az, bx, cableY(e), bz, 0.7, 0.7);
      }
      for (const o of [-0.5, -0.17, 0.17, 0.5]) for (let s = -b.side; s < span + b.side; s += 4) {
        const [ax, az] = at(s, o * b.width);
        if (cableY(s) - deckAt(s) > 2) mb.beam(ax, deckAt(s), az, ax, cableY(s), az, 0.1, 0.1);
      }
      for (const t of [0, span]) for (const o of [-0.5, 0.5]) for (let d = 14; d < 150; d += 9) for (const sg of [-1, 1]) {
        const s = t + sg * d; if (s < -b.side || s > span + b.side) continue;
        const [ax, az] = at(t, o * b.width), [bx, bz] = at(s, o * b.width);
        mb.beam(ax, b.towerH - 14, az, bx, deckAt(s) + 0.5, bz, 0.12, 0.12);
      }
    }
    for (const o of [-1, 1]) {
      for (let s = -b.side; s < span + b.side - 0.5; s += 12) {
        const e = Math.min(s + 12, span + b.side), [ax, az] = at(s, o * b.width * 0.5), [bx, bz] = at(e, o * b.width * 0.5);
        mb.beam(ax, cableY(s), az, bx, cableY(e), bz, b.truss ? 1.2 : 0.7, b.truss ? 1.2 : 0.7);
        if (cableY(s) - deckAt(s) > 3) mb.beam(ax, deckAt(s), az, ax, cableY(s), az, b.truss ? 0.5 : 0.16, b.truss ? 0.5 : 0.16);
        if (b.truss && cableY(e) - deckAt(e) > 3) mb.beam(ax, cableY(s), az, bx, deckAt(e), bz, 0.4, 0.4);
        if (Math.round(s / 12) % 2 === 0) lights.push(new THREE.Vector3(ax, cableY(s) + 0.6, az));
      }
    }
  }
  const mesh = facadeMesh(mb.build());
  group.add(mesh);
  // necklace lights
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 6, 5), beacon(0xfff0d0, 0, 4, false), lights.length);
  const m = new THREE.Matrix4();
  lights.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  im.computeBoundingSphere();
  group.add(im);
  parts.build(group);
  return group;
}
