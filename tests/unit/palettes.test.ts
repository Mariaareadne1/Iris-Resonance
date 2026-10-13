import { describe, expect, test } from 'vitest';
import { PALETTES, hexToHsl, paletteFromColor, resolvePalette } from '../../src/presets/palettes.ts';
import { DEFAULT_SETTINGS, paletteFor } from '../../src/presets/settings.ts';

const HEX = /^#[0-9a-f]{6}$/;

describe('fabric palettes', () => {
  test('every curated palette is well-formed', () => {
    for (const p of PALETTES) {
      for (const c of [p.a, p.b, p.c, p.base, p.sheen]) expect(c).toMatch(HEX);
      expect(p.hue).toBeGreaterThanOrEqual(0);
      expect(p.hue).toBeLessThan(1);
    }
  });

  test('names resolve case-insensitively; junk does not', () => {
    expect(resolvePalette('rose')?.name).toBe('Rose');
    expect(resolvePalette(' AURORA ')?.name).toBe('Aurora');
    expect(resolvePalette('plaid')).toBeNull();
    expect(resolvePalette('#12345')).toBeNull();
    expect(resolvePalette(null)).toBeNull();
  });

  test('a custom colour yields a valid palette centred on its hue', () => {
    for (const hex of ['#ff8800', '#00c2a8', '#3355ff', '#777777']) {
      const p = paletteFromColor(hex);
      for (const c of [p.a, p.b, p.c, p.base, p.sheen]) expect(c).toMatch(HEX);
      expect(p.hue).toBeCloseTo(hexToHsl(hex).h, 5);
      expect(resolvePalette(hex.slice(1))?.hue).toBeCloseTo(p.hue, 5); // works without '#'
    }
  });

  test('settings select the default, a named palette, or the custom colour', () => {
    expect(paletteFor(DEFAULT_SETTINGS).name).toBe('Iris');
    expect(paletteFor({ ...DEFAULT_SETTINGS, fabric: 'Ember' }).name).toBe('Ember');
    expect(paletteFor({ ...DEFAULT_SETTINGS, fabric: 'Custom', fabricColor: '#00c2a8' }).hue).toBeCloseTo(hexToHsl('#00c2a8').h, 5);
  });
});
