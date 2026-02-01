// Message Types for WebSocket Communication

export interface BaseMessage {
  type: string;
  timestamp: number;
}

// Outgoing Messages (Client -> Server)
export interface OutgoingTextMessage extends BaseMessage {
  type: 'text';
  data: string;
  userId: string;
}

export interface OutgoingAudioMessage extends BaseMessage {
  type: 'audio';
  data: ArrayBuffer | string;  // ArrayBuffer for binary, string for base64
  format: 'audio/webm' | 'audio/opus' | 'audio/pcm16';
  userId: string;
  sampleRate: number;
}

// Audio stream control messages (Client -> Server)
export interface AudioStreamStartMessage extends BaseMessage {
  type: 'audio_stream_start';
  userId: string;
  format: 'audio/webm' | 'audio/opus' | 'audio/pcm16';
  sampleRate: number;
}

export interface AudioStreamEndMessage extends BaseMessage {
  type: 'audio_stream_end';
  userId: string;
}

// Audio input message for binary protocol
export interface AudioInputMessage extends BaseMessage {
  type: 'audio_input';
  data: ArrayBuffer;
}

// Ping message for heartbeat
export interface PingMessage extends BaseMessage {
  type: 'ping';
}

// Chat message for binary protocol
export interface ChatMessageOut extends BaseMessage {
  type: 'chat_message';
  text: string;
  userId?: string;
}

// Interrupt message for client-initiated interruption
export interface InterruptOutMessage extends BaseMessage {
  type: 'interrupt';
}

export type OutgoingMessage =
  | OutgoingTextMessage
  | OutgoingAudioMessage
  | AudioStreamStartMessage
  | AudioStreamEndMessage
  | AudioInputMessage
  | PingMessage
  | ChatMessageOut
  | InterruptOutMessage;

// Incoming Messages (Server -> Client)
export interface IncomingTextMessage extends BaseMessage {
  type: 'text';
  data: string;
  sessionId: string;
}

export interface AudioStartMessage extends BaseMessage {
  type: 'audio_start';
  sessionId: string;
  sampleRate: number;
  format: string;
}

export interface AudioChunkMessage extends BaseMessage {
  type: 'audio_chunk';
  data: ArrayBuffer;
  sessionId: string;
}

export interface AudioEndMessage extends BaseMessage {
  type: 'audio_end';
  sessionId: string;
}

export interface BlendshapeFrameMessage extends BaseMessage {
  type: 'blendshape';
  weights: Record<string, number>;
  sessionId: string;
}

// Synchronized audio+blendshape frame (OpenAvatarChat pattern)
// Audio and facial expression are paired together for perfect sync
export interface SyncFrameMessage extends BaseMessage {
  type: 'sync_frame';
  weights: Record<string, number>;
  audio: string;  // base64 encoded PCM16 audio
  sessionId: string;
  frameIndex: number;
}

export interface ErrorMessage extends BaseMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface StatusMessage extends BaseMessage {
  type: 'status';
  status: 'connected' | 'disconnected' | 'processing' | 'idle';
}

// Server tells client what state the avatar should be in
export interface AvatarStateMessage extends BaseMessage {
  type: 'avatar_state';
  state: 'Idle' | 'Listening' | 'Thinking' | 'Responding';
}

// Interrupt message - server tells client to stop current audio playback
export interface InterruptMessage extends BaseMessage {
  type: 'interrupt';
}

// Transcript messages for real-time speech transcription
export interface TranscriptDeltaMessage extends BaseMessage {
  type: 'transcript_delta';
  text: string;
  role: 'user' | 'assistant';
  startOffset: number;
  endOffset: number;
}

export interface TranscriptDoneMessage extends BaseMessage {
  type: 'transcript_done';
  text: string;
  role: 'user' | 'assistant';
  finalAudioDurationMs: number;
}

export type IncomingMessage = 
  | IncomingTextMessage 
  | AudioStartMessage 
  | AudioChunkMessage 
  | AudioEndMessage 
  | BlendshapeFrameMessage 
  | SyncFrameMessage
  | ErrorMessage
  | StatusMessage
  | AvatarStateMessage
  | InterruptMessage
  | TranscriptDeltaMessage
  | TranscriptDoneMessage;

// Blendshape data structure
export interface BlendshapeFrame {
  weights: Record<string, number>;
  timestamp: number;
}

// Audio buffer structure
export interface AudioBuffer {
  data: ArrayBuffer;
  timestamp: number;
  sampleRate: number;
}

// Chat message for UI
export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'assistant';
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
}
