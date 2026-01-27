// Chat Manager - Orchestrates all services

import { SocketService } from '../services/SocketService';
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
  sendBtn?: HTMLButtonElement;
  micBtn?: HTMLButtonElement;
  /** Callbacks */
  onConnectionChange?: (connected: boolean) => void;
  onMessage?: (msg: { role: 'user' | 'assistant'; text: string }) => void;
  onError?: (error: Error) => void;
}

export class ChatManager implements Disposable {
  private socketService: SocketService;
  private audioInput: AudioInput;
  private audioOutput: AudioOutput;
  private blendshapeBuffer: BlendshapeBuffer;
  private syncPlayback: SyncPlayback;  // NEW: Unified sync player
  private avatar: IAvatarController;
  
  private currentSessionId: string | null = null;
  private userId: string;
  private messages: ChatMessage[] = [];

  // UI Elements
  private chatMessages: HTMLElement;
  private chatInput: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private micBtn: HTMLButtonElement;
  private typingIndicator: HTMLElement | null = null;
  private typingStartTime: number = 0;
  private readonly MIN_TYPING_DISPLAY_MS = 1500; // Minimum time to show typing indicator

  // State
  private isRecording = false;
  private animationFrameId: number | null = null;
  private useSyncPlayback = false;  // Flag to track which playback mode is active

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
  
  // Options & Callbacks
  private options: ChatManagerOptions;

