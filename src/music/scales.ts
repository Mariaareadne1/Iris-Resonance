/** Scales as semitone offsets from the root. All forgiving — no wrong notes. */
export const SCALES = {
  'Minor pentatonic': [0, 3, 5, 7, 10],
  'Major pentatonic': [0, 2, 4, 7, 9],
  Hirajoshi: [0, 2, 3, 7, 8],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
} as const satisfies Record<string, readonly number[]>;

export type ScaleName = keyof typeof SCALES;
export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** True when `midi` is a member of `scale` rooted at pitch class `root`. */
export function inScale(midi: number, root: number, scale: ScaleName): boolean {
  const pc = (((Math.round(midi) - root) % 12) + 12) % 12;
  return (SCALES[scale] as readonly number[]).includes(pc);
}
