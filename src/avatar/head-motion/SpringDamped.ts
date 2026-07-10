/**
 * Critically-damped spring — the motion integrator primitive.
 *
 * Every head-motion layer writes a target; this spring produces the actual
 * emitted value. Because it is critically damped it converges to the target
 * without oscillating or overshooting, and the closed-form update is exact for
 * any timestep, so behavior is identical at 30, 60, or a stuttering frame rate.
 * This is what makes output continuity a property of the type rather than
 * something each caller must remember to preserve.
 *
 * Closed-form critically-damped update after Daniel Holden,
 * "Spring-It-On: The Physics of Springs in Games" (theorangeduck.com).
 */
export class SpringDamped {
  private value: number;
  private velocity = 0;

  constructor(initial = 0) {
    this.value = initial;
  }

  /** Current smoothed value. */
  get current(): number {
    return this.value;
  }

  /**
   * Advance toward `goal`.
   * @param goal      target value
   * @param halflife  time (seconds) for the remaining distance to halve —
   *                  the single, intuitive tuning knob (smaller = snappier)
   * @param dt        elapsed time (seconds); any value is stable
   */
  update(goal: number, halflife: number, dt: number): number {
    const y = (2 * Math.LN2) / Math.max(halflife, 1e-5); // damping / 2
    const j0 = this.value - goal;
    const j1 = this.velocity + j0 * y;
    const eydt = Math.exp(-y * dt);
    this.value = eydt * (j0 + j1 * dt) + goal;
    this.velocity = eydt * (this.velocity - j1 * y * dt);
    return this.value;
  }

  /** Force the value (and zero velocity) — e.g. on (re)initialisation. */
  reset(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}
