import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { ASPECTS } from '../state/params';
import type { AspectKind, GuideKind } from '../state/params';
import { Dropdown, ParamSlider, getDef } from './controls';
import { IconCamera, IconEye, IconEyeOff, IconExit } from './icons';
import { doCapture, setParam } from './actions';

/* -------------------------------------------------- crop rect (letterbox) */
interface Rect { x: number; y: number; w: number; h: number }

function useCropRect(aspect: AspectKind): Rect {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const target = ASPECTS[aspect];
  if (!target) return { x: 0, y: 0, w: size.w, h: size.h };
  let w = size.w, h = size.h;
  if (size.w / size.h > target) w = size.h * target; else h = size.w / target;
  return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h };
}

const L = (x1: number, y1: number, x2: number, y2: number) => <line key={`${x1}${y1}${x2}${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />;

function GuideLines({ kind }: { kind: GuideKind }) {
  const t = 100 / 3, g1 = 38.2, g2 = 61.8;
  switch (kind) {
    case 'thirds': return <>{[L(t, 0, t, 100), L(2 * t, 0, 2 * t, 100), L(0, t, 100, t), L(0, 2 * t, 100, 2 * t)]}</>;
    case 'golden': return <>{[L(g1, 0, g1, 100), L(g2, 0, g2, 100), L(0, g1, 100, g1), L(0, g2, 100, g2)]}</>;
    case 'center': return <>{[L(50, 0, 50, 100), L(0, 50, 100, 50)]}</>;
    case 'diagonal': return <>{[L(0, 0, 100, 100), L(100, 0, 0, 100)]}</>;
    default: return null;
  }
}

/** Letterbox masks + composition guides. Always pointer-events: none. */
export function Framing() {
  const aspect = useStore((s) => s.params.aspect);
  const guides = useStore((s) => s.params.guides);
  const r = useCropRect(aspect);
  const free = aspect === 'free';
  return (
    <div className="framing" aria-hidden="true">
      {!free && (
        <>
          <div className="mask" style={{ left: 0, top: 0, width: '100%', height: r.y }} />
          <div className="mask" style={{ left: 0, bottom: 0, width: '100%', height: r.y }} />
          <div className="mask" style={{ left: 0, top: r.y, width: r.x, height: r.h }} />
          <div className="mask" style={{ right: 0, top: r.y, width: r.x, height: r.h }} />
          <div className="crop-edge" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
        </>
      )}
      {guides !== 'none' && (
        <svg className="guides" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} viewBox="0 0 100 100" preserveAspectRatio="none">
          <GuideLines kind={guides} />
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Toolbar */
function Pick({ k, label }: { k: 'aspect' | 'guides' | 'resolution'; label: string }) {
  const value = useStore((s) => s.params[k]);
  const def = getDef(k);
  return (
    <div className="pt-field">
      <span>{label}</span>
      <Dropdown options={def.options ?? []} value={value} label={def.label} onChange={(v) => setParam(k, v)} />
    </div>
  );
}

function CompactSlider({ k, label }: { k: 'fov' | 'exposure'; label: string }) {
  const def = { ...getDef(k), label, hint: undefined };
  return <div className="pt-slider"><ParamSlider def={def} /></div>;
}

export function PhotoToolbar() {
  const busy = useStore((s) => s.capture.busy);
  const message = useStore((s) => s.capture.message);
  const ui = useStore.getState().ui;
  return (
    <div className="photobar ui-hit" role="toolbar" aria-label="Photography toolbar">
      <div className="pt-group">
        <Pick k="aspect" label="Aspect" />
        <Pick k="guides" label="Guides" />
        <Pick k="resolution" label="Resolution" />
      </div>
      <div className="pt-sep" />
      <div className="pt-group">
        <CompactSlider k="fov" label="FOV" />
        <CompactSlider k="exposure" label="Exposure" />
      </div>
      <div className="pt-sep" />
      <div className="pt-group pt-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => doCapture(true)}><IconEye /><span className="lbl">Preview</span></button>
        <button type="button" className="shutter" disabled={busy} aria-label="Capture wallpaper" title="Capture (C)" onClick={() => doCapture(false)}>
          {busy ? <span className="spinner" /> : <IconCamera width={20} height={20} />}
        </button>
        <button type="button" className="icon-btn" title="Hide interface (H)" aria-label="Hide interface" onClick={() => ui({ uiHidden: true })}><IconEyeOff /></button>
        <button type="button" className="btn btn-ghost" onClick={() => ui({ photoMode: false })}><IconExit /><span className="lbl">Exit</span></button>
      </div>
      {message && <p className="pt-msg" role="status">{message}</p>}
    </div>
  );
}

export type { Rect };
