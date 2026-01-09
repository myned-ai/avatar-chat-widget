/**
 * Avatar Chat Widget - Embeddable Web Component
 * 
 * A real-time voice/text chat widget with 3D avatar animation.
 * Uses Shadow DOM for complete CSS isolation from host page.
 * 
 * @example Script Tag (Wix, WordPress, HTML)
 * ```html
 * <div id="avatar-chat"></div>
 * <script src="https://cdn.jsdelivr.net/npm/@myned-ai/avatar-chat-widget"></script>
 * <script>
 *   AvatarChat.init({
 *     container: '#avatar-chat',
 *     serverUrl: 'wss://your-server.com/ws'
 *   });
 * </script>
 * ```
 * 
 * @example NPM Package
 * ```typescript
 * import { AvatarChat } from 'avatar-chat-widget';
 * const widget = AvatarChat.init({ container: '#chat', serverUrl: 'wss://...' });
 * ```
 */

import { setConfig } from './config';
import { LazyAvatar } from './avatar/LazyAvatar';
import { ChatManager } from './managers/ChatManager';
import { logger, LogLevel } from './utils/Logger';

const log = logger.scope('Widget');

// ============================================================================
// Types
// ============================================================================

/**
 * Widget configuration options passed at runtime
 */
export interface AvatarChatConfig {
  /** CSS selector or HTMLElement for the widget container (required) */
  container: string | HTMLElement;
  
  /** WebSocket server URL (required) */
  serverUrl: string;
  
  /** Widget position when using floating mode */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'inline';
  
  /** UI theme */
  theme?: 'light' | 'dark' | 'auto';
  
  /** Start in collapsed state (bubble only) */
  startCollapsed?: boolean;
  
  /** Widget width in pixels (default: 380) */
  width?: number;
  
  /** Widget height in pixels (default: 550) */
  height?: number;
  
  /** Enable/disable voice input (default: true) */
  enableVoice?: boolean;
  
  /** Enable/disable text input (default: true) */
  enableText?: boolean;
  
  /** Path to avatar model (default: './asset/nyx.zip') */
  avatarUrl?: string;
  
  /** Enable authentication (default: false) */
  authEnabled?: boolean;
  
  /** Log level for debugging */
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  
  /** Custom CSS to inject (optional) */
  customStyles?: string;
  
  /** Callback when widget is ready */
  onReady?: () => void;
  
