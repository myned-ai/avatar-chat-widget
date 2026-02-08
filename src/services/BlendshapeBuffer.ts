// Blendshape Buffer with Interpolation
// Following OpenAvatarChat pattern: continuous frame output with status
// OPTIMIZED: Uses centralized ARKit constants

import { CircularBuffer } from '../utils/CircularBuffer';
import { BlendshapeResultPool } from '../utils/ObjectPool';
import { logger } from '../utils/Logger';
import { CONFIG } from '../config';
import { ARKIT_BLENDSHAPE_NAMES, createNeutralWeights, copyWeights as copyWeightsHelper } from '../constants/arkit';
import type { BlendshapeFrame } from '../types/messages';
import type { Disposable } from '../types/common';

const log = logger.scope('BlendshapeBuffer');

// Avatar status following OpenAvatarChat's 2-state model
export type AvatarStatus = 'SPEAKING' | 'LISTENING';

export interface BlendshapeResult {
  weights: Record<string, number>;
  status: AvatarStatus;
  endOfSpeech: boolean;
}

export class BlendshapeBuffer implements Disposable {
  private buffer: CircularBuffer<BlendshapeFrame>;
  private currentFrame: BlendshapeFrame | null = null;
  private sessionId: string | null = null;
  private lastUpdateTime = 0;
  private readonly frameInterval = 1000 / CONFIG.blendshape.fps;

  // OpenAvatarChat pattern: track speech state
  private isSpeaking = false;
  private speechEnded = false;

  // Frame count tracking for sync analysis
  private totalFramesReceived = 0;
  private sessionStartTime = 0;

  // Neutral/idle blendshapes (all zeros)
  private neutralWeights: Record<string, number>;

  // Object pool to reduce GC pressure in hot path (30 FPS)
  private resultPool: BlendshapeResultPool;

  // Track last returned result for proper cleanup
  private lastResult: BlendshapeResult | null = null;

  constructor() {
    this.buffer = new CircularBuffer<BlendshapeFrame>(CONFIG.blendshape.bufferSize);

    // Use centralized ARKit constants
    this.neutralWeights = createNeutralWeights();

    // Create object pool for result objects (60 = 2 seconds @ 30 FPS)
    // Pass the centralized names array (cast to mutable for pool compatibility)
    this.resultPool = new BlendshapeResultPool([...ARKIT_BLENDSHAPE_NAMES], 60);
  }

  startSession(sessionId: string): void {
    log.info('Blendshape session started:', sessionId);
    this.sessionId = sessionId;
    this.buffer.clear();
    this.currentFrame = null;
    this.lastUpdateTime = 0;
    this.isSpeaking = true;
    this.speechEnded = false;
    this.totalFramesReceived = 0;
    this.sessionStartTime = performance.now();
  }

  addFrame(weights: Record<string, number>, timestamp: number): void {
    const frame: BlendshapeFrame = { weights, timestamp };
    this.buffer.push(frame);
    this.totalFramesReceived++;
    // Log every 30 frames to reduce noise
    if (this.buffer.size % 30 === 0) {
      log.debug('Buffer size:', this.buffer.size);
    }
  }

  public isEmpty(): boolean {
    return this.buffer.isEmpty;
  }

