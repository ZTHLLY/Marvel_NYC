import type { Params } from '../state/params';
import { BuildingRec, District, districtOf, aveOf, pointInPoly, UPTOWN } from './geo';
import { Family, StylePalette, Surf, VARIANTS } from './facade';
import { MeshBuilder, insetPoly, obbOf, rectRing, scaleRing, ringArea, OBB } from './meshBuilder';
import { hash2, hash3, mulberry32, rr, Rng, weighted, clamp } from '../util/rng';

export interface GenCtx {
  p: Params;
  palette: StylePalette;
  /** mean real building height around a position (drives Skyline Variation) */
  meanH: (x: number, z: number) => number;
  /** true if the point lies on a street (used to find street-facing walls) */
  isRoad: (x: number, z: number) => boolean;
}

export interface Tier { pts: ArrayLike<number>; y0: number; y1: number; parapet: number; slope?: { dx: number; dz: number; rise: number } }

type W = readonly (readonly [Family, number])[];
const F = Family;

function familyWeights(d: District, H: number, area: number, year: number, ave: number): W {
  const tall = H > 90, mid = H > 30;
  const old = year > 0 && year < 1942, modern = year >= 1982;
  const slender = area < 1600 && H > 150;
  switch (d) {
    case District.Midtown:
    case District.MidtownEast:
      if (tall) return old ? [[F.ArtDeco, 8], [F.Hotel, 1.5]] : modern ? [[F.GlassOffice, 7], [F.LuxuryCondo, slender ? 5 : 1], [F.Hotel, 1]] : [[F.OfficeComplex, 6], [F.GlassOffice, 4]];
      if (mid) return old ? [[F.ArtDeco, 4], [F.Hotel, 2.5], [F.MixedUse, 2], [F.BrickApartment, 1.5]] : modern ? [[F.GlassOffice, 5], [F.Hotel, 2.5], [F.ModernResidential, 2.5]] : [[F.OfficeComplex, 5], [F.Hotel, 2], [F.ModernResidential, 3]];
      return d === District.MidtownEast ? [[F.Brownstone, 4], [F.BrickApartment, 3], [F.MixedUse, 3]] : [[F.MixedUse, 5], [F.BrickApartment, 3], [F.Brownstone, 2]];
    case District.TimesSquare:
      if (tall) return old ? [[F.ArtDeco, 5], [F.Hotel, 5]] : [[F.GlassOffice, 5], [F.Hotel, 5]];
      if (mid) return [[F.Hotel, 4], [F.MixedUse, 3], [F.ArtDeco, 3]];
      return [[F.MixedUse, 7], [F.BrickApartment, 3]];
    case District.MidtownSouth:
      if (mid) return old || year === 0 ? [[F.ArtDeco, 6], [F.Industrial, 2], [F.Hotel, 2]] : [[F.Hotel, 4], [F.GlassOffice, 3], [F.ModernResidential, 3]];
      return [[F.MixedUse, 6], [F.BrickApartment, 4]];
    case District.HudsonYards:
      if (tall) return [[F.GlassOffice, 6], [F.LuxuryCondo, 4]];
      if (mid) return [[F.ModernResidential, 5], [F.Industrial, 3], [F.GlassOffice, 2]];
      return [[F.Industrial, 6], [F.Waterfront, 4]];
    case District.Chelsea: {
      const west = ave < -1300;
      if (tall) return [[F.ModernResidential, 5], [F.LuxuryCondo, 5]];
      if (mid) return modern ? [[F.ModernResidential, 6], [F.LuxuryCondo, 4]] : [[F.BrickApartment, 5], [F.Industrial, west ? 6 : 3], [F.MixedUse, 2]];
      return west ? [[F.Industrial, 5], [F.Waterfront, 2], [F.BrickApartment, 3]] : [[F.Brownstone, 4.5], [F.BrickApartment, 3.5], [F.Industrial, 2]];
    }
    case District.HellsKitchen:
      if (tall) return [[F.ModernResidential, 6], [F.LuxuryCondo, 2], [F.GlassOffice, 2]];
      if (mid) return modern ? [[F.ModernResidential, 8], [F.Hotel, 2]] : [[F.BrickApartment, 7], [F.Industrial, 3]];
      return [[F.BrickApartment, 7], [F.Brownstone, 2], [F.MixedUse, 1]];
    case District.Flatiron:
      if (tall) return old ? [[F.ArtDeco, 8], [F.Hotel, 2]] : [[F.LuxuryCondo, 6], [F.ModernResidential, 4]];
      if (mid) return modern ? [[F.ModernResidential, 5], [F.Hotel, 5]] : [[F.MixedUse, 5], [F.ArtDeco, 3], [F.BrickApartment, 2]];
      return [[F.MixedUse, 5], [F.BrickApartment, 3], [F.Brownstone, 2]];
    case District.MurrayHill:
      if (tall) return old ? [[F.ArtDeco, 6], [F.Hotel, 4]] : modern ? [[F.LuxuryCondo, 4], [F.ModernResidential, 4], [F.GlassOffice, 2]] : [[F.ModernResidential, 6], [F.OfficeComplex, 4]];
      if (mid) return [[F.BrickApartment, 5], [F.ModernResidential, 3], [F.Hotel, 2]];
      return [[F.Brownstone, 6], [F.BrickApartment, 4]];
    case District.Village:
      if (tall) return [[F.ModernResidential, 5], [F.BrickApartment, 5]];
      if (mid) return [[F.BrickApartment, 7], [F.MixedUse, 2], [F.ModernResidential, 1]];
      return [[F.Brownstone, 5.5], [F.BrickApartment, 3], [F.MixedUse, 1.5]];
    case District.EastVillage:
      if (mid) return [[F.BrickApartment, 7], [F.ModernResidential, 3]];
      return [[F.BrickApartment, 6.5], [F.Brownstone, 1.5], [F.MixedUse, 2]];
    case District.SoHo:
      if (tall) return [[F.LuxuryCondo, 4], [F.GlassOffice, 3], [F.Hotel, 3]];
      return [[F.MixedUse, 7], [F.Industrial, 1.5], [F.BrickApartment, 1.5]];
    case District.Uptown:
      if (tall) return old ? [[F.ArtDeco, 5], [F.Hotel, 2], [F.BrickApartment, 3]] : [[F.LuxuryCondo, 4], [F.ModernResidential, 5], [F.GlassOffice, 1]];
      if (mid) return modern ? [[F.ModernResidential, 8], [F.LuxuryCondo, 2]] : [[F.BrickApartment, 6], [F.ArtDeco, 3], [F.Hotel, 1]];
      return [[F.Brownstone, 6], [F.BrickApartment, 4]];
    case District.Downtown:
      if (tall) return old ? [[F.ArtDeco, 9], [F.Hotel, 1]] : [[F.GlassOffice, 6], [F.LuxuryCondo, 2], [F.OfficeComplex, 2]];
      if (mid) return [[F.MixedUse, 4], [F.BrickApartment, 3], [F.OfficeComplex, 3]];
      return [[F.BrickApartment, 5], [F.MixedUse, 5]];
    default:
      if (tall) return [[F.GlassOffice, 4], [F.ModernResidential, 4], [F.LuxuryCondo, 2]];
      if (mid) return [[F.ModernResidential, 4], [F.BrickApartment, 4], [F.Industrial, 2]];
      return [[F.OuterGeneric, 6], [F.Industrial, 2], [F.BrickApartment, 2]];
  }
}

