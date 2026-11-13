import { memo, useRef } from 'react';
import type { ReactElement } from 'react';
import { useStore } from '../state/store';
import { BOOKMARKS } from '../state/presets';
import type { AppState, CameraMode } from '../state/store';
import { IconCamera, IconEyeOff, IconFly, IconHelp, IconOrbit, IconPanel } from './icons';
import { goBookmark, useUiLocal } from './actions';

const ui = (p: Partial<Omit<AppState, 'params'>>) => useStore.getState().ui(p);

/* ---------------------------------------------------------------- FPS */
const FpsReadout = memo(function FpsReadout() {
  const fps = useStore((s) => s.fps);
  const stats = useStore((s) => s.stats);
  const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
  return (
    <div className="fps" aria-label="Performance statistics">
      <b>{Math.round(fps)}</b><span>FPS</span>
      <i />
      <span>{fmt(stats.buildings)} bldg</span>
      <span>{fmt(stats.drawCalls)} calls</span>
      <span>{fmt(stats.triangles)} tris</span>
    </div>
  );
});

export function FpsGate() {
  const show = useStore((s) => s.params.showFps);
  return show ? <FpsReadout /> : null;
}

/* ------------------------------------------------------------- Top bar */
export function TopBar() {
  const mode = useStore((s) => s.cameraMode);
  const panelOpen = useStore((s) => s.panelOpen);
  const modes: { id: CameraMode; label: string; icon: ReactElement }[] = [
    { id: 'orbit', label: 'Orbit', icon: <IconOrbit /> },
    { id: 'fly', label: 'Free Fly', icon: <IconFly /> },
  ];
  return (
    <header className="topbar">
      <div className="wordmark ui-hit">
        <span className="wm-mark" aria-hidden="true" />
        <span className="wm-text"><b>NYC</b><em>in Marvel Universe</em></span>
      </div>

      <div className="seg seg-top ui-hit" role="radiogroup" aria-label="Camera mode">
        {modes.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => ui({ cameraMode: m.id })}>
            {m.icon}<span>{m.label}</span>
          </button>
        ))}
      </div>

      <div className="tb-right ui-hit">
        <button type="button" className="btn btn-primary" onClick={() => ui({ photoMode: true })}>
          <IconCamera /><span className="lbl">Photography Mode</span>
        </button>
        <button type="button" className="icon-btn" title="Hide interface (H)" aria-label="Hide interface" onClick={() => ui({ uiHidden: true })}><IconEyeOff /></button>
        <button type="button" className="icon-btn" title="Help (?)" aria-label="Help" onClick={() => ui({ showHelp: true })}><IconHelp /></button>
        <button type="button" className={'icon-btn' + (panelOpen ? ' on' : '')} title="Toggle panel (Tab)" aria-label="Toggle panel" aria-pressed={panelOpen} onClick={() => ui({ panelOpen: !panelOpen })}><IconPanel /></button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------- Bookmark bar */
export function BookmarkBar() {
  const active = useStore((s) => s.activeBookmark);
  const match = useUiLocal((s) => s.matchLight);
  const setMatch = useUiLocal((s) => s.setMatchLight);
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <nav className="bookmarks ui-hit" aria-label="Cinematic bookmarks">
      <div className="bm-scroll" ref={scroller} onWheel={(e) => { if (scroller.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) scroller.current.scrollLeft += e.deltaY; }}>
        {BOOKMARKS.map((b, i) => (
          <button key={b.id} type="button" className={'chip' + (active === b.id ? ' on' : '')} aria-pressed={active === b.id} onClick={() => goBookmark(b.id)}>
            <span className="chip-n">{i + 1}</span>
            <span className="chip-l">{b.label}</span>
            <span className="chip-tip" role="tooltip">{b.caption}</span>
          </button>
        ))}
      </div>
      <button type="button" className={'match' + (match ? ' on' : '')} role="switch" aria-checked={match} onClick={() => setMatch(!match)} title="Apply the matching light preset when jumping to a bookmark">
        <IconSunDot /> Match light
      </button>
    </nav>
  );
}

function IconSunDot() {
  return <span className="match-dot" aria-hidden="true" />;
}

/* ---------------------------------------------------------- Status bar */
const Coords = memo(function Coords() {
  const cam = useStore((s) => s.cam);
  return <span className="mono">{Math.round(cam.x)}, {Math.round(cam.y)}, {Math.round(cam.z)} m · {Math.round(((cam.heading % 360) + 360) % 360)}°</span>;
});

export function StatusBar() {
  const active = useStore((s) => s.activeBookmark);
  const bm = BOOKMARKS.find((b) => b.id === active);
  return (
    <footer className="status">
      <span className="status-main">{bm ? <><b>{bm.label}</b> — {bm.caption}</> : <Coords />}</span>
      <span className="status-attr">Geodata: NYC Open Data</span>
    </footer>
  );
}

/* ----------------------------------------------------------- Hide hint */
export function HideHint() {
  return <div className="hide-hint" aria-hidden="true">Press <kbd>H</kbd> to show interface</div>;
}
