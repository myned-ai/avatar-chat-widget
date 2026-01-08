/**
 * Adaptive Buffer Manager
 * Dynamically adjusts buffer size based on network jitter and latency
 * Minimizes latency on good networks, prevents underruns on poor networks
 */

import { logger } from './Logger';

const log = logger.scope('AdaptiveBuffer');

export interface JitterMeasurement {
  receiveTime: number;
  sentTime: number;
  jitter: number;
}

export interface BufferStats {
  currentBufferMs: number;
  targetBufferMs: number;
  minBufferMs: number;
  maxBufferMs: number;
  averageJitter: number;
  p95Jitter: number;
  underrunCount: number;
  networkQuality: 'excellent' | 'good' | 'fair' | 'poor';
}

export class AdaptiveBuffer {
  private jitterHistory: JitterMeasurement[] = [];
  private underrunCount = 0;
  private targetBufferMs: number;
  private readonly minBufferMs: number;
  private readonly maxBufferMs: number;
  private readonly historySize = 100;
  private readonly adjustmentInterval = 5000; // Adjust every 5 seconds
  private lastAdjustmentTime = 0;

  constructor(
    initialBufferMs: number = 100,
    minBufferMs: number = 50,
    maxBufferMs: number = 500
  ) {
    this.targetBufferMs = initialBufferMs;
    this.minBufferMs = minBufferMs;
    this.maxBufferMs = maxBufferMs;
  }

  /**
   * Record the arrival time of a chunk
   * @param sentTime Server timestamp when chunk was sent (from message)
   * @param receiveTime Client timestamp when chunk was received
   */
  recordArrival(sentTime: number, receiveTime: number = Date.now()): void {
    const jitter = receiveTime - sentTime;

    // Store measurement
    this.jitterHistory.push({
      receiveTime,
      sentTime,
      jitter
    });

    // Keep history limited
    if (this.jitterHistory.length > this.historySize) {
      this.jitterHistory.shift();
    }

    // Adjust buffer size periodically
    const now = Date.now();
    if (now - this.lastAdjustmentTime >= this.adjustmentInterval) {
      this.adjustBufferSize();
      this.lastAdjustmentTime = now;
    }
  }

  /**
   * Record a buffer underrun event
   * Increases buffer size to prevent future underruns
   */
  recordUnderrun(): void {
    this.underrunCount++;

    // Immediate response to underrun: increase buffer
    const increase = 50; // Add 50ms
    this.targetBufferMs = Math.min(this.maxBufferMs, this.targetBufferMs + increase);

    log.warn(`Buffer underrun detected. Increasing buffer to ${this.targetBufferMs}ms (underrun #${this.underrunCount})`);
  }

  /**
   * Adjust buffer size based on jitter statistics
   */
  private adjustBufferSize(): void {
    if (this.jitterHistory.length < 10) {
      return; // Not enough data
    }

    const stats = this.calculateJitterStats();
    const p95Jitter = stats.p95;
    const avgJitter = stats.average;

    // Target buffer size = P95 jitter * safety factor
    const safetyFactor = this.underrunCount > 3 ? 2.0 : 1.5;
    let newTargetBuffer = p95Jitter * safetyFactor;

    // Clamp to min/max
    newTargetBuffer = Math.max(this.minBufferMs, Math.min(this.maxBufferMs, newTargetBuffer));

    // Only adjust if change is significant (>20ms difference)
    if (Math.abs(newTargetBuffer - this.targetBufferMs) > 20) {
      const oldBuffer = this.targetBufferMs;
      this.targetBufferMs = Math.round(newTargetBuffer);

      log.debug(
        `Adaptive buffer adjustment: ${oldBuffer}ms -> ${this.targetBufferMs}ms ` +
        `(avg jitter: ${avgJitter.toFixed(0)}ms, p95: ${p95Jitter.toFixed(0)}ms, underruns: ${this.underrunCount})`
      );
    }
  }

  /**
   * Calculate jitter statistics
   */
  private calculateJitterStats(): { average: number; p95: number; min: number; max: number } {
    if (this.jitterHistory.length === 0) {
      return { average: 0, p95: 0, min: 0, max: 0 };
    }

    const jitters = this.jitterHistory.map(m => m.jitter);
    const sorted = jitters.slice().sort((a, b) => a - b);

    const sum = jitters.reduce((acc, val) => acc + val, 0);
    const average = sum / jitters.length;

    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index] || sorted[sorted.length - 1];

    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    return { average, p95, min, max };
  }

  /**
   * Get current target buffer size in milliseconds
   */
  getTargetBufferMs(): number {
    return this.targetBufferMs;
  }

  /**
   * Get target buffer size in frames
   * @param frameDurationMs Duration of one frame in milliseconds
   */
  getTargetBufferFrames(frameDurationMs: number): number {
    return Math.ceil(this.targetBufferMs / frameDurationMs);
  }

  /**
   * Check if current buffer is sufficient
   * @param currentBufferMs Current buffer in milliseconds
   * @returns true if buffer is healthy, false if needs more buffering
   */
  isBufferHealthy(currentBufferMs: number): boolean {
    // Buffer is healthy if it's at least 80% of target
    return currentBufferMs >= this.targetBufferMs * 0.8;
  }

  /**
   * Get buffer statistics for monitoring
   */
  getStats(): BufferStats {
    const jitterStats = this.calculateJitterStats();

    // Determine network quality based on jitter
    let networkQuality: 'excellent' | 'good' | 'fair' | 'poor';
    if (jitterStats.p95 < 50) {
      networkQuality = 'excellent';
    } else if (jitterStats.p95 < 100) {
      networkQuality = 'good';
    } else if (jitterStats.p95 < 200) {
      networkQuality = 'fair';
    } else {
      networkQuality = 'poor';
    }

    return {
      currentBufferMs: this.targetBufferMs,
      targetBufferMs: this.targetBufferMs,
      minBufferMs: this.minBufferMs,
      maxBufferMs: this.maxBufferMs,
      averageJitter: jitterStats.average,
      p95Jitter: jitterStats.p95,
      underrunCount: this.underrunCount,
      networkQuality
    };
  }

  /**
   * Reset statistics (e.g., when network changes)
   */
  reset(): void {
    this.jitterHistory = [];
    this.underrunCount = 0;
    this.lastAdjustmentTime = 0;
    // Keep current target buffer (don't reset to initial)
  }

  /**
   * Get recommended minimum buffer frames before starting playback
   * Returns conservative estimate to prevent immediate underrun
   */
  getMinBufferFramesForStart(frameDurationMs: number): number {
    // Use 150% of target buffer for initial buffering
    const conservativeBufferMs = this.targetBufferMs * 1.5;
    return Math.ceil(conservativeBufferMs / frameDurationMs);
  }
}
