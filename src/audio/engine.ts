import { AudioGraph, DEFAULT_MIX, type MixSettings } from './graph.ts';
import type { NoteEvent, SustainState } from './voices.ts';
import type { SoundPreset } from '../presets/sound.ts';

/**
 * Real audio state, mirrored to the UI. "running" means the AudioContext is
 * actually running — the UI never shows sound as on while it is suspended.
 */
export type AudioStatus = 'off' | 'starting' | 'running' | 'suspended' | 'unsupported' | 'error';

export interface AudioSnapshot {
  status: AudioStatus;
  muted: boolean;
  /** running and not muted */
  audible: boolean;
  voices: number;
  notesPlayed: number;
}

type Listener = (s: AudioSnapshot) => void;

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Lifecycle wrapper around AudioGraph: creates the AudioContext only inside a
 * user gesture, follows its real state, resumes after tab switches, and
 * exposes a MediaStream of the final mix for recording.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private status: AudioStatus;
  private muted = false;
  private listeners = new Set<Listener>();
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private wantRunning = false;
  private disposed = false;

  constructor(
    private preset: SoundPreset,
    private rootMidi: number,
    private mix: MixSettings = DEFAULT_MIX,
  ) {
    this.status = audioContextCtor() ? 'off' : 'unsupported';
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  snapshot(): AudioSnapshot {
    return {
      status: this.status,
      muted: this.muted,
      audible: this.status === 'running' && !this.muted,
      voices: this.graph?.activeVoiceCount ?? 0,
      notesPlayed: this.graph?.notesPlayed ?? 0,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  private setStatus(s: AudioStatus) {
    if (s === this.status) return;
    this.status = s;
    this.emit();
  }

  /**
   * Notes may be scheduled once sound has been requested, even while the
   * context is still starting: Firefox and Safari resume asynchronously, and
   * a note scheduled on a starting context plays the moment it runs. Without
   * this the very first touch would be silent there.
   */
  private get canSchedule(): boolean {
    return !!this.graph && !!this.ctx && !this.muted && this.wantRunning && (this.ctx.state as string) !== 'closed';
  }

  get isAudible(): boolean {
    return this.status === 'running' && !this.muted;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Create / resume the context. Must be called from a user gesture handler
   * (click, keydown, pointerdown) to satisfy browser autoplay policy.
   */
  async enable(): Promise<boolean> {
    const Ctor = audioContextCtor();
    if (!Ctor) {
      this.setStatus('unsupported');
      return false;
    }
    if (this.disposed) return false;
    this.wantRunning = true;
    try {
      if (!this.ctx) {
        this.setStatus('starting');
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.graph = new AudioGraph(this.ctx, this.preset, this.rootMidi, this.mix);
        this.graph.setMuted(this.muted);
        this.ctx.addEventListener('statechange', this.syncState);
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      this.syncState();
      return this.ctx.state === 'running';
    } catch (err) {
      console.error('[iris] audio failed to start', err);
      this.setStatus('error');
      return false;
    }
  }

  private syncState = () => {
    if (!this.ctx) return;
    const st = this.ctx.state as string;
    this.setStatus(st === 'running' ? 'running' : st === 'closed' ? 'off' : 'suspended');
  };

  private onVisibility = () => {
    if (document.visibilityState === 'visible' && this.wantRunning && this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().then(this.syncState, () => this.syncState());
    }
    if (document.visibilityState === 'hidden') {
      // the frame loop stops in a hidden tab, so nothing would fade these out
      this.graph?.sustainEnd();
      this.graph?.setResonance(0);
    }
  };

  setMuted(muted: boolean) {
    this.muted = muted;
    this.graph?.setMuted(muted);
    if (muted) this.graph?.sustainEnd();
    this.emit();
  }

  get isMuted() {
    return this.muted;
  }

  setPreset(preset: SoundPreset) {
    this.preset = preset;
    this.graph?.setPreset(preset);
  }

  setRoot(rootMidi: number) {
    this.rootMidi = rootMidi;
    this.graph?.setRoot(rootMidi);
  }

  setMix(mix: MixSettings) {
    this.mix = mix;
    this.graph?.setMix(mix);
  }

  pluck(ev: NoteEvent): boolean {
    if (!this.graph || !this.canSchedule) return false;
    const v = this.graph.pluck(ev);
    this.emit();
    return v !== null;
  }

  sustainStart(s: SustainState) {
    if (this.graph && this.canSchedule) this.graph.sustainStart(s);
  }

  sustainUpdate(s: SustainState) {
    this.graph?.sustainUpdate(s);
  }

  sustainEnd() {
    this.graph?.sustainEnd();
  }

  setResonance(energy: number) {
    this.graph?.setResonance(this.canSchedule ? energy : 0);
  }

  get presetName(): string {
    return this.preset.name;
  }

  /** RMS of the final mix right now (diagnostics / tests). 0 when silent or off. */
  level(): number {
    if (!this.ctx || !this.graph) return 0;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.meterBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.graph.output.connect(this.analyser);
    }
    const buf = this.meterBuf!;
    this.analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /** A MediaStream carrying the final mix (post-limiter), for recording. */
  recordStream(): MediaStream | null {
    if (!this.ctx || !this.graph) return null;
    if (!this.recordDest) {
      this.recordDest = this.ctx.createMediaStreamDestination();
      this.graph.output.connect(this.recordDest);
    }
    return this.recordDest.stream;
  }

  /** Sound was turned on before but the context isn't running (tab switch, iOS interruption, failed resume). */
  get needsResume(): boolean {
    return this.wantRunning && (this.status === 'suspended' || this.status === 'error');
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.graph?.dispose();
    this.ctx?.removeEventListener('statechange', this.syncState);
    this.ctx?.close().catch(() => { /* already closed */ });
    this.ctx = null;
    this.graph = null;
    this.listeners.clear();
  }
}