function insideAll(ring: ArrayLike<number>, poly: ArrayLike<number>): boolean {
  for (let i = 0; i < ring.length; i += 2) if (!pointInPoly(ring[i], ring[i + 1], poly)) return false;
  return true;
}

/** Tower floor-plate inside a footprint: an OBB-aligned rectangle, shrunk until it fits. */
function towerRing(base: ArrayLike<number>, ob: OBB, kx: number, kz: number, chamfer: number, r: Rng): Float32Array | null {
  const offx = (r() - 0.5) * ob.hx * (1 - kx) * 0.6, offz = (r() - 0.5) * ob.hz * (1 - kz) * 0.6;
  const c = Math.cos(ob.ang), s = Math.sin(ob.ang);
  for (let attempt = 0; attempt < 4; attempt++) {
    const k = Math.pow(0.82, attempt);
    const o = attempt < 2 ? 1 : 0;
    const cx = ob.cx + (offx * c - offz * s) * o, cz = ob.cz + (offx * s + offz * c) * o;
    const hx = ob.hx * kx * k, hz = ob.hz * kz * k;
    const ring = rectRing(cx, cz, hx, hz, ob.ang, Math.min(chamfer, hx * 0.4, hz * 0.4));
    if (insideAll(ring, base)) return ring;
  }
  return null;
}

export interface Plan {
  rec: BuildingRec; family: Family; row: number; seed: number; H: number; tiers: Tier[];
  floorH: number; groundH: number; bayW: number; crown: number; cleared: boolean; district: District; ob: OBB;
}

