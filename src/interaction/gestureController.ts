import type { Membrane, SurfacePoint, Vec3 } from '../physics/membrane.ts';
import type { NoteEvent, SustainState } from '../audio/voices.ts';
import {
  NoteQuantizer,
  bendForStrain,
  brightnessForSpeed,
  brightnessForV,
  intensityForPull,
  midiForU,
  panForU,
  playableNotes,
  regionForU,
  velocityForStrength,
  type MusicConfig,
} from '../music/mapping.ts';
import type { VisualState } from '../rendering/visualState.ts';

/** What the controller needs from the sound side — the AudioEngine, or a test double. */
export interface SoundSink {
  pluck(ev: NoteEvent): boolean;
  sustainStart(s: SustainState): void;
  sustainUpdate(s: SustainState): void;
  sustainEnd(): void;
  setResonance(energy: number): void;
}

/** One gesture event, as reported to listeners (UI, tests, telemetry). */
export interface GestureEvent {
  kind: 'pluck' | 'stretch-start' | 'glide-note' | 'release';
  point: SurfacePoint;
  midi: number;
  velocity: number;
  time: number;
}

type Phase = 'idle' | 'pressed' | 'stretching' | 'gliding';

/** Pull (world units) after which a press becomes a stretch. */
const STRETCH_THRESHOLD = 0.035;
/** The fabric can't be pulled further than this from where it was grabbed. */
const MAX_PULL = 0.8;
/** Drag faster than this (view widths / s) and the fabric slips: a glide. */
const SLIP_SPEED = 0.5;
/** Dragged this far past where the fabric can follow, it slips (× MAX_PULL). */
const SLIP_OVERREACH = 2;
/** Re-anchor the moving contact after this much travel across the surface (uv). */
const SLIP_DISTANCE = 0.045;
/** Never start glide notes closer together than this (s). */
const MIN_NOTE_GAP = 0.075;
/** Fraction of on-screen drag kept as sideways motion during a stretch. */
const LATERAL = 0.6;
/** Outward lift per unit of sideways drag. */
const LIFT = 0.55;
/** A stretch released from at least this far plays a release note. */
const RELEASE_NOTE_PULL = 0.12;

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The single place where a contact with the fabric becomes:
 *   1. a physical force (pluck impulse / grab constraint) on the membrane,
 *   2. musical events for the audio engine (notes, sustained tone),
 *   3. smoothed signals for the renderer.
 * Pointer input, keyboard input and the showcase all drive this same API.
 */
export class GestureController {
  private phase: Phase = 'idle';
  private quantizer: NoteQuantizer;
  private grabOrigin: Vec3 | null = null;
  private target: Vec3 | null = null;
  private contact: SurfacePoint = { u: 0.5, v: 0.5 };
  private speed = 0;
  private lastNoteTime = -1;
  private midi = 0;
  private clock = 0;
  private listeners = new Set<(e: GestureEvent) => void>();
  /** 0.5..1.5 multiplier from Studio "responsiveness" */
  strengthScale = 1;
  /** unit vector toward the viewer; pulls are turned partly outward along it */
  outward: Vec3 = [0, 0, 1];

  constructor(
    private membrane: Membrane,
    private sound: SoundSink,
    private visual: VisualState,
    private music: MusicConfig,
  ) {
    this.quantizer = new NoteQuantizer(music);
  }

