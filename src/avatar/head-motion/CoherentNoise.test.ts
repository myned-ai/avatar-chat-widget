import { describe, it, expect } from 'vitest';
import { CoherentNoise } from './CoherentNoise';

describe('CoherentNoise', () => {
  it('stays within [-1, 1]', () => {
    const n = new CoherentNoise(42);
    for (let t = 0; t < 100; t += 0.013) {
      const v = n.sample(t, 0.3, 2);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = new CoherentNoise(7);
    const b = new CoherentNoise(7);
    for (let t = 0; t < 5; t += 0.1) {
      expect(a.sample(t, 0.5, 2)).toBe(b.sample(t, 0.5, 2));
    }
  });

  it('differs across seeds', () => {
    const a = new CoherentNoise(1);
    const b = new CoherentNoise(2);
    let anyDifferent = false;
    for (let t = 0; t < 5; t += 0.1) {
      if (a.sample(t, 0.5, 2) !== b.sample(t, 0.5, 2)) anyDifferent = true;
    }
    expect(anyDifferent).toBe(true);
  });

  it('is smooth: adjacent samples change little (no jumps)', () => {
    const n = new CoherentNoise(3);
    const dt = 1 / 60;
    let maxStep = 0;
    let prev = n.sample(0, 0.3, 2);
    for (let t = dt; t < 30; t += dt) {
      const v = n.sample(t, 0.3, 2);
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    // At 0.3 Hz over a 60 Hz step the frame-to-frame change must be small.
    expect(maxStep).toBeLessThan(0.1);
  });

  it('does not repeat over a long window (not periodic)', () => {
    const n = new CoherentNoise(9);
    // Compare an early window to a later one; a periodic signal would match.
    let matches = 0;
    for (let i = 0; i < 200; i++) {
      const early = n.sample(i * 0.05, 0.3, 2);
      const late = n.sample(i * 0.05 + 50, 0.3, 2);
      if (Math.abs(early - late) < 1e-6) matches++;
    }
    expect(matches).toBeLessThan(5);
  });
});
