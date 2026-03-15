import { EventEmitter } from '../utils/EventEmitter';
import { SocketService } from './SocketService';
import { logger } from '../utils/Logger';
import type { OutgoingMessage } from '../types/messages';
import {
  AudioStartEvent,
  SyncFrameEvent,
  AudioEndEvent,
  TranscriptDeltaEvent,
  TranscriptDoneEvent,
  InterruptEvent,
  AvatarStateEvent,
  ConfigEvent,
  TriggerActionEvent,
  AttachmentData,
  ServerEventMessage
} from '../types/protocol';

const log = logger.scope('ProtocolClient');

// Define events that this client emits (kept for documentation)
type _ProtocolClientEvents = {
  'audio_start': (event: AudioStartEvent) => void;
  'sync_frame': (event: SyncFrameEvent) => void;
  'audio_end': (event: AudioEndEvent) => void;
  'transcript_delta': (event: TranscriptDeltaEvent) => void;
  'transcript_done': (event: TranscriptDoneEvent) => void;
  'interrupt': (event: InterruptEvent) => void;
  'avatar_state': (event: AvatarStateEvent) => void;
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'trigger_action': (event: TriggerActionEvent) => void;
};

/**
 * Avatar Chat Protocol Client (V1.3)
 * Implements the client-side logic for the Avatar Chat Server protocol.
 * Decouples protocol handling from UI and audio playback.
 */
export class AvatarProtocolClient extends EventEmitter {
  private socket: SocketService;

  // Global State (Spec 5.1)
  private currentTurnId: string | null = null;
  private currentSessionId: string | null = null;
  private isConnected = false;

  // Track finished/interrupted turns to filter stale deltas (Spec 5.4)
  private finalizedTurnIds: Set<string> = new Set();
  private currentAvatarState: string = 'Idle';
  private targetInputSampleRate: number = 24000; // Default for OpenAI, overridden by server config event

  // Optional user/session info
  private userId: string;

