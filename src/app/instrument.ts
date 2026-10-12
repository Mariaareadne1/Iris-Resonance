import { Membrane } from '../physics/membrane.ts';
import { AudioEngine, type AudioSnapshot } from '../audio/engine.ts';
import { Stage } from '../rendering/stage.ts';
import { VisualState } from '../rendering/visualState.ts';
import { GestureController, type GestureEvent } from '../interaction/gestureController.ts';
import { PointerInput } from '../interaction/pointerInput.ts';
import { attachKeyboard } from '../interaction/keyboard.ts';
import { Showcase } from '../showcase/demo.ts';
import { CanvasRecorder, downloadBlob, downloadUrl, recorderSupport } from '../capture/recorder.ts';
import { SOUND_PRESETS } from '../presets/sound.ts';
import {
  DEFAULT_SETTINGS,
  membraneParamsFor,
  mixFor,
  musicConfigFor,
  rootMidiFor,
  type StudioSettings,
} from '../presets/settings.ts';
import type { MembraneParams } from '../physics/membrane.ts';

export interface RecordingInfo {
  filename: string;
  size: number;
  mimeType: string;
  hasAudio: boolean;
  durationMs: number;
}

export interface InstrumentState {
  audio: AudioSnapshot;
  demo: boolean;
  recording: boolean;
  recordingHasAudio: boolean;
  lastRecording: RecordingInfo | null;
  interacted: boolean;
  clean: boolean;
  /** short status line for the UI (errors, limitations) */
  message: string | null;
}

export interface InstrumentOptions {
  embed: boolean;
  debug: boolean;
}

/**
 * Owns the frame loop and every subsystem. The per-frame path never touches
 * React: physics → gesture controller (audio params + visual signals) →
 * renderer. React only hears about coarse state changes.
 */
export class Instrument {
  readonly membrane = new Membrane();
  readonly audio: AudioEngine;
  readonly stage: Stage;
  readonly visual = new VisualState();
  readonly controller: GestureController;
  private pointer: PointerInput;
  private showcase: Showcase;
  private recorder = new CanvasRecorder();
  private detachKeys: () => void;
  private settings: StudioSettings = DEFAULT_SETTINGS;
  private physics: MembraneParams = membraneParamsFor(DEFAULT_SETTINGS);
  private state: InstrumentState;
  private listeners = new Set<(s: InstrumentState) => void>();
  private last = performance.now();
  private disposed = false;
  private unsubAudio: () => void;
  readonly gestures: GestureEvent[] = [];
  frames = 0;

