import { aveOf, CROSSTOWN, RoadRec, streetOf, UPTOWN } from './geo';
import { hash2 } from '../util/rng';

/**
 * Street network helpers shared by the road / sidewalk meshes (ground.ts, sidewalks.ts) and the street props, so
 * kerb lines, crossings, stop bars, traffic direction and furniture all agree with each other.
 */

/** Roads that get raised sidewalks and kerbs: Manhattan surface streets. */
export const hasSidewalk = (r: RoadRec) => r.b === 1 && r.t === 1;
/** Flat sidewalk width (kerb face → start of the ramp), metres. Wider avenues get wider sidewalks. */
export const swFlat = (halfW: number) => Math.min(4.6, Math.max(3.0, 2.4 + halfW * 0.25));
/** The back ramp that returns the slab to grade so plazas never show a step. */
export const SW_RAMP = 2.4;

/** Two-way streets: Manhattan's wide crosstown streets and Park Avenue. Everything else runs one-way. */
const TWO_WAY = /^(PARK AVE|W 42 ST|E 42 ST|W 34 ST|E 34 ST|W 57 ST|E 57 ST|W 14 ST|E 14 ST|W 23 ST|E 23 ST)$/;
/** +1: traffic flows from the first to the last point, -1: the reverse, 0: two-way (right-hand traffic). */
export function roadDir(r: RoadRec): number {
  if (r.n && TWO_WAY.test(r.n)) return 0;
  // whole avenues / streets share one direction (even streets run east, odd west; avenues alternate)
  const n = r.pts.length / 2, mx = (r.pts[0] + r.pts[n * 2 - 2]) / 2, mz = (r.pts[1] + r.pts[n * 2 - 1]) / 2;
  const dx = r.pts[n * 2 - 2] - r.pts[0], dz = r.pts[n * 2 - 1] - r.pts[1];
  const up = dx * UPTOWN[0] + dz * UPTOWN[1], east = dx * CROSSTOWN[0] + dz * CROSSTOWN[1];
  if (r.b !== 1 || Math.hypot(dx, dz) < 1) return hash2(Math.round(r.pts[0]), Math.round(r.pts[1])) < 0.5 ? 1 : -1;
  if (Math.abs(up) > Math.abs(east)) return (hash2(Math.round(aveOf(mx, mz) / 40), 3) < 0.5 ? 1 : -1) * Math.sign(up);
  return (Math.round(streetOf(mx, mz)) % 2 === 0 ? 1 : -1) * Math.sign(east);
}

interface NodeEntry { ri: number; halfW: number; dx: number; dz: number; sw: boolean }

export interface Junctions {
  /**
   * Distance along road `ri` (from end `end`: 0 = first point, 1 = last point) before which side `side` (+1 = left of
   * the first→last direction, i.e. the +x side of the road's aRUv) must not be paved because another roadway crosses.
   * `cap` is true when that end faces an open crossing roadway (a kerb face is needed there).
   */
  sidewalkStart(ri: number, end: 0 | 1, side: 1 | -1): { s: number; cap: boolean };
  /** Distance from the end where the crossing roadway's kerb line meets this roadway (-1 if no junction). */
  roadInset(ri: number, end: 0 | 1): number;
  /** number of road ends meeting at this end's node */
  degree(ri: number, end: 0 | 1): number;
  /** index of the widest road crossing this end's node (-1 if none) */
  crossRoad(ri: number, end: 0 | 1): number;
}