  /**
   * Create a new AvatarProtocolClient
   * @param socketService - Required SocketService instance for WebSocket communication.
   *                        This ensures a single shared connection is used.
   */
  constructor(socketService: SocketService) {
    super();
    this.socket = socketService;
    this.userId = `user_${Date.now()}`; // Default ID
    this.bindSocketEvents();
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    try {
      if (!this.socket.isConnected()) {
        await this.socket.connect();
        this.isConnected = true;
        this.emit('connected');
      }
    } catch (error) {
      log.error('Failed to connect:', error);
      this.isConnected = false;
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.socket.disconnect();
    this.isConnected = false;
    this.emit('disconnected');
  }

  /**
   * Bind to raw socket messages and process according to Spec
   */
  private bindSocketEvents() {
    // Pass-through connection events
    this.socket.on('connected', () => {
      this.isConnected = true;
      this.emit('connected');
    });

    this.socket.on('disconnected', () => {
      this.isConnected = false;
      this.disconnect();
    });

    this.socket.on('error', (err: Error) => this.emit('error', err));

    // Handle Protocol Events
    this.socket.on('config', (msg: ConfigEvent) => this.handleConfig(msg));
    this.socket.on('audio_start', (msg: AudioStartEvent) => this.handleAudioStart(msg));
    this.socket.on('sync_frame', (msg: SyncFrameEvent) => this.handleSyncFrame(msg));
    this.socket.on('audio_end', (msg: AudioEndEvent) => this.handleAudioEnd(msg));
    this.socket.on('transcript_delta', (msg: TranscriptDeltaEvent) => this.handleTranscriptDelta(msg));
    this.socket.on('transcript_done', (msg: TranscriptDoneEvent) => this.handleTranscriptDone(msg));
    this.socket.on('interrupt', (msg: InterruptEvent) => this.handleInterrupt(msg));
    this.socket.on('avatar_state', (msg: AvatarStateEvent) => this.emit('avatar_state', msg));
    this.socket.on('trigger_action', (msg: TriggerActionEvent) => this.emit('trigger_action', msg));
    this.socket.on('server_event', (msg: ServerEventMessage) => this.handleServerEvent(msg));
    this.socket.on('pong', (msg: { type: 'pong'; timestamp: number }) => log.debug('Pong received', msg));
  }

  /**
   * Handle generic server events and resolve correlation IDs
   */
  private handleServerEvent(msg: ServerEventMessage) {
    if (msg.reply_to_id) {
      const pending = this.pendingRequests.get(msg.reply_to_id);
      if (pending) {
        log.debug(`[ASYNC] Resolved request ${msg.reply_to_id}`);
        window.clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(msg.reply_to_id);
        pending.resolve(msg);
      }
    }
    this.emit('server_event', msg);
  }

  // ------------------------------------------------------------------
  // In-bound Event Handlers (Server -> Client)
  // ------------------------------------------------------------------

  /**
   * Handle configuration from server
   */
  private handleConfig(event: ConfigEvent) {
    log.info('Config received from server:', event);
    if (event.audio?.inputSampleRate) {
      this.targetInputSampleRate = event.audio.inputSampleRate;
      log.info(`Target input sample rate set to: ${this.targetInputSampleRate}Hz`);
    }
    // Propagate config to ChatManager so it can update audio output components
    this.emit('config', event);
  }

  /**
   * Spec 3.1: Audio Start
   * Signals beginning of new audio response turn.
   */
  private handleAudioStart(event: AudioStartEvent) {
    // Validate required fields
    if (!event.turnId || !event.sessionId) {
      log.warn('Invalid audio_start event:', event);
      return;
    }

    log.info(`Audio Start [Turn: ${event.turnId}]`);

    // Update State (Spec 5.2)
    this.currentTurnId = event.turnId;
    this.currentSessionId = event.sessionId;
    this.finalizedTurnIds.delete(event.turnId); // New turn is active

    // Propagate to UI/Audio layer
    this.emit('audio_start', event);
  }

  /**
   * Spec 3.2: Sync Frame
   * High frequency audio + blendshapes.
   */
  private handleSyncFrame(event: SyncFrameEvent) {
    if (event.type !== 'sync_frame') return;

    // Spec Verification: "Correlates to audio_start.turnId"
    // Note: Implicit session start logic might be needed if audio_start dropped,
    // but strictly following spec, we should track turnId.

    // Check for "Implicit Start" (Robustness)
    if (event.turnId && event.turnId !== this.currentTurnId) {
      log.info(`Implicit turn switch detected via sync_frame: ${event.turnId}`);
      this.currentTurnId = event.turnId;
      if (event.sessionId) this.currentSessionId = event.sessionId;
    }

    this.emit('sync_frame', event);
  }

  /**
   * Spec 3.3: Audio End
   * Signals generation finished.
   */
  private handleAudioEnd(event: AudioEndEvent) {
    // Spec 5.2: "Do NOT stop playback immediately! Just mark stream as closed."
    if (event.turnId === this.currentTurnId) {
      log.info(`Audio End [Turn: ${event.turnId}]`);
      this.emit('audio_end', event);
    } else {
      log.debug(`Received audio_end for stale turn: ${event.turnId}`);
    }
  }

  /**
   * Spec 3.4: Transcript Delta
   */
  private handleTranscriptDelta(event: TranscriptDeltaEvent) {
    // Spec 5.4: "Ignore Future Deltas" if interrupted/finalized
    if (this.finalizedTurnIds.has(event.turnId)) {
      log.debug(`Ignoring stale delta for finished turn: ${event.turnId}`);
      return;
    }

    // We pass it to the UI
    this.emit('transcript_delta', event);
  }

  /**
   * Spec 3.5: Transcript Done
   * Handles final text or interruption replacement.
   */
  private handleTranscriptDone(event: TranscriptDoneEvent) {
    // Mark as finalized
    if (event.turnId) {
      this.finalizedTurnIds.add(event.turnId);
    }
    this.emit('transcript_done', event);
  }

  /**
   * Spec 3.6: Interrupt (CRITICAL)
   * Sent when Server VAD detects user speech.
   */
  private handleInterrupt(event: InterruptEvent) {
    const { turnId, offsetMs } = event;

    // Spec 5.3 Step 1: Verification
    if (this.currentTurnId && turnId !== this.currentTurnId) {
      log.debug(`Ignoring interrupt for non-active turn. Active: ${this.currentTurnId}, Intr: ${turnId}`);
      return;
    }

    log.info(`Interrupt received [Turn: ${turnId}, Offset: ${offsetMs}ms]`);

    // Mark as finalized/interrupted to block future deltas
    this.finalizedTurnIds.add(turnId);

    // Propagate to Audio Controller (which knows playback position)
    this.emit('interrupt', event);
  }

  // ------------------------------------------------------------------
  // Out-bound Methods (Client -> Server)
  // ------------------------------------------------------------------

  public sendAudioStreamStart() {
    log.info('Sending audio_stream_start', { userId: this.userId, sampleRate: this.targetInputSampleRate });
    const msg = {
      type: 'audio_stream_start',
      userId: this.userId,
      sampleRate: this.targetInputSampleRate
    };
    this.socket.send(msg as OutgoingMessage);
  }

  public getTargetInputSampleRate(): number {
    return this.targetInputSampleRate;
  }

  public sendAudioStreamEnd() {
    log.info('Sending audio_stream_end');
    // Server only needs type (Spec 4.4)
    const msg = {
      type: 'audio_stream_end'
    };
    this.socket.send(msg as OutgoingMessage);
  }

  public sendAudioData(data: ArrayBuffer) {
    // Spec 4.2: Server expects ONLY {type: "audio", data: "<base64>"}
    // Convert ArrayBuffer to base64 here
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Data = btoa(binary);

    const msg = {
      type: 'audio',
      data: base64Data
    };
    this.socket.send(msg as OutgoingMessage);
  }

  public sendText(text: string) {
    log.info('Sending text message', { text });
    // Server expects only {type: "text", data: string} (Spec 4.3)
    const msg = {
      type: 'text',
      data: text
    };
    this.socket.send(msg as OutgoingMessage);
  }

  /**
   * Send a background client event to the server.
   * This data is NOT displayed in the chat UI.
   */
  public sendClientEvent(
    name: string,
    data?: Record<string, any>,
    directive: 'context' | 'speak' | 'trigger' = 'context',
    request_id?: string,
    attachments?: AttachmentData[]
  ) {
    log.info('Sending client event', { name, directive, request_id, has_attachments: !!attachments?.length });
    const msg = { type: 'client_event', name, data, directive, request_id, attachments };
    this.socket.send(msg as OutgoingMessage);
  }

  /**
   * Map to track pending asynchronous requests.
   * Key: request_id, Value: Promise controls + timeout ID.
   */
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timeoutId: number;
  }>();

