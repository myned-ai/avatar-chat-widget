/**
 * Application Configuration
 * 
 * Supports both build-time (env vars) and runtime configuration.
 * Runtime config set via setConfig() takes precedence.
 */

// Configuration interface
export interface AppConfig {
  auth: {
    enabled: boolean;
  };
  websocket: {
    url: string;
    reconnectAttempts: number;
    initialReconnectDelay: number;
    maxReconnectDelay: number;
    heartbeatInterval: number;
    connectionTimeout: number;
  };
  audio: {
    input: {
      sampleRate: number;
      channels: number;
      codec: string;
      echoCancellation: boolean;
      noiseSuppression: boolean;
      autoGainControl: boolean;
    };
    output: {
      sampleRate: number;
      bufferSize: number;
      targetLatency: number;
      minBufferFrames: number;
      maxBufferFrames: number;
    };
  };
  blendshape: {
    fps: number;
    bufferSize: number;
    interpolation: boolean;
    smoothing: number;
  };
  chat: {
    maxMessages: number;
    autoScroll: boolean;
    showTimestamps: boolean;
  };
  performance: {
    enableMonitoring: boolean;
    latencyThreshold: number;
    frameDropThreshold: number;
  };
  ui: {
    avatarBackgroundColor: string;
    useIrisOcclusion: boolean;
  };
  assets: {
    baseUrl: string; // Base URL for loading assets (worklet, default avatar)
    defaultAvatarPath: string; // Path to default avatar ZIP
  };
}

// Default configuration
const DEFAULT_CONFIG: AppConfig = {
  auth: {
    enabled: false, // Dev mode: auth disabled for local testing
  },
  websocket: {
    url: (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_WS_URL) || 'ws://localhost:8080/ws',
    reconnectAttempts: 5,
    initialReconnectDelay: 1000, // ms
    maxReconnectDelay: 30000, // ms
    heartbeatInterval: 30000, // ms
    connectionTimeout: 10000, // ms
  },
  audio: {
    input: {
      sampleRate: 16000,
      channels: 1,
      codec: 'audio/webm;codecs=opus',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    output: {
      sampleRate: 24000,
      bufferSize: 4096,
      targetLatency: 200, // ms
      minBufferFrames: 3,
      maxBufferFrames: 10,
    },
  },
  blendshape: {
    fps: 30,
    bufferSize: 60, // frames (2 seconds @ 30fps)
    interpolation: true,
    smoothing: 0.3, // smoothing factor 0-1
  },
  chat: {
    maxMessages: 100,
    autoScroll: true,
    showTimestamps: true,
  },
  performance: {
    enableMonitoring: true,
    latencyThreshold: 500, // ms
    frameDropThreshold: 5, // consecutive drops
  },
  ui: {
    avatarBackgroundColor: '0xffffff',
    useIrisOcclusion: true,
  },
  assets: {
    // Default to local paths (works in dev mode)
    // CDN usage will auto-detect and override this in widget.ts init()
    baseUrl: '',  // Empty = use root path (works with Vite's public folder)
    defaultAvatarPath: '/asset/nyx.zip',
  },
};

// Mutable config that can be updated at runtime
let runtimeConfig: AppConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

/**
 * Deep merge utility
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object'
      ) {
        result[key] = deepMerge(target[key], source[key] as any);
      } else {
        result[key] = source[key] as any;
      }
    }
  }
  return result;
}

/**
 * Get current configuration
 */
export function getConfig(): AppConfig {
  return runtimeConfig;
}

/**
 * Update configuration at runtime
 * Called by widget.init() to set user options
 */
export function setConfig(config: Partial<AppConfig>): void {
  runtimeConfig = deepMerge(runtimeConfig, config);
}

/**
 * Reset to default configuration
 */
export function resetConfig(): void {
  runtimeConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Legacy CONFIG export for backward compatibility
 * Proxies to runtimeConfig for seamless migration
 */
export const CONFIG: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop: string) {
    return runtimeConfig[prop as keyof AppConfig];
  },
});

export type Config = AppConfig;
