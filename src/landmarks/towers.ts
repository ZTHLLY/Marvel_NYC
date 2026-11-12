import * as THREE from 'three';
import { GRID_ANGLE, CROSSTOWN, UPTOWN } from '../city/geo';
import { StylePalette, Surf } from '../city/facade';
import { MeshBuilder, rectRing } from '../city/meshBuilder';
import { pbr } from '../engine/materials';
import { SITES } from './sites';
import { beacon, facadeMesh, loftGeometry, mergeFacade, panel, signMaterial, signTexture, superRing, yawFacing } from './kit';

export interface Anchor { pos: THREE.Vector3; yaw: number }

/** local (crosstown, downtown) offsets → world x/z */
const toWorld = (site: { x: number; z: number }, lx: number, lz: number): [number, number] =>
  [site.x + CROSSTOWN[0] * lx - UPTOWN[0] * lz, site.z + CROSSTOWN[1] * lx - UPTOWN[1] * lz];
/** yaw for a mesh whose local +Z should face "downtown" (+lz) */
const YAW_DOWNTOWN = yawFacing(-UPTOWN[0], -UPTOWN[1]);

function avengersLogoTexture(): THREE.CanvasTexture {
  // Original stylised "A" mark: a ring broken by a bold arrow-barred capital A.
  return signTexture({
    w: 512, h: 512, bg: 'rgba(0,0,0,0)',
    draw: (c, w) => {
      c.clearRect(0, 0, w, w);
      c.strokeStyle = '#eaf6ff'; c.fillStyle = '#eaf6ff'; c.lineCap = 'butt';
      c.lineWidth = 44; c.beginPath(); c.arc(256, 262, 190, -Math.PI * 0.33, Math.PI * 1.38); c.stroke();
      c.beginPath(); c.moveTo(196, 470); c.lineTo(300, 40); c.lineTo(372, 40); c.lineTo(372, 470); c.lineTo(308, 470); c.lineTo(308, 360); c.lineTo(262, 360); c.lineTo(240, 470); c.closePath(); c.fill();
      c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.moveTo(308, 300); c.lineTo(308, 170); c.lineTo(276, 300); c.closePath(); c.fill();
      c.globalCompositeOperation = 'source-over';
      c.beginPath(); c.moveTo(300, 300); c.lineTo(452, 300); c.lineTo(452, 268); c.lineTo(506, 330); c.lineTo(452, 392); c.lineTo(452, 360); c.lineTo(300, 360); c.closePath(); c.fill();
    },
  });
}

