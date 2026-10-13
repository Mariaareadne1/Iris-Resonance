import type { ScaleName } from '../music/scales.ts';
import type { PresetName } from './sound.ts';
import { SOUND_PRESETS } from './sound.ts';
import { DEFAULT_MUSIC, type MusicConfig } from '../music/mapping.ts';
import type { MembraneParams } from '../physics/membrane.ts';
import type { MixSettings } from '../audio/graph.ts';

/** Everything Studio Mode can change. Each field is wired to something real. */
export interface StudioSettings {
  preset: PresetName;
  scale: ScaleName;
  /** pitch class 0..11 */
  root: number;
  /** 0..1 master volume */
  volume: number;
  /** 0..1.5 reverb amount (× preset) */
  reverb: number;
  /** 0.4..3 attack time (× preset) */
  attack: number;
  /** 0.4..2 note / tail length (× preset) */
  decay: number;
  /** 0..1 how firmly the fabric returns to shape */
  tension: number;
  /** 0..1 how strongly the fabric reacts to touch */
  responsiveness: number;
  /** 0.3..2.5 how long vibrations ring (× preset) */
  ringing: number;
  /** 0..1.5 iridescence */
  iridescence: number;
  background: string;
  reducedMotion: boolean;
}

export const DEFAULT_SETTINGS: StudioSettings = {
  preset: 'Glass',
  scale: DEFAULT_MUSIC.scale,
  root: DEFAULT_MUSIC.root,
  volume: 0.7,
  reverb: 1,
  attack: 1,
  decay: 1,
  tension: 0.5,
  responsiveness: 0.6,
  ringing: 1,
  iridescence: 1,
  background: '#070814',
  reducedMotion: false,
};

export function musicConfigFor(s: StudioSettings): MusicConfig {
  return {
    ...DEFAULT_MUSIC,
    scale: s.scale,
    root: s.root,
    octave: DEFAULT_MUSIC.octave + SOUND_PRESETS[s.preset].octaveShift,
  };
}

export function membraneParamsFor(s: StudioSettings): MembraneParams {
  return {
    cloth: {
      viscosity: 0.05,
      stiffness: 1,
      iterations: 6,
      tension: s.tension,
    },
    wave: {
      speed: 38 + 22 * s.responsiveness,
      restoreHz: 0.8 + 0.6 * s.tension,
      decay: SOUND_PRESETS[s.preset].ring * s.ringing,
    },
    idle: s.reducedMotion ? 0 : 1,
  };
}

export function mixFor(s: StudioSettings): MixSettings {
  return {
    volume: s.volume,
    reverb: s.reverb,
    envelope: { attack: s.attack, decay: s.decay },
  };
}

/** Lowest MIDI note of the current layout (for the sympathetic resonance). */
export function rootMidiFor(s: StudioSettings): number {
  const cfg = musicConfigFor(s);
  return (cfg.octave + 1) * 12 + cfg.root;
}
