import * as THREE from 'three';
import { GRID_ANGLE, CROSSTOWN, UPTOWN } from '../city/geo';
import { StylePalette, Surf } from '../city/facade';
import { insetPoly, MeshBuilder, rectRing } from '../city/meshBuilder';
import { extendMaterial, pbr } from '../engine/materials';
import { SITES } from './sites';
import { beacon, extrude, Parts, prng, tileTexture, facadeMesh, loftGeometry, mergeFacade, panel, signMaterial, signTexture, superRing, yawFacing } from './kit';

export interface Anchor { pos: THREE.Vector3; yaw: number }

const insetRing = (r: ArrayLike<number>, d: number): Float32Array => insetPoly(r, d) ?? new Float32Array(r);

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
export function buildAvengersTower(palette: StylePalette): { group: THREE.Group; deck: Anchor } {
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
  const LOB = 11;
  mb.style(podium, Surf.Wall, 0.31, 52); mb.walls(pod, LOB, 53, 1.55);
  mb.style(podium, Surf.Roof, 0.31, 52); mb.cap(pod, 52);
  // street level: a recessed, double-height glass lobby under a colonnade of stone piers (Park Ave / 45th St / Vanderbilt)
  const lobby = rectRing(pcx, pcz, 46, 20, GRID_ANGLE, 7.5);
  mb.style(podium, Surf.Glass, 0.31, 52); mb.walls(lobby, 0, LOB, 0);
  mb.style(podium, Surf.Dark, 0.31, 52); mb.cap(pod, LOB, lobby, undefined, true);
  mb.style(podium, Surf.Trim, 0.31, 52);
  for (let i = 0; i < pod.length / 2; i++) {
    const j = (i + 1) % (pod.length / 2), ax = pod[i * 2], az = pod[i * 2 + 1], bx = pod[j * 2], bz = pod[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 6.2)), ang = Math.atan2(bz - az, bx - ax);
    for (let k = 0; k <= n; k++) { const t = k / n; mb.box(ax + (bx - ax) * t, 0, az + (bz - az) * t, 1.5, LOB, 1.5, ang); }
  }
  // stone band + cornice at the lobby head and a parapet cornice on the podium roof
  mb.walls(insetRing(pod, -0.35), LOB - 0.2, LOB + 1.6, 0); mb.cap(insetRing(pod, -0.35), LOB + 1.6);
  mb.walls(insetRing(pod, -0.6), 51.2, 53.6, 0); mb.cap(insetRing(pod, -0.6), 53.6);
  // entrance canopies on the Park Avenue (crosstown) faces
  mb.style(podium, Surf.Metal, 0.31, 52);
  for (const s of [-1, 1]) { const [cx, cz] = P(s * 49.5, 0); mb.box(cx, 6.2, cz, 6, 0.5, 24, GRID_ANGLE); }

  // main shaft: leans gently uptown as it climbs
  const shaft = [
    { y: 52, ring: ring(31, 19, 0) }, { y: 80, ring: ring(30.6, 19, 0) }, { y: 120, ring: ring(29.4, 18.6, -0.5) },
    { y: 160, ring: ring(27.6, 18, -1.8) }, { y: 200, ring: ring(25.4, 17.2, -4) }, { y: 236, ring: ring(23, 16, -7) },
    { y: 268, ring: ring(20.6, 14.4, -10.5) }, { y: 300, ring: ring(18, 12, -14.5) },
  ];
  geos.push(loftGeometry(shaft, glass, Surf.Wall, 0.42, 1.6, true, 300));
  // crown fin: a blade that continues the sweep to a point
  const fin = [
    { y: 300, ring: ring(16.5, 5.2, -21, 2.6) }, { y: 322, ring: ring(14.6, 4.7, -21.8, 2.6) }, { y: 344, ring: ring(11.4, 3.9, -22.6, 2.5) },
    { y: 364, ring: ring(7.4, 3.0, -23.2, 2.4) }, { y: 380, ring: ring(3.6, 2.0, -23.6, 2.2) }, { y: 392, ring: ring(1.0, 0.8, -23.8, 2) },
  ];
  geos.push(loftGeometry(fin, glass, Surf.Wall, 0.77, 1.6, true, 400));
  // vertical mullion fins standing proud of the curtain wall, following the sweep
  const pushOut = (sec: { y: number; ring: ArrayLike<number> }, k: number, d: number): [number, number, number] => {
    const n = sec.ring.length / 2; let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += sec.ring[i * 2]; cz += sec.ring[i * 2 + 1]; }
    cx /= n; cz /= n;
    const x = sec.ring[k * 2], z = sec.ring[k * 2 + 1], l = Math.hypot(x - cx, z - cz) || 1;
    return [x + ((x - cx) / l) * d, sec.y, z + ((z - cz) / l) * d];
  };
  mb.style(glass, Surf.Trim, 0.5, 400);
  for (let k = 0; k < 64; k += 2) {
    const big = k % 8 === 0;
    for (let i = 0; i < shaft.length - 1; i++) {
      const a = pushOut(shaft[i], k, big ? 0.55 : 0.28), b = pushOut(shaft[i + 1], k, big ? 0.55 : 0.28);
      mb.beam(a[0], a[1], a[2], b[0], b[1], b[2], big ? 0.45 : 0.22, big ? 1.1 : 0.55);
    }
  }
  // steel spines on the fin's leading edges
  mb.style(glass, Surf.Steel, 0.5, 400);
  for (const k of [0, 32]) for (let i = 0; i < fin.length - 1; i++) { const a = pushOut(fin[i], k, 0.3), b = pushOut(fin[i + 1], k, 0.3); mb.beam(a[0], a[1], a[2], b[0], b[1], b[2], 0.7, 0.9); }
  // mechanical / sky-lobby bands: louvred metal belts slightly proud of the glass
  const ringAtY = (secs: { y: number; ring: ArrayLike<number> }[], y: number, grow: number): Float32Array => {
    for (let i = 0; i < secs.length - 1; i++) {
      const a = secs[i], b = secs[i + 1];
      if (y < a.y || y > b.y) continue;
      const t = (y - a.y) / (b.y - a.y), n = a.ring.length / 2, r = new Float32Array(n * 2);
      for (let q = 0; q < n * 2; q++) r[q] = a.ring[q] + (b.ring[q] - a.ring[q]) * t;
      return insetRing(r, -grow);
    }
    return new Float32Array(secs[0].ring);
  };
  mb.style(glass, Surf.Metal, 0.5, 400);
  for (const y of [92, 180, 262]) { const r0 = ringAtY(shaft, y, 0.2), r1 = ringAtY(shaft, y + 5.5, 0.2); geos.push(loftGeometry([{ y, ring: r0 }, { y: y + 5.5, ring: r1 }], glass, Surf.Metal, 0.5, 0, false)); void r1; }
  // penthouse lounge on the terrace
  const [lx, lz] = P(0, -9.5);
  geos.push(loftGeometry([{ y: 300, ring: superRing(lx, lz, 12, 5.4, 2.4, 40, GRID_ANGLE) }, { y: 308.5, ring: superRing(lx, lz, 11.2, 5, 2.4, 40, GRID_ANGLE) }], glass, Surf.Glass, 0.2, 0, true));
  // spire
  const [sx, sz] = P(0, -23.8);
  mb.style(glass, Surf.Steel, 0.5, 400); mb.cyl(sx, 392, sz, 0.6, 0.08, 26, 8, false);

  // landing deck: disc cantilevered downtown-side, bridge back to the terrace, raking struts
  const padZ = 14.5, padY = 296.5, padR = 11.5;
  const [px, pz] = P(0, padZ);
  mb.style(glass, Surf.Metal, 0.5, 400);
  mb.cyl(px, padY - 1.4, pz, padR * 0.55, padR, 1.4, 40, false);
  mb.style(glass, Surf.Dark, 0.5, 400);
  mb.cyl(px, padY, pz, padR, padR, 0.25, 40, true);
  const [b0x, b0z] = P(0, -3.5), [b1x, b1z] = P(0, padZ - padR + 1.5);
  mb.style(glass, Surf.Metal, 0.5, 400);
  mb.beam(b0x, padY + 0.1, b0z, b1x, padY + 0.1, b1z, 5.5, 0.5);
  for (const s of [-1, 1]) {
    const [u0x, u0z] = P(s * 9, -5.5), [u1x, u1z] = P(s * 5.5, padZ - 2);
    mb.beam(u0x, 262, u0z, u1x, padY - 1.3, u1z, 1.1, 1.6);
    // deck-edge rails
    const [r0x, r0z] = P(s * 2.7, -3.5), [r1x, r1z] = P(s * 2.7, padZ - padR + 2);
    mb.beam(r0x, padY + 1.2, r0z, r1x, padY + 1.2, r1z, 0.08, 0.08);
  }
  // deck underside: radial girders, ring beam and a central drum; perimeter railing; hangar mouth in the tower
  mb.style(glass, Surf.Dark, 0.5, 400);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, ex = px + Math.cos(a) * (padR - 0.4), ez = pz + Math.sin(a) * (padR - 0.4);
    mb.beam(px + Math.cos(a) * 2, padY - 4.2, pz + Math.sin(a) * 2, ex, padY - 0.9, ez, 0.35, 0.9);
  }
  mb.cyl(px, padY - 6.5, pz, 2.6, 2.2, 5.2, 16, false);
  mb.style(glass, Surf.Metal, 0.5, 400);
  for (let k = 0; k < 48; k++) {
    const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
    mb.beam(px + Math.cos(a0) * padR * 0.75, padY - 1.9, pz + Math.sin(a0) * padR * 0.75, px + Math.cos(a1) * padR * 0.75, padY - 1.9, pz + Math.sin(a1) * padR * 0.75, 0.5, 0.6);
    // railing (left open where the bridge meets the deck)
    const am = (a0 + a1) / 2, bx = Math.cos(am) * CROSSTOWN[0] + Math.sin(am) * CROSSTOWN[1];
    void bx;
    const dir = [Math.cos(a0), Math.sin(a0)], toward = -(dir[0] * UPTOWN[0] + dir[1] * UPTOWN[1]);
    if (toward < -0.93) continue;
    mb.beam(px + Math.cos(a0) * (padR - 0.15), padY + 1.15, pz + Math.sin(a0) * (padR - 0.15), px + Math.cos(a1) * (padR - 0.15), padY + 1.15, pz + Math.sin(a1) * (padR - 0.15), 0.07, 0.07);
    mb.beam(px + Math.cos(a0) * (padR - 0.15), padY + 0.25, pz + Math.sin(a0) * (padR - 0.15), px + Math.cos(a0) * (padR - 0.15), padY + 1.15, pz + Math.sin(a0) * (padR - 0.15), 0.06, 0.06);
  }
  {
    const [hx, hz] = P(0, -2.2);
    mb.style(glass, Surf.Metal, 0.5, 400); mb.box(hx, padY + 7.0, hz, 9.4, 0.7, 1.6, GRID_ANGLE);
    for (const s of [-1, 1]) { const [qx, qz] = P(s * 4.3, -2.2); mb.box(qx, padY - 0.2, qz, 0.7, 7.3, 1.6, GRID_ANGLE); }
  }
  geos.push(mb.build());
  const body = facadeMesh(mergeFacade(geos));
  group.add(body);

  // ---- signature lighting (scales with the Marvel Landmark slider)
  const cool = beacon(0xbfe6ff, 0.22, 2.4);
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
  for (const y of [321, 343, 363, 379]) band(fin, y, 0.6, 0.2);
  for (const g of bandGeo) group.add(new THREE.Mesh(g, cool));
  // pad lights
  const ringLight = new THREE.Mesh(new THREE.TorusGeometry(padR - 0.5, 0.12, 6, 64), cool);
  ringLight.rotation.x = Math.PI / 2; ringLight.position.set(px, padY + 0.3, pz);
  group.add(ringLight);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(padR * 0.55, 0.09, 6, 48), warm);
  inner.rotation.x = Math.PI / 2; inner.position.set(px, padY + 0.3, pz);
  group.add(inner);
  // perimeter landing lights (green/white alternating) and the hangar's lit interior
  const lightsW = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.18, 0.35), beacon(0xe8f6ff, 0.3, 4), 24);
  const lightsG = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.18, 0.35), beacon(0x5cff9a, 0.3, 4), 24);
  const mtx = new THREE.Matrix4();
  for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; mtx.makeTranslation(px + Math.cos(a) * (padR - 0.9), padY + 0.32, pz + Math.sin(a) * (padR - 0.9)); (k % 2 ? lightsG : lightsW).setMatrixAt(k >> 1, mtx); }
  lightsW.computeBoundingSphere(); lightsG.computeBoundingSphere();
  group.add(lightsW, lightsG);
  {
    const [hx, hz] = P(0, -1.55);
    const hangar = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 6.8), beacon(0x9fc8e8, 0.35, 1.6));
    hangar.position.set(hx, padY + 3.3, hz); hangar.rotation.y = YAW_DOWNTOWN;
    group.add(hangar);
  }
  // the mark: on the downtown face of the fin, on the pad, and facing uptown
  const logoTex = avengersLogoTexture();
  const logoMat = signMaterial(logoTex, { night: 3.4, day: 1.25, scaleWith: 'landmark', transparent: true });
  const mkLogo = (lzOff: number, y: number, size: number, flip: boolean) => {
    const [x, z] = P(flip ? -0.8 : 0.8, lzOff);
    const m = panel(size, size, logoMat);
    m.position.set(x, y, z); m.rotation.y = YAW_DOWNTOWN + (flip ? Math.PI : 0);
    group.add(m);
  };
  mkLogo(-21.9 + 4.85, 323, 19, false);
  mkLogo(-21.9 - 4.85, 323, 19, true);
  const padLogo = panel(11, 11, logoMat);
  padLogo.rotation.set(-Math.PI / 2, 0, -YAW_DOWNTOWN); padLogo.position.set(px, padY + 0.29, pz);
  group.add(padLogo);
  // aviation beacon
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), beacon(0xff3a2a, 1.5, 6));
  tip.position.set(sx, 418.5, sz);
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
  return { group, deck: { pos: new THREE.Vector3(ix, padY + 0.25, iz), yaw: YAW_DOWNTOWN - 0.35 } };
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
  // chrome-nickel mullion strips running the height of the shaft between the limestone piers
  mb.style(row, Surf.Steel, 0.5, 266);
  const strips = (cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, bay: number) => {
    for (const [ax, az, len, nx, nz] of [[CROSSTOWN, UPTOWN, hx, UPTOWN, hz], [UPTOWN, CROSSTOWN, hz, CROSSTOWN, hx]] as const) {
      const n = Math.floor((len * 2) / bay);
      for (let k = 1; k < n; k++) {
        const t = -len + (k * len * 2) / n;
        for (const s of [-1, 1]) {
          const x = cx + ax[0] * t + nx[0] * s * (nz + 0.12), z = cz + ax[1] * t + nx[1] * s * (nz + 0.12);
          mb.beam(x, y0, z, x, y1, z, 0.32, 0.24);
        }
      }
    }
  };
  strips(site.x, site.z, 29.5, 20.5, 116.5, 266, 2.5);
  for (const s of [-1, 1]) strips(site.x + CROSSTOWN[0] * s * 33, site.z + CROSSTOWN[1] * s * 33, 5, 14.5, 116.5, 232, 2.5);
  strips(site.x, site.z, 26, 18.5, 266.3, 285, 2.5); strips(site.x, site.z, 22.5, 16.5, 285.2, 303.7, 2.5);
  // mooring mast
  mb.style(row, Surf.Wall, 0.5, 337); mb.walls(rectRing(site.x, site.z, 9, 9, GRID_ANGLE, 3.2), 318.75, 337.5, 2.5);
  mb.style(row, Surf.Roof, 0.5, 337); mb.cap(rectRing(site.x, site.z, 9, 9, GRID_ANGLE, 3.2), 337.5);
  mb.style(row, Surf.Steel, 0.5, 500);
  mb.cyl(site.x, 337.5, site.z, 6.2, 5.2, 22, 16, true);
  mb.cyl(site.x, 359.5, site.z, 5.6, 5.6, 2, 16, true);
  mb.cyl(site.x, 361.5, site.z, 4.2, 2.2, 12, 16, true);
  mb.cyl(site.x, 373.5, site.z, 2.2, 1.2, 8, 12, true);
  // the mast's four winged buttresses and its vertical fins
  mb.style(row, Surf.Steel, 0.5, 500);
  for (const [dx, dz] of [CROSSTOWN, UPTOWN, [-CROSSTOWN[0], -CROSSTOWN[1]], [-UPTOWN[0], -UPTOWN[1]]] as const) {
    for (const off of [-2.2, 2.2]) {
      const tx = -dz, tz = dx;
      const bx = site.x + dx * 6.4 + tx * off, bz = site.z + dz * 6.4 + tz * off;
      mb.beam(bx + dx * 3.2, 337.6, bz + dz * 3.2, bx, 352, bz, 0.8, 1.2);
    }
  }
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; const x = site.x + Math.cos(a) * 6.0, z = site.z + Math.sin(a) * 6.0; mb.beam(x, 337.5, z, site.x + Math.cos(a) * 5.35, 359.5, site.z + Math.sin(a) * 5.35, 0.35, 0.45); }
  mb.style(row, Surf.Dark, 0.5, 500);
  mb.cyl(site.x, 381.5, site.z, 0.9, 0.25, 62, 8, false);
  for (const y of [395, 410, 425]) mb.cyl(site.x, y, site.z, 1.3, 1.3, 0.8, 8, true);
  group.add(facadeMesh(mb.build()));
  // the floodlit top: each setback washed from below, brightest toward the crown (additive, invisible by day)
  {
    const pos: number[] = [], col: number[] = [];
    const wash = (hx: number, hz: number, y0: number, y1: number, k0: number, k1: number, ch = 0) => {
      const r = rectRing(site.x, site.z, hx + 0.35, hz + 0.35, GRID_ANGLE, ch);
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
        for (const k of [k0, k0, k1, k0, k1, k1]) col.push(k, k * 0.96, k * 0.86);
      }
    };
    wash(29.5, 20.5, 236, 266.2, 0.0, 0.25);
    wash(26, 18.5, 266.25, 285, 0.05, 0.5); wash(22.5, 16.5, 285, 303.75, 0.1, 0.7); wash(19, 14, 303.75, 318.75, 0.15, 0.85);
    wash(9, 9, 318.75, 337.5, 0.3, 1.0, 3.2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = beacon(0xffffff, 0.0, 0.42, false); m.vertexColors = true; m.side = THREE.DoubleSide;
    group.add(new THREE.Mesh(g, m));
  }
  // the famous tower lights
  const glowMat = beacon(0xfff2d8, 0.02, 0.9, false);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(6.35, 6.5, 20, 16, 1, true), glowMat);
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
  // stainless crown: seven terraced, slightly pointed arches on each face (two crossed barrel extrusions per terrace),
  // a sunburst of triangular windows following every arch (lit after dark), then the needle spire
  const glowMat = beacon(0xfff4dc, 0.0, 2.2, false);
  const e1: [number, number, number] = [CROSSTOWN[0], 0, CROSSTOWN[1]], e2: [number, number, number] = [UPTOWN[0], 0, UPTOWN[1]];
  const up: [number, number, number] = [0, 1, 0];
  const tri: number[] = [];
  const base = 262.7;
  let topY = base;
  mb.style(row, Surf.Steel, 0.3, 500);
  for (let k = 0; k < 7; k++) {
    const r = 11.3 - k * 1.42, yB = base + 1.2 + k * 3.35, rise = r * 0.92, foot = yB - 4.2;
    const prof: number[] = [-r, foot, r, foot];
    const S = 18;
    for (let i = 0; i <= S; i++) { const a = (i / S) * Math.PI; prof.push(Math.cos(a) * r, yB + Math.pow(Math.sin(a), 0.75) * rise); }
    const o: [number, number, number] = [site.x, 0, site.z];
    extrude(mb, prof, o, e1, up, e2, -r - 0.04, r + 0.04);
    extrude(mb, prof, o, e2, up, e1, -r - 0.08, r + 0.08);
    topY = yB + rise;
    // triangular windows on the four faces
    const n = Math.max(3, 9 - k);
    for (const [fa, fn, sg] of [[e1, e2, 1], [e1, e2, -1], [e2, e1, 1], [e2, e1, -1]] as const) {
      const d = (fa === e1 ? r + 0.04 : r + 0.08) * sg + 0.06 * sg;
      for (let i = 1; i < n; i++) {
        const a = (i / n) * Math.PI, w = (Math.PI / n) * 0.22;
        const P = (aa: number, rr: number): number[] => {
          const u = Math.cos(aa) * rr, y = yB + Math.pow(Math.max(0, Math.sin(aa)), 0.75) * rise * (rr / r);
          return [site.x + fa[0] * u + fn[0] * d, y, site.z + fa[2] * u + fn[2] * d];
        };
        tri.push(...P(a - w, r * 0.87), ...P(a + w, r * 0.87), ...P(a, r * 0.985));
      }
    }
  }
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const m = glowMat; m.side = THREE.DoubleSide;
    group.add(new THREE.Mesh(g, m));
  }
  mb.style(row, Surf.Steel, 0.3, 500);
  mb.cyl(site.x, topY - 1, site.z, 1.2, 0.06, 318.9 - topY + 1, 8, false);
  // eagle-head gargoyles at the 61st-floor setback and winged radiator caps at the 31st
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const dx = CROSSTOWN[0] * sx + UPTOWN[0] * sz, dz = CROSSTOWN[1] * sx + UPTOWN[1] * sz;
    const cx = site.x + dx * 16.3, cz = site.z + dz * 16.3;
    mb.beam(cx - dx * 1.2, 236.4, cz - dz * 1.2, cx + dx * 3.6, 235.6, cz + dz * 3.6, 1.3, 1.5);
    mb.beam(cx + dx * 3.2, 235.4, cz + dz * 3.2, cx + dx * 4.4, 234.6, cz + dz * 4.4, 0.5, 0.6);
    const rx = site.x + dx * 22.2, rz = site.z + dz * 22.2;
    mb.beam(rx - dx * 0.8, 118.6, rz - dz * 0.8, rx + dx * 2.2, 118.9, rz + dz * 2.2, 0.9, 1.1);
    for (const A of [CROSSTOWN, UPTOWN]) { const sg = A[0] * dx + A[1] * dz > 0 ? 1 : -1; mb.beam(rx - A[0] * sg * 3.2, 118.6, rz - A[1] * sg * 3.2, rx, 119.6, rz, 0.4, 0.25); }
  }
  group.add(facadeMesh(mb.build()));
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