/** Avengers Tower: a swept glass tower rising from the old Pan Am podium, with crown fin and landing deck. */
export function buildAvengersTower(palette: StylePalette): { group: THREE.Group; ironman: Anchor } {
  const site = SITES.avengers;
  const group = new THREE.Group();
  group.name = 'avengers-tower';
  const glass = palette.addCustom({ win: [0.965, 0.8], bay: 1.6, floor: 4.0, wall: 0x7f97ad, wallType: 4, glass: 0xa9c6e2, glassRough: 0.045, frame: 0xdfe5ea, frameW: 0.03, ground: 0, lit: 0.55, warm: 0.3, coh: 0.6, pier: 0, spandrel: 0.22, sill: 0, crown: 0, roof: 0x55585c, storefront: 0, accent: 0x9fd8ff, feature: 0 });
  const podium = palette.addCustom({ win: [0.58, 0.62], bay: 1.55, floor: 4.0, wall: 0xb9b2a4, wallType: 2, glass: 0x4f6474, glassRough: 0.1, frame: 0x2e3033, frameW: 0.06, ground: 9, lit: 0.5, warm: 0.3, coh: 0.8, pier: 0.5, spandrel: 0.35, sill: 0, crown: 0, roof: 0x6a6c6e, storefront: 0.9, accent: 0x9fd8ff, feature: 0 });
  const geos: THREE.BufferGeometry[] = [];
  const mb = new MeshBuilder(4096);
  const P = (lx: number, lz: number) => toWorld(site, lx, lz);
  const ring = (a: number, b: number, off: number, n = 3.4) => { const [cx, cz] = P(0, off); return superRing(cx, cz, a, b, n, 64, GRID_ANGLE); };

  // podium: the elongated octagon of the old 200 Park Avenue slab
  const [pcx, pcz] = P(0, 0);
  const pod = rectRing(pcx, pcz, 49, 23, GRID_ANGLE, 9);
  mb.style(podium, Surf.Wall, 0.31, 52); mb.walls(pod, 0, 53, 1.55);
  mb.style(podium, Surf.Roof, 0.31, 52); mb.cap(pod, 52);

  // main shaft: leans gently uptown as it climbs
  const shaft = [
    { y: 52, ring: ring(31, 19, 0) }, { y: 80, ring: ring(30.4, 18.9, 0) }, { y: 120, ring: ring(29, 18.5, -0.3) },
    { y: 160, ring: ring(27.3, 18, -1) }, { y: 200, ring: ring(25.4, 17.3, -2.4) }, { y: 236, ring: ring(23.4, 16.4, -4.2) },
    { y: 268, ring: ring(21.4, 15.2, -6.6) }, { y: 300, ring: ring(19.2, 13.2, -9.5) },
  ];
  geos.push(loftGeometry(shaft, glass, Surf.Wall, 0.42, 1.6, true, 300));
  // crown fin: a blade that continues the sweep to a point
  const fin = [
    { y: 300, ring: ring(17.5, 7.6, -14.2, 2.6) }, { y: 318, ring: ring(15.6, 6.9, -14.9, 2.6) }, { y: 336, ring: ring(12.6, 5.8, -15.6, 2.5) },
    { y: 352, ring: ring(8.6, 4.4, -16.1, 2.4) }, { y: 364, ring: ring(4.6, 2.8, -16.4, 2.2) }, { y: 371, ring: ring(1.4, 1.1, -16.5, 2) },
  ];
  geos.push(loftGeometry(fin, glass, Surf.Wall, 0.77, 1.6, true, 400));
  // penthouse lounge on the terrace
  const [lx, lz] = P(0, -3.2);
  geos.push(loftGeometry([{ y: 300, ring: superRing(lx, lz, 12, 5.4, 2.4, 40, GRID_ANGLE) }, { y: 308.5, ring: superRing(lx, lz, 11.2, 5, 2.4, 40, GRID_ANGLE) }], glass, Surf.Glass, 0.2, 0, true));
  // spire
  const [sx, sz] = P(0, -16.5);
  mb.style(glass, Surf.Steel, 0.5, 400); mb.cyl(sx, 371, sz, 0.7, 0.08, 24, 8, false);

  // landing deck: disc cantilevered downtown-side, bridge back to the terrace, raking struts
  const padZ = 21.5, padY = 296.5, padR = 11.5;
  const [px, pz] = P(0, padZ);
  mb.style(glass, Surf.Metal, 0.5, 400);
  mb.cyl(px, padY - 1.4, pz, padR * 0.55, padR, 1.4, 40, false);
  mb.style(glass, Surf.Dark, 0.5, 400);
  mb.cyl(px, padY, pz, padR, padR, 0.25, 40, true);
  const [b0x, b0z] = P(0, 3), [b1x, b1z] = P(0, padZ - padR + 1.5);
  mb.style(glass, Surf.Metal, 0.5, 400);
  mb.beam(b0x, padY + 0.1, b0z, b1x, padY + 0.1, b1z, 5.5, 0.5);
  for (const s of [-1, 1]) {
    const [u0x, u0z] = P(s * 9, -1.5), [u1x, u1z] = P(s * 5.5, padZ - 2);
    mb.beam(u0x, 262, u0z, u1x, padY - 1.3, u1z, 1.1, 1.6);
    // deck-edge rails
    const [r0x, r0z] = P(s * 2.7, 3), [r1x, r1z] = P(s * 2.7, padZ - padR + 2);
    mb.beam(r0x, padY + 1.2, r0z, r1x, padY + 1.2, r1z, 0.08, 0.08);
  }
  geos.push(mb.build());
  const body = facadeMesh(mergeFacade(geos));
  group.add(body);

  // ---- signature lighting (scales with the Marvel Landmark slider)
  const cool = beacon(0xbfe6ff, 0.55, 3.2);
  const warm = beacon(0xfff0d0, 0.25, 2.6);
  const bandGeo: THREE.BufferGeometry[] = [];
  const band = (sections: { y: number; ring: ArrayLike<number> }[], y: number, h: number, grow: number) => {
    // interpolate the loft radius at height y, pushed slightly proud of the glass
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i], b = sections[i + 1];
      if (y < a.y || y > b.y) continue;
      const t = (y - a.y) / (b.y - a.y);
      const n = a.ring.length / 2;
      let cx = 0, cz = 0;
      const r = new Float32Array(n * 2);
      for (let k = 0; k < n * 2; k++) r[k] = a.ring[k] + (b.ring[k] - a.ring[k]) * t;
      for (let k = 0; k < n; k++) { cx += r[k * 2]; cz += r[k * 2 + 1]; }
      cx /= n; cz /= n;
      const pos: number[] = [], idx: number[] = [];
      for (let k = 0; k < n; k++) {
        const dx = r[k * 2] - cx, dz = r[k * 2 + 1] - cz, l = Math.hypot(dx, dz);
        const x = r[k * 2] + (dx / l) * grow, z = r[k * 2 + 1] + (dz / l) * grow;
        pos.push(x, y, z, x, y + h, z);
      }
      for (let k = 0; k < n; k++) { const j = (k + 1) % n; idx.push(k * 2, j * 2 + 1, j * 2, k * 2, k * 2 + 1, j * 2 + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      bandGeo.push(g);
    }
  };
  for (const y of [52.5, 96, 140, 184, 228, 268, 299]) band(shaft, y, 0.9, 0.25);
  for (const y of [317, 335, 351]) band(fin, y, 0.6, 0.2);
  for (const g of bandGeo) group.add(new THREE.Mesh(g, cool));
  // pad lights
  const ringLight = new THREE.Mesh(new THREE.TorusGeometry(padR - 0.5, 0.12, 6, 64), cool);
  ringLight.rotation.x = Math.PI / 2; ringLight.position.set(px, padY + 0.3, pz);
  group.add(ringLight);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(padR * 0.55, 0.09, 6, 48), warm);
  inner.rotation.x = Math.PI / 2; inner.position.set(px, padY + 0.3, pz);
  group.add(inner);
  // the mark: on the downtown face of the fin, on the pad, and facing uptown
  const logoTex = avengersLogoTexture();
  const logoMat = signMaterial(logoTex, { night: 3.4, day: 1.25, scaleWith: 'landmark', transparent: true });
  const mkLogo = (lzOff: number, y: number, size: number, flip: boolean) => {
    const [x, z] = P(flip ? -0.8 : 0.8, lzOff);
    const m = panel(size, size, logoMat);
    m.position.set(x, y, z); m.rotation.y = YAW_DOWNTOWN + (flip ? Math.PI : 0);
    group.add(m);
  };
  mkLogo(-14.9 + 7.35, 322, 17, false);
  mkLogo(-14.9 - 7.35, 322, 17, true);
  const padLogo = panel(11, 11, logoMat);
  padLogo.rotation.set(-Math.PI / 2, 0, -YAW_DOWNTOWN); padLogo.position.set(px, padY + 0.29, pz);
  group.add(padLogo);
  // aviation beacon
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), beacon(0xff3a2a, 1.5, 6));
  tip.position.set(sx, 395.5, sz);
  group.add(tip);
  // a quinjet-like aircraft parked on the deck: sleek lifting-body silhouette
  const jet = new THREE.Group();
  const hull = pbr({ color: 0x3a4048, roughness: 0.35, metalness: 0.85 });
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 6.2, 6, 14), hull);
  fus.rotation.x = Math.PI / 2; fus.scale.set(1.25, 1, 0.72); fus.position.y = 1.55;
  const wingShape = new THREE.Shape([new THREE.Vector2(0, 2.2), new THREE.Vector2(5.4, -1.4), new THREE.Vector2(5.4, -2.6), new THREE.Vector2(1.2, -3.2), new THREE.Vector2(0, -3)]);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: false });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, hull);
    w.rotation.x = -Math.PI / 2; w.scale.x = s; w.position.set(s * 0.9, 1.75, 0.4); w.rotation.z = 0; w.rotation.y = 0;
    jet.add(w);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 2.2), hull);
    tail.position.set(s * 1.5, 2.7, 3.0); tail.rotation.z = -s * 0.5;
    jet.add(tail);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 2.6, 12), hull);
    eng.rotation.x = Math.PI / 2; eng.position.set(s * 2.3, 1.7, 1.6);
    jet.add(eng);
  }
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), pbr({ color: 0x0c1218, roughness: 0.08, metalness: 0.95 }));
  canopy.scale.set(1.15, 0.6, 1.9); canopy.position.set(0, 2.05, -2.6);
  jet.add(fus, canopy);
  for (const [gx, gz] of [[0, -2.6], [-1.6, 2], [1.6, 2]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6), hull); leg.position.set(gx, 0.45, gz); jet.add(leg); }
  jet.traverse((o) => { o.castShadow = true; });
  const [jx, jz] = P(-2.6, padZ + 1.5);
  jet.position.set(jx, padY + 0.25, jz); jet.rotation.y = YAW_DOWNTOWN + Math.PI + 0.5;
  group.add(jet);

  const [ix, iz] = P(4.6, padZ + 5.2);
  return { group, ironman: { pos: new THREE.Vector3(ix, padY + 0.25, iz), yaw: YAW_DOWNTOWN - 0.35 } };
}

