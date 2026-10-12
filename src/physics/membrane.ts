import { ClothSim, DEFAULT_CLOTH_PARAMS, type ClothParams } from './cloth.ts';
import { WaveField, DEFAULT_WAVE_PARAMS, type WaveParams } from './waveField.ts';
import { buildRestPose, DEFAULT_POSE, type RestPoseSpec } from './restPose.ts';

/**
 * A point on the fabric in surface coordinates — the same as the mesh UVs.
 * u: 0 = left edge → 1 = right edge. v: 0 = bottom hem → 1 = top edge.
 */
export interface SurfacePoint {
  u: number;
  v: number;
}

export type Vec3 = [number, number, number];

export interface MembraneParams {
  cloth: ClothParams;
  wave: WaveParams;
  /** 0..1 idle breathing amplitude (0 for reduced motion) */
  idle: number;
}

export const DEFAULT_MEMBRANE_PARAMS: MembraneParams = {
  cloth: DEFAULT_CLOTH_PARAMS,
  wave: DEFAULT_WAVE_PARAMS,
  idle: 1,
};

export interface ReleaseInfo {
  /** structural strain under the grab at the moment of release */
  strain: number;
  /** how far the grabbed point had been pulled from rest (world units) */
  displacement: number;
  point: SurfacePoint;
}

const GRAB_RADIUS = 0.34;
const IDLE_AMPLITUDE = 0.035;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The playable membrane: Verlet cloth for shape (grab, stretch, sway) plus a
 * wave field for transverse vibration. Rendered vertex = cloth vertex +
 * wave displacement along the surface normal, so every ripple you see is
 * the simulation's actual state.
 */
export class Membrane {
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  readonly cloth: ClothSim;
  readonly wave: WaveField;
  /** final rendered positions (cloth + wave along normal) */
  readonly positions: Float32Array;
  /** surface normals of the cloth (before wave displacement) */
  readonly normals: Float32Array;
  private restNormals: Float32Array;
  private time = 0;
  private grabPoint: SurfacePoint | null = null;
  private grabIndex = -1;

  constructor(readonly spec: RestPoseSpec = DEFAULT_POSE) {
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.count = spec.cols * spec.rows;
    const rest = buildRestPose(spec);
    this.cloth = new ClothSim(spec.cols, spec.rows, rest);
    this.wave = new WaveField(spec.cols, spec.rows);
    this.positions = new Float32Array(rest);
    this.normals = new Float32Array(this.count * 3);
    this.restNormals = new Float32Array(this.count * 3);
    computeGridNormals(rest, this.cols, this.rows, this.restNormals);
    this.normals.set(this.restNormals);
  }

  /** Continuous grid coordinates for a surface point. */
  gridOf(pt: SurfacePoint): { col: number; row: number } {
    return {
      col: clamp01(pt.u) * (this.cols - 1),
      row: (1 - clamp01(pt.v)) * (this.rows - 1),
    };
  }

  indexOf(pt: SurfacePoint): number {
    const { col, row } = this.gridOf(pt);
    return this.cloth.index(col, row);
  }

  pointOf(index: number): SurfacePoint {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    return { u: col / (this.cols - 1), v: 1 - row / (this.rows - 1) };
  }

  /** Current rendered world position of the fabric at a surface point. */
  worldAt(pt: SurfacePoint): Vec3 {
    const i = this.indexOf(pt) * 3;
    const p = this.positions;
    return [p[i], p[i + 1], p[i + 2]];
  }

  normalAt(pt: SurfacePoint): Vec3 {
    const i = this.indexOf(pt) * 3;
    const n = this.normals;
    return [n[i], n[i + 1], n[i + 2]];
  }

  /**
   * Pluck: a localized strike that ripples outward through the wave field,
   * plus a softer push on the cloth itself so the whole sheet sways a little.
   * strength 0..1.
   */
  pluckAt(pt: SurfacePoint, strength: number) {
    const s = clamp01(strength);
    const { col, row } = this.gridOf(pt);
    this.wave.strike(col, row, 0.5 + 2.4 * s, 2.2 + 1.2 * s);
    const idx = this.cloth.index(col, row);
    const n = this.normalAt(pt);
    // push away from the viewer, like a fingertip pressing in
    this.cloth.impulse(idx, [-n[0], -n[1], -n[2]], 0.0012 + 0.0042 * s, 0.55);
  }

  /** Start pulling the fabric at a surface point. Returns the grabbed world point. */
  beginGrab(pt: SurfacePoint): Vec3 | null {
    const world = this.worldAt(pt);
    if (!this.cloth.startGrab(world, GRAB_RADIUS)) return null;
    this.grabPoint = { u: clamp01(pt.u), v: clamp01(pt.v) };
    this.grabIndex = this.indexOf(pt);
    return world;
  }

  updateGrab(target: Vec3) {
    this.cloth.moveGrab(target);
  }

