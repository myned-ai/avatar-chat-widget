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
    // Check if microphone is available before trying to start
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const message = 'Voice input requires a secure connection (HTTPS). Please use text input instead.';
      log.warn(message);
      alert(message);
      return;
    }
    
    try {
      log.info('Starting recording (PCM16 24kHz)');
      
      // Start recording with PCM16 mode - this triggers permission prompt
      let chunkCount = 0;
      await this.audioInput.startRecording((audioData) => {
        chunkCount++;
        if (chunkCount <= 5 || chunkCount % 50 === 0) {
          log.debug(`Audio chunk ${chunkCount}: ${audioData.byteLength} bytes`);
        }
        this.protocolClient.sendAudioData(audioData);
      }, 'pcm16');
      
      // Only signal server AFTER recording successfully started (permission granted)
      this.protocolClient.sendAudioStreamStart();
      log.info('Recording started successfully, sent audio_stream_start to server');
      this.setRecordingState(true);
      
    } catch (error) {
      log.error('Failed to start recording:', error);
      errorBoundary.handleError(error as Error, 'audio-input');
      this.options.onError?.(error as Error);
      
      // Show user-friendly message based on error type
      const errorName = (error as Error).name || '';
      const errorMsg = (error as Error).message || '';
      const errorStr = `${errorName} ${errorMsg}`.toLowerCase();
      
      if (errorStr.includes('policy') || errorStr.includes('not allowed in this document')) {
        alert('Microphone is blocked by this website\'s security settings. The site owner needs to enable microphone access.');
      } else if (errorName === 'NotAllowedError' || errorStr.includes('permission denied') || errorStr.includes('denied')) {
        alert('Microphone access was denied. Please allow microphone access in your browser settings to use voice input.');
      } else {
        // Generic fallback - always show something
        alert('Could not access microphone. Please check your browser settings and try again.');
      }
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
