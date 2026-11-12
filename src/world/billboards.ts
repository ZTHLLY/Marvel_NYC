import * as THREE from 'three';
import { BuildingRec, CityData, ll, streetOf, aveOf } from '../city/geo';
import type { GroundBuild } from '../city/ground';
import { panel, signMaterial, signTexture, SignSpec, yawFacing } from '../landmarks/kit';
import { hash2, mulberry32 } from '../util/rng';

const F_COND = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const F_SERIF = 'Georgia, "Times New Roman", serif';

/** Fictional in-universe advertising. Original layouts; names only, no reproduced logos. */
const MARVEL_ADS: SignSpec[] = [
  { w: 1024, h: 512, bg: ['#04121f', '#0a2a44'], draw: (c, w, h) => { c.strokeStyle = '#49d0ff'; c.lineWidth = 10; c.beginPath(); c.arc(w * 0.17, h * 0.5, 96, 0, 7); c.stroke(); c.lineWidth = 4; for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; c.beginPath(); c.moveTo(w * 0.17 + Math.cos(a) * 50, h * 0.5 + Math.sin(a) * 50); c.lineTo(w * 0.17 + Math.cos(a) * 92, h * 0.5 + Math.sin(a) * 92); c.stroke(); } c.fillStyle = '#bff2ff'; c.beginPath(); c.arc(w * 0.17, h * 0.5, 38, 0, 7); c.fill(); },
    lines: [{ text: 'STARK', size: 150, y: 0.38, x: 0.62, weight: 900, spacing: 14 }, { text: 'I N D U S T R I E S', size: 46, y: 0.62, x: 0.62, weight: 400, color: '#8fdcff' }, { text: 'CLEAN ENERGY FOR A BRIGHTER TOMORROW', size: 27, y: 0.82, x: 0.62, weight: 400, color: '#d8f4ff' }] },
  { w: 768, h: 1024, bg: ['#10244e', '#7a1420'], draw: (c, w, h) => { c.fillStyle = '#f2ead6'; c.save(); c.translate(w / 2, h * 0.27); for (let i = 0; i < 5; i++) { c.rotate((Math.PI * 2) / 5); c.beginPath(); c.moveTo(0, -130); c.lineTo(34, -40); c.lineTo(-34, -40); c.fill(); } c.beginPath(); c.arc(0, 0, 52, 0, 7); c.fill(); c.restore(); c.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 7; i++) c.fillRect(0, h * 0.5 + i * 70, w, 34); },
    lines: [{ text: 'ROGERS', size: 150, y: 0.56, weight: 900, color: '#fff6e0', font: F_SERIF }, { text: 'THE MUSICAL', size: 78, y: 0.68, weight: 700, color: '#ffd76a', font: F_SERIF }, { text: '“A STAR-SPANGLED TRIUMPH”', size: 34, y: 0.8, weight: 400, color: '#ffffff', italic: true, font: F_SERIF }, { text: 'NOW ON BROADWAY', size: 40, y: 0.91, weight: 800, color: '#ffffff' }] },
  { w: 1024, h: 512, bg: ['#06140c', '#0e3a22'], draw: (c, w, h) => { c.strokeStyle = 'rgba(120,255,170,0.25)'; c.lineWidth = 3; for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) { const cx = x * 70 + (y % 2) * 35, cy = y * 60; c.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283 + 0.52; c.lineTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34); } c.closePath(); c.stroke(); } void h; },
    lines: [{ text: 'OSCORP', size: 190, y: 0.44, weight: 900, color: '#d8ffe6', spacing: 10 }, { text: 'THE FUTURE, ENGINEERED.', size: 44, y: 0.76, weight: 400, color: '#7dffb0' }] },
  { w: 1024, h: 640, bg: '#efe9da', draw: (c, w, h) => { c.fillStyle = '#111'; c.fillRect(0, h * 0.2, w, 8); c.fillRect(0, h * 0.24, w, 3); c.fillStyle = '#b3160f'; c.fillRect(0, h * 0.82, w, h * 0.18); },
    lines: [{ text: 'DAILY BUGLE', size: 108, y: 0.105, weight: 900, color: '#111', font: F_SERIF }, { text: 'SPIDER-MAN:', size: 120, y: 0.4, weight: 900, color: '#111', font: F_COND }, { text: 'THREAT OR MENACE?', size: 100, y: 0.62, weight: 900, color: '#111', font: F_COND }, { text: 'NEW YORK DECIDES — ONLY IN THE BUGLE', size: 36, y: 0.91, weight: 800, color: '#fff' }] },
  { w: 1024, h: 512, bg: ['#e8eef2', '#b9c8d2'], draw: (c, w, h) => { c.fillStyle = '#c21f2a'; c.beginPath(); c.arc(w * 0.86, h * 0.52, 18, 0, 7); c.fill(); c.strokeStyle = '#1c2a36'; c.lineWidth = 3; c.beginPath(); c.arc(w * 0.86, h * 0.52, 120, 0, 7); c.stroke(); },
    lines: [{ text: 'PYM', size: 170, y: 0.4, x: 0.36, weight: 900, color: '#1c2a36' }, { text: 'TECHNOLOGIES', size: 52, y: 0.62, x: 0.36, weight: 400, color: '#1c2a36', spacing: 8 }, { text: 'think small.', size: 44, y: 0.83, x: 0.36, weight: 400, color: '#c21f2a', italic: true, font: F_SERIF }] },
  { w: 1024, h: 512, bg: ['#1a0d02', '#6a2d06'], draw: (c, w, h) => { c.fillStyle = '#ff9a1a'; c.beginPath(); c.moveTo(w * 0.1, h * 0.72); c.lineTo(w * 0.2, h * 0.22); c.lineTo(w * 0.3, h * 0.72); c.closePath(); c.fill(); },
    lines: [{ text: 'ROXXON', size: 170, y: 0.42, x: 0.64, weight: 900, color: '#ffe2b8' }, { text: 'ENERGY  •  POWERING PROGRESS', size: 38, y: 0.72, x: 0.64, weight: 600, color: '#ffb45a' }] },
  { w: 768, h: 1024, bg: ['#1e4f6e', '#e9a964'], draw: (c, w, h) => { c.fillStyle = '#16303f'; c.beginPath(); c.moveTo(0, h * 0.7); c.lineTo(w * 0.25, h * 0.52); c.lineTo(w * 0.45, h * 0.64); c.lineTo(w * 0.7, h * 0.46); c.lineTo(w, h * 0.66); c.lineTo(w, h); c.lineTo(0, h); c.fill(); c.fillStyle = 'rgba(255,240,200,0.9)'; c.beginPath(); c.arc(w * 0.7, h * 0.3, 70, 0, 7); c.fill(); },
    lines: [{ text: 'VISIT', size: 60, y: 0.1, weight: 400, color: '#fff3d8', spacing: 16 }, { text: 'NEW ASGARD', size: 104, y: 0.19, weight: 900, color: '#fff3d8', font: F_SERIF }, { text: 'TØNSBERG, NORWAY', size: 38, y: 0.86, weight: 700, color: '#ffe0a8' }, { text: 'WORTHY OF A HOLIDAY', size: 30, y: 0.92, weight: 400, color: '#fff', italic: true, font: F_SERIF }] },
  { w: 1024, h: 512, bg: '#f2c40f', draw: (c, w, h) => { c.fillStyle = '#141414'; for (let i = -2; i < 24; i++) { c.beginPath(); c.moveTo(i * 60, 0); c.lineTo(i * 60 + 30, 0); c.lineTo(i * 60 - 10, 56); c.lineTo(i * 60 - 40, 56); c.fill(); c.beginPath(); c.moveTo(i * 60, h - 56); c.lineTo(i * 60 + 30, h - 56); c.lineTo(i * 60 - 10, h); c.lineTo(i * 60 - 40, h); c.fill(); } },
    lines: [{ text: 'DAMAGE CONTROL', size: 112, y: 0.4, weight: 900, color: '#141414', font: F_COND }, { text: 'U.S. DEPARTMENT OF', size: 34, y: 0.22, weight: 700, color: '#141414' }, { text: 'SITE SECURED  •  RECLAMATION IN PROGRESS', size: 36, y: 0.63, weight: 800, color: '#141414' }, { text: 'report alien salvage: 1-800-555-0142', size: 26, y: 0.76, weight: 400, color: '#141414' }] },
  { w: 1024, h: 512, bg: ['#0a0a12', '#1c1c3a'], draw: (c, w, h) => { const g = c.createRadialGradient(w * 0.5, h * 1.1, 10, w * 0.5, h * 1.1, 500); g.addColorStop(0, 'rgba(120,200,255,0.8)'); g.addColorStop(1, 'rgba(120,200,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); },
    lines: [{ text: 'THANK YOU,', size: 90, y: 0.3, weight: 300, color: '#e8f4ff' }, { text: 'AVENGERS', size: 170, y: 0.58, weight: 900, color: '#ffffff', spacing: 10 }, { text: 'NEW YORK REMEMBERS', size: 36, y: 0.84, weight: 600, color: '#9fd0ff', spacing: 8 }] },
  { w: 1024, h: 512, bg: ['#0c0c0c', '#2a2a2a'], draw: (c, w, h) => { c.strokeStyle = '#d8b46a'; c.lineWidth = 4; c.strokeRect(24, 24, w - 48, h - 48); },
    lines: [{ text: 'NELSON, MURDOCK & PAGE', size: 76, y: 0.38, weight: 700, color: '#e8d6aa', font: F_SERIF }, { text: 'ATTORNEYS AT LAW', size: 44, y: 0.58, weight: 400, color: '#e8d6aa', spacing: 10, font: F_SERIF }, { text: 'HELL’S KITCHEN  •  JUSTICE IS BLIND', size: 30, y: 0.78, weight: 400, color: '#bdb08a' }] },
];

const BRANDS = ['LUMA', 'NOVA COLA', 'ZENITH', 'AURORA AIR', 'KITE', 'ORBIT', 'HALCYON', 'VERO', 'TESSERA', 'MERIDIAN', 'ECHO', 'SOLSTICE'];
const TAGS = ['NOW STREAMING', 'FEEL IT', 'SUMMER 26', 'NEW YORK', 'EVERY DAY', 'THE NEW CLASSIC', 'LIVE ON BROADWAY', 'OPEN LATE', 'TASTE THE CITY', 'ALL NIGHT'];
function genericAd(seed: number): SignSpec {
  const r = mulberry32(seed * 977 + 3);
  const hue = Math.floor(r() * 360), hue2 = (hue + 30 + Math.floor(r() * 150)) % 360;
  const tall = r() < 0.4;
  const brand = BRANDS[Math.floor(r() * BRANDS.length)], tag = TAGS[Math.floor(r() * TAGS.length)];
  const light = r() < 0.3;
  return {
    w: tall ? 512 : 1024, h: tall ? 1024 : 512,
    bg: light ? [`hsl(${hue},70%,88%)`, `hsl(${hue2},80%,70%)`] : [`hsl(${hue},85%,${18 + r() * 22}%)`, `hsl(${hue2},90%,${30 + r() * 25}%)`],
    draw: (c, w, h) => {
      for (let i = 0; i < 5; i++) { c.fillStyle = `hsla(${(hue + i * 47) % 360},90%,${50 + r() * 30}%,${0.18 + r() * 0.3})`; c.beginPath(); c.arc(r() * w, r() * h, 60 + r() * 260, 0, 7); c.fill(); }
      if (r() < 0.5) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, h * 0.78, w, h * 0.22); }
    },
    lines: [
      { text: brand, size: tall ? 96 : 150, y: 0.42, weight: 900, color: light ? '#161616' : '#ffffff', spacing: 6, font: r() < 0.3 ? F_SERIF : F_COND },
      { text: tag, size: tall ? 36 : 44, y: tall ? 0.86 : 0.88, weight: 600, color: light ? '#161616' : '#ffffff', spacing: 6 },
    ],
  };
}

