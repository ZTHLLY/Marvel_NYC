import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { IconClose, IconDownload } from './icons';
import { closePreview } from './actions';

/* -------------------------------------------------------------- Loading */
export function LoadingScreen() {
  const loading = useStore((s) => s.loading);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!loading.done) { setGone(false); return; }
    const t = setTimeout(() => setGone(true), 1100);
    return () => clearTimeout(t);
  }, [loading.done]);
  if (gone) return null;
  const pct = Math.round(Math.min(1, Math.max(0, loading.progress)) * 100);
  return (
    <div className={'loading' + (loading.done ? ' done' : '')} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Loading">
      <div className="loading-inner">
        <div className="ld-eyebrow">Marvel Universe</div>
        <h1 className="ld-title">New York</h1>
        <div className="ld-rule"><i /></div>
        <div className="ld-sub">Cinematic City Forge</div>
        <div className="ld-bar"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
        <div className="ld-meta"><span>{loading.label}</span><span className="mono">{pct}%</span></div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- Capture modal */
export function CaptureModal() {
  const { previewUrl, previewName, previewSize } = useStore((s) => s.capture);
  if (!previewUrl) return null;
  return (
    <div className="modal-back ui-hit" onClick={closePreview}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Capture preview" onClick={(e) => e.stopPropagation()}>
        <div className="modal-img"><img src={previewUrl} alt={previewName || 'Captured wallpaper'} /></div>
        <div className="modal-bar">
          <div className="modal-meta"><b>{previewName}</b><span className="mono">{previewSize}</span></div>
          <a className="btn btn-primary" href={previewUrl} download={previewName || 'nyc-in-marvel-universe.png'}><IconDownload /> Download</a>
          <button type="button" className="btn btn-ghost" autoFocus onClick={closePreview}><IconClose /> Close</button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Help */
const SEEN = 'cityforge.helpSeen.v1';

export function FirstRunHelp() {
  const done = useStore((s) => s.loading.done);
  useEffect(() => {
    if (!done) return;
    try {
      if (localStorage.getItem(SEEN)) return;
      localStorage.setItem(SEEN, '1');
    } catch { /* ignore */ }
    const t = setTimeout(() => useStore.getState().ui({ showHelp: true }), 1200);
    return () => clearTimeout(t);
  }, [done]);
  return null;
}

const K = ({ children }: { children: string }) => <kbd>{children}</kbd>;

export function HelpOverlay() {
  const show = useStore((s) => s.showHelp);
  if (!show) return null;
  const close = () => useStore.getState().ui({ showHelp: false });
  return (
    <div className="modal-back ui-hit" onClick={close}>
      <div className="help" role="dialog" aria-modal="true" aria-label="Controls and shortcuts" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Navigating the city</h2>
          <button type="button" className="icon-btn" aria-label="Close help" onClick={close} autoFocus><IconClose /></button>
        </header>
        <div className="help-cols">
          <section>
            <h3>Orbit camera</h3>
            <dl>
              <dt>Left-drag</dt><dd>Rotate</dd>
              <dt>Right-drag / <K>Shift</K>-drag</dt><dd>Pan</dd>
              <dt>Wheel</dt><dd>Zoom</dd>
              <dt>Double-click</dt><dd>Set focus point</dd>
            </dl>
          </section>
          <section>
            <h3>Free-fly camera</h3>
            <dl>
              <dt><K>W</K><K>A</K><K>S</K><K>D</K></dt><dd>Move</dd>
              <dt><K>Q</K> / <K>E</K></dt><dd>Down / up</dd>
              <dt>Drag</dt><dd>Look around</dd>
              <dt><K>Shift</K></dt><dd>Fast</dd>
              <dt>Wheel</dt><dd>Change speed</dd>
            </dl>
          </section>
          <section className="wide">
            <h3>Shortcuts</h3>
            <dl className="two">
              <dt><K>H</K></dt><dd>Hide interface</dd>
              <dt><K>P</K></dt><dd>Photography mode</dd>
              <dt><K>Tab</K></dt><dd>Toggle panel</dd>
              <dt><K>F</K></dt><dd>Orbit / fly</dd>
              <dt><K>1</K>…<K>9</K></dt><dd>Bookmarks</dd>
              <dt><K>C</K></dt><dd>Capture</dd>
              <dt><K>?</K></dt><dd>This help</dd>
              <dt><K>Esc</K></dt><dd>Exit photo mode / close</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
