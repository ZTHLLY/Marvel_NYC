import * as THREE from 'three';
import type { CityData } from '../city/geo';
import { CURB_H } from '../city/geo';
import { StylePalette, Surf } from '../city/facade';
import { MeshBuilder, rectRing } from '../city/meshBuilder';
import { extendMaterial, pbr, U } from '../engine/materials';
import { SITES } from './sites';
import { beacon, builderMesh, extrude, facadeMesh, Parts, prng, quad3, signMaterial, signTexture, tileTexture, tri3, V3, yawFacing } from './kit';
import earcut from 'earcut';

export interface SanctumBuild {
  group: THREE.Group;
  clear: { x: number; z: number; r: number }[];
  lights: THREE.PointLight[];
  mandala: THREE.Mesh;
  /** local → world helper for composing camera bookmarks */
  toWorld: (x: number, y: number, z: number) => THREE.Vector3;
}

const ROAD_HALF = 4.6, SIDEWALK = 3.5;

// ---- local frames: o + right * x + up * y + out * z (out = the direction a facade faces) -------------------------
interface Frame { o: V3; yaw: number }
const T = (f: Frame, x: number, y: number, z: number): V3 => {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [f.o[0] + c * x + s * z, f.o[1] + y, f.o[2] - s * x + c * z];
};
const N = (f: Frame, x: number, y: number, z: number): V3 => {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [c * x + s * z, y, -s * x + c * z];
};
const fq = (mb: MeshBuilder, f: Frame, a: V3, b: V3, c: V3, d: V3, n: V3) =>
  quad3(mb, T(f, ...a), T(f, ...b), T(f, ...c), T(f, ...d), N(f, ...n));