interface Slot { mesh: THREE.Mesh; rank: number; marvel: number; generic: number }

/** Billboards for Times Square plus a restrained set of Marvel easter eggs elsewhere in the city. */
export class Billboards {
  readonly group = new THREE.Group();
  /** buildings that carry signage keep their real height regardless of generation sliders */
  readonly locked: BuildingRec[] = [];
  private slots: Slot[] = [];
  private marvelMats: THREE.Material[];
  private genericMats: THREE.Material[];
  private eggs: { mesh: THREE.Object3D; rank: number }[] = [];

  constructor(data: CityData, ground: GroundBuild) {
    this.group.name = 'billboards';
    this.marvelMats = MARVEL_ADS.map((s) => signMaterial(signTexture(s), { night: 2.6, day: 0.95 }));
    this.genericMats = Array.from({ length: 14 }, (_, i) => signMaterial(signTexture(genericAd(i + 1)), { night: 2.6, day: 0.95 }));
    const tall = (i: number, marvel: boolean) => { const s = marvel ? MARVEL_ADS[i] : null; return s ? s.h > s.w : ((this.genericMats[i].userData.tall as boolean) ?? false); };
    this.genericMats.forEach((m, i) => { const sp = genericAd(i + 1); m.userData.tall = sp.h > sp.w; });
    const grid = ground.grid;
    const r = mulberry32(4711);

    // ---- Times Square: every wall that looks onto the bow-tie gets screens
    const facing: { b: BuildingRec; i: number; L: number }[] = [];
    for (const b of data.buildings) {
      if (b.tier !== 0) continue;
      const st = streetOf(b.cx, b.cz), av = aveOf(b.cx, b.cz);
      if (st < 41.6 || st > 48.6 || av < -720 || av > -330) continue;
      const n = b.pts.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = b.pts[j * 2] - b.pts[i * 2], dz = b.pts[j * 2 + 1] - b.pts[i * 2 + 1], L = Math.hypot(dx, dz);
        if (L < 9) continue;
        const mx = (b.pts[i * 2] + b.pts[j * 2]) / 2, mz = (b.pts[i * 2 + 1] + b.pts[j * 2 + 1]) / 2;
        const nx = dz / L, nz = -dx / L;
        // must open onto a wide roadway (Broadway / Seventh), not a side street
        let open = 0;
        for (const d of [8, 14, 20, 26]) if (grid.isRoad(mx + nx * d, mz + nz * d)) open++;
        if (open < 3) continue;
        facing.push({ b, i, L });
      }
    }
    for (const f of facing) {
      const { b, i, L } = f;
      const j = (i + 1) % (b.pts.length / 2);
      const ax = b.pts[i * 2], az = b.pts[i * 2 + 1];
      const dx = b.pts[j * 2] - ax, dz = b.pts[j * 2 + 1] - az;
      const tx = dx / L, tz = dz / L, nx = tz, nz = -tx;
      const yaw = yawFacing(nx, nz);
      if (!this.locked.includes(b)) this.locked.push(b);
      const maxY = Math.min(b.h * 0.9, 58);
      let y = 6.5 + r() * 2;
      let col = 0;
      while (y < maxY - 5 && col < 4) {
        const h = Math.min(maxY - y, 6 + r() * 10);
        const cols = L > 34 && r() < 0.6 ? 2 : 1;
        for (let k = 0; k < cols; k++) {
          const w = Math.min((L / cols) * 0.92, h * (1.5 + r() * 1.2));
          const marvel = Math.floor(r() * MARVEL_ADS.length), generic = Math.floor(r() * this.genericMats.length);
          // respect each artwork's orientation
          const wantTall = h > w * 1.15;
          const gi = this.genericMats.findIndex((_, q) => tall((generic + q) % this.genericMats.length, false) === wantTall);
          const g2 = gi < 0 ? generic : (generic + gi) % this.genericMats.length;
          const mesh = panel(w, h, this.genericMats[g2]);
          const s = (L * (k + 0.5)) / cols;
          mesh.position.set(ax + tx * s + nx * 0.7, y + h / 2, az + tz * s + nz * 0.7);
          mesh.rotation.y = yaw;
          this.group.add(mesh);
          let mi = marvel;
          for (let q = 0; q < MARVEL_ADS.length; q++) { const c = (marvel + q) % MARVEL_ADS.length; if (tall(c, true) === wantTall) { mi = c; break; } }
          this.slots.push({ mesh, rank: r(), marvel: mi, generic: g2 });
        }
        y += h + 0.8 + r() * 1.5;
        col++;
      }
    }