export function analyseJunctions(roads: RoadRec[]): Junctions {
  const key = (x: number, z: number) => `${Math.round(x / 1.5)},${Math.round(z / 1.5)}`;
  const nodes = new Map<string, NodeEntry[]>();
  const endDir = (r: RoadRec, end: 0 | 1) => {
    const n = r.pts.length / 2;
    const a = end === 0 ? 0 : n - 1;
    // direction pointing away from the node into the road; look a few metres in to ignore tiny kinks
    let b = end === 0 ? 1 : n - 2;
    let dx = r.pts[b * 2] - r.pts[a * 2], dz = r.pts[b * 2 + 1] - r.pts[a * 2 + 1];
    while (Math.hypot(dx, dz) < 4 && b > 0 && b < n - 1) {
      b += end === 0 ? 1 : -1;
      dx = r.pts[b * 2] - r.pts[a * 2]; dz = r.pts[b * 2 + 1] - r.pts[a * 2 + 1];
    }
    const L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  };
  roads.forEach((r, ri) => {
    const n = r.pts.length / 2;
    for (const end of [0, 1] as const) {
      const p = end === 0 ? 0 : n - 1;
      const k = key(r.pts[p * 2], r.pts[p * 2 + 1]);
      let list = nodes.get(k);
      if (!list) { list = []; nodes.set(k, list); }
      const [dx, dz] = endDir(r, end);
      list.push({ ri, halfW: r.w / 2, dx, dz, sw: hasSidewalk(r) });
    }
  });
  const nodeOf = (ri: number, end: 0 | 1) => {
    const r = roads[ri], n = r.pts.length / 2, p = end === 0 ? 0 : n - 1;
    return nodes.get(key(r.pts[p * 2], r.pts[p * 2 + 1]))!;
  };
  const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;
  const halfFor = (me: NodeEntry, c: NodeEntry) => {
    // the more important road keeps its sidewalk running to the other road's kerb line; the lesser one yields to it
    const pri = c.halfW > me.halfW + 0.01 || (Math.abs(c.halfW - me.halfW) <= 0.01 && c.ri < me.ri);
    return { h: c.halfW + (pri && c.sw ? swFlat(c.halfW) : 0), yield: pri && c.sw };
  };
  // s at which the band |cross(c, q)| < h is cleared for lateral offsets o0..o1 on the given side
  const clear = (me: NodeEntry, c: NodeEntry, nx: number, nz: number, o0: number, o1: number, h: number) => {
    const A = cross(c.dx, c.dz, me.dx, me.dz), B = cross(c.dx, c.dz, nx, nz);
    if (Math.abs(A) < 0.25) return 0;
    const sg = Math.sign(A), a = Math.abs(A);
    return Math.max((h - sg * B * o0) / a, (h - sg * B * o1) / a);
  };
  const entryOf = (list: NodeEntry[], ri: number, end: 0 | 1) => {
    const own = list.filter((e) => e.ri === ri);
    return own.length > 1 ? own[end] : own[0];
  };
  return {
    degree: (ri, end) => nodeOf(ri, end).length,
    crossRoad(ri, end) {
      const list = nodeOf(ri, end), me = entryOf(list, ri, end);
      let best = -1, bw = -1;
      for (const c of list) {
        if (c === me || c.ri === ri) continue;
        if (Math.abs(c.dx * me.dx + c.dz * me.dz) > 0.85) continue;
        if (c.halfW > bw) { bw = c.halfW; best = c.ri; }
      }
      return best;
    },
    sidewalkStart(ri, end, side) {
      const list = nodeOf(ri, end);
      if (list.length < 3) return { s: 0, cap: false };
      const me = entryOf(list, ri, end);
      // world normal of the requested side: side +1 is the left of the road's first→last direction
      const tx = end === 0 ? me.dx : -me.dx, tz = end === 0 ? me.dz : -me.dz;
      const nx = -tz * side, nz = tx * side;
      const o0 = me.halfW, o1 = me.halfW + swFlat(me.halfW) + SW_RAMP;
      let s = 0, cap = false;
      for (const c of list) {
        if (c === me) continue;
        const dot = c.dx * me.dx + c.dz * me.dz;
        if (dot < -0.9) continue;                                 // straight continuation of this street
        if (c.dx * nx + c.dz * nz < 0.15) continue;               // crossing road leaves on the other side
        const { h, yield: y } = halfFor(me, c);
        const v = clear(me, c, nx, nz, o0, o1, h);
        if (v > s) { s = v; cap = !y; }
      }
      return { s: Math.min(s, 60), cap };
    },
    roadInset(ri, end) {
      const list = nodeOf(ri, end);
      if (list.length < 3) return -1;
      const me = entryOf(list, ri, end);
      const nx = -me.dz, nz = me.dx;
      let s = 0;
      for (const c of list) {
        if (c === me) continue;
        if (c.dx * me.dx + c.dz * me.dz < -0.9) continue;
        s = Math.max(s, clear(me, c, nx, nz, -me.halfW, me.halfW, c.halfW));
      }
      return Math.min(s, 40);
    },
  };
}

