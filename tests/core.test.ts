import { describe, it, expect } from 'vitest';
import { ll, gridToWorld, streetOf, aveOf, districtOf, District, pointInPoly, polyArea, BuildingRec } from '../src/city/geo';
import { DEFAULT_PARAMS, CONTROL_SCHEMA, sunFromTime, WEATHER_PRESETS, QUALITY_PRESETS, Params } from '../src/state/params';
import { SCENE_PRESETS, BOOKMARKS } from '../src/state/presets';
import { sanitizeParams, cleanPresetName } from '../src/state/store';
import { computeAtmosphere } from '../src/engine/atmosphere';
import { outputSize } from '../src/photo/capture';
import { hash2, mulberry32 } from '../src/util/rng';
import { insetPoly, obbOf, rectRing, ringArea, MeshBuilder } from '../src/city/meshBuilder';
import { StylePalette, STYLE_ROWS } from '../src/city/facade';
import { planBuilding, emitMass, emitDetail, GenCtx } from '../src/city/buildingGen';
import { SITES } from '../src/landmarks/sites';

const rect = (cx: number, cz: number, hx: number, hz: number): BuildingRec => {
  const pts = rectRing(cx, cz, hx, hz, 0.5);
  return { id: 42, h: 120, year: 1931, tier: 0, pts, cx, cz, area: Math.abs(polyArea(pts)), minX: cx - hx - hz, maxX: cx + hx + hz, minZ: cz - hx - hz, maxZ: cz + hx + hz };
};
const ctx = (p: Params): GenCtx => { const palette = new StylePalette(); palette.generate(p.seed, p.archVariation); return { p, palette, meanH: () => 40, isRoad: () => true }; };

describe('geography', () => {
  it('places the origin at 200 Park Avenue and keeps north = -Z', () => {
    const o = ll(40.7527, -73.9772);
    expect(Math.abs(o[0]) + Math.abs(o[1])).toBeLessThan(1e-9);
    expect(ll(40.7627, -73.9772)[1]).toBeLessThan(-1000);
    expect(ll(40.7527, -73.9672)[0]).toBeGreaterThan(800);
  });
  it('round-trips Manhattan grid coordinates', () => {
    const [x, z] = gridToWorld(57, -300);
    expect(streetOf(x, z)).toBeCloseTo(57, 5);
    expect(aveOf(x, z)).toBeCloseTo(-300, 5);
  });
  it('knows the Empire State Building is at 34th & Fifth, and the Sanctum is in the Village', () => {
    expect(streetOf(SITES.empire.x, SITES.empire.z)).toBeGreaterThan(32.5);
    expect(streetOf(SITES.empire.x, SITES.empire.z)).toBeLessThan(35);
    expect(Math.abs(aveOf(SITES.empire.x, SITES.empire.z))).toBeLessThan(140);
    expect(districtOf(SITES.sanctum.x, SITES.sanctum.z, 0)).toBe(District.Village);
    expect(districtOf(SITES.timessquare.x, SITES.timessquare.z, 0)).toBe(District.TimesSquare);
  });
  it('point-in-polygon', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPoly(5, 5, sq)).toBe(true);
    expect(pointInPoly(15, 5, sq)).toBe(false);
  });
});