  /**
   * Send a client event and await a response from the server (ServerEventMessage with matching reply_to_id).
   */
  public async sendEventAsync(
    name: string,
    data?: Record<string, any>,
    options?: {
      directive?: 'context' | 'speak' | 'trigger';
      timeoutMs?: number;
      attachments?: AttachmentData[];
    }
  ): Promise<any> {
    const request_id = `req_${Math.random().toString(36).substring(2, 11)}`;
    const timeoutMs = options?.timeoutMs || 10000;

    log.debug(`[ASYNC] Sending ${name} (request_id: ${request_id})`);

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (this.pendingRequests.has(request_id)) {
          this.pendingRequests.delete(request_id);
          reject(new Error(`Request timed out after ${timeoutMs}ms (event: ${name})`));
        }
      }, timeoutMs);

      this.pendingRequests.set(request_id, { resolve, reject, timeoutId });

      this.sendClientEvent(
        name,
        data,
        options?.directive || 'context',
        request_id,
        options?.attachments
      );
    });
  }

  public sendInterrupt() {
    log.info('Sending interrupt');
    // Server expects only {type: "interrupt"}
    const msg = {
      type: 'interrupt'
    };
    this.socket.send(msg as OutgoingMessage);
  }

  /**
   * Spec 4.5: Keepalive ping
   */
  public sendPing() {
    // Server expects only {type: "ping"}
    this.socket.send({
      type: 'ping'
    } as OutgoingMessage);
  }

  /**
   * Get current turn ID for external reference
   */
  public getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  /**
   * Get current session ID for external reference
   */
  public getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }
}
