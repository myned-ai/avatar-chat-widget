// Common Types and Interfaces

export interface Disposable {
  dispose(): void;
}

export type ChatState = 'Idle' | 'Hello' | 'Responding';

export interface EventCallback<T = any> {
  (data: T): void;
}

export interface EventEmitter {
  on(event: string, callback: EventCallback): void;
  off(event: string, callback: EventCallback): void;
  emit(event: string, data?: any): void;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface FeatureFlags {
  audioInput: boolean;
  audioOutput: boolean;
  blendshapes: boolean;
  textChat: boolean;
}