  constructor(host: HTMLElement, private opts: InstrumentOptions) {
    this.audio = new AudioEngine(SOUND_PRESETS.Glass, rootMidiFor(DEFAULT_SETTINGS), mixFor(DEFAULT_SETTINGS));
    this.stage = new Stage(host, this.membrane);
    this.controller = new GestureController(this.membrane, this.audio, this.visual, musicConfigFor(DEFAULT_SETTINGS));
    this.controller.onGesture((e) => {
      this.gestures.push(e);
      if (this.gestures.length > 200) this.gestures.shift();
    });
    this.controller.outward = this.stage.towardCamera();
    this.showcase = new Showcase(this.controller, this.membrane, () => this.stage.towardCamera());
    this.showcase.onEnd = () => this.patch({ demo: false });

    this.state = {
      audio: this.audio.snapshot(),
      demo: false,
      recording: false,
      recordingHasAudio: false,
      lastRecording: null,
      interacted: false,
      clean: false,
      message: null,
    };
    this.unsubAudio = this.audio.subscribe((a) => {
      const prev = this.state.audio;
      if (prev.status !== a.status || prev.muted !== a.muted) this.patch({ audio: a });
      else this.state = { ...this.state, audio: a };
    });

    this.pointer = new PointerInput(this.stage, this.controller, {
      // standalone: the first touch is the gesture that turns sound on;
      // embedded: sound waits for the explicit sound control
      onFirstTouch: () => {
        if (!opts.embed && this.audio.snapshot().status === 'off') void this.audio.enable();
      },
      onInteract: () => {
        if (this.showcase.isRunning) this.stopDemo();
        if (!this.state.interacted) this.patch({ interacted: true });
      },
    });

    this.detachKeys = attachKeyboard({
      onNote: (region, strong) => {
        if (!opts.embed && this.audio.snapshot().status === 'off') void this.audio.enable();
        if (this.showcase.isRunning) this.stopDemo();
        if (!this.state.interacted) this.patch({ interacted: true });
        this.controller.playRegion(region, strong ? 0.95 : 0.6);
      },
      onEscape: () => {
        this.stopDemo();
        if (this.state.clean) this.patch({ clean: false });
      },
      onToggleClean: () => this.setClean(!this.state.clean),
    });

    this.applySettings(DEFAULT_SETTINGS);
    this.stage.renderer.setAnimationLoop(this.tick);

    if (opts.debug) {
      (window as unknown as Record<string, unknown>).__iris = this;
    }
  }

  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.showcase.update(dt);
    this.membrane.step(dt, this.physics);
    this.controller.update(dt);
    this.stage.render(dt, this.visual);
    this.frames++;
  };

  // ── state for React ──────────────────────────────────────────────────

  getState(): InstrumentState {
    return this.state;
  }

  subscribe(fn: (s: InstrumentState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private patch(p: Partial<InstrumentState>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }

  // ── controls ─────────────────────────────────────────────────────────

  /** Sound button: start audio if needed, otherwise toggle mute. */
  async toggleSound() {
    const s = this.audio.snapshot();
    if (s.status === 'unsupported') {
      this.patch({ message: 'Web Audio is not available in this browser.' });
      return;
    }
    if (s.status !== 'running') {
      this.audio.setMuted(false);
      const ok = await this.audio.enable();
      if (!ok) this.patch({ message: 'Sound could not start. Tap again to retry.' });
      return;
    }
    this.audio.setMuted(!s.muted);
  }

  applySettings(s: StudioSettings) {
    const prev = this.settings;
    this.settings = s;
    this.physics = membraneParamsFor(s);
    this.controller.setMusic(musicConfigFor(s));
    this.controller.strengthScale = 0.6 + 0.8 * s.responsiveness;
    if (prev.preset !== s.preset || !this.audioConfigured) this.audio.setPreset(SOUND_PRESETS[s.preset]);
    this.audio.setRoot(rootMidiFor(s));
    this.audio.setMix(mixFor(s));
    this.audioConfigured = true;
    this.stage.setLook({ iridescence: s.iridescence, background: s.background, reducedMotion: s.reducedMotion });
  }

  private audioConfigured = false;

  reset() {
    this.stopDemo();
    this.pointer.cancel();
    this.controller.release();
    this.membrane.reset();
  }

  async playDemo() {
    this.pointer.cancel();
    const s = this.audio.snapshot();
    if (s.status !== 'unsupported' && s.status !== 'running') await this.audio.enable();
    this.showcase.start();
    this.patch({ demo: true, interacted: true });
  }

  stopDemo() {
    if (!this.showcase.isRunning) return;
    this.showcase.stop();
    this.patch({ demo: false });
  }

  setClean(clean: boolean) {
    this.patch({ clean });
  }

  capturePNG() {
    const url = this.stage.snapshotPNG(this.visual);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadUrl(url, `iris-resonance-${stamp}.png`);
  }

  recordingSupport() {
    return recorderSupport(this.stage.canvas);
  }

  async startRecording() {
    if (this.recorder.isRecording) return;
    const a = this.audio.snapshot();
    if (a.status !== 'unsupported' && a.status !== 'running') await this.audio.enable();
    const stream = this.audio.recordStream();
    const res = this.recorder.start(this.stage.canvas, stream);
    if (!res.supported) {
      this.patch({ message: `Recording unavailable: ${res.reason ?? 'unsupported browser'}` });
      return;
    }
    const muted = this.audio.snapshot().muted;
    this.patch({
      recording: true,
      recordingHasAudio: res.hasAudio,
      message: !res.hasAudio
        ? 'Recording video only — sound is unavailable in this browser.'
        : muted ? 'Recording — sound is muted, so the audio track will be silent.' : null,
    });
  }

  async stopRecording() {
    const res = await this.recorder.stop();
    if (!res) {
      this.patch({ recording: false });
      return;
    }
    downloadBlob(res.blob, res.filename);
    this.patch({
      recording: false,
      message: null,
      lastRecording: {
        filename: res.filename,
        size: res.blob.size,
        mimeType: res.mimeType,
        hasAudio: res.hasAudio,
        durationMs: res.durationMs,
      },
    });
  }

  clearMessage() {
    if (this.state.message) this.patch({ message: null });
  }

  dispose() {
    this.disposed = true;
    this.stage.renderer.setAnimationLoop(null);
    void this.recorder.stop();
    this.pointer.dispose();
    this.detachKeys();
    this.unsubAudio();
    this.audio.dispose();
    this.stage.dispose();
    this.listeners.clear();
    if (this.opts.debug) delete (window as unknown as Record<string, unknown>).__iris;
  }
}
