import * as THREE from 'three';
import type { CityData } from '../city/geo';
import { StylePalette, Surf } from '../city/facade';
import { MeshBuilder, rectRing } from '../city/meshBuilder';
import { extendMaterial, pbr, U } from '../engine/materials';
import { SITES } from './sites';
import { beacon, facadeMesh, panel, signMaterial, signTexture, yawFacing } from './kit';
import type { Anchor } from './towers';

export interface SanctumBuild {
  group: THREE.Group;
  clear: { x: number; z: number; r: number }[];
  strange: Anchor;
  strangeAlt: Anchor;
  lights: THREE.PointLight[];
  mandala: THREE.Mesh;
  /** local → world helper for composing camera bookmarks */
  toWorld: (x: number, y: number, z: number) => THREE.Vector3;
}

const ROAD_HALF = 4.6, SIDEWALK = 3.5;

function sigilTexture(): THREE.CanvasTexture {
  // An original take on the Sanctum's great round window: a leaded-glass eye of sweeping arcs.
  return signTexture({
    w: 512, h: 512, bg: '#000',
    draw: (c) => {
      const g = c.createRadialGradient(256, 256, 20, 256, 256, 256);
      g.addColorStop(0, '#ffe2a6'); g.addColorStop(0.55, '#f2a654'); g.addColorStop(1, '#8a4a1c');
      c.fillStyle = g; c.beginPath(); c.arc(256, 256, 256, 0, 7); c.fill();
      c.strokeStyle = '#1a120c'; c.lineCap = 'round';
      c.lineWidth = 20; c.beginPath(); c.arc(256, 256, 244, 0, 7); c.stroke();
      c.lineWidth = 15;
      // three long sweeping arcs crossing the disc, and a pair of counter-curves
      c.beginPath(); c.arc(256, -150, 520, Math.PI * 0.31, Math.PI * 0.69); c.stroke();
      c.beginPath(); c.arc(-170, 256, 560, -Math.PI * 0.24, Math.PI * 0.24); c.stroke();
      c.beginPath(); c.arc(700, 256, 520, Math.PI * 0.77, Math.PI * 1.23); c.stroke();
      c.lineWidth = 12;
      c.beginPath(); c.moveTo(60, 150); c.quadraticCurveTo(256, 290, 452, 150); c.stroke();
      c.beginPath(); c.moveTo(256, 14); c.lineTo(256, 498); c.stroke();
      c.lineWidth = 8;
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.beginPath(); c.moveTo(256 + Math.cos(a) * 214, 256 + Math.sin(a) * 214); c.lineTo(256 + Math.cos(a) * 244, 256 + Math.sin(a) * 244); c.stroke(); }
    },
  });
}

function mandalaTexture(): THREE.CanvasTexture {
  return signTexture({
    w: 512, h: 512, bg: '#000',
    draw: (c) => {
      c.strokeStyle = '#ffb04a'; c.lineWidth = 5; c.shadowColor = '#ff7a1a'; c.shadowBlur = 14;
      for (const r of [240, 222, 150, 138, 70]) { c.beginPath(); c.arc(256, 256, r, 0, 7); c.stroke(); }
      c.lineWidth = 4;
      for (let k = 0; k < 2; k++) { c.save(); c.translate(256, 256); c.rotate((k * Math.PI) / 4); c.strokeRect(-150, -150, 300, 300); c.restore(); }
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        c.save(); c.translate(256 + Math.cos(a) * 186, 256 + Math.sin(a) * 186); c.rotate(a + Math.PI / 2);
        c.beginPath(); c.moveTo(-9, -12); c.lineTo(9, -12); c.lineTo(i % 3 ? 0 : 9, 12); c.lineTo(-9, i % 2 ? 12 : 0); c.stroke(); c.restore();
      }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; c.beginPath(); c.moveTo(256 + Math.cos(a) * 70, 256 + Math.sin(a) * 70); c.lineTo(256 + Math.cos(a + 0.4) * 138, 256 + Math.sin(a + 0.4) * 138); c.stroke(); }
    },
  });
}