/** Baxter Building: a luminous rounded tower crowned by the Fantastic Four's ringed launch drum. */
export function buildBaxter(palette: StylePalette): THREE.Group {
  const site = SITES.baxter;
  const group = new THREE.Group();
  group.name = 'baxter-building';
  const skin = palette.addCustom({ win: [0.9, 0.56], bay: 1.9, floor: 4.1, wall: 0xe4e6e8, wallType: 3, glass: 0x7fb4d8, glassRough: 0.05, frame: 0xf2f4f6, frameW: 0.05, ground: 9, lit: 0.6, warm: 0.2, coh: 0.75, pier: 0.3, spandrel: 0.0, sill: 0, crown: 0, roof: 0x8a8d90, storefront: 1, accent: 0x3aa0ff, feature: 3 });
  const R = (a: number, b: number, n = 4.5) => superRing(site.x, site.z, a, b, n, 56, GRID_ANGLE);
  const geos: THREE.BufferGeometry[] = [];
  geos.push(loftGeometry([{ y: 0, ring: R(24, 22, 6) }, { y: 22, ring: R(24, 22, 6) }], skin, Surf.Wall, 0.11, 1.9, true));
  geos.push(loftGeometry([{ y: 22, ring: R(19, 17.5) }, { y: 120, ring: R(19, 17.5) }, { y: 148, ring: R(18.2, 16.8) }], skin, Surf.Wall, 0.23, 1.9, true));
  // recessed neck, then the launch drum
  geos.push(loftGeometry([{ y: 148, ring: R(13.5, 13.5, 2) }, { y: 154, ring: R(13.5, 13.5, 2) }], skin, Surf.Metal, 0.3, 0, false));
  geos.push(loftGeometry([{ y: 154, ring: R(20.5, 20.5, 2) }, { y: 157, ring: R(21.5, 21.5, 2) }, { y: 176, ring: R(21.5, 21.5, 2) }, { y: 181, ring: R(19, 19, 2) }], skin, Surf.Wall, 0.61, 1.9, true, 400));
  const mb = new MeshBuilder(1024);
  mb.style(skin, Surf.Dark, 0.5, 400); mb.cyl(site.x, 181, site.z, 11, 11, 0.5, 32, true);      // silo doors
  mb.style(skin, Surf.Metal, 0.5, 400); mb.cyl(site.x, 181, site.z, 13.2, 12.6, 2.2, 32, false);
  mb.style(skin, Surf.Steel, 0.5, 400);
  mb.cyl(site.x + 14, 181, site.z + 6, 0.5, 0.12, 30, 6, false);
  mb.cyl(site.x - 12, 181, site.z - 9, 0.35, 0.1, 18, 6, false);
  geos.push(mb.build());
  group.add(facadeMesh(mergeFacade(geos)));
  // glowing equator & the emblem
  const blue = beacon(0x58b8ff, 0.7, 4);
  for (const [y, r] of [[156.2, 21.75], [177, 21.75], [148.5, 18.4], [22.4, 19.3]] as const) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.28, 6, 72), blue);
    t.rotation.x = Math.PI / 2; t.position.set(site.x, y, site.z);
    if (y < 150 && y > 100) t.scale.set(1, 17 / 18.4, 1);
    if (y < 30) t.scale.set(1, 17.9 / 19.3, 1);
    t.rotation.z = -GRID_ANGLE;
    group.add(t);
  }
  const four = signTexture({
    w: 512, h: 512, bg: 'rgba(0,0,0,0)',
    draw: (c) => {
      c.clearRect(0, 0, 512, 512);
      c.fillStyle = '#0b2e55'; c.beginPath(); c.arc(256, 256, 244, 0, 7); c.fill();
      c.strokeStyle = '#dff2ff'; c.lineWidth = 30; c.beginPath(); c.arc(256, 256, 214, 0, 7); c.stroke();
    },
    lines: [{ text: '4', size: 330, y: 0.54, color: '#eaf7ff', weight: 900 }],
  });
  const fourMat = signMaterial(four, { night: 3.2, day: 1.1, scaleWith: 'landmark', transparent: true });
  for (let k = 0; k < 4; k++) {
    const a = GRID_ANGLE + (k * Math.PI) / 2;
    const m = panel(15, 15, fourMat);
    m.position.set(site.x + Math.sin(a) * 21.8, 166.5, site.z + Math.cos(a) * 21.8);
    m.rotation.y = a;
    group.add(m);
  }
  return group;
}

