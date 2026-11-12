/**
 * Geographic foundation: world coordinate system, Manhattan grid coordinates,
 * district classification and loading of the preprocessed NYC Open Data layers.
 *
 * World space: metres. +X east, +Z south (north is -Z), +Y up. Origin = 200 Park Ave.
 */

export const LAT0 = 40.7527, LON0 = -73.9772;
export const M_PER_LAT = 111047.0, M_PER_LON = 84395.0;

export const ll = (lat: number, lon: number): [number, number] => [
  (lon - LON0) * M_PER_LON,
  -(lat - LAT0) * M_PER_LAT,
];

/** Manhattan's street grid is rotated ~28.9° clockwise from true north. */
export const GRID_ANGLE = (28.9 * Math.PI) / 180;
/** unit vector pointing "uptown" along the avenues (x,z) */
export const UPTOWN: [number, number] = [Math.sin(GRID_ANGLE), -Math.cos(GRID_ANGLE)];
/** unit vector pointing "crosstown east" along the streets (x,z) */
export const CROSSTOWN: [number, number] = [Math.cos(GRID_ANGLE), Math.sin(GRID_ANGLE)];

const [X542, Z542] = ll(40.75358, -73.98118); // 5th Ave & 42nd St

/** Approximate street number (42 = 42nd St; <= 0 means below Houston). */
export const streetOf = (x: number, z: number) =>
  42 + ((x - X542) * UPTOWN[0] + (z - Z542) * UPTOWN[1]) / 80.2;
/** Metres east of 5th Avenue (negative = west side). */
export const aveOf = (x: number, z: number) =>
  (x - X542) * CROSSTOWN[0] + (z - Z542) * CROSSTOWN[1];
/** Inverse: world position from street number + metres east of 5th. */
export const gridToWorld = (street: number, ave: number): [number, number] => {
  const a = (street - 42) * 80.2;
  return [X542 + UPTOWN[0] * a + CROSSTOWN[0] * ave, Z542 + UPTOWN[1] * a + CROSSTOWN[1] * ave];
};

export enum District {
  Midtown, MidtownEast, TimesSquare, MidtownSouth, HudsonYards, Chelsea, HellsKitchen,
  Flatiron, MurrayHill, Village, EastVillage, SoHo, Uptown, Downtown, Outer,
}

export function districtOf(x: number, z: number, tier: number): District {
  if (tier === 2) return District.Outer;
  const s = streetOf(x, z), a = aveOf(x, z);
  if (s > 60) return District.Uptown;
  if (s < -11) return District.Downtown;
  if (s < 1.5) return a < 420 ? District.SoHo : District.EastVillage;
  if (s < 14.5) return a < 260 ? District.Village : District.EastVillage;
  if (s < 31) {
    if (a < -900 && s > 29) return District.HudsonYards;
    if (a < -330) return District.Chelsea;
    if (a < 330) return District.Flatiron;
    return District.MurrayHill;
  }
  if (s < 40) {
    if (a < -1050) return District.HudsonYards;
    if (a < -700) return District.HellsKitchen;
    if (a < 330) return District.MidtownSouth;
    return District.MurrayHill;
  }
  // 40..60
  if (a < -820) return District.HellsKitchen;
  if (a < -330 && s < 54) return District.TimesSquare;
  if (a > 200) return District.MidtownEast;
  return District.Midtown;
}

// ---- data ---------------------------------------------------------------------

export interface BuildingRec {
  id: number;
  h: number;        // real roof height (m)
  year: number;
  tier: number;     // 0 core Manhattan, 1 rest of Manhattan, 2 other boroughs
  pts: Float32Array; // x,z pairs (CCW in x/z)
  cx: number; cz: number;
  area: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** carries landmark signage: keeps its surveyed height whatever the generation sliders say */
  locked?: boolean;
}
export interface RoadRec { w: number; t: number; b: number; pts: Float32Array; n?: string }
export interface PolyRec { pts: Float32Array; boro?: number; name?: string }

export interface CityData {
  buildings: BuildingRec[];
  land: PolyRec[];
  parks: PolyRec[];
  roads: RoadRec[];
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const toF = (arr: number[]) => {
  const f = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) f[i] = arr[i] / 10;
  return f;
};

export function polyArea(p: Float32Array): number {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}

export function pointInPoly(x: number, z: number, p: ArrayLike<number>): boolean {
  let inside = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export async function loadCityData(onProgress?: (f: number) => void): Promise<CityData> {
  const [binBuf, city] = await Promise.all([
    fetch('./data/buildings.bin').then((r) => r.arrayBuffer()),
    fetch('./data/city.json').then((r) => r.json()),
  ]);
  onProgress?.(0.5);
  const I = new Int32Array(binBuf);
  const count = I[0];
  const buildings: BuildingRec[] = new Array(count);
  let o = 1;
  for (let i = 0; i < count; i++) {
    const h = I[o] / 10, year = I[o + 1], tier = I[o + 2], n = I[o + 3];
    o += 4;
    const pts = new Float32Array(n * 2);
    let cx = 0, cz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = I[o++] / 10, z = I[o++] / 10;
      pts[k * 2] = x; pts[k * 2 + 1] = z;
      cx += x; cz += z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    buildings[i] = { id: i, h, year, tier, pts, cx: cx / n, cz: cz / n, area: Math.abs(polyArea(pts)), minX, maxX, minZ, maxZ };
  }
  const land: PolyRec[] = city.land.map((l: any) => ({ pts: toF(l.pts), boro: l.boro }));
  const parks: PolyRec[] = city.parks.map((l: any) => ({ pts: toF(l.pts), name: l.name }));
  const roads: RoadRec[] = city.roads.map((r: any) => ({ w: r.w / 10, t: r.t, b: r.b, pts: toF(r.pts), n: r.n }));
  const b = city.meta.bbox;
  const [minX, maxZ] = ll(b.s, b.w);
  const [maxX, minZ] = ll(b.n, b.e);
  onProgress?.(1);
  return { buildings, land, parks, roads, bbox: { minX, maxX, minZ, maxZ } };
}
