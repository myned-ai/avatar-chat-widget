// Chat Manager - Orchestrates all services (Refactored)
// Uses extracted modules: SubtitleController, TranscriptManager, VoiceInputController

import { AvatarProtocolClient } from '../services/AvatarProtocolClient';
import { SocketService } from '../services/SocketService';
import type { 
  AudioStartEvent, 
  SyncFrameEvent, 
  AudioEndEvent,
  TranscriptDeltaEvent, 
  TranscriptDoneEvent, 
  InterruptEvent
} from '../types/protocol';
import { AudioInput } from '../services/AudioInput';
import { AudioOutput } from '../services/AudioOutput';
import { BlendshapeBuffer } from '../services/BlendshapeBuffer';
import { SyncPlayback, type SyncFrame } from '../services/SyncPlayback';
import { FeatureDetection } from '../utils/FeatureDetection';
import { errorBoundary } from '../utils/ErrorBoundary';
import { logger } from '../utils/Logger';
import type { Disposable } from '../types/common';
import type { IAvatarController } from '../types/avatar';
import type { OutgoingTextMessage } from '../types/messages';
import { CHAT_TIMING } from '../constants/chat';

// Extracted modules
import { SubtitleController } from './SubtitleController';
import { TranscriptManager } from './TranscriptManager';
import { VoiceInputController } from './VoiceInputController';

const log = logger.scope('ChatManager');

/**
 * Options for ChatManager when used with Shadow DOM (widget mode)
 */
export interface ChatManagerOptions {
  /** Shadow root for element queries (null = use document) */
  shadowRoot?: ShadowRoot | null;
  /** Pre-selected DOM elements (for Shadow DOM usage) */
  chatMessages?: HTMLElement;
  chatInput?: HTMLInputElement;
  micBtn?: HTMLButtonElement;
  /** Callbacks */
  onConnectionChange?: (connected: boolean) => void;
  onMessage?: (msg: { role: 'user' | 'assistant'; text: string }) => void;
  onError?: (error: Error) => void;
  /** Called on each transcript delta for subtitles */
  onSubtitleUpdate?: (text: string, role: 'user' | 'assistant') => void;
}

export class ChatManager implements Disposable {
  // Core services
  private protocolClient: AvatarProtocolClient;
  private socketService: SocketService;
  private audioInput: AudioInput;
  private audioOutput: AudioOutput;
  private blendshapeBuffer: BlendshapeBuffer;
  private syncPlayback: SyncPlayback;
  private avatar: IAvatarController;
  
  // Extracted modules
  private subtitleController: SubtitleController;
  private transcriptManager: TranscriptManager;
  private voiceController: VoiceInputController;

  // Session state
  private currentSessionId: string | null = null;
  private currentTurnId: string | null = null;
  private turnStartTime: number = 0;
  private userId: string;

  // UI Elements
  private chatMessages: HTMLElement;
  private chatInput: HTMLInputElement;
  private micBtn: HTMLButtonElement;
  private typingIndicator: HTMLElement | null = null;
  private typingStartTime: number = 0;

  // Animation state
  private animationFrameId: number | null = null;
  private autoScrollObserver: MutationObserver | null = null;
  private useSyncPlayback = false;

  // Transcript Queue for synced display (words are queued with startOffset, displayed when audio reaches that time)
  private transcriptQueue: Array<{
    text: string;
    startOffset: number;
    itemId?: string;
    previousItemId?: string;
    role: 'user' | 'assistant';
  }> = [];

  // Event listener references for cleanup (prevents memory leaks in SPAs)
  private keypressHandler: ((e: KeyboardEvent) => void) | null = null;
  private micClickHandler: (() => void) | null = null;

  // Options & Callbacks
  private options: ChatManagerOptions;

