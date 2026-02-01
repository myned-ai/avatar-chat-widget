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
  AvatarStateEvent
} from '../types/protocol';

const log = logger.scope('ProtocolClient');

// Define events that this client emits
type ProtocolClientEvents = {
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
  
  // Optional user/session info
  private userId: string;

  constructor(socketService?: SocketService) {
    super();
    this.socket = socketService || new SocketService();
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
    this.socket.on('audio_start', (msg: any) => this.handleAudioStart(msg as AudioStartEvent));
    this.socket.on('sync_frame', (msg: any) => this.handleSyncFrame(msg as SyncFrameEvent));
    this.socket.on('audio_end', (msg: any) => this.handleAudioEnd(msg as AudioEndEvent));
    this.socket.on('transcript_delta', (msg: any) => this.handleTranscriptDelta(msg as TranscriptDeltaEvent));
    this.socket.on('transcript_done', (msg: any) => this.handleTranscriptDone(msg as TranscriptDoneEvent));
    this.socket.on('interrupt', (msg: any) => this.handleInterrupt(msg as InterruptEvent));
    this.socket.on('avatar_state', (msg: any) => this.emit('avatar_state', msg as AvatarStateEvent));
    this.socket.on('pong', (msg: any) => log.debug('Pong received', msg));
  }

  // ------------------------------------------------------------------
  // In-bound Event Handlers (Server -> Client)
  // ------------------------------------------------------------------

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
    log.info('Sending audio_stream_start', { userId: this.userId });
    // Server only needs type and userId (Spec 4.1)
    const msg = {
      type: 'audio_stream_start',
      userId: this.userId
    };
    this.socket.send(msg as OutgoingMessage);
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
