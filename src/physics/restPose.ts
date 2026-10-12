/**
 * The membrane's sculptural resting shape.
 *
 * Iris Cloth started from a hand-baked drape (BAKED_POSE). An instrument
 * needs a shape that reads left → right as low → high, so the resting pose
 * here is parametric: a wide sheet with a slow S-shaped billow and a gentle
 * twist, facing the camera. Because the cloth's constraint rest lengths are
 * measured from this pose, it is an exact physical equilibrium — the sheet
 * returns to it after every gesture.
 */
export interface RestPoseSpec {
  width: number;
  height: number;
  cols: number;
  rows: number;
}

export const DEFAULT_POSE: RestPoseSpec = {
  width: 3.6,
  height: 2.3,
  cols: 61,
  rows: 39,
};

/** Grid vertex positions (row-major, row 0 = top edge), xyz interleaved. */
export function buildRestPose(spec: RestPoseSpec): Float32Array {
  const { width, height, cols, rows } = spec;
  const out = new Float32Array(cols * rows * 3);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1); // 0 top → 1 bottom
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1); // 0 left → 1 right
      const sx = u - 0.5;
      const sy = 0.5 - v;
      // slow S-billow across the width, deeper toward the lower hem
      const billow = 0.38 * Math.sin(Math.PI * 2 * (u * 0.78 + 0.08)) * (0.5 + 0.5 * v);
      // soft belly so the center sits slightly forward
      const belly = 0.16 * Math.cos(Math.PI * sx) * Math.cos(Math.PI * sy * 0.9);
      // twist: right side leans back, left side toward the viewer
      const twist = -0.3 * sx * (0.3 + v * 0.7);
      // the lower hem lifts a little toward the right, like a sail in air
      const hem = 0.06 * v * v * Math.sin(Math.PI * u);
      // soft diagonal folds that catch the light in bands, fading toward the
      // top edge as if the fabric hangs from it
      const fall = Math.pow(v, 0.8);
      const folds = fall * (
        0.1 * Math.sin(Math.PI * 2 * (1.35 * u + 0.55 * v) + 0.6) +
        0.06 * Math.sin(Math.PI * 2 * (2.3 * u - 0.4 * v) + 1.9)
      );
      out[k++] = sx * width;
      out[k++] = sy * height + hem;
      out[k++] = billow + belly + twist + folds;
    }
  }
  return out;
}