/** Decide family, style, height and massing for one footprint. Deterministic in (rec, params). */
export function planBuilding(rec: BuildingRec, ctx: GenCtx): Plan {
  const p = ctx.p;
  const r = mulberry32((rec.id + 1) * 2654435761 + p.seed * 97);
  const seed = r();
  const district = districtOf(rec.cx, rec.cz, rec.tier);
  const ave = aveOf(rec.cx, rec.cz);

  // ---- height
  let H = rec.h;
  let cleared = false;
  if (rec.tier <= 1 && !rec.locked) {
    const mean = ctx.meanH(rec.cx, rec.cz);
    const k = p.skylineVariation * 2;
    H = mean + (H - mean) * (H > mean ? k : Math.min(k, 1.4));
    if (p.skylineVariation > 0.5) H *= 1 + (hash3(rec.id, p.seed, 3) - 0.5) * (p.skylineVariation - 0.5) * 0.7;
    const hd = hash3(rec.id, p.seed, 11);
    if (p.density < 0.7 && hd < ((0.7 - p.density) / 0.7) * 0.9) { H = Math.min(H, 4 + 6 * hash3(rec.id, p.seed, 12)); cleared = true; }
    else if (p.density > 0.7 && H < 75 && rec.area > 180 && hd < ((p.density - 0.7) / 0.3) * 0.42) H *= 1.6 + 2.4 * hash3(rec.id, p.seed, 13);
  }
  H = Math.max(3.2, H * (rec.locked ? 1 : p.heightScale));

  // ---- family & style
  const weights = familyWeights(district, H, rec.area, rec.year, ave);
  let family: Family;
  if (H < 22 && rec.area > 2600 && rec.tier === 0 && Math.abs(ave) > 1500) family = r() < 0.6 ? F.Waterfront : F.Industrial;
  else if (r() < 0.2 + 0.8 * p.archVariation) family = weighted(r, weights);
  else family = weights.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const nVar = 1 + Math.floor(p.archVariation * (VARIANTS - 1));
  const row = family * VARIANTS + (Math.floor(r() * nVar) % VARIANTS);
  const info = ctx.palette.info[row];
  const { floorH, bayW } = info;
  const groundH = Math.min(info.groundH, H);
  const q = (y: number) => groundH + Math.max(0, Math.round((y - groundH) / floorH)) * floorH;
  H = Math.max(groundH, q(H));

  const base = rec.pts;
  const ob = obbOf(base);
  const tiers: Tier[] = [];
  let crown = 0; // 0 flat, 1 mech penthouse, 2 stepped, 3 spire, 4 pyramid, 5 slope
  const glassy = family === F.GlassOffice || family === F.LuxuryCondo;
  const par = glassy ? (H > 60 ? rr(r, 1.5, 4.5) : 1.1) : family === F.Waterfront ? 0.3 : 0.95;
  const old = (rec.year > 0 && rec.year < 1950) || family === F.ArtDeco;

  if (H < 42 || rec.area < 320 || rec.tier === 2 && H < 80) {
    // low / mid-rise: single extrusion; larger pre-war blocks get one setback
    if (H > 30 && old && rec.area > 700 && r() < 0.5) {
      const y = q(H * rr(r, 0.62, 0.8));
      const up = insetPoly(base, rr(r, 2.2, 3.6));
      if (up && y < H - floorH) { tiers.push({ pts: base, y0: 0, y1: y, parapet: par }, { pts: up, y0: y, y1: H, parapet: par }); }
    }
    if (!tiers.length) tiers.push({ pts: base, y0: 0, y1: H, parapet: par });
    crown = H > 24 && r() < 0.6 ? 1 : 0;
  } else if (old && family !== F.GlassOffice) {
    // ---- 1916-zoning "wedding cake"
    const n = H > 190 ? 4 : H > 120 ? 3 : H > 70 ? 2 : 1;
    let cur: ArrayLike<number> = base;
    let y = 0;
    const first = q(H * rr(r, 0.3, 0.46));
    const span = H - first;
    const dBase = clamp(Math.sqrt(rec.area) / 14, 2.2, 6.5);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const top = q(first + span * (1 - Math.pow(0.52, i)) * 0.82);
      if (top - y < floorH * 2) continue;
      tiers.push({ pts: cur, y0: y, y1: top, parapet: 0.9 });
      y = top;
      const nxt = insetPoly(cur, dBase * rr(r, 0.75, 1.25));
      if (!nxt) { ok = false; break; }
      cur = nxt;
    }
    // slender tower shaft on large lots
    if (rec.area > 1300 && H > 130) {
      const tw = towerRing(cur, obbOf(cur), rr(r, 0.5, 0.68), rr(r, 0.5, 0.68), rr(r, 0, 3), r);
      if (tw) { const top = q(y + (H - y) * 0.45); if (top - y > floorH * 2) { tiers.push({ pts: cur, y0: y, y1: top, parapet: 0.9 }); y = top; } cur = tw; }
    }
    if (H - y >= floorH) tiers.push({ pts: cur, y0: y, y1: H, parapet: 0.9 });
    else if (tiers.length) tiers[tiers.length - 1].y1 = H;
    else tiers.push({ pts: base, y0: 0, y1: H, parapet: 0.9 });
    crown = H > 150 ? (r() < 0.55 ? 3 : 2) : r() < 0.5 ? 2 : r() < 0.3 && rec.area < 1400 ? 4 : 1;
  } else {
    // ---- post-war slab / modern tower
    const big = rec.area > (glassy ? 3400 : 2300);
    let cur: ArrayLike<number> = base;
    let y = 0;
    if (big && H > 85) {
      const tw = towerRing(base, ob, rr(r, 0.55, 0.85), rr(r, 0.45, 0.8), glassy && r() < 0.4 ? rr(r, 2, 6) : 0, r);
      if (tw) {
        const pod = q(groundH + floorH * Math.floor(rr(r, 2, 7)));
        tiers.push({ pts: base, y0: 0, y1: pod, parapet: 1.0 });
        y = pod; cur = tw;
      }
    }
    const variant = r();
    if (family === F.ModernResidential || family === F.OfficeComplex || variant < 0.36) {
      tiers.push({ pts: cur, y0: y, y1: H, parapet: par });
      crown = 1;
    } else if (variant < 0.62) {
      // subtle upper setbacks
      const y1 = q(y + (H - y) * rr(r, 0.66, 0.78)), y2 = q(y + (H - y) * rr(r, 0.86, 0.93));
      const a = insetPoly(cur, rr(r, 1.8, 3.6));
      const b = a && insetPoly(a, rr(r, 1.8, 3.2));
      if (a && y1 - y > floorH * 3 && H - y1 > floorH * 3) {
        tiers.push({ pts: cur, y0: y, y1, parapet: par });
        if (b && y2 - y1 > floorH * 2 && H - y2 > floorH) { tiers.push({ pts: a, y0: y1, y1: y2, parapet: par }, { pts: b, y0: y2, y1: H, parapet: par }); }
        else tiers.push({ pts: a, y0: y1, y1: H, parapet: par });
      } else tiers.push({ pts: cur, y0: y, y1: H, parapet: par });
      crown = r() < 0.35 && H > 200 ? 3 : 1;
    } else if (variant < 0.8 && H > 110) {
      // gentle taper in 3-4 tiers
      const n = 3 + Math.floor(r() * 2);
      let c2: ArrayLike<number> = cur, yy = y, ok = true;
      for (let i = 0; i < n; i++) {
        const top = i === n - 1 ? H : q(y + ((H - y) * (i + 1)) / n);
        if (top - yy < floorH) continue;
        tiers.push({ pts: c2, y0: yy, y1: top, parapet: i === n - 1 ? par : 0.4 });
        yy = top;
        if (ok) { const nx = insetPoly(c2, rr(r, 1.1, 2.4)); if (nx) c2 = nx; else ok = false; }
      }
      crown = r() < 0.5 ? 3 : 0;
    } else {
      // chisel crown: sloped roofline
      const rise = Math.min(H * 0.12, rr(r, 8, 26));
      const ang = ob.ang + (r() < 0.5 ? 0 : Math.PI / 2) + (r() < 0.5 ? Math.PI : 0);
      tiers.push({ pts: cur, y0: y, y1: H - rise, parapet: 0, slope: { dx: Math.cos(ang), dz: Math.sin(ang), rise } });
      crown = 5;
    }
  }
  return { rec, family, row, seed, H, tiers, floorH, groundH, bayW, crown, cleared, district, ob };
}

