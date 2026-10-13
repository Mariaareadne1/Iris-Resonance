import { describe, expect, test } from 'vitest';
import { fineSize, upsampleGrid } from '../../src/rendering/upsample.ts';

function run(src: Float32Array, cols: number, rows: number, stride: number) {
  const f = fineSize(cols, rows);
  const scratch = new Float32Array(rows * f.cols * stride);
  const out = new Float32Array(f.cols * f.rows * stride);
  upsampleGrid(src, cols, rows, stride, scratch, out);
  return { out, ...f };
}

describe('render-mesh upsampling', () => {
  test('passes exactly through every simulated vertex', () => {
    const cols = 7, rows = 5;
    const src = Float32Array.from({ length: cols * rows * 3 }, (_, i) => Math.sin(i * 1.7) * 3);
    const { out, cols: fc } = run(src, cols, rows, 3);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (let k = 0; k < 3; k++) {
          expect(out[((r * 2) * fc + c * 2) * 3 + k]).toBeCloseTo(src[(r * cols + c) * 3 + k], 6);
        }
      }
    }
  });

  test('reproduces a linear field exactly in the interior', () => {
    const cols = 6, rows = 6;
    const src = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) src[r * cols + c] = 2 * c - 3 * r + 1;
    const { out, cols: fc, rows: fr } = run(src, cols, rows, 1);
    for (let r = 2; r < fr - 2; r++) {
      for (let c = 2; c < fc - 2; c++) {
        expect(out[r * fc + c]).toBeCloseTo(2 * (c / 2) - 3 * (r / 2) + 1, 5);
      }
    }
  });

  test('a grid-scale zig-zag is not amplified', () => {
    const cols = 9, rows = 3;
    const src = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) src[r * cols + c] = c % 2 === 0 ? 1 : -1;
    const { out } = run(src, cols, rows, 1);
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1.0001);
  });
});
