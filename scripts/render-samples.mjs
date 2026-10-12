#!/usr/bin/env node
/**
 * Render a short phrase per preset through the real AudioGraph in Chrome's
 * OfflineAudioContext, print objective measurements, and write samples.
 *
 *   npm run dev            (in another terminal)
 *   npm run samples [-- http://localhost:5310]
 *
 * Output: docs/audio/{glass,silk,ether}.m4a and a measurement report.
 * Chrome is used rather than a Node Web Audio polyfill because Chrome's
 * AudioParam automation is the ground truth the app runs on.
 */
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const base = process.argv[2] ?? 'http://localhost:5310';
const OUT = 'docs/audio';
const SR = 48000;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base);
const renders = await page.evaluate(async (SR) => {
  const { AudioGraph } = await import('/src/audio/graph.ts');
  const { SOUND_PRESETS, PRESET_NAMES } = await import('/src/presets/sound.ts');
  const { DEFAULT_MUSIC, degreeToMidi } = await import('/src/music/mapping.ts');
  const result = {};
  for (const preset of PRESET_NAMES) {
    const ctx = new OfflineAudioContext(2, SR * 13, SR);
    const g = new AudioGraph(ctx, SOUND_PRESETS[preset], degreeToMidi(0, DEFAULT_MUSIC));
    const cfg = { ...DEFAULT_MUSIC, octave: DEFAULT_MUSIC.octave + SOUND_PRESETS[preset].octaveShift };
    const n = (deg) => degreeToMidi(deg, cfg);
    const note = (deg, at, velocity, u, v = 0.6) =>
      g.pluck({ midi: n(deg), velocity, brightness: 0.15 + 0.85 * v, pan: (u - 0.5) * 1.1 }, at);
    // the showcase phrase: three plucks, a stretch, a rising glide, a final note
    note(1, 0.3, 0.7, 0.14);
    note(5, 1.5, 0.6, 0.52);
    note(7, 2.15, 0.55, 0.7);
    note(3, 3.4, 0.35, 0.31, 0.36);
    g.sustainStart({ midi: n(3), bend: 0, intensity: 0.2, brightness: 0.3, pan: -0.2 }, 3.5);
    for (let k = 1; k <= 30; k++) {
      const x = k / 30;
      g.sustainUpdate({ midi: n(3), bend: 1.1 * x, intensity: 0.2 + 0.6 * x, brightness: 0.3 + 0.3 * x, pan: -0.2 }, 3.5 + x * 2.6);
    }
    g.sustainEnd(6.7);
    note(3, 6.7, 0.55, 0.31, 0.36);
    [2, 3, 4, 5, 6, 7, 8, 9].forEach((deg, i) => note(deg, 7.7 + i * 0.13, 0.45 + i * 0.03, 0.18 + i * 0.09, 0.7));
    note(5, 10.0, 0.85, 0.5, 0.52);
    const buf = await ctx.startRendering();
    result[preset] = [Array.from(buf.getChannelData(0)), Array.from(buf.getChannelData(1))];
  }
  return result;
}, SR);
await browser.close();

function analyse(l, r) {
  let peak = 0, sum = 0;
  for (let i = 0; i < l.length; i++) {
    peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
    sum += (l[i] * l[i] + r[i] * r[i]) / 2;
  }
  // spectral centroid (Hann-windowed DFT, 4096 samples) of the first note
  const a = Math.floor(0.32 * SR), len = 4096;
  let num = 0, den = 0;
  for (let k = 1; k < len / 2; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < len; i++) {
      const x = l[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
      re += x * Math.cos((2 * Math.PI * k * i) / len);
      im -= x * Math.sin((2 * Math.PI * k * i) / len);
    }
    const mag = Math.hypot(re, im);
    num += mag * ((k * SR) / len);
    den += mag;
  }
  const seg = (t0, t1) => {
    let s = 0;
    for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) s += l[i] * l[i];
    return Math.sqrt(s / ((t1 - t0) * SR));
  };
  return {
    peakDb: 20 * Math.log10(peak),
    rmsDb: 20 * Math.log10(Math.sqrt(sum / l.length)),
    centroidHz: num / den,
    stretchDb: 20 * Math.log10(seg(5.6, 6.6)),
    tailDb: 20 * Math.log10(seg(12.5, 13) / seg(10.0, 11.0)),
  };
}

function wav(l, r) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  return buf;
}

mkdirSync(OUT, { recursive: true });
const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
for (const [preset, [l, r]] of Object.entries(renders)) {
  const m = analyse(l, r);
  console.log(
    `${preset.padEnd(6)} peak ${m.peakDb.toFixed(1)} dBFS · rms ${m.rmsDb.toFixed(1)} dBFS · ` +
    `first-note centroid ${Math.round(m.centroidHz)} Hz · stretch ${m.stretchDb.toFixed(1)} dBFS · ` +
    `final-note tail ${m.tailDb.toFixed(1)} dB`,
  );
  const wavPath = `${OUT}/${preset.toLowerCase()}.wav`;
  writeFileSync(wavPath, wav(l, r));
  if (ffmpeg) {
    spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', wavPath, '-c:a', 'aac', '-b:a', '160k', `${OUT}/${preset.toLowerCase()}.m4a`]);
    rmSync(wavPath);
  }
}
