// Common Types and Interfaces

export interface Disposable {
  dispose(): void;
}

export type ChatState = 'Idle' | 'Responding';

export interface EventCallback<T = unknown> {
  (data: T): void;
}

export interface EventEmitter {
  on(event: string, callback: EventCallback): void;
  off(event: string, callback: EventCallback): void;
  emit(event: string, data?: unknown): void;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface FeatureFlags {
  audioInput: boolean;
  audioOutput: boolean;
  blendshapes: boolean;
  textChat: boolean;
}