/** box from local min/max corners (no bottom) */
function fbox(mb: MeshBuilder, f: Frame, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bottom = false) {
  fq(mb, f, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  fq(mb, f, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  fq(mb, f, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  fq(mb, f, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  fq(mb, f, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  if (bottom) fq(mb, f, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
}
/** polygon in the facade plane (x, y) extruded outward from z0 to z1 */
const fprismXY = (mb: MeshBuilder, f: Frame, poly: number[], z0: number, z1: number) =>
  extrude(mb, poly, T(f, 0, 0, 0), N(f, 1, 0, 0), N(f, 0, 1, 0), N(f, 0, 0, 1), z0, z1);
/** moulding profile given as (out, up) pairs, run along the facade from x0 to x1 at height y */
const frun = (mb: MeshBuilder, f: Frame, prof: number[], y: number, x0: number, x1: number, z = 0) =>
  extrude(mb, prof, T(f, 0, y, z), N(f, 0, 0, 1), N(f, 0, 1, 0), N(f, 1, 0, 0), x0, x1);

interface Hole { xl: number; xr: number; yb: number; yt: number; arch?: number }

/** Wall plane at local z with rectangular / round-headed openings, plus reveals `depth` deep. */
function wallHoles(mb: MeshBuilder, f: Frame, x0: number, x1: number, y0: number, y1: number, z: number, holes: Hole[], depth: number) {
  const top = (h: Hole) => h.yt + (h.arch ?? 0);
  const ys = [y0, y1];
  for (const h of holes) ys.push(h.yb, top(h));
  const br = [...new Set(ys.map((v) => Math.min(y1, Math.max(y0, v))))].sort((a, b) => a - b);
  for (let i = 0; i < br.length - 1; i++) {
    const ya = br[i], yb = br[i + 1];
    if (yb - ya < 1e-4) continue;
    const act = holes.filter((h) => h.yb < yb - 1e-5 && top(h) > ya + 1e-5).sort((a, b) => a.xl - b.xl);
    let cx = x0;
    for (const h of act) { if (h.xl > cx + 1e-4) fq(mb, f, [cx, ya, z], [h.xl, ya, z], [h.xl, yb, z], [cx, yb, z], [0, 0, 1]); cx = Math.max(cx, h.xr); }
    if (x1 > cx + 1e-4) fq(mb, f, [cx, ya, z], [x1, ya, z], [x1, yb, z], [cx, yb, z], [0, 0, 1]);
  }
  for (const h of holes) {
    const d = depth;
    fq(mb, f, [h.xl, h.yb, z], [h.xl, h.yb, z - d], [h.xl, h.yt, z - d], [h.xl, h.yt, z], [1, 0, 0]);
    fq(mb, f, [h.xr, h.yb, z - d], [h.xr, h.yb, z], [h.xr, h.yt, z], [h.xr, h.yt, z - d], [-1, 0, 0]);
    fq(mb, f, [h.xl, h.yb, z], [h.xr, h.yb, z], [h.xr, h.yb, z - d], [h.xl, h.yb, z - d], [0, 1, 0]);
    if (!h.arch) { fq(mb, f, [h.xl, h.yt, z - d], [h.xr, h.yt, z - d], [h.xr, h.yt, z], [h.xl, h.yt, z], [0, -1, 0]); continue; }
    const R = h.arch, xc = (h.xl + h.xr) / 2, S = 12;
    const P = (a: number): [number, number] => [xc + R * Math.cos(a), h.yt + R * Math.sin(a)];
    for (let k = 0; k < S; k++) {
      const a0 = (k / S) * Math.PI, a1 = ((k + 1) / S) * Math.PI, am = (a0 + a1) / 2;
      const [px0, py0] = P(a0), [px1, py1] = P(a1);
      fq(mb, f, [px0, py0, z], [px1, py1, z], [px1, py1, z - d], [px0, py0, z - d], [-Math.cos(am), -Math.sin(am), 0]);
      // spandrel infill between the arch and the bounding rectangle
      const corner: [number, number] = am < Math.PI / 2 ? [h.xr, h.yt + R] : [h.xl, h.yt + R];
      tri3(mb, T(f, corner[0], corner[1], z), T(f, px0, py0, z), T(f, px1, py1, z), N(f, 0, 0, 1));
    }
  }
}

/** annular sector polygon (x, y) */
function sector(xc: number, yc: number, r0: number, r1: number, a0: number, a1: number, segs: number): number[] {
  const p: number[] = [];
  for (let k = 0; k <= segs; k++) { const a = a0 + ((a1 - a0) * k) / segs; p.push(xc + Math.cos(a) * r1, yc + Math.sin(a) * r1); }
  for (let k = segs; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / segs; p.push(xc + Math.cos(a) * r0, yc + Math.sin(a) * r0); }
  return p;
}

// ---- interiors: boxes behind each window, mapped onto a painted one-point-perspective room atlas -------------------
class RoomBoxes {
  pos: number[] = []; nrm: number[] = []; uv: number[] = [];
  private q(f: Frame, p: V3[], t: [number, number][], n: V3) {
    const w = p.map((v) => T(f, ...v)), nn = N(f, ...n);
    const order = [0, 1, 2, 0, 2, 3];
    // fix the winding so the visible side faces into the room
    const a = w[0], b = w[1], c = w[2];
    const cr = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const flip = cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] < 0;
    for (const k of flip ? [0, 2, 1, 0, 3, 2] : order) { this.pos.push(...w[k]); this.nrm.push(...nn); this.uv.push(...t[k]); }
  }
  /** opening [xa,xb]×[ya,yb] in the plane z = zf of frame f, room extends `depth` behind (−z); cell 0..3 */
  add(f: Frame, xa: number, xb: number, ya: number, yb: number, zf: number, depth: number, cell: number) {
    const u0 = (cell % 2) * 0.5, v0 = 0.5 - Math.floor(cell / 2) * 0.5;
    const C = (fx: number, fy: number): [number, number] => [u0 + fx * 0.5, v0 + fy * 0.5];
    const zb = zf - depth;
    const FBL = C(0, 0), FBR = C(1, 0), FTR = C(1, 1), FTL = C(0, 1);
    const BBL = C(0.24, 0.28), BBR = C(0.76, 0.28), BTR = C(0.76, 0.8), BTL = C(0.24, 0.8);
    this.q(f, [[xa, ya, zb], [xb, ya, zb], [xb, yb, zb], [xa, yb, zb]], [BBL, BBR, BTR, BTL], [0, 0, 1]);
    this.q(f, [[xa, ya, zf], [xa, ya, zb], [xa, yb, zb], [xa, yb, zf]], [FBL, BBL, BTL, FTL], [1, 0, 0]);
    this.q(f, [[xb, ya, zb], [xb, ya, zf], [xb, yb, zf], [xb, yb, zb]], [BBR, FBR, FTR, BTR], [-1, 0, 0]);
    this.q(f, [[xa, ya, zf], [xb, ya, zf], [xb, ya, zb], [xa, ya, zb]], [FBL, FBR, BBR, BBL], [0, 1, 0]);
    this.q(f, [[xa, yb, zb], [xb, yb, zb], [xb, yb, zf], [xa, yb, zf]], [BTL, BTR, FTR, FTL], [0, -1, 0]);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

function roomAtlas(): THREE.CanvasTexture {
  return signTexture({
    w: 1024, h: 1024, bg: '#000',
    draw: (c) => {
      const S = 512, X0 = 123, Y0 = 102, X1 = 389, Y1 = 369;
      const poly = (pts: number[], fill: string | CanvasGradient) => { c.fillStyle = fill; c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fill(); };
      const glow = (x: number, y: number, r: number, col: string) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.globalCompositeOperation = 'source-over'; };
      const drapes = (x0: number, x1: number, y0: number, y1: number, base: [number, number, number], skewL: boolean) => {
        for (let x = x0; x < x1; x += 2) {
          const k = 0.62 + 0.38 * Math.sin((x - x0) * 0.22) * Math.sin((x - x0) * 0.05 + 1);
          c.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
          const t = (x - x0) / Math.max(1, x1 - x0), yy0 = y0 + (skewL ? t : 1 - t) * (Y0 - y0) * 0.95, yy1 = y1 - (skewL ? t : 1 - t) * (y1 - Y1) * 0.95;
          c.fillRect(x, yy0, 2, yy1 - yy0);
        }
      };
      const room = (ox: number, oy: number, v: number) => {
        c.save(); c.translate(ox, oy);
        c.beginPath(); c.rect(0, 0, S, S); c.clip();
        const pal = [
          { back: '#5e3420', side: '#4a2818', ceil: '#2e1c12', floor: '#24140c', drape: [92, 22, 22] as [number, number, number] },
          { back: '#3e3a2a', side: '#302c20', ceil: '#262418', floor: '#22160e', drape: [96, 70, 42] as [number, number, number] },
          { back: '#14171d', side: '#101318', ceil: '#0c0e12', floor: '#0c0b0a', drape: [26, 14, 14] as [number, number, number] },
          { back: '#4a1a12', side: '#20120c', ceil: '#180f0a', floor: '#160e08', drape: [86, 30, 20] as [number, number, number] },
        ][v];
        poly([X0, Y0, X1, Y0, X1, Y1, X0, Y1], pal.back);
        poly([0, 0, S, 0, X1, Y0, X0, Y0], pal.ceil);
        poly([X0, Y1, X1, Y1, S, S, 0, S], pal.floor);
        poly([0, 0, X0, Y0, X0, Y1, 0, S], pal.side);
        poly([S, 0, S, S, X1, Y1, X1, Y0], pal.side);
        // floorboards
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2;
        for (let k = 0; k <= 10; k++) { const t = k / 10; c.beginPath(); c.moveTo(X0 + (X1 - X0) * t, Y1); c.lineTo(S * t, S); c.stroke(); }
        if (v === 0) {
          // library: wainscot, bookcase, table lamp
          c.fillStyle = '#2e1a10'; c.fillRect(X0, Y1 - 70, X1 - X0, 70);
          c.fillStyle = '#21130b'; c.fillRect(250, 140, 130, Y1 - 140);
          const rnd = prng(7);
          for (let s = 0; s < 5; s++) {
            const sy = 150 + s * 43;
            c.fillStyle = '#140b06'; c.fillRect(250, sy + 36, 130, 6);
            for (let x = 256; x < 374;) { const bw = 5 + rnd() * 8; const hue = rnd(); c.fillStyle = `rgb(${(60 + 70 * hue) | 0},${(28 + 30 * rnd()) | 0},${(18 + 30 * (1 - hue)) | 0})`; c.fillRect(x, sy + 36 - (26 + rnd() * 8), bw - 1, 26 + rnd() * 8); x += bw; }
          }
          c.fillStyle = '#1a0f08'; c.fillRect(140, 300, 92, 69);
          poly([170, 252, 204, 252, 214, 284, 160, 284], '#e0b070');
          glow(187, 272, 175, 'rgba(255,180,105,0.55)');
          glow(187, 268, 34, 'rgba(255,225,170,0.85)');
          poly([X0 + 20, Y1 + 10, X1 - 40, Y1 + 10, X1 + 10, S - 40, X0 - 50, S - 40], '#4a1612');
        } else if (v === 1) {
          // study: framed painting, armchair, chandelier
          c.fillStyle = '#7a5a26'; c.fillRect(196, 168, 120, 92); c.fillStyle = '#1e1a14'; c.fillRect(204, 176, 104, 76);
          c.fillStyle = '#3a2c20'; c.fillRect(214, 214, 40, 30);
          c.fillStyle = '#160e0a'; c.fillRect(150, 300, 80, 69); c.fillRect(140, 280, 20, 89); c.fillRect(220, 280, 20, 89);
          c.strokeStyle = '#2a2014'; c.lineWidth = 3; c.beginPath(); c.moveTo(256, 0); c.lineTo(256, 60); c.stroke();
          glow(256, 70, 230, 'rgba(255,205,140,0.45)');
          glow(256, 66, 30, 'rgba(255,230,180,0.9)');
        } else if (v === 2) {
          glow(300, 330, 150, 'rgba(70,100,160,0.28)');
          c.fillStyle = '#0a0a0c'; c.fillRect(170, 310, 120, 59);
        } else {
          // heavy drapes drawn across, lamp glow seeping around them
          drapes(X0, X1, Y0, Y1, pal.drape, true);
          glow(256, 250, 230, 'rgba(255,160,90,0.3)');
          c.fillStyle = 'rgba(255,190,120,0.55)'; c.fillRect(252, Y0, 7, Y1 - Y0);
          glow(256, Y1, 90, 'rgba(255,170,100,0.35)');
        }
        // drapes tied back at the window edges and a pelmet
        drapes(0, 46, 0, S, pal.drape, true);
        drapes(S - 46, S, 0, S, pal.drape, false);
        c.fillStyle = `rgb(${pal.drape[0] * 0.55 | 0},${pal.drape[1] * 0.55 | 0},${pal.drape[2] * 0.55 | 0})`; c.fillRect(0, 0, S, 16);
        c.restore();
      };
      room(0, 0, 0); room(512, 0, 1); room(0, 512, 2); room(512, 512, 3);
    },
  });
}

function sigilGlassTexture(): THREE.CanvasTexture {
  // The great round window: amber cathedral glass, mottled, with the lead lines of the original sigil.
  return signTexture({
    w: 512, h: 512, bg: '#000',
    draw: (c) => {
      const g = c.createRadialGradient(256, 256, 10, 256, 256, 256);
      g.addColorStop(0, '#f0c27c'); g.addColorStop(0.45, '#d98a3c'); g.addColorStop(0.85, '#8a3c18'); g.addColorStop(1, '#4a1c0c');
      c.fillStyle = g; c.beginPath(); c.arc(256, 256, 256, 0, 7); c.fill();
      const r = prng(11);
      for (let i = 0; i < 900; i++) {
        const x = r() * 512, y = r() * 512, s = 4 + r() * 14;
        c.fillStyle = r() < 0.5 ? `rgba(255,${(150 + r() * 80) | 0},90,${0.08 + r() * 0.1})` : `rgba(60,${(10 + r() * 20) | 0},0,${0.1 + r() * 0.14})`;
        c.beginPath(); c.arc(x, y, s, 0, 7); c.fill();
      }
      // a few ruby and deep-gold quarries
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.26; c.fillStyle = i % 2 ? 'rgba(120,10,10,0.45)' : 'rgba(255,200,80,0.25)'; c.beginPath(); c.arc(256 + Math.cos(a) * 229, 256 + Math.sin(a) * 229, 13, 0, 7); c.fill(); }
      c.strokeStyle = '#120a06'; c.lineCap = 'round';
      c.lineWidth = 9;
      c.beginPath(); c.arc(256, -150, 520, Math.PI * 0.31, Math.PI * 0.69); c.stroke();
      c.beginPath(); c.arc(-170, 256, 560, -Math.PI * 0.24, Math.PI * 0.24); c.stroke();
      c.beginPath(); c.arc(700, 256, 520, Math.PI * 0.77, Math.PI * 1.23); c.stroke();
      c.beginPath(); c.moveTo(60, 150); c.quadraticCurveTo(256, 290, 452, 150); c.stroke();
      c.beginPath(); c.moveTo(256, 14); c.lineTo(256, 498); c.stroke();
      c.lineWidth = 3;
      for (let i = 0; i < 40; i++) { const x = r() * 512, y = r() * 512, a = r() * 6.28; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 40, y + Math.sin(a) * 40); c.stroke(); }
      c.lineWidth = 6; c.beginPath(); c.arc(256, 256, 214, 0, 7); c.stroke();
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

function slateTexture(): THREE.CanvasTexture {
  // Second-Empire polychrome slate: bands of fish-scale and square-butt courses
  const t = tileTexture(512, 512, (c, w, h) => {
    const r = prng(5);
    c.fillStyle = '#25272c'; c.fillRect(0, 0, w, h);
    const course = 32, tw = 42.67;
    for (let row = h / course - 1; row >= 0; row--) {
      const y = row * course, band = Math.floor(row / 4) % 2, off = (row % 2) * tw / 2;
      for (let k = -1; k <= w / tw; k++) {
        const x = k * tw + off, l = 0.85 + r() * 0.3;
        const base = band ? [62, 66, 74] : [70, 74, 72];
        c.fillStyle = `rgb(${base[0] * l | 0},${base[1] * l | 0},${base[2] * l | 0})`;
        c.beginPath();
        if (band) { c.moveTo(x, y); c.lineTo(x + tw - 2, y); c.lineTo(x + tw - 2, y + course * 1.2); c.arc(x + tw / 2 - 1, y + course * 1.2, tw / 2 - 1, 0, Math.PI); c.closePath(); }
        else c.rect(x, y, tw - 2, course * 1.5);
        c.fill();
        const g = c.createLinearGradient(0, y + course * 1.0, 0, y + course * 1.7);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
        c.fillStyle = g; c.fill();
      }
    }
  });
  t.repeat.set(1 / 1.7, 1 / 1.7);
  return t;
}

function shopBackTexture(): THREE.CanvasTexture {
  return signTexture({
    w: 1024, h: 384, bg: ['#7a4c2c', '#5a361e'],
    draw: (c, w, h) => {
      // exposed brick with warm wash
      const r = prng(3);
      for (let y = 0; y < h; y += 12) for (let x = -(y % 24); x < w; x += 34) { const l = 0.75 + r() * 0.35; c.fillStyle = `rgb(${120 * l | 0},${62 * l | 0},${40 * l | 0})`; c.fillRect(x + 1, y + 1, 32, 10); }
      const g = c.createRadialGradient(w * 0.5, 0, 10, w * 0.5, 0, w * 0.6); g.addColorStop(0, 'rgba(255,200,130,0.45)'); g.addColorStop(1, 'rgba(255,170,100,0.05)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // chalk menu boards
      for (const [x, lines] of [[0.12, ['ESPRESSO 3.5', 'CORTADO 4.5', 'FLAT WHITE 5', 'CHAI 4.5']], [0.66, ['POUR OVER 6', 'COLD BREW 5', 'MATCHA 5.5', 'PASTRIES']]] as const) {
        c.fillStyle = '#4a3220'; c.fillRect(w * x - 6, h * 0.08 - 6, w * 0.22 + 12, h * 0.36 + 12);
        c.fillStyle = '#161816'; c.fillRect(w * x, h * 0.08, w * 0.22, h * 0.36);
        c.fillStyle = '#e8e2cc'; c.font = '600 22px Georgia'; c.textAlign = 'left';
        lines.forEach((t, i) => c.fillText(t, w * x + 14, h * 0.08 + 36 + i * 30));
      }
      c.fillStyle = '#e9c98a'; c.font = 'italic 700 34px Georgia'; c.textAlign = 'center'; c.fillText('Kamar-Taj', w * 0.5, h * 0.2);
    },
  });
}

/** Deciduous street tree: tapered trunk, forking limbs, irregular clumped canopy (all merged into `parts`). */
function streetTree(parts: Parts, bark: THREE.Material, leaves: THREE.Material[], x: number, y: number, z: number, seed: number, scale = 1) {
  const r = prng(seed);
  const tips: { p: THREE.Vector3; d: THREE.Vector3; rad: number }[] = [];
  const limb = (p: THREE.Vector3, d: THREE.Vector3, len: number, rad: number, depth: number) => {
    const e = p.clone().addScaledVector(d, len);
    const g = new THREE.CylinderGeometry(rad * 0.72, rad, len, 7, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    g.translate((p.x + e.x) / 2, (p.y + e.y) / 2, (p.z + e.z) / 2);
    parts.add(g, bark);
    if (depth === 0) { tips.push({ p: e, d, rad }); return; }
    const n = depth === 3 ? 3 : 2 + (r() < 0.4 ? 1 : 0);
    const a0 = r() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const az = a0 + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.6;
      const tilt = (depth === 3 ? 0.55 : 0.45) + r() * 0.35;
      const nd = new THREE.Vector3(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt)).lerp(d, 0.35).normalize();
      limb(e, nd, len * (0.62 + r() * 0.18), rad * 0.62, depth - 1);
    }
  };
  const base = new THREE.Vector3(x, y, z);
  limb(base, new THREE.Vector3((r() - 0.5) * 0.08, 1, (r() - 0.5) * 0.08).normalize(), 2.7 * scale, 0.17 * scale, 3);
  for (const t of tips) {
    const n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const g = new THREE.IcosahedronGeometry(0.55 * scale, 1);
      const pa = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const vx = pa.getX(i), vy = pa.getY(i), vz = pa.getZ(i);
        const j = 0.7 + 0.55 * Math.abs(Math.sin(vx * 7.1 + seed + k) * Math.cos(vz * 6.3 + vy * 5.1));
        pa.setXYZ(i, vx * j, vy * j * 0.78, vz * j);
      }
      g.computeVertexNormals();
      const o = t.p.clone().addScaledVector(t.d, 0.3 * scale).add(new THREE.Vector3((r() - 0.5) * 1.3, (r() - 0.3) * 0.9, (r() - 0.5) * 1.3).multiplyScalar(scale));
      const s = 0.75 + r() * 0.7;
      parts.add(g, leaves[Math.floor(r() * leaves.length)], o.x, o.y, o.z, r() * 3, r() * 3, 0, s, s * (0.8 + r() * 0.3), s);
    }
  }
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
  const CH = CURB_H;

  const brick = palette.addCustom({ win: [0.3, 0.56], bay: 2.6, floor: 4.1, wall: 0x5f382d, wallType: 0, glass: 0x2a3036, glassRough: 0.16, frame: 0x1c1a18, frameW: 0.1, ground: 4.6, lit: 0.35, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 1, crown: 0, roof: 0x2e3238, storefront: 0, accent: 0x7a2a2a, feature: 0 });
  const stone = palette.addCustom({ win: [0.3, 0.5], bay: 3, floor: 4, wall: 0x9c8670, wallType: 1, glass: 0x2a3036, glassRough: 0.16, frame: 0x1c1a18, frameW: 0.1, ground: 4, lit: 0, warm: 1, coh: 0, pier: 0, spandrel: 0, sill: 0, crown: 0, roof: 0x2e3238, storefront: 0, accent: 0x7a2a2a, feature: 0 });
  const shopBrick = palette.addCustom({ win: [0.42, 0.56], bay: 2.6, floor: 3.4, wall: 0x7a4838, wallType: 0, glass: 0x2e363c, glassRough: 0.16, frame: 0xe2ddd0, frameW: 0.09, ground: 0, lit: 0.55, warm: 0.9, coh: 0, pier: 0, spandrel: 0, sill: 1, crown: 0, roof: 0x3a3a3c, storefront: 0, accent: 0x2e6a4a, feature: 0 });

  // ---- materials
  const iron = pbr({ color: 0x141517, roughness: 0.45, metalness: 0.75 });
  const paint = pbr({ color: 0x1d1a17, roughness: 0.42, metalness: 0.05 });        // window joinery, glossy black-brown
  const copper = pbr({ color: 0x4f7f6c, roughness: 0.55, metalness: 0.35 });        // verdigris flashing
  const copperNew = pbr({ color: 0x8a5a3a, roughness: 0.4, metalness: 0.8 });
  const doorWood = pbr({ color: 0x5a2e16, roughness: 0.32, metalness: 0.0 });
  const brass = pbr({ color: 0xb08a40, roughness: 0.3, metalness: 1.0 });
  const terracotta = pbr({ color: 0x8a4a30, roughness: 0.85 });
  const stonePbr = pbr({ color: 0x9c8670, roughness: 0.82 });
  const lead = pbr({ color: 0x1a1816, roughness: 0.5, metalness: 0.6 });
  const green = pbr({ color: 0x173328, roughness: 0.4 });
  const steel = pbr({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.8 });
  const wood = pbr({ color: 0x6a4a30, roughness: 0.7 });
  const marble = pbr({ color: 0xd8d2c6, roughness: 0.25 });
  const bark = pbr({ color: 0x2c241e, roughness: 0.95 });
  const leaves = [pbr({ color: 0x34502a, roughness: 0.85 }), pbr({ color: 0x2c4626, roughness: 0.85 }), pbr({ color: 0x41592c, roughness: 0.85 })];
  const slateTex = slateTexture();
  const slateMat = extendMaterial(new THREE.MeshStandardMaterial({ map: slateTex, roughness: 0.62, metalness: 0.05 }), { key: 'sanctum-slate', weather: true });
  const glassMat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0x0c1014, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, envMapIntensity: 1.5, depthWrite: false }), { key: 'sanctum-glass' });
  const roomMat = signMaterial(roomAtlas(), { night: 1.35, day: 0.05 });

  const mb = new MeshBuilder(32768);          // facade-shaded masonry
  const mbPaint = new MeshBuilder(16384);     // joinery
  const mbSlate = new MeshBuilder(4096);
  const mbCopper = new MeshBuilder(4096);
  const mbIron = new MeshBuilder(4096);
  const mbDoor = new MeshBuilder(2048);
  const parts = new Parts();
  const rooms = new RoomBoxes();
  const glows = new THREE.Group();

  const W = 7.5, D = 17, H = 13.15;
  const F0: Frame = { o: [0, 0, 0], yaw: 0 };
  const E: Frame = { o: [W, 0, 0], yaw: Math.PI / 2 };      // east flank: right = -z
  const Wf: Frame = { o: [-W, 0, 0], yaw: -Math.PI / 2 };   // west flank: right = +z

  // ================= SANCTUM: masonry =================
  // flanks & rear: brick with shader windows (two-point rings so the front stays open for the hand-built facade)
  mb.style(brick, Surf.Wall, 0.4, H);
  for (const [a, b] of [[[W, -D], [W, 0]], [[-W, 0], [-W, -D]], [[W, -D], [-W, -D]]]) mb.walls([a[0], a[1], b[0], b[1]], 0, H, 2.6);

  // front wall: rusticated stone base + brick upper floors, with real openings
  const gWin: Hole[] = [{ xl: -4.65, xr: -3.15, yb: 1.35, yt: 3.45 }, { xl: 3.15, xr: 4.65, yb: 1.35, yt: 3.45 }];
  const door: Hole = { xl: -1.15, xr: 1.15, yb: 1.0, yt: 3.75 };
  const f2: Hole[] = [{ xl: -5.32, xr: -3.88, yb: 5.1, yt: 7.35, arch: 0.72 }, { xl: -0.85, xr: 0.85, yb: 5.0, yt: 7.2, arch: 0.85 }, { xl: 3.88, xr: 5.32, yb: 5.1, yt: 7.35, arch: 0.72 }];
  const f3: Hole[] = [{ xl: -5.28, xr: -3.92, yb: 9.4, yt: 11.4 }, { xl: -0.75, xr: 0.75, yb: 9.4, yt: 11.4 }, { xl: 3.92, xr: 5.28, yb: 9.4, yt: 11.4 }];
  mb.style(stone, Surf.Blank, 0.4, 4.6);
  wallHoles(mb, F0, -W, W, 0, 4.6, 0, [...gWin, door], 0.46);
  mb.style(brick, Surf.Blank, 0.4, H);
  wallHoles(mb, F0, -W, W, 4.6, H, 0, [...f2, ...f3], 0.34);

  // rustication: chamfered courses with staggered vertical joints, returning around both corners
  mb.style(stone, Surf.Trim, 0.4, 4.6);
  const rustProf = (h: number) => [0, 0, h - 0.02, 0, h - 0.06, 0.13, 0.04, 0.13];
  {
    const y0 = 0.62, y1 = 4.3, nC = 7, ch = (y1 - y0) / nC;
    const holes = [...gWin, door].map((h) => ({ ...h, xl: h.xl - 0.02, xr: h.xr + 0.02 }));
    for (let k = 0; k < nC; k++) {
      const ya = y0 + k * ch;
      const segs: [number, number][] = [];
      let cx = -W - 0.13;
      for (const h of holes.filter((h) => h.yb < ya + ch && h.yt + 0.6 > ya).sort((a, b) => a.xl - b.xl)) { if (h.xl > cx) segs.push([cx, h.xl]); cx = h.xr; }
      segs.push([cx, W + 0.13]);
      const prof = rustProf(ch);
      // profile (up, out) in the y/z plane, run along x
      const poly: number[] = [];
      for (let i = 0; i < prof.length; i += 2) poly.push(prof[i + 1], prof[i]);
      for (const [sa, sb] of segs) {
        const blk = 1.25, off = (k % 2) * blk * 0.5;
        let x = sa;
        while (x < sb - 0.05) {
          const nxt = Math.min(sb, Math.floor((x - sa + off) / blk + 1) * blk + sa - off);
          const xe = nxt - x < 0.3 ? sb : nxt;
          frun(mb, F0, poly, ya, x + 0.015, Math.min(xe, sb) - 0.015);
          x = Math.min(xe, sb);
        }
      }
      // returns on the flanks
      for (const fr of [E, Wf]) {
        const xa = fr === E ? 0 : -1.4, xb = fr === E ? 1.4 : 0;
        frun(mb, fr, poly, ya, xa + (fr === E ? 0.0 : 0.015), xb - (fr === E ? 0.015 : 0));
      }
    }
  }
  // plinth & water table & belt course & frieze band (wrapping the three visible sides)
  const runAround = (prof: number[], y: number, proj: number) => {
    frun(mb, F0, prof, y, -W - proj, W + proj);
    frun(mb, E, prof, y, -proj, D);
    frun(mb, Wf, prof, y, -D, proj);
  };
  mb.style(stone, Surf.Trim, 0.4, 4.6);
  runAround([0, 0, 0.22, 0, 0.22, 0.42, 0.13, 0.62, 0, 0.62], 0, 0.22);
  runAround([0, 0, 0.2, 0, 0.27, 0.06, 0.27, 0.17, 0.15, 0.32, 0, 0.32], 4.3, 0.27);
  mb.style(stone, Surf.Trim, 0.4, 9);
  runAround([0, 0, 0.1, 0, 0.1, 0.06, 0.17, 0.12, 0.17, 0.24, 0, 0.24], 8.6, 0.17);
  runAround([0, 0, 0.06, 0, 0.06, 0.1, 0, 0.1], 11.9, 0.06);
  // brick quoins on the upper corners (stone, alternating long/short, standing proud)
  for (let k = 0; k < 13; k++) {
    const ya = 4.66 + k * 0.56, long = k % 2 === 0;
    for (const s of [-1, 1]) {
      const a = long ? 1.0 : 0.62, b = long ? 0.62 : 1.0;
      const x0 = s > 0 ? W - a : -W, x1 = s > 0 ? W + 0.07 : -W + a;
      const xa = s > 0 ? x0 : -W - 0.07, xb = s > 0 ? x1 : x1;
      aabbL(mb, xa, ya, -b, xb, ya + 0.5, 0.07);
    }
  }
  function aabbL(m: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) { fbox(m, F0, x0, y0, z0, x1, y1, z1, true); }

  // ---- ground-floor windows: flat-arch voussoirs, keystone, sill
  for (const h of gWin) {
    const xc = (h.xl + h.xr) / 2, w = h.xr - h.xl, fy = h.yt - 1.6, nV = 9;
    for (let k = 0; k < nV; k++) {
      const xa = h.xl - 0.18 + ((w + 0.36) * k) / nV, xb = h.xl - 0.18 + ((w + 0.36) * (k + 1)) / nV;
      const ext = (x: number) => [xc + (x - xc) * ((h.yt + 0.62 - fy) / (h.yt - fy)), h.yt + 0.62] as const;
      const [tx0, ty] = ext(xa), [tx1] = ext(xb);
      const key = k === (nV - 1) / 2;
      fprismXY(mb, F0, [xa + 0.012, h.yt, xb - 0.012, h.yt, tx1 - 0.012, ty + (key ? 0.12 : 0), tx0 + 0.012, ty + (key ? 0.12 : 0)], 0, key ? 0.24 : 0.15);
    }
    fprismXY(mb, F0, [h.xl - 0.22, h.yb - 0.16, h.xr + 0.22, h.yb - 0.16, h.xr + 0.22, h.yb, h.xl - 0.22, h.yb], -0.1, 0.24);
  }
  // ---- second floor: round-headed windows with voussoir archivolt, impost blocks, keystone, bracketed sills
  mb.style(stone, Surf.Trim, 0.4, 9);
  for (const h of f2) {
    const xc = (h.xl + h.xr) / 2, R = h.arch!;
    const nV = 11;
    for (let k = 0; k < nV; k++) {
      const a0 = (k / nV) * Math.PI, a1 = ((k + 1) / nV) * Math.PI, key = k === (nV - 1) / 2;
      const gap = 0.012 / (R + 0.2);
      fprismXY(mb, F0, sector(xc, h.yt, R + 0.01, R + (key ? 0.48 : 0.3), a0 + gap, a1 - gap, 2), 0, key ? 0.2 : 0.11);
    }
    for (const s of [-1, 1]) {
      const xe = s < 0 ? h.xl : h.xr;
      fbox(mb, F0, Math.min(xe, xe + s * 0.36), h.yt - 0.2, 0, Math.max(xe, xe + s * 0.36), h.yt + 0.02, 0.12);   // impost
      fbox(mb, F0, Math.min(xe, xe + s * 0.2), h.yb, 0, Math.max(xe, xe + s * 0.2), h.yt - 0.2, 0.06);          // jamb strip
    }
    frun(mb, F0, [0, 0, 0.24, 0, 0.24, 0.07, 0.18, 0.13, 0, 0.13], h.yb - 0.13, h.xl - 0.3, h.xr + 0.3);
    for (const s of [-1, 1]) fprismXY(mb, F0, [0, 0, 0.16, 0, 0.16, -0.32, 0.08, -0.34, 0, -0.18].map((v, i) => i % 2 ? h.yb - 0.13 + v : (s < 0 ? h.xl - 0.22 : h.xr + 0.06) + v), 0, 0.18);
  }
  // ---- third floor: eared architraves, lintel with keystone and cornice cap
  for (const h of f3) {
    const xc = (h.xl + h.xr) / 2, w = h.xr - h.xl;
    fbox(mb, F0, h.xl - 0.2, h.yb, 0, h.xl, h.yt, 0.07); fbox(mb, F0, h.xr, h.yb, 0, h.xr + 0.2, h.yt, 0.07);
    fbox(mb, F0, h.xl - 0.06, h.yb, 0.07, h.xl, h.yt, 0.1); fbox(mb, F0, h.xr, h.yb, 0.07, h.xr + 0.06, h.yt, 0.1);
    fbox(mb, F0, h.xl - 0.3, h.yt, 0, h.xr + 0.3, h.yt + 0.34, 0.12);
    fprismXY(mb, F0, [xc - 0.15, h.yt - 0.08, xc + 0.15, h.yt - 0.08, xc + 0.21, h.yt + 0.42, xc - 0.21, h.yt + 0.42], 0, 0.2);
    frun(mb, F0, [0, 0, 0.16, 0, 0.24, 0.06, 0.24, 0.13, 0, 0.13], h.yt + 0.34, h.xl - 0.44, h.xr + 0.44);
    frun(mb, F0, [0, 0, 0.22, 0, 0.22, 0.06, 0.17, 0.11, 0, 0.11], h.yb - 0.11, h.xl - 0.28, h.xr + 0.28);
    void w;
  }

  // ---- bracketed cornice (front + flanks + rear), modillions and corner consoles
  const yc = 12.35;
  mb.style(stone, Surf.Trim, 0.4, 14);
  const corProf = [0, 0, 0.1, 0, 0.1, 0.08, 0.18, 0.14, 0.18, 0.3, 0.26, 0.36, 0.84, 0.4, 0.84, 0.6, 0.91, 0.66, 0.96, 0.74, 0.96, 0.8, 0, 0.8];
  frun(mb, F0, corProf, yc, -W - 0.96, W + 0.96);
  frun(mb, E, corProf, yc, -0.96, D + 0.96);
  frun(mb, Wf, corProf, yc, -D - 0.96, 0.96);
  frun(mb, { o: [0, 0, -D], yaw: Math.PI }, corProf, yc, -W - 0.96, W + 0.96);
  const modProf = [0.18, 0.12, 0.3, 0.12, 0.4, 0.22, 0.62, 0.27, 0.76, 0.31, 0.76, 0.4, 0.18, 0.4];
  const modRun = (f: Frame, x0: number, x1: number) => { for (let x = x0; x <= x1 + 1e-3; x += 0.72) extrude(mb, modProf, T(f, 0, yc, 0), N(f, 0, 0, 1), N(f, 0, 1, 0), N(f, 1, 0, 0), x - 0.1, x + 0.1); };
  modRun(F0, -W + 0.45, W - 0.45); modRun(E, 0.45, D - 0.45); modRun(Wf, -D + 0.45, -0.45);
  // dentil course under the bed mould
  for (let x = -W + 0.12; x < W - 0.1; x += 0.24) fbox(mb, F0, x, yc - 0.18, 0, x + 0.12, yc, 0.1);
  const consProf = [0, -1.15, 0.2, -1.15, 0.3, -0.95, 0.26, -0.62, 0.42, -0.3, 0.58, 0.05, 0.62, 0.4, 0, 0.4];
  for (const x of [-W + 0.05, W - 0.45]) extrude(mb, consProf, T(F0, 0, yc, 0), [0, 0, 1], [0, 1, 0], [1, 0, 0], x, x + 0.4);
  // pressed-panel frieze between the consoles
  for (let k = 0; k < 5; k++) { const x0 = -W + 0.7 + k * 2.86; fbox(mb, F0, x0, 12.06, 0, x0 + 2.4, 12.14, 0.03); }

  // ---- copper box gutter & downpipes
  parts.box(copperNew, 0, H + 0.04, 0.9, W * 2 + 1.9, 0.12, 0.06);
  for (const s of [-1, 1]) {
    const x = s * (W - 0.22);
    parts.box(copper, x, H - 0.75, 0.2, 0.32, 0.34, 0.26);
    parts.rod(copper, [x, H - 0.92, 0.17], [x, 0.7, 0.17], 0.055, 8);
    parts.rod(copper, [x, 0.72, 0.17], [x, CH + 0.12, 0.4], 0.055, 8);
    for (let y = 1.6; y < H - 1; y += 2.1) parts.box(iron, x, y, 0.1, 0.16, 0.05, 0.18);
  }

  // ================= windows: recessed sashes, glazing bars, interiors =================
  const sash = (f: Frame, h: Hole, zw: number, cols: number, rowsTop: number, rowsBot: number, cell: number) => {
    const w = h.xr - h.xl, xc = (h.xl + h.xr) / 2, R = h.arch ?? 0, ym = h.yb + (h.yt - h.yb) * 0.52;
    rooms.add(f, h.xl, h.xr, h.yb, h.yt + R, zw - 0.08, 1.6, cell);
    parts.add(new THREE.PlaneGeometry(w, h.yt - h.yb), glassMat, ...T(f, xc, (h.yb + h.yt) / 2, zw - 0.03), 0, f.yaw, 0);
    if (R > 0) parts.add(new THREE.CircleGeometry(R, 16, 0, Math.PI), glassMat, ...T(f, xc, h.yt, zw - 0.03), 0, f.yaw, 0);
    const fw = 0.075, bw = 0.026;
    // box frame
    fbox(mbPaint, f, h.xl, h.yb, zw - 0.1, h.xl + fw, h.yt, zw + 0.02);
    fbox(mbPaint, f, h.xr - fw, h.yb, zw - 0.1, h.xr, h.yt, zw + 0.02);
    fbox(mbPaint, f, h.xl, h.yb, zw - 0.1, h.xr, h.yb + 0.11, zw + 0.05);
    if (!R) fbox(mbPaint, f, h.xl, h.yt - fw, zw - 0.1, h.xr, h.yt, zw + 0.02);
    // lower sash sits proud of the upper: meeting rails and stiles
    fbox(mbPaint, f, h.xl + fw, ym - 0.03, zw - 0.02, h.xr - fw, ym + 0.035, zw + 0.03);
    fbox(mbPaint, f, h.xl + fw, ym + 0.035, zw - 0.07, h.xr - fw, ym + 0.08, zw - 0.02);
    for (const s of [0, 1]) {
      const y0 = s ? ym : h.yb + 0.11, y1 = s ? h.yt - (R ? 0 : fw) : ym, rows = s ? rowsTop : rowsBot, zz = s ? zw - 0.06 : zw - 0.01;
      for (let k = 1; k < cols; k++) { const x = h.xl + fw + ((w - 2 * fw) * k) / cols; fbox(mbPaint, f, x - bw / 2, y0, zz - 0.03, x + bw / 2, y1, zz); }
      for (let k = 1; k < rows; k++) { const y = y0 + ((y1 - y0) * k) / rows; fbox(mbPaint, f, h.xl + fw, y - bw / 2, zz - 0.03, h.xr - fw, y + bw / 2, zz); }
    }
    if (R > 0) {
      fprismXY(mbPaint, f, sector(xc, h.yt, R - fw, R + 0.002, 0, Math.PI, 12), zw - 0.1, zw + 0.02);
      fbox(mbPaint, f, h.xl, h.yt - 0.03, zw - 0.08, h.xr, h.yt + 0.03, zw + 0.0);
      for (let k = 1; k < 4; k++) { const a = (k / 4) * Math.PI; fprismXY(mbPaint, f, [xc - bw / 2 * Math.sin(a), h.yt + bw / 2 * Math.cos(a), xc + bw / 2 * Math.sin(a), h.yt - bw / 2 * Math.cos(a), xc + Math.cos(a) * (R - fw) + bw / 2 * Math.sin(a), h.yt + Math.sin(a) * (R - fw) - bw / 2 * Math.cos(a), xc + Math.cos(a) * (R - fw) - bw / 2 * Math.sin(a), h.yt + Math.sin(a) * (R - fw) + bw / 2 * Math.cos(a)], zw - 0.06, zw - 0.03); }
      fprismXY(mbPaint, f, sector(xc, h.yt, 0.16, 0.2, 0, Math.PI, 8), zw - 0.06, zw - 0.03);
    }
  };
  sash(F0, gWin[0], -0.34, 2, 2, 2, 0); sash(F0, gWin[1], -0.34, 2, 2, 2, 3);
  sash(F0, f2[0], -0.22, 2, 2, 2, 1); sash(F0, f2[1], -0.22, 2, 3, 2, 0); sash(F0, f2[2], -0.22, 2, 2, 2, 2);
  sash(F0, f3[0], -0.22, 2, 2, 2, 3); sash(F0, f3[1], -0.22, 2, 2, 2, 1); sash(F0, f3[2], -0.22, 2, 2, 2, 0);

  // ================= entrance portico =================
  const LAND = 1.0, PZ = 1.15;
  mb.style(stone, Surf.Trim, 0.4, 5);
  // stoop: landing + five steps with nosings, cheek walls
  fbox(mb, F0, -2.25, CH, 0, 2.25, LAND, PZ, false);
  const nSt = 5, rise = (LAND - CH) / nSt;
  for (let k = 0; k < nSt; k++) {
    const y1 = LAND - k * rise, z0 = PZ + k * 0.3;
    fbox(mb, F0, -1.75, CH, z0, 1.75, y1 - rise, z0 + 0.3);
    fbox(mb, F0, -1.77, y1 - rise - 0.035, z0 + 0.0, 1.77, y1 - rise, z0 + 0.33);
  }
  for (const s of [-1, 1]) fprismXY(mb, { o: [s * 2.0, 0, 0], yaw: Math.PI / 2 }, [-PZ - nSt * 0.3, CH, 0, CH, 0, LAND + 0.15, -PZ, LAND + 0.15, -PZ - nSt * 0.3, CH + 0.45], -0.25, 0.25);
  // door surround: pilasters, columns, entablature
  for (const s of [-1, 1]) {
    fbox(mb, F0, s * 1.75 - 0.24, LAND, 0, s * 1.75 + 0.24, 3.75, 0.12);             // pilaster
    fbox(mb, F0, s * 1.75 - 0.3, LAND, 0.52, s * 1.75 + 0.3, LAND + 0.2, 1.12);           // plinth
    mb.cyl(s * 1.75, LAND + 0.2, 0.82, 0.23, 0.21, 0.08, 16, false);
    mb.cyl(s * 1.75, LAND + 0.28, 0.82, 0.19, 0.165, 3.36 - LAND - 0.28, 16, false);     // entasis shaft
    mb.cyl(s * 1.75, 3.36, 0.82, 0.17, 0.24, 0.16, 16, false);                          // echinus
    fbox(mb, F0, s * 1.75 - 0.28, 3.52, 0.54, s * 1.75 + 0.28, 3.75, 1.1);               // abacus
  }
  frun(mb, F0, [0, 0, 1.1, 0, 1.1, 0.2, 0, 0.2], 3.75, -2.3, 2.3);                         // architrave
  frun(mb, F0, [0, 0, 1.06, 0, 1.06, 0.18, 0, 0.18], 3.95, -2.25, 2.25);                   // frieze
  frun(mb, F0, [0, 0, 1.1, 0, 1.26, 0.08, 1.3, 0.17, 0, 0.17], 4.13, -2.5, 2.5);           // cornice (portico roof = balcony)
  // door: panelled double leaves, fanlight transom, brass furniture
  const DZ = -0.46;
  fbox(mbPaint, F0, -1.15, LAND, DZ - 0.05, 1.15, 3.26, DZ + 0.02);                            // frame back
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -1.08 : 0.01, x1 = s < 0 ? -0.01 : 1.08;
    fbox(mbDoor, F0, x0, LAND, DZ, x1, 3.18, DZ + 0.06);
    // raised panels (two tall + one low) per leaf
    for (const [py0, py1] of [[LAND + 0.15, LAND + 0.75], [LAND + 0.95, 3.0]]) {
      fbox(mbDoor, F0, x0 + 0.12, py0, DZ + 0.06, x1 - 0.12, py1, DZ + 0.085);
      fbox(mbDoor, F0, x0 + 0.18, py0 + 0.06, DZ + 0.085, x1 - 0.18, py1 - 0.06, DZ + 0.1);
    }
    parts.cyl(brass, s * 0.12, LAND + 1.12, DZ + 0.12, 0.035, 0.035, 0.03, 10);
    parts.add(new THREE.SphereGeometry(0.04, 10, 8), brass, s * 0.12, LAND + 1.12, DZ + 0.16);
  }
  fbox(mbPaint, F0, -1.15, 3.18, DZ, 1.15, 3.26, DZ + 0.08);
  {
    const ty = 3.26, tw = 2.3;
    rooms.add(F0, -1.08, 1.08, ty, 3.72, DZ - 0.05, 1.2, 0);
    parts.add(new THREE.PlaneGeometry(tw - 0.12, 0.44), glassMat, 0, ty + 0.23, DZ + 0.0);
    for (let k = 1; k < 8; k++) { const a = (k / 8) * Math.PI; parts.rod(paint, [0, ty + 0.02, DZ + 0.02], [Math.cos(a) * 1.05, ty + 0.02 + Math.sin(a) * 0.44, DZ + 0.02], 0.016, 4); }
    fprismXY(mbPaint, F0, sector(0, ty, 0.14, 0.2, 0, Math.PI, 8), DZ, DZ + 0.04);
  }
  // portico soffit lantern
  parts.rod(iron, [0, 4.13, 0.62], [0, 3.55, 0.62], 0.012, 4);
  parts.box(iron, 0, 3.55, 0.62, 0.3, 0.04, 0.3);
  parts.box(iron, 0, 3.18, 0.62, 0.26, 0.03, 0.26);
  parts.add(new THREE.ConeGeometry(0.22, 0.14, 4, 1), iron, 0, 3.62, 0.62, 0, Math.PI / 4, 0);
  const lanternGlow = beacon(0xffb466, 0.08, 3.2, false);
  parts.add(new THREE.BoxGeometry(0.22, 0.33, 0.22), lanternGlow, 0, 3.37, 0.62);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.rod(iron, [sx * 0.13, 3.2, 0.62 + sz * 0.13], [sx * 0.13, 3.55, 0.62 + sz * 0.13], 0.012, 4);
  // stoop railings (wrought iron, ball newels)
  for (const s of [-1, 1]) {
    const x = s * 1.92, zA = PZ + nSt * 0.3 - 0.05, zB = 0.05;
    const yA = CH + 0.2, yB = LAND;
    parts.rod(iron, [x, yA + 0.9, zA], [x, yB + 0.9, PZ], 0.025, 6);
    parts.rod(iron, [x, yB + 0.9, PZ], [x, yB + 0.9, zB], 0.025, 6);
    parts.rod(iron, [x, yA + 0.12, zA], [x, yB + 0.12, PZ], 0.015, 4);
    for (let t = 0; t <= 1.0001; t += 1 / 9) { const z = zA + (PZ - zA) * t, y = yA + (yB - yA) * t; parts.rod(iron, [x, y + 0.12, z], [x, y + 0.9, z], 0.011, 4); }
    for (let z = PZ; z > zB; z -= 0.14) parts.rod(iron, [x, yB, z], [x, yB + 0.9, z], 0.011, 4);
    parts.cyl(iron, x, CH + 0.2, zA, 0.05, 0.04, 1.05, 8);
    parts.add(new THREE.SphereGeometry(0.075, 10, 8), iron, x, CH + 1.3, zA);
  }
  // balcony railing on the portico roof
  for (let x = -2.4; x <= 2.401; x += 0.12) parts.rod(iron, [x, 4.3, 1.22], [x, 5.15, 1.22], 0.011, 4);
  parts.rod(iron, [-2.42, 5.15, 1.22], [2.42, 5.15, 1.22], 0.025, 6);
  parts.rod(iron, [-2.42, 4.4, 1.22], [2.42, 4.4, 1.22], 0.018, 6);
  for (const s of [-1, 1]) { parts.rod(iron, [s * 2.42, 5.15, 1.22], [s * 2.42, 5.15, 0.05], 0.025, 6); for (let z = 1.1; z > 0.05; z -= 0.12) parts.rod(iron, [s * 2.42, 4.3, z], [s * 2.42, 5.15, z], 0.011, 4); }
  for (let k = 0; k < 5; k++) { const x = -1.6 + k * 0.8; parts.add(new THREE.TorusGeometry(0.22, 0.012, 4, 16), iron, x, 4.78, 1.22); }

  // ================= mansard roof =================
  const mx0 = -W - 0.05, mx1 = W + 0.05, mz0 = -D - 0.05, mz1 = 0.05;
  const mProf: [number, number][] = [[0, H], [0.32, H + 0.42], [0.85, 16.7]];
  const ringAt = (ins: number): [number, number][] => [[mx0 + ins, mz1 - ins], [mx1 - ins, mz1 - ins], [mx1 - ins, mz0 + ins], [mx0 + ins, mz0 + ins]];
  const outN: V3[] = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
  for (let s = 0; s < mProf.length - 1; s++) {
    const [i0, y0] = mProf[s], [i1, y1] = mProf[s + 1];
    const r0 = ringAt(i0), r1 = ringAt(i1);
    for (let e = 0; e < 4; e++) {
      const j = (e + 1) % 4;
      quad3(mbSlate, [r0[e][0], y0, r0[e][1]], [r0[j][0], y0, r0[j][1]], [r1[j][0], y1, r1[j][1]], [r1[e][0], y1, r1[e][1]], [outN[e][0], 0.3, outN[e][2]]);
    }
  }
  // copper curb moulding at the top of the steep slope, then the low upper roof and deck
  const RT = 17.15;
  {
    const ins = 0.85, prof = [0, 0, 0.12, 0, 0.16, 0.06, 0.16, 0.16, 0, 0.2];
    const e = 0.16, hx = mx1 - ins + e, za = mz1 - ins + e, zb = mz0 + ins - e;
    frun(mbCopper, { o: [0, 0, mz1 - ins], yaw: 0 }, prof, 16.7, -hx, hx);
    frun(mbCopper, { o: [0, 0, mz0 + ins], yaw: Math.PI }, prof, 16.7, -hx, hx);
    frun(mbCopper, { o: [mx1 - ins, 0, 0], yaw: Math.PI / 2 }, prof, 16.7, -za, -zb);
    frun(mbCopper, { o: [mx0 + ins, 0, 0], yaw: -Math.PI / 2 }, prof, 16.7, zb, za);
    const r1 = ringAt(0.85), r2 = ringAt(2.1);
    for (let e = 0; e < 4; e++) {
      const j = (e + 1) % 4;
      quad3(mbSlate, [r1[e][0], 16.9, r1[e][1]], [r1[j][0], 16.9, r1[j][1]], [r2[j][0], RT, r2[j][1]], [r2[e][0], RT, r2[e][1]], [outN[e][0], 1, outN[e][2]]);
    }
    const deck = rectRing(0, (mz0 + mz1) / 2, (mx1 - mx0) / 2 - 2.1, (mz1 - mz0) / 2 - 2.1, 0);
    mb.style(stone, Surf.Roof, 0.4, RT); mb.cap(deck, RT);
    // ornamental iron cresting around the deck edge
    const r3 = ringAt(2.1);
    for (let e = 0; e < 4; e++) {
      const j = (e + 1) % 4, ax = r3[e][0], az = r3[e][1], bx = r3[j][0], bz = r3[j][1], L = Math.hypot(bx - ax, bz - az);
      parts.rod(iron, [ax, RT + 0.5, az], [bx, RT + 0.5, bz], 0.02, 4);
      parts.rod(iron, [ax, RT + 0.1, az], [bx, RT + 0.1, bz], 0.02, 4);
      for (let t = 0; t <= L; t += 0.3) {
        const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L, big = Math.round(t / 0.3) % 4 === 0;
        parts.rod(iron, [x, RT, z], [x, RT + (big ? 0.85 : 0.6), z], big ? 0.018 : 0.011, 4);
        if (big) parts.add(new THREE.ConeGeometry(0.05, 0.16, 4), iron, x, RT + 0.92, z);
      }
    }
  }

  // ---- dormers (front pair + three on each flank): pilastered aedicules with segmental pediments
  const dormer = (f: Frame, x: number, cell: number) => {
    const w = 1.7, x0 = x - w / 2, x1 = x + w / 2, y0 = H + 0.05, yt = H + 2.2, zf = -0.12, back = -1.9;
    const hole: Hole = { xl: x - 0.52, xr: x + 0.52, yb: y0 + 0.4, yt: yt - 0.22, arch: 0 };
    mb.style(stone, Surf.Trim, 0.4, 20);
    wallHoles(mb, f, x0, x1, y0, yt, zf, [hole], 0.2);
    for (const s of [x0, x1 - 0.22]) fbox(mb, f, s, y0, zf, s + 0.22, yt, zf + 0.08);
    fbox(mb, f, x0 - 0.06, yt, zf, x1 + 0.06, yt + 0.16, zf + 0.12);
    fprismXY(mb, f, sector(x, yt - 0.9, 1.06, 1.24, Math.acos(0.92 / 1.15), Math.PI - Math.acos(0.92 / 1.15), 10), zf, zf + 0.16);
    // tympanum infill
    const tp: number[] = []; const aT = Math.acos(0.92 / 1.15);
    for (let k = 0; k <= 10; k++) { const a = aT + ((Math.PI - 2 * aT) * k) / 10; tp.push(x + Math.cos(a) * 1.06, yt - 0.9 + Math.sin(a) * 1.06); }
    fprismXY(mb, f, tp, zf - 0.05, zf + 0.02);
    // cheeks & curved roof in slate, copper apron at the base
    for (const s of [x0, x1]) fq(mbSlate, f, [s, y0, back], [s, y0, zf], [s, yt + 0.1, zf], [s, yt + 0.1, back], [s === x0 ? -1 : 1, 0, 0]);
    for (let k = 0; k < 8; k++) {
      const a0 = aT + ((Math.PI - 2 * aT) * k) / 8, a1 = aT + ((Math.PI - 2 * aT) * (k + 1)) / 8;
      const p0 = [x + Math.cos(a0) * 1.2, yt - 0.9 + Math.sin(a0) * 1.2], p1 = [x + Math.cos(a1) * 1.2, yt - 0.9 + Math.sin(a1) * 1.2];
      fq(mbSlate, f, [p0[0], p0[1], zf], [p1[0], p1[1], zf], [p1[0], p1[1], back], [p0[0], p0[1], back], [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0]);
    }
    fbox(mbCopper, f, x0 - 0.05, y0 - 0.02, zf - 0.3, x1 + 0.05, y0 + 0.12, zf + 0.06);
    sash(f, hole, zf - 0.14, 2, 2, 2, cell);
  };
  dormer(F0, -5.25, 2); dormer(F0, 5.25, 0);
  for (const [z, c] of [[3.8, 1], [8.5, 3], [13.2, 2]] as const) { dormer({ o: [W + 0.05, 0, 0], yaw: Math.PI / 2 }, z, c); dormer({ o: [-W - 0.05, 0, 0], yaw: -Math.PI / 2 }, -z, (c + 1) % 4); }

  // ---- chimneys on the party walls: corbelled brick stacks with terracotta pots
  for (const [x, z] of [[-W + 0.75, -6.15], [W - 0.75, -6.15], [-W + 0.75, -10.85], [W - 0.75, -10.85]]) {
    mb.style(brick, Surf.Blank, 0.4, 30);
    mb.box(x, H, z, 1.1, RT + 2.0 - H, 1.6, 0);
    mb.style(stone, Surf.Trim, 0.4, 30);
    mb.box(x, RT + 1.6, z, 1.24, 0.14, 1.74, 0); mb.box(x, RT + 1.74, z, 1.32, 0.12, 1.82, 0);
    mb.style(brick, Surf.Blank, 0.4, 30); mb.box(x, RT + 1.86, z, 1.1, 0.3, 1.6, 0);
    mb.style(stone, Surf.Trim, 0.4, 30); mb.box(x, RT + 2.16, z, 1.2, 0.1, 1.7, 0);
    for (const dz of [-0.45, 0, 0.45]) { parts.cyl(terracotta, x, RT + 2.26, z + dz, 0.15, 0.11, 0.55, 10); parts.cyl(terracotta, x, RT + 2.81, z + dz, 0.12, 0.14, 0.08, 10); }
    parts.box(copper, x, RT - 0.05, z, 1.2, 0.16, 1.7);
  }
  // roof lantern (skylight)
  mb.style(brick, Surf.Glass, 0.4, 30); mb.cyl(0, RT, -9.5, 1.9, 1.9, 1.2, 8, false);
  parts.add(new THREE.ConeGeometry(2.1, 1.3, 8, 1, true), copper, 0, RT + 1.85, -9.5, 0, Math.PI / 8, 0);
  parts.add(new THREE.SphereGeometry(0.16, 10, 8), copperNew, 0, RT + 2.55, -9.5);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; parts.rod(paint, [Math.cos(a) * 1.9, RT, -9.5 + Math.sin(a) * 1.9], [Math.cos(a) * 1.9, RT + 1.2, -9.5 + Math.sin(a) * 1.9], 0.04, 4); }

  // ================= the great round window (Window of the Worlds) =================
  const GZ = 0.38, GB = -0.38, GW = 3.55, gy0 = H + 0.0, gS = H + 3.05, cy = H + 3.2, RW = 2.3;
  {
    // round-headed stone gable with a deep circular opening
    const outer: number[] = [-GW, gy0, GW, gy0, GW, gS];
    for (let k = 1; k < 24; k++) { const a = (k / 24) * Math.PI; outer.push(Math.cos(a) * GW, gS + Math.sin(a) * GW); }
    outer.push(-GW, gS);
    const hole: number[] = [];
    const HS = 48;
    for (let k = 0; k < HS; k++) { const a = (k / HS) * Math.PI * 2; hole.push(Math.cos(a) * RW, cy + Math.sin(a) * RW); }
    const all = [...outer, ...hole];
    const tris = earcut(all, [outer.length / 2], 2);
    mb.style(stone, Surf.Trim, 0.4, 30);
    const P2 = (i: number, z: number): V3 => [all[i * 2], all[i * 2 + 1], z];
    for (let k = 0; k < tris.length; k += 3) {
      tri3(mb, P2(tris[k], GZ), P2(tris[k + 1], GZ), P2(tris[k + 2], GZ), [0, 0, 1]);
      tri3(mb, P2(tris[k], GB), P2(tris[k + 1], GB), P2(tris[k + 2], GB), [0, 0, -1]);
    }
    extrude(mb, outer, [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], GB, GZ, false);
    for (let k = 0; k < HS; k++) {
      const j = (k + 1) % HS, a = ((k + 0.5) / HS) * Math.PI * 2;
      quad3(mb, [hole[k * 2], hole[k * 2 + 1], GZ], [hole[j * 2], hole[j * 2 + 1], GZ], [hole[j * 2], hole[j * 2 + 1], GB], [hole[k * 2], hole[k * 2 + 1], GB], [-Math.cos(a), -Math.sin(a), 0]);
    }
    // moulded surround: two stepped rings, four keystones, coping and pilasters
    fprismXY(mb, F0, sector(0, cy, RW, RW + 0.32, 0, Math.PI * 2, 48), GZ, GZ + 0.1);
    fprismXY(mb, F0, sector(0, cy, RW + 0.08, RW + 0.22, 0, Math.PI * 2, 48), GZ + 0.1, GZ + 0.17);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), tx = -sa, ty = ca;
      const p = (r: number, t: number) => [ca * r + tx * t, cy + sa * r + ty * t];
      fprismXY(mb, F0, [...p(RW - 0.06, -0.17), ...p(RW - 0.06, 0.17), ...p(RW + 0.52, 0.26), ...p(RW + 0.52, -0.26)], GZ, GZ + 0.26);
    }
    fprismXY(mb, F0, sector(0, gS, GW - 0.02, GW + 0.24, -0.04, Math.PI + 0.04, 24), GB - 0.06, GZ + 0.14);
    for (const s of [-1, 1]) fbox(mb, F0, s > 0 ? GW - 0.42 : -GW - 0.04, gy0, GZ, s > 0 ? GW + 0.04 : -GW + 0.42, gS, GZ + 0.12);
    fbox(mb, F0, -GW - 0.14, gS - 0.22, GZ, GW + 0.14, gS, GZ + 0.2);
    // stone finial
    mb.cyl(0, gS + GW + 0.2, 0, 0.26, 0.2, 0.3, 12, true);
    parts.add(new THREE.SphereGeometry(0.26, 14, 10), stonePbr, 0, gS + GW + 0.72, 0);
    // the gable's body: slate cheeks and a barrel roof running back into the mansard
    const back = -4.6;
    for (const s of [-1, 1]) quad3(mbSlate, [s * GW, gy0, back], [s * GW, gy0, GB], [s * GW, gS, GB], [s * GW, gS, back], [s, 0, 0]);
    for (let k = 0; k < 16; k++) {
      const a0 = (k / 16) * Math.PI, a1 = ((k + 1) / 16) * Math.PI, am = (a0 + a1) / 2;
      quad3(mbSlate, [Math.cos(a0) * GW, gS + Math.sin(a0) * GW, GB], [Math.cos(a1) * GW, gS + Math.sin(a1) * GW, GB], [Math.cos(a1) * GW, gS + Math.sin(a1) * GW, back], [Math.cos(a0) * GW, gS + Math.sin(a0) * GW, back], [Math.cos(am), Math.sin(am), 0]);
      tri3(mbSlate, [0, gS, back], [Math.cos(a0) * GW, gS + Math.sin(a0) * GW, back], [Math.cos(a1) * GW, gS + Math.sin(a1) * GW, back], [0, 0, -1]);
    }
    fbox(mbCopper, F0, -GW - 0.06, gy0 - 0.02, back, -GW + 0.02, gy0 + 0.3, GB);
    fbox(mbCopper, F0, GW - 0.02, gy0 - 0.02, back, GW + 0.06, gy0 + 0.3, GB);
  }
  // glass (softly glowing cathedral glass) set deep in the opening, with tracery standing proud of it
  const glassZ = GB + 0.12;
  const sigil = new THREE.Mesh(new THREE.CircleGeometry(RW + 0.02, 64), signMaterial(sigilGlassTexture(), { night: 1.25, day: 0.32, scaleWith: 'landmark' }));
  sigil.position.set(0, cy, glassZ); glows.add(sigil);
  // a warm chamber behind the glass so it never reads as a flat decal
  {
    const s = RW / 256;
    const pts2 = (fn: (t: number) => [number, number], n: number) => {
      const out: THREE.Vector3[] = [];
      for (let k = 0; k <= n; k++) { const [px, py] = fn(k / n); const X = (px - 256) * s, Y = (256 - py) * s; if (X * X + Y * Y <= (RW - 0.04) ** 2) out.push(new THREE.Vector3(X, cy + Y, glassZ + 0.05)); }
      return out;
    };
    const ribs: [THREE.Vector3[], number][] = [
      [pts2((t) => { const a = Math.PI * (0.31 + 0.38 * t); return [256 + 520 * Math.cos(a), -150 + 520 * Math.sin(a)]; }, 40), 0.055],
      [pts2((t) => { const a = Math.PI * (-0.24 + 0.48 * t); return [-170 + 560 * Math.cos(a), 256 + 560 * Math.sin(a)]; }, 40), 0.055],
      [pts2((t) => { const a = Math.PI * (0.77 + 0.46 * t); return [700 + 520 * Math.cos(a), 256 + 520 * Math.sin(a)]; }, 40), 0.055],
      [pts2((t) => { const u = 1 - t; return [u * u * 60 + 2 * u * t * 256 + t * t * 452, u * u * 150 + 2 * u * t * 290 + t * t * 150]; }, 40), 0.045],
      [pts2((t) => [256, 14 + 484 * t], 20), 0.075],
    ];
    for (const [p, r] of ribs) if (p.length > 2) parts.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), p.length * 2, r, 6, false), r > 0.06 ? stonePbr : lead);
    parts.add(new THREE.TorusGeometry(RW * 214 / 256, 0.05, 6, 64), lead, 0, cy, glassZ + 0.05);
    parts.add(new THREE.TorusGeometry(RW - 0.03, 0.09, 6, 64), stonePbr, 0, cy, glassZ + 0.04);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; parts.rod(lead, [Math.cos(a) * RW * 0.836, cy + Math.sin(a) * RW * 0.836, glassZ + 0.05], [Math.cos(a) * (RW - 0.05), cy + Math.sin(a) * (RW - 0.05), glassZ + 0.05], 0.03, 5); }
  }
  // subtle magic: a slow mandala hovering before the window
  const mMat = extendMaterial(new THREE.MeshBasicMaterial({ map: mandalaTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), {
    key: 'mandala', uniforms: { uMagic: U.uMagic }, fPars: 'uniform float uMagic;', fFinal: 'gl_FragColor.rgb *= uMagic * mix(0.35, 1.5, uNight);',
  });
  const mandala = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), mMat);
  mandala.position.set(0, cy, 1.4);
  glows.add(mandala);

  // ================= coffee shop across the street (faces −z) =================
  const SX0 = 5.5, SX1 = 14.5, SD = 13, SH = 14.6, GF = 4.3;
  const F = STREET;
  const SF: Frame = { o: [SX1, 0, F], yaw: Math.PI };      // shop frame: x = 0 at the east pilaster, out = −z (toward the street)
  const SW = SX1 - SX0;
  const shopRing = rectRing((SX0 + SX1) / 2, F + SD / 2, SW / 2, SD / 2, 0);
  mb.style(shopBrick, Surf.Blank, 0.6, SH);
  for (const [a, b] of [[[SX1, F + SD], [SX1, F]], [[SX0, F], [SX0, F + SD]], [[SX0, F + SD], [SX1, F + SD]]]) mb.walls([a[0], a[1], b[0], b[1]], 0, GF, 0);
  mb.style(shopBrick, Surf.Wall, 0.6, SH); mb.walls(shopRing, GF, SH + 0.9, 2.6);
  mb.style(shopBrick, Surf.Roof, 0.6, SH); mb.cap(shopRing, SH);
  mb.style(shopBrick, Surf.Trim, 0.6, SH);
  frun(mb, SF, [0, 0, 0.2, 0, 0.5, 0.25, 0.6, 0.45, 0.6, 0.6, 0, 0.6], SH + 0.3, -0.6, SW + 0.6);
  // storefront joinery (painted timber) — x: 0..0.45 pilaster | 0.45..2.4 recessed entry | 2.4..2.7 pier | 2.7..8.55 window | 8.55..9 pilaster
  const ENT0 = 0.45, ENT1 = 2.4, WIN0 = 2.7, WIN1 = 8.55, REC = 1.35, GT = 2.9, TR = 3.42;
  const mbShop = new MeshBuilder(8192);
  for (const [a, b] of [[0, ENT0], [WIN1, SW]]) {
    fbox(mbShop, SF, a, CH, -0.02, b, GF, 0.16);
    fbox(mbShop, SF, a - 0.04, CH, 0.16, b + 0.04, CH + 0.35, 0.22);
    fbox(mbShop, SF, a - 0.05, TR - 0.12, 0.16, b + 0.05, TR, 0.24);
    for (let y = 0.8; y < TR - 0.4; y += 0.62) fbox(mbShop, SF, a + 0.08, y, 0.16, b - 0.08, y + 0.48, 0.19);
  }
  fbox(mbShop, SF, ENT1, CH, -REC, WIN0, TR, 0.05);                                     // pier
  fbox(mbShop, SF, WIN0, CH, -0.2, WIN1, 0.72, 0.04);                                   // stall riser
  for (let k = 0; k < 3; k++) { const a = WIN0 + 0.1 + k * 1.95, b = a + 1.75; fbox(mbShop, SF, a, 0.26, 0.04, b, 0.62, 0.07); fbox(mbShop, SF, a + 0.08, 0.32, 0.07, b - 0.08, 0.56, 0.085); }
  fbox(mbShop, SF, WIN0, 0.72, -0.2, WIN1, 0.8, 0.08);                                  // sill
  for (const x of [WIN0, WIN0 + 1.95, WIN0 + 3.9, WIN1]) fbox(mbShop, SF, x - 0.05, 0.8, -0.18, x + 0.05, TR, -0.04);
  fbox(mbShop, SF, ENT0, GT, -0.2, WIN1, GT + 0.1, -0.02);                               // transom bar
  for (let x = ENT0 + 0.65; x < WIN1; x += 0.65) fbox(mbShop, SF, x - 0.025, GT + 0.1, -0.15, x + 0.025, TR, -0.08);
  fbox(mbShop, SF, ENT0, TR, -0.2, WIN1, TR + 0.08, 0.04);
  // fascia board with mouldings, and the cornice above it
  fbox(mbShop, SF, -0.05, TR + 0.08, 0, SW + 0.05, GF - 0.1, 0.1);
  frun(mbShop, SF, [0, 0, 0.16, 0, 0.16, 0.04, 0.26, 0.1, 0.32, 0.2, 0.32, 0.28, 0, 0.28], GF - 0.12, -0.14, SW + 0.14);
  frun(mbShop, SF, [0, 0, 0.12, 0, 0.12, 0.06, 0, 0.06], TR + 0.08, -0.05, SW + 0.05, 0.1);
  // entry recess: tiled floor, side panels, glazed door at the back
  fbox(mbShop, SF, ENT0, CH, -REC - 0.02, ENT0 + 0.08, TR, 0.0);
  fbox(mbShop, SF, ENT0, CH, -REC - 0.06, ENT1, TR, -REC);
  {
    const d0 = ENT0 + 0.35, d1 = ENT1 - 0.3;
    parts.add(new THREE.PlaneGeometry(d1 - d0 - 0.2, 1.75), glassMat, ...T(SF, (d0 + d1) / 2, 1.5, -REC + 0.04), 0, SF.yaw, 0);
    fbox(mbShop, SF, d0, CH + 0.02, -REC, d0 + 0.1, 2.75, -REC + 0.06); fbox(mbShop, SF, d1 - 0.1, CH + 0.02, -REC, d1, 2.75, -REC + 0.06);
    fbox(mbShop, SF, d0, CH + 0.02, -REC, d1, 0.62, -REC + 0.06); fbox(mbShop, SF, d0, 2.62, -REC, d1, 2.75, -REC + 0.06);
    parts.rod(brass, T(SF, d0 + 0.2, 1.0, -REC + 0.12), T(SF, d0 + 0.2, 1.6, -REC + 0.12), 0.018, 6);
    rooms.add(SF, d0 + 0.1, d1 - 0.1, 0.62, 2.62, -REC - 0.02, 1.0, 1);
    parts.add(new THREE.PlaneGeometry(0.42, 0.16), signMaterial(signTexture({ w: 128, h: 48, bg: '#1a120a', lines: [{ text: 'OPEN', size: 32, y: 0.55, color: '#ffcf86', weight: 800 }] }), { night: 1.2, day: 0.3 }), ...T(SF, (d0 + d1) / 2, 2.2, -REC + 0.08), 0, SF.yaw, 0);
  }
  // recess side glazing (return toward the door) and mosaic step
  parts.add(new THREE.PlaneGeometry(REC - 0.1, GT - 0.8), glassMat, ...T(SF, ENT1 - 0.02, 0.8 + (GT - 0.8) / 2, -REC / 2), 0, SF.yaw - Math.PI / 2, 0);
  const tile = extendMaterial(new THREE.MeshStandardMaterial({ map: tileTexture(256, 256, (c, w, h) => { c.fillStyle = '#d8d0bc'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { if (((x + y) / 16) % 2 === 0) { c.fillStyle = '#22201c'; c.fillRect(x + 1, y + 1, 14, 14); } } c.strokeStyle = '#7a1a14'; c.lineWidth = 10; c.strokeRect(10, 10, w - 20, h - 20); }), roughness: 0.35 }), { key: 'shop-tile', weather: true });
  parts.add(new THREE.PlaneGeometry(ENT1 - ENT0, REC), tile, ...T(SF, (ENT0 + ENT1) / 2, CH + 0.01, -REC / 2), -Math.PI / 2, SF.yaw, 0);
  // shop window glass + clerestory glass
  parts.add(new THREE.PlaneGeometry(WIN1 - WIN0, GT - 0.8), glassMat, ...T(SF, (WIN0 + WIN1) / 2, 0.8 + (GT - 0.8) / 2, -0.12), 0, SF.yaw, 0);
  parts.add(new THREE.PlaneGeometry(WIN1 - ENT0, TR - GT - 0.1), glassMat, ...T(SF, (ENT0 + WIN1) / 2, (GT + 0.1 + TR) / 2, -0.12), 0, SF.yaw, 0);
  // gilt lettering on the window
  parts.add(new THREE.PlaneGeometry(2.6, 0.5), signMaterial(signTexture({ w: 512, h: 100, bg: 'rgba(0,0,0,0)', draw: (c) => c.clearRect(0, 0, 512, 100), lines: [{ text: 'Coffee · Tea · Pastry', size: 44, y: 0.5, color: '#e8c070', weight: 600, font: 'Georgia, serif', italic: true }] }), { night: 0.5, day: 0.25, transparent: true }), ...T(SF, (WIN0 + WIN1) / 2, 1.95, -0.1), 0, SF.yaw, 0);

  // interior: brick back wall with chalk menus, tin ceiling, tiled floor, counter, shelves, pendants
  {
    const IZ = -7.0, ix0 = ENT0 + 0.08, ix1 = WIN1, iy0 = CH, iy1 = TR + 0.6;
    const backMat = signMaterial(shopBackTexture(), { night: 1.15, day: 0.15 });
    const sideMat = signMaterial(signTexture({ w: 256, h: 128, bg: ['#6a3e24', '#3a2414'], draw: (c, w, h) => { const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(255,190,120,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); } }), { night: 0.6, day: 0.08 });
    parts.add(new THREE.PlaneGeometry(ix1 - ix0, iy1 - iy0), backMat, ...T(SF, (ix0 + ix1) / 2, (iy0 + iy1) / 2, IZ), 0, SF.yaw, 0);
    parts.add(new THREE.PlaneGeometry(-IZ - REC, iy1 - iy0), sideMat, ...T(SF, ix0, (iy0 + iy1) / 2, (IZ - REC) / 2), 0, SF.yaw + Math.PI / 2, 0);
    parts.add(new THREE.PlaneGeometry(-IZ, iy1 - iy0), sideMat, ...T(SF, ix1, (iy0 + iy1) / 2, IZ / 2), 0, SF.yaw - Math.PI / 2, 0);
    parts.add(new THREE.PlaneGeometry(ix1 - ix0, -IZ), tile, ...T(SF, (ix0 + ix1) / 2, iy0 + 0.005, IZ / 2), -Math.PI / 2, SF.yaw, 0);
    parts.add(new THREE.PlaneGeometry(ix1 - ix0, -IZ), pbr({ color: 0x3a2a1c, roughness: 0.5, metalness: 0.5 }), ...T(SF, (ix0 + ix1) / 2, iy1, IZ / 2), Math.PI / 2, SF.yaw, 0);
    // counter: panelled front, marble top, espresso machine, pastry case, grinder
    const cz0 = -4.2, cz1 = -3.5, cx0 = 3.2, cx1 = 7.9;
    fbox(mbShop, SF, cx0, iy0, cz0, cx1, 1.0, cz1);
    for (let x = cx0 + 0.15; x < cx1 - 0.4; x += 0.78) fbox(mbShop, SF, x, 0.3, cz1, x + 0.62, 0.86, cz1 + 0.02);
    parts.add(new THREE.BoxGeometry(cx1 - cx0 + 0.1, 0.05, 0.8), marble, ...T(SF, (cx0 + cx1) / 2, 1.025, (cz0 + cz1) / 2), 0, SF.yaw, 0);
    parts.add(new THREE.BoxGeometry(0.85, 0.5, 0.5), steel, ...T(SF, 6.6, 1.3, cz0 + 0.3), 0, SF.yaw, 0);
    parts.add(new THREE.BoxGeometry(0.2, 0.36, 0.2), steel, ...T(SF, 7.4, 1.23, cz0 + 0.3), 0, SF.yaw, 0);
    parts.add(new THREE.BoxGeometry(1.3, 0.42, 0.55), glassMat, ...T(SF, 4.3, 1.26, cz0 + 0.4), 0, SF.yaw, 0);
    parts.add(new THREE.BoxGeometry(1.2, 0.02, 0.5), beacon(0xffcf90, 0.15, 1.6, false), ...T(SF, 4.3, 1.46, cz0 + 0.4), 0, SF.yaw, 0);
    const rnd = prng(19);
    for (let k = 0; k < 9; k++) parts.add(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 10), pbr({ color: [0xb07a3a, 0x8a4a24, 0xd8c08a][k % 3], roughness: 0.7 }), ...T(SF, 3.8 + (k % 5) * 0.24, 1.1 + Math.floor(k / 5) * 0.12, cz0 + 0.3 + (k % 2) * 0.15), 0, 0, 0);
    // back shelves with jars and coffee bags
    for (const y of [1.55, 2.05, 2.55]) {
      parts.add(new THREE.BoxGeometry(6.5, 0.04, 0.32), wood, ...T(SF, 4.8, y, IZ + 0.18), 0, SF.yaw, 0);
      for (let x = 1.8; x < 7.9; x += 0.16 + rnd() * 0.14) { const hh = 0.14 + rnd() * 0.16; parts.add(new THREE.BoxGeometry(0.11, hh, 0.12), pbr({ color: [0x6a3a22, 0x2e4a3a, 0xc8b89a, 0x3a3a3c, 0x8a2a1c][Math.floor(rnd() * 5)], roughness: 0.6 }), ...T(SF, x, y + 0.02 + hh / 2, IZ + 0.18), 0, SF.yaw, 0); }
    }
    fbox(mbShop, SF, 1.0, iy0, IZ, 7.9, 0.95, IZ + 0.65);
    // pendant lamps
    const bulb = beacon(0xffd6a0, 0.4, 5, false);
    for (const x of [1.6, 3.4, 5.2, 7.0]) {
      parts.rod(iron, T(SF, x, iy1, -2.6), T(SF, x, 2.55, -2.6), 0.008, 3);
      parts.add(new THREE.ConeGeometry(0.2, 0.22, 14, 1, true), brass, ...T(SF, x, 2.48, -2.6), 0, 0, 0);
      parts.add(new THREE.SphereGeometry(0.06, 10, 8), bulb, ...T(SF, x, 2.39, -2.6), 0, 0, 0);
    }
    // two window tables with stools
    for (const x of [4.0, 6.6]) {
      parts.cyl(marble, ...([T(SF, x, 0, -0.75)[0], 1.05, T(SF, x, 0, -0.75)[2]] as [number, number, number]), 0.3, 0.3, 0.03, 18);
      parts.cyl(iron, T(SF, x, 0, -0.75)[0], iy0, T(SF, x, 0, -0.75)[2], 0.03, 0.03, 0.9, 6);
      parts.cyl(iron, T(SF, x, 0, -0.75)[0], iy0, T(SF, x, 0, -0.75)[2], 0.2, 0.2, 0.02, 12);
    }
  }
  // fascia sign with gooseneck lamps
  const fascia = signMaterial(signTexture({ w: 1024, h: 96, bg: '#14291f', draw: (c, w, h) => { c.strokeStyle = '#b8924a'; c.lineWidth = 4; c.strokeRect(10, 10, w - 20, h - 20); }, lines: [{ text: 'KAMAR-TAJ  COFFEE & TEA', size: 54, y: 0.56, color: '#e2bd72', weight: 700, font: 'Georgia, "Times New Roman", serif', spacing: 6 }] }), { night: 0.55, day: 0.22 });
  parts.add(new THREE.PlaneGeometry(SW - 0.6, 0.66), fascia, ...T(SF, SW / 2, (TR + GF) / 2 - 0.03, 0.105), 0, SF.yaw, 0);
  const goose = beacon(0xffd8a0, 0.0, 3.5, false);
  for (const x of [1.4, SW / 2, SW - 1.4]) {
    parts.rod(iron, T(SF, x, GF + 0.05, 0.12), T(SF, x, GF + 0.3, 0.45), 0.015, 4);
    parts.rod(iron, T(SF, x, GF + 0.3, 0.45), T(SF, x, GF + 0.18, 0.62), 0.015, 4);
    parts.add(new THREE.ConeGeometry(0.11, 0.12, 12, 1, true), iron, ...T(SF, x, GF + 0.14, 0.64), 0, 0, 0);
    parts.add(new THREE.CircleGeometry(0.08, 10), goose, ...T(SF, x, GF + 0.085, 0.64), Math.PI / 2, 0, 0);
  }
  // fabric awning: sloped canvas with a little sag, scalloped lettered valance, side cheeks, iron arms and roller box
  {
    const ax0 = 0.25, ax1 = SW - 0.25, yW = TR - 0.02, yF = 2.62, zW = 0.22, zF = 1.85;
    const canvasTex = tileTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#1d3a2c'; c.fillRect(0, 0, w, h);
      const r = prng(9);
      for (let i = 0; i < 4000; i++) { c.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)'; c.fillRect(r() * w, r() * h, 2, 1); }
      for (let x = 0; x < w; x += 4) { c.fillStyle = 'rgba(0,0,0,0.04)'; c.fillRect(x, 0, 1, h); }
    });
    const canvasMat = extendMaterial(new THREE.MeshStandardMaterial({ map: canvasTex, roughness: 0.92, side: THREE.DoubleSide }), { key: 'awning-canvas', weather: true });
    const g = new THREE.PlaneGeometry(1, 1, 24, 6);
    const pa = g.attributes.position as THREE.BufferAttribute, ua = g.attributes.uv as THREE.BufferAttribute;
    const nArms = 4;
    for (let i = 0; i < pa.count; i++) {
      const u = pa.getX(i) + 0.5, v = pa.getY(i) + 0.5;     // u along the front, v from wall (0) to front (1)
      const x = ax0 + (ax1 - ax0) * u;
      const ph = (u * (nArms - 1)) % 1, sag = Math.sin(Math.PI * ph) * 0.06 * Math.sin(Math.PI * v) + 0.05 * Math.sin(Math.PI * v);
      const y = yW + (yF - yW) * v - sag, z = zW + (zF - zW) * v;
      const w = T(SF, x, y, z);
      pa.setXYZ(i, w[0], w[1], w[2]);
      ua.setXY(i, (x * 1.0), Math.hypot(zF - zW, yW - yF) * v);
    }
    g.computeVertexNormals();
    parts.add(g, canvasMat);
    const valTex = signTexture({
      w: 1024, h: 64, bg: 'rgba(0,0,0,0)',
      draw: (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.fillStyle = '#1d3a2c'; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, 0); c.lineTo(w, h * 0.72);
        const n = 26; for (let k = n; k >= 0; k--) { const x = (k / n) * w; c.lineTo(x, h * 0.72); if (k > 0) c.quadraticCurveTo(x - w / n / 2, h * 1.02, x - w / n, h * 0.72); }
        c.closePath(); c.fill();
        c.fillStyle = '#d9c08a'; c.fillRect(0, 4, w, 2); c.fillRect(0, h * 0.62, w, 2);
      },
      lines: [{ text: 'KAMAR-TAJ  ·  COFFEE  ·  TEA  ·  BAKERY', size: 24, y: 0.36, color: '#e6cf98', weight: 600, font: 'Georgia, serif', spacing: 5 }],
    });
    const valMat = extendMaterial(new THREE.MeshStandardMaterial({ map: valTex, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.5 }), { key: 'awning-val', weather: true });
    parts.add(new THREE.PlaneGeometry(ax1 - ax0, 0.34), valMat, ...T(SF, (ax0 + ax1) / 2, yF - 0.16, zF + 0.005), 0, SF.yaw, 0);
    for (const x of [ax0, ax1]) {
      const sg = new THREE.BufferGeometry();
      const pts = [T(SF, x, yW, zW), T(SF, x, yF, zF), T(SF, x, yF - 0.3, zF), T(SF, x, yW - 0.45, zW)];
      sg.setAttribute('position', new THREE.Float32BufferAttribute([...pts[0], ...pts[1], ...pts[2], ...pts[0], ...pts[2], ...pts[3]], 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0.8, 0, 1, 1, 0.8, 0, 0.6], 2));
      sg.computeVertexNormals();
      parts.add(sg, canvasMat);
    }
    parts.rod(iron, T(SF, ax0, yF - 0.02, zF), T(SF, ax1, yF - 0.02, zF), 0.03, 8);
    for (let k = 0; k < nArms; k++) {
      const x = ax0 + ((ax1 - ax0) * k) / (nArms - 1);
      parts.rod(iron, T(SF, x, yW - 0.55, 0.1), T(SF, x, yF - 0.05, zF - 0.05), 0.022, 6);
      parts.box(iron, ...T(SF, x, yW - 0.55, 0.06), 0.1, 0.14, 0.08, 0, SF.yaw, 0);
    }
    parts.add(new THREE.CylinderGeometry(0.11, 0.11, ax1 - ax0 + 0.1, 12), green, ...T(SF, (ax0 + ax1) / 2, yW + 0.06, 0.18), 0, SF.yaw, Math.PI / 2);
  }
  // projecting blade sign on a scrolled iron bracket
  {
    const bx = -0.05, by = 4.55, bz0 = 0.15, bz1 = 1.25;
    parts.rod(iron, T(SF, bx, by + 0.6, bz0), T(SF, bx, by + 0.6, bz1), 0.025, 6);
    parts.rod(iron, T(SF, bx, by - 0.2, bz0), T(SF, bx, by + 0.6, bz1 - 0.25), 0.02, 6);
    parts.add(new THREE.TorusGeometry(0.16, 0.014, 4, 16), iron, ...T(SF, bx, by + 0.36, bz0 + 0.32), 0, SF.yaw + Math.PI / 2, 0);
    const bladeTex = signTexture({
      w: 256, h: 320, bg: '#14291f',
      draw: (c, w, h) => {
        c.strokeStyle = '#c9a050'; c.lineWidth = 8; c.strokeRect(12, 12, w - 24, h - 24);
        c.strokeStyle = '#e2bd72'; c.lineWidth = 7; c.beginPath(); c.moveTo(78, 120); c.lineTo(88, 200); c.quadraticCurveTo(128, 222, 168, 200); c.lineTo(178, 120); c.closePath(); c.stroke();
        c.beginPath(); c.arc(184, 158, 18, -Math.PI / 2, Math.PI / 2); c.stroke();
        for (const x of [108, 128, 148]) { c.beginPath(); c.moveTo(x, 104); c.quadraticCurveTo(x + 10, 88, x, 72); c.stroke(); }
      },
      lines: [{ text: 'KAMAR-TAJ', size: 34, y: 0.82, color: '#e2bd72', weight: 700, font: 'Georgia, serif', spacing: 3 }],
    });
    const bm = signMaterial(bladeTex, { night: 0.7, day: 0.25 });
    const by0 = by - 0.15, bh = 0.9, bw = 0.72, bzm = (bz0 + bz1) / 2 + 0.08;
    for (const s of [1, -1]) parts.add(new THREE.PlaneGeometry(bw, bh), bm, ...T(SF, bx + s * 0.022, by0 + bh / 2 - 0.15, bzm), 0, SF.yaw + s * Math.PI / 2, 0);
    parts.box(green, ...T(SF, bx, by0 + bh / 2 - 0.15, bzm), 0.04, bh + 0.06, bw + 0.06, 0, SF.yaw, 0);
    for (const dz of [-0.25, 0.25]) parts.rod(iron, T(SF, bx, by + 0.6, bzm + dz), T(SF, bx, by0 + bh - 0.12, bzm + dz), 0.008, 3);
  }
  // pavement café: bistro tables with bentwood chairs, planters, A-frame menu
  const furniture = (cx: number, cz: number, rot: number) => {
    const p = T(SF, cx, 0, cz);
    parts.cyl(marble, p[0], CH + 0.72, p[2], 0.33, 0.33, 0.03, 20);
    parts.cyl(iron, p[0], CH + 0.05, p[2], 0.028, 0.028, 0.67, 8);
    parts.cyl(iron, p[0], CH, p[2], 0.22, 0.18, 0.05, 14);
    for (const s of [-1, 1]) {
      const a = rot + (s > 0 ? 0 : Math.PI), cxp = p[0] + Math.sin(a) * 0.6, czp = p[2] + Math.cos(a) * 0.6;
      parts.cyl(wood, cxp, CH + 0.44, czp, 0.2, 0.2, 0.04, 14);
      for (let k = 0; k < 4; k++) { const b = (k / 4) * Math.PI * 2 + Math.PI / 4; parts.rod(wood, [cxp + Math.cos(b) * 0.16, CH, czp + Math.sin(b) * 0.16], [cxp + Math.cos(b) * 0.13, CH + 0.44, czp + Math.sin(b) * 0.13], 0.014, 4); }
      const bx = cxp + Math.sin(a) * 0.18, bz = czp + Math.cos(a) * 0.18;
      parts.add(new THREE.TorusGeometry(0.17, 0.014, 4, 14, Math.PI), wood, bx, CH + 0.72, bz, 0, a + Math.PI / 2, 0);
      parts.rod(wood, [bx - Math.cos(a) * 0.17, CH + 0.44, bz + Math.sin(a) * 0.17], [bx - Math.cos(a) * 0.17, CH + 0.72, bz + Math.sin(a) * 0.17], 0.014, 4);
      parts.rod(wood, [bx + Math.cos(a) * 0.17, CH + 0.44, bz - Math.sin(a) * 0.17], [bx + Math.cos(a) * 0.17, CH + 0.72, bz - Math.sin(a) * 0.17], 0.014, 4);
    }
    parts.cyl(pbr({ color: 0xf2efe8, roughness: 0.35 }), p[0] + 0.1, CH + 0.75, p[2] - 0.05, 0.04, 0.032, 0.09, 10);
  };
  furniture(4.0, 1.25, SF.yaw + Math.PI / 2); furniture(6.6, 1.25, SF.yaw + Math.PI / 2);
  for (const x of [3.0, 8.15]) {
    const p = T(SF, x, 0, 0.42);
    parts.box(pbr({ color: 0x3a2a1e, roughness: 0.8 }), p[0], CH + 0.25, p[2], 0.8, 0.5, 0.4, 0, SF.yaw, 0);
    const r = prng(Math.round(x * 10));
    for (let k = 0; k < 7; k++) {
      const gg = new THREE.IcosahedronGeometry(0.2, 1);
      parts.add(gg, leaves[k % 3], p[0] + (r() - 0.5) * 0.6, CH + 0.58 + r() * 0.12, p[2] + (r() - 0.5) * 0.2, r() * 3, r() * 3, 0, 1, 0.8, 1);
    }
  }
  const board = signMaterial(signTexture({ w: 256, h: 384, bg: '#1b1d1b', draw: (c, w, h) => { c.strokeStyle = '#5a3a22'; c.lineWidth = 16; c.strokeRect(0, 0, w, h); }, lines: [{ text: 'TODAY', size: 44, y: 0.16, color: '#f2e9d0', weight: 700, font: 'Georgia' }, { text: 'time stone', size: 34, y: 0.4, color: '#9fd8a0', weight: 400, font: 'Georgia', italic: true }, { text: 'cold brew', size: 34, y: 0.52, color: '#9fd8a0', weight: 400, font: 'Georgia', italic: true }, { text: 'no refunds,', size: 25, y: 0.75, color: '#d8d0b8', weight: 400, font: 'Georgia' }, { text: 'no time loops', size: 25, y: 0.85, color: '#d8d0b8', weight: 400, font: 'Georgia' }] }), { night: 0.35, day: 0.08 });
  {
    const p = T(SF, -0.6, 0, 2.2), a = SF.yaw + 0.6;
    for (const s of [-1, 1]) parts.add(new THREE.PlaneGeometry(0.6, 0.95), board, p[0] + Math.sin(a) * s * 0.17, CH + 0.47, p[2] + Math.cos(a) * s * 0.17, -s * 0.18, a + (s < 0 ? Math.PI : 0), 0);
  }

  // ================= street furniture on both kerbs =================
  const lamps: THREE.PointLight[] = [];
  const lampGlow = beacon(0xffc27a, 0.05, 5, false);
  const lampPost = (x: number, z: number, dir: number) => {
    parts.cyl(iron, x, CH, z, 0.26, 0.2, 0.9, 12);
    parts.cyl(iron, x, CH + 0.9, z, 0.11, 0.075, 5.7, 10);
    const arc = new THREE.TorusGeometry(0.75, 0.045, 6, 16, Math.PI * 1.15);
    parts.add(arc, iron, x, CH + 6.45, z + dir * 0.75, 0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    const head = parts.add(new THREE.SphereGeometry(0.2, 12, 10), lampGlow, x, CH + 6.1, z + dir * 1.45, 0, 0, 0, 1, 1.35, 1); void head;
    parts.add(new THREE.ConeGeometry(0.3, 0.26, 12), iron, x, CH + 6.47, z + dir * 1.45);
    const pl = new THREE.PointLight(0xffb870, 0, 30, 1.6); pl.position.set(x, CH + 5.95, z + dir * 1.45); glows.add(pl); lamps.push(pl);
  };
  lampPost(-9.5, SIDEWALK - 0.5, 1); lampPost(24.5, STREET - SIDEWALK + 0.5, -1);
  const shopLight = new THREE.PointLight(0xffa860, 0, 14, 1.8); shopLight.position.copy(new THREE.Vector3(...T(SF, 5.0, 2.7, -1.2))); glows.add(shopLight); lamps.push(shopLight);
  // hydrant, newspaper box, mailbox
  const red = pbr({ color: 0xa82218, roughness: 0.5 });
  parts.cyl(red, 3.4, CH, STREET - SIDEWALK + 0.45, 0.16, 0.13, 0.62, 10);
  parts.add(new THREE.SphereGeometry(0.14, 10, 8), red, 3.4, CH + 0.66, STREET - SIDEWALK + 0.45);
  parts.add(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), red, 3.4, CH + 0.42, STREET - SIDEWALK + 0.45, 0, 0, Math.PI / 2);
  const bugleBox = signMaterial(signTexture({ w: 128, h: 256, bg: '#a01c16', lines: [{ text: 'DAILY', size: 30, y: 0.12, weight: 900 }, { text: 'BUGLE', size: 30, y: 0.25, weight: 900 }], draw: (c, w, h) => { c.fillStyle = '#e8e2d0'; c.fillRect(14, h * 0.36, w - 28, h * 0.34); c.fillStyle = '#222'; c.font = '700 13px Arial'; c.fillText('SPIDER-MENACE', 18, h * 0.44); c.fillText('STRIKES AGAIN?', 18, h * 0.5); } }), { night: 0.25, day: 0.05 });
  parts.box(pbr({ color: 0xa01c16, roughness: 0.5, metalness: 0.3 }), 1.2, CH + 0.575, STREET - SIDEWALK + 0.6, 0.5, 1.15, 0.45);
  parts.add(new THREE.PlaneGeometry(0.48, 1.1), bugleBox, 1.2, CH + 0.585, STREET - SIDEWALK + 0.6 - 0.231, 0, Math.PI, 0);
  const blue = pbr({ color: 0x1f3f7a, roughness: 0.45, metalness: 0.4 });
  parts.box(blue, -6.2, CH + 0.62, SIDEWALK - 0.7, 0.6, 0.9, 0.55);
  parts.add(new THREE.CylinderGeometry(0.3, 0.3, 0.55, 14, 1, false, 0, Math.PI), blue, -6.2, CH + 1.07, SIDEWALK - 0.7, Math.PI / 2, 0, Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.box(blue, -6.2 + sx * 0.25, CH + 0.09, SIDEWALK - 0.7 + sz * 0.22, 0.05, 0.18, 0.05);
  // street trees in iron-guarded pits
  const soil = pbr({ color: 0x1c1712, roughness: 1 });
  for (const [x, z, sd] of [[-17.5, SIDEWALK - 0.75, 3], [27.5, SIDEWALK - 0.75, 8], [-26, STREET - SIDEWALK + 0.75, 13]] as const) {
    parts.box(soil, x, CH + 0.005, z, 1.4, 0.01, 1.4);
    for (const [ax, az, bx, bz] of [[-0.7, -0.7, 0.7, -0.7], [0.7, -0.7, 0.7, 0.7], [0.7, 0.7, -0.7, 0.7], [-0.7, 0.7, -0.7, -0.7]]) {
      parts.rod(iron, [x + ax, CH + 0.45, z + az], [x + bx, CH + 0.45, z + bz], 0.015, 4);
      for (let t = 0; t <= 1.001; t += 0.125) parts.rod(iron, [x + ax + (bx - ax) * t, CH, z + az + (bz - az) * t], [x + ax + (bx - ax) * t, CH + 0.45, z + az + (bz - az) * t], 0.008, 3);
    }
    streetTree(parts, bark, leaves, x, CH, z, sd, 1.05);
  }

  // ================= assemble =================
  const body = facadeMesh(mb.build());
  const extras = new THREE.Group();
  extras.add(builderMesh(mbPaint, paint), builderMesh(mbSlate, slateMat), builderMesh(mbCopper, copper), builderMesh(mbShop, green), builderMesh(mbDoor, doorWood));
  if (!mbIron.empty) extras.add(builderMesh(mbIron, iron));
  const roomMesh = new THREE.Mesh(rooms.build(), roomMat); roomMesh.receiveShadow = true;
  extras.add(roomMesh);
  parts.build(extras);
  group.add(body, extras, glows);
  group.updateMatrixWorld(true);
  const c1 = toWorld(0, 0, -D / 2), c2 = toWorld((SX0 + SX1) / 2, 0, STREET + SD / 2);
  return {
    group, mandala, lights: lamps, toWorld,
    clear: [{ x: c1.x, z: c1.z, r: 12.5 }, { x: c2.x, z: c2.z, r: 9.5 }],
  };
}
