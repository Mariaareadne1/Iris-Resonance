/**
 * Verlet cloth, adapted from Iris Cloth / Holocloth's ClothSim (MIT).
 *
 * Kept from the original: position-based Verlet integration, structural /
 * shear / bend distance constraints with per-type strength, the weighted
 * multi-vertex grab, and the fixed-substep accumulator.
 *
 * Changed for the instrument:
 *  - rest lengths come from the sculptural rest pose (an exact equilibrium)
 *  - a "home" spring pulls every vertex back toward a target shape, so the
 *    sheet behaves like a tensioned membrane instead of drifting gel
 *  - much lower viscosity so motion rings instead of dying instantly
 *  - localized impulses, per-vertex strain, and NaN / runaway guards
 *  - no three.js dependency, so the solver runs in unit tests
 */

export interface ClothParams {
  /** 0..0.3 — fraction of velocity removed per 60 Hz frame. */
  viscosity: number;
  /** 0..1 — constraint solve strength. */
  stiffness: number;
  /** relaxation iterations per substep */
  iterations: number;
  /** 0..1 — how firmly the sheet returns to its resting shape (tension). */
  tension: number;
}

export const DEFAULT_CLOTH_PARAMS: ClothParams = {
  viscosity: 0.05,
  stiffness: 1,
  iterations: 6,
  tension: 0.5,
};

interface GrabState {
  indices: Int32Array;
  weights: Float32Array;
  /** offset of each grabbed vertex from the grab origin, 3 floats per entry */
  offsets: Float32Array;
  target: [number, number, number];
}

export const CLOTH_SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 4;
/** Hard ceiling on how far any vertex may wander from rest (world units). */
const MAX_DISPLACEMENT = 1.6;
/** per-substep smoothing of displacement (removes grid-scale buckling) */
const DISPLACEMENT_SMOOTHING = 0.12;

export class ClothSim {
  readonly count: number;
  readonly positions: Float32Array;
  readonly rest: Float32Array;
  /** Where the home spring pulls toward — rest pose plus idle drift. */
  readonly home: Float32Array;
  /** Per-vertex structural strain (0 = rest length, 0.1 = 10% stretched). */
  readonly strain: Float32Array;
  private prev: Float32Array;

  private cA: Int32Array;
  private cB: Int32Array;
  private cRest: Float32Array;
  private cMul: Float32Array;
  /** constraint indices that are structural (used for strain) */
  private structural: Int32Array;
  private strainCount: Float32Array;

