import { describe, expect, test } from 'vitest';
import { Membrane, type SurfacePoint, type Vec3 } from '../../src/physics/membrane.ts';
import { GestureController, type SoundSink } from '../../src/interaction/gestureController.ts';
import type { NoteEvent, SustainState } from '../../src/audio/voices.ts';
import { VisualState } from '../../src/rendering/visualState.ts';
import { DEFAULT_MUSIC, MAX_BEND_SEMITONES, midiForU, playableNotes } from '../../src/music/mapping.ts';
import { inScale } from '../../src/music/scales.ts';
import { membraneParamsFor, DEFAULT_SETTINGS } from '../../src/presets/settings.ts';

class RecordingSound implements SoundSink {
  plucks: NoteEvent[] = [];
  starts: SustainState[] = [];
  updates: SustainState[] = [];
  ends = 0;
  resonance: number[] = [];
  pluck(ev: NoteEvent) { this.plucks.push(ev); return true; }
  sustainStart(s: SustainState) { this.starts.push(s); }
  sustainUpdate(s: SustainState) { this.updates.push(s); }
  sustainEnd() { this.ends++; }
  setResonance(e: number) { this.resonance.push(e); }
}

const FRAME = 1 / 60;
const params = membraneParamsFor({ ...DEFAULT_SETTINGS, reducedMotion: true });