  constructor(avatar: IAvatarController, options: ChatManagerOptions = {}) {
    this.avatar = avatar;
    this.options = options;
    this.userId = this.generateUserId();
    
    // Initialize services
    this.socketService = new SocketService();
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
    });
    
    // Get UI elements - support Shadow DOM or document
    const root = options.shadowRoot || document;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Elements exist in template
    this.chatMessages = options.chatMessages || root.getElementById('chatMessages')!;
    this.chatInput = (options.chatInput || root.getElementById('chatInput')) as HTMLInputElement;
    this.sendBtn = (options.sendBtn || root.getElementById('sendBtn')) as HTMLButtonElement;
    this.micBtn = (options.micBtn || root.getElementById('micBtn')) as HTMLButtonElement;
    this.typingIndicator = root.getElementById('typingIndicator') as HTMLElement;
    
    // Setup MutationObserver to auto-scroll when content changes
    this.setupAutoScroll();
    
    this.setupEventListeners();
    this.setupWebSocketHandlers();
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
      await this.socketService.connect();
      log.info('WebSocket connected');
      
      // Set avatar to Idle state - will transition to Listening on user interaction
      this.avatar.setChatState('Idle');
      
      // Request microphone permission (optional, on-demand)
      // await this.audioInput.requestPermission();
      
    } catch (error) {
      errorBoundary.handleError(error as Error, 'chat-manager');
      log.error('Connection failed');
      this.options.onError?.(error as Error);
    }
  }

  private setupEventListeners(): void {
    const root = this.options.shadowRoot || document;
    
    // Send button
    this.sendBtn.addEventListener('click', () => this.sendTextMessage());
    
    // Enter key to send
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendTextMessage();
      }
    });
    
    // Microphone button
    this.micBtn.addEventListener('click', () => this.toggleVoiceInput());
    
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

  private setupWebSocketHandlers(): void {
    this.socketService.on('connected', () => {
      log.debug('WebSocket connected');
      this.options.onConnectionChange?.(true);
    });
    
    this.socketService.on('disconnected', () => {
      log.info('WebSocket disconnected');
      this.options.onConnectionChange?.(false);
    });
    
    this.socketService.on('connectionStateChanged', (state) => {
      log.debug('Connection state:', state);
    });
    
    // Handle incoming messages
    this.socketService.on('text', (message: IncomingMessage) => {
      if (message.type === 'text') {
        this.setTyping(false);
        this.addMessage(message.data, 'assistant');
      }
    });
    
    // Server controls avatar state - map old states to new simplified states
    this.socketService.on('avatar_state', (message: IncomingMessage) => {
      if (message.type === 'avatar_state') {
        // Map server states to our simplified state machine
        const stateMap: Record<string, 'Idle' | 'Hello' | 'Responding'> = {
          'Idle': 'Idle',
          'Listening': 'Hello',
          'Thinking': 'Hello',
          'Responding': 'Responding',
        };
        const mappedState = stateMap[message.state] || 'Idle';
        this.avatar.setChatState(mappedState);
      }
    });
    
    this.socketService.on('audio_start', (message: IncomingMessage) => {
      if (message.type === 'audio_start') {
        this.setTyping(false);
        log.info('Audio start received:', message.sessionId);
        this.currentSessionId = message.sessionId;
        
        // Start BOTH playback systems (will use appropriate one based on message type)
        // SyncPlayback handles sync_frame messages
        // AudioOutput+BlendshapeBuffer handles legacy audio_chunk+blendshape messages
        this.syncPlayback.startSession(message.sessionId, message.sampleRate);
        this.audioOutput.startSession(message.sessionId, message.sampleRate);
        this.blendshapeBuffer.startSession(message.sessionId);
        
        this.useSyncPlayback = false;  // Will be set to true when sync_frame arrives
        this.avatar.enableLiveBlendshapes();
        
        // Transition to Responding immediately
        this.avatar.setChatState('Responding');
      }
    });
    
    this.socketService.on('audio_chunk', (message: IncomingMessage) => {
      if (message.type === 'audio_chunk') {
        // Validate session ID to prevent stale chunks from previous conversations
        if (message.sessionId && this.currentSessionId && message.sessionId !== this.currentSessionId) {
          log.debug('Ignoring audio_chunk from stale session:', message.sessionId);
          return;
        }
        
        // Legacy: Server sends base64 encoded audio in JSON (without blendshapes)
        // This is used when LAM is not available
        let audioData: ArrayBuffer;
        if (message.data instanceof ArrayBuffer) {
          audioData = message.data;
        } else if (typeof message.data === 'string') {
          // Decode base64
          const binaryString = atob(message.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          audioData = bytes.buffer;
          log.debug('Audio chunk received:', audioData.byteLength, 'bytes');
        } else {
          log.warn('Unknown audio data format:', typeof message.data);
          return;
        }
        this.audioOutput.addAudioChunk(audioData, message.timestamp);
      }
    });
    
    // NEW: Handle synchronized audio+blendshape frames using SyncPlayback
    // This is the OpenAvatarChat pattern - audio and blendshapes paired together
    this.socketService.on('sync_frame', (message: IncomingMessage) => {
      if (message.type === 'sync_frame') {
        // Validate session ID to prevent stale frames from previous conversations
        if (message.sessionId && this.currentSessionId && message.sessionId !== this.currentSessionId) {
          log.debug('Ignoring sync_frame from stale session:', message.sessionId, 'current:', this.currentSessionId);
          return;
        }
        
        // Mark that we're using sync playback (not legacy separate streams)
        this.useSyncPlayback = true;
        
        // OPTIMIZED: Decode base64 audio using efficient typed array conversion
        // This avoids intermediate string operations
        const audioData = this.decodeBase64ToArrayBuffer(message.audio);
        
        // Log first frame to verify sync
        if (message.frameIndex === 0) {
          log.debug('First sync_frame received:', audioData.byteLength, 'bytes audio + blendshapes');
        }
        
        // Create SyncFrame and add to unified player
        const syncFrame: SyncFrame = {
          audio: audioData,
          weights: message.weights,
          timestamp: message.timestamp,
          frameIndex: message.frameIndex,
        };
        
        // SyncPlayback handles both audio playback AND blendshape application
        // in perfect sync - audio time drives blendshape selection
        this.syncPlayback.addSyncFrame(syncFrame);
      }
    });
    
    this.socketService.on('blendshape', (message: IncomingMessage) => {
      if (message.type === 'blendshape') {
        // Validate session ID to prevent stale blendshapes from previous conversations
        if (message.sessionId && this.currentSessionId && message.sessionId !== this.currentSessionId) {
          return; // Silently ignore - too noisy to log every frame
        }
        
        // Logging reduced - see session start/end logs
        this.blendshapeBuffer.addFrame(message.weights, message.timestamp);
      }
    });
    
    this.socketService.on('audio_end', (message: IncomingMessage) => {
      if (message.type === 'audio_end') {
        // Validate session ID to prevent stale end signals
        if (message.sessionId && this.currentSessionId && message.sessionId !== this.currentSessionId) {
          log.debug('Ignoring audio_end from stale session:', message.sessionId);
          return;
        }
        
        log.info('Audio end received');
        
        if (this.useSyncPlayback) {
          // Using synchronized playback - it will handle ending naturally
          this.syncPlayback.endSession(message.sessionId);
        } else {
          // Legacy mode
          this.audioOutput.endSession(message.sessionId);
          this.blendshapeBuffer.endSession(message.sessionId);
        }
        
        // OpenAvatarChat pattern: DON'T disable live blendshapes or stop the loop
        // The buffer will naturally drain and switch to idle frames
        // The startBlendshapeSync loop continues running and will handle the transition
        log.debug('Speech ended - buffer will drain naturally to idle');
      }
    });
    
    // Handle interruption from server (user started speaking during response)
    this.socketService.on('interrupt', (message: IncomingMessage) => {
      if (message.type === 'interrupt') {
        log.info('Interrupt received - stopping audio playback');

        // Stop all playback systems
        this.syncPlayback.stop();
        this.audioOutput.stop();
        this.blendshapeBuffer.clear();

        // Finalize specific item if provided, else finalize assistant fallback
        const interruptedItem = (message as any).itemId as string | undefined;
        this.finalizeStreamingMessage(interruptedItem, 'assistant', true);

        this.avatar.disableLiveBlendshapes();
        this.avatar.setChatState('Hello');
      }
    });
    
    // Handle transcript delta (real-time transcription)
    this.socketService.on('transcript_delta', (message: IncomingMessage) => {
      if (message.type === 'transcript_delta' && message.text) {
        // DEBUG: Log raw role value from server
        console.log('transcript_delta raw:', { role: message.role, text: message.text });
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        const itemId = (message as any).itemId as string | undefined;
        const previousItemId = (message as any).previousItemId as string | undefined;

        this.streamTranscript(message.text, role, itemId, previousItemId);
      }
    });

    // Handle completed transcript
    this.socketService.on('transcript_done', (message: IncomingMessage) => {
      if (message.type === 'transcript_done') {
        log.debug(`Transcript complete [${message.role}]: ${message.text}`);
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        const itemId = (message as any).itemId as string | undefined;
        const interrupted = !!(message as any).interrupted;
        this.finalizeStreamingMessage(itemId, role, interrupted);
      }
    });
    
    this.socketService.on('error', (error: Error) => {
      log.error('Socket error:', error);
    });
  }

  /**
   * Send a text message programmatically (for widget API)
   */
  sendText(text: string): void {
    if (!text.trim()) return;
    
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

    // Add to UI
    this.addMessage(text, 'user');

    // Clear input
    this.chatInput.value = '';

    // Send to server
    const message: OutgoingTextMessage = {
      type: 'text',
      data: text,
      userId: this.userId,
      timestamp: Date.now(),
    };

    this.socketService.send(message);
    // Stay in Hello state while waiting for response
    this.setTyping(true);
  }

  private async toggleVoiceInput(): Promise<void> {
    // Transition to Hello when user starts voice input
    if (!this.isRecording) {
      this.avatar.setChatState('Hello');
    }
    
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording(): Promise<void> {
    try {
      // Use PCM16 format for OpenAI Realtime API
      const format = 'audio/pcm16';
      const sampleRate = 24000; // OpenAI Realtime API requires 24kHz

      // Signal server that audio stream is starting
      const startMessage: AudioStreamStartMessage = {
        type: 'audio_stream_start',
        userId: this.userId,
        format: format,
        sampleRate: sampleRate,
        timestamp: Date.now(),
      };
      this.socketService.send(startMessage);
      
      // Start recording with PCM16 mode for OpenAI Realtime API
      await this.audioInput.startRecording((audioData) => {
        // Send each audio chunk immediately to server
        const message: OutgoingAudioMessage = {
          type: 'audio',
          data: audioData,
          format: format,
          userId: this.userId,
          timestamp: Date.now(),
          sampleRate: sampleRate,
        };
        
        this.socketService.send(message);
      }, 'pcm16'); // Use PCM16 format for Realtime API
      
      this.isRecording = true;
      this.micBtn.classList.add('recording');
      this.micBtn.setAttribute('aria-pressed', 'true');
      // Don't change avatar state - server controls it based on who's talking
      
    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-input');
      alert('Microphone access denied. Please enable microphone permissions.');
    }
  }

  private stopRecording(): void {
    this.audioInput.stopRecording();
    
    // Signal server that audio stream has ended
    const endMessage: AudioStreamEndMessage = {
      type: 'audio_stream_end',
      userId: this.userId,
      timestamp: Date.now(),
    };
    this.socketService.send(endMessage);
    
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

  private addMessage(text: string, sender: 'user' | 'assistant'): void {
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
   */
  private streamTranscript(text: string, role: 'user' | 'assistant', itemId?: string, previousItemId?: string): void {
    // Determine effective id
    const effectiveId = itemId || `${role}_${Date.now().toString()}`;

    // If assistant streaming is disabled, just buffer the parts and return
    if (role === 'assistant' && !this.SHOW_ASSISTANT_STREAMING) {
      const buf = this.bufferedDeltas.get(effectiveId) || [];
      buf.push(text);
      this.bufferedDeltas.set(effectiveId, buf);
      // Keep a cleanup timeout to avoid unbounded memory growth
      if (!this.bufferTimeouts.has(effectiveId)) {
        const t = window.setTimeout(() => {
          // If still buffered after a long time, flush to DOM as fallback
          this.flushBufferedDeltas(effectiveId, role, effectiveId);
        }, Math.max(this.BUFFER_WAIT_MS, 2000));
        this.bufferTimeouts.set(effectiveId, t);
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

      const timeEl = document.createElement('div');
      timeEl.className = 'message-time';
      timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      footerEl.appendChild(timeEl);
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
        if (entry.role === 'assistant') {
          this.addFeedbackButtons(entry.element);
        }
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
      if (r === 'assistant') {
        this.addFeedbackButtons(entry.element);
      }
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

    // Time
    const timeEl = document.createElement('div');
    timeEl.className = 'message-time';
    timeEl.textContent = new Date(message.timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    footerEl.appendChild(timeEl);
    messageEl.appendChild(bubbleEl);
    messageEl.appendChild(footerEl);

    // Add feedback buttons for assistant
    if (message.sender === 'assistant') {
      this.addFeedbackButtons(messageEl);
    }
    
    this.chatMessages.appendChild(messageEl);
  }

  private addFeedbackButtons(messageEl: HTMLElement): void {
    let footerEl = messageEl.querySelector('.message-footer');
    if (!footerEl) {
        // Fallback for older messages
        footerEl = document.createElement('div');
        footerEl.className = 'message-footer';
        messageEl.appendChild(footerEl);
    }

    const feedbackContainer = document.createElement('div');
    feedbackContainer.className = 'message-feedback';
    
    // Thumbs Up
    const upBtn = document.createElement('button');
    upBtn.className = 'feedback-btn';
    upBtn.setAttribute('aria-label', 'Helpful');
    upBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>`;
    
    // Thumbs Down
    const downBtn = document.createElement('button');
    downBtn.className = 'feedback-btn';
    downBtn.setAttribute('aria-label', 'Not helpful');
    downBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>`;

    // Click Handlers (Simple Toggle)
    const toggleFeedback = (btn: HTMLElement, otherBtn: HTMLElement) => {
      if (btn.classList.contains('selected')) {
        btn.classList.remove('selected');
      } else {
        btn.classList.add('selected');
        otherBtn.classList.remove('selected');
        // Keep container visible logic can be handled via 'active' class on container if needed
        feedbackContainer.classList.add('active'); 
      }
    };

    upBtn.addEventListener('click', () => toggleFeedback(upBtn, downBtn));
    downBtn.addEventListener('click', () => toggleFeedback(downBtn, upBtn));

    feedbackContainer.appendChild(upBtn);
    feedbackContainer.appendChild(downBtn);
    
    // Append to footer (guaranteed to exist after fallback creation above)
    footerEl.appendChild(feedbackContainer);
  }

  private scrollToBottom(): void {
    // Scroll after content has rendered - multiple attempts with increasing delays
    const doScroll = () => {
      if (this.chatMessages) {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      }
    };
    
    // Multiple delayed attempts to catch late renders
    setTimeout(doScroll, 50);
    setTimeout(doScroll, 200);
    setTimeout(doScroll, 500);
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
      await this.socketService.connect();
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
   * Manually reconnect to the server
   */
  async reconnect(): Promise<void> {
    return this.socketService.reconnect();
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.socketService.dispose();
    this.audioInput.dispose();
    this.audioOutput.dispose();
    this.blendshapeBuffer.dispose();
    this.syncPlayback.dispose();
  }
}
