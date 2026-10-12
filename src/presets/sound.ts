/**
 * Sound presets. Each one changes the timbre of the same fabric — never the
 * physics of the surface itself (except how long vibrations ring, which is
 * matched to the sound's decay so eyes and ears agree).
 */
export interface PartialSpec {
  /** frequency ratio to the fundamental */
  ratio: number;
  gain: number;
  /** decay time (s, to −60 dB) */
  decay: number;
}

export interface SoundPreset {
  name: PresetName;
  /** octave added to the music config's base octave */
  octaveShift: number;
  pluck: {
    /** FM modulator : carrier ratio */
    modRatio: number;
    /** peak FM index at full brightness */
    modIndex: number;
    /** how fast the FM index falls away (s, to −60 dB) */
    modDecay: number;
    attack: number;
    decay: number;
    /** extra additive partials for shimmer */
    partials: PartialSpec[];
    /** level of the filtered-noise "touch" transient */
    noise: number;
    noiseHz: number;
    /** lowpass cutoff at mid brightness */
    cutoff: number;
    /** detuned twin carrier, cents (0 = off) */
    chorus: number;
    gain: number;
  };
  sustain: {
    wave: OscillatorType;
    detune: number;
    cutoff: number;
    q: number;
    attack: number;
    release: number;
    gain: number;
    vibratoHz: number;
    vibratoCents: number;
  };
  reverb: { seconds: number; wet: number; damping: number };
  delay: { time: number; feedback: number; wet: number };
  /** level of the sympathetic resonance that rings while the sheet moves */
  resonance: number;
  /** wave-field decay time (s) — how long the fabric visibly rings */
  ring: number;
}

export type PresetName = 'Glass' | 'Silk' | 'Ether';
export const PRESET_NAMES: PresetName[] = ['Glass', 'Silk', 'Ether'];

export const SOUND_PRESETS: Record<PresetName, SoundPreset> = {
  Glass: {
    name: 'Glass',
    octaveShift: 1,
    pluck: {
      modRatio: 3.5,
      modIndex: 2.2,
      modDecay: 0.45,
      attack: 0.002,
      decay: 2.8,
      partials: [
        { ratio: 2.0, gain: 0.22, decay: 1.4 },
        { ratio: 4.07, gain: 0.07, decay: 0.6 },
      ],
      noise: 0.05,
      noiseHz: 5200,
      cutoff: 5200,
      chorus: 0,
      gain: 0.42,
    },
    sustain: {
      wave: 'sine',
      detune: 6,
      cutoff: 2600,
      q: 0.8,
      attack: 0.12,
      release: 0.9,
      gain: 0.16,
      vibratoHz: 4.6,
      vibratoCents: 5,
    },
    reverb: { seconds: 3.2, wet: 0.38, damping: 0.35 },
    delay: { time: 0.36, feedback: 0.28, wet: 0.16 },
    resonance: 0.05,
    ring: 1.25,
  },
  Silk: {
    name: 'Silk',
    octaveShift: 0,
    pluck: {
      modRatio: 1,
      modIndex: 1.1,
      modDecay: 0.9,
      attack: 0.03,
      decay: 3.4,
      partials: [{ ratio: 2.0, gain: 0.14, decay: 1.8 }],
      noise: 0.025,
      noiseHz: 2400,
      cutoff: 2100,
      chorus: 7,
      gain: 0.4,
    },
    sustain: {
      wave: 'triangle',
      detune: 9,
      cutoff: 1500,
      q: 1.4,
      attack: 0.22,
      release: 1.4,
      gain: 0.2,
      vibratoHz: 5.2,
      vibratoCents: 9,
    },
    reverb: { seconds: 3.8, wet: 0.42, damping: 0.6 },
    delay: { time: 0.42, feedback: 0.22, wet: 0.12 },
    resonance: 0.06,
    ring: 1.6,
  },
  Ether: {
    name: 'Ether',
    octaveShift: 0,
    pluck: {
      modRatio: 2,
      modIndex: 0.8,
      modDecay: 2.2,
      attack: 0.16,
      decay: 6.5,
      partials: [
        { ratio: 1.5, gain: 0.1, decay: 4 },
        { ratio: 3.0, gain: 0.06, decay: 2.5 },
      ],
      noise: 0,
      noiseHz: 1800,
      cutoff: 1800,
      chorus: 11,
      gain: 0.36,
    },
    sustain: {
      wave: 'sine',
      detune: 12,
      cutoff: 1200,
      q: 0.7,
      attack: 0.5,
      release: 2.6,
      gain: 0.2,
      vibratoHz: 0.35,
      vibratoCents: 14,
    },
    reverb: { seconds: 6.5, wet: 0.6, damping: 0.5 },
    delay: { time: 0.62, feedback: 0.38, wet: 0.2 },
    resonance: 0.08,
    ring: 2.3,
  },
};
