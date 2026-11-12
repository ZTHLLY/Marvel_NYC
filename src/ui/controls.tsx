import { memo, useCallback, useId, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useStore } from '../state/store';
import { CONTROL_SCHEMA, DEFAULT_PARAMS } from '../state/params';
import type { ControlDef, Params } from '../state/params';
import { IconChevron, IconDice } from './icons';
import { clamp, setParam } from './actions';

type Opt = { value: string | number; label: string };

/* ---------------------------------------------------------------- Slider */
interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  unit?: string;
  hint?: string;
  defaultValue?: number;
  compact?: boolean;
  onChange: (v: number) => void;
}

export const Slider = memo(function Slider(p: SliderProps) {
  const id = useId();
  const pct = clamp(((p.value - p.min) / (p.max - p.min)) * 100, 0, 100);
  const reset = () => { if (p.defaultValue !== undefined) p.onChange(p.defaultValue); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); reset(); } };
  return (
    <div className={'ctl ctl-slider' + (p.compact ? ' compact' : '')} onDoubleClick={reset} title={p.defaultValue !== undefined ? 'Double-click to reset' : undefined}>
      <div className="ctl-head">
        <label htmlFor={id}>{p.label}</label>
        <output htmlFor={id} className="ctl-val">{p.value.toFixed(p.digits ?? 0)}{p.unit ?? ''}</output>
      </div>
      <input
        id={id} className="rng" type="range" min={p.min} max={p.max} step={p.step} value={p.value}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onInput={(e) => p.onChange(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => p.onChange(Number(e.target.value))}
        onKeyDown={onKey}
      />
      {p.hint && !p.compact && <p className="ctl-hint">{p.hint}</p>}
    </div>
  );
});

export const ParamSlider = memo(function ParamSlider({ def }: { def: ControlDef }) {
  const value = useStore((s) => s.params[def.key]) as number;
  const onChange = useCallback((v: number) => setParam(def.key, v), [def.key]);
  return (
    <Slider
      label={def.label} value={value} min={def.min ?? 0} max={def.max ?? 1} step={def.step ?? 0.01}
      digits={def.digits} unit={def.unit} hint={def.hint} defaultValue={DEFAULT_PARAMS[def.key] as number} onChange={onChange}
    />
  );
});

/* ------------------------------------------------------------- Segmented */
export function Segmented({ options, value, onChange, label }: {
  options: Opt[]; value: string | number; onChange: (v: string | number) => void; label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value} type="button" role="radio" aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- Dropdown */
export function Dropdown({ options, value, onChange, label, className }: {
  options: Opt[]; value: string | number; onChange: (v: string | number) => void; label: string; className?: string;
}) {
  return (
    <div className={'dd ' + (className ?? '')}>
      <select
        aria-label={label} value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
      >
        {options.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
      </select>
      <IconChevron className="dd-chev" width={14} height={14} />
    </div>
  );
}

/* ---------------------------------------------------------------- Select */
const ParamSelect = memo(function ParamSelect({ def }: { def: ControlDef }) {
  const value = useStore((s) => s.params[def.key]) as string | number;
  const options = def.options ?? [];
  const onChange = useCallback((v: string | number) => setParam(def.key, v), [def.key]);
  return (
    <div className="ctl">
      <div className="ctl-head"><span className="ctl-label">{def.label}</span></div>
      {options.length <= 4
        ? <Segmented options={options} value={value} onChange={onChange} label={def.label} />
        : <Dropdown options={options} value={value} onChange={onChange} label={def.label} />}
      {def.hint && <p className="ctl-hint">{def.hint}</p>}
    </div>
  );
});

/* ---------------------------------------------------------------- Toggle */
const ParamToggle = memo(function ParamToggle({ def }: { def: ControlDef }) {
  const value = useStore((s) => s.params[def.key]) as boolean;
  return (
    <div className="ctl ctl-toggle">
      <div className="ctl-toggle-row">
        <span className="ctl-label" id={`t-${def.key}`}>{def.label}</span>
        <button
          type="button" role="switch" aria-checked={value} aria-labelledby={`t-${def.key}`}
          className={'switch' + (value ? ' on' : '')} onClick={() => setParam(def.key, !value)}
        ><i /></button>
      </div>
      {def.hint && <p className="ctl-hint">{def.hint}</p>}
    </div>
  );
});

/* ------------------------------------------------------------------ Seed */
const ParamSeed = memo(function ParamSeed({ def }: { def: ControlDef }) {
  const value = useStore((s) => s.params[def.key]) as number;
  const min = def.min ?? 1, max = def.max ?? 9999;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    if (Number.isFinite(n)) setParam(def.key, clamp(n, min, max));
    setDraft(null);
  };
  const randomize = () => setParam(def.key, min + Math.floor(Math.random() * (max - min + 1)));
  const onChange = useCallback((v: number) => setParam(def.key, v), [def.key]);
  return (
    <div className="ctl ctl-seed">
      <div className="ctl-head"><span className="ctl-label">{def.label}</span></div>
      <div className="seed-row">
        <input
          className="num" type="number" inputMode="numeric" min={min} max={max} step={1} aria-label={def.label}
          value={draft ?? String(value)}
          onChange={(e) => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) setParam(def.key, Math.round(n)); }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <button type="button" className="btn btn-ghost" onClick={randomize}><IconDice /> Randomize</button>
      </div>
      <Slider label="" value={value} min={min} max={max} step={def.step ?? 1} digits={0} defaultValue={DEFAULT_PARAMS[def.key] as number} onChange={onChange} compact />
    </div>
  );
});

export function ControlRow({ def }: { def: ControlDef }) {
  switch (def.kind) {
    case 'slider': return <ParamSlider def={def} />;
    case 'select': return <ParamSelect def={def} />;
    case 'toggle': return <ParamToggle def={def} />;
    case 'seed': return <ParamSeed def={def} />;
  }
}

export function getDef(key: keyof Params): ControlDef {
  const d = CONTROL_SCHEMA.find((c) => c.key === key);
  if (!d) throw new Error(`No control for ${key}`);
  return d;
}
