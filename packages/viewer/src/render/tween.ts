/** Default duration for data transitions (base/head toggle, next turn, layout changes). */
export const TRANSITION_MS = 450;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Tweens a fixed-length vector of numbers from its current value to a target. */
export class Tween {
  readonly cur: Float64Array;
  private from: Float64Array;
  private to: Float64Array;
  private t0 = 0;
  private duration = 0;
  private active = false;

  constructor(initial: ArrayLike<number>) {
    this.cur = Float64Array.from(initial);
    this.from = Float64Array.from(initial);
    this.to = Float64Array.from(initial);
  }

  /** Starts a transition from wherever it is now (even mid-transition) to `to`. */
  retarget(to: ArrayLike<number>, now: number, duration = TRANSITION_MS): void {
    let same = true;
    for (let i = 0; i < to.length; i++) if (to[i] !== this.to[i]) same = false;
    if (same && (this.active || this.isAt(to))) return;
    this.from.set(this.cur);
    this.to.set(to);
    this.t0 = now;
    this.duration = duration;
    this.active = true;
    if (duration <= 0) this.finish();
  }

  /** Advances to `now`. Returns true if the value changed. */
  step(now: number): boolean {
    if (!this.active) return false;
    const t = this.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.t0) / this.duration));
    if (t >= 1) {
      this.finish();
      return true;
    }
    const e = easeInOutCubic(t);
    for (let i = 0; i < this.cur.length; i++) this.cur[i] = this.from[i]! + (this.to[i]! - this.from[i]!) * e;
    return true;
  }

  get animating(): boolean {
    return this.active;
  }

  private finish() {
    this.cur.set(this.to);
    this.active = false;
  }

  private isAt(v: ArrayLike<number>): boolean {
    for (let i = 0; i < v.length; i++) if (this.cur[i] !== v[i]) return false;
    return true;
  }
}

/** Exponential approach, for quick UI-driven values like hover dimming. */
export function approach(current: number, target: number, dtSeconds: number, tau = 0.08): number {
  const next = current + (target - current) * (1 - Math.exp(-dtSeconds / tau));
  return Math.abs(next - target) < 1e-3 ? target : next;
}
