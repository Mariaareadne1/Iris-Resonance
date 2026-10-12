import { midiToHz } from '../music/scales.ts';
import type { SoundPreset } from '../presets/sound.ts';

export interface NoteEvent {
  midi: number;
  /** 0..1 */
  velocity: number;
  /** 0..1 timbre brightness */
  brightness: number;
  /** -1..1 stereo position */
  pan: number;
}

export interface EnvelopeScale {
  /** multiplier on preset attack times */
  attack: number;
  /** multiplier on preset decay / release times */
  decay: number;
}

/** time constant for setTargetAtTime that reaches −60 dB at `seconds` */
const tau60 = (seconds: number) => Math.max(0.001, seconds / 6.9);

/**
 * One plucked note: a two-operator FM pair (optionally doubled and detuned
 * for chorus), a few additive partials for shimmer, and a filtered-noise
 * touch transient — all through an enveloped lowpass and a stereo panner.
 * Every node is one-shot and disconnects itself when the note ends.
 */
export class PluckVoice {
  readonly midi: number;
  readonly startTime: number;
  readonly endTime: number;
  private sources: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private vca: GainNode;
  private released = false;
  private finished = false;
  onEnded: (() => void) | null = null;

  constructor(
    ctx: BaseAudioContext,
    out: AudioNode,
    preset: SoundPreset,
    ev: NoteEvent,
    when: number,
    env: EnvelopeScale,
    noise: AudioBuffer,
  ) {
    const p = preset.pluck;
    const t = when;
    const f = midiToHz(ev.midi);
    const vel = clamp01(ev.velocity);
    const bright = clamp01(ev.brightness);
    const attack = Math.max(0.001, p.attack * env.attack);
    const decay = Math.max(0.2, p.decay * env.decay);
    const peak = p.gain * (0.08 + 0.92 * Math.pow(vel, 1.5));
    this.midi = ev.midi;
    this.startTime = t;
    this.endTime = t + attack + decay + 0.05;

    // output chain: filter → panner → vca → out
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.4;
    const cutoff = Math.min(16000, p.cutoff * (0.45 + 1.3 * bright) * (0.7 + 0.5 * vel));
    filter.frequency.setValueAtTime(Math.min(18000, cutoff * 2.2), t);
    filter.frequency.setTargetAtTime(cutoff, t + attack, 0.08 + decay * 0.04);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, ev.pan));
    this.vca = ctx.createGain();
    filter.connect(panner).connect(this.vca).connect(out);
    this.nodes.push(filter, panner, this.vca);

    // main amplitude envelope
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + attack);
    amp.gain.setTargetAtTime(0, t + attack, tau60(decay));
    amp.connect(filter);
    this.nodes.push(amp);

    // FM operator(s)
    const index = p.modIndex * (0.35 + 0.65 * bright) * (0.5 + 0.5 * vel);
    const mod = ctx.createOscillator();
    mod.frequency.value = f * p.modRatio;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(index * f, t);
    modGain.gain.setTargetAtTime(index * f * 0.04, t, tau60(Math.max(0.05, p.modDecay * env.decay)));
    mod.connect(modGain);
    this.sources.push(mod);
    this.nodes.push(modGain);

    const carriers = p.chorus > 0 ? [-p.chorus / 2, p.chorus / 2] : [0];
    for (const cents of carriers) {
      const car = ctx.createOscillator();
      car.frequency.value = f;
      car.detune.value = cents;
      modGain.connect(car.frequency);
      const g = ctx.createGain();
      g.gain.value = 1 / carriers.length;
      car.connect(g).connect(amp);
      this.sources.push(car);
      this.nodes.push(g);
    }

    // additive shimmer partials, each with its own (shorter) decay
    for (const partial of p.partials) {
      const pf = f * partial.ratio;
      if (pf > ctx.sampleRate * 0.45) continue;
      const osc = ctx.createOscillator();
      osc.frequency.value = pf;
      const g = ctx.createGain();
      const pd = Math.max(0.05, partial.decay * env.decay);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak * partial.gain * (0.4 + 0.6 * bright), t + attack);
      g.gain.setTargetAtTime(0, t + attack, tau60(pd));
      osc.connect(g).connect(filter);
      this.sources.push(osc);
      this.nodes.push(g);
    }

    // the "touch": a whisper of band-passed noise at the attack
    let noiseSrc: AudioBufferSourceNode | null = null;
    if (p.noise > 0) {
      const src = ctx.createBufferSource();
      noiseSrc = src;
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = p.noiseHz * (0.7 + 0.6 * bright);
      bp.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(p.noise * vel, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, 0.012);
      src.connect(bp).connect(g).connect(panner);
      src.start(t, ((ev.midi * 0.137) % 1) * 0.3);
      src.stop(t + 0.12);
      this.sources.push(src);
      this.nodes.push(bp, g);
    }

    for (const s of this.sources) {
      if (s === noiseSrc) continue;
      s.start(t);
      s.stop(this.endTime);
    }
    // the modulator lives for the whole note; its end means the voice is done
    mod.onended = () => this.finish();
  }

  get isReleased() {
    return this.released;
  }

  get isFinished() {
    return this.finished;
  }

  /** Fade out quickly (voice stealing / damping) and stop. */
  release(now: number, fade = 0.03) {
    if (this.released || this.finished) return;
    this.released = true;
    const g = this.vca.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(1, now);
    g.linearRampToValueAtTime(0, now + fade);
    const stopAt = now + fade + 0.01;
    for (const s of this.sources) {
      try { s.stop(stopAt); } catch { /* already stopped */ }
    }
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    for (const n of this.nodes) n.disconnect();
    for (const s of this.sources) s.disconnect();
    this.sources = [];
    this.nodes = [];
    this.onEnded?.();
  }
}