  /**
   * Get a frame following OpenAvatarChat pattern:
   * - ALWAYS returns a frame (never null)
   * - Returns speaking frame if available, idle frame otherwise
   * - Reports status (SPEAKING/LISTENING) and endOfSpeech flag
   * - Uses object pooling to reduce GC pressure
   */
  getFrame(currentTime?: number): BlendshapeResult {
    // Release previous result back to pool
    if (this.lastResult) {
      this.resultPool.release(this.lastResult);
      this.lastResult = null;
    }

    const now = currentTime ?? performance.now();

    // Acquire new result from pool
    const result = this.resultPool.acquire();

    // Throttle updates to target FPS
    if (now - this.lastUpdateTime < this.frameInterval) {
      // Return current frame with current status
      // If not speaking, return neutral (not frozen last frame)
      const sourceWeights = this.isSpeaking
        ? (this.currentFrame?.weights ?? this.neutralWeights)
        : this.neutralWeights;

      // Copy weights to pooled object using centralized helper
      copyWeightsHelper(sourceWeights, result.weights);
      result.status = this.isSpeaking ? 'SPEAKING' : 'LISTENING';
      result.endOfSpeech = false;

      this.lastResult = result;
      return result;
    }

    this.lastUpdateTime = now;

    // Try to get next frame from buffer
    const nextFrame = this.buffer.pop();

    if (!nextFrame) {
      // Buffer empty - transition to idle/neutral
      const wasJustSpeaking = this.isSpeaking;

      // If speech ended and buffer is empty, transition to LISTENING with NEUTRAL face
      if (this.speechEnded) {
        this.isSpeaking = false;
        // IMPORTANT: Reset to neutral expression when speech ends
        // This prevents the "frozen last expression" bug
        this.currentFrame = null;
      }

      // Copy neutral weights to pooled object using centralized helper
      copyWeightsHelper(this.neutralWeights, result.weights);
      result.status = 'LISTENING';
      result.endOfSpeech = wasJustSpeaking && this.speechEnded;

      this.lastResult = result;
      return result;
    }

    // We have a speaking frame
    this.isSpeaking = true;

    // Apply the frame (with optional interpolation)
    if (CONFIG.blendshape.interpolation && this.currentFrame) {
      // Smooth transition with interpolation
      this.currentFrame = this.interpolateFrames(
        this.currentFrame,
        nextFrame,
        CONFIG.blendshape.smoothing
      );
    } else {
      this.currentFrame = nextFrame;
    }

    // Check if this is the last frame
    const isLastFrame = this.speechEnded && this.buffer.size === 0;

    // Copy weights to pooled object using centralized helper
    copyWeightsHelper(this.currentFrame.weights, result.weights);
    result.status = 'SPEAKING';
    result.endOfSpeech = isLastFrame;

    this.lastResult = result;
    return result;
  }

  /**
   * @deprecated Use getFrame() instead. This method exists for backwards compatibility only.
   * Legacy method for backwards compatibility - returns just weights or null
   */
  getFrameWeights(currentTime?: number): Record<string, number> | null {
    const result = this.getFrame(currentTime);
    return result.weights;
  }

  private interpolateFrames(
    from: BlendshapeFrame,
    to: BlendshapeFrame,
    alpha: number
  ): BlendshapeFrame {
    const interpolatedWeights: Record<string, number> = {};

    // Use centralized ARKit names for interpolation
    for (const name of ARKIT_BLENDSHAPE_NAMES) {
      const fromValue = from.weights[name] ?? 0;
      const toValue = to.weights[name] ?? 0;
      
      // Linear interpolation (LERP)
      interpolatedWeights[name] = fromValue + (toValue - fromValue) * alpha;
    }

    return {
      weights: interpolatedWeights,
      timestamp: to.timestamp,
    };
  }

  getCurrentFrame(): BlendshapeFrame | null {
    return this.currentFrame;
  }

  getBufferSize(): number {
    return this.buffer.size;
  }

  isBufferHealthy(): boolean {
    // Ensure we have some frames buffered for smooth playback
    return this.buffer.size >= 3;
  }

  endSession(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      return;
    }

    const sessionDuration = (performance.now() - this.sessionStartTime) / 1000;
    const expectedFrames = Math.floor(sessionDuration * CONFIG.blendshape.fps);
    log.info(`Blendshape session ended: ${sessionId}`);
    log.debug(`Received ${this.totalFramesReceived} frames over ${sessionDuration.toFixed(2)}s (expected ~${expectedFrames} at ${CONFIG.blendshape.fps}fps)`);
    log.debug(`Buffer remaining: ${this.buffer.size} frames`);
    
    // OpenAvatarChat pattern: mark speech as ended, but don't clear
    // The buffer will drain naturally, then switch to idle frames
    this.speechEnded = true;
  }

  /**
   * Check if currently speaking (has speech frames)
   */
  isSpeakingState(): boolean {
    return this.isSpeaking;
  }

  /**
   * Get neutral/idle weights
   */
  getNeutralWeights(): Record<string, number> {
    return { ...this.neutralWeights };
  }

  clear(): void {
    this.buffer.clear();
    this.currentFrame = null;
    this.isSpeaking = false;
    this.speechEnded = false;

    // Release last result back to pool
    if (this.lastResult) {
      this.resultPool.release(this.lastResult);
      this.lastResult = null;
    }
  }

  dispose(): void {
    this.clear();
    this.sessionId = null;
    this.resultPool.clear();
  }

  /**
   * Get pool statistics for debugging
   */
  getPoolStats() {
    return this.resultPool.getStats();
  }
}