/** Shared recipe for Art-Deco icons built from stepped tiers. */
function decoTiers(mb: MeshBuilder, site: { x: number; z: number }, row: number, seed: number, tiers: [number, number, number, number, number?][], bay: number) {
  // [yBottom, yTop, halfX(crosstown), halfZ(avenue), chamfer]
  for (const [y0, y1, hx, hz, ch] of tiers) {
    const ring = rectRing(site.x, site.z, hx, hz, GRID_ANGLE, ch ?? 0);
    mb.style(row, Surf.Wall, seed, y1); mb.walls(ring, y0, y1 + 0.9, bay);
    mb.style(row, Surf.Roof, seed, y1); mb.cap(ring, y1);
  }
}

export function buildEmpireState(palette: StylePalette): THREE.Group {
  const site = SITES.empire;
  const group = new THREE.Group();
  group.name = 'empire-state';
  const row = palette.addCustom({ win: [0.4, 0.62], bay: 2.5, floor: 3.75, wall: 0xc4b9a4, wallType: 1, glass: 0x3c4852, glassRough: 0.14, frame: 0x55595c, frameW: 0.08, ground: 7.5, lit: 0.36, warm: 0.6, coh: 0.3, pier: 0.9, spandrel: 0.75, sill: 0.1, crown: 1, roof: 0x55524c, storefront: 0.9, accent: 0xfff0c8, feature: 0 });
  const mb = new MeshBuilder(8192);
  decoTiers(mb, site, row, 0.5, [
    [0, 22.5, 64, 28.5], [22.5, 82.5, 50, 25], [82.5, 97.5, 44, 22.5], [97.5, 116.25, 38, 20.5], [116.25, 266.25, 29.5, 20.5],
    [266.25, 285, 26, 18.5], [285, 303.75, 22.5, 16.5], [303.75, 318.75, 19, 14],
  ], 2.5);
  // flanking shoulders that give the shaft its buttressed look
  for (const s of [-1, 1]) {
    const cx = site.x + CROSSTOWN[0] * s * 33, cz = site.z + CROSSTOWN[1] * s * 33;
    const ring = rectRing(cx, cz, 5, 14.5, GRID_ANGLE);
    mb.style(row, Surf.Wall, 0.5, 232); mb.walls(ring, 116.25, 232.9, 2.5);
    mb.style(row, Surf.Roof, 0.5, 232); mb.cap(ring, 232);
  }
  // mooring mast
  mb.style(row, Surf.Wall, 0.5, 337); mb.walls(rectRing(site.x, site.z, 9, 9, GRID_ANGLE, 3.2), 318.75, 337.5, 2.5);
  mb.style(row, Surf.Roof, 0.5, 337); mb.cap(rectRing(site.x, site.z, 9, 9, GRID_ANGLE, 3.2), 337.5);
  mb.style(row, Surf.Steel, 0.5, 500);
  mb.cyl(site.x, 337.5, site.z, 6.2, 5.2, 22, 16, true);
  mb.cyl(site.x, 359.5, site.z, 5.6, 5.6, 2, 16, true);
  mb.cyl(site.x, 361.5, site.z, 4.2, 2.2, 12, 16, true);
  mb.cyl(site.x, 373.5, site.z, 2.2, 1.2, 8, 12, true);
  mb.style(row, Surf.Dark, 0.5, 500);
  mb.cyl(site.x, 381.5, site.z, 0.9, 0.25, 62, 8, false);
  group.add(facadeMesh(mb.build()));
  // the famous tower lights
  const glowMat = beacon(0xfff2d8, 0.02, 2.2, false);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 6.5, 20, 16, 1, true), glowMat);
  lamp.position.set(site.x, 348.5, site.z);
  group.add(lamp);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), beacon(0xff3a2a, 1.5, 6, false));
  tip.position.set(site.x, 444, site.z);
  group.add(tip);
  return group;
}

