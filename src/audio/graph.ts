import { makeImpulseResponse, makeNoiseBuffer } from './reverb.ts';
import {
  PluckVoice,
  ResonancePad,
  SustainVoice,
  type EnvelopeScale,
  type NoteEvent,
  type SustainState,
} from './voices.ts';
import type { SoundPreset } from '../presets/sound.ts';

/** Hard cap on simultaneous plucked notes; the oldest is stolen beyond this. */
export const MAX_VOICES = 10;
/** Same-pitch notes closer than this are merged instead of stacked. */
export const RETRIGGER_GUARD = 0.045;
const STEAL_FADE = 0.025;
const DAMP_FADE = 0.12;

export interface MixSettings {
  /** 0..1 master volume */
  volume: number;
  /** 0..1.5 multiplier on the preset's reverb send */
  reverb: number;
  envelope: EnvelopeScale;
}

export const DEFAULT_MIX: MixSettings = {
  volume: 0.8,
  reverb: 1,
  envelope: { attack: 1, decay: 1 },
};

/**
 * The complete signal graph, independent of how the context was created, so
 * it runs identically in a live AudioContext and an OfflineAudioContext.
 *
 *  voices ─► voiceBus ─┬─► dry ───────────────────────────┐
 *                      ├─► reverbSend ─► convA/convB ─────┤
 *                      └─► delaySend ─► delay ⟲ lowpass ──┤
 *  resonance pad ─────────────────────────────────────────┤
 *                                                          ▼
 *              master ─► mute ─► compressor ─► soft clip ─► destination (+ recorder)
 */
export class AudioGraph {
  readonly voiceBus: GainNode;
  readonly master: GainNode;
  private limiter: DynamicsCompressorNode;
  readonly output: AudioNode;
  private mute: GainNode;
  private reverbSend: GainNode;
  private convolvers: [ConvolverNode, ConvolverNode];
  private convGains: [GainNode, GainNode];
  private activeConv = 0;
  private delay: DelayNode;
  private delayFeedback: GainNode;
  private delaySend: GainNode;
  private noise: AudioBuffer;
  private voices: PluckVoice[] = [];
  private sustain: SustainVoice | null = null;
  private pad: ResonancePad;
  private preset: SoundPreset;
  private mix: MixSettings;
  private disposed = false;
  /** total pluck voices ever started (for tests / debug) */
  notesPlayed = 0;

  constructor(
    readonly ctx: BaseAudioContext,
    preset: SoundPreset,
    rootMidi: number,
    mix: MixSettings = DEFAULT_MIX,
  ) {
    this.preset = preset;
    this.mix = { ...mix, envelope: { ...mix.envelope } };
    this.noise = makeNoiseBuffer(ctx);

    this.voiceBus = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = this.mix.volume;
    this.mute = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    // the compressor adds makeup gain and lets fast transients through, so a
    // soft clipper is the final guarantee that the mix never exceeds ±0.98
    const clipper = ctx.createWaveShaper();
    clipper.curve = softClipCurve();
    clipper.oversample = '2x';
    this.master.connect(this.mute).connect(this.limiter).connect(clipper).connect(ctx.destination);
    this.output = clipper;

    const dry = ctx.createGain();
    dry.gain.value = 0.9;
    this.voiceBus.connect(dry).connect(this.master);

    this.reverbSend = ctx.createGain();
    this.voiceBus.connect(this.reverbSend);
    const reverbReturn = ctx.createGain();
    reverbReturn.connect(this.master);
    this.convolvers = [ctx.createConvolver(), ctx.createConvolver()];
    this.convGains = [ctx.createGain(), ctx.createGain()];
    for (let k = 0; k < 2; k++) {
      this.reverbSend.connect(this.convolvers[k]);
      this.convolvers[k].connect(this.convGains[k]).connect(reverbReturn);
    }
    this.convGains[1].gain.value = 0;

    this.delaySend = ctx.createGain();
    this.delay = ctx.createDelay(2);
    this.delayFeedback = ctx.createGain();
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 3200;
    this.voiceBus.connect(this.delaySend).connect(this.delay);
    this.delay.connect(delayTone).connect(this.delayFeedback).connect(this.delay);
    const delayReturn = ctx.createGain();
    delayReturn.gain.value = 1;
    delayTone.connect(delayReturn).connect(this.master);

    this.pad = new ResonancePad(ctx, this.master, rootMidi - 12);
    this.applyPreset(preset, 0, true);
  }

  get activeVoiceCount(): number {
    return this.voices.length;
  }

  get hasSustain(): boolean {
    return this.sustain !== null && !this.sustain.isStopped;
  }