function rig() {
  const membrane = new Membrane();
  const sound = new RecordingSound();
  const visual = new VisualState();
  const ctl = new GestureController(membrane, sound, visual, DEFAULT_MUSIC);
  const frame = () => {
    membrane.step(FRAME, params);
    ctl.update(FRAME);
  };
  return { membrane, sound, visual, ctl, frame };
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

describe('gesture controller', () => {
  test('a tap plucks exactly one in-scale note for the touched region', () => {
    const { sound, ctl, frame } = rig();
    const pt = { u: 0.62, v: 0.5 };
    ctl.press(pt, 0.6);
    frame();
    ctl.release();
    frame();
    expect(sound.plucks).toHaveLength(1);
    expect(sound.plucks[0].midi).toBe(midiForU(pt.u, DEFAULT_MUSIC));
    expect(inScale(sound.plucks[0].midi, DEFAULT_MUSIC.root, DEFAULT_MUSIC.scale)).toBe(true);
    expect(sound.starts).toHaveLength(0); // a tap is not a stretch
  });

  test('stronger taps give louder notes and bigger physical response', () => {
    const a = rig();
    const b = rig();
    const pt = { u: 0.4, v: 0.5 };
    a.ctl.press(pt, 0.15); a.ctl.release();
    b.ctl.press(pt, 1); b.ctl.release();
    for (let i = 0; i < 6; i++) { a.frame(); b.frame(); }
    expect(b.sound.plucks[0].velocity).toBeGreaterThan(a.sound.plucks[0].velocity);
    expect(b.membrane.getLocalDisplacement(pt)).toBeGreaterThan(a.membrane.getLocalDisplacement(pt));
  });

  test('a slow pull becomes a sustained tone that bends upward, within limits', () => {
    const { membrane, sound, ctl, frame } = rig();
    const pt = { u: 0.45, v: 0.5 };
    ctl.press(pt, 0.4);
    const origin = membrane.worldAt(pt);
    for (let i = 1; i <= 60; i++) {
      ctl.drag(add(origin, [0.5, 0.35, 0.3], i / 60), pt, 0.15);
      frame();
    }
    expect(ctl.currentPhase).toBe('stretching');
    expect(sound.starts).toHaveLength(1);
    expect(sound.plucks).toHaveLength(1); // no retriggering while stretching
    const bends = sound.updates.map((u) => u.bend);
    const last = sound.updates[sound.updates.length - 1];
    expect(Math.max(...bends)).toBeGreaterThan(0.05);
    expect(Math.max(...bends)).toBeLessThanOrEqual(MAX_BEND_SEMITONES);
    expect(last.intensity).toBeGreaterThan(sound.updates[0].intensity);
    for (const u of sound.updates) {
      expect(u.intensity).toBeGreaterThanOrEqual(0);
      expect(u.intensity).toBeLessThanOrEqual(1);
      expect(u.brightness).toBeGreaterThanOrEqual(0);
      expect(u.brightness).toBeLessThanOrEqual(1);
      expect(u.midi).toBe(sound.plucks[0].midi);
    }
  });

  test('releasing a real stretch sounds a release note and ends the tone', () => {
    const { membrane, sound, ctl, frame } = rig();
    const pt = { u: 0.3, v: 0.4 };
    ctl.press(pt, 0.4);
    const origin = membrane.worldAt(pt);
    for (let i = 1; i <= 40; i++) {
      ctl.drag(add(origin, [0.6, 0.4, 0.4], i / 40), pt, 0.1);
      frame();
    }
    ctl.release();
    expect(sound.ends).toBe(1);
    expect(sound.plucks).toHaveLength(2);
    expect(sound.plucks[1].midi).toBe(sound.plucks[0].midi);
    expect(ctl.currentPhase).toBe('idle');
  });

  test('a fast sweep glides through ascending regions without rapid-fire retriggers', () => {
    const { membrane, sound, ctl, frame } = rig();
    const from = { u: 0.04, v: 0.6 };
    ctl.press(from, 0.4);
    const steps = 72; // 1.2 s at 60 fps across the whole sheet
    for (let i = 1; i <= steps; i++) {
      const over: SurfacePoint = { u: 0.04 + 0.92 * (i / steps), v: 0.6 };
      ctl.drag(membrane.worldAt(over), over, 1.8);
      frame();
    }
    ctl.release();
    const notes = sound.plucks.map((p) => p.midi);
    // every glide note is a step up the scale, and none repeat
    for (let i = 1; i < notes.length; i++) expect(notes[i]).toBeGreaterThan(notes[i - 1]);
    expect(notes.length).toBeGreaterThanOrEqual(6);
    expect(notes.length).toBeLessThanOrEqual(playableNotes(DEFAULT_MUSIC).length);
    expect(sound.starts).toHaveLength(1);
    expect(sound.ends).toBe(1);
  });

  test('jittering back and forth on one spot does not machine-gun notes', () => {
    const { membrane, sound, ctl, frame } = rig();
    const c = 5.5 / DEFAULT_MUSIC.span; // middle of a region boundary area
    ctl.press({ u: c, v: 0.5 }, 0.4);
    for (let i = 0; i < 120; i++) {
      const over = { u: c + (i % 2 === 0 ? 0.05 : -0.05), v: 0.5 };
      ctl.drag(membrane.worldAt(over), over, 2.5);
      frame();
    }
    ctl.release();
    // 2 s of frantic jitter across one boundary: at most a handful of notes
    expect(sound.plucks.length).toBeLessThanOrEqual(4);
  });

  test('keyboard regions map left to right onto the playable notes', () => {
    const { sound, ctl } = rig();
    for (let r = 0; r < DEFAULT_MUSIC.span; r++) ctl.playRegion(r);
    expect(sound.plucks.map((p) => p.midi)).toEqual(playableNotes(DEFAULT_MUSIC));
  });

  test('resonance follows physical energy and settles toward silence', () => {
    const { sound, ctl, frame } = rig();
    ctl.pluck({ u: 0.5, v: 0.5 }, 1);
    for (let i = 0; i < 20; i++) frame();
    const early = Math.max(...sound.resonance);
    for (let i = 0; i < 480; i++) frame();
    const late = sound.resonance[sound.resonance.length - 1];
    expect(early).toBeGreaterThan(0.1);
    expect(late).toBeLessThan(early * 0.05);
  });

  test('visual signals respond to notes and decay', () => {
    const { visual, ctl, frame } = rig();
    ctl.pluck({ u: 0.95, v: 0.5 }, 1);
    frame();
    expect(visual.attack).toBeGreaterThan(0.5);
    for (let i = 0; i < 90; i++) frame();
    expect(visual.attack).toBeLessThan(0.05);
    expect(visual.pitch).toBeGreaterThan(0.8); // rightmost = highest
  });
});
