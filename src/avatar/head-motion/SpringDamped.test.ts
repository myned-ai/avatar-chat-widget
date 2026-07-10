import { describe, it, expect } from 'vitest';
import { SpringDamped } from './SpringDamped';

describe('SpringDamped', () => {
  it('converges to the goal', () => {
    const s = new SpringDamped(0);
    for (let i = 0; i < 600; i++) s.update(10, 0.1, 1 / 60);
    expect(s.current).toBeCloseTo(10, 3);
  });

  it('never overshoots a step input (critically damped)', () => {
    const s = new SpringDamped(0);
    let max = -Infinity;
    for (let i = 0; i < 600; i++) max = Math.max(max, s.update(1, 0.15, 1 / 60));
    // Critically damped ⇒ approaches from below, never exceeds the goal.
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('is frame-rate independent', () => {
    const fast = new SpringDamped(0);
    const slow = new SpringDamped(0);
    const total = 0.5; // seconds
    for (let t = 0; t < total - 1e-9; t += 1 / 120) fast.update(1, 0.12, 1 / 120);
    for (let t = 0; t < total - 1e-9; t += 1 / 30) slow.update(1, 0.12, 1 / 30);
    // Same elapsed time at very different step sizes ⇒ nearly identical state.
    expect(Math.abs(fast.current - slow.current)).toBeLessThan(0.02);
  });

  it('is continuous: a tiny step produces a tiny change', () => {
    const s = new SpringDamped(0);
    s.update(100, 0.1, 1 / 60);
    const before = s.current;
    const after = s.update(100, 0.1, 1 / 1000);
    expect(Math.abs(after - before)).toBeLessThan(1);
  });

  it('reset sets value and clears velocity', () => {
    const s = new SpringDamped(0);
    for (let i = 0; i < 10; i++) s.update(5, 0.1, 1 / 60);
    s.reset(2);
    expect(s.current).toBe(2);
    // With zero velocity and goal==value it must not drift.
    expect(s.update(2, 0.1, 1 / 60)).toBeCloseTo(2, 6);
  });
});
