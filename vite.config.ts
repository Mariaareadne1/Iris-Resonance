import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5310,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // physics/audio tests simulate seconds of real time; allow for busy CI machines
    testTimeout: 60_000,
  },
} as Parameters<typeof defineConfig>[0]);
