import * as THREE from 'three';
import type { Params } from '../state/params';
import { BuildingRec, CityData } from './geo';
import { facadeMaterial, StylePalette } from './facade';
import { MeshBuilder } from './meshBuilder';
import { emitDetail, emitMass, GenCtx, planBuilding } from './buildingGen';
import { mulberry32 } from '../util/rng';
import type { CityGrid } from './ground';

export const CHUNK = 400;

interface Chunk {
  key: string;
  ix: number; iz: number;
  cx: number; cz: number;
  recs: BuildingRec[];
  maxH: number;
  mesh: THREE.Mesh | null;
  detail: THREE.Mesh | null;
  gen: number;        // generation the mass mesh was built for
  detailGen: number;
  queued: boolean;
  detailQueued: boolean;
  core: boolean;
  /** whether this chunk's buildings are currently included in `builtBuildings` */
  counted: boolean;
}

/**
 * Spatial chunking + streaming of the real-footprint city.
 * - mass meshes are built nearest-first inside the render distance and disposed beyond it
 * - detail meshes (copings, cornices, rooftop kit, fire escapes…) only exist near the camera
 * - parameter changes bump `generation`; chunks are rebuilt progressively and swapped in place
 */
export class ChunkManager {
  readonly group = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private list: Chunk[] = [];
  private queue: Chunk[] = [];
  private detailQueue: Chunk[] = [];
  private generation = 1;
  private meanGrid = new Map<string, number>();
  private ctx: GenCtx;
  private material = facadeMaterial();
  private excluded = new Set<number>();
  builtBuildings = 0;
  /** multiplies the detail radius (photo capture temporarily raises it) */
  detailBoost = 1;

  constructor(private data: CityData, private palette: StylePalette, private grid: CityGrid, params: Params, clearZones: { x: number; z: number; r: number }[]) {
    this.group.name = 'city-chunks';
    for (const b of data.buildings) {
      let skip = false;
      for (const zc of clearZones) { if ((b.cx - zc.x) ** 2 + (b.cz - zc.z) ** 2 < zc.r * zc.r) { skip = true; break; } }
      if (skip) { this.excluded.add(b.id); continue; }
      const ix = Math.floor(b.cx / CHUNK), iz = Math.floor(b.cz / CHUNK);
      const key = ix + ',' + iz;
      let c = this.chunks.get(key);
      if (!c) {
        c = { key, ix, iz, cx: (ix + 0.5) * CHUNK, cz: (iz + 0.5) * CHUNK, recs: [], maxH: 0, mesh: null, detail: null, gen: 0, detailGen: 0, queued: false, detailQueued: false, core: false, counted: false };
        this.chunks.set(key, c); this.list.push(c);
      }
      c.recs.push(b);
      c.maxH = Math.max(c.maxH, b.h);
      if (b.tier === 0) c.core = true;
    }
    // neighbourhood mean height (area weighted) on a 2x coarser grid
    const acc = new Map<string, [number, number]>();
    for (const b of data.buildings) {
      const k = Math.floor(b.cx / 800) + ',' + Math.floor(b.cz / 800);
      const a = acc.get(k) || [0, 0];
      a[0] += b.h * b.area; a[1] += b.area; acc.set(k, a);
    }
    acc.forEach((v, k) => this.meanGrid.set(k, v[0] / Math.max(v[1], 1)));
    this.ctx = { p: params, palette, meanH: this.meanH, isRoad: grid.isRoad };
  }

  private meanH = (x: number, z: number) => this.meanGrid.get(Math.floor(x / 800) + ',' + Math.floor(z / 800)) ?? 20;

  get chunkCount() { return this.list.length; }
  get pending() { return this.queue.length + this.detailQueue.length; }
  get totalBuildings() { return this.data.buildings.length - this.excluded.size; }

  /** Call when a city-generation parameter changed. */
  regenerate(params: Params) {
    this.ctx.p = params;
    this.generation++;
    this.palette.generate(params.seed, params.archVariation);
    // detail meshes were planned from the previous parameters: drop them now, they rebuild with their chunk
    for (const c of this.list) { this.dropDetail(c); c.detailGen = 0; }
  }
  /** Non-generation parameters apply at once; generation keys only change through regenerate(). */
  setParams(params: Params) {
    const cur = this.ctx.p;
    this.ctx.p = { ...params, heightScale: cur.heightScale, density: cur.density, skylineVariation: cur.skylineVariation, archVariation: cur.archVariation, seed: cur.seed };
  }