describe('parameters & presets', () => {
  it('every control maps to a real parameter with sane bounds', () => {
    for (const c of CONTROL_SCHEMA) {
      expect(c.key in DEFAULT_PARAMS, c.key).toBe(true);
      if (c.kind === 'slider') {
        const v = DEFAULT_PARAMS[c.key] as number;
        expect(v, c.key).toBeGreaterThanOrEqual(c.min!);
        expect(v, c.key).toBeLessThanOrEqual(c.max!);
      }
    }
  });
  it('scene presets reference existing bookmarks and never touch generation / performance keys', () => {
    for (const p of SCENE_PRESETS) {
      expect(BOOKMARKS.some((b) => b.id === p.bookmark), p.id).toBe(true);
      for (const k of ['seed', 'heightScale', 'density', 'quality', 'renderDistance']) expect(k in p.params, `${p.id}.${k}`).toBe(false);
    }
    for (const id of ['golden', 'avengers', 'blue', 'midnight', 'rain', 'snow', 'spidey', 'sanctum']) expect(SCENE_PRESETS.some((p) => p.id === id), id).toBe(true);
    for (const id of ['skyline', 'avengers', 'spidey', 'sanctum', 'midtown-night', 'riverfront', 'times-square', 'snow']) expect(BOOKMARKS.some((b) => b.id === id), id).toBe(true);
  });
  it('sanitises imported settings', () => {
    const p = sanitizeParams({ exposure: 1.7, seed: 'evil', fov: NaN, bogus: 1, weather: 'rain' });
    expect(p.exposure).toBe(1.7);
    expect(p.seed).toBe(DEFAULT_PARAMS.seed);
    expect(p.fov).toBe(DEFAULT_PARAMS.fov);
    expect((p as unknown as Record<string, unknown>).bogus).toBeUndefined();
    expect(sanitizeParams(null)).toEqual(DEFAULT_PARAMS);
    // hostile / corrupt values are clamped or rejected before they can reach the renderer
    const h = sanitizeParams({ renderDistance: 1e9, lodBias: -5, resolution: 'bogus', quality: 'ultra', heroVariant: 7, aspect: '21:9' });
    expect(h.renderDistance).toBe(24); expect(h.lodBias).toBe(0.4); expect(h.resolution).toBe(DEFAULT_PARAMS.resolution);
    expect(h.quality).toBe('ultra'); expect(h.heroVariant).toBe(DEFAULT_PARAMS.heroVariant); expect(h.aspect).toBe('21:9');
    expect(sanitizeParams([1, 2, 3])).toEqual(DEFAULT_PARAMS);
    expect(cleanPresetName('__proto__')).toBeNull(); expect(cleanPresetName('  Dusk  ')).toBe('Dusk'); expect(cleanPresetName('')).toBeNull();
  });
  it('sun is high at noon, below the horizon at midnight, and sets in the west-north-west', () => {
    expect(sunFromTime(13).el).toBeGreaterThan(60);
    expect(sunFromTime(0).el).toBeLessThan(-20);
    const s = sunFromTime(19.8);
    expect(s.el).toBeGreaterThan(0); expect(s.el).toBeLessThan(10);
    expect((s.az * 180) / Math.PI).toBeGreaterThan(280); expect((s.az * 180) / Math.PI).toBeLessThan(305);
  });
});

describe('atmosphere', () => {
  it('produces finite, distinct lighting for every preset', () => {
    const seen = new Set<string>();
    for (const sp of SCENE_PRESETS) {
      const a = computeAtmosphere({ ...DEFAULT_PARAMS, ...sp.params });
      for (const v of [a.lightIntensity, a.hemiIntensity, a.fogBase, a.fogGround, a.night, a.envIntensity, a.zenith.r, a.horizon.g, a.fogColor.b, a.lightDir.x, a.lightDir.y])
        expect(Number.isFinite(v), sp.id).toBe(true);
      expect(a.lightDir.y).toBeGreaterThan(0);
      seen.add([a.zenith.getHexString(), a.fogColor.getHexString(), a.night.toFixed(2), a.fogGround.toExponential(2)].join('|'));
    }
    expect(seen.size).toBe(SCENE_PRESETS.length);
  });
  it('weather presets drive the environment sliders', () => {
    expect(computeAtmosphere({ ...DEFAULT_PARAMS, ...WEATHER_PRESETS.fog }).fogGround).toBeGreaterThan(computeAtmosphere(DEFAULT_PARAMS).fogGround * 4);
    expect(computeAtmosphere({ ...DEFAULT_PARAMS, ...WEATHER_PRESETS.overcast }).lightIntensity).toBeLessThan(computeAtmosphere(DEFAULT_PARAMS).lightIntensity * 0.4);
    expect(Object.keys(QUALITY_PRESETS)).toEqual(['low', 'medium', 'high', 'ultra']);
  });
});

