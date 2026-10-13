import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { canvasPoint, openInstrument, probe } from './helpers.ts';

// portable ffmpeg from the ffmpeg-static dev dependency (no system install needed)
const ffmpegPath: string | null = createRequire(import.meta.url)('ffmpeg-static');

interface MediaInfo {
  video: { codec: string; width: number; height: number } | null;
  audio: { codec: string } | null;
  /** seconds actually decoded */
  decoded: number;
  /** loudest sample in dBFS */
  maxVolumeDb: number;
}

/** Fully decode a recording with ffmpeg and report its streams and loudness. */
function inspectMedia(file: string): MediaInfo {
  const r = spawnSync(ffmpegPath!, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr;
  const input = log.slice(log.indexOf('Input #0'), log.indexOf('Output #0'));
  const v = /Stream #\d+:\d+.*?: Video: (\w+).*?, (\d{2,5})x(\d{2,5})/.exec(input);
  const a = /Stream #\d+:\d+.*?: Audio: (\w+)/.exec(input);
  const times = [...log.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const t = times.at(-1);
  return {
    video: v ? { codec: v[1], width: Number(v[2]), height: Number(v[3]) } : null,
    audio: a ? { codec: a[1] } : null,
    decoded: t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : 0,
    maxVolumeDb: Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1] ?? -Infinity),
  };
}

test.describe('capture', () => {
  test('Save image downloads a real PNG of the scene', async ({ page }, info) => {
    await openInstrument(page);
    await page.getByRole('button', { name: 'Capture' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /Save image/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^iris-resonance-.*\.png$/);
    const file = info.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG signature
    expect(bytes.length).toBeGreaterThan(200_000); // hi-res, not an empty frame
    // IHDR width/height
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    expect(width).toBeGreaterThanOrEqual(2560);
    expect(height).toBeGreaterThanOrEqual(1600);
  });

  test('Record video produces a file with real video and audio tracks', async ({ page }, info) => {
    test.skip(!ffmpegPath, 'ffmpeg-static binary unavailable on this platform');
    await openInstrument(page);
    await page.getByRole('button', { name: 'Capture' }).click();
    await page.getByRole('menuitem', { name: /Record video/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Recording with sound' })).toBeVisible();
    // play during the recording
    for (const fx of [0.3, 0.5, 0.7, 0.4]) {
      const p = await canvasPoint(page, fx, 0.5);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(700);
    }
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Stop & save' }).click(),
    ]);
    const name = download.suggestedFilename();
    const file = info.outputPath(name);
    await download.saveAs(file);
    const state = await page.evaluate(() => (window as unknown as { __iris: { getState(): { lastRecording: { mimeType: string; hasAudio: boolean } } } }).__iris.getState().lastRecording);
    // the extension matches the container the browser really produced
    expect(name.endsWith(state.mimeType.includes('mp4') ? '.mp4' : '.webm')).toBe(true);
    expect(state.hasAudio).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(50_000);

    const media = inspectMedia(file);
    expect(media.video).not.toBeNull();
    expect(media.audio).not.toBeNull();
    expect(media.video!.width).toBeGreaterThan(0);
    expect(media.decoded).toBeGreaterThan(2); // decodes end to end
    // the recorded audio actually contains the notes, not silence
    expect(media.maxVolumeDb).toBeGreaterThan(-40);
    test.info().annotations.push({
      type: 'recording',
      description: `${name}: ${media.video!.codec}+${media.audio!.codec} ${media.video!.width}x${media.video!.height}, ${media.decoded.toFixed(1)} s, peak ${media.maxVolumeDb} dB`,
    });
  });
});

test.describe('showcase', () => {
  test('Play demo performs on the real instrument and can be interrupted', async ({ page }) => {
    test.setTimeout(90_000);
    await openInstrument(page);
    await page.getByRole('button', { name: 'Play demo' }).click();
    await expect.poll(async () => (await probe(page)).audio).toBe('running');
    expect((await probe(page)).demo).toBe(true);
    await page.waitForTimeout(6000);
    const mid = await probe(page);
    const kinds = mid.gestures.map((g) => g.kind);
    expect(kinds.filter((k) => k === 'pluck').length).toBeGreaterThanOrEqual(4);
    expect(kinds).toContain('stretch-start');
    // runs to completion on its own
    await expect.poll(async () => (await probe(page)).demo, { timeout: 15_000 }).toBe(false);
    const done = await probe(page);
    expect(done.gestures.map((g) => g.kind)).toContain('glide-note');
    expect(done.gestures.map((g) => g.kind)).toContain('release');
    // replay, then interrupt by touching the fabric
    await page.getByRole('button', { name: 'Play demo' }).click();
    await expect.poll(async () => (await probe(page)).demo).toBe(true);
    const p = await canvasPoint(page, 0.5, 0.5);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await probe(page)).demo).toBe(false);
  });
});

