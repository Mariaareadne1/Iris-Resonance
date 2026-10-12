import { describe, expect, test } from 'vitest';
import {
  DEFAULT_MUSIC,
  MAX_BEND_SEMITONES,
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
} from '../../src/music/mapping.ts';
import { SCALE_NAMES, inScale, noteName } from '../../src/music/scales.ts';

describe('surface → note mapping', () => {
  test('default surface plays D minor pentatonic from D3 to D5', () => {
    expect(playableNotes(DEFAULT_MUSIC).map(noteName)).toEqual([
      'D3', 'F3', 'G3', 'A3', 'C4', 'D4', 'F4', 'G4', 'A4', 'C5', 'D5',
    ]);
  });

  test('identical contact regions always produce the same note', () => {
    for (let k = 0; k < 50; k++) {
      const u = k / 50;
      expect(midiForU(u, DEFAULT_MUSIC)).toBe(midiForU(u, DEFAULT_MUSIC));
      expect(midiForU(u + 0.001, DEFAULT_MUSIC)).toBe(midiForU(u + 0.001, DEFAULT_MUSIC));
    }
  });

  test('left to right is a rising melodic progression', () => {
    const notes = playableNotes(DEFAULT_MUSIC);
    for (let i = 1; i < notes.length; i++) expect(notes[i]).toBeGreaterThan(notes[i - 1]);
  });

  test('every note belongs to the chosen scale, for every scale and root', () => {
    for (const scale of SCALE_NAMES) {
      for (let root = 0; root < 12; root++) {
        const cfg: MusicConfig = { ...DEFAULT_MUSIC, scale, root };
        for (let u = 0; u <= 1; u += 0.01) {
          expect(inScale(midiForU(u, cfg), root, scale)).toBe(true);
        }
      }
    }
  });

  test('out-of-range and invalid positions clamp to the edge regions', () => {
    expect(regionForU(-3, DEFAULT_MUSIC)).toBe(0);
    expect(regionForU(4, DEFAULT_MUSIC)).toBe(DEFAULT_MUSIC.span - 1);
    expect(regionForU(Number.NaN, DEFAULT_MUSIC)).toBe(0);
  });

  test('continuous controls stay inside their documented ranges', () => {
    for (const x of [-10, -1, 0, 0.001, 0.3, 0.5, 1, 2, 50, Number.NaN, Infinity]) {
      const b = brightnessForV(x);
      expect(b).toBeGreaterThanOrEqual(0.15);
      expect(b).toBeLessThanOrEqual(1);
      const v = velocityForStrength(x);
      expect(v).toBeGreaterThanOrEqual(0.22);
      expect(v).toBeLessThanOrEqual(1);
      expect(bendForStrain(x)).toBeGreaterThanOrEqual(0);
      expect(bendForStrain(x)).toBeLessThanOrEqual(MAX_BEND_SEMITONES);
      expect(brightnessForSpeed(x)).toBeGreaterThanOrEqual(0);
      expect(brightnessForSpeed(x)).toBeLessThanOrEqual(1);
      expect(intensityForPull(x)).toBeGreaterThanOrEqual(0);
      expect(intensityForPull(x)).toBeLessThanOrEqual(1);
      expect(Math.abs(panForU(x))).toBeLessThanOrEqual(0.55 + 1e-9);
    }
  });

  test('stretch bends pitch upward monotonically and subtly', () => {
    expect(bendForStrain(0)).toBe(0);
    expect(bendForStrain(0.02)).toBeGreaterThan(0);
    expect(bendForStrain(0.05)).toBeGreaterThan(bendForStrain(0.02));
    expect(bendForStrain(0.02)).toBeLessThan(0.5);
  });

  test('stronger strikes give louder velocities', () => {
    expect(velocityForStrength(1)).toBeGreaterThan(velocityForStrength(0.5));
    expect(velocityForStrength(0.5)).toBeGreaterThan(velocityForStrength(0));
  });
});

describe('glide quantizer', () => {
  test('a slow drag across the sheet visits each region once, in order', () => {
    const q = new NoteQuantizer(DEFAULT_MUSIC);
    const changes: number[] = [];
    for (let u = 0; u <= 1; u += 0.002) {
      const r = q.update(u);
      if (r.changed) changes.push(r.region);
    }
    expect(changes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('jitter around a region boundary does not retrigger', () => {
    const q = new NoteQuantizer(DEFAULT_MUSIC);
    const boundary = 5 / DEFAULT_MUSIC.span;
    q.update(boundary - 0.01);
    let changes = 0;
    for (let k = 0; k < 200; k++) {
      const jitter = (k % 2 === 0 ? 1 : -1) * 0.012;
      if (q.update(boundary + jitter).changed) changes++;
    }
    expect(changes).toBe(0);
  });

  test('a fast jump lands directly on the new region', () => {
    const q = new NoteQuantizer(DEFAULT_MUSIC);
    q.update(0.05);
    const r = q.update(0.95);
    expect(r.changed).toBe(true);
    expect(r.region).toBe(10);
  });
});
