// Chat Manager - Orchestrates all services

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
import type {
  ChatMessage,
  IncomingMessage,
  OutgoingTextMessage,
  OutgoingAudioMessage,
  AudioStreamStartMessage,
  AudioStreamEndMessage
} from '../types/messages';

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
  /** Called on each transcript delta for subtitles (replaces, not appends) */
  onSubtitleUpdate?: (text: string, role: 'user' | 'assistant') => void;
}

export class ChatManager implements Disposable {
  private protocolClient: AvatarProtocolClient;
  private socketService: SocketService;
  private audioInput: AudioInput;
  private audioOutput: AudioOutput;
  private blendshapeBuffer: BlendshapeBuffer;
  private syncPlayback: SyncPlayback;  // NEW: Unified sync player
  private avatar: IAvatarController;
  
  private currentSessionId: string | null = null;
  private currentTurnId: string | null = null;  // Spec 5.1: Track current turn
  private turnStartTime: number = 0;  // Spec 5.1: Track start time of current turn
  private userId: string;
  private messages: ChatMessage[] = [];

  // UI Elements
  private chatMessages: HTMLElement;
  private chatInput: HTMLInputElement;
  private micBtn: HTMLButtonElement;
  private typingIndicator: HTMLElement | null = null;
  private typingStartTime: number = 0;
  private readonly MIN_TYPING_DISPLAY_MS = 1500; // Minimum time to show typing indicator

  // State
  private isRecording = false;
  private animationFrameId: number | null = null;
  private useSyncPlayback = false;  // Flag to track which playback mode is active
  private lastMessageTimestamp = 0;  // Track latest message timestamp to reject stale sessions

  // Streaming transcript state - separate tracking for user and assistant to avoid mixing
  // Map streaming messages by provider item id. Fallback to generated id when absent.
  private streamingByItem: Map<string, { role: 'user' | 'assistant'; element: HTMLElement }> = new Map();
  // Keep quick lookup of the latest item id per role (backward compatibility)
  private latestItemForRole: { user?: string; assistant?: string } = {};
  // Buffered deltas for itemIds not yet known; key = itemId (or temp id)
  private bufferedDeltas: Map<string, string[]> = new Map();
  // Timeout handles for buffered items (auto-flush)
  private bufferTimeouts: Map<string, number> = new Map();
  // Buffer wait ms (tuneable)
  private readonly BUFFER_WAIT_MS = 200;
  // Control whether assistant transcript is shown incrementally or only on finalize
  // Set to `false` to show assistant text as a whole when completed
  private readonly SHOW_ASSISTANT_STREAMING = false;
  // Single buffer key for all assistant deltas in a turn (so they share one bubble)
  private readonly ASSISTANT_TURN_KEY = 'assistant_current_turn';
  // Interval for appending buffered content to bubble
  private assistantAppendInterval: number | null = null;
  private readonly ASSISTANT_APPEND_INTERVAL_MS = 500; // Append every 0.5 seconds
  // Current assistant turn element - append all parts to same bubble
  private currentAssistantTurnElement: HTMLElement | null = null;
  private currentAssistantTurnText: string = '';
  
  // Subtitle state: two-array design
  // currentChunk = words being displayed NOW
  // nextChunk = words waiting for next display
  private subtitleCurrentChunk: string[] = [];  // Currently displayed
  private subtitleNextChunk: string[] = [];     // Waiting for next display
  private subtitleSpokenInChunk: number = 0;    // How many of currentChunk have been spoken
  private subtitleChunkLocked: boolean = false; // When true, stop appending to currentChunk
  private readonly SUBTITLE_MIN_WORDS = 5;
  private readonly SUBTITLE_MAX_WORDS = 7;
  
  // Transcript Queue for synced display
  private transcriptQueue: Array<{
    text: string;
    startOffset: number;
    itemId?: string;
    previousItemId?: string;
    role: 'user' | 'assistant';
  }> = [];

  // Options & Callbacks
  private options: ChatManagerOptions;

  constructor(avatar: IAvatarController, options: ChatManagerOptions = {}) {
    this.avatar = avatar;
    this.options = options;
    this.userId = this.generateUserId();
    
    // Initialize services
    this.socketService = new SocketService();
    this.protocolClient = new AvatarProtocolClient(this.socketService);

    this.audioInput = new AudioInput();
    this.audioOutput = new AudioOutput();
    this.blendshapeBuffer = new BlendshapeBuffer();
    this.syncPlayback = new SyncPlayback();
    
    // Setup SyncPlayback callbacks
    this.syncPlayback.setBlendshapeCallback((weights) => {
      this.avatar.updateBlendshapes(weights);
    });
    this.syncPlayback.setPlaybackEndCallback(() => {
      log.info('SyncPlayback ended - transitioning to Idle');
      this.avatar.setChatState('Idle');
      this.avatar.disableLiveBlendshapes();
      this.useSyncPlayback = false;

      // Show any remaining subtitle words before clearing
      this.showRemainingSubtitle();

      // Flush any remaining transcript items to ensure full sentence is shown
      while (this.transcriptQueue.length > 0) {
        const item = this.transcriptQueue.shift();
        if (item) {
          if (item.role === 'assistant') {
            this.appendToAssistantTurn(item.text);
          } else {
             // Basic fallback for user items
             this.streamTranscript(item.text, item.role, item.itemId, item.previousItemId, undefined, true);
          }
        }
      }
    });
    
    // Get UI elements - support Shadow DOM or document
    const root = options.shadowRoot || document;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Elements exist in template
    this.chatMessages = options.chatMessages || root.getElementById('chatMessages')!;
    this.chatInput = (options.chatInput || root.getElementById('chatInput')) as HTMLInputElement;
    this.micBtn = (options.micBtn || root.getElementById('micBtn')) as HTMLButtonElement;
    this.typingIndicator = root.getElementById('typingIndicator') as HTMLElement;
    
    // Setup MutationObserver to auto-scroll when content changes
    this.setupAutoScroll();
    
    this.setupEventListeners();
    this.setupProtocolHandlers();
    this.startBlendshapeSync();
  }

