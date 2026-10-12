import type { Stage } from '../rendering/stage.ts';
import type { GestureController } from './gestureController.ts';

export interface PointerInputOptions {
  /** called on the first press on the fabric (a user gesture — may enable audio) */
  onFirstTouch?: () => void;
  /** any interaction began (used to fade the hint, interrupt the demo) */
  onInteract?: () => void;
}

const DEFAULT_STRENGTH = 0.55;

/**
 * Turns pointer events on the canvas into gestures. It owns picking and
 * pointer capture; everything musical/physical happens in GestureController.
 *
 * Strike strength: pen/touch pressure when the device reports it, otherwise
 * how fast the pointer was travelling as it came down — a quick jab plucks
 * harder than a slow, careful touch.
 */
export class PointerInput {
  private activeId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private hoverSpeed = 0;
  private touched = false;
  enabled = true;

  constructor(
    private stage: Stage,
    private controller: GestureController,
    private opts: PointerInputOptions = {},
  ) {
    const c = stage.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('lostpointercapture', this.onLost);
    // touches that start on the fabric must not scroll the page (embeds);
    // touches on empty space still can
    c.addEventListener('touchstart', this.onTouchStart, { passive: false });
    window.addEventListener('blur', this.cancel);
  }

  private onTouchStart = (e: TouchEvent) => {
    if (!this.enabled || e.touches.length !== 1) return;
    const t = e.touches[0];
    this.stage.setPointer(t.clientX, t.clientY);
    if (this.stage.pickSurface()) e.preventDefault();
  };

  private trackSpeed(e: PointerEvent) {
    const now = performance.now();
    const dt = Math.max(1, now - this.lastT) / 1000;
    const rect = this.stage.canvas.getBoundingClientRect();
    const dist = Math.hypot(e.clientX - this.lastX, e.clientY - this.lastY) / Math.max(1, rect.width);
    const inst = this.lastT === 0 || dt > 0.25 ? 0 : dist / dt;
    this.hoverSpeed += (inst - this.hoverSpeed) * 0.5;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastT = now;
    return inst;
  }

  private strengthFor(e: PointerEvent): number {
    const hasPressure = e.pointerType !== 'mouse' && e.pressure > 0 && e.pressure !== 0.5;
    if (hasPressure) return 0.25 + 0.75 * e.pressure;
    const fromSpeed = Math.min(1, this.hoverSpeed / 2.2);
    return Math.min(1, DEFAULT_STRENGTH * 0.75 + fromSpeed * 0.6);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || this.activeId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.stage.setPointer(e.clientX, e.clientY);
    const hit = this.stage.pickSurface();
    if (!hit) return;
    e.preventDefault();
    if (!this.touched) {
      this.touched = true;
      this.opts.onFirstTouch?.();
    }
    this.opts.onInteract?.();
    this.activeId = e.pointerId;
    this.stage.canvas.setPointerCapture(e.pointerId);
    this.stage.canvas.style.cursor = 'grabbing';
    this.controller.press(hit.point, this.strengthFor(e));
    this.trackSpeed(e);
    this.grabWorld = hit.world;
  };

  private grabWorld: [number, number, number] | null = null;

  private onMove = (e: PointerEvent) => {
    this.stage.setPointer(e.clientX, e.clientY);
    const speed = this.trackSpeed(e);
    if (this.activeId === null) {
      if (e.pointerType === 'mouse') {
        this.stage.canvas.style.cursor = this.enabled && this.stage.pickSurface() ? 'pointer' : 'default';
      }
      return;
    }
    if (e.pointerId !== this.activeId || !this.grabWorld) return;
    const target = this.stage.projectToDragPlane(this.grabWorld);
    if (!target) return;
    const over = this.stage.pickRestSurface();
    // speed in view widths / s (pointer speed is canvas widths / s)
    this.controller.drag(target, over, speed);
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId) return;
    this.finish();
    if (this.stage.canvas.hasPointerCapture(e.pointerId)) {
      this.stage.canvas.releasePointerCapture(e.pointerId);
    }
  };

  private onLost = (e: PointerEvent) => {
    if (e.pointerId === this.activeId) this.finish();
  };

  private finish() {
    this.activeId = null;
    this.grabWorld = null;
    this.controller.release();
    this.stage.canvas.style.cursor = 'pointer';
  }

  /** Abort any held gesture (window blur, demo start). */
  cancel = () => {
    if (this.activeId === null) return;
    const id = this.activeId;
    this.finish();
    if (this.stage.canvas.hasPointerCapture(id)) this.stage.canvas.releasePointerCapture(id);
  };

  dispose() {
    const c = this.stage.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('lostpointercapture', this.onLost);
    c.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('blur', this.cancel);
  }
}