export function buildChrysler(palette: StylePalette): THREE.Group {
  const site = SITES.chrysler;
  const group = new THREE.Group();
  group.name = 'chrysler';
  const row = palette.addCustom({ win: [0.42, 0.6], bay: 2.4, floor: 3.7, wall: 0xcfccc6, wallType: 0, glass: 0x38434c, glassRough: 0.14, frame: 0x2b2d2f, frameW: 0.08, ground: 7, lit: 0.34, warm: 0.55, coh: 0.3, pier: 0.7, spandrel: 0.8, sill: 0.1, crown: 0.8, roof: 0x4c4a46, storefront: 0.9, accent: 0xfff0c8, feature: 0 });
  const mb = new MeshBuilder(8192);
  decoTiers(mb, site, row, 0.3, [
    [0, 51.8, 31, 30.5], [51.8, 88.8, 27, 26], [88.8, 118.4, 22.5, 22], [118.4, 236.8, 16.5, 16.5, 1.5], [236.8, 251.6, 14, 14, 3], [251.6, 262.7, 11.5, 11.5, 3.4],
  ], 2.4);
  // stainless sunburst crown: seven diminishing arches approximated by a faceted ogive
  mb.style(row, Surf.Steel, 0.3, 500);
  const steps = 9;
  let y = 262.7;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const r0 = 11.3 * (1 - Math.pow(t0, 1.55)) + 0.9, r1 = 11.3 * (1 - Math.pow(t1, 1.55)) + 0.9;
    const h = 5.2 - i * 0.12;
    mb.cyl(site.x, y, site.z, r0, r1 * 0.985 + 0.2, h, 8, false);
    y += h;
  }
  mb.cyl(site.x, y, site.z, 1.05, 0.06, 318.9 - y, 8, false);
  group.add(facadeMesh(mb.build()));
  // triangular crown windows glow after dark
  const glowMat = beacon(0xfff4dc, 0.0, 2.6, false);
  for (let i = 1; i < 7; i++) {
    const t = i / steps;
    const r = 11.3 * (1 - Math.pow(t, 1.55)) + 1.05;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.99, r * 1.0, 0.5, 8, 1, true), glowMat);
    ring.position.set(site.x, 262.7 + i * 5.1 + 1.2, site.z);
    ring.rotation.y = Math.PI / 8 - GRID_ANGLE;
    group.add(ring);
  }
  return group;
}

