/**
 * Deterministic audio tests: the real AudioGraph rendered into an
 * OfflineAudioContext (node-web-audio-api), measured as signals.
 * These verify energy, pitch, envelopes, levels and cleanup — not taste.
 */
import { describe, expect, test } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioGraph, MAX_VOICES } from '../../src/audio/graph.ts';
import { SOUND_PRESETS, type PresetName } from '../../src/presets/sound.ts';
import { DEFAULT_MUSIC, midiForU } from '../../src/music/mapping.ts';
import { midiToHz } from '../../src/music/scales.ts';

const SR = 44100;

async function render(
  seconds: number,
  play: (g: AudioGraph, ctx: BaseAudioContext) => void,
  preset: PresetName = 'Glass',
) {
  const ctx = new OfflineAudioContext(2, Math.floor(SR * seconds), SR) as unknown as BaseAudioContext;
  const graph = new AudioGraph(ctx, SOUND_PRESETS[preset], 62);
  play(graph, ctx);
  const buf = await (ctx as unknown as OfflineAudioContext).startRendering();
  await new Promise((r) => setTimeout(r, 30)); // let onended callbacks run
  const mono = new Float32Array(buf.length);
  const l = buf.getChannelData(0), r = buf.getChannelData(1);
  for (let i = 0; i < buf.length; i++) mono[i] = (l[i] + r[i]) * 0.5;
  return { mono, left: l, right: r, graph };
}

