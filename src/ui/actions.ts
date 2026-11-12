import { create } from 'zustand';
import { bus, useStore } from '../state/store';
import { BOOKMARKS } from '../state/presets';
import type { Params } from '../state/params';

/** UI-only local state (not part of the shared contract). */
export const useUiLocal = create<{ matchLight: boolean; setMatchLight: (v: boolean) => void }>((set) => ({
  matchLight: true,
  setMatchLight: (matchLight) => set({ matchLight }),
}));

export function setParam(key: keyof Params, value: unknown): void {
  (useStore.getState().set as (k: keyof Params, v: unknown) => void)(key, value);
}

export function goBookmark(id: string): void {
  const b = BOOKMARKS.find((x) => x.id === id);
  if (!b) return;
  const st = useStore.getState();
  if (b.preset && useUiLocal.getState().matchLight) st.applyScenePreset(b.preset);
  st.ui({ activeBookmark: id });
  bus.emit('bookmark', id);
}

export function doCapture(preview: boolean): void {
  if (useStore.getState().capture.busy) return;
  bus.emit('capture', { preview });
}

export function closePreview(): void {
  const { capture, ui } = useStore.getState();
  const url = capture.previewUrl;
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  ui({ capture: { ...capture, previewUrl: null } });
}

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
