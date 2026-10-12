/**
 * Transverse vibration of the membrane: a damped 2D wave equation on the
 * cloth's grid, integrated with Verlet at a fixed 240 Hz.
 *
 *   ∂²h/∂t² = c²∇²h − ω₀²h − (damping)
 *
 * h is displacement along the surface normal (world units). The cloth solver
 * handles large, slow shape changes (grab, stretch, sway); this field carries
 * the fast ripples a pluck sends across the surface. Edges are fixed (h = 0)
 * like a drumhead, so waves reflect and form soft standing patterns.
 */

export interface WaveParams {
  /** wave speed, grid cells per second */
  speed: number;
  /** restoring frequency in Hz — the slow "breathing" of the whole sheet */
  restoreHz: number;
  /** amplitude decay time constant in seconds */
  decay: number;
}

export const DEFAULT_WAVE_PARAMS: WaveParams = {
  speed: 46,
  restoreHz: 1.1,
  decay: 1.2,
};

export const WAVE_SUBSTEP = 1 / 240;
const MAX_SUBSTEPS = 8;
/** amplitude ceiling (world units) so stacked plucks can't tear the mesh */
const MAX_AMPLITUDE = 0.32;

export class WaveField {
  readonly count: number;
  readonly h: Float32Array;
  private hPrev: Float32Array;
  private next: Float32Array;
  private accumulator = 0;

  constructor(readonly cols: number, readonly rows: number) {
    this.count = cols * rows;
    this.h = new Float32Array(this.count);
    this.hPrev = new Float32Array(this.count);
    this.next = new Float32Array(this.count);
  }

  reset() {
    this.h.fill(0);
    this.hPrev.fill(0);
    this.accumulator = 0;
  }

  /**
   * Strike the membrane: a Gaussian velocity impulse centered at grid
   * coordinates (col,row). `amplitude` is the initial speed scale.
   */
  strike(col: number, row: number, amplitude: number, radiusCells: number) {
    const r = Math.max(1, radiusCells);
    const reach = Math.ceil(r * 3);
    const c0 = Math.max(1, Math.floor(col - reach));
    const c1 = Math.min(this.cols - 2, Math.ceil(col + reach));
    const r0 = Math.max(1, Math.floor(row - reach));
    const r1 = Math.min(this.rows - 2, Math.ceil(row + reach));
    const inv = 1 / (2 * r * r);
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const d2 = (x - col) * (x - col) + (y - row) * (y - row);
        const g = Math.exp(-d2 * inv);
        // velocity impulse in Verlet form: shift the previous state
        this.hPrev[y * this.cols + x] -= amplitude * g * WAVE_SUBSTEP;
      }
    }
  }

  step(dt: number, params: WaveParams) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 0.05);
    let steps = 0;
    while (this.accumulator >= WAVE_SUBSTEP && steps < MAX_SUBSTEPS) {
      this.substep(params);
      this.accumulator -= WAVE_SUBSTEP;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0;
  }

  private substep(params: WaveParams) {
    const { cols, rows } = this;
    const h = this.h, hp = this.hPrev, nx = this.next;
    const dt2 = WAVE_SUBSTEP * WAVE_SUBSTEP;
    // c² in cells²/s²; clamp for stability (c·dt < 0.7 cells)
    const c = Math.min(params.speed, 0.7 / WAVE_SUBSTEP);
    const c2 = c * c;
    const w0 = 2 * Math.PI * Math.max(0, params.restoreHz);
    const k = w0 * w0;
    const damp = Math.exp(-WAVE_SUBSTEP / Math.max(0.05, params.decay));
    for (let y = 1; y < rows - 1; y++) {
      const row = y * cols;
      for (let x = 1; x < cols - 1; x++) {
        const i = row + x;
        const lap = h[i - 1] + h[i + 1] + h[i - cols] + h[i + cols] - 4 * h[i];
        const acc = c2 * lap - k * h[i];
        let v = h[i] + (h[i] - hp[i]) * damp + acc * dt2;
        if (v > MAX_AMPLITUDE) v = MAX_AMPLITUDE;
        else if (v < -MAX_AMPLITUDE) v = -MAX_AMPLITUDE;
        nx[i] = v;
      }
    }
    // rotate buffers: prev ← h, h ← next; borders stay pinned at zero
    for (let i = 0; i < this.count; i++) {
      hp[i] = h[i];
      h[i] = Number.isFinite(nx[i]) ? nx[i] : 0;
    }
  }

  /** Signed velocity of cell i (world units / s). */
  velocityAt(i: number): number {
    return (this.h[i] - this.hPrev[i]) / WAVE_SUBSTEP;
  }

  /** Total vibrational energy (kinetic + potential, arbitrary units). */
  energy(): number {
    let e = 0;
    for (let i = 0; i < this.count; i++) {
      const v = (this.h[i] - this.hPrev[i]) / WAVE_SUBSTEP;
      e += v * v * 0.02 + this.h[i] * this.h[i] * 40;
    }
    return e / this.count;
  }
}
