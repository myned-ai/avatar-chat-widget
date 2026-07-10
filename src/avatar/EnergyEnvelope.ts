/**
 * Perceptual speech-energy envelope.
 *
 * Converts the raw audio RMS (linear amplitude, arrives at ~30 Hz) into a
 * smooth 0..1 "how much speech energy right now" signal, advanced at the
 * render rate. Two design points matter:
 *
 *  - Perceptual mapping: loudness scales roughly as intensity^0.6 (Stevens'
 *    power law), so a power-law curve makes the signal track *perceived*
 *    emphasis rather than raw amplitude, and lets quiet passages fall toward
 *    zero instead of driving constant motion.
 *  - Asymmetric follower: quick attack so motion engages as speech starts,
 *    slower release so it settles rather than cutting — the standard
 *    envelope-follower shape.
 *
 * Pure and deterministic: `update` is a function of prior state, the raw
 * sample, and dt only — so it is fully unit-testable and independent of
 * audio-callback timing (the caller advances it on the render clock).
 */
export interface EnergyEnvelopeParams {
  /** RMS amplitude that maps to full energy (1.0) before the power curve. */
  referenceRms: number;
  /** Perceptual exponent (Stevens loudness ≈ 0.6). */
  exponent: number;
  /** Attack time constant (seconds) — rise. */
  attackSec: number;
  /** Release time constant (seconds) — fall. */
  releaseSec: number;
}

export const DEFAULT_ENERGY_PARAMS: EnergyEnvelopeParams = {
  referenceRms: 0.12,
  exponent: 0.6,
  attackSec: 0.06,
  releaseSec: 0.35,
};

/** Seconds since the last raw RMS sample beyond which the feed is treated as silent. */
export const ENERGY_FEED_STALE_SEC = 0.15;

export class EnergyEnvelope {
  private level = 0;
  constructor(private readonly params: EnergyEnvelopeParams = DEFAULT_ENERGY_PARAMS) {}

  /** Current smoothed perceptual energy, 0..1. */
  get value(): number {
    return this.level;
  }

  /**
   * Advance the envelope.
   * @param rawRms linear RMS amplitude (>=0); pass 0 for silence
   * @param dtSec  elapsed render time (seconds)
   */
  update(rawRms: number, dtSec: number): number {
    const target = this.perceptual(rawRms);
    const tau = target > this.level ? this.params.attackSec : this.params.releaseSec;
    // Time-constant → per-step coefficient; frame-rate independent.
    const k = 1 - Math.exp(-Math.max(dtSec, 0) / Math.max(tau, 1e-5));
    this.level += k * (target - this.level);
    return this.level;
  }

  private perceptual(rawRms: number): number {
    const norm = Math.max(0, rawRms) / this.params.referenceRms;
    return Math.min(1, Math.pow(norm, this.params.exponent));
  }

  reset(): void {
    this.level = 0;
  }
}
