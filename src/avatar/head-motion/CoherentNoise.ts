/**
 * 1-D value noise — a smooth, non-repeating signal in [-1, 1].
 *
 * Ambient head motion uses coherent noise rather than summed sines because a
 * fixed-frequency sine reads as a metronome (the "bobblehead" failure mode);
 * value noise wanders smoothly without ever repeating, which is what makes
 * idle motion look alive instead of looped. Deterministic given a seed, so it
 * is unit-testable and reproducible.
 *
 * Value noise = smoothly interpolated pseudo-random values on the integer
 * lattice. Octaves are layered (fractal Brownian motion) for natural detail.
 */
export class CoherentNoise {
  private readonly seed: number;

  constructor(seed = 1) {
    // Keep the seed in a stable integer range.
    this.seed = (Math.floor(seed) % 2147483647) || 1;
  }

  /** Deterministic pseudo-random in [0, 1) for an integer lattice point. */
  private hash(i: number): number {
    // Integer hash (Wang-style), stable and well-distributed.
    let h = (i ^ this.seed) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  /** Smooth value noise in [-1, 1] at position x (x measured in lattice units). */
  private valueAt(x: number): number {
    const i = Math.floor(x);
    const f = x - i;
    // Quintic smoothstep — C2 continuous, so the derivative (velocity) is
    // smooth too, not just the position.
    const u = f * f * f * (f * (f * 6 - 15) + 10);
    const a = this.hash(i);
    const b = this.hash(i + 1);
    return (a + (b - a) * u) * 2 - 1;
  }

  /**
   * Fractal value noise in [-1, 1].
   * @param t         time in seconds
   * @param frequency base frequency in Hz (lattice points per second)
   * @param octaves   number of layered octaves (detail); 1 = smoothest
   */
  sample(t: number, frequency: number, octaves = 2): number {
    let value = 0;
    let amplitude = 1;
    let freq = frequency;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      value += amplitude * this.valueAt(t * freq);
      norm += amplitude;
      amplitude *= 0.5;
      freq *= 2;
    }
    return value / norm;
  }
}