  /** Callback when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
  
  /** Callback when a message is received */
  onMessage?: (message: { role: 'user' | 'assistant'; text: string }) => void;
  
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Widget instance returned by init()
 */
export interface AvatarChatInstance {
  /** Send a text message */
  sendMessage(text: string): void;
  /** Mount widget to DOM (called automatically by init) */
  mount(): void;
  /** Destroy and cleanup widget */
  destroy(): void;
  /** Show the widget */
  show(): void;
  /** Hide the widget */
  hide(): void;
  /** Expand from collapsed state */
  expand(): void;
  /** Collapse to bubble */
  collapse(): void;
  /** Check if widget is mounted */
  isMounted(): boolean;
  /** Check if connected to server */
  isConnected(): boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Partial<AvatarChatConfig> = {
  position: 'bottom-right',
  theme: 'light',
  startCollapsed: true,
  width: 380,
  height: 550,
  enableVoice: true,
  enableText: true,
  avatarUrl: './asset/nyx.zip',
  authEnabled: true,
  logLevel: 'error',
};

// ============================================================================
// Shadow DOM Styles (CSS Isolation)
// ============================================================================

const WIDGET_STYLES = `
/* Reset all inherited styles */
:host {
  all: initial;
  display: block;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #333;
  box-sizing: border-box;
}

:host *, :host *::before, :host *::after {
  box-sizing: inherit;
}

/* Position variants */
:host(.position-bottom-right) { position: fixed; bottom: 20px; right: 20px; z-index: 999999; }
:host(.position-bottom-left) { position: fixed; bottom: 20px; left: 20px; z-index: 999999; }
:host(.position-top-right) { position: fixed; top: 20px; right: 20px; z-index: 999999; }
:host(.position-top-left) { position: fixed; top: 20px; left: 20px; z-index: 999999; }
:host(.position-inline) { position: relative; }
:host(.hidden) { display: none !important; }

/* Main container */
.widget-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  transition: all 0.3s ease;
}

.widget-root.theme-dark {
  background: #1a1a2e;
  color: #e0e0e0;
}

/* Collapsed bubble state */
:host(.collapsed) {
  width: 64px !important;
  height: 64px !important;
}

.chat-bubble {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
  transition: transform 0.2s, box-shadow 0.2s;
}

.chat-bubble:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.chat-bubble svg {
  width: 28px;
  height: 28px;
  fill: white;
}

/* Avatar section */
.avatar-section {
  position: relative;
  flex: 0 0 auto;
  height: 180px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  overflow: hidden;
}

.theme-dark .avatar-section {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}

.avatar-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.avatar-render-container {
  width: 400px;
  height: 400px;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.45);
  transform-origin: center;
  /* OPTIMIZATION: Hint browser to optimize for transform animations */
  will-change: transform;
}

/* Header */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.95);
  border-bottom: 1px solid #eee;
}

.theme-dark .chat-header {
  background: rgba(26, 26, 46, 0.95);
  border-bottom-color: #333;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #666;
}

.theme-dark .status-indicator { color: #aaa; }

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ccc;
  transition: background 0.3s;
}

.status-dot.connected { background: #4caf50; }
.status-dot.connecting { background: #ff9800; animation: pulse 1s infinite; }
.status-dot.error { background: #f44336; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  color: #666;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover { background: rgba(0, 0, 0, 0.05); }
.theme-dark .icon-btn { color: #aaa; }
.theme-dark .icon-btn:hover { background: rgba(255, 255, 255, 0.1); }

/* Messages */
.messages-section {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.message {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 16px;
  word-wrap: break-word;
  font-size: 14px;
  line-height: 1.4;
}

.message.user {
  align-self: flex-end;
  background: #007bff;
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant {
  align-self: flex-start;
  background: #f0f0f0;
  color: #333;
  border-bottom-left-radius: 4px;
}

.theme-dark .message.assistant {
  background: #2d2d44;
  color: #e0e0e0;
}

.message-time {
  font-size: 10px;
  opacity: 0.7;
  margin-top: 4px;
}

/* Input area */
.input-section {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #eee;
  background: #fafafa;
}

.theme-dark .input-section {
  background: #16213e;
  border-top-color: #333;
}

.chat-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #ddd;
  border-radius: 24px;
  outline: none;
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.chat-input:focus {
  border-color: #007bff;
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.theme-dark .chat-input {
  background: #1a1a2e;
  border-color: #444;
  color: #e0e0e0;
}

.theme-dark .chat-input:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
}

.action-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, transform 0.1s;
  flex-shrink: 0;
}

.action-btn:active { transform: scale(0.95); }

.voice-btn {
  background: #f0f0f0;
  color: #666;
}

.voice-btn:hover { background: #e0e0e0; }

.voice-btn.recording {
  background: #ff4444;
  color: white;
  animation: pulse 1s infinite;
}

.theme-dark .voice-btn {
  background: #2d2d44;
  color: #aaa;
}

.theme-dark .voice-btn:hover { background: #3d3d54; }

.send-btn {
  background: #007bff;
  color: white;
}

.send-btn:hover { background: #0056b3; }
.send-btn:disabled { background: #ccc; cursor: not-allowed; }

/* Loading states */
.loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
}

.theme-dark .loading-overlay {
  background: rgba(26, 26, 46, 0.9);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #eee;
  border-top-color: #007bff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Accessibility */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`;

// ============================================================================
// Widget HTML Templates
// ============================================================================

const WIDGET_TEMPLATE = `
<div class="widget-root">
  <div class="avatar-section">
    <div class="avatar-container">
      <div id="avatarCircle" class="avatar-render-container"></div>
    </div>
  </div>
  
  <div class="chat-header">
    <div class="status-indicator">
      <span class="status-dot connecting"></span>
      <span class="status-text">Connecting...</span>
    </div>
    <div class="header-actions">
      <button class="icon-btn minimize-btn" aria-label="Minimize">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
  </div>
  
  <div id="chatMessages" class="messages-section" role="log" aria-live="polite" aria-label="Chat messages"></div>
  
  <div class="input-section">
    <input 
      type="text" 
      id="chatInput"
      class="chat-input" 
      placeholder="Type a message..." 
      aria-label="Chat message input"
    />
    <button id="micBtn" class="action-btn voice-btn" aria-label="Voice input" aria-pressed="false">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93h2c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V20h4v2H8v-2h4v-4.07z"/>
      </svg>
    </button>
    <button id="sendBtn" class="action-btn send-btn" aria-label="Send message">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
      </svg>
    </button>
  </div>
</div>
`;

const BUBBLE_TEMPLATE = `
<div class="chat-bubble" role="button" aria-label="Open chat" tabindex="0">
  <svg viewBox="0 0 24 24">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
  </svg>
</div>
`;

// ============================================================================
// Widget Custom Element (Shadow DOM)
// ============================================================================

class AvatarChatElement extends HTMLElement {
  private shadow: ShadowRoot;
  private config!: AvatarChatConfig;
  private avatar: InstanceType<typeof LazyAvatar> | null = null;
  private chatManager: ChatManager | null = null;
  private _isMounted = false;
  private _isConnected = false;
  private _isCollapsed = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /**
   * Configure the widget (call before mount)
   */
  configure(config: AvatarChatConfig): void {
    this.config = { ...DEFAULT_CONFIG, ...config } as AvatarChatConfig;
    
    // Set log level
    const logLevels: Record<string, typeof LogLevel[keyof typeof LogLevel]> = {
      'none': LogLevel.None,
      'error': LogLevel.Error,
      'warn': LogLevel.Warning,
      'info': LogLevel.Info,
      'debug': LogLevel.Debug,
    };
    logger.setLevel(logLevels[this.config.logLevel || 'error']);
    
    // Update global config for services - only URL is needed for widget
    setConfig({
      websocket: { url: this.config.serverUrl },
    } as any);
  }

