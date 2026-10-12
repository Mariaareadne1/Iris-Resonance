import { SCALES, type ScaleName } from './scales.ts';

/**
 * Surface → music. Pure functions so the mapping is deterministic, learnable
 * and unit-testable:
 *
 *   horizontal (u)   → note: the sheet is divided into `span` regions,
 *                      ascending through the scale from left to right
 *   vertical (v)     → timbre: bottom is warm and soft, top bright and glassy
 *   strike strength  → velocity
 *   stretch (strain) → a small upward pitch bend, like tightening a drumhead
 *   drag speed       → brightness / intensity of the sustained tone
 */
export interface MusicConfig {
  scale: ScaleName;
  /** pitch class of the root, 0 = C … 2 = D … 11 = B */
  root: number;
  /** MIDI octave of the lowest region (3 → D3 for root D) */
  octave: number;
  /** number of playable regions across the width */
  span: number;
}

export const DEFAULT_MUSIC: MusicConfig = {
  scale: 'Minor pentatonic',
  root: 2,
  octave: 3,
  span: 11,
};

/** Musically safe limits */
export const MAX_BEND_SEMITONES = 2;
export const HYSTERESIS = 0.24;

const clamp = (x: number, lo: number, hi: number) =>
  Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;

/** Scale degree index → MIDI note, wrapping into higher octaves. */
export function degreeToMidi(degree: number, cfg: MusicConfig): number {
  const steps = SCALES[cfg.scale] as readonly number[];
  const d = Math.max(0, Math.floor(degree));
  const oct = Math.floor(d / steps.length);
  const base = (cfg.octave + 1) * 12 + cfg.root;
  return base + oct * 12 + steps[d % steps.length];
}

/** Region index (0 … span-1) under horizontal position u. */
export function regionForU(u: number, cfg: MusicConfig): number {
  return Math.min(cfg.span - 1, Math.floor(clamp(u, 0, 1) * cfg.span));
}

export function midiForU(u: number, cfg: MusicConfig): number {
  return degreeToMidi(regionForU(u, cfg), cfg);
}

/** Every note the surface can play, left to right. */
export function playableNotes(cfg: MusicConfig): number[] {
  return Array.from({ length: cfg.span }, (_, i) => degreeToMidi(i, cfg));
}

/** Timbre brightness from vertical position: 0.15 at the hem → 1 at the top. */
export function brightnessForV(v: number): number {
  return 0.15 + 0.85 * clamp(v, 0, 1);
}

/** Strike strength → note velocity, with a soft floor so taps are audible. */
export function velocityForStrength(strength: number): number {
  return 0.22 + 0.78 * Math.pow(clamp(strength, 0, 1), 0.8);
}

/** Positive strain (stretch) → upward bend in semitones, smoothly capped. */
export function bendForStrain(strain: number): number {
  const s = clamp(strain, 0, 10);
  return MAX_BEND_SEMITONES * Math.tanh(s * 9);
}

/** Drag speed (screen widths / s) → brightness 0..1, saturating. */
export function brightnessForSpeed(speed: number): number {
  return 1 - Math.exp(-clamp(speed, 0, 100) * 1.6);
}

/** Pull distance (world units) → sustained intensity 0..1. */
export function intensityForPull(distance: number): number {
  return 1 - Math.exp(-clamp(distance, 0, 10) * 2.4);
}

/** Stereo position from horizontal position. */
export function panForU(u: number): number {
  return (clamp(u, 0, 1) - 0.5) * 1.1;
}

/**
 * Note quantizer with hysteresis: while gliding, the region only changes once
 * the pointer has moved `HYSTERESIS` of a region past the boundary. This keeps
 * a finger resting on a boundary from flickering between two notes.
 */
export class NoteQuantizer {
  private region: number | null = null;

  constructor(private cfg: MusicConfig) {}

  setConfig(cfg: MusicConfig) {
    this.cfg = cfg;
    this.region = null;
  }

  reset() {
    this.region = null;
  }

  get current(): number | null {
    return this.region;
  }

  /** Returns the (possibly unchanged) region and whether it changed. */
  update(u: number): { region: number; midi: number; changed: boolean } {
    const x = clamp(u, 0, 1) * this.cfg.span;
    const raw = Math.min(this.cfg.span - 1, Math.floor(x));
    if (this.region === null) {
      this.region = raw;
      return { region: raw, midi: degreeToMidi(raw, this.cfg), changed: true };
    }
    const r = this.region;
    let next = r;
    if (x >= r + 1 + HYSTERESIS || x < r - HYSTERESIS) next = raw;
    const changed = next !== r;
    this.region = next;
    return { region: next, midi: degreeToMidi(next, this.cfg), changed };
  }
}
