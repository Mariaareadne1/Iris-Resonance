import type { SurfacePoint } from '../physics/membrane.ts';

/**
 * Smoothed musical signals for the renderer. Gesture events push into it;
 * the frame loop decays it. Rendering never reads raw audio — it reads the
 * same events the audio engine received, plus measured membrane energy.
 */
export class VisualState {
  /** 0..1 brief swell after each note (velocity-scaled) */
  attack = 0;
  /** 0 = lowest note … 1 = highest, smoothed */
  pitch = 0.5;
  private pitchTarget = 0.5;
  /** smoothed membrane energy 0..1 */
  energy = 0;
  /** sustained-gesture intensity 0..1 */
  sustain = 0;
  touch: SurfacePoint = { u: 0.5, v: 0.5 };
  touchGlow = 0;
  private touching = false;

  onNote(pitch01: number, velocity: number, at: SurfacePoint) {
    this.attack = Math.max(this.attack, Math.min(1, velocity));
    this.pitchTarget = Math.min(1, Math.max(0, pitch01));
    this.touch = { u: at.u, v: at.v };
    this.touchGlow = Math.max(this.touchGlow, 0.5 + 0.5 * velocity);
  }

  setTouching(on: boolean, at?: SurfacePoint) {
    this.touching = on;
    if (at) this.touch = { u: at.u, v: at.v };
  }

  update(dt: number, membraneEnergy: number, sustain: number) {
    const d = Math.min(Math.max(dt, 0), 0.1);
    this.attack *= Math.exp(-d / 0.32);
    this.pitch += (this.pitchTarget - this.pitch) * (1 - Math.exp(-d / 0.25));
    const e = Math.min(1, Math.max(0, membraneEnergy));
    this.energy += (e - this.energy) * (1 - Math.exp(-d / (e > this.energy ? 0.05 : 0.4)));
    this.sustain += (sustain - this.sustain) * (1 - Math.exp(-d / 0.12));
    const glowTarget = this.touching ? 0.55 + 0.45 * this.sustain : 0;
    this.touchGlow += (glowTarget - this.touchGlow) * (1 - Math.exp(-d / (this.touching ? 0.08 : 0.6)));
  }
}