/** The pre-war tower that carries the rooftop-panorama vantage point. Returns the parapet-corner anchor. */
export function buildRooftopTower(palette: StylePalette): { group: THREE.Group; perch: Anchor } {
  const site = SITES.rooftop;
  const group = new THREE.Group();
  group.name = 'rooftop-tower';
  const row = palette.addCustom({ win: [0.4, 0.56], bay: 2.7, floor: 3.4, wall: 0x8a6a58, wallType: 0, glass: 0x333c44, glassRough: 0.16, frame: 0x26282a, frameW: 0.09, ground: 6, lit: 0.42, warm: 0.8, coh: 0.1, pier: 0.5, spandrel: 0.35, sill: 0.8, crown: 0.5, roof: 0x3c3a38, storefront: 0.9, accent: 0x2e6a4a, feature: 0 });
  const mb = new MeshBuilder(8192);
  decoTiers(mb, site, row, 0.9, [[0, 142.0, 15.5, 13.5], [142.0, 169.2, 12.6, 10.6], [169.2, 189.6, 9.2, 8.2]], 2.7);
  const yT = 189.6;
  const stone = palette.addCustom({ win: [0.3, 0.5], bay: 3, floor: 4, wall: 0xb5aa98, wallType: 1, glass: 0x333c44, glassRough: 0.16, frame: 0x26282a, frameW: 0.09, ground: 4, lit: 0, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 0, crown: 0, roof: 0x3c3a38, storefront: 0, accent: 0x2e6a4a, feature: 0 });
  const L = (lx: number, lz: number) => toWorld(site, lx, lz);
  // stone coping & corner piers on the top parapet (the vantage point)
  mb.style(stone, Surf.Blank, 0.9, yT + 2);
  const outer = rectRing(site.x, site.z, 9.45, 8.45, GRID_ANGLE), inner = rectRing(site.x, site.z, 8.75, 7.75, GRID_ANGLE);
  mb.walls(outer, yT + 0.7, yT + 0.88, 0);
  mb.cap(outer, yT + 0.88, inner);
  const innerRev = new Float32Array(8); for (let i = 0; i < 4; i++) { innerRev[i * 2] = inner[(3 - i) * 2]; innerRev[i * 2 + 1] = inner[(3 - i) * 2 + 1]; }
  mb.style(row, Surf.Blank, 0.9, yT + 2); mb.walls(innerRev, yT, yT + 0.88, 0);
  // coping stones with open joints, drip overhang both sides
  mb.style(stone, Surf.Trim, 0.9, yT + 2);
  const RY = -GRID_ANGLE;
  for (const [ax, az, bx2, bz2] of [[-9.1, -8.1, 9.1, -8.1], [-9.1, 8.1, 9.1, 8.1], [-9.1, -8.1, -9.1, 8.1], [9.1, -8.1, 9.1, 8.1]]) {
    const len = Math.hypot(bx2 - ax, bz2 - az), n = Math.round(len / 1.15), alongX = az === bz2;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, [cx, cz] = L(ax + (bx2 - ax) * t, az + (bz2 - az) * t), bl = len / n - 0.014;
      mb.box(cx, yT + 0.88, cz, alongX ? bl : 0.86, 0.13, alongX ? 0.86 : bl, GRID_ANGLE);
    }
  }
  mb.style(stone, Surf.Blank, 0.9, yT + 2);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const [x, z] = L(sx * 8.95, sz * 7.95);
    mb.box(x, yT + 0.2, z, 1.1, 1.05, 1.1, GRID_ANGLE);
    mb.box(x, yT + 1.25, z, 1.32, 0.14, 1.32, GRID_ANGLE);
    mb.box(x, yT + 1.39, z, 1.12, 0.1, 1.12, GRID_ANGLE);
  }
  const parts = new Parts();
  const W3 = (lx: number, y: number, lz: number): [number, number, number] => { const [x, z] = L(lx, lz); return [x, y, z]; };
  const galv = pbr({ color: 0x8a8e90, roughness: 0.45, metalness: 0.8 }), rust = pbr({ color: 0x4a3226, roughness: 0.8, metalness: 0.3 });
  const blackIron = pbr({ color: 0x1c1d1f, roughness: 0.6, metalness: 0.5 }), flash = pbr({ color: 0x5a5c5e, roughness: 0.5, metalness: 0.6 });
  const tar = pbr({ color: 0x1e1d1c, roughness: 0.9 }), white = pbr({ color: 0xc8c8c2, roughness: 0.5, metalness: 0.2 });
  // modified-bitumen roof: lapped sheets, seams, patches, gravel, ponding stains
  const roofTex = tileTexture(512, 512, (c, w, h) => {
    const r = prng(23);
    c.fillStyle = '#4a4846'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const g = 50 + r() * 70; c.fillStyle = `rgba(${g},${g * 0.97},${g * 0.92},0.5)`; c.fillRect(r() * w, r() * h, 1.5, 1.5); }
    for (let x = 0; x < w; x += 102) { c.fillStyle = 'rgba(20,20,20,0.55)'; c.fillRect(x, 0, 5, h); c.fillStyle = 'rgba(120,118,112,0.25)'; c.fillRect(x + 5, 0, 3, h); }
    for (let i = 0; i < 7; i++) { c.fillStyle = `rgba(28,27,26,${0.45 + r() * 0.3})`; const pw = 30 + r() * 90, ph = 30 + r() * 70; c.fillRect(r() * w, r() * h, pw, ph); }
    for (let i = 0; i < 5; i++) { const g = c.createRadialGradient(r() * w, r() * h, 2, r() * w, r() * h, 60 + r() * 80); g.addColorStop(0, 'rgba(20,18,16,0.35)'); g.addColorStop(1, 'rgba(20,18,16,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }
  });
  roofTex.repeat.set(1 / 5, 1 / 5);
  const roofMat = extendMaterial(new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.88 }), { key: 'roof-membrane', weather: true });
  parts.add(new THREE.PlaneGeometry(17.5, 15.5).scale(1, 1, 1), roofMat, ...W3(0, yT + 0.03, 0), -Math.PI / 2, RY, 0);
  // base flashing up the inside of the parapet, scuppers with leaders and stains
  for (const [lx, lz, sx, sz] of [[0, -7.7, 17.4, 0.08], [0, 7.7, 17.4, 0.08], [-8.7, 0, 0.08, 15.4], [8.7, 0, 0.08, 15.4]]) parts.box(flash, ...W3(lx, yT + 0.2, lz), sx, 0.36, sz, 0, RY, 0);
  for (const [lx, lz] of [[-4.5, -7.72], [4.0, 7.72], [-8.72, 3.0]]) { parts.box(blackIron, ...W3(lx, yT + 0.12, lz), 0.32, 0.18, 0.32, 0, RY, 0); }
  // water tank: cedar staves with steel hoops, conical roof + finial, ladder, outflow & riser pipes, steel dunnage
  const [tx, tz] = L(-3.6, 2.6);
  mb.style(row, Surf.Dark, 0.9, yT);
  for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const [qx, qz] = L(-3.6 + ox * 1.3, 2.6 + oz * 1.3); mb.beam(qx, yT, qz, qx, yT + 3.6, qz, 0.22); }
  for (const oz of [-1.3, 0, 1.3]) { const [a1, a2] = L(-5.3, 2.6 + oz), [b1, b2] = L(-1.9, 2.6 + oz); mb.beam(a1, yT + 3.45, a2, b1, yT + 3.45, b2, 0.18, 0.3); }
  for (const s2 of [-1, 1]) { const [a1, a2] = L(-3.6 - 1.3, 2.6 + s2 * 1.3), [b1, b2] = L(-3.6 + 1.3, 2.6 - s2 * 1.3); mb.beam(a1, yT + 0.4, a2, b1, yT + 3.2, b2, 0.08); }
  mb.style(row, Surf.Wood, 0.9, yT); mb.cyl(tx, yT + 3.6, tz, 2.1, 2.0, 3.9, 28, false);
  mb.style(row, Surf.Dark, 0.9, yT); mb.cyl(tx, yT + 7.5, tz, 2.3, 0.08, 1.4, 28, false);
  for (let k = 0; k < 7; k++) parts.add(new THREE.TorusGeometry(2.08 - k * 0.012, 0.025, 4, 40), blackIron, tx, yT + 3.8 + k * 0.58, tz, Math.PI / 2, 0, 0);
  parts.add(new THREE.SphereGeometry(0.12, 8, 6), blackIron, tx, yT + 8.95, tz);
  { const a = L(-3.6 + 1.6, 2.6 - 1.6), b = L(-3.6 + 1.4, 2.6 - 1.4);
    for (const off of [-0.22, 0.22]) parts.rod(blackIron, [a[0] + CROSSTOWN[0] * off, yT, a[1] + CROSSTOWN[1] * off], [b[0] + CROSSTOWN[0] * off, yT + 8.4, b[1] + CROSSTOWN[1] * off], 0.02, 4);
    for (let y = 0.3; y < 8.3; y += 0.3) { const t = y / 8.4, x0 = a[0] + (b[0] - a[0]) * t, z0 = a[1] + (b[1] - a[1]) * t; parts.rod(blackIron, [x0 - CROSSTOWN[0] * 0.22, yT + y, z0 - CROSSTOWN[1] * 0.22], [x0 + CROSSTOWN[0] * 0.22, yT + y, z0 + CROSSTOWN[1] * 0.22], 0.012, 3); } }
  parts.rod(rust, W3(-3.6, yT + 3.6, 2.6), W3(-3.6, yT + 0.4, 2.6), 0.1, 8);
  parts.rod(rust, W3(-3.6, yT + 0.4, 2.6), W3(1.2, yT + 0.4, 2.6), 0.1, 8);
  parts.rod(rust, W3(1.2, yT + 0.4, 2.6), W3(1.2, yT + 0.03, 2.6), 0.1, 8);
  for (let x = -2.4; x < 1.2; x += 1.2) parts.box(blackIron, ...W3(x, yT + 0.18, 2.6), 0.12, 0.3, 0.3, 0, RY, 0);
  // stair bulkhead: brick with stone cap, steel door, caged bulkhead light, tar-paper roof
  const [bx, bz] = L(3.4, 3.2);
  mb.style(row, Surf.Blank, 0.9, yT + 3); mb.box(bx, yT, bz, 3.4, 3, 4.2, GRID_ANGLE);
  mb.style(stone, Surf.Trim, 0.9, yT + 3); mb.box(bx, yT + 3, bz, 3.6, 0.14, 4.4, GRID_ANGLE);
  parts.box(pbr({ color: 0x3a4a3e, roughness: 0.55, metalness: 0.4 }), ...W3(3.4, yT + 1.08, 3.2 - 2.12), 0.95, 2.1, 0.06, 0, RY, 0);
  parts.box(blackIron, ...W3(3.4, yT + 2.25, 3.2 - 2.14), 1.15, 0.08, 0.08, 0, RY, 0);
  parts.add(new THREE.SphereGeometry(0.09, 10, 8), beacon(0xffd9a0, 0.1, 6, false), ...W3(3.4, yT + 2.5, 3.2 - 2.22));
  parts.box(blackIron, ...W3(3.4, yT + 2.5, 3.2 - 2.14), 0.2, 0.22, 0.12, 0, RY, 0);
  // HVAC condensers with fan grilles, ducts and conduit runs on sleepers
  for (const [lx, lz] of [[-5.0, -4.6], [-1.6, -4.6]]) {
    for (const dx2 of [-0.9, 0.9]) parts.box(blackIron, ...W3(lx + dx2, yT + 0.1, lz), 0.12, 0.16, 1.6, 0, RY, 0);
    mb.style(row, Surf.Metal, 0.9, yT); { const [cx, cz] = L(lx, lz); mb.box(cx, yT + 0.18, cz, 2.3, 1.15, 1.25, GRID_ANGLE); }
    for (const dx2 of [-0.52, 0.52]) {
      parts.add(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20), blackIron, ...W3(lx + dx2, yT + 1.35, lz));
      for (let k = 0; k < 4; k++) parts.box(galv, ...W3(lx + dx2, yT + 1.31, lz), 0.76, 0.015, 0.09, 0, RY + (k * Math.PI) / 4, 0);
    }
    parts.rod(blackIron, W3(lx + 1.15, yT + 0.6, lz), W3(lx + 1.6, yT + 0.6, lz), 0.03, 4);
    parts.rod(blackIron, W3(lx + 1.6, yT + 0.6, lz), W3(lx + 1.6, yT + 0.6, 3.2 - 2.1), 0.03, 4);
  }
  mb.style(row, Surf.Metal, 0.9, yT);
  { const [cx, cz] = L(2.5, -3.8); mb.box(cx, yT + 0.2, cz, 2.6, 1.5, 1.8, GRID_ANGLE); }
  parts.box(galv, ...W3(2.5, yT + 1.95, -3.8), 0.7, 0.5, 0.7, 0, RY, 0);
  parts.box(galv, ...W3(2.5, yT + 1.25, -1.8), 0.6, 0.45, 2.4, 0, RY, 0);
  // vent stacks with rain caps, a satellite dish, skylight, steel guardrail at the roof hatch
  for (const [lx, lz, hh] of [[-6.6, -1.2, 1.1], [-6.9, -0.4, 0.8], [0.4, -6.4, 0.9], [6.4, 0.5, 1.2]]) {
    parts.cyl(galv, ...W3(lx, yT, lz), 0.07, 0.07, hh, 10);
    parts.add(new THREE.ConeGeometry(0.16, 0.12, 12), galv, ...W3(lx, yT + hh + 0.12, lz));
    parts.cyl(tar, ...W3(lx, yT, lz), 0.18, 0.12, 0.12, 12);
  }
  { const p = W3(6.6, yT + 1.45, -5.6);
    parts.rod(blackIron, W3(6.6, yT + 0.3, -5.6), p, 0.035, 6);
    parts.box(blackIron, ...W3(6.6, yT + 0.15, -5.6), 0.6, 0.3, 0.6, 0, RY, 0);
    parts.add(new THREE.SphereGeometry(0.45, 18, 8, 0, Math.PI * 2, 0, 0.75), white, p[0], p[1] + 0.25, p[2], 1.1, RY + 0.6, 0);
    parts.rod(blackIron, [p[0], p[1] + 0.25, p[2]], W3(6.6 - 0.25, yT + 2.0, -5.95), 0.012, 3); }
  { const [sx2, sz2] = L(-0.4, 5.0);
    mb.style(row, Surf.Dark, 0.9, yT); mb.box(sx2, yT, sz2, 2.0, 0.35, 1.4, GRID_ANGLE);
    mb.style(row, Surf.Glass, 0.9, yT); mb.pyramid(rectRing(sx2, sz2, 1.0, 0.7, GRID_ANGLE), yT + 0.35, sx2, yT + 0.85, sz2); }
  for (const [ax2, az2, bx3, bz3] of [[5.0, 0.6, 5.0, -1.6], [5.0, -1.6, 1.8, -1.6]]) {
    parts.rod(galv, W3(ax2, yT + 1.07, az2), W3(bx3, yT + 1.07, bz3), 0.024, 6);
    parts.rod(galv, W3(ax2, yT + 0.55, az2), W3(bx3, yT + 0.55, bz3), 0.018, 6);
    for (const [px2, pz2] of [[ax2, az2], [bx3, bz3]]) parts.rod(galv, W3(px2, yT, pz2), W3(px2, yT + 1.07, pz2), 0.024, 6);
  }
  parts.build(group);
  group.add(facadeMesh(mb.build()));
  // vantage: the uptown / east corner pier, looking toward the Empire State Building
  const [px, pz] = L(8.95, -7.95);
  return { group, perch: { pos: new THREE.Vector3(px, yT + 1.49, pz), yaw: yawFacing(UPTOWN[0] * 0.98 + CROSSTOWN[0] * 0.2, UPTOWN[1] * 0.98 + CROSSTOWN[1] * 0.2) } };
}
