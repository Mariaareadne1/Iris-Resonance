/**
 * Fabric colour palettes. Each sets the three-stop holographic ramp, the
 * centre and width of the hue arc the diffraction sweeps through, the dye
 * colour of the cloth, its sheen and the backdrop glow — so the whole sheet
 * (and its light) recolours coherently. Pitch still nudges the hue: low
 * notes lean one way, high notes the other.
 */
export interface FabricPalette {
  name: string;
  /** holographic ramp stops */
  a: string;
  b: string;
  c: string;
  /** dye colour of the cloth (seen in reflections) */
  base: string;
  sheen: string;
  /** hue arc centre (0..1) and half-width */
  hue: number;
  hueRange: number;
  saturation: number;
  /** thin-film iridescence strength — the film itself leans violet, so warm
   *  and green palettes keep it low to let their own colour through */
  film: number;
}

export const PALETTES: FabricPalette[] = [
  { name: 'Iris', a: '#9d7bff', b: '#7fe6ff', c: '#ffc2ea', base: '#3b3a5c', sheen: '#d8ccff', hue: 0.66, hueRange: 0.14, saturation: 0.85, film: 1 },
  { name: 'Pearl', a: '#e6e1ff', b: '#cfeaff', c: '#fff0f7', base: '#5d5c72', sheen: '#ffffff', hue: 0.64, hueRange: 0.1, saturation: 0.3, film: 0.7 },
  { name: 'Rose', a: '#ff8fc8', b: '#ffc9a8', c: '#c9a2ff', base: '#5a3048', sheen: '#ffd6ea', hue: 0.92, hueRange: 0.1, saturation: 0.8, film: 0.55 },
  { name: 'Aurora', a: '#5dffc3', b: '#6ad6ff', c: '#b48bff', base: '#1f3e45', sheen: '#c8fff0', hue: 0.44, hueRange: 0.16, saturation: 0.85, film: 0.25 },
  { name: 'Ember', a: '#ff9a5c', b: '#ffd36e', c: '#ff6f91', base: '#4a2a22', sheen: '#ffe0c4', hue: 0.05, hueRange: 0.08, saturation: 0.85, film: 0.2 },
  { name: 'Ice', a: '#7fd8ff', b: '#d6f6ff', c: '#8fa8ff', base: '#2a3f5c', sheen: '#e4f6ff', hue: 0.56, hueRange: 0.07, saturation: 0.7, film: 0.35 },
];

export const DEFAULT_PALETTE = PALETTES[0];

/** Palette by name (case-insensitive), or one derived from a #rrggbb colour. */
export function resolvePalette(value: string | null | undefined): FabricPalette | null {
  if (!value) return null;
  const named = PALETTES.find((p) => p.name.toLowerCase() === value.trim().toLowerCase());
  if (named) return named;
  return /^#?[0-9a-f]{6}$/i.test(value.trim()) ? paletteFromColor(value.trim().replace(/^#?/, '#')) : null;
}

/**
 * Build a harmonious palette around one chosen colour: the ramp spans a
 * narrow band of neighbouring hues, lightened, so it stays holographic
 * rather than flat.
 */
export function paletteFromColor(hex: string): FabricPalette {
  const { h, s } = hexToHsl(hex);
  const sat = Math.max(0.35, s);
  return {
    name: 'Custom',
    a: hslToHex(h, Math.min(1, sat * 0.95), 0.7),
    b: hslToHex(h + 0.09, Math.min(1, sat * 0.85), 0.8),
    c: hslToHex(h - 0.08, Math.min(1, sat * 0.75), 0.85),
    base: hslToHex(h, Math.min(0.45, sat * 0.4), 0.24),
    sheen: hslToHex(h, 0.7, 0.88),
    hue: h,
    hueRange: 0.1,
    saturation: Math.min(0.9, 0.35 + sat * 0.55),
    film: 0.3,
  };
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 1) + 1) % 1;
  const k = (n: number) => (n + hh * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
