#!/usr/bin/env node
/**
 * Capture reference screenshots of the running app with headless Chrome.
 *   node scripts/snap.mjs [baseUrl] [outDir]
 * Shots: idle, just after a pluck, mid-stretch, studio panel, mobile, embed.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5310';
const out = process.argv[3] ?? 'docs/screens';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${base}/?debug=1`);
await page.waitForFunction(() => window.__iris && window.__iris.frames > 30);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/01-idle.png` });

const canvas = page.getByTestId('stage-canvas');
const box = await canvas.boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

let p = at(0.36, 0.5);
await page.mouse.move(p.x - 60, p.y - 30);
await page.mouse.move(p.x, p.y, { steps: 2 });
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(180);
await page.screenshot({ path: `${out}/02-pluck-180ms.png` });
await page.waitForTimeout(420);
await page.screenshot({ path: `${out}/03-pluck-600ms.png` });

await page.waitForTimeout(1500);
p = at(0.42, 0.62);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
const q = at(0.6, 0.3);
// a slow, human-paced pull (~1 s) so it registers as a stretch, not a glide
for (let k = 1; k <= 50; k++) {
  await page.mouse.move(p.x + (q.x - p.x) * (k / 50), p.y + (q.y - p.y) * (k / 50));
  await page.waitForTimeout(20);
}
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/04-stretch.png` });
await page.mouse.up();
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/05-release.png` });

await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Customize' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/06-studio.png` });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(`${base}/`);
await mobile.waitForTimeout(2500);
await mobile.screenshot({ path: `${out}/07-mobile.png` });

const embed = await browser.newPage({ viewport: { width: 800, height: 500 } });
await embed.goto(`${base}/?embed=1`);
await embed.waitForTimeout(2500);
await embed.screenshot({ path: `${out}/08-embed.png` });

console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
