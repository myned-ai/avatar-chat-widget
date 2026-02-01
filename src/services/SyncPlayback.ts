// Synchronized Audio+Blendshape Playback
// Following OpenAvatarChat pattern: Audio is the MASTER, blendshapes follow audio time
// OPTIMIZED: Pre-allocated buffers, visibility throttling, centralized constants, shared AudioContext

import { AudioContextManager } from './AudioContextManager';
import { logger } from '../utils/Logger';
import { createNeutralWeights } from '../constants/arkit';
import type { Disposable } from '../types/common';

const log = logger.scope('SyncPlayback');

export interface SyncFrame {
  audio: ArrayBuffer;      // PCM16 audio samples for this frame
  weights: Record<string, number>;  // Blendshape weights
  timestamp: number;       // Server timestamp
  frameIndex: number;      // Frame sequence number
  sessionId?: string;      // Session ID
}

export interface PlaybackState {
  isPlaying: boolean;
  currentFrameIndex: number;
  bufferSize: number;
  audioPlaybackTime: number;  // Current audio playback position in seconds
}

// Internal structure for scheduled frames
interface ScheduledFrame {
  weights: Record<string, number>;
  startTime: number;  // AudioContext time when this frame starts
  endTime: number;    // AudioContext time when this frame ends
  frameIndex: number;
}

/**
 * SyncPlayback: Unified audio+blendshape player
 * 
 * OpenAvatarChat Pattern:
 * - Audio and blendshapes are paired at the server
 * - Audio playback time DRIVES blendshape timing
 * - When audio chunk N starts playing, blendshape N is applied
 * - This ensures perfect lip-sync regardless of network jitter
 */
export class SyncPlayback implements Disposable {
  private frameBuffer: SyncFrame[] = [];
  private scheduledFrames: ScheduledFrame[] = [];  // Track scheduled frames for blendshape lookup
  private isPlaying = false;
  private isStopped = false;
  private sessionId: string | null = null;
  
  // Audio playback tracking (use shared AudioContext)
  private sampleRate: number = 24000;
  
  /**
   * Get the shared AudioContext
   */
  private get audioContext(): AudioContext {
    return AudioContextManager.getContext(this.sampleRate);
  }
  private nextPlayTime = 0;
  private audioStartTime = 0;  // When audio playback started (AudioContext time)
  private activeSourceNodes: Set<AudioBufferSourceNode> = new Set();
  
  // Blendshape tracking
  private currentFrameIndex = 0;
  // Track last received frame index to detect gaps/duplicates
  private lastReceivedFrameIndex: number | null = null;
  private lastBlendshapeUpdate = 0;
  private currentWeights: Record<string, number>;
  private lastDropLogTime = 0;
  
  // Callbacks
  private onBlendshapeUpdate: ((weights: Record<string, number>) => void) | null = null;
  private onPlaybackEnd: (() => void) | null = null;

  // Buffer thresholds
  // Server sends ~30 frames per second in bursts (1 second of audio at a time)
  // No artificial buffer limits - frames are naturally consumed by audio playback
  // and cleaned up by cleanupScheduledFrames()
  private readonly minBufferFrames = 3;  // Start playback after 3 frames (~100ms)

  // Neutral blendshapes for idle state
  private neutralWeights: Record<string, number>;

  // Frame tracking optimization - cache last found frame for O(1) lookup
  private lastActiveFrameIndex = 0;

  // Animation frame tracking
  private animationFrameId: number | null = null;

  // OPTIMIZATION: Pre-allocated buffers for PCM conversion (avoid per-frame allocation)
  // Max size based on typical audio chunk: 800 samples (33ms at 24kHz)
  private readonly maxSamplesPerFrame = 2400; // 100ms at 24kHz (generous)
  private pcmBuffer: Int16Array;
  private floatBuffer: Float32Array;

  // OPTIMIZATION: Visibility-based throttling
  private isVisible = true;
  private visibilityHandler: () => void;

  constructor() {
    // Initialize neutral blendshapes using centralized constants
    this.neutralWeights = createNeutralWeights();
    this.currentWeights = createNeutralWeights();
    
    // Pre-allocate reusable buffers for audio conversion
    this.pcmBuffer = new Int16Array(this.maxSamplesPerFrame);
    this.floatBuffer = new Float32Array(this.maxSamplesPerFrame);
    
    // Setup visibility change handler for CPU optimization
    this.visibilityHandler = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    
    // Initialize shared AudioContext (handles resume listener internally)
    AudioContextManager.getContext(this.sampleRate);
  }