  private setupAutoScroll(): void {
    const observer = new MutationObserver(() => {
      // Scroll to bottom whenever content changes
      if (this.chatMessages) {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      }
    });
    
    observer.observe(this.chatMessages, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  private setTyping(typing: boolean): void {
    if (this.typingIndicator) {
      if (typing) {
        this.typingStartTime = Date.now();
        this.typingIndicator.classList.add('visible');
        // Scroll to bottom when typing starts
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      } else {
        // Ensure minimum display time before hiding
        const elapsed = Date.now() - this.typingStartTime;
        const remaining = this.MIN_TYPING_DISPLAY_MS - elapsed;
        
        if (remaining > 0) {
          // Delay hiding until minimum time has passed
          setTimeout(() => {
            this.typingIndicator?.classList.remove('visible');
          }, remaining);
        } else {
          this.typingIndicator.classList.remove('visible');
        }
      }
    }
  }

  async initialize(): Promise<void> {
    // Check capabilities
    FeatureDetection.logCapabilities();
    
    try {
      // Connect to WebSocket
      await this.protocolClient.connect();
      log.info('WebSocket connected');
      
      // Set avatar to Idle state - will transition to Listening on user interaction
      this.avatar.setChatState('Idle');
      
      // Request microphone permission (optional, on-demand)
      await this.audioInput.requestPermission();
      
    } catch (error) {
      errorBoundary.handleError(error as Error, 'chat-manager');
      log.error('Connection failed');
      this.options.onError?.(error as Error);
    }
  }

  private setupEventListeners(): void {
    const root = this.options.shadowRoot || document;
    
    // Enter key to send
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendTextMessage();
      }
    });
    
    // Microphone button
    log.info('Setting up mic button click listener', this.micBtn);
    this.micBtn.addEventListener('click', () => {
      log.info('Mic button clicked!');
      this.toggleVoiceInput();
    });
    
    // Chat header toggle (only for standalone mode, widget handles its own)
    const chatHeader = root.querySelector('.chat-header');
    if (!this.options.shadowRoot) {
      chatHeader?.addEventListener('click', () => this.toggleChat());
    }
    
