import { useCallback, useEffect, useRef, useState } from 'react';
import { Instrument, type InstrumentState } from '../app/instrument.ts';
import { DEFAULT_SETTINGS, type StudioSettings } from '../presets/settings.ts';
import { PRESET_NAMES } from '../presets/sound.ts';
import { resolvePalette } from '../presets/palettes.ts';
import { StudioPanel } from './StudioPanel.tsx';
import { SoundButton } from './SoundButton.tsx';
import { CaptureMenu } from './CaptureMenu.tsx';
import { PlayIcon, ResetIcon, SlidersIcon, StopIcon } from './icons.tsx';

export interface AppProps {
  embed: boolean;
  debug: boolean;
  /** initial fabric palette from the URL (?fabric=rose or ?fabric=%23ff8800) */
  fabric?: string | null;
}

function fabricFromUrl(value: string | null | undefined): Partial<StudioSettings> {
  const p = resolvePalette(value);
  if (!p) return {};
  return p.name === 'Custom' ? { fabric: 'Custom', fabricColor: `#${value!.replace(/^#/, '').toLowerCase()}` } : { fabric: p.name };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function App({ embed, debug, fabric }: AppProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [inst, setInst] = useState<Instrument | null>(null);
  const [state, setState] = useState<InstrumentState | null>(null);
  const [settings, setSettings] = useState<StudioSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...fabricFromUrl(fabric),
    reducedMotion: prefersReducedMotion(),
  }));
  const [studioOpen, setStudioOpen] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let instrument: Instrument;
    try {
      instrument = new Instrument(host, { embed, debug });
    } catch (err) {
      console.error('[iris] failed to start', err);
      setWebglError('This browser could not start WebGL, so the fabric cannot be shown.');
      return;
    }
    setInst(instrument);
    const unsub = instrument.subscribe(setState);
    return () => {
      unsub();
      instrument.dispose();
      setInst(null);
    };
  }, [embed, debug]);

  useEffect(() => {
    inst?.applySettings(settings);
  }, [inst, settings]);

  const setPreset = useCallback(
    (preset: StudioSettings['preset']) => setSettings((s) => ({ ...s, preset })),
    [],
  );

  const clean = state?.clean ?? false;
  const audio = state?.audio;
  const showHint = !!state && !state.interacted && !clean;

  return (
    <div className={`app${embed ? ' is-embed' : ''}${clean ? ' is-clean' : ''}`}>
      <div ref={hostRef} id="stage" />

      {webglError && <p className="fatal" role="alert">{webglError}</p>}

      {!embed && (
        <header className="masthead">
          <h1>
            <span>Iris</span>
            <span className="slash" aria-hidden="true">/</span>
            <span>Resonance</span>
          </h1>
          <p>An instrument made of light and motion.</p>
        </header>
      )}

      <p className={`hint${showHint ? '' : ' is-hidden'}`} aria-live="polite">
        {embed && audio?.status !== 'running'
          ? 'Touch the fabric. Turn on sound to hear it.'
          : audio?.status === 'running'
            ? 'Pluck to play. Drag to bend.'
            : 'Touch the fabric. Make a sound.'}
      </p>

      {inst && state && (
        <nav className="dock" aria-label="Instrument controls">
          <SoundButton audio={state.audio} onToggle={() => void inst.toggleSound()} compact={embed} />

          {!embed && (
            <>
              <div className="seg seg-dock" role="radiogroup" aria-label="Sound preset">
                {PRESET_NAMES.map((p) => (
                  <button key={p} role="radio" aria-checked={settings.preset === p} onClick={() => setPreset(p)}>
                    {p}
                  </button>
                ))}
              </div>

              <button
                className="pill"
                onClick={() => (state.demo ? inst.stopDemo() : void inst.playDemo())}
                aria-pressed={state.demo}
              >
                {state.demo ? <StopIcon /> : <PlayIcon />}
                <span>{state.demo ? 'Stop demo' : 'Play demo'}</span>
              </button>

              <CaptureMenu instrument={inst} state={state} />

              <button className="pill icon-only" onClick={() => inst.reset()} aria-label="Reset fabric" title="Reset fabric">
                <ResetIcon />
              </button>
              <button
                className="pill"
                onClick={() => setStudioOpen((o) => !o)}
                aria-expanded={studioOpen}
                aria-controls="studio"
              >
                <SlidersIcon />
                <span>Customize</span>
              </button>
            </>
          )}
        </nav>
      )}

      {state?.recording && (
        <div className="rec" role="status">
          <span className="rec-dot" aria-hidden="true" />
          <span>Recording{state.recordingHasAudio ? ' with sound' : ' (video only)'}</span>
          <button className="text-btn" onClick={() => void inst?.stopRecording()}>Stop & save</button>
        </div>
      )}

      {state?.message && (
        <div className="toast" role="status">
          <span>{state.message}</span>
          <button className="text-btn" onClick={() => inst?.clearMessage()} aria-label="Dismiss message">OK</button>
        </div>
      )}

      {clean && (
        <button className="clean-exit" onClick={() => inst?.setClean(false)}>
          Show controls <kbd>Esc</kbd>
        </button>
      )}

      {studioOpen && !embed && (
        <div id="studio">
          <StudioPanel settings={settings} onChange={setSettings} onClose={() => setStudioOpen(false)} />
        </div>
      )}
    </div>
  );
}