  get currentPreset(): SoundPreset {
    return this.preset;
  }

  /** Play a plucked note now (or at `when`). Returns null when merged/ignored. */
  pluck(ev: NoteEvent, when = this.ctx.currentTime): PluckVoice | null {
    if (this.disposed || !Number.isFinite(ev.midi)) return null;
    const now = Math.max(when, this.ctx.currentTime);
    // damp an older ringing voice of the same pitch (a re-plucked string);
    // a near-simultaneous duplicate is merged entirely
    for (const v of this.voices) {
      if (v.midi !== ev.midi || v.isReleased) continue;
      if (now - v.startTime < RETRIGGER_GUARD) return null;
      v.release(now, DAMP_FADE);
    }
    // steal the oldest voices beyond the cap
    const live = this.voices.filter((v) => !v.isReleased);
    for (let k = 0; k <= live.length - MAX_VOICES; k++) live[k].release(now, STEAL_FADE);

    const voice = new PluckVoice(this.ctx, this.voiceBus, this.preset, ev, now, this.mix.envelope, this.noise);
    voice.onEnded = () => {
      this.voices = this.voices.filter((v) => v !== voice);
    };
    this.voices = [...this.voices, voice];
    this.notesPlayed++;
    return voice;
  }

  sustainStart(state: SustainState, when = this.ctx.currentTime) {
    if (this.disposed) return;
    const now = Math.max(when, this.ctx.currentTime);
    this.sustain?.release(now);
    this.sustain = new SustainVoice(this.ctx, this.voiceBus, this.preset, state, now, this.mix.envelope);
  }

  sustainUpdate(state: SustainState, when = this.ctx.currentTime) {
    this.sustain?.update(state, Math.max(when, this.ctx.currentTime));
  }

  sustainEnd(when = this.ctx.currentTime) {
    this.sustain?.release(Math.max(when, this.ctx.currentTime));
    this.sustain = null;
  }

  /** Membrane motion energy (0..1+) → sympathetic resonance level. */
  setResonance(energy: number, when = this.ctx.currentTime) {
    const e = Number.isFinite(energy) ? Math.min(1, Math.max(0, energy)) : 0;
    this.pad.setLevel(this.preset.resonance * Math.sqrt(e), Math.max(when, this.ctx.currentTime));
  }

  setRoot(rootMidi: number) {
    this.pad.setRoot(rootMidi - 12, this.ctx.currentTime);
  }

  setPreset(preset: SoundPreset) {
    if (preset === this.preset) return;
    this.applyPreset(preset, this.ctx.currentTime, false);
  }

  setMix(mix: MixSettings) {
    this.mix = { ...mix, envelope: { ...mix.envelope } };
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, mix.volume)), now, 0.05);
    this.reverbSend.gain.setTargetAtTime(this.preset.reverb.wet * Math.max(0, mix.reverb), now, 0.08);
  }

  setMuted(muted: boolean) {
    this.mute.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  /** Swap timbre: crossfade between the two convolvers, retune the sends. */
  private applyPreset(preset: SoundPreset, now: number, initial: boolean) {
    this.preset = preset;
    const ir = makeImpulseResponse(this.ctx, preset.reverb.seconds, preset.reverb.damping);
    if (initial) {
      this.convolvers[0].buffer = ir;
      this.reverbSend.gain.value = preset.reverb.wet * this.mix.reverb;
      this.delay.delayTime.value = preset.delay.time;
      this.delayFeedback.gain.value = preset.delay.feedback;
      this.delaySend.gain.value = preset.delay.wet;
      return;
    }
    const next = 1 - this.activeConv;
    this.convolvers[next].buffer = ir;
    this.convGains[next].gain.setTargetAtTime(1, now, 0.12);
    this.convGains[this.activeConv].gain.setTargetAtTime(0, now, 0.12);
    this.activeConv = next;
    this.reverbSend.gain.setTargetAtTime(preset.reverb.wet * this.mix.reverb, now, 0.1);
    this.delay.delayTime.setTargetAtTime(preset.delay.time, now, 0.15);
    this.delayFeedback.gain.setTargetAtTime(preset.delay.feedback, now, 0.1);
    this.delaySend.gain.setTargetAtTime(preset.delay.wet, now, 0.1);
    // a held tone keeps its old timbre until released; nothing is cut off
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ctx.currentTime;
    for (const v of this.voices) v.release(now, 0.02);
    this.sustain?.kill(now);
    this.pad.stop(now);
    this.voices = [];
    this.sustain = null;
  }
}

/** Transparent below 0.7, then a tanh knee that saturates at 0.98. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}