function windowTexture(): THREE.CanvasTexture {
  return signTexture({
    w: 256, h: 512, bg: ['#f3c98a', '#b9793c'],
    draw: (c, w, h) => {
      // heavy drapes and a lamp glow, behind leaded muntins
      c.fillStyle = 'rgba(70,24,18,0.82)';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.36, 0); c.quadraticCurveTo(w * 0.3, h * 0.5, w * 0.08, h); c.lineTo(0, h); c.fill();
      c.beginPath(); c.moveTo(w, 0); c.lineTo(w * 0.64, 0); c.quadraticCurveTo(w * 0.7, h * 0.5, w * 0.92, h); c.lineTo(w, h); c.fill();
      c.fillStyle = '#17110c';
      c.fillRect(w / 2 - 6, 0, 12, h); c.fillRect(0, h * 0.36 - 5, w, 10); c.fillRect(0, h * 0.68 - 5, w, 10);
      c.strokeStyle = '#17110c'; c.lineWidth = 18; c.strokeRect(0, 0, w, h);
    },
  });
}

function shopInteriorTexture(): THREE.CanvasTexture {
  return signTexture({
    w: 1024, h: 512, bg: ['#e9b06a', '#7a4a26'],
    draw: (c, w, h) => {
      c.fillStyle = '#3a2416'; c.fillRect(0, h * 0.62, w, h * 0.38);                 // counter front
      c.fillStyle = '#5a3a22'; c.fillRect(0, h * 0.58, w, h * 0.05);
      for (let s = 0; s < 3; s++) { c.fillStyle = '#4a2e1a'; c.fillRect(w * 0.05, h * (0.1 + s * 0.14), w * 0.5, 8); for (let i = 0; i < 16; i++) { c.fillStyle = ['#d8d2c4', '#8a3a2a', '#2e5a4a', '#c89a4a', '#3a3a3a'][(i * 7 + s) % 5]; c.fillRect(w * 0.06 + i * w * 0.03, h * (0.1 + s * 0.14) - 30, w * 0.02, 30); } }
      c.fillStyle = '#1c1c1c'; c.fillRect(w * 0.62, h * 0.08, w * 0.3, h * 0.3);     // menu board
      c.fillStyle = '#e8e2d0'; c.font = '700 26px Georgia'; c.fillText('ESPRESSO  3', w * 0.64, h * 0.16); c.fillText('CORTADO  4', w * 0.64, h * 0.23); c.fillText('CHAI  4', w * 0.64, h * 0.3);
      for (const x of [0.2, 0.45, 0.7, 0.88]) {                                       // pendant lamps
        c.strokeStyle = '#1a1a1a'; c.lineWidth = 3; c.beginPath(); c.moveTo(w * x, 0); c.lineTo(w * x, h * 0.2); c.stroke();
        const g = c.createRadialGradient(w * x, h * 0.24, 2, w * x, h * 0.24, 70); g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(1, 'rgba(255,200,120,0)');
        c.fillStyle = g; c.beginPath(); c.arc(w * x, h * 0.24, 70, 0, 7); c.fill();
      }
      c.fillStyle = '#2a1a10'; c.beginPath(); c.arc(w * 0.33, h * 0.5, 34, 0, 7); c.fill(); c.fillRect(w * 0.33 - 44, h * 0.53, 88, 90);   // barista silhouette
      c.fillStyle = '#16100a'; c.fillRect(w * 0.76, h * 0.42, 90, 110);             // espresso machine
    },
  });
}