  /**
   * Handle visibility change - reduce CPU when tab is hidden
   */
  private handleVisibilityChange(): void {
    this.isVisible = document.visibilityState === 'visible';
    if (!this.isVisible) {
      log.debug('Tab hidden - reducing animation updates');
    }
  }

  /**
   * Set callback for blendshape updates
   */
  setBlendshapeCallback(callback: (weights: Record<string, number>) => void): void {
    this.onBlendshapeUpdate = callback;
  }

  /**
   * Set callback for when playback ends
   */
  setPlaybackEndCallback(callback: () => void): void {
    this.onPlaybackEnd = callback;
  }

  /**
   * Start a new playback session
   */
  startSession(sessionId: string, sampleRate?: number): void {
    log.info('SyncPlayback session started:', sessionId);
    
    this.sessionId = sessionId;
    this.isStopped = false;
    this.isPlaying = false;
    
    if (sampleRate) {
      this.sampleRate = sampleRate;
    }

    // Resume AudioContext if it was suspended (e.g., after minimize)
    AudioContextManager.resume().catch(() => {
      // Ignore resume errors - will be retried on user interaction
    });

    // Log sample rate vs AudioContext sample rate for diagnostics
    try {
      const ctx = this.audioContext;
      log.debug('Server sampleRate:', this.sampleRate, 'AudioContext sampleRate:', ctx.sampleRate);
    } catch (e) {
      log.warn('Unable to read AudioContext sampleRate for diagnostics', e);
    }
    
    // Clear buffer and reset state
    this.frameBuffer = [];
    this.scheduledFrames = [];
    this.currentFrameIndex = 0;
    this.nextPlayTime = 0;
    this.audioStartTime = 0;
    this.lastBlendshapeUpdate = 0;
    this.lastActiveFrameIndex = 0;
    this.currentWeights = { ...this.neutralWeights };
    
    // Clear any existing source nodes
    for (const source of this.activeSourceNodes) {
      try {
        source.stop(0);
        source.disconnect();
      } catch {
        // Ignore if already stopped
      }
    }
    this.activeSourceNodes.clear();
  }

  /**
   * Add a synchronized frame (audio + blendshape)
   */
  addSyncFrame(frame: SyncFrame): void {
    if (this.isStopped) {
      const now = Date.now();
      if (now - this.lastDropLogTime > 1000) {
        this.lastDropLogTime = now;
        log.debug('Dropping sync_frame while stopped', {
          bytes: frame.audio.byteLength,
          frameIndex: frame.frameIndex,
          timestamp: frame.timestamp,
          sessionId: this.sessionId,
        });
      }
      return;
    }

    // No buffer limit - frames arrive in bursts and drain naturally via audio playback
    // Audio is the master clock - buffer size will naturally stay bounded by response duration
    // Sequence-gap detection
    if (typeof frame.frameIndex === 'number') {
      if (this.lastReceivedFrameIndex !== null) {
        const expected = this.lastReceivedFrameIndex + 1;
        if (frame.frameIndex !== expected) {
          log.warn('SyncPlayback frame index gap/detect:', { last: this.lastReceivedFrameIndex, got: frame.frameIndex, expected });
        }
      }
      this.lastReceivedFrameIndex = frame.frameIndex;
    }

    this.frameBuffer.push(frame);

    // Log first frame
    if (frame.frameIndex === 0) {
      log.debug('First sync frame added:', frame.audio.byteLength, 'bytes audio');
    }

    // Start playback when we have enough buffered
    if (!this.isPlaying && this.frameBuffer.length >= this.minBufferFrames) {
      this.startPlayback();
    }
  }

  /**
   * Start synchronized playback
   */
  private startPlayback(): void {
    if (this.isPlaying || !this.audioContext || this.frameBuffer.length === 0) {
      return;
    }
    
    log.info('Starting synchronized playback with', this.frameBuffer.length, 'buffered frames');
    
    this.isPlaying = true;
    this.audioStartTime = this.audioContext.currentTime;
    this.nextPlayTime = this.audioStartTime;
    
    // Start the playback loop
    this.playbackLoop();
  }

  /**
   * Main playback loop - schedules audio and updates blendshapes
   * OPTIMIZED: Reduces update frequency when tab is hidden
   */
  private playbackLoop(): void {
    if (!this.isPlaying || !this.audioContext || this.isStopped) {
      return;
    }
    
    const currentTime = this.audioContext.currentTime;
    
    // Schedule audio chunks slightly ahead (150ms look-ahead for smooth playback)
    // Audio scheduling continues even when hidden (audio keeps playing)
    const lookAhead = 0.15;
    
    while (this.frameBuffer.length > 0 && this.nextPlayTime < currentTime + lookAhead) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Length checked above
      const frame = this.frameBuffer.shift()!;
      
      try {
        this.scheduleAudioFrame(frame);
      } catch (error) {
        log.error('sync-playback', 'Error scheduling audio frame', error);
      }
    }
    