    // ---- easter eggs pinned to real buildings elsewhere
    const attach = (lat: number, lon: number, ad: number, w: number, h: number, y: number, rank: number, minH = 0) => {
      const [px, pz] = ll(lat, lon);
      let best: { b: BuildingRec; i: number; d: number } | null = null;
      for (const b of data.buildings) {
        if (Math.abs(b.cx - px) > 140 || Math.abs(b.cz - pz) > 140 || b.h < Math.max(minH, y + h * 0.6)) continue;
        const n = b.pts.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const dx = b.pts[j * 2] - b.pts[i * 2], dz = b.pts[j * 2 + 1] - b.pts[i * 2 + 1], L = Math.hypot(dx, dz);
          if (L < w * 0.9) continue;
          const mx = (b.pts[i * 2] + b.pts[j * 2]) / 2, mz = (b.pts[i * 2 + 1] + b.pts[j * 2 + 1]) / 2;
          if (!grid.isRoad(mx + (dz / L) * 9, mz - (dx / L) * 9)) continue;
          const d = Math.hypot(mx - px, mz - pz);
          if (!best || d < best.d) best = { b, i, d };
        }
      }
      if (!best) return;
      const { b, i } = best;
      const j = (i + 1) % (b.pts.length / 2);
      const dx = b.pts[j * 2] - b.pts[i * 2], dz = b.pts[j * 2 + 1] - b.pts[i * 2 + 1], L = Math.hypot(dx, dz);
      const mesh = panel(w, h, this.marvelMats[ad]);
      mesh.position.set((b.pts[i * 2] + b.pts[j * 2]) / 2 + (dz / L) * 0.6, y + h / 2, (b.pts[i * 2 + 1] + b.pts[j * 2 + 1]) / 2 - (dx / L) * 0.6);
      mesh.rotation.y = yawFacing(dz / L, -dx / L);
      mesh.visible = false;
      this.group.add(mesh);
      this.eggs.push({ mesh, rank });
      if (!this.locked.includes(b)) this.locked.push(b);
    };
    attach(40.7572, -73.9712, 0, 26, 13, 60, 0.15, 90);    // Stark Industries, Midtown East
    attach(40.7614, -73.9776, 2, 30, 15, 90, 0.3, 130);    // Oscorp tower signage
    attach(40.7516, -73.9777, 7, 24, 12, 4, 0.25);         // Damage Control hoarding by Grand Central
    attach(40.7630, -73.9925, 9, 12, 6, 5, 0.45);          // Nelson, Murdock & Page — Hell's Kitchen
    attach(40.7411, -73.9897, 8, 22, 11, 14, 0.4);         // "Thank you, Avengers" mural, Flatiron
    attach(40.7265, -73.9990, 3, 14, 8.75, 9, 0.55);       // Bugle poster, the Village
    attach(40.7480, -74.0010, 4, 20, 10, 12, 0.7);         // Pym Technologies, Chelsea
    attach(40.7205, -74.0050, 7, 20, 10, 3.5, 0.6);        // Damage Control, downtown
    attach(40.7665, -73.9820, 6, 9, 12, 10, 0.8);          // New Asgard travel poster
    attach(40.7365, -73.9905, 5, 22, 11, 18, 0.85);        // Roxxon, Union Square
    for (const b of this.locked) (b as BuildingRec & { locked?: boolean }).locked = true;
    void hash2;
  }

  /** `detail` 0..1: how much of the city's signage belongs to the Marvel universe. */
  apply(detail: number) {
    for (const s of this.slots) {
      const mat = s.rank < detail * 0.62 ? this.marvelMats[s.marvel] : this.genericMats[s.generic];
      if (s.mesh.material !== mat) s.mesh.material = mat;
    }
    for (const e of this.eggs) e.mesh.visible = e.rank < detail;
  }
}
