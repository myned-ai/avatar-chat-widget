import { describe, it, expect } from 'vitest';
import { EnergyEnvelope, DEFAULT_ENERGY_PARAMS } from './EnergyEnvelope';

const dt = 1 / 60;

describe('EnergyEnvelope', () => {
  it('stays within [0, 1]', () => {
    const e = new EnergyEnvelope();
    for (let i = 0; i < 300; i++) {
      const v = e.update(i % 2 ? 0.3 : 0, dt);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('rises under sustained speech and falls to ~0 in silence', () => {
    const e = new EnergyEnvelope();
    for (let i = 0; i < 120; i++) e.update(0.15, dt);
    expect(e.value).toBeGreaterThan(0.7);
    for (let i = 0; i < 300; i++) e.update(0, dt);
    expect(e.value).toBeLessThan(0.02);
  });

  it('attacks faster than it releases (asymmetric)', () => {
    const up = new EnergyEnvelope();
    let framesToHalfUp = 0;
    while (up.update(0.15, dt) < 0.5 && framesToHalfUp < 1000) framesToHalfUp++;

    const down = new EnergyEnvelope();
    for (let i = 0; i < 200; i++) down.update(0.15, dt); // saturate high
    const start = down.value;
    let framesToHalfDown = 0;
    while (down.update(0, dt) > start / 2 && framesToHalfDown < 1000) framesToHalfDown++;

    expect(framesToHalfUp).toBeLessThan(framesToHalfDown);
  });

  it('maps energy perceptually (concave: quiet speech is not near-zero)', () => {
    const e = new EnergyEnvelope();
    // A single steady quiet input, run to steady state.
    for (let i = 0; i < 400; i++) e.update(0.03, dt); // ~1/4 of reference
    // Linear would give 0.25; the 0.6 power law lifts it well above that.
    expect(e.value).toBeGreaterThan(0.35);
  });

  it('is frame-rate independent', () => {
    const a = new EnergyEnvelope();
    const b = new EnergyEnvelope();
    const total = 0.4;
    for (let t = 0; t < total - 1e-9; t += 1 / 120) a.update(0.15, 1 / 120);
    for (let t = 0; t < total - 1e-9; t += 1 / 30) b.update(0.15, 1 / 30);
    expect(Math.abs(a.value - b.value)).toBeLessThan(0.03);
  });

  it('exposes sane defaults', () => {
    expect(DEFAULT_ENERGY_PARAMS.exponent).toBeCloseTo(0.6, 5);
    expect(DEFAULT_ENERGY_PARAMS.attackSec).toBeLessThan(DEFAULT_ENERGY_PARAMS.releaseSec);
  });
});
