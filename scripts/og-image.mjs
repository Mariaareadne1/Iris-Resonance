#!/usr/bin/env node
/**
 * Generate public/og-image.jpg (1200×630) and README screenshots from the
 * running app.   npm run dev   then   node scripts/og-image.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const base = process.argv[2] ?? 'http://localhost:5310';
const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
const jpg = (src, dst, q = 3) => {
  spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-q:v', String(q), dst]);
  rmSync(src);
};
mkdirSync('docs/screens', { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

// Open Graph card: clean view, mid-ripple, title overlaid by the page itself
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.goto(`${base}/?debug=1`);
await og.waitForFunction(() => window.__iris && window.__iris.frames > 30);
await og.evaluate(() => {
  document.querySelector('.dock')?.remove();
  document.querySelector('.hint')?.remove();
  window.__iris.controller.pluck({ u: 0.36, v: 0.55 }, 0.9);
});
await og.waitForTimeout(450);
await og.screenshot({ path: 'public/og-image.png' });
jpg('public/og-image.png', 'public/og-image.jpg', 4);

// README shots
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/?debug=1`);
await page.waitForFunction(() => window.__iris && window.__iris.frames > 30);
await page.waitForTimeout(800);
await page.screenshot({ path: 'docs/screens/play-mode.png' });
jpg('docs/screens/play-mode.png', 'docs/screens/play-mode.jpg');

await page.evaluate(() => window.__iris.controller.pluck({ u: 0.4, v: 0.5 }, 1));
await page.waitForTimeout(500);
await page.screenshot({ path: 'docs/screens/pluck.png' });
jpg('docs/screens/pluck.png', 'docs/screens/pluck.jpg');

await page.waitForTimeout(2500);
const box = await page.getByTestId('stage-canvas').boundingBox();
const from = { x: box.width * 0.44, y: box.height * 0.6 }, to = { x: box.width * 0.58, y: box.height * 0.34 };
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let k = 1; k <= 50; k++) {
  await page.mouse.move(from.x + (to.x - from.x) * (k / 50), from.y + (to.y - from.y) * (k / 50));
  await page.waitForTimeout(20);
}
await page.waitForTimeout(300);
await page.screenshot({ path: 'docs/screens/stretch.png' });
jpg('docs/screens/stretch.png', 'docs/screens/stretch.jpg');
await page.mouse.up();
await page.waitForTimeout(220);
await page.screenshot({ path: 'docs/screens/release.png' });
jpg('docs/screens/release.png', 'docs/screens/release.jpg');

await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Customize' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'docs/screens/studio.png' });
jpg('docs/screens/studio.png', 'docs/screens/studio.jpg');

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(`${base}/`);
await mobile.waitForTimeout(2500);
await mobile.screenshot({ path: 'docs/screens/mobile.png' });
jpg('docs/screens/mobile.png', 'docs/screens/mobile.jpg');

await browser.close();
console.log('wrote public/og-image.jpg and docs/screens/*.jpg');
