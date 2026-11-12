import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DEFAULT_PARAMS, Params, QUALITY_PRESETS, WEATHER_PRESETS, sunFromTime, GroupId, WeatherKind, QualityKind, CONTROL_SCHEMA,
} from './params';
import { SCENE_PRESETS } from './presets';

export type CameraMode = 'orbit' | 'fly';

export interface CamReadout { x: number; y: number; z: number; heading: number; pitch: number; roll: number }

export interface AppState {
  params: Params;
  // ui
  panelOpen: boolean;
  photoMode: boolean;
  uiHidden: boolean;
  activeGroup: GroupId | 'presets';
  cameraMode: CameraMode;
  showHelp: boolean;
  loading: { progress: number; label: string; done: boolean };
  fps: number;
  stats: { buildings: number; chunks: number; drawCalls: number; triangles: number };
  cam: CamReadout;
  capture: { busy: boolean; message: string; previewUrl: string | null; previewName: string; previewSize: string };
  userPresets: Record<string, Params>;
  activePreset: string | null;
  activeBookmark: string | null;
  // actions
  set: <K extends keyof Params>(key: K, value: Params[K]) => void;
  patch: (p: Partial<Params>) => void;
  applyScenePreset: (id: string) => void;
  resetParams: () => void;
  saveUserPreset: (name: string) => void;
  loadUserPreset: (name: string) => void;
  deleteUserPreset: (name: string) => void;
  importParams: (json: string) => boolean;
  ui: (p: Partial<Omit<AppState, 'params'>>) => void;
}

const LS_PARAMS = 'cityforge.params.v1';
const LS_USER = 'cityforge.userPresets.v1';

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

const SCHEMA_BY_KEY = new Map(CONTROL_SCHEMA.map((c) => [c.key, c]));

/**
 * Validate & merge an arbitrary object (pasted JSON, localStorage) onto defaults.
 * Unknown keys and wrong types are dropped; numbers are clamped to their slider range and
 * choices must be one of the declared options, so bad input can never reach the renderer.
 */
export function sanitizeParams(obj: unknown): Params {
  const out: Params = { ...DEFAULT_PARAMS };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const k of Object.keys(DEFAULT_PARAMS) as (keyof Params)[]) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    let v = (obj as Record<string, unknown>)[k];
    if (typeof v !== typeof DEFAULT_PARAMS[k]) continue;
    const def = SCHEMA_BY_KEY.get(k);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;
      if (def?.options) { if (!def.options.some((o) => o.value === v)) continue; }
      else if (def && def.min !== undefined && def.max !== undefined) v = Math.min(def.max, Math.max(def.min, v));
    } else if (typeof v === 'string') {
      if (!def?.options || !def.options.some((o) => o.value === v)) continue;
    }
    (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);
/** A user preset name is trimmed, length-limited and may not shadow Object.prototype members. */
export function cleanPresetName(name: string): string | null {
  const n = String(name).trim().slice(0, 48);
  return n && !RESERVED_NAMES.has(n) ? n : null;
}

function loadUserPresets(): Record<string, Params> {
  const raw = loadJSON<unknown>(LS_USER, {});
  const out: Record<string, Params> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = cleanPresetName(k);
      if (n) out[n] = sanitizeParams(v);
    }
  }
  return out;
}

const urlFresh = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fresh');
const initialParams = urlFresh ? { ...DEFAULT_PARAMS } : sanitizeParams(loadJSON(LS_PARAMS, DEFAULT_PARAMS));

export const useStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    params: initialParams,
    panelOpen: true,
    photoMode: false,
    uiHidden: false,
    activeGroup: 'presets',
    cameraMode: 'orbit',
    showHelp: false,
    loading: { progress: 0, label: 'Surveying Manhattan…', done: false },
    fps: 0,
    stats: { buildings: 0, chunks: 0, drawCalls: 0, triangles: 0 },
    cam: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 },
    capture: { busy: false, message: '', previewUrl: null, previewName: '', previewSize: '' },
    userPresets: loadUserPresets(),
    activePreset: null,
    activeBookmark: null,

    set: (key, value) => {
      const p: Partial<Params> = { [key]: value } as Partial<Params>;
      if (key === 'timeOfDay') p.sunElevation = Math.round(sunFromTime(value as number).el * 4) / 4;
      if (key === 'weather') Object.assign(p, WEATHER_PRESETS[value as WeatherKind]);
      if (key === 'quality') Object.assign(p, QUALITY_PRESETS[value as QualityKind]);
      set((s) => ({ params: { ...s.params, ...p }, activePreset: null }));
    },
    patch: (p) => set((s) => ({ params: { ...s.params, ...p } })),
    applyScenePreset: (id) => {
      const preset = SCENE_PRESETS.find((x) => x.id === id);
      if (!preset) return;
      const cur = get().params;
      // presets never touch city-generation or performance settings
      set({ params: { ...cur, ...preset.params }, activePreset: id, activeBookmark: preset.bookmark });
      bus.emit('bookmark', preset.bookmark);
    },
    resetParams: () => set((s) => ({
      params: { ...DEFAULT_PARAMS, quality: s.params.quality, ...QUALITY_PRESETS[s.params.quality] }, activePreset: null,
    })),
    saveUserPreset: (rawName) => {
      const name = cleanPresetName(rawName);
      if (!name) return;
      const userPresets = { ...get().userPresets, [name]: { ...get().params } };
      set({ userPresets });
      try { localStorage.setItem(LS_USER, JSON.stringify(userPresets)); } catch { /* ignore quota */ }
    },
    loadUserPreset: (name) => {
      const p = Object.prototype.hasOwnProperty.call(get().userPresets, name) ? get().userPresets[name] : null;
      if (p) set({ params: sanitizeParams(p), activePreset: null });
    },
    deleteUserPreset: (name) => {
      const userPresets = { ...get().userPresets };
      delete userPresets[name];
      set({ userPresets });
      try { localStorage.setItem(LS_USER, JSON.stringify(userPresets)); } catch { /* ignore */ }
    },
    importParams: (json) => {
      try {
        set({ params: sanitizeParams(JSON.parse(json)), activePreset: null });
        return true;
      } catch { return false; }
    },
    ui: (p) => set(p as Partial<AppState>),
  })),
);

// persist params (debounced)
let persistTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s) => s.params, (params) => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { localStorage.setItem(LS_PARAMS, JSON.stringify(params)); } catch { /* ignore */ }
  }, 400);
});

// ---- command bus: UI → engine imperative commands --------------------------------
export interface BusEvents {
  bookmark: string;                 // fly to cinematic bookmark id
  focus: string;                    // landmark focus (site id)
  capture: { preview: boolean };    // photography export
  setCamera: Partial<CamReadout>;   // manual camera position / rotation
  resetCamera: undefined;
}
type Handler<T> = (payload: T) => void;
class Bus {
  private handlers = new Map<string, Set<Handler<any>>>();
  on<K extends keyof BusEvents>(ev: K, fn: Handler<BusEvents[K]>) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
    return () => this.handlers.get(ev)!.delete(fn);
  }
  emit<K extends keyof BusEvents>(ev: K, payload: BusEvents[K]) {
    this.handlers.get(ev)?.forEach((fn) => fn(payload));
  }
}
export const bus = new Bus();
