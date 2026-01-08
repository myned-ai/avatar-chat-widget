// Audio Output Handler with Adaptive Buffering Strategy

import { CircularBuffer } from '../utils/CircularBuffer';
import { AdaptiveBuffer } from '../utils/AdaptiveBuffer';
import { AudioContextManager } from './AudioContextManager';
import { logger } from '../utils/Logger';
import { CONFIG } from '../config';

const log = logger.scope('AudioOutput');
import type { Disposable } from '../types/common';
import type { AudioBuffer } from '../types/messages';

export class AudioOutput implements Disposable {
  private audioBuffer: CircularBuffer<AudioBuffer>;
  private adaptiveBuffer: AdaptiveBuffer;
  private isPlaying = false;
  private currentSourceNode: AudioBufferSourceNode | null = null;
  private activeSourceNodes: Set<AudioBufferSourceNode> = new Set();
  private nextPlayTime = 0;
  private sessionId: string | null = null;
  private sampleRate: number = CONFIG.audio.output.sampleRate;
  private isStopped = false;
  private readonly chunkDurationMs = 100; // 2400 samples at 24kHz = 100ms

  constructor() {
    this.audioBuffer = new CircularBuffer<AudioBuffer>(CONFIG.audio.output.maxBufferFrames);

    // Initialize adaptive buffer manager
    // Start with 100ms, allow 50-500ms range
    this.adaptiveBuffer = new AdaptiveBuffer(100, 50, 500);

    // Initialize shared AudioContext (handles resume listener internally)
    AudioContextManager.getContext(this.sampleRate);
  }

  /**
   * Get the shared AudioContext
   */
  private get audioContext(): AudioContext {
    return AudioContextManager.getContext();
  }

  startSession(sessionId: string, sampleRate?: number): void {
    log.info('Audio output session started:', sessionId);
    this.sessionId = sessionId;
    this.isStopped = false; // Allow audio again
    if (sampleRate) {
      this.sampleRate = sampleRate;
    }
    this.audioBuffer.clear();
    this.isPlaying = false;
    this.nextPlayTime = 0;
  }

  addAudioChunk(data: ArrayBuffer, timestamp: number): void {
    // Ignore incoming audio if stopped
    if (this.isStopped) {
      return;
    }

    if (!this.audioContext) {
      log.warn('Audio context not initialized');
      return;
    }

    const receiveTime = Date.now();

    const audioBuffer: AudioBuffer = {
      data,
      timestamp,
      sampleRate: this.sampleRate,
    };

    this.audioBuffer.push(audioBuffer);

    // Record arrival time for adaptive buffering
    this.adaptiveBuffer.recordArrival(timestamp, receiveTime);

    // Start playback if we have enough buffered (use adaptive threshold)
    if (!this.isPlaying) {
      const minFrames = this.adaptiveBuffer.getMinBufferFramesForStart(this.chunkDurationMs);
      if (this.audioBuffer.size >= minFrames) {
        this.startPlayback();
      }
    }
  }

  private async startPlayback(): Promise<void> {
    if (this.isPlaying || !this.audioContext) {
      return;
    }

    this.isPlaying = true;
    this.nextPlayTime = this.audioContext.currentTime;

    try {
      await this.playNextChunk();
    } catch (error) {
      log.error('Playback error:', error);
      this.isPlaying = false;
    }
  }

  private async playNextChunk(): Promise<void> {
    if (!this.isPlaying || this.isStopped) {
      return;
    }

    const chunk = this.audioBuffer.pop();

    if (!chunk) {
      // Buffer underrun - record and adjust buffer size
      log.warn('Audio buffer underrun');
      this.adaptiveBuffer.recordUnderrun();
      this.isPlaying = false;
      return;
    }

    try {
      // Create AudioBuffer from raw PCM data (16-bit signed integers)
      const pcmData = new Int16Array(chunk.data);
      const audioBuffer = this.audioContext.createBuffer(
        1, // mono
        pcmData.length,
        this.sampleRate
      );
      
      // Convert Int16 to Float32 (Web Audio uses -1.0 to 1.0 range)
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcmData.length; i++) {
        channelData[i] = pcmData[i] / 32768.0;
      }

      // Create source node
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      // Track this source node
      this.activeSourceNodes.add(source);

      // Schedule playback
      const startTime = Math.max(this.nextPlayTime, this.audioContext.currentTime);
      source.start(startTime);
      
      this.currentSourceNode = source;
      this.nextPlayTime = startTime + audioBuffer.duration;

      // Play next chunk when this one finishes
      source.onended = () => {
        this.activeSourceNodes.delete(source);
        this.currentSourceNode = null;
        if (this.isPlaying && !this.isStopped) {
          this.playNextChunk();
        }
      };

    } catch (error) {
      log.error('Error playing chunk:', error);
      
      // Continue with next chunk despite error
      if (this.isPlaying && !this.isStopped) {
        setTimeout(() => this.playNextChunk(), 50);
      }
    }
  }

  endSession(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      return;
    }

    log.info('Audio output session ended:', sessionId);
    
    // Play remaining buffered audio
    if (this.audioBuffer.size > 0 && !this.isPlaying) {
      this.startPlayback();
    }
    
    this.sessionId = null;
  }

  stop(): void {
    log.debug('AudioOutput.stop() called, stopping', this.activeSourceNodes.size, 'active sources');
    this.isStopped = true;
    this.isPlaying = false;
    
    // Stop ALL active source nodes
    for (const source of this.activeSourceNodes) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignore if already stopped
      }
    }
    this.activeSourceNodes.clear();
    this.currentSourceNode = null;
    
    // Clear the buffer
    this.audioBuffer.clear();
    this.nextPlayTime = 0;
    this.sessionId = null;
    
    log.debug('Audio stopped completely');
  }

  getBufferSize(): number {
    return this.audioBuffer.size;
  }

  isBufferHealthy(): boolean {
    const currentBufferMs = this.audioBuffer.size * this.chunkDurationMs;
    return this.adaptiveBuffer.isBufferHealthy(currentBufferMs);
  }

  /**
   * Get adaptive buffer statistics for monitoring
   */
  getBufferStats() {
    return this.adaptiveBuffer.getStats();
  }

  dispose(): void {
    this.stop();
    // Note: AudioContext is shared via AudioContextManager, don't close it here
  }
}