  constructor(avatar: IAvatarController, options: ChatManagerOptions = {}) {
    this.avatar = avatar;
    this.options = options;
    this.userId = this.generateUserId();
    
    // Initialize core services
    this.socketService = new SocketService();
    this.protocolClient = new AvatarProtocolClient(this.socketService);
    this.audioInput = new AudioInput();
    this.audioOutput = new AudioOutput();
    this.blendshapeBuffer = new BlendshapeBuffer();
    this.syncPlayback = new SyncPlayback();
    
    // Get UI elements with proper null checks
    const root = options.shadowRoot || document;
    
    const chatMessagesEl = options.chatMessages || root.getElementById('chatMessages');
    const chatInputEl = options.chatInput || root.getElementById('chatInput');
    const micBtnEl = options.micBtn || root.getElementById('micBtn');
    
    if (!chatMessagesEl) {
      throw new Error('ChatManager: chatMessages element not found');
    }
    if (!chatInputEl) {
      throw new Error('ChatManager: chatInput element not found');
    }
    if (!micBtnEl) {
      throw new Error('ChatManager: micBtn element not found');
    }
    
    this.chatMessages = chatMessagesEl;
    this.chatInput = chatInputEl as HTMLInputElement;
    this.micBtn = micBtnEl as HTMLButtonElement;
    this.typingIndicator = root.getElementById('typingIndicator') as HTMLElement | null;

    // Initialize extracted modules
    this.subtitleController = new SubtitleController({
      onSubtitleUpdate: options.onSubtitleUpdate
    });

    this.transcriptManager = new TranscriptManager({
      chatMessages: this.chatMessages,
      onMessage: options.onMessage,
      onScrollToBottom: () => this.scrollToBottom()
    });

    this.voiceController = new VoiceInputController({
      audioInput: this.audioInput,
      protocolClient: this.protocolClient,
      micBtn: this.micBtn,
      onRecordingStart: () => this.avatar.setChatState('Hello'),
      onError: options.onError
    });

    // Setup callbacks
    this.setupSyncPlaybackCallbacks();
    this.setupAutoScroll();
    this.setupEventListeners();
    this.setupProtocolHandlers();
    this.startBlendshapeSync();
  }

  // ============================================================================
  // Public API
  // ============================================================================

  async initialize(): Promise<void> {
    FeatureDetection.logCapabilities();
    
    try {
      await this.protocolClient.connect();
      log.info('WebSocket connected');
      this.avatar.setChatState('Idle');
      await this.audioInput.requestPermission();
    } catch (error) {
      errorBoundary.handleError(error as Error, 'chat-manager');
      log.error('Connection failed');
      this.options.onError?.(error as Error);
    }
  }

  sendText(text: string): void {
    if (!text.trim()) return;
    
    this.options.onSubtitleUpdate?.(text, 'user');
    this.transcriptManager.addMessage(text, 'user');

    const message: OutgoingTextMessage = {
      type: 'text',
      data: text,
      userId: this.userId,
      timestamp: Date.now(),
    };
    this.socketService.send(message);
  }

  async reconnect(): Promise<void> {
    return this.protocolClient.connect();
  }

  async reconnectOnExpand(): Promise<void> {
    if (!this.socketService.isConnected()) {
      await this.protocolClient.connect();
      log.info('Reconnected on expand');
    }
    this.avatar.setChatState('Idle');
    this.startBlendshapeSync();
  }

  resetOnMinimize(): void {
    this.stopAllPlayback();
    
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Disconnect websocket to save resources/bandwidth when minimized
    this.protocolClient.disconnect();
    log.info('Disconnected on minimize');
    
    this.avatar.disableLiveBlendshapes();
    this.avatar.setChatState('Idle');
    this.subtitleController.clear();
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.autoScrollObserver) {
      this.autoScrollObserver.disconnect();
      this.autoScrollObserver = null;
    }

    // Clean up DOM event listeners to prevent memory leaks
    if (this.keypressHandler && this.chatInput) {
      this.chatInput.removeEventListener('keypress', this.keypressHandler);
      this.keypressHandler = null;
    }
    if (this.micClickHandler && this.micBtn) {
      this.micBtn.removeEventListener('click', this.micClickHandler);
      this.micClickHandler = null;
    }

    // Dispose extracted modules
    this.subtitleController.dispose();
    this.transcriptManager.dispose();
    this.voiceController.dispose();