/** Travel-lane layout shared by the road shader and the traffic props. */
export function laneLayout(halfW: number, dir: number) {
  const drive = halfW - 2.2;
  let lanes = Math.max(1, Math.round((halfW * 2 - 4.4) / 3.3));
  if (dir === 0) lanes = Math.max(2, 2 * Math.round(lanes / 2));
  return { lanes, drive };
}

/** Kerbside lane treatment: 0 parking both sides, 1 red bus lane on the +x (right-hand) kerb, 2 green bike lane on the -x kerb. */
export function laneKind(r: RoadRec): number {
  if (r.t !== 1 || r.w < 15) return 0;
  // keyed on the avenue / street line rather than the block so a treatment runs continuously
  const n = r.pts.length / 2, mx = (r.pts[0] + r.pts[n * 2 - 2]) / 2, mz = (r.pts[1] + r.pts[n * 2 - 1]) / 2;
  const dx = r.pts[n * 2 - 2] - r.pts[0], dz = r.pts[n * 2 - 1] - r.pts[1];
  const alongAve = Math.abs(dx * UPTOWN[0] + dz * UPTOWN[1]) > Math.abs(dx * CROSSTOWN[0] + dz * CROSSTOWN[1]);
  const h = alongAve ? hash2(Math.round(aveOf(mx, mz) / 40), 7) : hash2(Math.round(streetOf(mx, mz)), 13);
  return h < 0.22 ? 1 : h < 0.42 ? 2 : 0;
}

const netCache = new WeakMap<RoadRec[], { roads: RoadRec[]; J: Junctions }>();
/** The paved network (bridges excluded) and its junction analysis, computed once per data set. */
export function streetNet(all: RoadRec[]) {
  let c = netCache.get(all);
  if (!c) {
    const roads = all.filter((r) => r.t !== 3 && r.pts.length >= 4);
    c = { roads, J: analyseJunctions(roads) };
    netCache.set(all, c);
  }
  return c;
}

/** Street-tree positions (distance along the road) on one side; the trees and the furniture both use this. */
export const TREE_W = 1.05;   // tree-pit centre, metres from the kerb face
export function treeSlots(r: RoadRec, side: number, s0: number, s1: number): number[] {
  const rh = hash2(Math.round(r.pts[0] * 3), Math.round(r.pts[1] * 3) + 17);
  if (r.w > 14.5 || rh < 0.28) return [];
  const out: number[] = [];
  const key = Math.floor(rh * 1e6);
  let s = s0 + 4.5 + 3 * hash2(key, side + 3);
  for (let k = 0; s < s1 - 3.5; k++) {
    if (hash2(key + k * 7, side + 11) > 0.28) out.push(s);
    s += 7.5 + 3.5 * hash2(k, key + side);
  }
  return out;
}

/** sidewalk extent along road `ri` (index into streetNet().roads) for one side */
export function sidewalkRange(net: { roads: RoadRec[]; J: Junctions }, ri: number, side: 1 | -1, len: number) {
  const a = net.J.sidewalkStart(ri, 0, side), b = net.J.sidewalkStart(ri, 1, side);
  return { s0: a.s, s1: len - b.s, cap0: a.cap, cap1: b.cap };
}