test.describe('embedding', () => {
  test('?embed=1 is compact and never starts sound by itself', async ({ page }) => {
    await openInstrument(page, '&embed=1');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Customize' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enable sound' })).toBeVisible();
    const p = await canvasPoint(page, 0.5, 0.5);
    await page.mouse.click(p.x, p.y);
    const s = await probe(page);
    expect(s.audio).toBe('off'); // touching the fabric in an embed stays silent
    expect(s.gestures[0].kind).toBe('pluck'); // but it still plays visually
    await page.getByRole('button', { name: 'Enable sound' }).click();
    await expect.poll(async () => (await probe(page)).audio).toBe('running');
  });

  test('inside an iframe it resizes and lets the host page scroll', async ({ page, baseURL }) => {
    await page.setContent(`
      <body style="margin:0;background:#111">
        <div style="height:300px"></div>
        <iframe id="f" src="${baseURL}/?embed=1&debug=1" style="width:640px;height:360px;border:0" allow="autoplay"></iframe>
        <div style="height:2000px"></div>
      </body>`);
    const frame = page.frameLocator('#f');
    await expect(frame.getByTestId('stage-canvas')).toBeVisible();
    const handle = await page.$('#f');
    const inner = await handle!.contentFrame();
    await inner!.waitForFunction(() => (window as unknown as { __iris?: { frames: number } }).__iris?.frames! > 20);
    const size = await inner!.evaluate(() => {
      const c = document.querySelector('canvas')!;
      return { w: c.clientWidth, h: c.clientHeight };
    });
    expect(size).toEqual({ w: 640, h: 360 });
    // the wheel over the embed scrolls the host page (the instrument never captures it)
    await page.mouse.move(320, 300 + 180);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });
});

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a tap on a phone plucks the fabric; controls fit the screen', async ({ page }) => {
    await openInstrument(page);
    const p = await canvasPoint(page, 0.5, 0.48);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(async () => (await probe(page)).gestures.length).toBeGreaterThan(0);
    expect((await probe(page)).gestures[0].kind).toBe('pluck');
    const dock = await page.getByRole('navigation', { name: 'Instrument controls' }).boundingBox();
    expect(dock!.x).toBeGreaterThanOrEqual(0);
    expect(dock!.x + dock!.width).toBeLessThanOrEqual(390);
    // icon-only buttons on phones still have accessible names
    for (const name of ['Play demo', 'Capture', 'Reset fabric', 'Customize']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
  });
});

test.describe('audio in real Chrome', () => {
  test('a held tone glides between notes (OfflineAudioContext)', async ({ page }) => {
    test.skip(process.env.E2E_PROD === '1' || !!process.env.E2E_BASE_URL, 'imports source modules from the dev server');
    await page.goto('/');
    const detected = await page.evaluate(async () => {
      const { AudioGraph } = await import('/src/audio/graph.ts' as string);
      const { SOUND_PRESETS } = await import('/src/presets/sound.ts' as string);
      const sr = 44100;
      const ctx = new OfflineAudioContext(1, sr * 3, sr);
      const g = new AudioGraph(ctx, SOUND_PRESETS.Silk, 62);
      g.sustainStart({ midi: 62, bend: 0, intensity: 0.8, brightness: 0.5, pan: 0 }, 0);
      g.sustainUpdate({ midi: 69, bend: 0, intensity: 0.8, brightness: 0.5, pan: 0 }, 1.2);
      g.sustainEnd(2.4);
      const buf = await ctx.startRendering();
      const x = buf.getChannelData(0);
      const dominant = (t0: number, t1: number) => {
        let best = 0, bestMag = -1;
        for (let m = 40; m <= 90; m++) {
          const f = 440 * Math.pow(2, (m - 69) / 12);
          const w = (2 * Math.PI * f) / sr, c = 2 * Math.cos(w);
          let s1 = 0, s2 = 0;
          for (let i = Math.floor(t0 * sr); i < Math.floor(t1 * sr); i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
          const mag = s1 * s1 + s2 * s2 - c * s1 * s2;
          if (mag > bestMag) { bestMag = mag; best = m; }
        }
        return best;
      };
      return [dominant(0.5, 1.1), dominant(1.6, 2.3)];
    });
    expect(detected).toEqual([62, 69]);
  });
});
