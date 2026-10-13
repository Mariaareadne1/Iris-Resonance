/**
 * 2× grid refinement for rendering: the simulation runs on a coarse grid,
 * the GPU draws a grid with a new vertex between every pair of simulated
 * ones. New vertices use the Catmull-Rom midpoint rule (−1, 9, 9, −1)/16,
 * which passes exactly through the simulated points, reproduces linear
 * fields exactly and keeps creases smooth instead of faceted.
 */
export function fineSize(cols: number, rows: number) {
  return { cols: cols * 2 - 1, rows: rows * 2 - 1 };
}

/**
 * Upsample an interleaved field with `stride` floats per vertex.
 * `scratch` must hold rows × fineCols × stride floats.
 */
export function upsampleGrid(
  src: Float32Array,
  cols: number,
  rows: number,
  stride: number,
  scratch: Float32Array,
  out: Float32Array,
) {
  const fc = cols * 2 - 1;
  const at = (x: number, max: number) => (x < 0 ? 0 : x > max ? max : x);
  // horizontal pass: coarse rows → fine columns
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = (r * cols + c) * stride;
      const d = (r * fc + c * 2) * stride;
      for (let k = 0; k < stride; k++) scratch[d + k] = src[s + k];
      if (c === cols - 1) continue;
      const i0 = (r * cols + at(c - 1, cols - 1)) * stride;
      const i1 = s;
      const i2 = (r * cols + c + 1) * stride;
      const i3 = (r * cols + at(c + 2, cols - 1)) * stride;
      const m = d + stride;
      for (let k = 0; k < stride; k++) {
        scratch[m + k] = (-src[i0 + k] + 9 * src[i1 + k] + 9 * src[i2 + k] - src[i3 + k]) / 16;
      }
    }
  }
  // vertical pass: fine columns → fine rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < fc; c++) {
      const s = (r * fc + c) * stride;
      const d = (r * 2 * fc + c) * stride;
      for (let k = 0; k < stride; k++) out[d + k] = scratch[s + k];
      if (r === rows - 1) continue;
      const i0 = (at(r - 1, rows - 1) * fc + c) * stride;
      const i2 = ((r + 1) * fc + c) * stride;
      const i3 = (at(r + 2, rows - 1) * fc + c) * stride;
      const m = ((r * 2 + 1) * fc + c) * stride;
      for (let k = 0; k < stride; k++) {
        out[m + k] = (-scratch[i0 + k] + 9 * scratch[s + k] + 9 * scratch[i2 + k] - scratch[i3 + k]) / 16;
      }
    }
  }
}