  /**
   * Mount the widget to DOM
   */
  async mount(): Promise<void> {
    if (this._isMounted) {
      log.warn('Widget already mounted');
      return;
    }

    log.info('Mounting widget');

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = WIDGET_STYLES + (this.config.customStyles || '');
    this.shadow.appendChild(styleEl);

    // Set position class
    if (this.config.position && this.config.position !== 'inline') {
      this.classList.add(`position-${this.config.position}`);
    }

    // Set dimensions
    this.style.width = `${this.config.width}px`;
    this.style.height = `${this.config.height}px`;

    // Check if starting collapsed
    if (this.config.startCollapsed) {
      this._isCollapsed = true;
      this.classList.add('collapsed');
      this.renderBubble();
    } else {
      await this.renderWidget();
    }

    this._isMounted = true;
    this.config.onReady?.();
  }

  /**
   * Render the full widget
   */
  private async renderWidget(): Promise<void> {
    // Clear shadow DOM (except styles)
    const style = this.shadow.querySelector('style');
    this.shadow.innerHTML = '';
    if (style) this.shadow.appendChild(style);

    // Add widget HTML
    const container = document.createElement('div');
    container.innerHTML = WIDGET_TEMPLATE;
    const root = container.firstElementChild!;
    
    // Apply theme
    if (this.config.theme === 'dark') {
      root.classList.add('theme-dark');
    } else if (this.config.theme === 'auto') {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('theme-dark');
      }
    }

    this.shadow.appendChild(root);

    // Setup UI event listeners
    this.setupUIEvents();

    // Hide voice button if disabled
    if (!this.config.enableVoice) {
      const voiceBtn = this.shadow.getElementById('micBtn');
      if (voiceBtn) voiceBtn.style.display = 'none';
    }

    // Hide text input if disabled
    if (!this.config.enableText) {
      const inputSection = this.shadow.querySelector('.input-section');
      if (inputSection) (inputSection as HTMLElement).style.display = 'none';
    }

    // Initialize avatar and chat
    await this.initializeAvatar();
    await this.initializeChat();
  }

