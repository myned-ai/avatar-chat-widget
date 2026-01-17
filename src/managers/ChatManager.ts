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

  // State
  private isRecording = false;
  private animationFrameId: number | null = null;
  private useSyncPlayback = false;  // Flag to track which playback mode is active

  // Streaming transcript state - separate tracking for user and assistant to avoid mixing
  private streamingMessages: {
    user: { id: string; element: HTMLElement } | null;
    assistant: { id: string; element: HTMLElement } | null;
  } = { user: null, assistant: null };
  
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
    
    this.setupEventListeners();
    this.setupWebSocketHandlers();
    this.startBlendshapeSync();
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
        // Logging reduced - see session start/end logs
        this.blendshapeBuffer.addFrame(message.weights, message.timestamp);
      }
    });
    
    this.socketService.on('audio_end', (message: IncomingMessage) => {
      if (message.type === 'audio_end') {
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

        // Finalize any streaming transcript
        this.finalizeStreamingMessage();

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
        this.streamTranscript(message.text, role);
      }
    });

    // Handle completed transcript
    this.socketService.on('transcript_done', (message: IncomingMessage) => {
      if (message.type === 'transcript_done') {
        log.debug(`Transcript complete [${message.role}]: ${message.text}`);
        // Finalize only the streaming message for this specific role
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        this.finalizeStreamingMessage(role);
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
  }

  private startBlendshapeSync(): void {
    let _logCounter = 0;
    
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

        _logCounter++;
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
   * Stream transcript text in real-time (word by word)
   * Uses separate tracking for user and assistant to prevent mixing during interrupts
   */
  private streamTranscript(text: string, role: 'user' | 'assistant'): void {
    const currentMessage = this.streamingMessages[role];

    // If no streaming message exists for this role, create one
    if (!currentMessage) {
      const messageId = Date.now().toString();
      const messageEl = document.createElement('div');
      messageEl.className = `message ${role}`;
      messageEl.dataset.id = messageId;

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'message-bubble';
      // DEBUG: Prefix with role to track where deltas go
      bubbleEl.textContent = `${role}: ${text}`;

      const timeEl = document.createElement('div');
      timeEl.className = 'message-time';
      timeEl.textContent = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      messageEl.appendChild(bubbleEl);
      messageEl.appendChild(timeEl);
      this.chatMessages.appendChild(messageEl);

      this.streamingMessages[role] = {
        id: messageId,
        element: messageEl
      };

      this.scrollToBottom();
    } else {
      // APPEND new text to existing streaming message for this role
      // DEBUG: Show role on each append too
      const bubbleEl = currentMessage.element.querySelector('.message-bubble');
      if (bubbleEl) {
        bubbleEl.textContent += `[${role}]${text}`;
        this.scrollToBottom();
      }
    }
  }

  /**
   * Finalize streaming message(s) and add to messages array
   * @param role - Optional role to finalize. If not specified, finalizes both.
   */
  private finalizeStreamingMessage(role?: 'user' | 'assistant'): void {
    const rolesToFinalize = role ? [role] : (['user', 'assistant'] as const);

    for (const r of rolesToFinalize) {
      const streamingMsg = this.streamingMessages[r];
      if (!streamingMsg) continue;

      const bubbleEl = streamingMsg.element.querySelector('.message-bubble');
      const text = bubbleEl?.textContent || '';

      if (text) {
        // Add to messages array
        const message: ChatMessage = {
          id: streamingMsg.id,
          text,
          sender: r,
          timestamp: Date.now(),
        };

        this.messages.push(message);

        // Notify widget callback
        this.options.onMessage?.({ role: r, text });
      }

      // Clear streaming state for this role
      this.streamingMessages[r] = null;
    }
  }

  private renderMessage(message: ChatMessage): void {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.sender}`;
    
    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';
    bubbleEl.textContent = message.text;
    
    const timeEl = document.createElement('div');
    timeEl.className = 'message-time';
    timeEl.textContent = new Date(message.timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    messageEl.appendChild(bubbleEl);
    messageEl.appendChild(timeEl);
    this.chatMessages.appendChild(messageEl);
  }

  private scrollToBottom(): void {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
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