    // Minimize button (standalone mode only)
    const minimizeBtn = root.getElementById?.('minimizeBtn');
    minimizeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleChat();
    });

    // Chat bubble click to open (standalone mode only)
    const chatBubble = root.getElementById?.('chatBubble');
    chatBubble?.addEventListener('click', () => this.openChat());
  }

  private setupProtocolHandlers(): void {
    // Connect Protocol Client Events to UI Actions

    this.protocolClient.on('connected', () => {
      log.debug('Protocol Client connected');
      this.options.onConnectionChange?.(true);
    });

    this.protocolClient.on('disconnected', () => {
      log.info('Protocol Client disconnected');
      this.options.onConnectionChange?.(false);
    });

    this.protocolClient.on('avatar_state', (event: { state: string }) => {
        // Map server states (Spec 3.7) to our simplified state machine
        const stateMap: Record<string, 'Idle' | 'Hello' | 'Responding'> = {
          'Idle': 'Idle',
          'Listening': 'Hello',
          'Processing': 'Hello',  // Spec 3.7: Processing state
          'Thinking': 'Hello',
          'Responding': 'Responding',
        };
        const mappedState = stateMap[event.state] || 'Idle';
        this.avatar.setChatState(mappedState);
    });

    // 1. Audio Start (Spec 5.2)
    this.protocolClient.on('audio_start', (event: AudioStartEvent) => {
        this.setTyping(false);
        log.info('Audio start received:', event.turnId);
        
        // Spec 5.1/5.2: Update global state
        this.currentTurnId = event.turnId;
        this.currentSessionId = event.sessionId;
        this.turnStartTime = Date.now();  // Reset tracking
        
        // Reset transcript state for new turn (fixes follow-up question bugs)
        this.transcriptQueue = [];
        // Note: Don't reset currentAssistantTurnElement/Text here - 
        // finalizeAssistantTurn() handles that when previous turn ends
        
        // Spec 5.2: audio_buffer.clear() - Start fresh session clears buffers
        this.syncPlayback.startSession(event.sessionId, event.sampleRate);
        
        // Also init legacy systems for fallback (optional, if you still support legacy)
        this.audioOutput.startSession(event.sessionId, event.sampleRate);
        this.blendshapeBuffer.startSession(event.sessionId);
        
        this.useSyncPlayback = false; // Will be set true on first sync_frame
        this.avatar.enableLiveBlendshapes();
        this.avatar.setChatState('Responding');  // UI Update: show_avatar_talking_state()
    });

    // 2. Sync Frame (Audio + Blendshapes)
    this.protocolClient.on('sync_frame', (event: SyncFrameEvent) => {
        // Implicit session start check handled by Protocol Client logic or here?
        // Protocol Client handles tracking turnId, but we need to ensure SyncPlayback is running.
        if (event.sessionId && event.sessionId !== this.currentSessionId) {
             // If we missed audio_start, force start here
             log.warn('Implicit session start in Manager via sync_frame');
             this.currentSessionId = event.sessionId;
             this.syncPlayback.startSession(event.sessionId);
             this.avatar.enableLiveBlendshapes();
             this.avatar.setChatState('Responding');
             this.setTyping(false);
        }

        // Send to player
        this.useSyncPlayback = true; 
        
        // Decode base64 
        const audioData = this.decodeBase64ToArrayBuffer(event.audio);
        
        // Weights mapping
        let weights: Record<string, number> = {};
        if (Array.isArray(event.weights)) {
             weights = event.weights as any;
        } else {
             weights = event.weights;
        }

        const frame: SyncFrame = {
          audio: audioData,
          weights: weights,
          timestamp: event.timestamp,
          frameIndex: event.frameIndex,
          sessionId: event.sessionId 
        };
        
        this.syncPlayback.addSyncFrame(frame);
    });

    // 3. Audio End (Spec 5.2: Do NOT stop playback immediately!)
    this.protocolClient.on('audio_end', (event: AudioEndEvent) => {
        log.info('Audio end received - marking stream complete (buffer will drain naturally)');
        
        // Spec 5.2: "Do NOT stop playback immediately! The buffer still has audio to play."
        // Just mark the stream as closed, let SyncPlayback drain naturally
        if (this.useSyncPlayback) {
            this.syncPlayback.endSession(event.sessionId);
        } else {
            this.audioOutput.endSession(event.sessionId);
            this.blendshapeBuffer.endSession(event.sessionId);
        }
        
        // Note: Don't finalize here - transcript_done will handle it
        // This prevents double-finalize causing two bubbles
    });

    // 4. Transcript Delta
    this.protocolClient.on('transcript_delta', (event: TranscriptDeltaEvent) => {
         const { role, text, itemId, previousItemId, startOffset } = event;
         // Pass to existing streamTranscript logic
         this.streamTranscript(text, role, itemId, previousItemId, startOffset);
    });

    // 5. Transcript Done
    this.protocolClient.on('transcript_done', (event: TranscriptDoneEvent) => {
        log.debug(`Transcript done [${event.role}]: ${event.text}`);
        
        if (event.role === 'assistant') {
            // Helper to replace text if interrupted
            if (event.interrupted) {
                 // Logic to replace bubble text with event.text
                 if (this.currentAssistantTurnElement) {
                     const bubble = this.currentAssistantTurnElement.querySelector('.message-bubble');
                     if (bubble) bubble.textContent = event.text;
                 }
            }
            this.finalizeAssistantTurn();
        } else {
            // User message
            const hasStreaming = (event.itemId && this.streamingByItem.has(event.itemId)) || 
                                (!event.itemId && this.latestItemForRole[event.role]);
             
            if (!hasStreaming) {
                this.addMessage(event.text, event.role);
            } else {
                this.finalizeStreamingMessage(event.itemId, event.role, event.interrupted);
            }
        }
    });

    // 6. Interrupt (Spec 5.3 - The "Magic" Logic)
    this.protocolClient.on('interrupt', (event: InterruptEvent) => {
        const interruptedTurn = event.turnId;
        const cutoffOffset = event.offsetMs;
        
        // Spec 5.3 Step 1: Verification
        if (this.currentTurnId !== interruptedTurn) {
            log.debug(`Ignoring interrupt for non-active turn. Active: ${this.currentTurnId}, Interrupted: ${interruptedTurn}`);
            return;
        }
        
        // Spec 5.3 Step 2: Stop processing new frames (handled by isStopped flag in SyncPlayback)
        // This is implicit - once we call stop(), new frames are dropped
        
        // Spec 5.3 Step 3: Calculate local playback position
        const playbackState = this.syncPlayback.getState();
        const msPlayed = playbackState.audioPlaybackTime * 1000;
        
        // Spec 5.3 Step 4: Handle immediate cut vs scheduled stop
        if (msPlayed >= cutoffOffset) {
            // We played too much (latency), stop NOW
            log.info(`Interruption: Immediate Stop (Played ${msPlayed.toFixed(0)}ms >= Cutoff ${cutoffOffset}ms)`);
            this.stopAllPlayback();
        } else {
            // We are slightly behind, schedule stop
            const remainingMs = cutoffOffset - msPlayed;
            log.info(`Interruption: Scheduled Stop in ${remainingMs.toFixed(0)}ms (Played ${msPlayed.toFixed(0)}ms, Cutoff ${cutoffOffset}ms)`);
            
            // Prune buffer after cutoff (frames that haven't played yet)
            // SyncPlayback.stop() will clear the buffer, so we schedule the stop
            setTimeout(() => {
                this.stopAllPlayback();
            }, remainingMs);
        }
    });
    
    // Error
    this.protocolClient.on('error', (err) => log.error('Protocol Error:', err));
  }

  private stopAllPlayback(): void {
    // Spec 5.3: Stop audio and prune buffer
    this.syncPlayback.stop();
    this.audioOutput.stop();
    this.blendshapeBuffer.clear();
    
    // Finalize whatever text was displayed
    this.finalizeAssistantTurn();
    
    // Clear transcript queue (pending deltas)
    this.resetTranscriptTiming();
    
    // Reset turn tracking
    this.currentTurnId = null;
    
    // UI feedback (Spec 3.6: "Visual indication that avatar stopped")
    this.avatar.disableLiveBlendshapes();
    this.avatar.setChatState('Hello');  // Back to listening state
  }

  /**
   * Send a text message programmatically (for widget API)
   */
  sendText(text: string): void {
    if (!text.trim()) return;
    
    // Show user text in subtitle
    this.options.onSubtitleUpdate?.(text, 'user');
    
    // Add to UI
    this.addMessage(text, 'user');

    // Send to server
    const message: OutgoingTextMessage = {
      type: 'text',
      data: text,
      userId: this.userId,
      timestamp: Date.now(),
    };

    this.socketService.send(message);
    // Stay in Hello state while waiting for response
  }

  private sendTextMessage(): void {
    const text = this.chatInput.value.trim();

    if (!text) {
      return;
    }

    // Transition from Idle to Hello (user is interacting)
    if (this.avatar.getChatState() === 'Idle') {
      this.avatar.setChatState('Hello');
    }

    // Show user text in subtitle
    this.options.onSubtitleUpdate?.(text, 'user');

    // Add to UI
    this.addMessage(text, 'user');

    // Clear input
    this.chatInput.value = '';

    // Send to server
    this.protocolClient.sendText(text);
    
    // Stay in Hello state while waiting for response
    this.setTyping(true);
  }

  private async toggleVoiceInput(): Promise<void> {
    log.info('toggleVoiceInput called, isRecording:', this.isRecording);
    
    // Transition to Hello when user starts voice input
    if (!this.isRecording) {
      this.avatar.setChatState('Hello');
    }
    
    if (this.isRecording) {
      log.info('Stopping recording...');
      this.stopRecording();
    } else {
      log.info('Starting recording...');
      await this.startRecording();
    }
  }

  private async startRecording(): Promise<void> {
    try {
      log.info('Starting recording (PCM16 24kHz)');
      log.info('WebSocket connected:', this.socketService.isConnected());

      // Signal server that audio stream is starting (spec 4.1)
      this.protocolClient.sendAudioStreamStart();
      log.info('Sent audio_stream_start to server');
      
      // Start recording with PCM16 mode for OpenAI Realtime API
      let chunkCount = 0;
      await this.audioInput.startRecording((audioData) => {
        chunkCount++;
        if (chunkCount <= 5 || chunkCount % 50 === 0) {
          log.info(`Audio chunk ${chunkCount}: ${audioData.byteLength} bytes`);
        }
        // Send raw binary audio to server (spec 4.2 preferred method)
        this.protocolClient.sendAudioData(audioData);
      }, 'pcm16'); // Use PCM16 format for Realtime API
      
      log.info('Recording started successfully');
      this.isRecording = true;
      this.micBtn.classList.add('recording');
      this.micBtn.setAttribute('aria-pressed', 'true');
      // Don't change avatar state - server controls it based on who's talking
      
    } catch (error) {
      log.error('Failed to start recording:', error);
      errorBoundary.handleError(error as Error, 'audio-input');
      alert('Microphone access denied. Please enable microphone permissions.');
    }
  }

  private stopRecording(): void {
    this.audioInput.stopRecording();
    
    // Signal server that audio stream has ended
    this.protocolClient.sendAudioStreamEnd();
    
    this.isRecording = false;
    this.micBtn.classList.remove('recording');
    this.micBtn.setAttribute('aria-pressed', 'false');
    // Don't change avatar state - it's controlled by server responses
    // Note: No typing indicator for voice - only for text input
  }

  private startBlendshapeSync(): void {
    /**
     * Animation System Explanation:
     * 
     * TWO animation systems work together:
     * 1. BODY (animation.glb) - Controlled by ChatState via AnimationManager
     *    - 'Idle': Subtle breathing/micro-movements
     *    - 'Hello': Greeting/attentive posture (animation index 2)
     *    - 'Responding': Speaking movements (head sway, hand gestures)
     *    
     * 2. FACE (LAM blendshapes) - Real-time from audio via SyncPlayback or BlendshapeBuffer
     *    - 52 ARKit blendshapes for facial expressions
     *    - Mouth shapes sync with speech
     *    - Eyes, brows react naturally
     * 
     * The ChatState drives BODY animations (from GLB clips)
     * while blendshapes from LAM drive FACIAL expressions. 
     * SYNC MODES:
     * - SyncPlayback: Used when receiving sync_frame messages (LAM enabled)
     *   - Handles both audio AND blendshapes in perfect sync
     *   - Audio playback time drives blendshape selection
     *   - This loop is SKIPPED (CPU optimization)
     *   
     * - Legacy mode: Used when receiving separate audio_chunk and blendshape messages
     *   - BlendshapeBuffer pops frames at 30fps
     *   - Less precise sync but works without LAM
     */
    const sync = () => {
      // Process any queued transcript items (sync text with audio)
      this.processTranscriptQueue();

      // OPTIMIZATION: When using SyncPlayback, it handles blendshape updates via callback
      // Skip this loop entirely to avoid 60fps overhead for legacy-only code
      if (!this.useSyncPlayback) {
        // getFrame() always returns a BlendshapeResult with weights, status, and endOfSpeech
        const result = this.blendshapeBuffer.getFrame();
        
        // Always apply facial blendshapes - either speaking expressions or neutral/idle
        this.avatar.updateBlendshapes(result.weights);
        
        // Update avatar ChatState based on frame status
        // This controls BODY animations from animation.glb
        if (result.status === 'SPEAKING') {
          // Set to Responding to trigger speaking body movements
          if (this.avatar.getChatState() !== 'Responding') {
            log.debug('Starting speech - body animation: Responding');
            this.avatar.setChatState('Responding');
          }
        } else if (result.status === 'LISTENING' && result.endOfSpeech) {
          // Only transition when speech actually ends (not just buffer temporarily empty)
          log.debug('End of speech - body animation: Hello');
          this.avatar.setChatState('Hello');
        }
      }
      // Note: Loop continues running to stay ready for legacy mode fallback
      // Consider: Could fully stop loop when SyncPlayback is confirmed

      this.animationFrameId = requestAnimationFrame(sync);
    };
    
    sync();
  }

  /**
   * Append text to the current assistant turn bubble (or create one)
   */
  private appendToAssistantTurn(text: string): void {
    if (!text || !text.trim()) return;

    // Create bubble if doesn't exist
    if (!this.currentAssistantTurnElement) {
      const messageEl = document.createElement('div');
      messageEl.className = 'message assistant';
      messageEl.dataset.id = `assistant_turn_${Date.now()}`;

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'message-bubble';
      bubbleEl.textContent = text;

      const footerEl = document.createElement('div');
      footerEl.className = 'message-footer';

      messageEl.appendChild(bubbleEl);
      messageEl.appendChild(footerEl);
      this.chatMessages.appendChild(messageEl);

      this.currentAssistantTurnElement = messageEl;
      this.currentAssistantTurnText = text;
      this.scrollToBottom();
    } else {
      // Append to existing bubble - add space between words, but not before punctuation
      const bubbleEl = this.currentAssistantTurnElement.querySelector('.message-bubble');
      if (bubbleEl) {
        // No space before punctuation or contractions ('t 's 're etc)
        const needsSpace = !/^[.,!?;:'’"\-)\]}>…]/.test(text);
        const separator = needsSpace ? ' ' : '';
        this.currentAssistantTurnText += separator + text;
        bubbleEl.textContent = this.currentAssistantTurnText;
        this.scrollToBottom();
      }
    }
    
    // SUBTITLE: Word SPOKEN
    // Only count and swap when chunk is LOCKED (done building)
    if (!this.subtitleChunkLocked) {
      // Still building - don't count spoken words yet
      return;
    }
    
    this.subtitleSpokenInChunk++;
    
    // When all words in current chunk are spoken, build next chunk
    if (this.subtitleSpokenInChunk >= this.subtitleCurrentChunk.length && this.subtitleCurrentChunk.length > 0) {
      // Build new current chunk from nextChunk (MAX 7 words, smart break)
      this.buildNextChunk();
    }
  }
  
  /**
   * Build new current chunk from nextChunk (respects 5-7 word limit)
   */
  private buildNextChunk(): void {
    // Reset state
    this.subtitleCurrentChunk = [];
    this.subtitleSpokenInChunk = 0;
    this.subtitleChunkLocked = false;
    
    // Take words from nextChunk, respecting limits
    while (this.subtitleNextChunk.length > 0 && this.subtitleCurrentChunk.length < this.SUBTITLE_MAX_WORDS) {
      const word = this.subtitleNextChunk.shift()!;
      this.subtitleCurrentChunk.push(word);
      
      // Check if we should stop (natural break point)
      if (this.shouldLockChunk()) {
        this.subtitleChunkLocked = true;
        break;
      }
    }
    
    // If we hit max without natural break, still lock
    if (this.subtitleCurrentChunk.length >= this.SUBTITLE_MAX_WORDS) {
      this.subtitleChunkLocked = true;
    }
    
    // Display new chunk
    if (this.subtitleCurrentChunk.length > 0) {
      this.displaySubtitleChunk();
    }
  }
  
  /**
   * Display current subtitle chunk
   */
  private displaySubtitleChunk(): void {
    if (this.subtitleCurrentChunk.length > 0) {
      const text = this.joinWordsSmartly(this.subtitleCurrentChunk);
      this.options.onSubtitleUpdate?.(text, 'assistant');
    }
  }
  
  /**
   * Check if current chunk should be locked (stop appending)
   */
  private shouldLockChunk(): boolean {
    const len = this.subtitleCurrentChunk.length;
    
    // Max reached - must lock
    if (len >= this.SUBTITLE_MAX_WORDS) return true;
    
    // Not enough words yet
    if (len < this.SUBTITLE_MIN_WORDS) return false;
    
    // Check for natural break (sentence end)
    const lastWord = this.subtitleCurrentChunk[len - 1];
    if (!lastWord) return false;
    
    // Don't lock if next word in nextChunk is punctuation
    const nextWord = this.subtitleNextChunk[0];
    if (nextWord && /^[.,!?;:''"\-]/.test(nextWord)) {
      return false;
    }
    
    // Lock on sentence end
    return /[.!?]$/.test(lastWord);
  }
  
  /**
   * Show any remaining subtitle words (called when playback ends)
   */
  private showRemainingSubtitle(): void {
    // Combine current and next chunks
    const all = [...this.subtitleCurrentChunk, ...this.subtitleNextChunk];
    if (all.length > 0) {
      const text = this.joinWordsSmartly(all);
      this.options.onSubtitleUpdate?.(text, 'assistant');
    }
  }

  /**
   * Append buffered deltas to the assistant bubble (called every 500ms)
   */
  private appendBufferedToAssistantBubble(): void {
    const buffered = this.bufferedDeltas.get(this.ASSISTANT_TURN_KEY);
    if (!buffered || buffered.length === 0) return;

    // Take all buffered text and clear the buffer
    const text = buffered.join('');
    this.bufferedDeltas.set(this.ASSISTANT_TURN_KEY, []);

    // Create or append to the bubble
    if (!this.currentAssistantTurnElement) {
      // Create new bubble
      const messageEl = document.createElement('div');
      messageEl.className = 'message assistant';
      messageEl.dataset.id = `assistant_turn_${Date.now()}`;

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'message-bubble';
      bubbleEl.textContent = text;

      const footerEl = document.createElement('div');
      footerEl.className = 'message-footer';

      messageEl.appendChild(bubbleEl);
      messageEl.appendChild(footerEl);
      this.chatMessages.appendChild(messageEl);

      this.currentAssistantTurnElement = messageEl;
      this.currentAssistantTurnText = text;
      this.scrollToBottom();
    } else {
      // Append to existing bubble
      const bubbleEl = this.currentAssistantTurnElement.querySelector('.message-bubble');
      if (bubbleEl) {
        this.currentAssistantTurnText += text;
        bubbleEl.textContent = this.currentAssistantTurnText;
        this.scrollToBottom();
      }
    }
    // Note: Subtitle is now updated via MutationObserver in widget.ts
  }

  /**
   * Finalize the current assistant turn (call when turn is complete)
   */
  public finalizeAssistantTurn(): void {
    // Stop the append interval
    if (this.assistantAppendInterval) {
      clearInterval(this.assistantAppendInterval);
      this.assistantAppendInterval = null;
    }

    // Flush any remaining buffered content
    this.appendBufferedToAssistantBubble();
    this.bufferedDeltas.delete(this.ASSISTANT_TURN_KEY);

    // Clear subtitle and reset subtitle state
    this.options.onSubtitleUpdate?.('', 'assistant');
    this.subtitleCurrentChunk = [];
    this.subtitleNextChunk = [];
    this.subtitleSpokenInChunk = 0;
    this.subtitleChunkLocked = false;

    if (!this.currentAssistantTurnElement) return;

    const msg: ChatMessage = {
      id: this.currentAssistantTurnElement.dataset.id || `assistant_${Date.now()}`,
      text: this.currentAssistantTurnText,
      sender: 'assistant',
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    this.options.onMessage?.({ role: 'assistant', text: this.currentAssistantTurnText });

    this.currentAssistantTurnElement.classList.add('finalized');
    this.currentAssistantTurnElement.dataset.finalized = 'true';

    // Reset for next turn
    this.currentAssistantTurnElement = null;
    this.currentAssistantTurnText = '';
  }

  private addMessage(text: string, sender: 'user' | 'assistant'): void {
    // If user is sending a new message, finalize any previous assistant turn
    if (sender === 'user' && this.currentAssistantTurnElement) {
      this.finalizeAssistantTurn();
    }

    const message: ChatMessage = {
      id: Date.now().toString(),
      text,
      sender,
      timestamp: Date.now(),
    };

    this.messages.push(message);
    this.renderMessage(message);
    this.scrollToBottom();

    // Notify widget callback
    this.options.onMessage?.({ role: sender, text });
  }

  /**
   * Item-aware streaming transcript: uses server-provided itemId and previousItemId
   * HYBRID APPROACH:
   * - Assistant messages → currentAssistantTurnElement (one bubble per turn)
   * - User messages → streamingByItem (supports multiple messages)
   */
  private streamTranscript(
    text: string, 
    role: 'user' | 'assistant', 
    itemId?: string, 
    previousItemId?: string,
    startOffset?: number,
    forceImmediate = false
  ): void {
    // QUEUE LOGIC: If startOffset is provided, always queue it for audio sync
    // (Previously we checked useSyncPlayback, but that causes a race condition
    // since sync_frame might arrive after transcript_delta)
    if (typeof startOffset === 'number' && !forceImmediate) {
      // User messages with 0 offset should show immediately
      if (role === 'user' && startOffset <= 0) {
        // Fall through to immediate rendering
      } else {
        this.transcriptQueue.push({ text, role, itemId, previousItemId, startOffset });
        
        // SUBTITLE: Word ARRIVED (not spoken yet)
        if (role === 'assistant') {
          const word = text.trim();
          
          if (this.subtitleChunkLocked) {
            // Chunk is locked (being spoken) - save for next chunk
            this.subtitleNextChunk.push(word);
          } else {
            // Building current chunk - append and display
            this.subtitleCurrentChunk.push(word);
            this.displaySubtitleChunk();
            
            // Check if we should lock
            if (this.shouldLockChunk()) {
              this.subtitleChunkLocked = true;
            }
          }
        }
        return;
      }
    }

    // If user is starting to speak, finalize any previous assistant turn
    if (role === 'user' && this.currentAssistantTurnElement) {
      this.finalizeAssistantTurn();
    }

    // Determine effective id
    const effectiveId = itemId || `${role}_${Date.now().toString()}`;

    // If assistant streaming is disabled, just buffer the parts and return
    // Use a single key for ALL assistant deltas so they merge into one bubble
    if (role === 'assistant' && !this.SHOW_ASSISTANT_STREAMING) {
      const bufferKey = this.ASSISTANT_TURN_KEY; // Single key for entire turn
      const buf = this.bufferedDeltas.get(bufferKey) || [];
      buf.push(text);
      this.bufferedDeltas.set(bufferKey, buf);
      
      // Start interval to append buffered content every second
      if (!this.assistantAppendInterval) {
        this.assistantAppendInterval = window.setInterval(() => {
          this.appendBufferedToAssistantBubble();
        }, this.ASSISTANT_APPEND_INTERVAL_MS);
      }
      return;
    }

    // If previousItemId is provided and not yet seen, buffer this delta briefly
    if (previousItemId && !this.streamingByItem.has(previousItemId) && !this.latestItemForRole[role]) {
      // Buffer under effectiveId so we can flush it when ready
      const buf = this.bufferedDeltas.get(effectiveId) || [];
      buf.push(text);
      this.bufferedDeltas.set(effectiveId, buf);
      // Start/refresh timeout to flush eventually
      if (this.bufferTimeouts.has(effectiveId)) {
        clearTimeout(this.bufferTimeouts.get(effectiveId));
      }
      const t = window.setTimeout(() => {
        this.flushBufferedDeltas(effectiveId, role, effectiveId /* fallback id */);
      }, this.BUFFER_WAIT_MS);
      this.bufferTimeouts.set(effectiveId, t);
      return;
    }

    // If we have buffered deltas that reference this itemId (or previousItemId resolved), flush them first
    if (this.bufferedDeltas.has(effectiveId)) {
      const buffered = this.bufferedDeltas.get(effectiveId) || [];
      for (const part of buffered) {
        this.appendToStreamingItem(effectiveId, role, part);
      }
      this.bufferedDeltas.delete(effectiveId);
      const to = this.bufferTimeouts.get(effectiveId);
      if (to) { clearTimeout(to); this.bufferTimeouts.delete(effectiveId); }
    }

    // Create streaming element if not exists
    if (!this.streamingByItem.has(effectiveId)) {
      const messageEl = document.createElement('div');
      messageEl.className = `message ${role}`;
      messageEl.dataset.id = effectiveId;

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'message-bubble';
      bubbleEl.textContent = text;

      const footerEl = document.createElement('div');
      footerEl.className = 'message-footer';

      messageEl.appendChild(bubbleEl);
      messageEl.appendChild(footerEl);
      this.chatMessages.appendChild(messageEl);

      this.streamingByItem.set(effectiveId, { role, element: messageEl });
      this.latestItemForRole[role] = effectiveId;
      this.scrollToBottom();
    } else {
      // Append to existing element
      this.appendToStreamingItem(effectiveId, role, text);
    }
  }

  private appendToStreamingItem(id: string, role: 'user' | 'assistant', text: string) {
    const entry = this.streamingByItem.get(id);
    if (!entry) return;
    const bubbleEl = entry.element.querySelector('.message-bubble');
    if (bubbleEl) {
      bubbleEl.textContent += text;
      this.scrollToBottom();
    }
  }

  private flushBufferedDeltas(bufferKey: string, role: 'user' | 'assistant', fallbackId: string) {
    const parts = this.bufferedDeltas.get(bufferKey);
    if (!parts) return;
    // If assistant streaming is disabled, finalize buffered parts as a single message
    if (role === 'assistant' && !this.SHOW_ASSISTANT_STREAMING) {
      try {
        const text = parts.join('');
        const msg: ChatMessage = {
          id: fallbackId,
          text,
          sender: 'assistant',
          timestamp: Date.now(),
        };
        this.messages.push(msg);
        this.options.onMessage?.({ role: 'assistant', text });
        this.renderMessage(msg);
        const el = this.chatMessages.lastElementChild as HTMLElement | null;
        if (el) { el.classList.add('finalized'); el.dataset.finalized = 'true'; }
      } catch (err) {
        log.error('Failed to finalize buffered assistant parts:', err);
      }
    } else {
      // create element using fallbackId
      for (const p of parts) {
        this.streamTranscript(p, role, fallbackId);
      }
    }
    this.bufferedDeltas.delete(bufferKey);
    const to = this.bufferTimeouts.get(bufferKey);
    if (to) { clearTimeout(to); this.bufferTimeouts.delete(bufferKey); }
  }

  private finalizeStreamingMessage(itemId?: string, role?: 'user' | 'assistant', interrupted = false): void {
    // If this is for assistant and we have a current turn element, skip (already handled)
    if (role === 'assistant' && this.currentAssistantTurnElement) {
      log.debug('Skipping finalizeStreamingMessage - assistant turn already handled');
      return;
    }
    
    // For assistant, check the unified turn buffer first
    if (role === 'assistant') {
      const buffered = this.bufferedDeltas.get(this.ASSISTANT_TURN_KEY);
      if (buffered && buffered.length) {
        const text = this.joinWordsSmartly(buffered);
        const msg: ChatMessage = {
          id: `assistant_turn_${Date.now()}`,
          text,
          sender: 'assistant',
          timestamp: Date.now(),
        };
        this.messages.push(msg);
        this.options.onMessage?.({ role: 'assistant', text });
        this.renderMessage(msg);
        const el = this.chatMessages.lastElementChild as HTMLElement | null;
        if (el) {
          el.classList.add('finalized');
          el.dataset.finalized = 'true';
        }
        this.bufferedDeltas.delete(this.ASSISTANT_TURN_KEY);
        const to = this.bufferTimeouts.get(this.ASSISTANT_TURN_KEY);
        if (to) { clearTimeout(to); this.bufferTimeouts.delete(this.ASSISTANT_TURN_KEY); }
        return;
      }
    }
    
    if (itemId) {
      const entry = this.streamingByItem.get(itemId);
      if (entry) {
        const bubbleEl = entry.element.querySelector('.message-bubble');
        const text = bubbleEl?.textContent || '';
        // Push to messages array
        const msg: ChatMessage = {
          id: itemId,
          text,
          sender: entry.role,
          timestamp: Date.now(),
        };
        this.messages.push(msg);
        this.options.onMessage?.({ role: entry.role, text });
        // Keep the finalized bubble in the DOM (don't remove past transcript bubbles)
        // Mark as finalized so UI/CSS can style it differently if desired
        entry.element.classList.add('finalized');
        entry.element.dataset.finalized = 'true';
        this.streamingByItem.delete(itemId);
        if (this.latestItemForRole[entry.role] === itemId) {
          delete this.latestItemForRole[entry.role];
        }
        return;
      }
      // If we have buffered parts for this itemId (assistant streaming disabled), finalize from buffer
      const buffered = this.bufferedDeltas.get(itemId);
      if (buffered && buffered.length) {
        const text = buffered.join('');
        const msg: ChatMessage = {
          id: itemId,
          text,
          sender: role || 'assistant',
          timestamp: Date.now(),
        };
        this.messages.push(msg);
        this.options.onMessage?.({ role: msg.sender as 'user' | 'assistant', text });
        // Render finalized bubble and mark finalized
        this.renderMessage(msg);
        const el = this.chatMessages.lastElementChild as HTMLElement | null;
        if (el) {
          el.classList.add('finalized');
          el.dataset.finalized = 'true';
        }
        this.bufferedDeltas.delete(itemId);
        const to = this.bufferTimeouts.get(itemId);
        if (to) { clearTimeout(to); this.bufferTimeouts.delete(itemId); }
        return;
      }
    }

    // Fallback: finalize by role if provided, else finalize both
    const rolesToFinalize = role ? [role] : (['user','assistant'] as const);
    for (const r of rolesToFinalize) {
      const latestId = this.latestItemForRole[r];
      if (!latestId) continue;
      const entry = this.streamingByItem.get(latestId);
      if (!entry) continue;
      const bubbleEl = entry.element.querySelector('.message-bubble');
      const text = bubbleEl?.textContent || '';
      const msg: ChatMessage = {
        id: latestId,
        text,
        sender: r,
        timestamp: Date.now(),
      };
      this.messages.push(msg);
      this.options.onMessage?.({ role: r, text });
      // Keep the finalized bubble in the DOM and mark finalized
      entry.element.classList.add('finalized');
      entry.element.dataset.finalized = 'true';
      this.streamingByItem.delete(latestId);
      delete this.latestItemForRole[r];
    }

    // If no active streaming elements, check buffered deltas (useful when assistant streaming disabled)
    if (role) {
      // find buffered key for this role (fallback keys are role_timestamp)
      let foundKey: string | null = null;
      for (const k of Array.from(this.bufferedDeltas.keys())) {
        if (k.startsWith(`${role}_`)) {
          foundKey = k;
          break;
        }
      }
      if (foundKey) {
        const parts = this.bufferedDeltas.get(foundKey) || [];
        const text = parts.join('');
        const msg: ChatMessage = {
          id: foundKey,
          text,
          sender: role,
          timestamp: Date.now(),
        };
        this.messages.push(msg);
        this.options.onMessage?.({ role, text });
        this.renderMessage(msg);
        const el = this.chatMessages.lastElementChild as HTMLElement | null;
        if (el) { el.classList.add('finalized'); el.dataset.finalized = 'true'; }
        this.bufferedDeltas.delete(foundKey);
        const to = this.bufferTimeouts.get(foundKey);
        if (to) { clearTimeout(to); this.bufferTimeouts.delete(foundKey); }
      }
    }

    // If interrupted, force assistant to finalize and reset state
    if (interrupted) {
      // ensure assistant streaming is cleared
      const assistantId = this.latestItemForRole.assistant;
      if (assistantId) {
        this.finalizeStreamingMessage(assistantId, 'assistant', false);
      }
    }
  }

  private renderMessage(message: ChatMessage): void {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.sender}`;
    
    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';
    bubbleEl.textContent = message.text;
    
    const footerEl = document.createElement('div');
    footerEl.className = 'message-footer';

    messageEl.appendChild(bubbleEl);
    messageEl.appendChild(footerEl);

    this.chatMessages.appendChild(messageEl);
  }

  private scrollToBottom(): void {
    // Scroll after layout using requestAnimationFrame + scrollIntoView for reliability
    requestAnimationFrame(() => {
      const lastChild = this.chatMessages?.lastElementChild as HTMLElement | null;
      if (lastChild) {
        lastChild.scrollIntoView({ behavior: 'auto', block: 'end' });
      } else if (this.chatMessages) {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      }
    });
  }

  private toggleChat(): void {
    const widget = document.getElementById('chatWidget');
    const bubble = document.getElementById('chatBubble');

    const isMinimized = widget?.classList.toggle('minimized');

    // Show bubble when minimized, hide when expanded
    if (isMinimized) {
      bubble?.classList.remove('hidden');
      this.resetOnMinimize();
    } else {
      bubble?.classList.add('hidden');
      this.reconnectOnExpand();
    }
  }

  /**
   * Reset chat state when minimizing (public API for widget)
   */
  resetOnMinimize(): void {
    log.info('Minimizing widget - stopping all activity');

    // Stop recording if active
    if (this.isRecording) {
      log.debug('Stopping recording...');
      this.stopRecording();
    }

    // Stop blendshape sync loop to save CPU
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Invalidate current session to ignore any stale messages after reconnect
    log.debug('Invalidating session:', this.currentSessionId);
    this.currentSessionId = null;

    // Stop all audio playback FIRST (before disconnect)
    log.debug('Stopping audio playback and clearing buffers...');
    this.syncPlayback.stop();
    this.audioOutput.stop();

    // Clear blendshape buffer and disable live mode
    this.blendshapeBuffer.clear();
    this.avatar.disableLiveBlendshapes();

    // Disconnect from server to immediately stop all streaming
    log.debug('Disconnecting from server...');
    this.socketService.disconnect();

    // Reset avatar to idle and pause animation
    this.avatar.setChatState('Idle');

    // Type-safe pause check
    if ('pause' in this.avatar && typeof this.avatar.pause === 'function') {
      (this.avatar as IAvatarController & { pause(): void }).pause();
    }

    log.info('Widget minimized - all activity stopped');
  }

  /**
   * Reconnect to server when expanding (public API for widget)
   */
  async reconnectOnExpand(): Promise<void> {
    // Reconnect to server
    try {
      await this.protocolClient.connect();
      log.debug('Chat expanded - reconnected to server');
    } catch (error) {
      log.error('Failed to reconnect on expand:', error);
    }

    // Resume avatar animation - type-safe check
    if ('resume' in this.avatar && typeof this.avatar.resume === 'function') {
      (this.avatar as IAvatarController & { resume(): void }).resume();
    }

    // Restart blendshape sync loop if not already running
    if (this.animationFrameId === null) {
      this.startBlendshapeSync();
    }
  }

  private openChat(): void {
    const widget = document.getElementById('chatWidget');
    const bubble = document.getElementById('chatBubble');

    widget?.classList.remove('minimized');
    bubble?.classList.add('hidden');

    // Reconnect to server and resume avatar
    this.reconnectOnExpand();

    // Focus the input
    this.chatInput?.focus();
  }

  private generateUserId(): string {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * OPTIMIZED: Decode base64 to ArrayBuffer using efficient typed array conversion
   * Avoids creating intermediate strings and reduces allocations
   */
  private decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
    // Use atob for decoding (browser-native, optimized)
    const binaryString = atob(base64);
    const len = binaryString.length;
    
    // Direct byte extraction - slightly faster than charCodeAt in loop
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes.buffer;
  }

  /**
   * Reset transcript timing state when a new session starts.
   * Called on implicit session start to ensure clean state.
   */
  private resetTranscriptTiming(): void {
    // Clear transcript queue
    this.transcriptQueue = [];
    
    // Clear any pending buffered deltas from previous session
    this.bufferedDeltas.clear();
    for (const timeout of this.bufferTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.bufferTimeouts.clear();
    
    // Clear streaming state
    this.streamingByItem.clear();
    this.latestItemForRole = {};
    
    // Reset assistant turn state
    if (this.assistantAppendInterval) {
      clearInterval(this.assistantAppendInterval);
      this.assistantAppendInterval = null;
    }
    this.currentAssistantTurnElement = null;
    this.currentAssistantTurnText = '';
    
    // Reset subtitle state
    this.subtitleSpokenWordCount = 0;
    this.subtitleCurrentChunk = [];
  }

  /**
   * Process queued transcript items based on playback time
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
          this.appendToAssistantTurn(item.text);
        } else {
          // Fallback for user messages (should usually have 0 offset)
          this.streamTranscript(item.text, item.role, item.itemId, item.previousItemId, undefined, true);
        }
      } else {
        // Queue is ordered by time, so we can stop checking
        break;
      }
    }
  }
  
  /**
   * Build NEXT subtitle chunk from queue (REPLACES current chunk)
   * Called only when current chunk is fully spoken through
   */
  private buildSubtitleChunkFromQueue(): void {
    const assistantItems = this.transcriptQueue.filter(item => item.role === 'assistant');
    
    if (assistantItems.length === 0) return;
    
    // After initial chunk, always use 6 words
    this.subtitleCurrentChunk = assistantItems
      .slice(0, this.SUBTITLE_CHUNK_SIZE)
      .map(item => item.text.trim());
    
    if (this.subtitleCurrentChunk.length > 0) {
      // New chunk starts at position 0
      const subtitleText = '0|' + this.joinWordsSmartly(this.subtitleCurrentChunk);
      this.options.onSubtitleUpdate?.(subtitleText, 'assistant');
    }
  }
  
  /**
   * Join words with smart spacing - add space between words, but not before punctuation
   */
  private joinWordsSmartly(words: string[]): string {
    if (words.length === 0) return '';
    
    let result = words[0];
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      // No space before punctuation or contractions ('t 's etc)
      const needsSpace = !/^[.,!?;:'’"\-)\]}>…]/.test(word);
      result += needsSpace ? ' ' + word : word;
    }
    return result;
  }

  /**
   * Manually reconnect to the server
   */
  async reconnect(): Promise<void> {
    return this.protocolClient.connect();
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.protocolClient.disconnect();
    // this.socketService.dispose(); // Handled by protocolClient.disconnect roughly? 
    // Wait, protocolClient doesn't have dispose, only disconnect. 
    // socketService has dispose which closes socket.
    // ChatManager created ProtocolClient which wraps SocketService.
    // If we want to fully dispose, we should probably add dispose to ProtocolClient.
    this.audioInput.dispose();
    this.audioOutput.dispose();
    this.blendshapeBuffer.dispose();
    this.syncPlayback.dispose();
  }
}