describe('procedural generation', () => {
  it('is deterministic for a given seed and changes with it', () => {
    expect(hash2(3, 9)).toBe(hash2(3, 9));
    const a = mulberry32(7), b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const r = rect(-200, 300, 30, 22);
    const p1 = planBuilding(r, ctx(DEFAULT_PARAMS)), p2 = planBuilding(r, ctx(DEFAULT_PARAMS));
    expect(p1.row).toBe(p2.row); expect(p1.H).toBe(p2.H); expect(p1.tiers.length).toBe(p2.tiers.length);
    const rows = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => planBuilding(r, ctx({ ...DEFAULT_PARAMS, seed })).row));
    expect(rows.size).toBeGreaterThan(2);
  });
  it('height, density and skyline sliders change the massing; locked buildings do not move', () => {
    const r = rect(-200, 300, 30, 22);
    const base = planBuilding(r, ctx(DEFAULT_PARAMS)).H;
    expect(planBuilding(r, ctx({ ...DEFAULT_PARAMS, heightScale: 1.5 })).H).toBeGreaterThan(base * 1.3);
    expect(planBuilding(r, ctx({ ...DEFAULT_PARAMS, skylineVariation: 0 })).H).toBeLessThan(base * 0.6);
    const cleared = [...Array(40).keys()].filter((i) => planBuilding({ ...r, id: i }, ctx({ ...DEFAULT_PARAMS, density: 0 })).cleared).length;
    expect(cleared).toBeGreaterThan(20);
    const locked = { ...r, locked: true };
    expect(planBuilding(locked, ctx({ ...DEFAULT_PARAMS, heightScale: 1.5, density: 0, skylineVariation: 0 })).H).toBeCloseTo(planBuilding(locked, ctx(DEFAULT_PARAMS)).H, 5);
  });
  it('emits valid, bounded geometry with stacked setbacks for a pre-war tower', () => {
    const r = rect(-200, 300, 30, 22);
    const c = ctx(DEFAULT_PARAMS);
    const plan = planBuilding(r, c);
    expect(plan.tiers.length).toBeGreaterThan(1);
    for (let i = 1; i < plan.tiers.length; i++) expect(plan.tiers[i].y0).toBeCloseTo(plan.tiers[i - 1].y1, 5);
    const mb = new MeshBuilder();
    emitMass(mb, plan, mulberry32(1));
    emitDetail(mb, plan, c);
    expect(mb.ni % 3).toBe(0);
    expect(mb.nv).toBeGreaterThan(100);
    for (let i = 0; i < mb.ni; i++) expect(mb.idx[i]).toBeLessThan(mb.nv);
    for (let i = 0; i < mb.nv * 3; i++) expect(Number.isFinite(mb.pos[i])).toBe(true);
    for (let i = 0; i < mb.nv; i++) expect(mb.sty[i * 3] % 1024).toBeLessThan(STYLE_ROWS + 24);
  });
  it('polygon helpers', () => {
    const ring = rectRing(0, 0, 10, 5, 0);
    expect(ringArea(ring)).toBeCloseTo(200, 3);
    const inner = insetPoly(ring, 1)!;
    expect(ringArea(inner)).toBeCloseTo(18 * 8, 2);
    expect(insetPoly(ring, 6)).toBeNull();
    const ob = obbOf(rectRing(3, 4, 10, 5, 0.3));
    expect(ob.hx).toBeCloseTo(10, 3); expect(ob.hz).toBeCloseTo(5, 3); expect(ob.cx).toBeCloseTo(3, 3);
  });
});

describe('photography', () => {
  it('resolves export sizes for resolution + aspect', () => {
    expect(outputSize('4k', 'free', 16 / 9)).toEqual([3840, 2160]);
    expect(outputSize('1080p', '16:9', 2)).toEqual([1920, 1080]);
    expect(outputSize('4k', '21:9', 16 / 9)).toEqual([3840, 1646]);
    const [w, h] = outputSize('4k', '9:16', 16 / 9);
    expect(h).toBe(3840); expect(w).toBe(2160);
    expect(outputSize('8k', 'free', 16 / 9)).toEqual([7680, 4320]);
  });
});
