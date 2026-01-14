// Audio Input Handler
// Supports both WebM/Opus (MediaRecorder) and PCM16 (ScriptProcessor) modes
// PCM16 mode is required for OpenAI Realtime API

import { errorBoundary } from '../utils/ErrorBoundary';
import { logger } from '../utils/Logger';
import { CONFIG } from '../config';

const log = logger.scope('AudioInput');
import type { Disposable } from '../types/common';

export type AudioFormat = 'webm' | 'pcm16';

export class AudioInput implements Disposable {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isRecording = false;
  private onDataAvailable: ((data: ArrayBuffer) => void) | null = null;
  private audioChunks: Blob[] = [];
  private currentFormat: AudioFormat = 'webm';
  private useWorklet = true; // Try AudioWorklet first, fallback to ScriptProcessor

  // For PCM16 resampling (ScriptProcessor fallback only)
  private resampleBuffer: number[] = [];
  private readonly TARGET_SAMPLE_RATE = 24000;
  private readonly TARGET_BUFFER_SIZE = 2400; // 100ms at 24kHz

  async requestPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: CONFIG.audio.input.sampleRate,
          channelCount: CONFIG.audio.input.channels,
          echoCancellation: CONFIG.audio.input.echoCancellation,
          noiseSuppression: CONFIG.audio.input.noiseSuppression,
          autoGainControl: CONFIG.audio.input.autoGainControl,
        },
      });

      // Stop the stream immediately (we just wanted permission)
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-input');
      return false;
    }
  }

  /**
   * Start recording audio
   * @param onData Callback for audio data chunks
   * @param format Audio format: 'webm' for MediaRecorder, 'pcm16' for OpenAI Realtime API
   */
  async startRecording(
    onData: (data: ArrayBuffer) => void,
    format: AudioFormat = 'webm'
  ): Promise<void> {
    if (this.isRecording) {
      log.warn('Already recording');
      return;
    }

    this.onDataAvailable = onData;
    this.audioChunks = [];
    this.currentFormat = format;

    if (format === 'pcm16') {
      await this.startPCM16Recording(onData);
    } else {
      await this.startWebMRecording(onData);
    }
  }

  /**
   * Start PCM16 recording using AudioWorklet (preferred) or ScriptProcessorNode (fallback)
   * Outputs 24kHz mono 16-bit PCM suitable for OpenAI Realtime API
   * Resamples from browser's native sample rate (usually 44.1kHz or 48kHz)
   */
  private async startPCM16Recording(onData: (data: ArrayBuffer) => void): Promise<void> {
    try {
      // Get microphone stream FIRST - this triggers user permission
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: CONFIG.audio.input.echoCancellation,
          noiseSuppression: CONFIG.audio.input.noiseSuppression,
          autoGainControl: CONFIG.audio.input.autoGainControl,
        },
      });

      log.info('Microphone stream obtained');

      // Debug: Check stream tracks
      const tracks = this.mediaStream.getAudioTracks();
      log.debug(`Audio tracks: ${tracks.length}`);
      tracks.forEach((track, i) => {
        log.debug(`  Track ${i}: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}, readyState: ${track.readyState}`);
        const settings = track.getSettings();
        log.debug(`  Settings: sampleRate=${settings.sampleRate}, channelCount=${settings.channelCount}`);
      });

      // Create AudioContext - let browser use its preferred sample rate
      this.audioContext = new AudioContext();

      // Resume AudioContext if suspended (required by browsers)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const inputSampleRate = this.audioContext.sampleRate;
      log.debug(`AudioContext state: ${this.audioContext.state}, sample rate: ${inputSampleRate}Hz`);

      // Create source node from microphone
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Try AudioWorklet first, fallback to ScriptProcessorNode
      if (this.useWorklet && this.audioContext.audioWorklet) {
        try {
          await this.startWithAudioWorklet(onData, inputSampleRate);
        } catch (workletError) {
          log.warn('AudioWorklet failed, falling back to ScriptProcessorNode:', workletError);
          this.useWorklet = false;
          await this.startWithScriptProcessor(onData, inputSampleRate);
        }
      } else {
        await this.startWithScriptProcessor(onData, inputSampleRate);
      }

      this.isRecording = true;

    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-input');
      this.cleanup();
      throw error;
    }
  }

  /**
   * Start PCM16 recording using AudioWorklet (modern, efficient)
   */
  private async startWithAudioWorklet(onData: (data: ArrayBuffer) => void, inputSampleRate: number): Promise<void> {
    if (!this.audioContext || !this.sourceNode) {
      throw new Error('AudioContext not initialized');
    }

    // Load the worklet processor module
    // Use baseUrl from config for CDN compatibility
    const baseUrl = CONFIG.assets.baseUrl || '';
    const workletUrl = baseUrl ? `${baseUrl}/pcm16-processor.worklet.js` : '/pcm16-processor.worklet.js';
    await this.audioContext.audioWorklet.addModule(workletUrl);

    // Create worklet node
    this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm16-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });

    // Send configuration to worklet
    this.workletNode.port.postMessage({
      type: 'config',
      sampleRate: inputSampleRate
    });

    // Handle messages from worklet
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio') {
        // Receive PCM16 data from worklet (transferred ownership)
        if (this.onDataAvailable) {
          this.onDataAvailable(event.data.data);
        }
      } else if (event.data.type === 'debug') {
        // Debug logging from worklet
        const { counter, min, max, avg, samples } = event.data.data;
        log.debug(`[Worklet ${counter}] Audio input - min: ${min}, max: ${max}, avg: ${avg}, samples: ${samples}`);
      }
    };

    // Connect: microphone -> workletNode -> destination
    log.debug('Connecting audio nodes (AudioWorklet)...');
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.audioContext.destination);
    log.info('PCM16 recording started at 24kHz using AudioWorklet (optimized)');
  }

  /**
   * Start PCM16 recording using ScriptProcessorNode (fallback for older browsers)
   */
  private async startWithScriptProcessor(onData: (data: ArrayBuffer) => void, inputSampleRate: number): Promise<void> {
    if (!this.audioContext || !this.sourceNode) {
      throw new Error('AudioContext not initialized');
    }

    const resampleRatio = inputSampleRate / this.TARGET_SAMPLE_RATE;
    log.debug(`Using ScriptProcessorNode with resample ratio: ${resampleRatio.toFixed(2)}`);

    // Use ScriptProcessorNode (deprecated but widely supported)
    // Buffer size of 4096 gives us good latency while being efficient
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    // Reset resample buffer
    this.resampleBuffer = [];
    let sampleIndex = 0;

    // Handle audio processing
    let debugCounter = 0;
    log.debug('Setting up onaudioprocess handler...');

    this.scriptProcessor.onaudioprocess = (event) => {
      debugCounter++;
      const inputData = event.inputBuffer.getChannelData(0);

      // Debug: Log FIRST callback and then every 10
      if (debugCounter === 1 || debugCounter % 10 === 0) {
        let maxVal = 0;
        let minVal = 0;
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          if (inputData[i] > maxVal) maxVal = inputData[i];
          if (inputData[i] < minVal) minVal = inputData[i];
          sum += Math.abs(inputData[i]);
        }
        const avg = sum / inputData.length;
        log.debug(`[${debugCounter}] Audio input - min: ${minVal.toFixed(4)}, max: ${maxVal.toFixed(4)}, avg: ${avg.toFixed(6)}, samples: ${inputData.length}`);
      }

      // Downsample from native rate to 24kHz
      for (let i = 0; i < inputData.length; i++) {
        sampleIndex++;
        if (sampleIndex >= resampleRatio) {
          sampleIndex -= resampleRatio;
          this.resampleBuffer.push(inputData[i]);
        }
      }

      // When we have enough samples, send a chunk
      while (this.resampleBuffer.length >= this.TARGET_BUFFER_SIZE) {
        const chunk = this.resampleBuffer.splice(0, this.TARGET_BUFFER_SIZE);

        // Convert float32 to int16 PCM
        const pcm16 = new Int16Array(this.TARGET_BUFFER_SIZE);
        for (let j = 0; j < this.TARGET_BUFFER_SIZE; j++) {
          const s = Math.max(-1, Math.min(1, chunk[j]));
          pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send to callback
        if (this.onDataAvailable) {
          this.onDataAvailable(pcm16.buffer);
        }
      }
    };

    // Connect: microphone -> scriptProcessor -> destination
    log.debug('Connecting audio nodes (ScriptProcessor)...');
    this.sourceNode.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
    log.info('PCM16 recording started at 24kHz using ScriptProcessorNode (fallback)');
  }

  /**
   * Start WebM/Opus recording using MediaRecorder
   * Traditional browser recording format
   */
  private async startWebMRecording(_onData: (data: ArrayBuffer) => void): Promise<void> {
    try {
      // Get microphone stream
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: CONFIG.audio.input.sampleRate,
          channelCount: CONFIG.audio.input.channels,
          echoCancellation: CONFIG.audio.input.echoCancellation,
          noiseSuppression: CONFIG.audio.input.noiseSuppression,
          autoGainControl: CONFIG.audio.input.autoGainControl,
        },
      });

      // Find supported codec
      const supportedCodecs = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ];

      const codec = supportedCodecs.find(c => MediaRecorder.isTypeSupported(c));
      
      if (!codec) {
        throw new Error('No supported audio codec found');
      }

      // Create recorder
      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: codec,
      });

      // Handle data availability (streaming chunks)
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          
          // Convert Blob to ArrayBuffer and send
          event.data.arrayBuffer().then((buffer) => {
            if (this.onDataAvailable) {
              this.onDataAvailable(buffer);
            }
          });
        }
      };

      this.mediaRecorder.onerror = (event) => {
        errorBoundary.handleError(
          new Error(`MediaRecorder error: ${(event as Event & { error?: string }).error || 'Unknown error'}`),
          'audio-input'
        );
      };

      // Start recording with timeslices (send data every 100ms)
      this.mediaRecorder.start(100);
      this.isRecording = true;

      log.info('Recording started with codec:', codec);

    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-input');
      this.cleanup();
      throw error;
    }
  }

  stopRecording(): void {
    if (!this.isRecording) {
      return;
    }

    try {
      if (this.currentFormat === 'pcm16') {
        // Stop PCM16 recording
        if (this.workletNode) {
          this.workletNode.disconnect();
          this.workletNode.port.onmessage = null;
        }
        if (this.scriptProcessor) {
          this.scriptProcessor.disconnect();
        }
        if (this.sourceNode) {
          this.sourceNode.disconnect();
        }
        if (this.audioContext) {
          this.audioContext.close();
        }
      } else {
        // Stop WebM recording
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
      }
    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-input');
    }

    this.isRecording = false;
    log.info('Recording stopped');
  }

  pauseRecording(): void {
    if (!this.isRecording) {
      return;
    }

    try {
      if (this.currentFormat === 'pcm16') {
        // Pause PCM16 by suspending audio context
        if (this.audioContext && this.audioContext.state === 'running') {
          this.audioContext.suspend();
        }
      } else {
        // Pause WebM recording
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.pause();
        }
      }
    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-input');
    }
  }

  resumeRecording(): void {
    if (!this.isRecording) {
      return;
    }

    try {
      if (this.currentFormat === 'pcm16') {
        // Resume PCM16 by resuming audio context
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume();
        }
      } else {
        // Resume WebM recording
        if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
          this.mediaRecorder.resume();
        }
      }
    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-input');
    }
  }

  isCurrentlyRecording(): boolean {
    if (this.currentFormat === 'pcm16') {
      return this.isRecording && this.audioContext?.state === 'running';
    }
    return this.isRecording && this.mediaRecorder?.state === 'recording';
  }

  getRecordingState(): RecordingState {
    if (this.currentFormat === 'pcm16') {
      if (!this.audioContext) return 'inactive';
      if (this.audioContext.state === 'running') return 'recording';
      if (this.audioContext.state === 'suspended') return 'paused';
      return 'inactive';
    }
    
    if (!this.mediaRecorder) {
      return 'inactive';
    }
    return this.mediaRecorder.state;
  }

  getCurrentFormat(): AudioFormat {
    return this.currentFormat;
  }

  private cleanup(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.onmessage = null;
      this.workletNode = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.mediaRecorder = null;
    this.isRecording = false;
    this.onDataAvailable = null;
    this.audioChunks = [];
  }

  dispose(): void {
    this.stopRecording();
    this.cleanup();
  }
}