  private buildMass(c: Chunk) {
    const mb = new MeshBuilder(c.recs.length * 96);
    for (const rec of c.recs) {
      const plan = planBuilding(rec, this.ctx);
      emitMass(mb, plan, mulberry32((rec.id + 3) * 7919 + this.ctx.p.seed));
    }
    const old = c.mesh;
    if (!mb.empty) {
      const mesh = new THREE.Mesh(mb.build(), this.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      c.mesh = mesh;
      this.group.add(mesh);
    } else c.mesh = null;
    if (old) { this.group.remove(old); old.geometry.dispose(); }
    if (!c.counted) { c.counted = true; this.builtBuildings += c.recs.length; }
    c.gen = this.generation;
  }

  private buildDetail(c: Chunk) {
    const mb = new MeshBuilder(c.recs.length * 400);
    for (const rec of c.recs) {
      if (rec.tier === 2 && rec.h < 30) continue;
      emitDetail(mb, planBuilding(rec, this.ctx), this.ctx);
    }
    this.dropDetail(c);
    if (!mb.empty) {
      const mesh = new THREE.Mesh(mb.build(), this.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      c.detail = mesh;
      this.group.add(mesh);
    }
    c.detailGen = this.generation;
  }

  private dropDetail(c: Chunk) {
    if (c.detail) { this.group.remove(c.detail); c.detail.geometry.dispose(); c.detail = null; }
  }

  /**
   * Streaming update. `budgetMs` bounds the generation work done this frame.
   * Returns true while there is still work queued.
   */
  update(cam: THREE.Vector3, params: Params, budgetMs: number): boolean {
    const renderDist = params.renderDistance * 1000;
    const detailR = (260 + 900 * params.detailLevel) * params.lodBias * this.detailBoost;
    for (const c of this.list) {
      const dx = c.cx - cam.x, dz = c.cz - cam.z;
      const d = Math.hypot(dx, dz);
      // tall chunks stay visible further: the skyline must not pop
      const reach = renderDist * (c.maxH > 150 ? 1.6 : c.maxH > 60 ? 1.15 : 1);
      if (d < reach) {
        if (c.gen !== this.generation && !c.queued) { c.queued = true; this.queue.push(c); }
      } else if (d > reach * 1.18 && c.mesh) {
        this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; c.gen = 0;
        if (c.counted) { c.counted = false; this.builtBuildings -= c.recs.length; }
        this.dropDetail(c); c.detailGen = 0;
      }
      const dd = Math.hypot(d, Math.max(0, cam.y - c.maxH) * 0.8);
      if (dd < detailR + CHUNK * 0.7) {
        if (c.detailGen !== this.generation && !c.detailQueued && c.gen === this.generation) { c.detailQueued = true; this.detailQueue.push(c); }
      } else if (dd > detailR * 1.35 + CHUNK && c.detail) { this.dropDetail(c); c.detailGen = 0; }
    }
    const t0 = performance.now();
    if (this.queue.length) {
      const dist = (c: Chunk) => (c.cx - cam.x) ** 2 + (c.cz - cam.z) ** 2 - (c.core ? 4e6 : 0) - c.maxH * c.maxH * 40;
      this.queue.sort((a, b) => dist(b) - dist(a)); // nearest / most prominent last → pop()
      while (this.queue.length && performance.now() - t0 < budgetMs) {
        const c = this.queue.pop()!;
        c.queued = false;
        // the camera may have moved on since this chunk was queued
        if (Math.hypot(c.cx - cam.x, c.cz - cam.z) > renderDist * (c.maxH > 150 ? 1.6 : c.maxH > 60 ? 1.15 : 1) * 1.18) continue;
        this.buildMass(c);
      }
    }
    if (this.detailQueue.length && performance.now() - t0 < budgetMs) {
      const dist = (c: Chunk) => (c.cx - cam.x) ** 2 + (c.cz - cam.z) ** 2;
      this.detailQueue.sort((a, b) => dist(b) - dist(a));
      while (this.detailQueue.length && performance.now() - t0 < budgetMs) {
        const c = this.detailQueue.pop()!;
        c.detailQueued = false;
        if (c.gen === this.generation) this.buildDetail(c);
      }
    }
    return this.queue.length + this.detailQueue.length > 0;
  }

  /** Find the roof height at a point (max real building containing it); used for placing things on roofs. */
  dispose() {
    for (const c of this.list) { c.mesh?.geometry.dispose(); c.detail?.geometry.dispose(); }
    this.group.clear();
  }
}
