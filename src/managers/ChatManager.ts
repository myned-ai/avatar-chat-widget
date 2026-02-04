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
  private audioStartReceived: boolean = false;
  private syncFramesBeforeStart: number = 0;
  private wasInterrupted: boolean = false;
  private interruptCutoffMs: number | null = null; // Cutoff offset when interrupted
  private scheduledStopTimeout: number | null = null; // Timeout for delayed stopAllPlayback after interrupt
  
  // Track rendered user messages to prevent duplicates from transcript_done echoes
  private renderedUserMessageIds: Set<string> = new Set();
  // Track the last user turn ID for deduplication
  private lastUserTurnId: string | null = null;
  // Track if user sent a text message (to avoid duplicate rendering from server echo)
  private pendingUserTextMessage: boolean = false;

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
  
  // Track displayed words with their offsets for interrupt truncation
  private displayedWords: Array<{ text: string; offset: number }> = [];
  
  // Counter for words that have been displayed but not yet marked as spoken in subtitles
  private wordsSpokenCount: number = 0;
  
  // Base offset for the current turn (first startOffset received, used to normalize offsets per turn)
  private turnBaseOffset: number | null = null;
  
  // Buffer for transcript_delta events that arrive before audio_start
  // These are processed once audio_start is received to prevent orphaned bubbles
  private earlyTranscriptBuffer: TranscriptDeltaEvent[] = [];

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
      // Don't request mic permission eagerly - wait for user to click mic button
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
      
      // Only flush remaining transcript if NOT interrupted
      // On interrupt, we want to show only what was actually spoken
      if (!this.wasInterrupted) {
        while (this.transcriptQueue.length > 0) {
          const item = this.transcriptQueue.shift();
          if (item?.role === 'assistant') {
            this.transcriptManager.appendToAssistantTurn(item.text);
          }
        }
      } else {
        // Clear the queue without displaying
        this.transcriptQueue = [];
      }
      
      this.avatar.setChatState('Idle');
      this.avatar.disableLiveBlendshapes();
      this.useSyncPlayback = false;
      this.subtitleController.showRemaining();
      this.transcriptManager.finalizeAssistantTurn();
      
      // Clear subtitles after a brief delay so user can read the final text
      setTimeout(() => {
        this.subtitleController.clear();
      }, 1500);
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
    
    // Check if sync_frames arrived before audio_start
    if (this.syncFramesBeforeStart > 0) {
      log.warn(`⚠️ Received ${this.syncFramesBeforeStart} sync_frames BEFORE audio_start!`);
    }
    
    this.currentTurnId = event.turnId;
    this.currentSessionId = event.sessionId;
    this.turnStartTime = Date.now();
    this.audioStartReceived = true;
    this.syncFramesBeforeStart = 0;
    this.wasInterrupted = false;
    this.interruptCutoffMs = null; // Reset interrupt cutoff for new turn
    
    // Cancel any pending scheduled stopAllPlayback from previous interrupted turn
    if (this.scheduledStopTimeout !== null) {
      clearTimeout(this.scheduledStopTimeout);
      this.scheduledStopTimeout = null;
      log.debug('Cancelled pending scheduled stopAllPlayback from previous turn');
    }
    
    log.info(`📢 TURN START [assistant] turnId=${event.turnId} sessionId=${event.sessionId}`);
    
    // Reset transcript queue, subtitle, and transcript state for new assistant turn
    log.debug(`[AUDIO] Resetting queue (had ${this.transcriptQueue.length} items)`);
    this.transcriptQueue = [];
    this.displayedWords = []; // Reset displayed words tracking for new turn
    this.wordsSpokenCount = 0;
    this.turnBaseOffset = null; // Reset base offset for new turn
    log.debug('[AUDIO] Calling subtitleController.reset()');
    this.subtitleController.reset();
    log.debug('[AUDIO] Calling transcriptManager.clear()');
    this.transcriptManager.clear(); // Ensures transcript buffer is fully reset for new turn
    
    this.syncPlayback.startSession(event.sessionId, event.sampleRate);
    this.audioOutput.startSession(event.sessionId, event.sampleRate);
    this.blendshapeBuffer.startSession(event.sessionId);
    
    this.useSyncPlayback = false;
    this.avatar.enableLiveBlendshapes();
    this.avatar.setChatState('Responding');
    
    // Process any transcript_deltas that arrived before audio_start
    if (this.earlyTranscriptBuffer.length > 0) {
      log.debug(`[AUDIO] Processing ${this.earlyTranscriptBuffer.length} buffered early transcript_deltas`);
      for (const event of this.earlyTranscriptBuffer) {
        this.handleTranscriptDelta(event);
      }
      this.earlyTranscriptBuffer = [];
    }
  }

  private handleSyncFrame(event: SyncFrameEvent): void {
    // Check if sync_frame arrived before audio_start (only log first occurrence)
    if (!this.audioStartReceived) {
      this.syncFramesBeforeStart++;
      if (this.syncFramesBeforeStart === 1) {
        log.warn(`⚠️ sync_frame received BEFORE audio_start!`);
      }
    }
    
    // Handle session ID mismatch (server may use different ID sources for audio_start vs sync_frame)
    if (event.sessionId && event.sessionId !== this.currentSessionId) {
      if (this.currentSessionId) {
        // Log mismatch but adapt to the sync_frame's session ID (it's what the audio uses)
        log.debug(`Session ID mismatch: audio_start=${this.currentSessionId}, sync_frame=${event.sessionId} - adapting to sync_frame`);
      }
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
    
    // Reset for next turn
    this.audioStartReceived = false;
    
    if (this.useSyncPlayback) {
      this.syncPlayback.endSession(event.sessionId);
    } else {
      this.audioOutput.endSession(event.sessionId);
      this.blendshapeBuffer.endSession(event.sessionId);
    }
  }

  private handleTranscriptDelta(event: TranscriptDeltaEvent): void {
    const { role, text, itemId, previousItemId, startOffset, turnId } = event;
    
    // Ignore transcript deltas from stale turns
    if (turnId && this.currentTurnId && turnId !== this.currentTurnId) {
      log.debug(`Ignoring stale transcript_delta for turn ${turnId} (current: ${this.currentTurnId})`);
      return;
    }
    
    // Buffer assistant transcript_deltas that arrive BEFORE audio_start
    // This prevents orphaned bubbles when clear() is called on audio_start
    if (role === 'assistant' && !this.audioStartReceived) {
      log.debug(`[TRANSCRIPT] Buffering early delta (before audio_start): "${text}"`);
      this.earlyTranscriptBuffer.push(event);
      return;
    }
    
    log.debug(`[TRANSCRIPT] Delta received: role=${role}, text="${text}", startOffset=${startOffset}ms`);
    
    if (role === 'assistant') {
      // Add word to subtitle controller (for chunk-based display)
      this.subtitleController.addWord(text);
      
      if (typeof startOffset === 'number') {
        // Normalize offset relative to turn start (server sends cumulative offsets)
        // First word of the turn sets the base offset; all subsequent offsets are relative to it
        if (this.turnBaseOffset === null) {
          this.turnBaseOffset = startOffset;
          log.debug(`[TRANSCRIPT] Set turnBaseOffset=${this.turnBaseOffset}ms`);
        }
        const normalizedOffset = startOffset - this.turnBaseOffset;
        log.debug(`[TRANSCRIPT] Normalized offset: ${startOffset}ms - ${this.turnBaseOffset}ms = ${normalizedOffset}ms`);
        
        // Queue for synced display with audio playback time
        // Words with 0 or negative offset show immediately
        if (normalizedOffset <= 0) {
          this.transcriptManager.appendToAssistantTurn(text);
          this.displayedWords.push({ text, offset: normalizedOffset });
          this.subtitleController.markWordSpoken();
        } else {
          this.transcriptQueue.push({ text, role, itemId, previousItemId, startOffset: normalizedOffset });
        }
      } else {
        // No startOffset - display immediately (fallback for legacy, use 0 as offset)
        this.transcriptManager.appendToAssistantTurn(text);
        this.displayedWords.push({ text, offset: 0 });
        this.subtitleController.markWordSpoken();
      }
    } else if (role === 'user') {
      // User messages with startOffset 0 or no offset show immediately
      if (typeof startOffset === 'number' && startOffset > 0) {
        // Normalize user offsets as well
        const normalizedOffset = this.turnBaseOffset !== null ? startOffset - this.turnBaseOffset : startOffset;
        this.transcriptQueue.push({ text, role, itemId, previousItemId, startOffset: normalizedOffset });
      } else {
        this.transcriptManager.streamText(text, role, itemId, previousItemId);
      }
    }
  }

  private handleTranscriptDone(event: TranscriptDoneEvent): void {
    log.debug(`Transcript done [${event.role}]: ${event.text} turnId=${event.turnId}`);
    
    if (event.role === 'assistant') {
      // Ignore transcript_done from stale turns (e.g., from previous interrupted turn)
      if (event.turnId && this.currentTurnId && event.turnId !== this.currentTurnId) {
        log.debug(`Ignoring stale transcript_done for turn ${event.turnId} (current: ${this.currentTurnId})`);
        return;
      }
      
      // If this turn was interrupted, the bubble was already finalized with spoken text only
      if (this.wasInterrupted) {
        log.debug(`Ignoring transcript_done for interrupted turn`);
        return;
      }
      
      if (event.interrupted) {
        // Server sent truncated text for interrupted turn
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
      // User messages handling:
      // - If user TYPED a message, we already rendered it in sendTextMessage(), skip the echo
      // - If user SPOKE (voice input), we need to render the server's transcript
      if (this.pendingUserTextMessage) {
        log.debug(`Ignoring user transcript_done echo (text was rendered locally)`);
        this.pendingUserTextMessage = false; // Reset for next message
      } else {
        // Voice input - render the transcribed user speech
        // Insert BEFORE assistant bubble since voice chronologically occurred before assistant started
        log.info(`📤 TURN [user] | Voice transcript: "${event.text}"`);
        this.transcriptManager.addMessage(event.text, 'user', true);
      }
    }
  }

  private handleInterrupt(event: InterruptEvent): void {
    // Ignore interrupts with null turnId or for non-active turns
    if (!event.turnId || this.currentTurnId !== event.turnId) {
      log.debug(`Ignoring interrupt: turnId=${event.turnId} (current: ${this.currentTurnId})`);
      return;
    }
    
    const playbackState = this.syncPlayback.getState();
    const msPlayed = playbackState.audioPlaybackTime * 1000;
    const turnDurationMs = Date.now() - this.turnStartTime;
    const cutoffMs = event.offsetMs;
    
    log.info(`⛔ INTERRUPT turnId=${event.turnId} | cutoffOffset=${cutoffMs}ms | audioPlayed=${msPlayed.toFixed(0)}ms | turnDuration=${turnDurationMs}ms`);
    
    // Set interrupt flag and cutoff IMMEDIATELY to stop queue processing beyond this point
    this.wasInterrupted = true;
    this.interruptCutoffMs = cutoffMs;
    
    if (msPlayed >= cutoffMs) {
      log.info(`  → Immediate stop (already past cutoff)`);
      this.stopAllPlayback();
    } else {
      const remainingMs = cutoffMs - msPlayed;
      log.info(`  → Scheduled stop in ${remainingMs.toFixed(0)}ms`);
      // Track the timeout so it can be cancelled if a new turn starts
      this.scheduledStopTimeout = window.setTimeout(() => {
        this.scheduledStopTimeout = null;
        this.stopAllPlayback();
      }, remainingMs);
    }
  }
  
  /**
   * Truncate the assistant transcript to only include words spoken before the cutoff offset.
   * 
   * Note: startOffset is when a word STARTS being spoken. We add a tolerance buffer
   * to include words that started slightly before the cutoff, since they were likely
   * fully or mostly spoken before the user interrupted.
   */
  private truncateTranscriptAtOffset(cutoffMs: number): void {
    // Add tolerance for word duration - a word that starts 300ms before cutoff was likely spoken
    // This accounts for average word duration in speech (~200-400ms per word)
    const WORD_DURATION_TOLERANCE_MS = 300;
    const effectiveCutoff = cutoffMs + WORD_DURATION_TOLERANCE_MS;
    
    // Filter displayed words to only those that started before the effective cutoff
    const spokenWords = this.displayedWords.filter(w => w.offset < effectiveCutoff);
    
    log.info(`  → Truncating transcript: ${this.displayedWords.length} words → ${spokenWords.length} words (cutoff: ${cutoffMs}ms + ${WORD_DURATION_TOLERANCE_MS}ms tolerance)`);
    
    if (spokenWords.length === 0) {
      // Nothing was spoken - clear the assistant bubble entirely
      this.transcriptManager.replaceAssistantTurnText('');
    } else if (spokenWords.length < this.displayedWords.length) {
      // Some words were cut off - rebuild the text from spoken words only
      const truncatedText = spokenWords.map(w => w.text).join(' ');
      this.transcriptManager.replaceAssistantTurnText(truncatedText);
    }
    // If all words were spoken, leave the text as-is
    
    // Update displayedWords to only contain spoken words
    this.displayedWords = spokenWords;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private sendTextMessage(): void {
    const text = this.chatInput.value.trim();
    if (!text) return;

    // Mark that we rendered a user text message locally (to skip server echo)
    this.pendingUserTextMessage = true;
    
    log.info(`📤 TURN START [user] | Text: "${text}"`);
    
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
    
    // Clear pending transcript items - they weren't spoken
    this.transcriptQueue = [];
    
    // Clear early transcript buffer - prevents stale deltas from being processed
    this.earlyTranscriptBuffer = [];
    
    // Truncate transcript to only show words that were actually spoken before interrupt
    if (this.interruptCutoffMs !== null) {
      this.truncateTranscriptAtOffset(this.interruptCutoffMs);
    }
    
    this.transcriptManager.finalizeAssistantTurn();
    this.subtitleController.clear();
    
    this.currentTurnId = null;
    this.audioStartReceived = false;
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
    
    // If interrupted, don't process any more words beyond the cutoff
    if (this.wasInterrupted && this.interruptCutoffMs !== null) {
      // Clear queue items beyond cutoff - they won't be spoken
      this.transcriptQueue = this.transcriptQueue.filter(item => item.startOffset < this.interruptCutoffMs!);
      if (this.transcriptQueue.length === 0) return;
    }

    const playbackState = this.syncPlayback.getState();
    
    // DEBUG: Log playback state periodically (every 500ms worth of change)
    const playbackTimeMs = playbackState.audioPlaybackTime * 1000;
    
    // SUBTITLE TIMING: No lead - exact sync with audio timestamps
    // The server provides accurate startOffset values, display at exact time
    const adjustedPlaybackTimeMs = playbackTimeMs;
    
    // CRITICAL: Don't process until playback has actually started
    // This prevents the buffer flush bug where all words would appear at once
    if (!playbackState.isPlaying) {
      // DEBUG: Log why we're not processing
      if (this.transcriptQueue.length > 0 && Math.random() < 0.01) { // Log occasionally
        log.debug(`[QUEUE] Waiting for playback to start. Queue size: ${this.transcriptQueue.length}, isPlaying: ${playbackState.isPlaying}`);
      }
      return;
    }
    
    // DEBUG: Log queue processing
    const nextItem = this.transcriptQueue[0];
    if (nextItem) {
      log.debug(`[QUEUE] Processing: playbackTime=${playbackTimeMs.toFixed(0)}ms, nextWord="${nextItem.text}" @ ${nextItem.startOffset}ms, queueSize=${this.transcriptQueue.length}`);
    }

    // Process items that are due for DISPLAY (exact sync with audio)
    let processedCount = 0;
    while (this.transcriptQueue.length > 0) {
      const item = this.transcriptQueue[0];
      const isDue = item.startOffset <= adjustedPlaybackTimeMs;

      if (isDue) {
        this.transcriptQueue.shift();
        processedCount++;
        
        // DEBUG: Log each word as it's dequeued with timing info
        log.debug(`[QUEUE] Dequeuing "${item.text}" - offset=${item.startOffset}ms, playback=${playbackTimeMs.toFixed(0)}ms, delta=${(playbackTimeMs - item.startOffset).toFixed(0)}ms`);

        if (item.role === 'assistant') {
          this.transcriptManager.appendToAssistantTurn(item.text);
          this.displayedWords.push({ text: item.text, offset: item.startOffset });
          this.wordsSpokenCount++;
        } else {
          this.transcriptManager.streamText(item.text, item.role, item.itemId, item.previousItemId);
        }
      } else {
        // DEBUG: Log why we stopped processing
        log.debug(`[QUEUE] Next word "${item.text}" not due yet - offset=${item.startOffset}ms, playback=${playbackTimeMs.toFixed(0)}ms, wait=${(item.startOffset - playbackTimeMs).toFixed(0)}ms`);
        break;
      }
    }
    
    // DEBUG: Log if we processed any words
    if (processedCount > 0) {
      log.debug(`[QUEUE] Dequeued ${processedCount} words at playbackTime=${playbackTimeMs.toFixed(0)}ms`);
    }
    
    // SUBTITLE SYNC: Mark words as spoken for each word that was dequeued
    while (this.wordsSpokenCount > 0) {
      this.subtitleController.markWordSpoken();
      this.wordsSpokenCount--;
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