  /**
   * Render collapsed bubble
   */
  private renderBubble(): void {
    const style = this.shadow.querySelector('style');
    this.shadow.innerHTML = '';
    if (style) this.shadow.appendChild(style);

    const container = document.createElement('div');
    container.innerHTML = BUBBLE_TEMPLATE;
    const bubble = container.firstElementChild!;
    
    bubble.addEventListener('click', () => this.expand());
    bubble.addEventListener('keypress', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.expand();
    });

    this.shadow.appendChild(bubble);
  }

  /**
   * Initialize avatar renderer
   */
  private async initializeAvatar(): Promise<void> {
    const avatarContainer = this.shadow.getElementById('avatarCircle');
    if (!avatarContainer) {
      log.error('Avatar container not found');
      return;
    }

    // Create render container
    const renderContainer = document.createElement('div');
    renderContainer.style.width = '400px';
    renderContainer.style.height = '400px';
    avatarContainer.appendChild(renderContainer);

    try {
      this.avatar = new LazyAvatar(
        renderContainer as HTMLDivElement,
        this.config.avatarUrl || './asset/nyx.zip',
        {
          preload: true,
          onReady: () => log.info('Avatar loaded'),
          onError: (err) => {
            log.error('Avatar load error:', err);
            this.config.onError?.(err);
          },
        }
      );
      this.avatar.start();
    } catch (error) {
      log.error('Failed to initialize avatar:', error);
      this.config.onError?.(error as Error);
    }
  }

  /**
   * Initialize chat manager
   */
  private async initializeChat(): Promise<void> {
    if (!this.avatar) {
      log.error('Avatar not initialized');
      return;
    }

    try {
      // Get shadow DOM elements for ChatManager
      const chatMessages = this.shadow.getElementById('chatMessages');
      const chatInput = this.shadow.getElementById('chatInput') as HTMLInputElement;
      const sendBtn = this.shadow.getElementById('sendBtn') as HTMLButtonElement;
      const micBtn = this.shadow.getElementById('micBtn') as HTMLButtonElement;

      if (!chatMessages || !chatInput || !sendBtn || !micBtn) {
        throw new Error('Required DOM elements not found');
      }

      // Create ChatManager with shadow DOM elements
      this.chatManager = new ChatManager(this.avatar, {
        shadowRoot: this.shadow,
        chatMessages,
        chatInput,
        sendBtn,
        micBtn,
        onConnectionChange: (connected) => {
          this._isConnected = connected;
          this.updateConnectionStatus(connected);
          this.config.onConnectionChange?.(connected);
        },
        onMessage: (msg) => {
          this.config.onMessage?.(msg);
        },
        onError: (err) => {
          this.config.onError?.(err);
        },
      });

      await this.chatManager.initialize();
      log.info('Chat initialized');

    } catch (error) {
      log.error('Failed to initialize chat:', error);
      this.updateConnectionStatus(false, 'error');
      this.config.onError?.(error as Error);
    }
  }

