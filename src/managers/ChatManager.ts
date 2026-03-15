// Chat Manager - Orchestrates all services (Refactored)
// Uses extracted modules: SubtitleController, TranscriptManager, VoiceInputController

import { AvatarProtocolClient } from '../services/AvatarProtocolClient';
import html2canvas from 'html2canvas';
import { SocketService } from '../services/SocketService';
import type {
  AudioStartEvent,
  SyncFrameEvent,
  AudioEndEvent,
  TranscriptDeltaEvent,
  TranscriptDoneEvent,
  InterruptEvent,
  TriggerActionEvent,
  RichContentItem,
  ServerEventMessage,
  ConfigEvent,
  AttachmentData
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
  /** Arbitrary context data sent to the AI upon connection */
  clientContext?: Record<string, any>;
  /** Whether to render rich content internally (default: true) */
  handleRichContentLocally?: boolean;
  /** Callback when any rich content is received (whether local or not) */
  onRichContentReceived?: (item: RichContentItem) => void | Promise<void>;
  /** Debug mode */
  debug?: boolean;
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

  // Extensibility Registries
  private richRenderers = new Map<string, (payload: Record<string, any>, container: HTMLElement) => void>();
  private serverEventHandlers = new Map<string, (event: ServerEventMessage) => void>();

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
  private useSyncPlayback = true;
  private playbackEnded = false;
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
  private uploadBtn: HTMLButtonElement;
  private fileUpload: HTMLInputElement;
  private attachmentContainer: HTMLElement;
  private typingIndicator: HTMLElement | null = null;
  private typingStartTime: number = 0;

  // Pending attachments for the next message
  private pendingAttachments: File[] = [];

  // Animation state
  private animationFrameId: number | null = null;
  private autoScrollObserver: MutationObserver | null = null;

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

    // Register default rich content renderers
    this.registerRichRenderer('link_card', null, (payload, container) => {
      container.innerHTML = `
        <div class="nyx-rich-link-card" style="display:flex; gap:12px; align-items:center; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-top:8px; background:white; font-family:sans-serif; cursor:pointer; transition:transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 6px -1px rgba(0, 0, 0, 0.1)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" onclick="window.open('${payload.url}', '_blank')">
          ${payload.thumbnail ? `<div style="flex-shrink:0; width:60px; height:60px; border-radius:6px; overflow:hidden;"><img src="${payload.thumbnail}" style="width:100%; height:100%; object-fit:cover;" /></div>` : ''}
          <div style="flex:1;">
            <strong style="display:block; font-size:14px; margin-bottom:4px; color:#1e293b;">${payload.title || 'Link'}</strong>
            <div style="font-size:12px; color:#64748b; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${payload.description || ''}</div>
          </div>
        </div>
      `;
    });



    // Get UI elements with proper null checks
    const root = options.shadowRoot || document;

    const chatMessagesEl = options.chatMessages || root.getElementById('chatMessages');
    const chatInputEl = options.chatInput || root.getElementById('chatInput');
    const micBtnEl = options.micBtn || root.getElementById('micBtn');
    const uploadBtnEl = root.getElementById('uploadBtn');
    const fileUploadEl = root.getElementById('fileUpload');
    const attachmentContainerEl = root.getElementById('attachmentContainer');

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
    this.uploadBtn = uploadBtnEl as HTMLButtonElement;
    this.fileUpload = fileUploadEl as HTMLInputElement;
    this.attachmentContainer = attachmentContainerEl as HTMLElement;
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
      onRecordingStart: () => this.avatar.setChatState('Idle'),
      onError: options.onError
    });

    // Setup callbacks
    this.setupSyncPlaybackCallbacks();
    this.setupAutoScroll();
    this.setupEventListeners();
    this.setupAttachmentHandling();
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

  async sendText(text: string): Promise<void> {
    const hasAttachments = this.pendingAttachments.length > 0;
    if (!text.trim() && !hasAttachments) return;

    this.options.onSubtitleUpdate?.(text || 'Sent an attachment', 'user');
    this.transcriptManager.addMessage(text || 'Sent an attachment', 'user');

    const message: OutgoingTextMessage = {
      type: 'text',
      data: text,
      userId: this.userId,
      timestamp: Date.now(),
    };

    if (hasAttachments) {
      message.attachments = await Promise.all(
        this.pendingAttachments.map(async (file) => ({
          filename: file.name,
          mime_type: file.type,
          content: await this.fileToBase64(file),
        }))
      );
      this.clearAttachments();
    }

    this.socketService.send(message);
    this.chatInput.value = '';
  }

  /**
   * Send a background client event to the server.
   */
  public sendClientEvent(
    name: string,
    data?: Record<string, any>,
    directive: 'context' | 'speak' | 'trigger' = 'context',
    request_id?: string,
    attachments?: AttachmentData[]
  ): void {
    this.protocolClient.sendClientEvent(name, data, directive, request_id, attachments);
  }

  /**
   * Send a background client event and await a server response.
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
    return this.protocolClient.sendEventAsync(name, data, options);
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
      log.info('SyncPlayback ended - setting playbackEnded flag.');
      this.playbackEnded = true;
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

  private setupAttachmentHandling(): void {
    if (!this.uploadBtn || !this.fileUpload || !this.attachmentContainer) return;

    // Trigger file dialog
    this.uploadBtn.addEventListener('click', () => {
      this.fileUpload.click();
    });

    // Handle file selection
    this.fileUpload.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        // Append new files to existing ones (max 5)
        const newFiles = Array.from(target.files);
        this.pendingAttachments = [...this.pendingAttachments, ...newFiles].slice(0, 5);
        this.renderAttachmentPreviews();
      }
      // Reset input so the same file can be selected again if removed
      target.value = '';
    });
  }

  private setupProtocolHandlers(): void {
    this.protocolClient.on('connected', () => {
      log.debug('Protocol Client connected');
      this.options.onConnectionChange?.(true);

      // Fire the initialization context to the server if provided
      if (this.options.clientContext) {
        log.info('Sending client_init_config with clientContext to server');
        this.sendClientEvent('client_init_config', this.options.clientContext, 'context');
      }
    });

    this.protocolClient.on('disconnected', () => {
      log.info('Protocol Client disconnected');
      this.options.onConnectionChange?.(false);
    });

    this.protocolClient.on('config', (event: { audio?: { inputSampleRate?: number; outputSampleRate?: number } }) => {
      if (event.audio?.outputSampleRate) {
        const rate = event.audio.outputSampleRate;
        log.info(`Server configured output sample rate: ${rate}Hz`);
        this.audioOutput.setDefaultSampleRate(rate);
        this.syncPlayback.setDefaultSampleRate(rate);
      }
    });

    this.protocolClient.on('avatar_state', (event: { state: string }) => {
      log.info('Avatar state event:', event);
      const stateMap: Record<string, 'Idle' | 'Responding'> = {
        'Idle': 'Idle',
        'Listening': 'Idle',
        'Thinking': 'Responding',
        'Processing': 'Responding',
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

    this.protocolClient.on('trigger_action', async (event: TriggerActionEvent) => {
      await this.triggerAction(event);
    });

    this.protocolClient.on('server_event', (event: ServerEventMessage) => {
      this.handleServerEvent(event);
    });

    this.protocolClient.on('error', (err) => log.error('Protocol Error:', err));
  }

  // ============================================================================
  // Protocol Handlers
  // ============================================================================

  /**
   * Manually trigger a client-side action (used by server messages or local debug calls)
   */
  public async triggerAction(nameOrEvent: string | TriggerActionEvent, args?: Record<string, any>): Promise<void> {
    const event: TriggerActionEvent = typeof nameOrEvent === 'string'
      ? { type: 'trigger_action', function_name: nameOrEvent, arguments: args || {} }
      : nameOrEvent;

    log.info(`🎯 Action Triggered: ${event.function_name}`, event.arguments);

    // Intercept native visual context requests
    if (event.function_name === 'request_screen_context') {
      this.captureAndSendScreenContext();
      return;
    }

    // Intercept rich content pushes from AI tool calls
    if (event.function_name === 'send_rich_content') {
      const args = event.arguments;
      try {
        const payload = typeof args.payload_json === 'string'
          ? JSON.parse(args.payload_json)
          : args.payload_json;

        const richItem: RichContentItem = {
          type: args.content_type || 'unspecified',
          item_id: args.item_id,
          action: args.action || 'replace',
          payload: payload
        };

        log.info(`[RICH] Tool call received: ${richItem.type}`);

        // Notify callback (always)
        if (this.options.onRichContentReceived) {
          const result = this.options.onRichContentReceived(richItem);
          if (result instanceof Promise) {
            await result;
          }
        }

        // If local handling is ENABLED, we render and stop here (intercept)
        // This prevents nyxAction from firing if the site already has a local renderer
        if (this.options.handleRichContentLocally !== false) {
          this.renderRichContent([richItem]);
          return;
        }

        // If local handling is DISABLED, we proceed to fire nyxAction
        // The host site should handle it via the nyxAction event.
      } catch (err) {
        log.error('Failed to parse rich_content payload from tool call:', err);
      }
    }

    const customEvent = new CustomEvent('nyxAction', { detail: event });
    window.dispatchEvent(customEvent);
  }

  /**
   * Captures the current DOM visually and sends it silently to the AI as context.
   */
  private async captureAndSendScreenContext(): Promise<void> {
    try {
      log.info('Capturing screen context via html2canvas...');

      // Optional: Flash a brief, non-intrusive toast notification (Hackathon Privacy Requirement)
      this.showToastNotification('Nyx is analyzing your screen...');

      // Capture the body (or a specific container)
      const canvas = await html2canvas(document.body, {
        ignoreElements: (element) => {
          // Ignore the chat widget itself to avoid infinite loops or mirroring
          if (element.id === 'myned-widget-root' || element.tagName.toLowerCase() === 'avatar-chat-widget') {
            return true;
          }
          // Ignore the demo sidebar because it contains debug controls that confuse the AI
          if (element.classList.contains('sidebar')) {
            return true;
          }
          // Mask password inputs or explicitly private elements
          if (element instanceof HTMLInputElement && element.type === 'password') {
            return true;
          }
          if (element.hasAttribute('data-private')) {
            return true;
          }
          return false;
        },
        logging: false,
        useCORS: true, // Required if capturing external images
        scale: 2 // Double the resolution to improve text recognition (DPI) for AI vision
      });

      // Convert to Base64 JPEG
      const base64Data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];

      if (!base64Data) {
        throw new Error('Canvas conversion yielded empty data');
      }

      log.info('Screen context captured, sending to server...');

      // Extract high-level DOM text context as a fallback/aid to the vision model
      // We clone the body or walk the real DOM to build a Markdown-inspired accessibility tree.
      let pageTextContent = "No text content extractable.";
      try {
        const unwantedSelectors = ['script', 'style', 'noscript', 'avatar-chat-widget', '#myned-widget-root', '.sidebar', '[data-private]'];
        
        const walkDOM = (node: Element, depth: number): string => {
          if (unwantedSelectors.some(sel => node.matches(sel))) return '';
          
          let output = '';
          const indent = '  '.repeat(depth);
          const tag = node.tagName.toLowerCase();
          
          let nodeText = '';
          for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
              const text = child.textContent?.trim();
              if (text) nodeText += text + ' ';
            }
          }
          nodeText = nodeText.trim();

          const ariaLabel = node.getAttribute('aria-label');
          const role = node.getAttribute('role');
          const textToUse = ariaLabel || nodeText;

          if (tag === 'button' || role === 'button') {
            output += `${indent}[Button: ${textToUse}]\n`;
          } else if (tag === 'a' || role === 'link') {
            const href = node.getAttribute('href') || '';
            output += `${indent}[Link: ${textToUse}](${href})\n`;
          } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            const input = node as HTMLInputElement;
            const type = input.type || tag;
            const placeholder = input.placeholder || '';
            const value = type === 'password' ? '***' : input.value;
            output += `${indent}[Input - ${type}] placeholder: "${placeholder}", value: "${value}"\n`;
          } else if (tag === 'img' || role === 'img') {
            const alt = node.getAttribute('alt') || ariaLabel || '';
            if (alt) output += `${indent}[Image: ${alt}]\n`;
          } else if (/^h[1-6]$/.test(tag)) {
            const level = parseInt(tag[1]);
            output += `${indent}${ '#'.repeat(level) } ${textToUse}\n`;
          } else if (nodeText) {
            output += `${indent}${nodeText}\n`;
          }

          for (const child of Array.from(node.children)) {
            const childOut = walkDOM(child, depth + 1);
            if (childOut) output += childOut;
          }

          return output;
        };

        const rawTree = walkDOM(document.body, 0);
        // Clean up excessive newlines and limit
        pageTextContent = rawTree.replace(/\n\s*\n/g, '\n').trim().substring(0, 10000); 
      } catch (e) {
        log.warn("Failed to extract page text context", e);
      }

      const contextData = {
        title: document.title,
        url: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        extracted_text: pageTextContent
      };

      // [DEBUG] Show the captured screenshot as a thumbnail in the chat
      if ((this.options as any).debug) {
        const debugImg = document.createElement('div');
        debugImg.className = 'nyx-debug-screenshot';
        debugImg.innerHTML = `
          <div style="margin:8px 0;padding:8px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;font-family:sans-serif;">
            <div style="font-size:11px;color:#92400e;margin-bottom:6px;font-weight:600;">🐛 Debug: Screenshot sent to AI</div>
            <img src="${canvas.toDataURL('image/jpeg', 0.6)}" style="max-width:100%;border-radius:4px;border:1px solid #e5e7eb;" />
          </div>
        `;
        this.chatMessages.appendChild(debugImg);
        this.scrollToBottom();
      }

      const attachment: AttachmentData = {
        content: base64Data,
        mime_type: 'image/jpeg',
        filename: `screenshot_${Date.now()}.jpg`
      };

      // Send with 'trigger' directive so the AI actively responds with its layout analysis
      this.sendClientEvent('screen_context_provided', contextData, 'trigger', undefined, [attachment]);
    } catch (err) {
      log.error('Failed to capture or send screen context:', err);
    }
  }

  /**
   * Helper to flash a brief notification
   */
  private showToastNotification(message: string): void {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.backgroundColor = 'rgba(0,0,0,0.8)';
    toast.style.color = 'white';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '20px';
    toast.style.fontSize = '12px';
    toast.style.zIndex = '99999';
    toast.style.pointerEvents = 'none';
    toast.style.transition = 'opacity 0.3s';

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  private handleServerEvent(event: ServerEventMessage): void {
    log.info(`[SERVER_EVENT] Received ${event.name}`, event);

    // Dispatch to registered handler if it exists
    const handler = this.serverEventHandlers.get(event.name);
    if (handler) {
      handler(event);
    }

    // Default handling: if it has text, render it
    if (event.text) {
      this.transcriptManager.addMessage(event.text, 'assistant');
    }

    // Default handling: if it has rich_content, render it
    if (event.rich_content?.length) {
      log.info(`[RICH] server_event contained ${event.rich_content.length} rich items`);

      // Notify callback for each item
      if (this.options.onRichContentReceived) {
        event.rich_content.forEach(item => this.options.onRichContentReceived!(item));
      }

      // Render internally if enabled
      if (this.options.handleRichContentLocally !== false) {
        this.renderRichContent(event.rich_content);
      }
    }

    if (event.notify) {
      // Could play a sound or pulse here
      log.debug('Notification requested by server_event');
    }
  }

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

      // Inline Rich Content Rendering from TranscriptDoneEvent
      if (event.rich_content?.length) {
        log.info(`[RICH] transcript_done contained ${event.rich_content.length} rich items`);

        // Notify callback for each item
        if (this.options.onRichContentReceived) {
          event.rich_content.forEach(item => this.options.onRichContentReceived!(item));
        }

        // Render internally if enabled
        if (this.options.handleRichContentLocally !== false) {
          this.renderRichContent(event.rich_content);
        }
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

  private renderRichContent(items: RichContentItem[]): void {
    const chatContainer = this.chatMessages;
    if (!chatContainer) return;

    for (const item of items) {
      const key = item.subtype ? `${item.type}:${item.subtype}` : item.type;
      const renderer = this.richRenderers.get(key)
        ?? this.richRenderers.get(item.type);

      if (item.action === 'remove' && item.item_id) {
        const existingNode = chatContainer.querySelector(`[data-rich-id="${item.item_id}"]`);
        if (existingNode) existingNode.remove();
        continue;
      }

      const container = document.createElement('div');
      container.className = 'nyx-rich-content-item';
      if (item.item_id) {
        container.dataset.richId = item.item_id;
      }

      if (renderer) {
        try {
          renderer(item.payload, container);
        } catch (err) {
          log.error(`Rich renderer failed for ${key}:`, err);
          container.innerHTML = `<div class="error-slate">Renderer failed: ${key}</div>`;
        }
      } else {
        log.warn(`No renderer found for rich content type: ${key}, using generic card`);
        // Generic fallback: auto-render any payload as a styled card
        const p = item.payload || {};
        const title = p.name || p.title || key;
        const description = p.description || p.subtitle || '';
        const price = p.price || '';
        const emoji = p.emoji || p.icon || '';
        const url = p.url || '';

        // Collect remaining fields (excluding ones we've already used)
        const usedKeys = new Set(['name', 'title', 'description', 'subtitle', 'price', 'emoji', 'icon', 'url']);
        const extraFields: string[] = [];
        for (const [k, v] of Object.entries(p)) {
          if (usedKeys.has(k)) continue;
          if (Array.isArray(v)) {
            extraFields.push(`<div style="margin-top:6px;"><strong style="font-size:11px;text-transform:uppercase;color:#94a3b8;">${k}</strong><ul style="list-style:none;padding:0;margin:4px 0 0;">${v.map((item: any) => `<li style="padding:2px 0;font-size:12px;color:#475569;">✓ ${item}</li>`).join('')}</ul></div>`);
          } else if (typeof v === 'string' || typeof v === 'number') {
            extraFields.push(`<div style="font-size:12px;color:#64748b;margin-top:2px;"><span style="color:#94a3b8;">${k}:</span> ${v}</div>`);
          }
        }

        const clickAttr = url ? `cursor:pointer;" onclick="window.open('${url}', '_blank')` : '';
        container.innerHTML = `
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-top:8px;background:white;font-family:sans-serif;transition:transform 0.2s,box-shadow 0.2s;${clickAttr}" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 6px -1px rgba(0,0,0,0.1)';" onmouseout="this.style.transform='none';this.style.boxShadow='none';">
            ${emoji ? `<div style="font-size:24px;margin-bottom:6px;">${emoji}</div>` : ''}
            <strong style="display:block;font-size:14px;color:#1e293b;margin-bottom:2px;">${title}</strong>
            ${price ? `<div style="font-size:18px;font-weight:700;color:#6366f1;margin-bottom:4px;">${price}</div>` : ''}
            ${description ? `<div style="font-size:12px;color:#64748b;margin-bottom:4px;">${description}</div>` : ''}
            ${extraFields.join('')}
          </div>
        `;
      }

      if (item.action === 'replace' && item.item_id) {
        const existingNode = chatContainer.querySelector(`[data-rich-id="${item.item_id}"]`);
        if (existingNode) {
          existingNode.replaceWith(container);
        } else {
          chatContainer.appendChild(container);
        }
      } else {
        chatContainer.appendChild(container);
      }
    }

    // Auto-scroll logic handled by observer
  }

  private sendTextMessage(): void {
    const text = this.chatInput.value.trim();
    if (!text) return;

    // Mark that we rendered a user text message locally (to skip server echo)
    this.pendingUserTextMessage = true;

    log.info(`📤 TURN START [user] | Text: "${text}"`);

    this.chatInput.value = '';
    this.avatar.setChatState('Idle');
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
    this.avatar.setChatState('Idle');
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
          this.avatar.setChatState('Idle');
        }
      }

      // When playback ends and blendshapes are drained, do cleanup (but keep loop running)
      if (this.playbackEnded && this.blendshapeBuffer.isEmpty()) {
        log.info('Playback ended and buffer is empty. Cleaning up and setting state to Idle.');

        // Flush remaining transcript queue (only if not interrupted)
        if (!this.wasInterrupted) {
          while (this.transcriptQueue.length > 0) {
            const item = this.transcriptQueue.shift();
            if (item?.role === 'assistant') {
              this.transcriptManager.appendToAssistantTurn(item.text);
              this.subtitleController.markWordSpoken();
            }
          }
        } else {
          this.transcriptQueue = [];
        }

        // Show any remaining subtitle text, finalize transcript, then clear subtitles
        this.subtitleController.showRemaining();
        this.transcriptManager.finalizeAssistantTurn();

        // Clear subtitles after a brief delay so user can read the final text
        setTimeout(() => {
          this.subtitleController.clear();
        }, 1500);

        this.avatar.setChatState('Idle');
        this.resetPlaybackState();
      }

      this.animationFrameId = requestAnimationFrame(sync);
    };
    sync();
  }

  private resetPlaybackState(): void {
    this.playbackEnded = false;
    this.interruptCutoffMs = null;
    this.currentTurnId = null;
    this.audioStartReceived = false;
    this.avatar.disableLiveBlendshapes();
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

  /**
   * Register a custom renderer for rich content items
   */
  public registerRichRenderer(
    type: string,
    subtype: string | null,
    renderer: (payload: Record<string, any>, container: HTMLElement) => void
  ): void {
    const key = subtype ? `${type}:${subtype}` : type;
    log.info(`Registered rich renderer for: ${key}`);
    this.richRenderers.set(key, renderer);
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

  private renderAttachmentPreviews(): void {
    if (!this.attachmentContainer) return;

    this.attachmentContainer.innerHTML = '';
    this.pendingAttachments.forEach((file, index) => {
      const preview = document.createElement('div');
      preview.className = 'attachment-preview';

      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        preview.appendChild(img);
      } else {
        // Generic document icon for non-images
        preview.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        `;
      }

      const removeBtn = document.createElement('div');
      removeBtn.className = 'attachment-remove';
      removeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      removeBtn.onclick = () => {
        this.pendingAttachments.splice(index, 1);
        this.renderAttachmentPreviews();
      };

      preview.appendChild(removeBtn);
      this.attachmentContainer.appendChild(preview);
    });
  }

  private clearAttachments(): void {
    this.pendingAttachments = [];
    if (this.attachmentContainer) {
      this.attachmentContainer.innerHTML = '';
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data:mime/type;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
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