/** Emit the structural massing (all LODs share it). */
export function emitMass(mb: MeshBuilder, plan: Plan, r: Rng) {
  const { tiers, row, seed, bayW, family } = plan;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    mb.style(row, Surf.Wall, seed, t.y1);
    if (t.slope) {
      const s = t.slope;
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < t.pts.length; k += 2) { const d = t.pts[k] * s.dx + t.pts[k + 1] * s.dz; if (d < lo) lo = d; if (d > hi) hi = d; }
      const fn = (x: number, z: number) => t.y1 + s.rise * ((x * s.dx + z * s.dz - lo) / Math.max(hi - lo, 1e-3));
      mb.style(row, Surf.Wall, seed, t.y1 + s.rise + 1);
      mb.walls(t.pts, t.y0, t.y1, bayW, fn);
      mb.style(row, Surf.Glass, seed, t.y1);
      mb.cap(t.pts, t.y1, undefined, fn);
    } else {
      mb.walls(t.pts, t.y0, t.y1 + t.parapet, bayW);
      mb.style(row, Surf.Roof, seed, t.y1);
      mb.cap(t.pts, t.y1);
    }
  }
  // ---- crowns that define the silhouette
  const top = tiers[tiers.length - 1];
  const tob = obbOf(top.pts);
  const yTop = top.y1;
  const small = Math.min(tob.hx, tob.hz);
  if (plan.crown === 1 && small > 4) {
    // mechanical penthouse
    const kx = rr(r, 0.35, 0.7), kz = rr(r, 0.35, 0.7), h = clamp(rr(r, 3.5, 7.5), 3, plan.H * 0.2);
    const ring = rectRing(tob.cx, tob.cz, tob.hx * kx, tob.hz * kz, tob.ang);
    if (insideAll(ring, top.pts)) {
      const masonry = family === F.BrickApartment || family === F.ArtDeco || family === F.Hotel || family === F.Brownstone;
      mb.style(row, masonry ? Surf.Blank : Surf.Metal, seed, yTop + h);
      mb.walls(ring, yTop, yTop + h, 0);
      mb.style(row, Surf.Roof, seed, yTop + h);
      mb.cap(ring, yTop + h);
    }
  } else if ((plan.crown === 2 || plan.crown === 3) && small > 5) {
    // stepped Art-Deco crown, optionally with a needle
    let k = rr(r, 0.6, 0.78), y = yTop, hx = tob.hx, hz = tob.hz;
    const steps = 2 + Math.floor(r() * 2);
    const sh = clamp(plan.H * 0.035, 3, 9);
    for (let i = 0; i < steps; i++) {
      hx *= k; hz *= k;
      const ring = rectRing(tob.cx, tob.cz, hx, hz, tob.ang, Math.min(hx, hz) * 0.25);
      if (i === 0 && !insideAll(ring, top.pts)) break;
      mb.style(row, Surf.Wall, seed, y + sh);
      mb.walls(ring, y, y + sh, bayW);
      mb.style(row, Surf.Roof, seed, y + sh);
      mb.cap(ring, y + sh);
      y += sh;
    }
    if (plan.crown === 3) {
      const sp = clamp(plan.H * rr(r, 0.07, 0.16), 8, 60);
      mb.style(row, Surf.Steel, seed, y + sp);
      mb.cyl(tob.cx, y, tob.cz, Math.min(hx, hz) * 0.32, 0.12, sp, 6, false);
    }
  } else if (plan.crown === 3) {
    const sp = clamp(plan.H * rr(r, 0.08, 0.2), 10, 70);
    mb.style(row, Surf.Steel, seed, yTop + sp);
    mb.cyl(tob.cx + (r() - 0.5) * tob.hx, yTop, tob.cz + (r() - 0.5) * tob.hz, 0.7, 0.1, sp, 5, false);
  } else if (plan.crown === 4 && small > 4) {
    // pyramidal / hipped copper roof
    const ring = rectRing(tob.cx, tob.cz, tob.hx * 0.82, tob.hz * 0.82, tob.ang);
    if (insideAll(ring, top.pts)) {
      const h = Math.min(tob.hx, tob.hz) * rr(r, 0.9, 1.6);
      mb.style(row, r() < 0.25 ? Surf.Steel : Surf.Trim, seed, yTop + h);
      mb.pyramid(ring, yTop + 0.9, tob.cx, yTop + h, tob.cz);
    }
  }
}

