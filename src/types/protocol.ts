// Avatar Chat Protocol V1.3 Definitions

export interface ProtocolEvent {
  type: string;
  timestamp?: number;
}

// ------------------------------------------------------------------
// Server-to-Client Events
// ------------------------------------------------------------------

export interface AudioStartEvent extends ProtocolEvent {
  type: 'audio_start';
  turnId: string;
  sessionId: string;
  sampleRate: number;
  format: string;
  timestamp: number;
}

export interface SyncFrameEvent extends ProtocolEvent {
  type: 'sync_frame';
  audio: string;         // Base64 PCM16
  weights: number[] | Record<string, number>;  // 52 ARKit weights (array or object)
  frameIndex: number;
  turnId: string;
  timestamp: number;
  sessionId?: string;    // Compatibility
}

export interface AudioEndEvent extends ProtocolEvent {
  type: 'audio_end';
  turnId: string;
  sessionId: string;
  timestamp: number;
}

export interface TranscriptDeltaEvent extends ProtocolEvent {
  type: 'transcript_delta';
  role: 'assistant' | 'user';
  text: string;
  turnId: string;
  startOffset?: number;
  endOffset?: number;
  itemId?: string; // Optional for compatibility/tracking
  previousItemId?: string;
}

export interface TranscriptDoneEvent extends ProtocolEvent {
  type: 'transcript_done';
  role: 'assistant' | 'user';
  text: string;
  turnId: string;
  interrupted?: boolean;
  itemId?: string;
}

export interface InterruptEvent extends ProtocolEvent {
  type: 'interrupt';
  turnId: string;
  offsetMs: number;
  timestamp: number;
}

export interface AvatarStateEvent extends ProtocolEvent {
  type: 'avatar_state';
  state: 'Listening' | 'Responding' | 'Processing' | 'Idle';
}

export interface PongEvent extends ProtocolEvent {
  type: 'pong';
  timestamp: number;
}

export interface ConfigEvent extends ProtocolEvent {
  type: 'config';
  audio?: {
    inputSampleRate?: number;
    outputSampleRate?: number;
  };
}

// ------------------------------------------------------------------
// Client-to-Server Events
// ------------------------------------------------------------------

export interface AudioStreamStartMessage {
  type: 'audio_stream_start';
  userId?: string;
}

export interface AudioMessage {
  type: 'audio';
  data: string; // Base64
}

export interface TextMessage {
  type: 'text';
  data: string;
}

export interface InterruptMessage {
  type: 'interrupt';
}

export interface PingMessage {
  type: 'ping';
}

// Union type for all outgoing messages
export type OutgoingMessage = 
  | AudioStreamStartMessage 
  | AudioMessage 
  | TextMessage 
  | InterruptMessage 
  | PingMessage;