    // OPTIMIZATION: Only update blendshapes when visible (saves CPU when tab hidden)
    // Audio continues playing, but visual updates are skipped
    if (this.isVisible) {
      this.updateBlendshapeForCurrentTime();
    }
    
    // Clean up old scheduled frames that have finished playing
    this.cleanupScheduledFrames();
    
    // Continue loop or end playback
    if (this.frameBuffer.length > 0 || this.activeSourceNodes.size > 0) {
      this.animationFrameId = requestAnimationFrame(() => this.playbackLoop());
    } else {
      this.handlePlaybackEnd();
    }
  }

  /**
   * Schedule a single audio frame for playback
   * OPTIMIZED: Reuses pre-allocated buffers when possible
   */
  private scheduleAudioFrame(frame: SyncFrame): void {
    if (!this.audioContext) return;
    
    // Wrap ArrayBuffer with Int16Array view (no allocation)
    const pcmData = new Int16Array(frame.audio);
    const sampleCount = pcmData.length;
    
    // OPTIMIZATION: Use pre-allocated buffer if size fits, otherwise allocate
    // This avoids allocation for typical frame sizes (800-2400 samples)
    let floatData: Float32Array;
    if (sampleCount <= this.maxSamplesPerFrame) {
      // Reuse pre-allocated buffer - just use a subarray view
      floatData = this.floatBuffer.subarray(0, sampleCount);
    } else {
      // Rare case: larger than expected, must allocate
      floatData = new Float32Array(sampleCount);
    }
    
    // Convert PCM16 to Float32 for Web Audio (optimized loop)
    const scale = 1.0 / 32768.0;
    for (let i = 0; i < sampleCount; i++) {
      floatData[i] = pcmData[i] * scale;
    }
    
    // Create audio buffer - this allocation is unavoidable (Web Audio API requirement)
    const audioBuffer = this.audioContext.createBuffer(1, sampleCount, this.sampleRate);
    audioBuffer.getChannelData(0).set(floatData);
    
    // Create and schedule source node
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    
    const startTime = Math.max(this.nextPlayTime, this.audioContext.currentTime);
    source.start(startTime);
    
    // Track this source node
    this.activeSourceNodes.add(source);
    
    // Track scheduling for blendshape sync
    const duration = audioBuffer.duration;
    const scheduledFrame: ScheduledFrame = {
      weights: frame.weights,
      startTime: startTime,
      endTime: startTime + duration,
      frameIndex: frame.frameIndex,
    };

    // No limit on scheduled frames - they're cleaned up by cleanupScheduledFrames()
    // and updateBlendshapeForCurrentTime() as they finish playing
    this.scheduledFrames.push(scheduledFrame);
    
    // Update next play time
    this.nextPlayTime = startTime + duration;
    this.currentFrameIndex = frame.frameIndex;
    
    // Remove source when done
    source.onended = () => {
      this.activeSourceNodes.delete(source);
    };
  }

  /**
   * Update blendshape based on current audio playback time
   *
   * KEY SYNCHRONIZATION: Find which scheduled frame is currently playing
   * and apply its blendshape weights. Audio is MASTER, blendshapes follow.
   */
  private updateBlendshapeForCurrentTime(): void {
    if (!this.audioContext || !this.onBlendshapeUpdate) return;

    const currentTime = this.audioContext.currentTime;

    // Clean up old frames that finished playing more than 1 second ago
    const cutoffTime = currentTime - 1.0;
    while (this.scheduledFrames.length > 0 && this.scheduledFrames[0].endTime < cutoffTime) {
      this.scheduledFrames.shift();
      this.lastActiveFrameIndex = Math.max(0, this.lastActiveFrameIndex - 1);
    }

    // Find the frame that should be playing right now
    let activeFrame: ScheduledFrame | null = null;

    // Search from last known position (frames are time-ordered)
    for (let i = this.lastActiveFrameIndex; i < this.scheduledFrames.length; i++) {
      const frame = this.scheduledFrames[i];
      if (currentTime >= frame.startTime && currentTime < frame.endTime) {
        activeFrame = frame;
        this.lastActiveFrameIndex = i;
        break;
      }
    }

    // If not found, search from beginning (edge case: time jumped backwards or first frame)
    if (!activeFrame && this.lastActiveFrameIndex > 0) {
      for (let i = 0; i < this.lastActiveFrameIndex; i++) {
        const frame = this.scheduledFrames[i];
        if (currentTime >= frame.startTime && currentTime < frame.endTime) {
          activeFrame = frame;
          this.lastActiveFrameIndex = i;
          break;
        }
      }
    }

    // Apply blendshape weights - simple and correct
    if (activeFrame) {
      this.currentWeights = activeFrame.weights;
      this.onBlendshapeUpdate(activeFrame.weights);
    } else if (this.isPlaying && this.scheduledFrames.length > 0) {
      // If we're between frames or slightly ahead, use the most recent frame
      const lastFrame = this.scheduledFrames[this.scheduledFrames.length - 1];
      if (currentTime < lastFrame.endTime + 0.1) {
        this.onBlendshapeUpdate(lastFrame.weights);
      }
    }
  }

  /**
   * Remove scheduled frames that have finished playing
   */
  private cleanupScheduledFrames(): void {
    if (!this.audioContext) return;
    
    const currentTime = this.audioContext.currentTime;
    
    // Keep frames that are still playing or scheduled for future
    // Plus a small buffer for smooth transitions
    this.scheduledFrames = this.scheduledFrames.filter(
      frame => frame.endTime > currentTime - 0.05
    );
  }

  /**
   * Called when all frames have been processed
   */
  endSession(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      return;
    }
    
    log.info('SyncPlayback session ending:', sessionId, 'remaining frames:', this.frameBuffer.length);
    
    // Let remaining buffered frames play out
    // Don't immediately stop - the scheduled audio will finish naturally
  }

  /**
   * Handle end of playback
   */
  private handlePlaybackEnd(): void {
    if (!this.isPlaying) return;
    
    log.info('SyncPlayback complete, total frames:', this.currentFrameIndex + 1);
    
    this.isPlaying = false;
    
    // Return to neutral expression
    if (this.onBlendshapeUpdate) {
      this.onBlendshapeUpdate(this.neutralWeights);
    }
    
    // Notify listener
    if (this.onPlaybackEnd) {
      this.onPlaybackEnd();
    }
  }

  /**
   * Immediately stop all playback
   */
  stop(): void {
    log.info('SyncPlayback stopped', {
      bufferedFrames: this.frameBuffer.length,
      scheduledFrames: this.scheduledFrames.length,
      activeSources: this.activeSourceNodes.size,
    });
    
    this.isStopped = true;
    this.isPlaying = false;
    this.frameBuffer = [];
    this.scheduledFrames = [];
    this.sessionId = null;
    this.currentFrameIndex = 0;
    this.lastReceivedFrameIndex = null;
    this.lastActiveFrameIndex = 0;
    this.lastBlendshapeUpdate = 0;
    this.nextPlayTime = 0;
    this.audioStartTime = 0;
    
    // Cancel animation frame
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Stop all active audio sources
    for (const source of this.activeSourceNodes) {
      try {
        source.stop(0);
        source.disconnect();
      } catch {
        // Ignore if already stopped
      }
    }
    this.activeSourceNodes.clear();
    
    // Suspend AudioContext to immediately silence any remaining audio
    // This is crucial because scheduled audio may still play even after source.stop()
    AudioContextManager.suspend().catch(() => {
      // Ignore suspend errors - non-critical
    });
    
    // Return to neutral
    this.currentWeights = { ...this.neutralWeights };
    if (this.onBlendshapeUpdate) {
      this.onBlendshapeUpdate(this.neutralWeights);
    }
  }

  /**
   * Get current playback state
   */
  getState(): PlaybackState {
    const audioPlaybackTime = this.audioContext 
      ? this.audioContext.currentTime - this.audioStartTime 
      : 0;
    
    return {
      isPlaying: this.isPlaying,
      currentFrameIndex: this.currentFrameIndex,
      bufferSize: this.frameBuffer.length,
      audioPlaybackTime: Math.max(0, audioPlaybackTime),
    };
  }

  /**
   * Get neutral weights for idle state
   */
  getNeutralWeights(): Record<string, number> {
    return { ...this.neutralWeights };
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return {
      activeSourceNodes: this.activeSourceNodes.size,
      scheduledFrames: this.scheduledFrames.length,
      bufferedFrames: this.frameBuffer.length
    };
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.visibilityHandler);

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Note: AudioContext is shared via AudioContextManager, don't close it here
  }
}
