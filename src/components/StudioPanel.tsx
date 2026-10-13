import type { ReactNode } from 'react';
import { SCALE_NAMES, NOTE_NAMES, type ScaleName } from '../music/scales.ts';
import { PRESET_NAMES, type PresetName } from '../presets/sound.ts';
import { DEFAULT_SETTINGS, type StudioSettings } from '../presets/settings.ts';
import { NOTE_KEY_LABELS } from '../interaction/keyboard.ts';
import { PALETTES, paletteFromColor } from '../presets/palettes.ts';
import { CloseIcon } from './icons.tsx';

interface StudioPanelProps {
  settings: StudioSettings;
  onChange: (s: StudioSettings) => void;
  onClose: () => void;
}

interface SliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;

function Slider({ label, hint, value, min, max, step, format = pct, onChange }: SliderProps) {
  const id = `s-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="studio-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function StudioPanel({ settings: s, onChange, onClose }: StudioPanelProps) {
  const set = <K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) =>
    onChange({ ...s, [key]: value });

  return (
    <aside className="studio" aria-label="Studio settings">
      <header className="studio-head">
        <h2>Studio</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close studio">
          <CloseIcon />
        </button>
      </header>

      <Section title="Sound">
        <div className="field">
          <span className="field-label" id="preset-label">Preset</span>
          <div className="seg" role="radiogroup" aria-labelledby="preset-label">
            {PRESET_NAMES.map((p: PresetName) => (
              <button key={p} role="radio" aria-checked={s.preset === p} onClick={() => set('preset', p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="field two">
          <label>
            <span className="field-label">Scale</span>
            <select value={s.scale} onChange={(e) => set('scale', e.target.value as ScaleName)}>
              {SCALE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">Root</span>
            <select value={s.root} onChange={(e) => set('root', Number(e.target.value))}>
              {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
        </div>
        <Slider label="Volume" value={s.volume} min={0} max={1} step={0.01} onChange={(v) => set('volume', v)} />
        <Slider label="Reverb" value={s.reverb} min={0} max={1.5} step={0.01} onChange={(v) => set('reverb', v)} />
        <Slider label="Attack" value={s.attack} min={0.4} max={3} step={0.05} format={times} onChange={(v) => set('attack', v)} />
        <Slider label="Decay" value={s.decay} min={0.4} max={2} step={0.05} format={times} onChange={(v) => set('decay', v)} />
      </Section>

      <Section title="Fabric">
        <Slider label="Tension" hint="How firmly the sheet returns to shape" value={s.tension} min={0} max={1} step={0.01} onChange={(v) => set('tension', v)} />
        <Slider label="Responsiveness" hint="How strongly it answers a touch" value={s.responsiveness} min={0} max={1} step={0.01} onChange={(v) => set('responsiveness', v)} />
        <Slider label="Ringing" hint="How long vibrations take to settle" value={s.ringing} min={0.3} max={2.5} step={0.05} format={times} onChange={(v) => set('ringing', v)} />
      </Section>

      <Section title="Light">
        <div className="field">
          <span className="field-label" id="fabric-label">Fabric colour</span>
          <div className="swatches" role="radiogroup" aria-labelledby="fabric-label">
            {PALETTES.map((p) => (
              <button
                key={p.name}
                role="radio"
                aria-checked={s.fabric === p.name}
                aria-label={p.name}
                title={p.name}
                className="swatch"
                style={{ background: `linear-gradient(135deg, ${p.a}, ${p.b} 55%, ${p.c})` }}
                onClick={() => set('fabric', p.name)}
              />
            ))}
            <label
              className="swatch swatch-custom"
              title="Custom colour"
              data-checked={s.fabric === 'Custom'}
              style={s.fabric === 'Custom' ? (() => {
                const c = paletteFromColor(s.fabricColor);
                return { background: `linear-gradient(135deg, ${c.a}, ${c.b} 55%, ${c.c})` };
              })() : undefined}
            >
              <span className="sr-only">Custom colour</span>
              <input
                type="color"
                value={s.fabricColor}
                onChange={(e) => onChange({ ...s, fabric: 'Custom', fabricColor: e.target.value })}
              />
            </label>
          </div>
          <p className="field-hint">{s.fabric === 'Custom' ? 'Custom' : s.fabric} · pitch still tints it as you play</p>
        </div>
        <Slider label="Iridescence" value={s.iridescence} min={0} max={1.5} step={0.01} onChange={(v) => set('iridescence', v)} />
        <div className="field field-inline">
          <label htmlFor="bg">Background</label>
          <input id="bg" type="color" value={s.background} onChange={(e) => set('background', e.target.value)} />
        </div>
        <div className="field field-inline">
          <label htmlFor="rm">Reduced motion</label>
          <input id="rm" type="checkbox" checked={s.reducedMotion} onChange={(e) => set('reducedMotion', e.target.checked)} />
        </div>
      </Section>

      <p className="studio-note">
        Keyboard: <kbd>{NOTE_KEY_LABELS[0]}</kbd>…<kbd>{NOTE_KEY_LABELS[NOTE_KEY_LABELS.length - 1]}</kbd> play the
        fabric left to right (<kbd>Shift</kbd> plays harder). <kbd>C</kbd> toggles clean view.
      </p>
      <button className="text-btn" onClick={() => onChange({ ...DEFAULT_SETTINGS, reducedMotion: s.reducedMotion })}>
        Restore defaults
      </button>
    </aside>
  );
}
