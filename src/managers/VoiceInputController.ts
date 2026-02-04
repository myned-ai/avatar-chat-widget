/**
 * VoiceInputController - Manages microphone recording and voice input
 * 
 * Handles starting/stopping voice recording and sending audio data
 * to the protocol client.
 * 
 * @example
 * ```typescript
 * const voice = new VoiceInputController({
 *   audioInput: new AudioInput(),
 *   protocolClient: client,
 *   micBtn: document.getElementById('mic'),
 *   onRecordingChange: (recording) => updateUI(recording)
 * });
 * await voice.toggle();
 * ```
 */

import { AudioInput } from '../services/AudioInput';
import { AvatarProtocolClient } from '../services/AvatarProtocolClient';
import { errorBoundary } from '../utils/ErrorBoundary';
import { logger } from '../utils/Logger';
import type { Disposable } from '../types/common';

const log = logger.scope('VoiceInputController');

export interface VoiceInputControllerOptions {
  /** AudioInput service for recording */
  audioInput: AudioInput;
  /** Protocol client for sending audio */
  protocolClient: AvatarProtocolClient;
  /** Microphone button element */
  micBtn: HTMLButtonElement;
  /** Callback when recording state changes */
  onRecordingChange?: (isRecording: boolean) => void;
  /** Callback when recording starts (for avatar state) */
  onRecordingStart?: () => void;
  /** Callback when recording stops */
  onRecordingStop?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

export class VoiceInputController implements Disposable {
  private audioInput: AudioInput;
  private protocolClient: AvatarProtocolClient;
  private micBtn: HTMLButtonElement;
  private options: VoiceInputControllerOptions;
  
  private isRecording = false;

  constructor(options: VoiceInputControllerOptions) {
    this.audioInput = options.audioInput;
    this.protocolClient = options.protocolClient;
    this.micBtn = options.micBtn;
    this.options = options;
  }

  /**
   * Toggle voice recording on/off
   */
  async toggle(): Promise<void> {
    log.info('toggleVoiceInput called, isRecording:', this.isRecording);
    
    if (!this.isRecording) {
      this.options.onRecordingStart?.();
    }
    
    if (this.isRecording) {
      log.info('Stopping recording...');
      this.stop();
    } else {
      log.info('Starting recording...');
      await this.start();
    }
  }

  /**
   * Start voice recording
   */
  async start(): Promise<void> {
    try {
      log.info('Starting recording (PCM16 24kHz)');

      // Signal server that audio stream is starting
      this.protocolClient.sendAudioStreamStart();
      log.info('Sent audio_stream_start to server');
      
      // Start recording with PCM16 mode
      let chunkCount = 0;
      await this.audioInput.startRecording((audioData) => {
        chunkCount++;
        if (chunkCount <= 5 || chunkCount % 50 === 0) {
          log.debug(`Audio chunk ${chunkCount}: ${audioData.byteLength} bytes`);
        }
        this.protocolClient.sendAudioData(audioData);
      }, 'pcm16');
      
      log.info('Recording started successfully');
      this.setRecordingState(true);
      
    } catch (error) {
      log.error('Failed to start recording:', error);
      errorBoundary.handleError(error as Error, 'audio-input');
      this.options.onError?.(error as Error);
      alert('Microphone access denied. Please enable microphone permissions.');
    }
  }

  /**
   * Stop voice recording
   */
  stop(): void {
    this.audioInput.stopRecording();
    
    // Signal server that audio stream has ended
    this.protocolClient.sendAudioStreamEnd();
    
    this.setRecordingState(false);
    this.options.onRecordingStop?.();
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Set the microphone button element (for dynamic updates)
   */
  setMicBtn(btn: HTMLButtonElement): void {
    this.micBtn = btn;
    this.updateMicBtnState();
  }

  private setRecordingState(recording: boolean): void {
    this.isRecording = recording;
    this.updateMicBtnState();
    this.options.onRecordingChange?.(recording);
  }

  private updateMicBtnState(): void {
    if (this.isRecording) {
      this.micBtn.classList.add('recording');
      this.micBtn.setAttribute('aria-pressed', 'true');
    } else {
      this.micBtn.classList.remove('recording');
      this.micBtn.setAttribute('aria-pressed', 'false');
    }
  }

  dispose(): void {
    if (this.isRecording) {
      this.stop();
    }
  }
}
