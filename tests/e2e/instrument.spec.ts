import { expect, test } from '@playwright/test';
import { canvasPoint, maxDisplacement, openInstrument, peakLevel, probe, slowDrag } from './helpers.ts';

test.describe('the instrument in a real browser', () => {
  test('opens straight into play mode and renders the fabric', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openInstrument(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Iris');
    await expect(page.getByText('An instrument made of light and motion.')).toBeVisible();
    await expect(page.getByText('Touch the fabric. Make a sound.')).toBeVisible();
    const sample = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const i = (window as any).__iris;
      return i.stage.samplePixels(i.visual);
    });
    // a lit, varied image — not a blank or single-color frame
    expect(sample.mean).toBeGreaterThan(8);
    expect(sample.spread).toBeGreaterThan(10);
    // audio has not autoplayed
    expect((await probe(page)).audio).toBe('off');
    expect(errors).toEqual([]);
  });

  test('a click plucks: audio starts, a note sounds, the mesh ripples', async ({ page }) => {
    await openInstrument(page);
    const p = await canvasPoint(page, 0.4, 0.5);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await probe(page)).audio).toBe('running');
    const s = await probe(page);
    expect(s.notes).toBe(1);
    expect(s.gestures[0].kind).toBe('pluck');
    expect(await maxDisplacement(page)).toBeGreaterThan(0.01);
    // the note is actually in the output signal
    expect(await peakLevel(page, 600)).toBeGreaterThan(0.005);
    await expect(page.getByRole('button', { name: 'Sound on' })).toHaveAttribute('aria-pressed', 'true');
    // the hint gives way after the first interaction
    await expect(page.locator('.hint')).toHaveClass(/is-hidden/);
  });

  test('the same spot always plays the same note; left is lower than right', async ({ page }) => {
    await openInstrument(page);
    const left = await canvasPoint(page, 0.3, 0.5);
    const right = await canvasPoint(page, 0.7, 0.5);
    for (const pt of [left, right, left, right]) {
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(250);
    }
    const midis = (await probe(page)).gestures.filter((g) => g.kind === 'pluck').map((g) => g.midi);
    expect(midis).toHaveLength(4);
    expect(midis[0]).toBe(midis[2]);
    expect(midis[1]).toBe(midis[3]);
    expect(midis[1]).toBeGreaterThan(midis[0]);
  });

  test('a slow drag stretches the fabric with a sustained, bending tone', async ({ page }) => {
    await openInstrument(page);
    const from = await canvasPoint(page, 0.45, 0.55);
    const to = await canvasPoint(page, 0.6, 0.3);
    await slowDrag(page, from, to, 1000);
    const held = await probe(page);
    expect(held.phase).toBe('stretching');
    expect(held.gestures.some((g) => g.kind === 'stretch-start')).toBe(true);
    expect(await maxDisplacement(page)).toBeGreaterThan(0.3);
    const strain = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const i = (window as any).__iris;
      const last = i.gestures[i.gestures.length - 1];
      return i.membrane.getLocalStrain(last.point);
    });
    expect(strain).toBeGreaterThan(0);
    expect(await peakLevel(page, 400)).toBeGreaterThan(0.005);
    await page.mouse.up();
    const after = await probe(page);
    expect(after.phase).toBe('idle');
    expect(after.gestures[after.gestures.length - 1].kind).toBe('release');
    // and it settles back home
    await page.waitForTimeout(3500);
    expect(await maxDisplacement(page)).toBeLessThan(0.08);
  });

  test('a quick sweep glides through rising notes', async ({ page }) => {
    await openInstrument(page);
    const a = await canvasPoint(page, 0.3, 0.42);
    const b = await canvasPoint(page, 0.72, 0.42);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let k = 1; k <= 30; k++) {
      await page.mouse.move(a.x + (b.x - a.x) * (k / 30), a.y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    const notes = (await probe(page)).gestures.filter((g) => g.kind === 'pluck' || g.kind === 'glide-note').map((g) => g.midi);
    expect(notes.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < notes.length; i++) expect(notes[i]).toBeGreaterThan(notes[i - 1]);
  });

  test('presets switch the timbre engine', async ({ page }) => {
    await openInstrument(page);
    const p = await canvasPoint(page, 0.5, 0.5);
    await page.mouse.click(p.x, p.y);
    for (const name of ['Silk', 'Ether', 'Glass']) {
      await page.getByRole('radio', { name }).first().click();
      await expect.poll(async () => (await probe(page)).preset).toBe(name);
      await page.mouse.click(p.x, p.y);
      expect(await peakLevel(page, 500)).toBeGreaterThan(0.003);
    }
  });

  test('mute silences notes and the button reflects real state', async ({ page }) => {
    await openInstrument(page);
    const p = await canvasPoint(page, 0.5, 0.5);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await probe(page)).audio).toBe('running');
    await page.waitForTimeout(3000); // let the first note ring out
    await page.getByRole('button', { name: 'Sound on' }).click();
    await expect(page.getByRole('button', { name: 'Muted' })).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(300); // the mute is a short click-free fade (τ 30 ms), not a hard cut
    const before = (await probe(page)).notes;
    await page.mouse.click(p.x, p.y);
    expect((await probe(page)).notes).toBe(before);
    expect(await peakLevel(page, 500)).toBeLessThan(0.002);
    expect(await maxDisplacement(page)).toBeGreaterThan(0.005); // still visually alive
    await page.getByRole('button', { name: 'Muted' }).click();
    await page.mouse.click(p.x, p.y);
    expect(await peakLevel(page, 500)).toBeGreaterThan(0.003);
  });

  test('reset returns the fabric to rest', async ({ page }) => {
    await openInstrument(page);
    const from = await canvasPoint(page, 0.5, 0.5);
    await slowDrag(page, from, await canvasPoint(page, 0.6, 0.35), 1000);
    expect(await maxDisplacement(page)).toBeGreaterThan(0.1);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Reset fabric' }).click();
    expect(await maxDisplacement(page)).toBeLessThan(0.05);
  });

  test('keyboard plays the regions left to right', async ({ page }) => {
    await openInstrument(page);
    await page.keyboard.press('a');
    await page.keyboard.press('h');
    await page.keyboard.press("'");
    const midis = (await probe(page)).gestures.map((g) => g.midi);
    expect(midis).toHaveLength(3);
    expect(midis[0]).toBeLessThan(midis[1]);
    expect(midis[1]).toBeLessThan(midis[2]);
    await expect.poll(async () => (await probe(page)).audio).toBe('running');
  });

  test('studio controls change the instrument', async ({ page }) => {
    await openInstrument(page);
    await page.getByRole('button', { name: 'Customize' }).click();
    const studio = page.getByRole('complementary', { name: 'Studio settings' });
    await expect(studio).toBeVisible();
    await studio.getByLabel('Root').selectOption({ label: 'A' });
    await studio.getByLabel('Scale').selectOption('Major pentatonic');
    await page.keyboard.press('Escape');
    await page.locator('#stage').click({ position: { x: 5, y: 5 } }); // move focus off the selects
    await page.keyboard.press('a');
    const midi = (await probe(page)).gestures[0].midi;
    expect(((midi % 12) + 12) % 12).toBe(9); // lowest region is the new root, A
  });

  test('fabric colour: swatches and the custom picker recolour the shader', async ({ page }) => {
    await openInstrument(page);
    const hue = () => page.evaluate(() => (window as unknown as { __iris: { stage: { uniforms: { uHueCenter: { value: number } } } } }).__iris.stage.uniforms.uHueCenter.value);
    expect(await hue()).toBeCloseTo(0.66, 3);
    await page.getByRole('button', { name: 'Customize' }).click();
    await page.getByRole('radio', { name: 'Ember' }).click();
    expect(await hue()).toBeCloseTo(0.05, 3);
    await page.locator('.swatch-custom input[type=color]').fill('#00c2a8');
    expect(await hue()).toBeCloseTo(0.476, 2);
  });

  test('?fabric= sets the initial colour (for matching a portfolio)', async ({ page }) => {
    await openInstrument(page, '&fabric=rose');
    const hue = await page.evaluate(() => (window as unknown as { __iris: { stage: { uniforms: { uHueCenter: { value: number } } } } }).__iris.stage.uniforms.uHueCenter.value);
    expect(hue).toBeCloseTo(0.92, 3);
  });
});