  /** Let go. The cloth springs home; the snap-back strikes the wave field. */
  endGrab(): ReleaseInfo | null {
    if (!this.grabPoint || !this.cloth.isGrabbing) {
      this.grabPoint = null;
      return null;
    }
    const point = this.grabPoint;
    const strain = this.getLocalStrain(point);
    const displacement = this.cloth.displacementAt(this.grabIndex);
    this.cloth.endGrab();
    const { col, row } = this.gridOf(point);
    this.wave.strike(col, row, Math.min(2.6, displacement * 3.2), 3);
    this.grabPoint = null;
    this.grabIndex = -1;
    return { strain, displacement, point };
  }

  get isGrabbing(): boolean {
    return this.cloth.isGrabbing;
  }

  get grabbedPoint(): SurfacePoint | null {
    return this.grabPoint;
  }

  /** Distance from rest at a point, including wave displacement. */
  getLocalDisplacement(pt: SurfacePoint): number {
    const i = this.indexOf(pt);
    return this.cloth.displacementAt(i) + Math.abs(this.wave.h[i]);
  }

  /** Speed of the fabric at a point (world units / s). */
  getLocalVelocity(pt: SurfacePoint): number {
    const i = this.indexOf(pt);
    return this.cloth.velocityAt(i) + Math.abs(this.wave.velocityAt(i));
  }

  /** Mean structural strain in a small neighbourhood (positive = stretched). */
  getLocalStrain(pt: SurfacePoint): number {
    const { col, row } = this.gridOf(pt);
    const c0 = Math.round(col), r0 = Math.round(row);
    let sum = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const c = c0 + dx, r = r0 + dy;
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        sum += this.cloth.strain[r * this.cols + c];
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  }

  /** Overall motion energy of the sheet, roughly 0 (still) .. 1+ (ringing). */
  energy(): number {
    return this.wave.energy() * 6;
  }

  reset() {
    this.cloth.reset();
    this.wave.reset();
    this.grabPoint = null;
    this.grabIndex = -1;
    this.time = 0;
    this.positions.set(this.cloth.rest);
    this.normals.set(this.restNormals);
  }

  step(dt: number, params: MembraneParams = DEFAULT_MEMBRANE_PARAMS) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const d = Math.min(dt, 0.05);
    this.time += d;
    this.updateHome(params.idle);
    this.cloth.step(d, params.cloth);
    this.wave.step(d, params.wave);
    this.compose();
  }

  /** Idle breathing: the home shape drifts slowly along its normals. */
  private updateHome(idle: number) {
    const home = this.cloth.home;
    const rest = this.cloth.rest;
    const rn = this.restNormals;
    const amp = IDLE_AMPLITUDE * clamp01(idle);
    if (amp === 0) {
      home.set(rest);
      return;
    }
    const t = this.time;
    for (let r = 0; r < this.rows; r++) {
      const v = r / (this.rows - 1);
      for (let c = 0; c < this.cols; c++) {
        const u = c / (this.cols - 1);
        const i = (r * this.cols + c) * 3;
        const drift = amp * (
          0.6 * Math.sin(t * 0.55 + u * 3.4 + v * 0.8) +
          0.4 * Math.sin(t * 0.37 - v * 2.6 + u * 1.3)
        );
        home[i] = rest[i] + rn[i] * drift;
        home[i + 1] = rest[i + 1] + rn[i + 1] * drift;
        home[i + 2] = rest[i + 2] + rn[i + 2] * drift;
      }
    }
  }

  private compose() {
    const p = this.cloth.positions;
    computeGridNormals(p, this.cols, this.rows, this.normals);
    const n = this.normals;
    const h = this.wave.h;
    const out = this.positions;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      out[j] = p[j] + n[j] * h[i];
      out[j + 1] = p[j + 1] + n[j + 1] * h[i];
      out[j + 2] = p[j + 2] + n[j + 2] * h[i];
    }
  }
}

/** Unit normals of a row-major grid via central differences (+z faces the viewer at rest). */
export function computeGridNormals(p: Float32Array, cols: number, rows: number, out: Float32Array) {
  for (let r = 0; r < rows; r++) {
    const rUp = Math.max(0, r - 1), rDn = Math.min(rows - 1, r + 1);
    for (let c = 0; c < cols; c++) {
      const cL = Math.max(0, c - 1), cR = Math.min(cols - 1, c + 1);
      const iL = (r * cols + cL) * 3, iR = (r * cols + cR) * 3;
      const iU = (rUp * cols + c) * 3, iD = (rDn * cols + c) * 3;
      // tangent along +u and along +v (upward on screen)
      const tx = p[iR] - p[iL], ty = p[iR + 1] - p[iL + 1], tz = p[iR + 2] - p[iL + 2];
      const bx = p[iU] - p[iD], by = p[iU + 1] - p[iD + 1], bz = p[iU + 2] - p[iD + 2];
      let nx = ty * bz - tz * by;
      let ny = tz * bx - tx * bz;
      let nz = tx * by - ty * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = (r * cols + c) * 3;
      out[o] = nx; out[o + 1] = ny; out[o + 2] = nz;
    }
  }
}
