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
    url: (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL) || 'ws://localhost:8080/ws',
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

/**
 * Deep clone utility that preserves functions, dates, and other non-JSON types
 */
function deepClone<T>(obj: T): T {
  // Handle null and non-objects
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Handle Date
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  // Handle Array
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as T;
  }

  // Handle Object
  const clonedObj = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      clonedObj[key] = deepClone(obj[key]);
    }
  }
  return clonedObj;
}

// Mutable config that can be updated at runtime (use proper deep clone)
let runtimeConfig: AppConfig = deepClone(DEFAULT_CONFIG);

/**
 * Deep merge utility that preserves functions and non-JSON values
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        typeof source[key] !== 'function'
      ) {
        result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>) as T[Extract<keyof T, string>];
      } else {
        result[key] = source[key] as T[Extract<keyof T, string>];
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
 * Reset to default configuration (preserves functions and non-JSON values)
 */
export function resetConfig(): void {
  runtimeConfig = deepClone(DEFAULT_CONFIG);
}

/**
 * Legacy CONFIG export for backward compatibility
 * Proxies to runtimeConfig for seamless migration
 * Read-only with proper validation
 */
export const CONFIG: Readonly<AppConfig> = new Proxy({} as AppConfig, {
  get(_target, prop: string | symbol) {
    // Always read from current runtimeConfig (not the original target)
    if (typeof prop === 'string' && prop in runtimeConfig) {
      return runtimeConfig[prop as keyof AppConfig];
    }
    // Handle Symbol properties (for iterators, etc.)
    if (typeof prop === 'symbol') {
      return (runtimeConfig as unknown as Record<symbol, unknown>)[prop];
    }
    throw new Error(`Invalid config property: ${String(prop)}`);
  },
  set(_target, prop: string | symbol) {
    throw new Error(`CONFIG is read-only. Use setConfig() to update. Attempted to set: ${String(prop)}`);
  },
  deleteProperty(_target, prop: string | symbol) {
    throw new Error(`CONFIG is read-only. Cannot delete property: ${String(prop)}`);
  },
});

export type Config = AppConfig;
