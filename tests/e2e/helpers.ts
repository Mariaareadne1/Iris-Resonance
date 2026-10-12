import type { Page } from '@playwright/test';

/** What the tests read from window.__iris (enabled by ?debug=1). */
export interface IrisProbe {
  frames: number;
  audio: string;
  muted: boolean;
  notes: number;
  voices: number;
  phase: string;
  preset: string;
  demo: boolean;
  energy: number;
  gestures: Array<{ kind: string; midi: number; velocity: number; point: { u: number; v: number } }>;
}

export async function openInstrument(page: Page, query = '') {
  await page.goto(`/?debug=1${query}`);
  await page.waitForFunction(() => {
    const w = window as unknown as { __iris?: { frames: number } };
    return !!w.__iris && w.__iris.frames > 20;
  });
}

export async function probe(page: Page): Promise<IrisProbe> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i = (window as any).__iris;
    const a = i.audio.snapshot();
    return {
      frames: i.frames,
      audio: a.status,
      muted: a.muted,
      notes: a.notesPlayed,
      voices: a.voices,
      phase: i.controller.currentPhase,
      preset: i.audio.presetName,
      demo: i.getState().demo,
      energy: i.membrane.energy(),
      gestures: i.gestures.map((g: IrisProbe['gestures'][number]) => ({ kind: g.kind, midi: g.midi, velocity: g.velocity, point: g.point })),
    };
  });
}

/** Peak output RMS measured over `ms` milliseconds. */
export async function peakLevel(page: Page, ms: number): Promise<number> {
  return page.evaluate(async (dur) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i = (window as any).__iris;
    let peak = 0;
    const end = performance.now() + dur;
    while (performance.now() < end) {
      peak = Math.max(peak, i.audio.level());
      await new Promise((r) => setTimeout(r, 15));
    }
    return peak;
  }, ms);
}

/** Max displacement from rest anywhere on the sheet (world units). */
export async function maxDisplacement(page: Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (window as any).__iris.membrane;
    let max = 0;
    for (let i = 0; i < m.count; i++) {
      const j = i * 3;
      const d = Math.hypot(m.positions[j] - m.cloth.rest[j], m.positions[j + 1] - m.cloth.rest[j + 1], m.positions[j + 2] - m.cloth.rest[j + 2]);
      if (d > max) max = d;
    }
    return max;
  });
}

/** Canvas-relative point → page coordinates. */
export async function canvasPoint(page: Page, fx: number, fy: number) {
  const box = await page.getByTestId('stage-canvas').boundingBox();
  if (!box) throw new Error('canvas not found');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** A human-paced drag (so it reads as a stretch rather than a glide). */
export async function slowDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, ms = 900) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = Math.max(10, Math.round(ms / 20));
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(from.x + (to.x - from.x) * (k / steps), from.y + (to.y - from.y) * (k / steps));
    await page.waitForTimeout(ms / steps);
  }
}
