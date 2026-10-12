import type { AudioSnapshot } from '../audio/engine.ts';
import { SoundOffIcon, SoundOnIcon } from './icons.tsx';

interface SoundButtonProps {
  audio: AudioSnapshot;
  onToggle: () => void;
  compact?: boolean;
}

/** Mirrors the real AudioContext state — never claims sound is on when it isn't. */
export function SoundButton({ audio, onToggle, compact = false }: SoundButtonProps) {
  const { status, muted } = audio;
  const label =
    status === 'unsupported' ? 'No audio'
      : status === 'starting' ? 'Starting…'
        : status === 'suspended' ? 'Resume sound'
          : status === 'error' ? 'Retry sound'
            : status !== 'running' ? 'Enable sound'
              : muted ? 'Muted' : 'Sound on';
  const on = status === 'running' && !muted;
  return (
    <button
      className={`pill sound${on ? ' is-on' : ''}`}
      onClick={onToggle}
      disabled={status === 'unsupported' || status === 'starting'}
      aria-pressed={on}
      aria-label={compact ? label : undefined}
      data-audio-status={status}
      data-muted={muted}
    >
      {on ? <SoundOnIcon /> : <SoundOffIcon />}
      {!compact && <span>{label}</span>}
    </button>
  );
}