function rms(x: Float32Array, t0: number, t1: number) {
  const a = Math.floor(t0 * SR), b = Math.min(x.length, Math.floor(t1 * SR));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

function peak(x: Float32Array) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** Goertzel magnitude at frequency f over [t0,t1). */
function goertzel(x: Float32Array, f: number, t0: number, t1: number) {
  const a = Math.floor(t0 * SR), b = Math.floor(t1 * SR);
  const w = (2 * Math.PI * f) / SR;
  const coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = a; i < b; i++) {
    const s = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

/** Strongest MIDI pitch between 36 and 100 in a window. */
function dominantMidi(x: Float32Array, t0: number, t1: number) {
  let best = 0, bestMag = -1;
  for (let m = 36; m <= 100; m++) {
    const mag = goertzel(x, midiToHz(m), t0, t1);
    if (mag > bestMag) { bestMag = mag; best = m; }
  }
  return best;
}

const note = (midi: number, velocity = 0.8) => ({ midi, velocity, brightness: 0.6, pan: 0 });

describe('audio synthesis (offline rendering)', () => {
  test('a pluck produces real, non-clipping audio energy', async () => {
    const { mono } = await render(1.5, (g) => g.pluck(note(74), 0.05));
    expect(rms(mono, 0.05, 0.5)).toBeGreaterThan(0.01);
    expect(peak(mono)).toBeLessThan(0.98);
    expect(rms(mono, 0, 0.04)).toBeLessThan(1e-4); // silent before the note
  });

  test('different surface regions sound at distinguishable, correct pitches', async () => {
    const shift = 12 * SOUND_PRESETS.Glass.octaveShift;
    const regions = [0.02, 0.35, 0.62, 0.98];
    const detected: number[] = [];
    for (const u of regions) {
      const midi = midiForU(u, DEFAULT_MUSIC) + shift;
      const { mono } = await render(1.6, (g) => g.pluck(note(midi), 0.02), 'Silk');
      // after the FM index has decayed, the fundamental dominates
      const d = dominantMidi(mono, 0.6, 1.4);
      expect(d).toBe(midi);
      detected.push(d);
    }
    expect(new Set(detected).size).toBe(regions.length);
  });

  test('envelope: fast attack, then decay toward silence', async () => {
    const { mono } = await render(4, (g) => g.pluck(note(74), 0.1));
    const attack = rms(mono, 0.1, 0.13);
    const early = rms(mono, 0.15, 0.4);
    const late = rms(mono, 2.6, 3.0);
    expect(attack).toBeGreaterThan(0.01);
    expect(late).toBeLessThan(early * 0.2);
  });

  test('voices terminate and release their nodes', async () => {
    const { graph } = await render(5, (g) => {
      g.pluck(note(62), 0.01);
      g.pluck(note(69), 0.2);
    });
    expect(graph.notesPlayed).toBe(2);
    expect(graph.activeVoiceCount).toBe(0);
  });

  test('presets are genuinely different timbres', async () => {
    const spectra: Record<string, number[]> = {};
    for (const p of ['Glass', 'Silk', 'Ether'] as PresetName[]) {
      const { mono } = await render(2.5, (g) => g.pluck(note(62), 0.01), p);
      const f = midiToHz(62);
      spectra[p] = [1, 2, 3, 4.5].map((h) => goertzel(mono, f * h, 0.02, 0.5));
      spectra[p].push(rms(mono, 1.5, 2.4) / Math.max(1e-6, rms(mono, 0.05, 0.4)));
    }
    const diff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]) / (Math.abs(v) + Math.abs(b[i]) + 1e-9), 0);
    expect(diff(spectra.Glass, spectra.Silk)).toBeGreaterThan(0.4);
    expect(diff(spectra.Glass, spectra.Ether)).toBeGreaterThan(0.4);
    expect(diff(spectra.Silk, spectra.Ether)).toBeGreaterThan(0.4);
  });

  test('rapid retriggering stays bounded in voices and level', async () => {
    const { mono, graph } = await render(3, (g) => {
      for (let k = 0; k < 240; k++) {
        const midi = 62 + ((k * 5) % 24);
        g.pluck(note(midi, 1), 0.01 + k * 0.008);
      }
    });
    expect(peak(mono)).toBeLessThanOrEqual(0.98);
    expect(graph.notesPlayed).toBe(240);
    expect(graph.activeVoiceCount).toBe(0);
    expect(rms(mono, 0.5, 2)).toBeGreaterThan(0.01);
  });

  test('the same note re-plucked within the guard window is merged', async () => {
    const { graph } = await render(1, (g) => {
      g.pluck(note(70), 0.1);
      g.pluck(note(70), 0.11);
      g.pluck(note(70), 0.12);
    });
    expect(graph.notesPlayed).toBe(1);
  });

  test('never more than MAX_VOICES unreleased voices at once', async () => {
    await render(1, (g) => {
      for (let k = 0; k < 30; k++) g.pluck(note(50 + k), 0.1 + k * 0.001);
      const live = (g as unknown as { voices: Array<{ isReleased: boolean }> }).voices.filter((v) => !v.isReleased);
      expect(live.length).toBeLessThanOrEqual(MAX_VOICES);
    });
  });

  test('muting silences the output', async () => {
    const { mono } = await render(1.5, (g) => {
      g.setMuted(true);
      g.pluck(note(74), 0.3);
    });
    expect(rms(mono, 0.4, 1.2)).toBeLessThan(1e-4);
  });

  // Pitch glide during a held tone is verified in real Chrome (tests/e2e):
  // node-web-audio-api mis-renders OscillatorNode.frequency when a
  // setTargetAtTime is scheduled in the future, which live playing never does.
  test('the sustained (stretch) tone holds its pitch and releases cleanly', async () => {
    const { mono, graph } = await render(4, (g) => {
      g.sustainStart({ midi: 62, bend: 0, intensity: 0.8, brightness: 0.5, pan: 0 }, 0);
      g.sustainEnd(1.5);
    }, 'Silk');
    const held = rms(mono, 0.5, 1.4);
    expect(held).toBeGreaterThan(0.01);
    expect(dominantMidi(mono, 0.4, 1.4)).toBe(62);
    expect(peak(mono)).toBeLessThan(0.98);
    // no release spike, then silence
    expect(rms(mono, 1.5, 1.6)).toBeLessThan(held * 1.5);
    expect(rms(mono, 3.6, 4)).toBeLessThan(held * 0.05);
    expect(graph.hasSustain).toBe(false);
  });

  test('stretch bend raises the sustained pitch', async () => {
    const { mono } = await render(2, (g) => {
      g.sustainStart({ midi: 62, bend: 2, intensity: 0.8, brightness: 0.5, pan: 0 }, 0);
    }, 'Silk');
    expect(dominantMidi(mono, 0.6, 1.8)).toBe(64);
  });

  test('membrane resonance follows energy and stays quiet', async () => {
    const { mono } = await render(3, (g) => {
      g.setResonance(1, 0);
      g.setResonance(0, 1.5);
    });
    const on = rms(mono, 0.8, 1.4);
    expect(on).toBeGreaterThan(0.002);
    expect(on).toBeLessThan(0.08);
    expect(rms(mono, 2.6, 3)).toBeLessThan(on * 0.1);
  });
});