    // Dispose services
    this.protocolClient.disconnect();
    this.audioInput.dispose();
    this.audioOutput.dispose();
    this.blendshapeBuffer.dispose();
    this.syncPlayback.dispose();
  }

  // ============================================================================
  // Setup Methods
  // ============================================================================

  private setupSyncPlaybackCallbacks(): void {
    this.syncPlayback.setBlendshapeCallback((weights) => {
      this.avatar.updateBlendshapes(weights);
    });

    this.syncPlayback.setPlaybackEndCallback(() => {
      log.info('SyncPlayback ended - transitioning to Idle');
      
      // Flush any remaining queued transcript items
      while (this.transcriptQueue.length > 0) {
        const item = this.transcriptQueue.shift();
        if (item?.role === 'assistant') {
          this.transcriptManager.appendToAssistantTurn(item.text);
        }
      }
      
      this.avatar.setChatState('Idle');
      this.avatar.disableLiveBlendshapes();
      this.useSyncPlayback = false;
      this.subtitleController.showRemaining();
      this.transcriptManager.finalizeAssistantTurn();
    });
  }

  private setupAutoScroll(): void {
    this.autoScrollObserver = new MutationObserver(() => {
      if (this.chatMessages) {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      }
    });
    
    this.autoScrollObserver.observe(this.chatMessages, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  private setupEventListeners(): void {
    // Store references for cleanup
    this.keypressHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') this.sendTextMessage();
    };
    this.micClickHandler = () => {
      this.voiceController.toggle();
    };

    this.chatInput.addEventListener('keypress', this.keypressHandler);
    this.micBtn.addEventListener('click', this.micClickHandler);
    
    // Standalone mode handlers
    if (!this.options.shadowRoot) {
      const root = document;
      root.querySelector('.chat-header')?.addEventListener('click', () => this.toggleChat());
      root.getElementById('minimizeBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleChat();
      });
      root.getElementById('chatBubble')?.addEventListener('click', () => this.openChat());
    }
  }

  private setupProtocolHandlers(): void {
    this.protocolClient.on('connected', () => {
      log.debug('Protocol Client connected');
      this.options.onConnectionChange?.(true);
    });

    this.protocolClient.on('disconnected', () => {
      log.info('Protocol Client disconnected');
      this.options.onConnectionChange?.(false);
    });

    this.protocolClient.on('avatar_state', (event: { state: string }) => {
      const stateMap: Record<string, 'Idle' | 'Hello' | 'Responding'> = {
        'Idle': 'Idle',
        'Listening': 'Hello',
        'Processing': 'Hello',
        'Thinking': 'Hello',
        'Responding': 'Responding',
      };
      this.avatar.setChatState(stateMap[event.state] || 'Idle');
    });

    this.protocolClient.on('audio_start', (event: AudioStartEvent) => {
      this.handleAudioStart(event);
    });

    this.protocolClient.on('sync_frame', (event: SyncFrameEvent) => {
      this.handleSyncFrame(event);
    });

    this.protocolClient.on('audio_end', (event: AudioEndEvent) => {
      this.handleAudioEnd(event);
    });

    this.protocolClient.on('transcript_delta', (event: TranscriptDeltaEvent) => {
      this.handleTranscriptDelta(event);
    });

    this.protocolClient.on('transcript_done', (event: TranscriptDoneEvent) => {
      this.handleTranscriptDone(event);
    });

    this.protocolClient.on('interrupt', (event: InterruptEvent) => {
      this.handleInterrupt(event);
    });

    this.protocolClient.on('error', (err) => log.error('Protocol Error:', err));
  }

  // ============================================================================
  // Protocol Handlers
  // ============================================================================

  private handleAudioStart(event: AudioStartEvent): void {
    this.setTyping(false);
    log.info('Audio start received:', event.turnId);
    
    this.currentTurnId = event.turnId;
    this.currentSessionId = event.sessionId;
    this.turnStartTime = Date.now();
    
    // Reset transcript queue and subtitle state for new turn
    this.transcriptQueue = [];
    this.subtitleController.reset();
    
    this.syncPlayback.startSession(event.sessionId, event.sampleRate);
    this.audioOutput.startSession(event.sessionId, event.sampleRate);
    this.blendshapeBuffer.startSession(event.sessionId);
    
    this.useSyncPlayback = false;
    this.avatar.enableLiveBlendshapes();
    this.avatar.setChatState('Responding');
  }

  private handleSyncFrame(event: SyncFrameEvent): void {
    if (event.sessionId && event.sessionId !== this.currentSessionId) {
      log.warn('Implicit session start via sync_frame');
      this.currentSessionId = event.sessionId;
      this.syncPlayback.startSession(event.sessionId);
      this.avatar.enableLiveBlendshapes();
      this.avatar.setChatState('Responding');
      this.setTyping(false);
    }

    this.useSyncPlayback = true;
    
    const audioData = this.decodeBase64ToArrayBuffer(event.audio);
    const weights = Array.isArray(event.weights) ? {} : event.weights;

    const frame: SyncFrame = {
      audio: audioData,
      weights,
      timestamp: event.timestamp,
      frameIndex: event.frameIndex,
      sessionId: event.sessionId
    };
    
    this.syncPlayback.addSyncFrame(frame);
  }

  private handleAudioEnd(event: AudioEndEvent): void {
    log.info('Audio end received - marking stream complete');
    
    if (this.useSyncPlayback) {
      this.syncPlayback.endSession(event.sessionId);
    } else {
      this.audioOutput.endSession(event.sessionId);
      this.blendshapeBuffer.endSession(event.sessionId);
    }
  }

  private handleTranscriptDelta(event: TranscriptDeltaEvent): void {
    const { role, text, itemId, previousItemId, startOffset } = event;
    
    if (role === 'assistant') {
      // Add word to subtitle controller (for chunk-based display)
      this.subtitleController.addWord(text);
      
      if (typeof startOffset === 'number') {
        // Queue for synced display with audio playback time
        // User messages with 0 offset show immediately
        if (startOffset <= 0) {
          this.transcriptManager.appendToAssistantTurn(text);
          this.subtitleController.markWordSpoken();
        } else {
          this.transcriptQueue.push({ text, role, itemId, previousItemId, startOffset });
        }
      } else {
        // No startOffset - display immediately (fallback for legacy)
        this.transcriptManager.appendToAssistantTurn(text);
        this.subtitleController.markWordSpoken();
      }
    } else if (role === 'user') {
      // User messages with startOffset 0 or no offset show immediately
      if (typeof startOffset === 'number' && startOffset > 0) {
        this.transcriptQueue.push({ text, role, itemId, previousItemId, startOffset });
      } else {
        this.transcriptManager.streamText(text, role, itemId, previousItemId);
      }
    }
  }

  private handleTranscriptDone(event: TranscriptDoneEvent): void {
    log.debug(`Transcript done [${event.role}]: ${event.text}`);
    
    if (event.role === 'assistant') {
      if (event.interrupted) {
        this.transcriptManager.replaceAssistantTurnText(event.text);
      }
      // Don't finalize if queue still has items - let playbackEnd handle it
      // This prevents creating new bubbles when dequeued words arrive after transcript_done
      if (this.transcriptQueue.length === 0) {
        this.transcriptManager.finalizeAssistantTurn();
        this.subtitleController.clear();
      }
      // If queue has items, finalization happens in setPlaybackEndCallback
    } else {
      if (!this.transcriptManager.hasActiveAssistantTurn()) {
        this.transcriptManager.addMessage(event.text, event.role);
      } else {
        this.transcriptManager.finalizeMessage(event.itemId, event.role, event.interrupted);
      }
    }
  }

  private handleInterrupt(event: InterruptEvent): void {
    if (this.currentTurnId !== event.turnId) {
      log.debug(`Ignoring interrupt for non-active turn`);
      return;
    }
    
    const playbackState = this.syncPlayback.getState();
    const msPlayed = playbackState.audioPlaybackTime * 1000;
    
    if (msPlayed >= event.offsetMs) {
      log.info(`Interruption: Immediate Stop`);
      this.stopAllPlayback();
    } else {
      const remainingMs = event.offsetMs - msPlayed;
      log.info(`Interruption: Scheduled Stop in ${remainingMs.toFixed(0)}ms`);
      setTimeout(() => this.stopAllPlayback(), remainingMs);
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private sendTextMessage(): void {
    const text = this.chatInput.value.trim();
    if (!text) return;

    this.chatInput.value = '';
    this.avatar.setChatState('Hello');
    this.transcriptManager.addMessage(text, 'user');
    this.protocolClient.sendText(text);
    this.setTyping(true);
  }

  private stopAllPlayback(): void {
    this.syncPlayback.stop();
    this.audioOutput.stop();
    this.blendshapeBuffer.clear();
    
    this.transcriptManager.finalizeAssistantTurn();
    this.subtitleController.clear();
    
    this.currentTurnId = null;
    this.avatar.disableLiveBlendshapes();
    this.avatar.setChatState('Hello');
  }

  private startBlendshapeSync(): void {
    const sync = () => {
      // Process any queued transcript items (sync text with audio playback time)
      this.processTranscriptQueue();
      
      if (!this.useSyncPlayback) {
        const result = this.blendshapeBuffer.getFrame();
        this.avatar.updateBlendshapes(result.weights);
        
        if (result.status === 'SPEAKING' && this.avatar.getChatState() !== 'Responding') {
          this.avatar.setChatState('Responding');
        } else if (result.status === 'LISTENING' && result.endOfSpeech) {
          this.avatar.setChatState('Hello');
        }
      }
      this.animationFrameId = requestAnimationFrame(sync);
    };
    sync();
  }

  /**
   * Process queued transcript items based on audio playback time.
   * Words are displayed when the audio playback reaches their startOffset timestamp.
   * This keeps transcript text in sync with spoken audio.
   */
  private processTranscriptQueue(): void {
    if (this.transcriptQueue.length === 0) return;

    const playbackState = this.syncPlayback.getState();
    const playbackTimeMs = playbackState.audioPlaybackTime * 1000;
    const DISPLAY_LEAD_MS = 100; // Allow text to appear slightly before audio

    // Process items that are due based on playback time
    while (this.transcriptQueue.length > 0) {
      const item = this.transcriptQueue[0];

      // Item is due if its offset is before or near current playback time
      const isDue = item.startOffset <= playbackTimeMs + DISPLAY_LEAD_MS;

      if (isDue) {
        this.transcriptQueue.shift(); // Remove from queue

        // Render it
        if (item.role === 'assistant') {
          this.transcriptManager.appendToAssistantTurn(item.text);
          this.subtitleController.markWordSpoken(); // Advance subtitle chunking
        } else {
          // Fallback for user messages (should usually have 0 offset)
          this.transcriptManager.streamText(item.text, item.role, item.itemId, item.previousItemId);
        }
      } else {
        // Queue is ordered by time, so we can stop checking
        break;
      }
    }
  }

  private setTyping(typing: boolean): void {
    if (!this.typingIndicator) return;
    
    if (typing) {
      this.typingStartTime = Date.now();
      this.typingIndicator.classList.add('visible');
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    } else {
      const elapsed = Date.now() - this.typingStartTime;
      const remaining = CHAT_TIMING.MIN_TYPING_DISPLAY_MS - elapsed;
      
      if (remaining > 0) {
        setTimeout(() => this.typingIndicator?.classList.remove('visible'), remaining);
      } else {
        this.typingIndicator.classList.remove('visible');
      }
    }
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    });
  }

  private toggleChat(): void {
    const root = this.options.shadowRoot || document;
    const chatContainer = root.querySelector('.chat-container') as HTMLElement;
    const chatBubble = root.getElementById?.('chatBubble');
    
    if (chatContainer?.classList.contains('collapsed')) {
      chatContainer.classList.remove('collapsed');
      if (chatBubble) chatBubble.style.display = 'none';
    } else {
      chatContainer?.classList.add('collapsed');
      if (chatBubble) chatBubble.style.display = 'flex';
    }
  }

  private openChat(): void {
    const root = this.options.shadowRoot || document;
    const chatContainer = root.querySelector('.chat-container') as HTMLElement;
    const chatBubble = root.getElementById?.('chatBubble');
    
    chatContainer?.classList.remove('collapsed');
    if (chatBubble) chatBubble.style.display = 'none';
  }

  private generateUserId(): string {
    const stored = localStorage.getItem('avatar-chat-user-id');
    if (stored) return stored;
    
    const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('avatar-chat-user-id', id);
    return id;
  }

  private decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
