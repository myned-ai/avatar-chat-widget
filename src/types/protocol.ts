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
  rich_content?: RichContentItem[];
}

export interface RichContentItem {
  /** High-level category (e.g., 'table', 'media', 'card', 'interactive', 'link') */
  type: string;
  /** Specific variant or rendering hint (e.g., 'chart_js', 'product_card', 'poll') */
  subtype?: string;
  /** Arbitrary JSON payload required to render this content */
  payload: Record<string, any>;
  /** Optional ID for stateful in-place updates */
  item_id?: string;
  /** Action indicating how to handle the item in the UI */
  action?: 'append' | 'replace' | 'remove';
}

/**
 * Sent by the server asynchronously, independent of any conversation turn.
 */
export interface ServerEventMessage extends ProtocolEvent {
  type: 'server_event';
  /** Event name for routing */
  name: string;
  /** Optional text to display as a chat bubble */
  text?: string;
  /** Optional rich content items to render in the chat feed */
  rich_content?: RichContentItem[];
  /** Optional ID to correlate with a client request */
  reply_to_id?: string;
  /** If true, the widget should play a notification sound / visual indicator */
  notify?: boolean;
}

export interface InterruptEvent extends ProtocolEvent {
  type: 'interrupt';
  turnId: string;
  offsetMs: number;
  timestamp: number;
}

export interface TriggerActionEvent extends ProtocolEvent {
  type: 'trigger_action';
  function_name: string;
  arguments: Record<string, any>;
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

export interface AttachmentData {
  /** Base64 encoded file content */
  content: string;
  /** MIME type (e.g., 'image/jpeg', 'application/pdf') */
  mime_type: string;
  /** Original file name */
  filename?: string;
}

export interface TextMessage {
  type: 'text';
  data: string;
  attachments?: AttachmentData[];
}

export interface ClientEventMessage {
  type: 'client_event';
  /** The name of the event */
  name: string;
  /** Associated JSON data */
  data?: Record<string, any>;
  /** How the server should handle: 'context' (silent), 'speak' (interrupt AI), 'trigger' (bypass LLM) */
  directive?: 'context' | 'speak' | 'trigger';
  /** Optional correlation ID for awaitable responses */
  request_id?: string;
  /** Optional attachments (e.g., screenshots) accompanying the event */
  attachments?: AttachmentData[];
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
  | PingMessage
  | ClientEventMessage;