  onGesture(fn: (e: GestureEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: GestureEvent['kind'], point: SurfacePoint, midi: number, velocity: number) {
    const e = { kind, point: { ...point }, midi, velocity, time: this.clock };
    for (const fn of this.listeners) fn(e);
  }

  setMusic(cfg: MusicConfig) {
    this.music = cfg;
    this.quantizer.setConfig(cfg);
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  get isActive(): boolean {
    return this.phase !== 'idle';
  }

  private pitch01(midi: number): number {
    const notes = playableNotes(this.music);
    return (midi - notes[0]) / Math.max(1, notes[notes.length - 1] - notes[0]);
  }

  /** A discrete strike: physics impulse + note + visual flash. */
  pluck(point: SurfacePoint, strength: number, kind: GestureEvent['kind'] = 'pluck'): number {
    const s = Math.min(1, Math.max(0, strength * this.strengthScale));
    this.membrane.pluckAt(point, s);
    const midi = midiForU(point.u, this.music);
    const velocity = velocityForStrength(s);
    this.sound.pluck({ midi, velocity, brightness: brightnessForV(point.v), pan: panForU(point.u) });
    this.visual.onNote(this.pitch01(midi), velocity, point);
    this.lastNoteTime = this.clock;
    this.emit(kind, point, midi, velocity);
    return midi;
  }

  /** Pointer down on the fabric: pluck it, and hold on in case it becomes a pull. */
  press(point: SurfacePoint, strength: number) {
    if (this.phase !== 'idle') this.release();
    this.contact = { ...point };
    this.midi = this.pluck(point, strength);
    this.quantizer.reset();
    this.quantizer.update(point.u);
    this.grabOrigin = this.membrane.beginGrab(point);
    this.target = this.grabOrigin ? [...this.grabOrigin] : null;
    this.speed = 0;
    this.phase = 'pressed';
    this.visual.setTouching(true, point);
  }

  /**
   * Pointer moved while held.
   * @param target   where the pointer is, on a camera-facing plane (world)
   * @param over     fabric region under the pointer at rest (null if off-sheet)
   * @param speed    pointer speed in view widths per second
   */
  drag(target: Vec3, over: SurfacePoint | null, speed: number) {
    if (this.phase === 'idle' || !this.grabOrigin) return;
    if (!target.every(Number.isFinite)) return;
    this.speed += (Math.min(20, Math.max(0, speed)) - this.speed) * 0.35;

    // fast travel across the sheet: the fabric slips under the finger — and
    // once sliding it keeps sliding (kinetic friction is lower than static)
    if (over && (this.phase === 'gliding' || this.speed > SLIP_SPEED)) {
      const du = over.u - this.contact.u, dv = over.v - this.contact.v;
      if (Math.hypot(du * 1.55, dv) > SLIP_DISTANCE) {
        this.slipTo(over);
        return;
      }
    }

    // pulled far beyond what the fabric can give: it slips under the finger
    const o = this.grabOrigin;
    const reach = Math.hypot(target[0] - o[0], target[1] - o[1], target[2] - o[2]);
    if (over && reach > MAX_PULL * SLIP_OVERREACH) {
      this.slipTo(over);
      return;
    }

    // otherwise the fabric sticks and stretches (with a pull limit)
    let d = this.membranePull([target[0] - o[0], target[1] - o[1], target[2] - o[2]]);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len > MAX_PULL) d = [d[0] * MAX_PULL / len, d[1] * MAX_PULL / len, d[2] * MAX_PULL / len];
    this.target = [o[0] + d[0], o[1] + d[1], o[2] + d[2]];
    this.membrane.updateGrab(this.target);

    if (this.phase === 'pressed' && Math.min(len, MAX_PULL) > STRETCH_THRESHOLD) {
      this.phase = 'stretching';
      this.sound.sustainStart(this.sustainState());
      this.emit('stretch-start', this.contact, this.midi, 0);
    }
  }

  /**
   * A tensioned membrane is pulled *outward*, not slid sideways: keep part
   * of the on-screen motion and turn the rest into lift toward the viewer.
   */
  private membranePull(d: Vec3): Vec3 {
    const n = this.outward;
    const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    const lat: Vec3 = [d[0] - n[0] * along, d[1] - n[1] * along, d[2] - n[2] * along];
    const latLen = Math.hypot(lat[0], lat[1], lat[2]);
    const lift = along + latLen * LIFT;
    return [lat[0] * LATERAL + n[0] * lift, lat[1] * LATERAL + n[1] * lift, lat[2] * LATERAL + n[2] * lift];
  }

  /** Re-anchor the grab further along the drag path; new region → new note. */
  private slipTo(over: SurfacePoint) {
    this.membrane.endGrab(); // the left-behind fabric snaps back and ripples
    this.contact = { ...over };
    this.grabOrigin = this.membrane.beginGrab(over);
    this.target = this.grabOrigin ? [...this.grabOrigin] : null;
    this.visual.setTouching(true, over);
    const q = this.quantizer.update(over.u);
    const startSustain = this.phase === 'pressed';
    this.phase = 'gliding';
    this.midi = q.midi;
    if (startSustain) this.sound.sustainStart(this.sustainState());
    if (q.changed && this.clock - this.lastNoteTime >= MIN_NOTE_GAP) {
      const strength = 0.25 + 0.45 * brightnessForSpeed(this.speed);
      this.pluck(over, strength, 'glide-note');
    } else {
      // same region (or too soon): stroke the membrane without a retrigger
      this.membrane.pluckAt(over, 0.15);
    }
  }

  private pullDistance(): number {
    return this.grabOrigin && this.target ? dist3(this.grabOrigin, this.target) : 0;
  }

  private sustainState(): SustainState {
    const strain = this.membrane.getLocalStrain(this.contact);
    const pull = this.pullDistance();
    const gliding = this.phase === 'gliding';
    return {
      midi: this.midi,
      bend: gliding ? 0 : bendForStrain(strain),
      intensity: gliding ? 0.35 + 0.5 * brightnessForSpeed(this.speed) : intensityForPull(pull),
      brightness: Math.max(brightnessForV(this.contact.v) * 0.6, brightnessForSpeed(this.speed)),
      pan: panForU(this.contact.u),
    };
  }

  /** Let go of the fabric. A real stretch plays a release note as it snaps back. */
  release() {
    if (this.phase === 'idle') return;
    const phase = this.phase;
    const pull = this.pullDistance();
    const info = this.membrane.endGrab();
    if (phase === 'stretching' || phase === 'gliding') this.sound.sustainEnd();
    if (phase === 'stretching' && pull > RELEASE_NOTE_PULL) {
      const strength = Math.min(1, 0.25 + pull * 0.6);
      const midi = midiForU(this.contact.u, this.music);
      const velocity = velocityForStrength(strength) * 0.8;
      this.sound.pluck({ midi, velocity, brightness: brightnessForV(this.contact.v), pan: panForU(this.contact.u) });
      this.visual.onNote(this.pitch01(midi), velocity, this.contact);
      this.emit('release', this.contact, midi, velocity);
    } else if (info) {
      this.emit('release', this.contact, this.midi, 0);
    }
    this.phase = 'idle';
    this.grabOrigin = null;
    this.target = null;
    this.speed = 0;
    this.quantizer.reset();
    this.visual.setTouching(false);
  }

  /** Keyboard alternative: play region `index` (0 = leftmost). */
  playRegion(index: number, strength = 0.65) {
    const span = this.music.span;
    const i = Math.max(0, Math.min(span - 1, Math.floor(index)));
    const u = (i + 0.5) / span;
    this.pluck({ u, v: 0.55 }, strength);
  }

  /** Per-frame: keep the sustained tone and resonance in step with the physics. */
  update(dt: number) {
    if (Number.isFinite(dt) && dt > 0) this.clock += Math.min(dt, 0.1);
    if (this.phase === 'stretching' || this.phase === 'gliding') {
      this.speed *= Math.exp(-Math.min(dt, 0.1) / 0.25); // a held, still finger calms down
      this.sound.sustainUpdate(this.sustainState());
    }
    const energy = this.membrane.energy();
    this.sound.setResonance(energy);
    const sustain = this.phase === 'stretching'
      ? intensityForPull(this.pullDistance())
      : this.phase === 'gliding' ? 0.4 : 0;
    this.visual.update(dt, energy, sustain);
  }

  /** Region index under a point — used by the UI hint and tests. */
  regionAt(point: SurfacePoint): number {
    return regionForU(point.u, this.music);
  }
}