  private grab: GrabState | null = null;
  private accumulator = 0;
  private edgeWeight: Float32Array;
  /** 4-neighbourhood, -1 padded (for displacement smoothing) */
  private neighbors: Int32Array;
  private smoothScratch: Float32Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
    restPose: Float32Array,
  ) {
    this.count = cols * rows;
    if (restPose.length !== this.count * 3) {
      throw new Error(`rest pose has ${restPose.length / 3} vertices, expected ${this.count}`);
    }
    this.positions = new Float32Array(restPose);
    this.prev = new Float32Array(restPose);
    this.rest = new Float32Array(restPose);
    this.home = new Float32Array(restPose);
    this.strain = new Float32Array(this.count);
    this.strainCount = new Float32Array(this.count);

    // structural (1.0), shear (0.85), bend (0.35) — same weights as Iris Cloth
    const a: number[] = [];
    const b: number[] = [];
    const mul: number[] = [];
    const structural: number[] = [];
    const idx = (x: number, y: number) => y * cols + x;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (x + 1 < cols) { structural.push(a.length); a.push(idx(x, y)); b.push(idx(x + 1, y)); mul.push(1.0); }
        if (y + 1 < rows) { structural.push(a.length); a.push(idx(x, y)); b.push(idx(x, y + 1)); mul.push(1.0); }
        if (x + 1 < cols && y + 1 < rows) {
          a.push(idx(x, y)); b.push(idx(x + 1, y + 1)); mul.push(0.85);
          a.push(idx(x + 1, y)); b.push(idx(x, y + 1)); mul.push(0.85);
        }
        if (x + 2 < cols) { a.push(idx(x, y)); b.push(idx(x + 2, y)); mul.push(0.35); }
        if (y + 2 < rows) { a.push(idx(x, y)); b.push(idx(x, y + 2)); mul.push(0.35); }
      }
    }
    this.cA = new Int32Array(a);
    this.cB = new Int32Array(b);
    this.cMul = new Float32Array(mul);
    this.structural = new Int32Array(structural);
    this.cRest = new Float32Array(a.length);
    const p = this.rest;
    for (let c = 0; c < a.length; c++) {
      const ia = a[c] * 3, ib = b[c] * 3;
      this.cRest[c] = Math.hypot(p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]);
    }

    this.neighbors = new Int32Array(this.count * 4).fill(-1);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = idx(x, y) * 4;
        this.neighbors[i] = x > 0 ? idx(x - 1, y) : -1;
        this.neighbors[i + 1] = x + 1 < cols ? idx(x + 1, y) : -1;
        this.neighbors[i + 2] = y > 0 ? idx(x, y - 1) : -1;
        this.neighbors[i + 3] = y + 1 < rows ? idx(x, y + 1) : -1;
      }
    }
    this.smoothScratch = new Float32Array(this.count * 3);

    // the hem is held a little more firmly than the middle, like a frame
    this.edgeWeight = new Float32Array(this.count);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const ex = Math.min(x, cols - 1 - x) / (cols - 1);
        const ey = Math.min(y, rows - 1 - y) / (rows - 1);
        const e = Math.min(ex, ey);
        this.edgeWeight[idx(x, y)] = 1 + 1.5 * Math.max(0, 1 - e / 0.08);
      }
    }
  }

  index(col: number, row: number): number {
    const c = Math.max(0, Math.min(this.cols - 1, Math.round(col)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.round(row)));
    return r * this.cols + c;
  }

  reset() {
    this.positions.set(this.rest);
    this.prev.set(this.rest);
    this.home.set(this.rest);
    this.strain.fill(0);
    this.grab = null;
    this.accumulator = 0;
  }

  /**
   * Localized impulse: every vertex within `radius` (world units) of vertex
   * `center` gets a smoothstep-weighted velocity kick along `dir`.
   */
  impulse(center: number, dir: [number, number, number], strength: number, radius: number) {
    const p = this.positions;
    const cx = p[center * 3], cy = p[center * 3 + 1], cz = p[center * 3 + 2];
    for (let i = 0; i < this.count; i++) {
      const dx = p[i * 3] - cx, dy = p[i * 3 + 1] - cy, dz = p[i * 3 + 2] - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) continue;
      const w = 1 - d / radius;
      const s = w * w * (3 - 2 * w) * strength;
      this.prev[i * 3] -= dir[0] * s;
      this.prev[i * 3 + 1] -= dir[1] * s;
      this.prev[i * 3 + 2] -= dir[2] * s;
    }
  }

  /** Begin a grab around a world-space point. Returns false if nothing near. */
  startGrab(point: [number, number, number], radius: number): boolean {
    const p = this.positions;
    const indices: number[] = [];
    const weights: number[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const dx = p[i * 3] - point[0];
      const dy = p[i * 3 + 1] - point[1];
      const dz = p[i * 3 + 2] - point[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) continue;
      const t = 1 - d / radius;
      const s = t * t * (3 - 2 * t);
      indices.push(i);
      // peaked falloff: the fingertip holds firmly, the surroundings are
      // left to the constraints — a smooth tent instead of a rigid disk
      weights.push(Math.pow(s, 1.6));
      offsets.push(dx, dy, dz);
    }
    if (indices.length === 0) return false;
    this.grab = {
      indices: new Int32Array(indices),
      weights: new Float32Array(weights),
      offsets: new Float32Array(offsets),
      target: [point[0], point[1], point[2]],
    };
    return true;
  }

  moveGrab(target: [number, number, number]) {
    if (!this.grab || !target.every(Number.isFinite)) return;
    this.grab.target[0] = target[0];
    this.grab.target[1] = target[1];
    this.grab.target[2] = target[2];
  }

  endGrab() {
    this.grab = null;
  }

  get isGrabbing() {
    return this.grab !== null;
  }

  step(dt: number, params: ClothParams) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 0.05);
    let steps = 0;
    while (this.accumulator >= CLOTH_SUBSTEP && steps < MAX_SUBSTEPS) {
      this.substep(params);
      this.accumulator -= CLOTH_SUBSTEP;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0;
    this.guard();
    this.computeStrain();
  }

  private substep(params: ClothParams) {
    this.integrate(params.viscosity);
    this.pullHome(params.tension);
    this.smoothDisplacement(DISPLACEMENT_SMOOTHING);
    const iters = Math.max(1, Math.round(params.iterations));
    for (let it = 0; it < iters; it++) {
      this.relax(params.stiffness);
      if (this.grab) this.applyGrab(this.grab);
    }
  }

  /** Verlet step; damping is expressed per 60 Hz frame, converted to substep rate. */
  private integrate(viscosity: number) {
    const p = this.positions;
    const prev = this.prev;
    const damp = Math.pow(1 - Math.min(Math.max(viscosity, 0), 0.9), CLOTH_SUBSTEP * 60);
    const n = this.count * 3;
    for (let i = 0; i < n; i++) {
      const cur = p[i];
      const vel = (cur - prev[i]) * damp;
      prev[i] = cur;
      p[i] = cur + vel;
    }
  }

  /** Home spring: tension pulls the sheet back toward its resting shape. */
  private pullHome(tension: number) {
    const p = this.positions;
    const home = this.home;
    const ew = this.edgeWeight;
    const k = 0.008 + 0.08 * Math.min(Math.max(tension, 0), 1);
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const w = Math.min(0.5, k * ew[i]);
      const j = i * 3;
      p[j] += (home[j] - p[j]) * w;
      p[j + 1] += (home[j + 1] - p[j + 1]) * w;
      p[j + 2] += (home[j + 2] - p[j + 2]) * w;
    }
  }

  /** One Gauss-Seidel pass over every distance constraint. */
  private relax(stiffness: number) {
    const p = this.positions;
    const cA = this.cA, cB = this.cB, cRest = this.cRest, cMul = this.cMul;
    const nc = cA.length;
    for (let c = 0; c < nc; c++) {
      const ia = cA[c] * 3, ib = cB[c] * 3;
      const dx = p[ib] - p[ia];
      const dy = p[ib + 1] - p[ia + 1];
      const dz = p[ib + 2] - p[ia + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const diff = ((d - cRest[c]) / d) * 0.5 * stiffness * cMul[c];
      const ox = dx * diff, oy = dy * diff, oz = dz * diff;
      p[ia] += ox; p[ia + 1] += oy; p[ia + 2] += oz;
      p[ib] -= ox; p[ib + 1] -= oy; p[ib + 2] -= oz;
    }
  }

  /**
   * Laplacian smoothing of displacement-from-home (Iris Cloth smoothed raw
   * positions, which flattens the sculpted rest shape). Smoothing the
   * displacement instead removes grid-scale buckling in folds while leaving
   * the resting shape — and broad, musical motion — untouched.
   */
  private smoothDisplacement(k: number) {
    const p = this.positions, home = this.home, nb = this.neighbors;
    const d = this.smoothScratch;
    for (let i = 0; i < this.count * 3; i++) d[i] = p[i] - home[i];
    for (let i = 0; i < this.count; i++) {
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (let j = 0; j < 4; j++) {
        const ni = nb[i * 4 + j];
        if (ni < 0) continue;
        ax += d[ni * 3]; ay += d[ni * 3 + 1]; az += d[ni * 3 + 2];
        cnt++;
      }
      if (cnt === 0) continue;
      const inv = 1 / cnt, o = i * 3;
      p[o] += (ax * inv - d[o]) * k;
      p[o + 1] += (ay * inv - d[o + 1]) * k;
      p[o + 2] += (az * inv - d[o + 2]) * k;
    }
  }

  private applyGrab(g: GrabState) {
    const p = this.positions;
    const t = g.target;
    for (let k = 0; k < g.indices.length; k++) {
      const i = g.indices[k] * 3;
      const w = g.weights[k];
      p[i] += (t[0] + g.offsets[k * 3] - p[i]) * w;
      p[i + 1] += (t[1] + g.offsets[k * 3 + 1] - p[i + 1]) * w;
      p[i + 2] += (t[2] + g.offsets[k * 3 + 2] - p[i + 2]) * w;
    }
  }

  /** NaN / runaway protection: a bad frame snaps back instead of exploding. */
  private guard() {
    const p = this.positions;
    const rest = this.rest;
    const max2 = MAX_DISPLACEMENT * MAX_DISPLACEMENT;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      const x = p[j], y = p[j + 1], z = p[j + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        this.reset();
        return;
      }
      const dx = x - rest[j], dy = y - rest[j + 1], dz = z - rest[j + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > max2) {
        const s = MAX_DISPLACEMENT / Math.sqrt(d2);
        p[j] = rest[j] + dx * s;
        p[j + 1] = rest[j + 1] + dy * s;
        p[j + 2] = rest[j + 2] + dz * s;
        this.prev[j] = p[j];
        this.prev[j + 1] = p[j + 1];
        this.prev[j + 2] = p[j + 2];
      }
    }
  }

  private computeStrain() {
    const p = this.positions;
    const s = this.strain;
    const cnt = this.strainCount;
    s.fill(0);
    cnt.fill(0);
    const st = this.structural;
    for (let k = 0; k < st.length; k++) {
      const c = st[k];
      const ia = this.cA[c], ib = this.cB[c];
      const dx = p[ib * 3] - p[ia * 3];
      const dy = p[ib * 3 + 1] - p[ia * 3 + 1];
      const dz = p[ib * 3 + 2] - p[ia * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const e = d / this.cRest[c] - 1;
      s[ia] += e; s[ib] += e;
      cnt[ia]++; cnt[ib]++;
    }
    for (let i = 0; i < this.count; i++) s[i] = cnt[i] > 0 ? s[i] / cnt[i] : 0;
  }

  /** Speed (world units / s) of vertex i over the last substep. */
  velocityAt(i: number): number {
    const j = i * 3;
    const p = this.positions, q = this.prev;
    return Math.hypot(p[j] - q[j], p[j + 1] - q[j + 1], p[j + 2] - q[j + 2]) / CLOTH_SUBSTEP;
  }

  displacementAt(i: number): number {
    const j = i * 3;
    const p = this.positions, r = this.rest;
    return Math.hypot(p[j] - r[j], p[j + 1] - r[j + 1], p[j + 2] - r[j + 2]);
  }
}
