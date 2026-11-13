import * as THREE from 'three';

/**
 * Three-level instanced LOD for thousands of small repeated objects (cars, trees).
 * - every tile owns one InstancedMesh that swaps between a mid and a low geometry by distance;
 * - instances within `nearR` of the camera are copied into one shared high-detail InstancedMesh and hidden in their
 *   tile mesh through a per-instance `aHide` attribute (materials must honour it, see HIDE_VERT).
 * The near set is only rebuilt when the camera has moved a few metres; nothing is allocated per frame.
 */

/** Vertex snippet (after gl_Position is written) that drops instances flagged as hidden. */
export const HIDE_PARS = 'attribute float aHide;';
export const HIDE_VERT = 'if (aHide > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);';

/** Depth material for shadow casting that honours aHide plus an optional extra vertex snippet. */
export function hideDepthMaterial(key: string, extra?: { pars?: string; begin?: string; uniforms?: Record<string, THREE.IUniform> }) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, extra?.uniforms || {});
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${HIDE_PARS}\n${extra?.pars || ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${extra?.begin || ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${HIDE_VERT}`);
  };
  m.customProgramCacheKey = () => 'hideDepth:' + key;
  return m;
}

export interface LodItem { m: THREE.Matrix4; c: THREE.Color; a?: number }

interface LodTile { cx: number; cz: number; start: number; end: number; mesh: THREE.InstancedMesh; hide: THREE.InstancedBufferAttribute; gMid: THREE.BufferGeometry; gLo: THREE.BufferGeometry; dirty: boolean }

export interface LodOptions {
  items: LodItem[];
  hi: THREE.BufferGeometry; mid: THREE.BufferGeometry; lo: THREE.BufferGeometry;
  material: THREE.Material; depthMaterial?: THREE.Material;
  tile: number; nearR: number; midR: number; capacity: number;
  /** name of an optional per-instance float attribute filled from LodItem.a */
  attr?: string;
  /** hide tiles beyond the update range (street props) or keep them all (trees on the skyline) */
  cull: boolean;
  castShadow?: boolean;
}

const wrap = (base: THREE.BufferGeometry, extra: Record<string, THREE.BufferAttribute>) => {
  const g = new THREE.BufferGeometry();
  for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
  for (const k of Object.keys(extra)) g.setAttribute(k, extra[k]);
  g.setIndex(base.index);
  g.boundingSphere = base.boundingSphere;
  g.boundingBox = base.boundingBox;
  return g;
};

export class LodField {
  readonly group = new THREE.Group();
  private tiles: LodTile[] = [];
  private px: Float32Array; private pz: Float32Array;
  private hidden: Uint8Array;
  private near: THREE.InstancedMesh;
  private nearAttr: THREE.InstancedBufferAttribute | null = null;
  private last = new THREE.Vector3(1e9, 0, 0);
  private items: LodItem[];
  private o: LodOptions;

  constructor(o: LodOptions) {
    this.o = o;
    for (const g of [o.hi, o.mid, o.lo]) { if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox(); }
    // bucket items by tile so each tile owns a contiguous range
    const buckets = new Map<string, LodItem[]>();
    const v = new THREE.Vector3();
    for (const it of o.items) {
      v.setFromMatrixPosition(it.m);
      const k = Math.floor(v.x / o.tile) + ',' + Math.floor(v.z / o.tile);
      let b = buckets.get(k);
      if (!b) { b = []; buckets.set(k, b); }
      b.push(it);
    }
    this.items = [];
    for (const b of buckets.values()) for (const it of b) this.items.push(it);
    const N = this.items.length;
    this.px = new Float32Array(N); this.pz = new Float32Array(N); this.hidden = new Uint8Array(N);
    this.items.forEach((it, i) => { v.setFromMatrixPosition(it.m); this.px[i] = v.x; this.pz[i] = v.z; });
    let start = 0;
    for (const [k, b] of buckets) {
      const [ix, iz] = k.split(',').map(Number);
      const hide = new THREE.InstancedBufferAttribute(new Float32Array(b.length), 1);
      const extra: Record<string, THREE.BufferAttribute> = { aHide: hide };
      if (o.attr) extra[o.attr] = new THREE.InstancedBufferAttribute(new Float32Array(b.map((it) => it.a ?? 0)), 1);
      const gMid = wrap(o.mid, extra), gLo = wrap(o.lo, extra);
      const mesh = new THREE.InstancedMesh(gLo, o.material, b.length);
      b.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.c); });
      mesh.castShadow = o.castShadow ?? true; mesh.receiveShadow = true;
      if (o.depthMaterial) mesh.customDepthMaterial = o.depthMaterial;
      mesh.computeBoundingSphere();
      // the bounding sphere must also enclose the larger mid geometry
      mesh.boundingSphere!.radius += Math.max(o.mid.boundingSphere!.radius, o.hi.boundingSphere!.radius);
      mesh.visible = !o.cull;
      this.group.add(mesh);
      this.tiles.push({ cx: (ix + 0.5) * o.tile, cz: (iz + 0.5) * o.tile, start, end: start + b.length, mesh, hide, gMid, gLo, dirty: false });
      start += b.length;
    }
    // shared near-camera high-detail set
    const extra: Record<string, THREE.BufferAttribute> = { aHide: new THREE.InstancedBufferAttribute(new Float32Array(o.capacity), 1) };
    if (o.attr) { this.nearAttr = new THREE.InstancedBufferAttribute(new Float32Array(o.capacity), 1); this.nearAttr.setUsage(THREE.DynamicDrawUsage); extra[o.attr] = this.nearAttr; }
    this.near = new THREE.InstancedMesh(wrap(o.hi, extra), o.material, o.capacity);
    this.near.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.near.setColorAt(0, new THREE.Color());
    this.near.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.near.count = 0;
    this.near.frustumCulled = false;
    this.near.castShadow = o.castShadow ?? true; this.near.receiveShadow = true;
    if (o.depthMaterial) this.near.customDepthMaterial = o.depthMaterial;
    this.group.add(this.near);
  }

  get count() { return this.items.length; }

  update(cam: THREE.Vector3, range: number) {
    const o = this.o;
    const reach = o.tile * 0.75;
    for (const t of this.tiles) {
      const d = Math.hypot(t.cx - cam.x, t.cz - cam.z, cam.y * 0.8);
      const vis = !o.cull || d < range + reach;
      if (t.mesh.visible !== vis) t.mesh.visible = vis;
      const g = d < o.midR + reach ? t.gMid : t.gLo;
      if (t.mesh.geometry !== g) { t.mesh.geometry = g; if (o.castShadow ?? true) t.mesh.castShadow = g === t.gMid; }
    }
    // rebuild the near set when the camera has moved
    const nearOn = cam.y < o.nearR * 1.5;
    if (!nearOn) {
      if (this.near.count > 0) this.clearNear();
      return;
    }
    if (cam.distanceToSquared(this.last) < 9) return;
    this.last.copy(cam);
    const R2 = o.nearR * o.nearR - cam.y * cam.y;
    let n = 0;
    for (const t of this.tiles) {
      const dx = Math.max(0, Math.abs(t.cx - cam.x) - o.tile / 2), dz = Math.max(0, Math.abs(t.cz - cam.z) - o.tile / 2);
      const touch = dx * dx + dz * dz < o.nearR * o.nearR;
      if (!touch) {
        // release anything still hidden in a tile that left the near zone
        if (t.dirty) { t.hide.array.fill(0); t.hide.needsUpdate = true; t.dirty = false; for (let i = t.start; i < t.end; i++) this.hidden[i] = 0; }
        continue;
      }
      const ha = t.hide.array as Float32Array;
      let changed = false;
      for (let i = t.start; i < t.end; i++) {
        const ddx = this.px[i] - cam.x, ddz = this.pz[i] - cam.z;
        const inside = R2 > 0 && ddx * ddx + ddz * ddz < R2 && n < o.capacity;
        if (inside) {
          const it = this.items[i];
          this.near.setMatrixAt(n, it.m);
          this.near.setColorAt(n, it.c);
          if (this.nearAttr) (this.nearAttr.array as Float32Array)[n] = it.a ?? 0;
          n++;
        }
        const h = inside ? 1 : 0;
        if (this.hidden[i] !== h) { this.hidden[i] = h; ha[i - t.start] = h; changed = true; }
      }
      if (changed) { t.hide.needsUpdate = true; t.dirty = true; }
    }
    this.near.count = n;
    this.near.instanceMatrix.needsUpdate = true;
    this.near.instanceColor!.needsUpdate = true;
    if (this.nearAttr) this.nearAttr.needsUpdate = true;
  }

  private clearNear() {
    this.near.count = 0;
    this.last.set(1e9, 0, 0);
    for (const t of this.tiles) if (t.dirty) { t.hide.array.fill(0); t.hide.needsUpdate = true; t.dirty = false; for (let i = t.start; i < t.end; i++) this.hidden[i] = 0; }
  }
}