/** Sanctum Sanctorum on the north side of Bleecker St, with a coffee shop across the street. */
export function buildSanctum(palette: StylePalette, data: CityData): SanctumBuild {
  const site = SITES.sanctum;
  // ---- snap to the real Bleecker Street centreline
  let best = { d: Infinity, px: site.x, pz: site.z, tx: 1, tz: 0 };
  for (const r of data.roads) {
    if (r.n !== 'BLEECKER ST') continue;
    for (let i = 0; i < r.pts.length / 2 - 1; i++) {
      const ax = r.pts[i * 2], az = r.pts[i * 2 + 1], bx = r.pts[i * 2 + 2], bz = r.pts[i * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az) || 1, tx = (bx - ax) / L, tz = (bz - az) / L;
      const t = Math.max(0, Math.min(L, (site.x - ax) * tx + (site.z - az) * tz));
      const px = ax + tx * t, pz = az + tz * t, d = Math.hypot(site.x - px, site.z - pz);
      if (d < best.d) best = { d, px, pz, tx, tz };
    }
  }
  // street normal pointing to the north side; the Sanctum faces the opposite way (toward the street)
  let nx = best.tz, nz = -best.tx;
  if (nz > 0) { nx = -nx; nz = -nz; }
  const group = new THREE.Group();
  group.name = 'sanctum';
  group.position.set(best.px + nx * (ROAD_HALF + SIDEWALK), 0, best.pz + nz * (ROAD_HALF + SIDEWALK));
  group.rotation.y = yawFacing(-nx, -nz);
  group.updateMatrixWorld(true);
  const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld);
  const STREET = (ROAD_HALF + SIDEWALK) * 2;      // z of the opposite building line

  const brick = palette.addCustom({ win: [0.3, 0.56], bay: 2.6, floor: 4.0, wall: 0x5f382d, wallType: 0, glass: 0x2a3036, glassRough: 0.16, frame: 0x1c1a18, frameW: 0.1, ground: 4.4, lit: 0.35, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 1, crown: 0, roof: 0x2e3238, storefront: 0, accent: 0x7a2a2a, feature: 0 });
  const stone = palette.addCustom({ win: [0.3, 0.5], bay: 3, floor: 4, wall: 0xa89078, wallType: 1, glass: 0x2a3036, glassRough: 0.16, frame: 0x1c1a18, frameW: 0.1, ground: 4, lit: 0, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 0, crown: 0, roof: 0x2e3238, storefront: 0, accent: 0x7a2a2a, feature: 0 });
  const slate = palette.addCustom({ win: [0.3, 0.5], bay: 3, floor: 4, wall: 0x2c2e33, wallType: 2, glass: 0x2a3036, glassRough: 0.16, frame: 0x1c1a18, frameW: 0.1, ground: 4, lit: 0, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 0, crown: 0, roof: 0x2e3238, storefront: 0, accent: 0x7a2a2a, feature: 0 });
  const shopBrick = palette.addCustom({ win: [0.42, 0.56], bay: 2.6, floor: 3.4, wall: 0x7a4838, wallType: 0, glass: 0x2e363c, glassRough: 0.16, frame: 0xe2ddd0, frameW: 0.09, ground: 0, lit: 0.55, warm: 0.9, coh: 0, pier: 0, spandrel: 0, sill: 1, crown: 0, roof: 0x3a3a3c, storefront: 0, accent: 0x2e6a4a, feature: 0 });

  const mb = new MeshBuilder(16384);
  const W = 7.5, D = 17, H = 12.6, RT = 17.0;
  const BOX = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => mb.box(x, y, z, sx, sy, sz, 0);
  // ---- Sanctum shell: plain brick front (bespoke openings are added in relief), shader windows on the flanks
  const shell = rectRing(0, -D / 2, W, D / 2, 0);
  mb.style(brick, Surf.Wall, 0.4, H); mb.walls(shell, 0, H, 2.6);
  // cover the front with a blank brick skin so the hand-built window bays read cleanly
  mb.style(brick, Surf.Blank, 0.4, H);
  mb.face([[-W, 0, 0.04], [W, 0, 0.04], [W, H, 0.04], [-W, H, 0.04]]);
  // rusticated stone ground floor, belt courses, quoins
  mb.style(stone, Surf.Blank, 0.4, 4.4);
  for (const [x0, x1] of [[-W, -4.6], [-2.9, -1.9], [1.9, 2.9], [4.6, W]]) mb.face([[x0, 0, 0.16], [x1, 0, 0.16], [x1, 4.3, 0.16], [x0, 4.3, 0.16]]);
  mb.face([[-W, 3.5, 0.16], [W, 3.5, 0.16], [W, 4.3, 0.16], [-W, 4.3, 0.16]]);
  mb.style(stone, Surf.Trim, 0.4, 5);
  BOX(0, 4.3, 0.2, W * 2 + 0.5, 0.32, 0.5); BOX(0, 8.45, 0.14, W * 2 + 0.3, 0.22, 0.36);
  for (let k = 0; k < 9; k++) for (const s of [-1, 1]) BOX(s * (W - 0.32), 4.7 + k * 0.86, 0.1, k % 2 ? 0.9 : 0.62, 0.52, 0.26);
  // cornice with dentils
  BOX(0, H - 0.1, 0.25, W * 2 + 1.1, 0.5, 0.9); BOX(0, H + 0.4, 0.35, W * 2 + 1.5, 0.22, 1.1);
  for (let k = -12; k <= 12; k++) BOX(k * 0.6, H - 0.42, 0.42, 0.26, 0.32, 0.42);

  const winTex = windowTexture();
  const winMat = signMaterial(winTex, { night: 1.5, day: 0.16 });
  const extras = new THREE.Group();
  const window = (x: number, y0: number, w: number, h: number, arched: boolean) => {
    const g = panel(w, h, winMat); g.position.set(x, y0 + h / 2, 0.1); extras.add(g);
    mb.style(stone, Surf.Trim, 0.4, 20);
    BOX(x - w / 2 - 0.13, y0, 0.16, 0.26, h, 0.3); BOX(x + w / 2 + 0.13, y0, 0.16, 0.26, h, 0.3);
    BOX(x, y0 - 0.2, 0.2, w + 0.8, 0.2, 0.42);                               // sill
    if (arched) {
      const top = new THREE.Mesh(new THREE.CircleGeometry(w / 2, 20, 0, Math.PI), winMat); top.position.set(x, y0 + h, 0.1); extras.add(top);
      for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; BOX(x + Math.cos(a) * (w / 2 + 0.16), y0 + h + Math.sin(a) * (w / 2 + 0.16) - 0.16, 0.18, 0.36, 0.34, 0.32); }
    } else { BOX(x, y0 + h, 0.2, w + 0.7, 0.32, 0.4); BOX(x, y0 + h + 0.32, 0.24, w + 1.0, 0.12, 0.5); }
  };
  window(-3.75, 0.95, 1.5, 2.4, false); window(3.75, 0.95, 1.5, 2.4, false);
  window(-4.7, 5.15, 1.45, 2.25, true); window(0, 5.15, 1.7, 2.4, true); window(4.7, 5.15, 1.45, 2.25, true);
  window(-4.7, 9.25, 1.35, 2.1, false); window(0, 9.25, 1.5, 2.1, false); window(4.7, 9.25, 1.35, 2.1, false);
  // entrance: steps, columns, entablature, double door
  mb.style(stone, Surf.Trim, 0.4, 20);
  for (let k = 0; k < 4; k++) BOX(0, 0, 0.5 + k * 0.32, 4.4 - k * 0.12, 0.2 * (4 - k), 0.34);
  for (const s of [-1, 1]) { mb.cyl(s * 1.55, 0.8, 0.42, 0.21, 0.18, 2.75, 12, true); BOX(s * 1.55, 0.6, 0.42, 0.56, 0.24, 0.56); BOX(s * 1.55, 3.5, 0.42, 0.5, 0.16, 0.5); }
  BOX(0, 3.66, 0.4, 4.0, 0.42, 0.9); BOX(0, 4.08, 0.45, 4.4, 0.16, 1.05);
  const doorMat = signMaterial(signTexture({ w: 256, h: 384, bg: '#22140c', draw: (c, w, h) => { c.fillStyle = '#2f1c10'; c.fillRect(8, 8, w / 2 - 12, h - 16); c.fillRect(w / 2 + 4, 8, w / 2 - 12, h - 16); c.fillStyle = '#d99a4a'; c.fillRect(24, 30, w / 2 - 44, 120); c.fillRect(w / 2 + 20, 30, w / 2 - 44, 120); c.fillStyle = '#1a0f08'; c.fillRect(w / 2 - 3, 0, 6, h); c.fillStyle = '#c9a24a'; c.beginPath(); c.arc(w / 2 - 16, h * 0.56, 6, 0, 7); c.arc(w / 2 + 16, h * 0.56, 6, 0, 7); c.fill(); } }), { night: 0.9, day: 0.08 });
  const door = panel(2.3, 2.7, doorMat); door.position.set(0, 2.15, 0.12); extras.add(door);
  // wrought-iron balcony under the centre window
  mb.style(stone, Surf.Trim, 0.4, 20); BOX(0, 4.75, 0.65, 3.6, 0.16, 1.0);
  mb.style(brick, Surf.Dark, 0.4, 20);
  for (const hh of [0.5, 0.95]) { mb.beam(-1.8, 4.91 + hh, 1.12, 1.8, 4.91 + hh, 1.12, 0.05); for (const s of [-1, 1]) mb.beam(s * 1.8, 4.91 + hh, 0.2, s * 1.8, 4.91 + hh, 1.12, 0.05); }
  for (let k = 0; k <= 12; k++) mb.beam(-1.8 + k * 0.3, 4.91, 1.12, -1.8 + k * 0.3, 5.86, 1.12, 0.03);

  // ---- mansard roof in slate, with dormers and the great window gable
  mb.style(slate, Surf.Blank, 0.4, 30);
  const o = { x0: -W - 0.25, x1: W + 0.25, z0: -D - 0.25, z1: 0.25 }, ins = 1.7;
  const i = { x0: o.x0 + ins, x1: o.x1 - ins, z0: o.z0 + ins, z1: o.z1 - ins };
  const y0 = H + 0.62;
  mb.face([[o.x0, y0, o.z1], [o.x1, y0, o.z1], [i.x1, RT, i.z1], [i.x0, RT, i.z1]]);
  mb.face([[o.x1, y0, o.z1], [o.x1, y0, o.z0], [i.x1, RT, i.z0], [i.x1, RT, i.z1]]);
  mb.face([[o.x1, y0, o.z0], [o.x0, y0, o.z0], [i.x0, RT, i.z0], [i.x1, RT, i.z0]]);
  mb.face([[o.x0, y0, o.z0], [o.x0, y0, o.z1], [i.x0, RT, i.z1], [i.x0, RT, i.z0]]);
  mb.style(slate, Surf.Roof, 0.4, 30); mb.cap(rectRing((i.x0 + i.x1) / 2, (i.z0 + i.z1) / 2, (i.x1 - i.x0) / 2, (i.z1 - i.z0) / 2, 0), RT);
  mb.style(stone, Surf.Trim, 0.4, 30); BOX(0, RT - 0.05, (i.z0 + i.z1) / 2, i.x1 - i.x0 + 0.5, 0.22, i.z1 - i.z0 + 0.5);
  for (const s of [-1, 1]) {     // dormers
    mb.style(slate, Surf.Blank, 0.4, 30); BOX(s * 5.6, y0 + 0.1, -0.35, 1.7, 2.2, 1.9);
    mb.style(stone, Surf.Trim, 0.4, 30); BOX(s * 5.6, y0 + 2.3, -0.3, 2.0, 0.18, 2.1);
    const g = panel(1.1, 1.5, winMat); g.position.set(s * 5.6, y0 + 1.15, 0.62); extras.add(g);
  }
  // chimneys & roof lantern
  mb.style(brick, Surf.Blank, 0.4, 30); BOX(-4.6, RT, -5, 1.0, 2.6, 1.0); BOX(4.4, RT, -11, 1.1, 2.9, 1.0);
  mb.style(stone, Surf.Trim, 0.4, 30); BOX(-4.6, RT + 2.6, -5, 1.25, 0.2, 1.25); BOX(4.4, RT + 2.9, -11, 1.35, 0.2, 1.25);
  mb.style(brick, Surf.Glass, 0.4, 30); mb.cyl(0, RT, -8.5, 2.1, 2.1, 1.5, 8, false);
  mb.style(brick, Surf.Dark, 0.4, 30); mb.cyl(0, RT + 1.5, -8.5, 2.3, 0.1, 1.5, 8, false);

  // gable with a real circular opening for the great window
  const gs = new THREE.Shape();
  gs.moveTo(-3.5, 0); gs.lineTo(3.5, 0); gs.lineTo(3.5, 3.1); gs.absarc(0, 3.1, 3.5, 0, Math.PI, false); gs.lineTo(-3.5, 0);
  const hole = new THREE.Path(); hole.absarc(0, 3.0, 2.3, 0, Math.PI * 2, true); gs.holes.push(hole);
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(gs, { depth: 0.7, bevelEnabled: false, curveSegments: 28 }), pbr({ color: 0x8f7a66, roughness: 0.85 }));
  gable.position.set(0, H + 0.6, -0.2); gable.castShadow = true; gable.receiveShadow = true;
  extras.add(gable);
  const sigil = new THREE.Mesh(new THREE.CircleGeometry(2.32, 48), signMaterial(sigilTexture(), { night: 2.7, day: 0.55, scaleWith: 'landmark' }));
  sigil.position.set(0, H + 3.6, 0.02); extras.add(sigil);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.14, 8, 48), pbr({ color: 0x2a1c12, roughness: 0.5, metalness: 0.6 }));
  rim.position.set(0, H + 3.6, 0.52); extras.add(rim);
  // subtle magic: a slow mandala hovering before the window
  const mMat = extendMaterial(new THREE.MeshBasicMaterial({ map: mandalaTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), {
    key: 'mandala', uniforms: { uMagic: U.uMagic }, fPars: 'uniform float uMagic;', fFinal: 'gl_FragColor.rgb *= uMagic * mix(0.5, 2.2, uNight);',
  });
  const mandala = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), mMat);
  mandala.position.set(0, H + 3.6, 1.35);
  extras.add(mandala);

  // ---- coffee shop across the street (faces -z)
  const SX0 = 5.5, SX1 = 14.5, SD = 13, SH = 14.6, GF = 4.1;
  const shopRing = rectRing((SX0 + SX1) / 2, STREET + SD / 2, (SX1 - SX0) / 2, SD / 2, 0);
  mb.style(shopBrick, Surf.Blank, 0.6, SH); mb.walls(shopRing, 0, GF, 0);
  mb.style(shopBrick, Surf.Wall, 0.6, SH); mb.walls(shopRing, GF, SH + 0.9, 2.6);
  mb.style(shopBrick, Surf.Roof, 0.6, SH); mb.cap(shopRing, SH);
  mb.style(shopBrick, Surf.Trim, 0.6, SH); BOX((SX0 + SX1) / 2, SH + 0.5, STREET - 0.2, SX1 - SX0 + 0.6, 0.5, 0.7);
  const green = pbr({ color: 0x18362b, roughness: 0.55 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; extras.add(m); return m; };
  const F = STREET;      // shop front plane (faces -z)
  for (const x of [SX0 + 0.25, SX1 - 0.25, 11.6]) add(new THREE.BoxGeometry(0.4, GF, 0.36), green, x, GF / 2, F - 0.1);
  add(new THREE.BoxGeometry(SX1 - SX0, 0.9, 0.34), green, (SX0 + SX1) / 2, 3.62, F - 0.12);
  add(new THREE.BoxGeometry(5.6, 0.75, 0.4), green, 8.6, 0.375, F - 0.1);                 // stall riser
  const shopGlass = signMaterial(shopInteriorTexture(), { night: 2.1, day: 0.6 });
  const sw = panel(5.5, 2.35, shopGlass); sw.position.set(8.6, 1.95, F - 0.05); sw.rotation.y = Math.PI; extras.add(sw);
  const doorTex = signTexture({ w: 256, h: 512, bg: ['#d9a25e', '#6a4022'], draw: (c, w, h) => { c.strokeStyle = '#18362b'; c.lineWidth = 34; c.strokeRect(0, 0, w, h); c.fillStyle = '#18362b'; c.fillRect(0, h * 0.62, w, 26); c.fillStyle = '#c9a24a'; c.fillRect(w - 60, h * 0.5, 12, 70); }, lines: [{ text: 'OPEN', size: 40, y: 0.3, color: '#fff4dc', weight: 800 }] });
  const sd = panel(1.7, 2.9, signMaterial(doorTex, { night: 1.9, day: 0.5 })); sd.position.set(13.0, 1.5, F + 0.3); sd.rotation.y = Math.PI; extras.add(sd);
  const fascia = signMaterial(signTexture({ w: 1024, h: 110, bg: '#18362b', lines: [{ text: 'KAMAR-TAJ COFFEE & TEA', size: 62, y: 0.54, color: '#e9c98a', weight: 700, font: 'Georgia, "Times New Roman", serif', spacing: 5 }] }), { night: 1.5, day: 0.3 });
  const fs = panel(SX1 - SX0 - 0.6, 0.78, fascia); fs.position.set((SX0 + SX1) / 2, 3.62, F - 0.3); fs.rotation.y = Math.PI; extras.add(fs);
  // striped awning
  const stripe = signTexture({ w: 512, h: 64, bg: '#7a1f24', draw: (c, w, h) => { c.fillStyle = '#eadfc8'; for (let k = 0; k < 16; k += 2) c.fillRect((k * w) / 16, 0, w / 16, h); } });
  stripe.wrapS = THREE.RepeatWrapping;
  const awnMat = extendMaterial(new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.9, side: THREE.DoubleSide }), { key: 'awning', weather: true });
  const awn = new THREE.Mesh(new THREE.PlaneGeometry(SX1 - SX0 - 0.8, 2.0), awnMat);
  awn.position.set((SX0 + SX1) / 2, 2.98, F - 0.95); awn.rotation.set(-Math.PI / 2 - 0.36, 0, 0); awn.castShadow = true; extras.add(awn);
  const val = new THREE.Mesh(new THREE.PlaneGeometry(SX1 - SX0 - 0.8, 0.34), awnMat); val.position.set((SX0 + SX1) / 2, 2.47, F - 1.89); extras.add(val);
  // pavement café: tables, chairs, planters, sandwich board
  const steel = pbr({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.8 }), wood = pbr({ color: 0x6a4a30, roughness: 0.7 });
  const table = (x: number, z: number) => {
    add(new THREE.CylinderGeometry(0.36, 0.36, 0.035, 20), wood, x, 0.74, z); add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8), steel, x, 0.37, z); add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 14), steel, x, 0.015, z);
    for (const s of [-1, 1]) {
      const cx = x + s * 0.62;
      add(new THREE.BoxGeometry(0.38, 0.03, 0.38), wood, cx, 0.46, z); add(new THREE.BoxGeometry(0.03, 0.42, 0.38), wood, cx + s * 0.19, 0.68, z);
      for (const [lx, lz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) add(new THREE.CylinderGeometry(0.014, 0.014, 0.46, 6), steel, cx + lx, 0.23, z + lz);
    }
    add(new THREE.CylinderGeometry(0.04, 0.032, 0.1, 10), pbr({ color: 0xf2efe8, roughness: 0.5 }), x + 0.1, 0.81, z - 0.06);
  };
  table(7.2, F - 1.25); table(9.9, F - 1.3);
  const leaf = pbr({ color: 0x3a5a2c, roughness: 0.9 });
  for (const x of [SX0 + 0.55, 11.9]) { add(new THREE.BoxGeometry(0.9, 0.5, 0.42), green, x, 0.25, F - 0.5); const b = add(new THREE.SphereGeometry(0.42, 12, 9), leaf, x, 0.72, F - 0.5); b.scale.set(1.15, 0.75, 0.6); }
  const board = signMaterial(signTexture({ w: 256, h: 384, bg: '#1b1b1b', lines: [{ text: 'TODAY', size: 46, y: 0.16, color: '#f2e9d0', weight: 700, font: 'Georgia' }, { text: 'time stone', size: 36, y: 0.4, color: '#9fe0a0', weight: 400, font: 'Georgia', italic: true }, { text: 'cold brew', size: 36, y: 0.53, color: '#9fe0a0', weight: 400, font: 'Georgia', italic: true }, { text: 'no refunds,', size: 26, y: 0.76, color: '#d8d0b8', weight: 400, font: 'Georgia' }, { text: 'no time loops', size: 26, y: 0.86, color: '#d8d0b8', weight: 400, font: 'Georgia' }] }), { night: 0.5, day: 0.1 });
  const sb = panel(0.62, 0.95, board); sb.position.set(12.3, 0.5, F - 2.3); sb.rotation.set(-0.2, Math.PI - 0.5, 0, 'YXZ'); extras.add(sb);
  // ---- street furniture on both kerbs
  const iron = pbr({ color: 0x15171a, roughness: 0.5, metalness: 0.7 });
  const lamps: THREE.PointLight[] = [];
  const lampGlow = beacon(0xffc27a, 0.05, 7, false);
  const lampPost = (x: number, z: number, dir: number) => {
    add(new THREE.CylinderGeometry(0.075, 0.11, 6.6, 10), iron, x, 3.3, z); add(new THREE.CylinderGeometry(0.2, 0.26, 0.9, 10), iron, x, 0.45, z);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.045, 6, 16, Math.PI * 1.15), iron); arc.position.set(x, 6.55, z + dir * 0.75); arc.rotation.set(0, Math.PI / 2, 0); if (dir < 0) arc.rotation.y = -Math.PI / 2; extras.add(arc);
    const head = add(new THREE.SphereGeometry(0.2, 12, 10), lampGlow, x, 6.25, z + dir * 1.45); head.scale.set(1, 1.35, 1); head.castShadow = false;
    add(new THREE.ConeGeometry(0.3, 0.26, 12), iron, x, 6.62, z + dir * 1.45);
    const pl = new THREE.PointLight(0xffb870, 0, 30, 1.6); pl.position.set(x, 6.1, z + dir * 1.45); extras.add(pl); lamps.push(pl);
  };
  lampPost(-9.5, SIDEWALK - 0.5, 1); lampPost(24.5, STREET - SIDEWALK + 0.5, -1);
  const shopLight = new THREE.PointLight(0xffa860, 0, 16, 1.8); shopLight.position.set(8.8, 2.4, F - 1.7); extras.add(shopLight); lamps.push(shopLight);
  add(new THREE.CylinderGeometry(0.13, 0.16, 0.62, 10), pbr({ color: 0xa82218, roughness: 0.5 }), 3.4, 0.31, STREET - SIDEWALK + 0.45); add(new THREE.SphereGeometry(0.14, 10, 8), pbr({ color: 0xa82218, roughness: 0.5 }), 3.4, 0.66, STREET - SIDEWALK + 0.45);
  const bugleBox = signMaterial(signTexture({ w: 128, h: 256, bg: '#a01c16', lines: [{ text: 'DAILY', size: 30, y: 0.12, weight: 900 }, { text: 'BUGLE', size: 30, y: 0.25, weight: 900 }], draw: (c, w, h) => { c.fillStyle = '#e8e2d0'; c.fillRect(14, h * 0.36, w - 28, h * 0.34); c.fillStyle = '#222'; c.font = '700 13px Arial'; c.fillText('SPIDER-MENACE', 18, h * 0.44); c.fillText('STRIKES AGAIN?', 18, h * 0.5); } }), { night: 0.25, day: 0.05 });
  const nb = add(new THREE.BoxGeometry(0.5, 1.15, 0.45), pbr({ color: 0xa01c16, roughness: 0.5, metalness: 0.3 }), 1.2, 0.575, STREET - SIDEWALK + 0.6);
  const nbf = panel(0.48, 1.1, bugleBox); nbf.position.set(1.2, 0.585, STREET - SIDEWALK + 0.6 - 0.23); nbf.rotation.y = Math.PI; extras.add(nbf); void nb;
  add(new THREE.BoxGeometry(0.6, 1.15, 0.55), pbr({ color: 0x1f3f7a, roughness: 0.45, metalness: 0.4 }), -6.2, 0.58, SIDEWALK - 0.7);      // mailbox
  for (const [x, z] of [[-17.5, SIDEWALK - 0.6], [27.5, SIDEWALK - 0.6]]) { add(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8), pbr({ color: 0x2a221c, roughness: 0.9 }), x, 1.3, z); const c1 = add(new THREE.SphereGeometry(1.5, 14, 10), leaf, x, 3.6, z); c1.scale.set(1, 0.85, 1.05); const c2 = add(new THREE.SphereGeometry(1.1, 12, 9), leaf, x + 0.8, 4.3, z + 0.35); const c3 = add(new THREE.SphereGeometry(1.0, 12, 9), leaf, x - 0.7, 4.0, z - 0.5); void c2; void c3; }

  const body = facadeMesh(mb.build());
  group.add(body, extras);
  group.updateMatrixWorld(true);
  const yawWorld = (lx: number, lz: number) => { const a = toWorld(0, 0, 0), b = toWorld(lx, 0, lz); return yawFacing(b.x - a.x, b.z - a.z); };
  const c1 = toWorld(0, 0, -D / 2), c2 = toWorld((SX0 + SX1) / 2, 0, STREET + SD / 2);
  return {
    group, mandala, lights: lamps, toWorld,
    clear: [{ x: c1.x, z: c1.z, r: 12.5 }, { x: c2.x, z: c2.z, r: 9.5 }],
    strange: { pos: toWorld(15.0, 0, STREET - SIDEWALK + 0.75), yaw: yawWorld(0.9, 0.25) },
    strangeAlt: { pos: toWorld(1.9, 0.82, 1.3), yaw: yawWorld(0.25, 1) },
  };
}
