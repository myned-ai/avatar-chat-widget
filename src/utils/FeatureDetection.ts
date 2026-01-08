// Feature Detection and Browser Capability Checks

import type { FeatureFlags } from '../types/common';
import { logger } from './Logger';

const log = logger.scope('FeatureDetection');

export class FeatureDetection {
  static checkWebSocket(): boolean {
    return 'WebSocket' in window;
  }

  static checkMediaRecorder(): boolean {
    return 'MediaRecorder' in window;
  }

  static checkGetUserMedia(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  static checkWebAudio(): boolean {
    return 'AudioContext' in window || 'webkitAudioContext' in window;
  }

  static checkWorker(): boolean {
    return 'Worker' in window;
  }

  static async checkMicrophonePermission(): Promise<'granted' | 'denied' | 'prompt'> {
    if (!navigator.permissions) {
      return 'prompt';
    }

    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return result.state;
    } catch {
      return 'prompt';
    }
  }

  static getSupportedAudioCodecs(): string[] {
    if (!this.checkMediaRecorder()) {
      return [];
    }

    const codecs = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    return codecs.filter(codec => MediaRecorder.isTypeSupported(codec));
  }

  static getAvailableFeatures(): FeatureFlags {
    return {
      audioInput: this.checkGetUserMedia() && this.checkMediaRecorder(),
      audioOutput: this.checkWebAudio(),
      blendshapes: true, // Always available (WebGL-based)
      textChat: this.checkWebSocket(),
    };
  }

  static getRecommendedMode(): 'full' | 'audio-output-only' | 'text-only' | 'degraded' {
    const features = this.getAvailableFeatures();

    if (features.audioInput && features.audioOutput && features.textChat) {
      return 'full';
    }

    if (features.audioOutput && features.textChat) {
      return 'audio-output-only';
    }

    if (features.textChat) {
      return 'text-only';
    }

    return 'degraded';
  }

  static logCapabilities(): void {
    log.info('Browser Capabilities:', {
      webSocket: this.checkWebSocket(),
      mediaRecorder: this.checkMediaRecorder(),
      getUserMedia: this.checkGetUserMedia(),
      webAudio: this.checkWebAudio(),
      worker: this.checkWorker(),
      supportedCodecs: this.getSupportedAudioCodecs(),
      recommendedMode: this.getRecommendedMode(),
    });
  }
}