export interface SustainState {
  midi: number;
  /** upward bend in semitones */
  bend: number;
  /** 0..1 loudness from pull distance */
  intensity: number;
  /** 0..1 filter brightness from drag speed / height */
  brightness: number;
  pan: number;
}

/**
 * The bowed tone heard while you hold and stretch the fabric: a detuned
 * oscillator pair with vibrato through a resonant lowpass. Every parameter
 * moves with setTargetAtTime, so pitch glides and swells are click-free.
 */
export class SustainVoice {
  private oscs: OscillatorNode[] = [];
  private lfo: OscillatorNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;
  private panner: StereoPannerNode;
  private nodes: AudioNode[] = [];
  private stopped = false;
  readonly startTime: number;

  constructor(
    ctx: BaseAudioContext,
    out: AudioNode,
    private preset: SoundPreset,
    initial: SustainState,
    when: number,
    private env: EnvelopeScale,
  ) {
    const s = preset.sustain;
    this.startTime = when;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = s.q;
    this.amp = ctx.createGain();
    this.amp.gain.setValueAtTime(0, when);
    this.panner = ctx.createStereoPanner();
    this.filter.connect(this.amp).connect(this.panner).connect(out);

    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = s.vibratoHz;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = s.vibratoCents;
    this.lfo.connect(lfoGain);
    this.nodes.push(this.filter, this.amp, this.panner, lfoGain);

    const f = midiToHz(initial.midi);
    for (const sign of [-1, 1]) {
      const o = ctx.createOscillator();
      o.type = s.wave;
      o.frequency.setValueAtTime(f, when);
      o.detune.setValueAtTime(sign * s.detune + initial.bend * 100, when);
      lfoGain.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = 0.5;
      o.connect(g).connect(this.filter);
      this.oscs.push(o);
      this.nodes.push(g);
      o.start(when);
    }
    this.lfo.start(when);
    // initial filter / pan are set directly; only loudness ramps in
    const { cutoff, level } = this.targets(initial);
    this.filter.frequency.setValueAtTime(cutoff, when);
    this.panner.pan.setValueAtTime(clampPan(initial.pan), when);
    this.amp.gain.setTargetAtTime(level, when, Math.max(0.01, s.attack * env.attack) / 3);
  }