/** Daily Bugle: a setback press tower with its unmistakable rooftop letters. */
export async function buildBugle(palette: StylePalette): Promise<THREE.Group> {
  const site = SITES.bugle;
  const group = new THREE.Group();
  group.name = 'daily-bugle';
  const row = palette.addCustom({ win: [0.44, 0.6], bay: 2.5, floor: 3.6, wall: 0xb9a183, wallType: 0, glass: 0x3a444c, glassRough: 0.14, frame: 0x2e2c28, frameW: 0.08, ground: 6.5, lit: 0.6, warm: 0.5, coh: 0.5, pier: 0.7, spandrel: 0.6, sill: 0.3, crown: 0.9, roof: 0x4a4844, storefront: 1, accent: 0xd8a038, feature: 0 });
  const mb = new MeshBuilder(4096);
  decoTiers(mb, site, row, 0.7, [[0, 28.1, 24, 21], [28.1, 78.5, 20, 17.5], [78.5, 100.1, 16.5, 14.5], [100.1, 118.1, 13, 11.5, 1.5]], 2.5);
  // sign gantry
  const yR = 118.1;
  mb.style(row, Surf.Dark, 0.7, 500);
  const L = (lx: number, lz: number) => toWorld(site, lx, lz);
  for (const lz of [-10.5, 10.5]) {
    for (let k = -4; k <= 4; k++) {
      const [x, z] = L(k * 3, lz * 0.92), [x2, z2] = L(k * 3, lz * 0.92 - Math.sign(lz) * 3);
      mb.beam(x, yR, z, x, yR + 9.4, z, 0.22);
      mb.beam(x2, yR, z2, x, yR + 6.5, z, 0.14);
    }
    for (const hy of [1.2, 5, 9.2]) { const [a, b] = L(-12.4, lz * 0.92), [c, d] = L(12.4, lz * 0.92); mb.beam(a, yR + hy, b, c, yR + hy, d, 0.16); }
  }
  group.add(facadeMesh(mb.build()));
  // rooftop letters (canvas-lit channel letters on both street faces)
  const mk = (text: string, w: number, h: number, size: number) => signTexture({
    w, h, bg: 'rgba(0,0,0,0)', draw: (c) => c.clearRect(0, 0, w, h),
    lines: [{ text, size, y: 0.52, color: '#fff1d6', weight: 900, font: '"Arial Black", "Helvetica Neue", Impact, sans-serif', spacing: 6 }],
  });
  const top = signMaterial(mk('DAILY', 1024, 256, 215), { night: 3.0, day: 1.0, transparent: true });
  const bot = signMaterial(mk('BUGLE', 1024, 256, 215), { night: 3.0, day: 1.0, transparent: true });
  for (const s of [-1, 1]) {
    const [x, z] = L(0, s * 10.5 * 0.92 + s * 0.2);
    const a = panel(22, 5.5, top); a.position.set(x, yR + 7.3, z); a.rotation.y = YAW_DOWNTOWN + (s < 0 ? Math.PI : 0);
    const b = panel(22, 5.5, bot); b.position.set(x, yR + 2.9, z); b.rotation.y = a.rotation.y;
    group.add(a, b);
  }
  // marquee over the entrance + vertical blade sign
  const marquee = signMaterial(signTexture({ w: 1024, h: 128, bg: '#14110c', lines: [{ text: 'THE DAILY BUGLE  •  NEW YORK’S FINEST DAILY NEWSPAPER', size: 58, y: 0.52, color: '#ffd98a', weight: 800 }] }), { night: 2.4, day: 0.6 });
  const [mx, mz] = L(0, 21.25);
  const mq = panel(30, 3.4, marquee); mq.position.set(mx, 8.4, mz); mq.rotation.y = YAW_DOWNTOWN;
  group.add(mq);
  const blade = signMaterial(signTexture({ w: 128, h: 1024, bg: '#7d1410', draw: (c) => { c.save(); c.translate(64, 512); c.rotate(Math.PI / 2); c.font = '900 92px "Arial Black", Arial'; c.fillStyle = '#fff3dc'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('DAILY BUGLE', 0, 0); c.restore(); } }), { night: 2.6, day: 0.7 });
  const [bx, bz] = L(24.4, 16);
  const bl = panel(3, 22, blade); bl.position.set(bx, 26, bz); bl.rotation.y = YAW_DOWNTOWN;
  const bl2 = panel(3, 22, blade); bl2.position.copy(bl.position); bl2.rotation.y = YAW_DOWNTOWN + Math.PI;
  group.add(bl, bl2);
  return group;
}

