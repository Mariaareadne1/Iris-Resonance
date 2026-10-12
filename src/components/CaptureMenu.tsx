import { useEffect, useRef, useState } from 'react';
import type { Instrument, InstrumentState } from '../app/instrument.ts';
import { CaptureIcon } from './icons.tsx';

interface CaptureMenuProps {
  instrument: Instrument;
  state: InstrumentState;
}

export function CaptureMenu({ instrument, state }: CaptureMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const support = instrument.recordingSupport();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="pill" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CaptureIcon />
        <span>Capture</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={run(() => instrument.capturePNG())}>
            Save image <small>PNG, no interface</small>
          </button>
          {state.recording ? (
            <button role="menuitem" onClick={run(() => void instrument.stopRecording())}>
              Stop recording <small>saves the file</small>
            </button>
          ) : (
            <button
              role="menuitem"
              disabled={!support.supported}
              onClick={run(() => void instrument.startRecording())}
            >
              Record video
              <small>{support.supported ? `${support.mimeType?.includes('mp4') ? 'MP4' : 'WebM'} with sound` : support.reason}</small>
            </button>
          )}
          <button role="menuitem" onClick={run(() => instrument.setClean(true))}>
            Clean view <small>hide interface · Esc</small>
          </button>
          {state.lastRecording && (
            <p className="menu-note">
              Last: {(state.lastRecording.size / 1e6).toFixed(1)} MB · {state.lastRecording.hasAudio ? 'with audio' : 'video only'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