  update(state: SustainState, now: number) {
    if (this.stopped) return;
    this.apply(state, now, 0.06);
  }

  private targets(state: SustainState) {
    const s = this.preset.sustain;
    const bright = clamp01(state.brightness);
    const inten = clamp01(state.intensity);
    return {
      cutoff: Math.min(12000, s.cutoff * (0.5 + 1.6 * bright) * (1 + 0.8 * inten)),
      level: s.gain * (0.18 + 0.82 * inten),
    };
  }

  private apply(state: SustainState, now: number, ampTau: number) {
    const s = this.preset.sustain;
    const f = midiToHz(state.midi);
    for (let k = 0; k < this.oscs.length; k++) {
      const o = this.oscs[k];
      o.frequency.setTargetAtTime(f, now, 0.045);
      o.detune.setTargetAtTime((k === 0 ? -1 : 1) * s.detune + state.bend * 100, now, 0.07);
    }
    const { cutoff, level } = this.targets(state);
    this.filter.frequency.setTargetAtTime(cutoff, now, 0.05);
    this.amp.gain.setTargetAtTime(level, now, ampTau);
    this.panner.pan.setTargetAtTime(clampPan(state.pan), now, 0.1);
  }

  release(now: number) {
    if (this.stopped) return;
    this.stopped = true;
    const rel = Math.max(0.05, this.preset.sustain.release * this.env.decay);
    this.amp.gain.cancelScheduledValues(now);
    this.amp.gain.setTargetAtTime(0, now, tau60(rel));
    const stopAt = now + rel + 0.05;
    for (const o of this.oscs) o.stop(stopAt);
    this.lfo.stop(stopAt);
    this.lfo.onended = () => {
      for (const o of this.oscs) o.disconnect();
      this.lfo.disconnect();
      for (const n of this.nodes) n.disconnect();
    };
  }

  /** Immediate hard-ish stop for preset changes / teardown. */
  kill(now: number) {
    if (this.stopped) return;
    this.stopped = true;
    this.amp.gain.cancelScheduledValues(now);
    this.amp.gain.setTargetAtTime(0, now, 0.01);
    const stopAt = now + 0.08;
    for (const o of this.oscs) o.stop(stopAt);
    this.lfo.stop(stopAt);
  }

  get isStopped() {
    return this.stopped;
  }
}

/**
 * Sympathetic resonance: a quiet, low root-and-fifth that swells while the
 * membrane is physically moving and fades as it settles — the "body" of the
 * instrument ringing along. Driven by measured membrane energy, never by
 * note triggers, so it can't retrigger.
 */
export class ResonancePad {
  private oscs: OscillatorNode[] = [];
  private amp: GainNode;
  private stopped = false;

  constructor(ctx: BaseAudioContext, out: AudioNode, rootMidi: number) {
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    this.amp.connect(lp).connect(out);
    const partials: Array<[number, number]> = [[0, 0.6], [7, 0.3], [12, 0.18]];
    for (const [semi, gain] of partials) {
      const o = ctx.createOscillator();
      o.frequency.value = midiToHz(rootMidi + semi);
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.amp);
      o.start();
      this.oscs.push(o);
    }
  }

  setRoot(rootMidi: number, now: number) {
    const semis = [0, 7, 12];
    this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(midiToHz(rootMidi + semis[i]), now, 0.3));
  }

  /** level 0..1 (already scaled by preset), smoothed over ~a quarter second */
  setLevel(level: number, now: number) {
    if (this.stopped) return;
    this.amp.gain.setTargetAtTime(Math.max(0, Math.min(0.2, level)), now, 0.25);
  }

  stop(now: number) {
    if (this.stopped) return;
    this.stopped = true;
    this.amp.gain.setTargetAtTime(0, now, 0.05);
    for (const o of this.oscs) o.stop(now + 0.4);
  }
}

function clampPan(x: number) {
  return Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
}

function clamp01(x: number) {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}
