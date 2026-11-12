import { useEffect } from 'react';
import { useStore } from '../state/store';
import { BOOKMARKS } from '../state/presets';
import { closePreview, doCapture, goBookmark } from './actions';

/** Global keyboard shortcuts. Movement keys (WASD/QE/arrows/space/shift) belong to the engine. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t?.isContentEditable;
      // sliders (type=range) should still allow shortcuts except Tab handling below
      const textual = typing && !(tag === 'INPUT' && (t as HTMLInputElement).type === 'range');
      if (e.key === 'Escape') {
        const st = useStore.getState();
        if (st.capture.previewUrl) closePreview();
        else if (st.showHelp) st.ui({ showHelp: false });
        else if (st.photoMode) st.ui({ photoMode: false });
        if (typing) (t as HTMLElement).blur();
        return;
      }
      if (textual) return;
      const st = useStore.getState();
      const key = e.key.toLowerCase();
      switch (key) {
        case 'h': st.ui({ uiHidden: !st.uiHidden }); break;
        case 'p': st.ui({ photoMode: !st.photoMode }); break;
        case 'tab':
          if (t?.closest('.panel, .modal, .help, .photobar')) return; // keep native focus order inside UI
          e.preventDefault();
          st.ui({ panelOpen: !st.panelOpen });
          break;
        case 'f': st.ui({ cameraMode: st.cameraMode === 'orbit' ? 'fly' : 'orbit' }); break;
        case 'c': doCapture(false); break;
        case '?': st.ui({ showHelp: !st.showHelp }); break;
        default:
          if (/^[1-9]$/.test(key)) {
            const b = BOOKMARKS[Number(key) - 1];
            if (b) goBookmark(b.id);
          } else return;
      }
      if (key !== 'tab') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