/** The pre-war tower whose parapet Spider-Man perches on. Returns the perch anchor. */
export function buildPerchTower(palette: StylePalette): { group: THREE.Group; perch: Anchor } {
  const site = SITES.spidey;
  const group = new THREE.Group();
  group.name = 'perch-tower';
  const row = palette.addCustom({ win: [0.4, 0.56], bay: 2.7, floor: 3.4, wall: 0x9a6b52, wallType: 0, glass: 0x333c44, glassRough: 0.16, frame: 0x26282a, frameW: 0.09, ground: 6, lit: 0.42, warm: 0.8, coh: 0.1, pier: 0.5, spandrel: 0.35, sill: 0.8, crown: 0.5, roof: 0x3c3a38, storefront: 0.9, accent: 0x2e6a4a, feature: 0 });
  const mb = new MeshBuilder(8192);
  decoTiers(mb, site, row, 0.9, [[0, 91.0, 15.5, 13.5], [91.0, 108.0, 12.6, 10.6], [108.0, 125.0, 9.2, 8.2]], 2.7);
  const yT = 125;
  const L = (lx: number, lz: number) => toWorld(site, lx, lz);
  // stone coping & corner piers on the top parapet (the perch)
  mb.style(row, Surf.Trim, 0.9, yT + 2);
  const outer = rectRing(site.x, site.z, 9.45, 8.45, GRID_ANGLE), inner = rectRing(site.x, site.z, 8.75, 7.75, GRID_ANGLE);
  mb.cap(outer, yT + 0.95, inner);
  mb.walls(outer, yT + 0.7, yT + 0.95, 0);
  const innerRev = new Float32Array(8); for (let i = 0; i < 4; i++) { innerRev[i * 2] = inner[(3 - i) * 2]; innerRev[i * 2 + 1] = inner[(3 - i) * 2 + 1]; }
  mb.style(row, Surf.Blank, 0.9, yT + 2); mb.walls(innerRev, yT, yT + 0.95, 0);
  mb.style(row, Surf.Trim, 0.9, yT + 2);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const [x, z] = L(sx * 8.95, sz * 7.95);
    mb.box(x, yT + 0.2, z, 1.35, 1.25, 1.35, GRID_ANGLE);
    mb.box(x, yT + 1.45, z, 1.6, 0.18, 1.6, GRID_ANGLE);
  }
  // rooftop kit: water tank on steel dunnage, bulkhead, vents
  const [tx, tz] = L(-3.6, 2.6);
  mb.style(row, Surf.Dark, 0.9, yT);
  for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) mb.beam(tx + ox * 1.3, yT, tz + oz * 1.3, tx + ox * 1.3, yT + 3.6, tz + oz * 1.3, 0.2);
  mb.beam(tx - 1.3, yT + 1.8, tz - 1.3, tx + 1.3, yT + 1.8, tz + 1.3, 0.1); mb.beam(tx + 1.3, yT + 1.8, tz - 1.3, tx - 1.3, yT + 1.8, tz + 1.3, 0.1);
  mb.style(row, Surf.Wood, 0.9, yT); mb.cyl(tx, yT + 3.6, tz, 2.1, 2.0, 3.9, 18, false);
  mb.style(row, Surf.Dark, 0.9, yT); mb.cyl(tx, yT + 7.5, tz, 2.25, 0.06, 1.3, 18, false);
  const [bx, bz] = L(3.4, 3.2);
  mb.style(row, Surf.Blank, 0.9, yT + 3); mb.box(bx, yT, bz, 3.4, 3, 4.2, GRID_ANGLE);
  mb.style(row, Surf.Metal, 0.9, yT);
  const [vx, vz] = L(2.5, -3.8); mb.box(vx, yT + 0.2, vz, 2.6, 1.5, 1.8, GRID_ANGLE);
  const [dx, dz] = L(-5, -4.4); mb.cyl(dx, yT, dz, 0.4, 0.4, 1.6, 10, true);
  group.add(facadeMesh(mb.build()));
  // perch: the uptown / east corner pier, looking toward the Empire State Building
  const [px, pz] = L(8.95, -7.95);
  return { group, perch: { pos: new THREE.Vector3(px, yT + 1.63, pz), yaw: yawFacing(UPTOWN[0] * 0.9 + CROSSTOWN[0] * 0.45, UPTOWN[1] * 0.9 + CROSSTOWN[1] * 0.45) } };
}
