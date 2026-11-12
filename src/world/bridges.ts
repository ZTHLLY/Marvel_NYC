import * as THREE from 'three';
import { ll } from '../city/geo';
import { StylePalette, Surf } from '../city/facade';
import { MeshBuilder } from '../city/meshBuilder';
import { beacon, facadeMesh } from '../landmarks/kit';

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
  const mb = new MeshBuilder(16384);
  const lights: THREE.Vector3[] = [];
  for (const b of BRIDGES) {
    const [x1, z1] = ll(...b.t1), [x2, z2] = ll(...b.t2);
    const span = Math.hypot(x2 - x1, z2 - z1), tx = (x2 - x1) / span, tz = (z2 - z1) / span, nx = -tz, nz = tx;
    const at = (s: number, o = 0): [number, number] => [x1 + tx * s + nx * o, z1 + tz * s + nz * o];
    const row = b.stone ? granite : steel;
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
        // twin gothic-arched granite towers reduced to their essential mass: three piers and a cap
        mb.style(row, Surf.Blank, 0.5, 200);
        for (const o of [-1, 0, 1]) { const [px, pz] = at(s, o * b.width * 0.42); mb.box(px, -3, pz, 6.5, b.towerH + 3, 13, ang); }
        mb.box(cx, b.towerH * 0.72, cz, b.width * 0.84 + 6.5, b.towerH * 0.28, 13, ang);
        mb.style(row, Surf.Trim, 0.5, 200); mb.box(cx, b.towerH, cz, b.width * 0.84 + 8.5, 2.2, 15, ang);
      } else {
        mb.style(row, Surf.Blank, 0.5, 200);
        for (const o of [-1, 1]) { const [px, pz] = at(s, o * b.width * 0.5); mb.box(px, -3, pz, 5, b.towerH + 3, 7.5, ang); }
        for (const hy of [b.deckY - 9, b.deckY + 22, b.towerH - 7]) mb.box(cx, hy, cz, b.width, 5, 5, ang);
        for (const o of [-1, 1]) { const [px, pz] = at(s, o * b.width * 0.5), [qx, qz] = at(s, -o * b.width * 0.5); mb.beam(px, b.deckY + 27, pz, qx, b.towerH - 7, qz, 1.4, 1.4); }
        mb.style(steel, Surf.Steel, 0.5, 200);
        for (const o of [-1, 1]) { const [px, pz] = at(s, o * b.width * 0.5); mb.cyl(px, b.towerH, pz, 1.6, 0.2, 9, 8, false); }
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
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 6, 5), beacon(0xfff0d0, 0, 7, false), lights.length);
  const m = new THREE.Matrix4();
  lights.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  im.computeBoundingSphere();
  group.add(im);
  return group;
}
