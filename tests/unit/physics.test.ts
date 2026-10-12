import { describe, expect, test } from 'vitest';
import { Membrane, type SurfacePoint } from '../../src/physics/membrane.ts';
import { ClothSim } from '../../src/physics/cloth.ts';
import { buildRestPose } from '../../src/physics/restPose.ts';

const FRAME = 1 / 60;
const still = { cloth: { viscosity: 0.05, stiffness: 1, iterations: 8, tension: 0.5 }, wave: { speed: 46, restoreHz: 1.1, decay: 1.2 }, idle: 0 };

function run(m: Membrane, seconds: number) {
  for (let t = 0; t < seconds; t += FRAME) m.step(FRAME, still);
}

/** Max |rendered − rest| over vertices whose grid distance to `pt` is in [d0, d1). */
function ringDisplacement(m: Membrane, pt: SurfacePoint, d0: number, d1: number): number {
  const { col, row } = m.gridOf(pt);
  let max = 0;
  for (let i = 0; i < m.count; i++) {
    const c = i % m.cols, r = Math.floor(i / m.cols);
    const d = Math.hypot(c - col, r - row);
    if (d < d0 || d >= d1) continue;
    const j = i * 3;
    const dd = Math.hypot(
      m.positions[j] - m.cloth.rest[j],
      m.positions[j + 1] - m.cloth.rest[j + 1],
      m.positions[j + 2] - m.cloth.rest[j + 2],
    );
    max = Math.max(max, dd);
  }
  return max;
}

function allFinite(m: Membrane) {
  return m.positions.every(Number.isFinite);
}

describe('membrane physics', () => {
  test('rest pose is an equilibrium: a still sheet stays still', () => {
    const m = new Membrane();
    run(m, 2);
    expect(ringDisplacement(m, { u: 0.5, v: 0.5 }, 0, 999)).toBeLessThan(1e-4);
  });

  test('a pluck displaces the contact region far more than the far side', () => {
    const m = new Membrane();
    const hit = { u: 0.25, v: 0.5 };
    m.pluckAt(hit, 0.8);
    run(m, 0.08);
    const near = ringDisplacement(m, hit, 0, 4);
    const far = ringDisplacement(m, { u: 0.85, v: 0.5 }, 0, 4);
    expect(near).toBeGreaterThan(0.005);
    expect(near).toBeGreaterThan(far * 5);
  });

  test('displacement propagates outward beyond the initial contact', () => {
    const m = new Membrane();
    const hit = { u: 0.5, v: 0.5 };
    m.pluckAt(hit, 1);
    run(m, 0.03);
    const ringEarly = ringDisplacement(m, hit, 14, 18);
    run(m, 0.35);
    const ringLate = ringDisplacement(m, hit, 14, 18);
    expect(ringLate).toBeGreaterThan(ringEarly * 2);
    expect(ringLate).toBeGreaterThan(0.002);
  });

  test('stronger plucks produce larger displacement', () => {
    const soft = new Membrane();
    const hard = new Membrane();
    const hit = { u: 0.4, v: 0.6 };
    soft.pluckAt(hit, 0.15);
    hard.pluckAt(hit, 1);
    run(soft, 0.1);
    run(hard, 0.1);
    const a = ringDisplacement(soft, hit, 0, 5);
    const b = ringDisplacement(hard, hit, 0, 5);
    expect(b).toBeGreaterThan(a * 2);
  });

  test('vibration decays back toward equilibrium', () => {
    const m = new Membrane();
    m.pluckAt({ u: 0.5, v: 0.5 }, 1);
    run(m, 0.2);
    const e0 = m.energy();
    run(m, 6);
    expect(e0).toBeGreaterThan(0);
    expect(m.energy()).toBeLessThan(e0 * 0.02);
    expect(ringDisplacement(m, { u: 0.5, v: 0.5 }, 0, 999)).toBeLessThan(0.01);
  });

  test('grab and stretch: grabbed region follows, neighbours lag, strain rises', () => {
    const m = new Membrane();
    const pt = { u: 0.5, v: 0.5 };
    const start = m.beginGrab(pt);
    expect(start).not.toBeNull();
    const target: [number, number, number] = [start![0] + 0.5, start![1] + 0.3, start![2] + 0.4];
    for (let i = 0; i < 40; i++) {
      m.updateGrab(target);
      m.step(FRAME, still);
    }
    const now = m.worldAt(pt);
    expect(Math.hypot(now[0] - target[0], now[1] - target[1], now[2] - target[2])).toBeLessThan(0.08);
    // a point farther away moved, but less
    const nearMove = m.getLocalDisplacement({ u: 0.56, v: 0.5 });
    const farMove = m.getLocalDisplacement({ u: 0.95, v: 0.5 });
    expect(nearMove).toBeGreaterThan(farMove);
    expect(m.getLocalStrain(pt)).toBeGreaterThan(0.005);
  });

  test('release recovers smoothly with no NaNs', () => {
    const m = new Membrane();
    const pt = { u: 0.3, v: 0.7 };
    const start = m.beginGrab(pt)!;
    for (let i = 0; i < 30; i++) {
      m.updateGrab([start[0] - 0.6, start[1] + 0.5, start[2] + 0.7]);
      m.step(FRAME, still);
    }
    const info = m.endGrab();
    expect(info).not.toBeNull();
    expect(info!.displacement).toBeGreaterThan(0.3);
    run(m, 6);
    expect(allFinite(m)).toBe(true);
    expect(ringDisplacement(m, pt, 0, 999)).toBeLessThan(0.02);
  });

  test('rapid repeated gestures remain stable and bounded', () => {
    const m = new Membrane();
    for (let k = 0; k < 200; k++) {
      const pt = { u: (k * 0.137) % 1, v: (k * 0.291) % 1 };
      m.pluckAt(pt, 1);
      if (k % 7 === 0) {
        const s = m.beginGrab(pt);
        if (s) m.updateGrab([s[0] + 2, s[1] - 2, s[2] + 3]);
      }
      m.step(FRAME, still);
      if (k % 7 === 3) m.endGrab();
    }
    m.endGrab();
    expect(allFinite(m)).toBe(true);
    expect(ringDisplacement(m, { u: 0.5, v: 0.5 }, 0, 999)).toBeLessThan(2);
    run(m, 8);
    expect(ringDisplacement(m, { u: 0.5, v: 0.5 }, 0, 999)).toBeLessThan(0.05);
  });

  test('extreme frame deltas and invalid input are ignored safely', () => {
    const m = new Membrane();
    m.step(Number.NaN);
    m.step(-1);
    m.step(10);
    m.pluckAt({ u: Number.NaN, v: 2 }, Number.POSITIVE_INFINITY);
    m.step(FRAME, still);
    expect(allFinite(m)).toBe(true);
  });

  test('reset restores the resting pose exactly', () => {
    const m = new Membrane();
    m.pluckAt({ u: 0.5, v: 0.5 }, 1);
    run(m, 0.3);
    m.reset();
    expect(ringDisplacement(m, { u: 0.5, v: 0.5 }, 0, 999)).toBe(0);
  });

  test('cloth solver rejects a mismatched rest pose', () => {
    const pose = buildRestPose({ width: 1, height: 1, cols: 5, rows: 5 });
    expect(() => new ClothSim(6, 5, pose)).toThrow();
  });
});
