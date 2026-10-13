import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs in real Chromium. Default: against the Vite dev server.
 * E2E_PROD=1: builds and serves the production bundle instead.
 * GPU: headless Chrome on Apple Silicon can use Metal; elsewhere set
 * E2E_SWIFTSHADER=1 to fall back to software WebGL (much slower).
 */
const prod = process.env.E2E_PROD === '1';
const port = prod ? 4199 : 5310;
const gpuArgs = process.env.E2E_SWIFTSHADER === '1'
  ? ['--enable-unsafe-swiftshader']
  : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions: { args: gpuArgs } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: prod ? 'npm run build && npm run preview' : 'npm run dev',
    port,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
