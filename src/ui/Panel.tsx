import { memo, useEffect, useRef, useState } from 'react';
import { bus, useStore } from '../state/store';
import { CONTROL_SCHEMA, GROUPS } from '../state/params';
import type { GroupId } from '../state/params';
import { SCENE_PRESETS } from '../state/presets';
import { SITES } from '../landmarks/sites';
import { ControlRow, Slider } from './controls';
import { IconCamera, IconChevron, IconCopy, IconEye, IconImport, IconReset, IconSave, IconTarget, IconTrash } from './icons';
import { clamp, doCapture } from './actions';

type TabId = GroupId | 'presets';

/* ------------------------------------------------------------------ Tabs */
function Tabs() {
  const active = useStore((s) => s.activeGroup);
  const tabs: { id: TabId; label: string }[] = [{ id: 'presets', label: 'Presets' }, ...GROUPS.map((g) => ({ id: g.id, label: g.label }))];
  return (
    <div className="tabs" role="tablist" aria-label="Control groups">
      {tabs.map((t) => (
        <button
          key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={active === t.id} aria-controls="panel-body"
          className={active === t.id ? 'on' : ''}
          onClick={() => useStore.getState().ui({ activeGroup: t.id })}
        >{t.label}</button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- Group */
function Advanced({ group }: { group: GroupId }) {
  const [open, setOpen] = useState(false);
  const defs = CONTROL_SCHEMA.filter((c) => c.group === group && c.advanced);
  if (!defs.length) return null;
  return (
    <div className={'adv' + (open ? ' open' : '')}>
      <button type="button" className="adv-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconChevron width={14} height={14} /> Advanced <span className="adv-count">{defs.length}</span>
      </button>
      {open && <div className="adv-body">{defs.map((d) => <ControlRow key={d.key} def={d} />)}</div>}
    </div>
  );
}

function StatusLine() {
  const capture = useStore((s) => s.capture);
  if (!capture.busy && !capture.message) return null;
  return (
    <p className={'cap-status' + (capture.busy ? ' busy' : '')} role="status">
      {capture.busy && <span className="spinner" />}{capture.message || 'Rendering…'}
    </p>
  );
}

function CaptureBlock() {
  const busy = useStore((s) => s.capture.busy);
  return (
    <section className="block">
      <h3 className="block-title">Export</h3>
      <div className="cap-actions">
        <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => doCapture(false)}>
          <IconCamera /> Capture Wallpaper
        </button>
        <button type="button" className="btn btn-ghost btn-lg" disabled={busy} onClick={() => doCapture(true)}>
          <IconEye /> Preview
        </button>
      </div>
      <StatusLine />
    </section>
  );
}

/* --------------------------------------------------------- Camera block */
function NumField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="numfield">
      <span>{label}</span>
      <input
        className="num" type="number" step={1} value={draft ?? String(Math.round(value * 10) / 10)}
        onFocus={(e) => setDraft(e.target.value)}
        onChange={(e) => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) onCommit(n); }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

const CameraBlock = memo(function CameraBlock() {
  const cam = useStore((s) => s.cam);
  const send = (p: Partial<typeof cam>) => bus.emit('setCamera', p);
  return (
    <section className="block">
      <h3 className="block-title">Camera <span className="block-sub">live</span></h3>
      <div className="numrow">
        <NumField label="X" value={cam.x} onCommit={(x) => send({ x })} />
        <NumField label="Z" value={cam.z} onCommit={(z) => send({ z })} />
      </div>
      <Slider label="Altitude" value={clamp(cam.y, 1, 4000)} min={1} max={4000} step={1} digits={0} unit=" m" onChange={(y) => send({ y })} />
      <Slider label="Heading" value={((cam.heading % 360) + 360) % 360} min={0} max={360} step={0.5} digits={1} unit="°" onChange={(heading) => send({ heading })} />
      <Slider label="Pitch" value={clamp(cam.pitch, -89, 89)} min={-89} max={89} step={0.5} digits={1} unit="°" defaultValue={0} onChange={(pitch) => send({ pitch })} />
      <Slider label="Roll" value={clamp(cam.roll, -45, 45)} min={-45} max={45} step={0.25} digits={2} unit="°" defaultValue={0} onChange={(roll) => send({ roll })} />
      <button type="button" className="btn btn-ghost" onClick={() => bus.emit('resetCamera', undefined)}><IconReset /> Reset camera</button>
    </section>
  );
});

function LandmarkFocus() {
  return (
    <section className="block">
      <h3 className="block-title">Landmark Focus</h3>
      <ul className="list">
        {Object.values(SITES).map((site) => (
          <li key={site.id}>
            <button type="button" className="list-item" onClick={() => bus.emit('focus', site.id)}>
              <IconTarget className="li-ico" />
              <span className="li-text"><b>{site.name}</b><small>{site.blurb}</small></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- Groups */
function GroupView({ id }: { id: GroupId }) {
  const group = GROUPS.find((g) => g.id === id)!;
  const defs = CONTROL_SCHEMA.filter((c) => c.group === id && !c.advanced);
  return (
    <div className="group" key={id}>
      <p className="blurb">{group.blurb}</p>
      {id === 'photo' && <CaptureBlock />}
      <div className="controls">{defs.map((d) => <ControlRow key={d.key} def={d} />)}</div>
      <Advanced group={id} />
      {id === 'marvel' && <LandmarkFocus />}
      {id === 'photo' && <CameraBlock />}
    </div>
  );
}

/* --------------------------------------------------------------- Presets */
function useFlash(): [string, (m: string) => void] {
  const [msg, setMsg] = useState('');
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return [msg, (m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 2200); }];
}

function PresetsView() {
  const activePreset = useStore((s) => s.activePreset);
  const userPresets = useStore((s) => s.userPresets);
  const [name, setName] = useState('');
  const [importText, setImportText] = useState('');
  const [msg, flash] = useFlash();
  const st = useStore.getState;
  const names = Object.keys(userPresets);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    st().saveUserPreset(n);
    setName('');
    flash(`Saved “${n}”`);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(st().params, null, 2));
      flash('Settings copied to clipboard');
    } catch { flash('Clipboard unavailable'); }
  };
  const doImport = () => {
    if (!importText.trim()) return;
    if (st().importParams(importText)) { flash('Settings imported'); setImportText(''); } else flash('Invalid JSON');
  };

  return (
    <div className="group">
      <p className="blurb">Complete looks: light, weather, grade and camera in one click.</p>
      <div className="preset-grid">
        {SCENE_PRESETS.map((p) => (
          <button
            key={p.id} type="button" className={'preset' + (activePreset === p.id ? ' on' : '')}
            aria-pressed={activePreset === p.id} onClick={() => st().applyScenePreset(p.id)}
          >
            <b>{p.label}</b><small>{p.caption}</small>
          </button>
        ))}
      </div>

      <section className="block">
        <h3 className="block-title">Save / Load</h3>
        <form className="save-row" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input className="txt" placeholder="Name this look…" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Preset name" />
          <button type="submit" className="btn btn-ghost" disabled={!name.trim()}><IconSave /> Save</button>
        </form>
        {names.length > 0 && (
          <ul className="list user-list">
            {names.map((n) => (
              <li key={n} className="user-item">
                <button type="button" className="list-item" onClick={() => st().loadUserPreset(n)}><span className="li-text"><b>{n}</b></span></button>
                <button type="button" className="icon-btn danger" aria-label={`Delete ${n}`} onClick={() => st().deleteUserPreset(n)}><IconTrash /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => { st().resetParams(); flash('Reset to defaults'); }}><IconReset /> Reset defaults</button>
          <button type="button" className="btn btn-ghost" onClick={copy}><IconCopy /> Copy JSON</button>
        </div>
        <textarea className="txt area" rows={3} placeholder="Paste settings JSON to import…" value={importText} onChange={(e) => setImportText(e.target.value)} aria-label="Settings JSON" spellCheck={false} />
        <button type="button" className="btn btn-ghost" disabled={!importText.trim()} onClick={doImport}><IconImport /> Import</button>
        <p className="flash" role="status" aria-live="polite">{msg}</p>
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------- Panel */
export function Panel() {
  const open = useStore((s) => s.panelOpen);
  const active = useStore((s) => s.activeGroup);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [active]);
  return (
    <aside className={'panel ui-hit' + (open ? ' open' : '')} aria-label="Scene controls" aria-hidden={!open} inert={!open}>
      <Tabs />
      <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`tab-${active}`} ref={bodyRef}>
        {active === 'presets' ? <PresetsView /> : <GroupView id={active} />}
      </div>
    </aside>
  );
}