  /**
   * Setup UI event listeners
   */
  private setupUIEvents(): void {
    // Minimize button
    const minimizeBtn = this.shadow.querySelector('.minimize-btn');
    minimizeBtn?.addEventListener('click', () => this.collapse());

    // Auto-theme listener
    if (this.config.theme === 'auto') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const root = this.shadow.querySelector('.widget-root');
        root?.classList.toggle('theme-dark', e.matches);
      });
    }
  }

  /**
   * Update connection status UI
   */
  private updateConnectionStatus(connected: boolean, state?: 'error'): void {
    const dot = this.shadow.querySelector('.status-dot');
    const text = this.shadow.querySelector('.status-text');

    if (dot) {
      dot.classList.remove('connected', 'connecting', 'error');
      if (state === 'error') {
        dot.classList.add('error');
      } else {
        dot.classList.add(connected ? 'connected' : 'connecting');
      }
    }

    if (text) {
      if (state === 'error') {
        text.textContent = 'Connection failed';
      } else {
        text.textContent = connected ? 'Connected' : 'Connecting...';
      }
    }
  }

  /**
   * Collapse to bubble
   */
  collapse(): void {
    if (this._isCollapsed) return;
    
    this._isCollapsed = true;
    this.classList.add('collapsed');
    this.renderBubble();
  }

  /**
   * Expand from bubble
   */
  async expand(): Promise<void> {
    if (!this._isCollapsed) return;

    this._isCollapsed = false;
    this.classList.remove('collapsed');
    this.style.width = `${this.config.width}px`;
    this.style.height = `${this.config.height}px`;
    
    await this.renderWidget();
  }

  /**
   * Show widget
   */
  show(): void {
    this.classList.remove('hidden');
  }

  /**
   * Hide widget
   */
  hide(): void {
    this.classList.add('hidden');
  }

  /**
   * Send message programmatically
   */
  sendMessage(text: string): void {
    if (this.chatManager && text.trim()) {
      this.chatManager.sendText(text);
    }
  }

  /**
   * Check if mounted
   */
  isMounted(): boolean {
    return this._isMounted;
  }

  /**
   * Check if connected to server
   */
  isServerConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    log.info('Destroying widget');

    if (this.chatManager) {
      this.chatManager.dispose();
      this.chatManager = null;
    }

    if (this.avatar) {
      this.avatar.dispose();
      this.avatar = null;
    }

    // Clear shadow DOM
    this.shadow.innerHTML = '';
    
    // Remove from DOM
    this.remove();

    this._isMounted = false;
    this._isConnected = false;
  }
}

// Register custom element
if (typeof customElements !== 'undefined' && !customElements.get('avatar-chat-widget')) {
  customElements.define('avatar-chat-widget', AvatarChatElement);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * AvatarChat - Public Widget API
 */
export const AvatarChat = {
  /** Version */
  version: '__VERSION__',

  /** Active instance */
  _instance: null as AvatarChatElement | null,

  /**
   * Initialize and mount the widget
   */
  init(config: AvatarChatConfig): AvatarChatInstance {
    // Validate required config
    if (!config.serverUrl) {
      throw new Error('AvatarChat.init(): serverUrl is required');
    }
    if (!config.container) {
      throw new Error('AvatarChat.init(): container is required');
    }

    // Get container element
    const containerEl = typeof config.container === 'string'
      ? document.querySelector(config.container)
      : config.container;

    if (!containerEl) {
      throw new Error(`AvatarChat.init(): container not found: ${config.container}`);
    }

    // Destroy existing instance
    if (this._instance) {
      this._instance.destroy();
      this._instance = null;
    }

    // Create widget element
    const widget = document.createElement('avatar-chat-widget') as unknown as AvatarChatElement;
    widget.configure(config);
    containerEl.appendChild(widget as unknown as Node);

    // Mount widget
    widget.mount();

    this._instance = widget;

    // Return instance API
    return {
      sendMessage: (text) => widget.sendMessage(text),
      mount: () => widget.mount(),
      destroy: () => {
        widget.destroy();
        this._instance = null;
      },
      show: () => widget.show(),
      hide: () => widget.hide(),
      expand: () => widget.expand(),
      collapse: () => widget.collapse(),
      isMounted: () => widget.isMounted(),
      isConnected: () => widget.isServerConnected(),
    };
  },

  /**
   * Destroy current instance
   */
  destroy(): void {
    if (this._instance) {
      this._instance.destroy();
      this._instance = null;
    }
  },

  /**
   * Get current instance
   */
  getInstance(): AvatarChatInstance | null {
    if (!this._instance) return null;
    
    const widget = this._instance;
    return {
      sendMessage: (text) => widget.sendMessage(text),
      mount: () => widget.mount(),
      destroy: () => {
        widget.destroy();
        this._instance = null;
      },
      show: () => widget.show(),
      hide: () => widget.hide(),
      expand: () => widget.expand(),
      collapse: () => widget.collapse(),
      isMounted: () => widget.isMounted(),
      isConnected: () => widget.isServerConnected(),
    };
  },
};

// Expose globally for script tag usage
if (typeof window !== 'undefined') {
  (window as any).AvatarChat = AvatarChat;
}

export default AvatarChat;
