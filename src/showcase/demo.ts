import type { GestureController } from '../interaction/gestureController.ts';
import type { Membrane, SurfacePoint, Vec3 } from '../physics/membrane.ts';

/**
 * A ~14 s choreographed performance on the real instrument. Every step goes
 * through GestureController — the same calls a pointer makes — so the
 * physics, sound and visuals are genuinely played, not pre-rendered.
 */
interface Cue {
  at: number;
  run: (d: Showcase) => void;
}

interface Motion {
  from: number;
  to: number;
  step: (d: Showcase, t: number) => void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const DEMO_LENGTH = 14.2;

const STRETCH_AT: SurfacePoint = { u: 0.31, v: 0.36 };
const GLIDE_FROM: SurfacePoint = { u: 0.18, v: 0.72 };
const GLIDE_TO: SurfacePoint = { u: 0.88, v: 0.66 };

export class Showcase {
  private t = 0;
  private running = false;
  private next = 0;
  private origin: Vec3 | null = null;
  onEnd: (() => void) | null = null;

  private readonly cues: Cue[] = [
    { at: 0.0, run: (d) => d.controller.release() },
    { at: 0.9, run: (d) => d.controller.pluck({ u: 0.14, v: 0.58 }, 0.7) },
    { at: 2.1, run: (d) => d.controller.pluck({ u: 0.52, v: 0.62 }, 0.6) },
    { at: 2.75, run: (d) => d.controller.pluck({ u: 0.7, v: 0.66 }, 0.55) },
    {
      at: 4.0,
      run: (d) => {
        d.controller.press(STRETCH_AT, 0.35);
        d.origin = d.membrane.worldAt(STRETCH_AT);
      },
    },
    { at: 7.3, run: (d) => d.controller.release() },
    { at: 8.3, run: (d) => d.controller.press(GLIDE_FROM, 0.45) },
    { at: 9.65, run: (d) => d.controller.release() },
    { at: 10.6, run: (d) => d.controller.pluck({ u: 0.5, v: 0.52 }, 0.85) },
  ];

  private readonly motions: Motion[] = [
    {
      // diagonal stretch: up-right and toward the viewer, then hold
      from: 4.0,
      to: 7.3,
      step: (d, t) => {
        if (!d.origin) return;
        const k = ease(clamp01((t - 4.0) / 2.6));
        const toward = d.towardCamera();
        const target: Vec3 = [
          d.origin[0] + k * (0.4 + toward[0] * 0.35),
          d.origin[1] + k * (0.3 + toward[1] * 0.35),
          d.origin[2] + k * (toward[2] * 0.35),
        ];
        d.controller.drag(target, null, 0.15);
      },
    },
    {
      // a quick strum across the upper fabric
      from: 8.3,
      to: 9.6,
      step: (d, t) => {
        const k = clamp01((t - 8.35) / 1.15);
        const over = {
          u: GLIDE_FROM.u + (GLIDE_TO.u - GLIDE_FROM.u) * k,
          v: GLIDE_FROM.v + (GLIDE_TO.v - GLIDE_FROM.v) * k,
        };
        d.controller.drag(d.membrane.worldAt(over), over, 1.6);
      },
    },
  ];

  constructor(
    readonly controller: GestureController,
    readonly membrane: Membrane,
    readonly towardCamera: () => Vec3,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get progress(): number {
    return this.running ? Math.min(1, this.t / DEMO_LENGTH) : 0;
  }

  start() {
    this.controller.release();
    this.t = 0;
    this.next = 0;
    this.origin = null;
    this.running = true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.controller.release();
    this.onEnd?.();
  }

  update(dt: number) {
    if (!this.running) return;
    this.t += Math.min(Math.max(dt, 0), 0.1);
    while (this.next < this.cues.length && this.cues[this.next].at <= this.t) {
      this.cues[this.next].run(this);
      this.next++;
    }
    for (const m of this.motions) {
      if (this.t >= m.from && this.t < m.to) m.step(this, this.t);
    }
    if (this.t >= DEMO_LENGTH) this.stop();
  }
}