/** Find the footprint edge that faces a street (longest edge with a road in front). Returns edge index or -1. */
function streetEdge(plan: Plan, ctx: GenCtx): number {
  const pts = plan.rec.pts, n = pts.length / 2;
  let best = -1, bestL = 3.5;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = pts[j * 2] - pts[i * 2], dz = pts[j * 2 + 1] - pts[i * 2 + 1], L = Math.hypot(dx, dz);
    if (L < bestL) continue;
    const mx = (pts[i * 2] + pts[j * 2]) / 2, mz = (pts[i * 2 + 1] + pts[j * 2 + 1]) / 2;
    const nx = dz / L, nz = -dx / L;
    if (ctx.isRoad(mx + nx * 7, mz + nz * 7) || ctx.isRoad(mx + nx * 11, mz + nz * 11)) { best = i; bestL = L; }
  }
  return best;
}

/** Near-camera architectural detail: copings, cornices, rooftop equipment, fire escapes, stoops, awnings, balconies. */
export function emitDetail(mb: MeshBuilder, plan: Plan, ctx: GenCtx) {
  const { rec, tiers, row, seed, family, floorH, groundH, H } = plan;
  const r = mulberry32((rec.id + 7) * 40503 + ctx.p.seed * 13);
  const rich = ctx.p.detailLevel;
  const masonry = family === F.BrickApartment || family === F.Brownstone || family === F.MixedUse || family === F.ArtDeco || family === F.Hotel || family === F.Industrial || family === F.OuterGeneric;

  // ---- parapet coping + inner face on every flat tier
  for (const t of tiers) {
    if (t.slope || t.parapet < 0.2) continue;
    const inner = insetPoly(t.pts, 0.38);
    if (!inner) continue;
    const yT = t.y1 + t.parapet;
    mb.style(row, Surf.Trim, seed, yT);
    mb.cap(t.pts, yT + 0.01, inner);
    // inner face (reverse winding by walking the inner ring backwards)
    const n = inner.length / 2;
    const rev = new Float32Array(inner.length);
    for (let i = 0; i < n; i++) { rev[i * 2] = inner[(n - 1 - i) * 2]; rev[i * 2 + 1] = inner[(n - 1 - i) * 2 + 1]; }
    mb.style(row, Surf.Blank, seed, yT);
    mb.walls(rev, t.y1, yT, 0);
  }
  // ---- projecting cornice on masonry street walls
  if (masonry && !plan.cleared) {
    const t0 = tiers[0];
    const out = insetPoly(t0.pts, -(family === F.Brownstone ? 0.55 : 0.4));
    if (out && t0.y1 < 75) {
      const yb = t0.y1 + t0.parapet - 0.75, yt = t0.y1 + t0.parapet + 0.12;
      mb.style(row, Surf.Trim, seed, yt);
      mb.walls(out, yb, yt, 0);
      mb.cap(out, yt, t0.pts as ArrayLike<number>);
      mb.cap(out, yb, t0.pts as ArrayLike<number>, undefined, true);
    }
    // belt course above the ground floor
    if (H > groundH + floorH && (family === F.ArtDeco || family === F.Hotel || family === F.MixedUse || family === F.Brownstone)) {
      const belt = insetPoly(t0.pts, -0.18);
      if (belt) {
        mb.style(row, Surf.Trim, seed, groundH);
        mb.walls(belt, groundH - 0.3, groundH + 0.05, 0);
        mb.cap(belt, groundH + 0.05, t0.pts as ArrayLike<number>);
        mb.cap(belt, groundH - 0.3, t0.pts as ArrayLike<number>, undefined, true);
      }
    }
  }

  // ---- rooftop equipment
  const top = tiers[tiers.length - 1];
  const tob = obbOf(top.pts);
  const spot = (margin: number): [number, number] | null => {
    for (let k = 0; k < 6; k++) {
      const lx = (r() * 2 - 1) * Math.max(0, tob.hx - margin), lz = (r() * 2 - 1) * Math.max(0, tob.hz - margin);
      const x = tob.cx + lx * Math.cos(tob.ang) - lz * Math.sin(tob.ang), z = tob.cz + lx * Math.sin(tob.ang) + lz * Math.cos(tob.ang);
      if (pointInPoly(x, z, top.pts) && pointInPoly(x + margin * 0.7, z, top.pts) && pointInPoly(x - margin * 0.7, z, top.pts) && pointInPoly(x, z + margin * 0.7, top.pts) && pointInPoly(x, z - margin * 0.7, top.pts)) return [x, z];
    }
    return null;
  };
  const roofArea = Math.abs(ringArea(top.pts));
  const yR = top.y1;
  if (!top.slope && !plan.cleared && roofArea > 40) {
    // water tank: the signature of the pre-war skyline
    if (masonry && H > 16 && H < 130 && roofArea > 120 && r() < 0.6) {
      const s = spot(2.6);
      if (s) {
        const tr = rr(r, 1.5, 2.1), th = rr(r, 2.8, 3.8), leg = rr(r, 2.2, 4.2);
        mb.style(row, Surf.Dark, seed, yR);
        for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) mb.beam(s[0] + ox * tr * 0.62, yR, s[1] + oz * tr * 0.62, s[0] + ox * tr * 0.62, yR + leg, s[1] + oz * tr * 0.62, 0.16);
        mb.beam(s[0] - tr * 0.62, yR + leg * 0.5, s[1] - tr * 0.62, s[0] + tr * 0.62, yR + leg * 0.5, s[1] + tr * 0.62, 0.1);
        mb.beam(s[0] + tr * 0.62, yR + leg * 0.5, s[1] - tr * 0.62, s[0] - tr * 0.62, yR + leg * 0.5, s[1] + tr * 0.62, 0.1);
        mb.style(row, Surf.Wood, seed, yR);
        mb.cyl(s[0], yR + leg, s[1], tr, tr * 0.96, th, 14, false);
        mb.style(row, Surf.Dark, seed, yR);
        mb.cyl(s[0], yR + leg + th, s[1], tr * 1.06, 0.05, tr * 0.55, 14, false);
      }
    }
    // stair bulkhead
    if (masonry && H < 90 && r() < 0.75) {
      const s = spot(2.4);
      if (s) { mb.style(row, Surf.Blank, seed, yR + 2.8); mb.box(s[0], yR, s[1], rr(r, 2.4, 3.6), 2.8, rr(r, 3, 4.6), tob.ang); }
    }
    // HVAC units & ducts
    const nH = Math.min(9, Math.floor((roofArea / 160) * (0.4 + rich)));
    for (let i = 0; i < nH; i++) {
      const s = spot(2);
      if (!s) continue;
      const w = rr(r, 1.4, 3.4), d = rr(r, 1.2, 2.4), h = rr(r, 0.9, 2.2);
      mb.style(row, Surf.Metal, seed, yR + h);
      mb.box(s[0], yR + 0.25, s[1], w, h, d, tob.ang);
      if (r() < 0.4) { mb.style(row, Surf.Dark, seed, yR); mb.cyl(s[0], yR + 0.25 + h, s[1], Math.min(w, d) * 0.32, Math.min(w, d) * 0.32, 0.18, 10); }
      if (r() < 0.35) {
        const L = rr(r, 3, 9), a = tob.ang + (r() < 0.5 ? 0 : Math.PI / 2);
        mb.style(row, Surf.Metal, seed, yR);
        mb.beam(s[0], yR + 0.6, s[1], s[0] + Math.cos(a) * L, yR + 0.6, s[1] + Math.sin(a) * L, 0.55, 0.45);
      }
    }
    // skylights on lofts
    if ((family === F.Industrial || family === F.MixedUse) && r() < 0.5) {
      const s = spot(2.5);
      if (s) { mb.style(row, Surf.Glass, seed, yR + 0.9); mb.box(s[0], yR, s[1], rr(r, 2, 4), 0.9, rr(r, 3, 6), tob.ang); }
    }
    // antennas / masts
    const nA = H > 60 ? Math.floor(r() * 3) : r() < 0.25 ? 1 : 0;
    for (let i = 0; i < nA; i++) {
      const s = spot(1);
      if (!s) continue;
      const h = rr(r, 3, H > 100 ? 14 : 7);
      mb.style(row, Surf.Dark, seed, yR);
      mb.beam(s[0], yR, s[1], s[0], yR + h, s[1], 0.09);
      if (r() < 0.5) mb.beam(s[0] - 0.6, yR + h * 0.8, s[1], s[0] + 0.6, yR + h * 0.8, s[1], 0.05);
    }
  }

  if (plan.cleared) return;
  const edge = streetEdge(plan, ctx);
  if (edge < 0) return;
  const pts = rec.pts, n = pts.length / 2, j = (edge + 1) % n;
  const ax = pts[edge * 2], az = pts[edge * 2 + 1];
  const ex = pts[j * 2] - ax, ez = pts[j * 2 + 1] - az, L = Math.hypot(ex, ez);
  const tx = ex / L, tz = ez / L, nx = tz, nz = -tx;
  const at = (s: number, o: number): [number, number] => [ax + tx * s + nx * o, az + tz * s + nz * o];
  const floors = Math.round((tiers[0].y1 - groundH) / floorH);

  // ---- fire escapes on tenements & lofts
  if ((family === F.BrickApartment || family === F.MixedUse || family === F.Industrial) && floors >= 3 && floors <= 9 && L > 5 && (rec.year < 1955) && r() < 0.8) {
    const s0 = L * rr(r, 0.3, 0.7), pw = 2.7, pd = 0.95;
    mb.style(row, Surf.Dark, seed, 0);
    for (let f = 1; f <= floors; f++) {
      const y = groundH + (f - 1) * floorH + floorH * 0.12;
      if (f > 1 || true) {
        const [x0, z0] = at(s0 - pw / 2, 0.05), [x1, z1] = at(s0 + pw / 2, 0.05);
        const [x2, z2] = at(s0 + pw / 2, pd), [x3, z3] = at(s0 - pw / 2, pd);
        // platform grating
        mb.beam((x0 + x3) / 2, y, (z0 + z3) / 2, (x1 + x2) / 2, y, (z1 + z2) / 2, pd, 0.05);
        // railing: top & mid rails on three sides
        for (const hh of [0.5, 0.95]) {
          mb.beam(x3, y + hh, z3, x2, y + hh, z2, 0.04);
          mb.beam(x0, y + hh, z0, x3, y + hh, z3, 0.04);
          mb.beam(x1, y + hh, z1, x2, y + hh, z2, 0.04);
        }
        for (let k = 0; k <= 4; k++) { const [px, pz] = at(s0 - pw / 2 + (pw * k) / 4, pd); mb.beam(px, y, pz, px, y + 0.95, pz, 0.03); }
        // stair to the next platform
        if (f < floors) {
          const dir = f % 2 ? 1 : -1;
          const [sx0, sz0] = at(s0 - dir * pw * 0.32, pd * 0.55), [sx1, sz1] = at(s0 + dir * pw * 0.32, pd * 0.55);
          mb.beam(sx0, y, sz0, sx1, y + floorH, sz1, 0.55, 0.05);
        }
      }
    }
    // drop ladder
    const [lx, lz] = at(s0 - pw * 0.3, pd * 0.8);
    mb.beam(lx, groundH - 1.6, lz, lx, groundH + floorH * 0.12, lz, 0.4, 0.04);
  }

  // ---- brownstone stoop
  if (family === F.Brownstone && L > 4.5) {
    const s0 = L * (r() < 0.5 ? 0.28 : 0.72), w = 1.7, steps = 7, rise = Math.min(1.5, groundH * 0.42) / steps;
    mb.style(row, Surf.Trim, seed, 2);
    for (let k = 0; k < steps; k++) {
      const [cx, cz] = at(s0, 0.3 + (steps - 1 - k) * 0.3 + 0.15);
      mb.box(cx, 0, cz, w, rise * (k + 1), 0.3, Math.atan2(tz, tx));
    }
    for (const side of [-1, 1]) {
      const [bx, bz] = at(s0 + side * (w / 2 + 0.12), 0.3 + steps * 0.15);
      mb.box(bx, 0, bz, 0.24, rise * steps * 0.6 + 0.75, steps * 0.3, Math.atan2(tz, tx));
    }
    // door surround
    const [dx0, dz0] = at(s0, 0.08);
    mb.style(row, Surf.Dark, seed, 4);
    mb.box(dx0, rise * steps, dz0, 1.25, 2.5, 0.12, Math.atan2(tz, tx));
  }

  // ---- shop awnings
  if ((family === F.MixedUse || family === F.BrickApartment || family === F.Hotel) && L > 6 && groundH > 3.6) {
    const count = Math.min(4, Math.floor(L / 6));
    for (let k = 0; k < count; k++) {
      if (r() > 0.45 + 0.3 * rich) continue;
      const s0 = (L * (k + 0.5)) / count, w = Math.min(4.2, (L / count) * 0.72);
      const [a0x, a0z] = at(s0, 0.02), [a1x, a1z] = at(s0, 1.25);
      mb.style(row, Surf.Awning, seed + k * 0.137, 0);
      mb.beam(a0x, groundH * 0.72, a0z, a1x, groundH * 0.72 - 0.55, a1z, w, 0.07);
    }
  }
  // ---- hotel / residential entrance canopy
  if ((family === F.Hotel || family === F.ModernResidential || family === F.LuxuryCondo || family === F.ArtDeco) && L > 12 && r() < 0.6) {
    const [c0x, c0z] = at(L * 0.5, 0), [c1x, c1z] = at(L * 0.5, 3.4);
    mb.style(row, Surf.Dark, seed, 0);
    mb.beam(c0x, 3.5, c0z, c1x, 3.5, c1z, 4.2, 0.22);
    for (const side of [-1.9, 1.9]) { const [px, pz] = at(L * 0.5 + side, 3.2); mb.beam(px, 0, pz, px, 3.5, pz, 0.12); }
  }
  // ---- balcony stacks on residential towers
  if ((family === F.ModernResidential || family === F.LuxuryCondo) && floors >= 5 && L > 9) {
    const stacks = Math.min(3, Math.floor(L / 9));
    const maxF = Math.min(floors, 46);
    for (let sidx = 0; sidx < stacks; sidx++) {
      const s0 = (L * (sidx + 0.5)) / stacks;
      const bw = 3.0, bd = 1.3;
      for (let f = 1; f < maxF; f++) {
        if (hash2(rec.id * 31 + sidx, f) < 0.08) continue;
        const y = groundH + f * floorH;
        const [m0x, m0z] = at(s0, 0), [m1x, m1z] = at(s0, bd);
        mb.style(row, Surf.Trim, seed, 0);
        mb.beam(m0x, y, m0z, m1x, y, m1z, bw, 0.14);
        const [g0x, g0z] = at(s0 - bw / 2, bd), [g1x, g1z] = at(s0 + bw / 2, bd);
        mb.style(row, Surf.Glass, seed, 0);
        mb.beam(g0x, y + 0.6, g0z, g1x, y + 0.6, g1z, 0.04, 1.0);
      }
    }
  }
}

// keep TS aware of UPTOWN being intentionally re-exported for downstream helpers
export const GRID_UPTOWN = UPTOWN;
export { scaleRing };
