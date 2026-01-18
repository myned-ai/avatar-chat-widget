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

import { setConfig, type AppConfig } from './config';
import { LazyAvatar } from './avatar/LazyAvatar';
import { ChatManager } from './managers/ChatManager';
import { logger, LogLevel } from './utils/Logger';
import { WIDGET_STYLES } from './widget/styles';
import { WIDGET_TEMPLATE, BUBBLE_TEMPLATE } from './widget/templates';

const log = logger.scope('Widget');

// ============================================================================
// Re-export types from widget/types.ts
// ============================================================================
export type { AvatarChatConfig, AvatarChatInstance } from './widget/types';

// ============================================================================
// Default Configuration
// ============================================================================

import { DEFAULT_CONFIG as BASE_DEFAULT_CONFIG, AvatarChatConfig, AvatarChatInstance } from './widget/types';

const DEFAULT_CONFIG: Partial<AvatarChatConfig> = {
  ...BASE_DEFAULT_CONFIG,
  avatarUrl: './asset/nyx.zip', // Override for local dev compatibility
};

// ============================================================================
// Shadow DOM Styles (CSS Isolation)
// ============================================================================


// ============================================================================
// Widget HTML Templates
// ============================================================================



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
  private themeMediaQuery: MediaQueryList | null = null;
  private themeChangeHandler: ((e: MediaQueryListEvent) => void) | null = null;

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
    } as Partial<AppConfig>);
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
    this.style.maxHeight = `${this.config.height}px`;

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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Template always has root element
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
      const inputSection = this.shadow.querySelector('.chat-input-area');
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Template always has bubble element
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

    // Create render container with proper class for CSS styling
    const renderContainer = document.createElement('div');
    renderContainer.className = 'avatar-render-container';
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
    const minimizeBtn = this.shadow.getElementById('minimizeBtn');
    minimizeBtn?.addEventListener('click', () => this.collapse());

    // Auto-theme listener with proper cleanup
    if (this.config.theme === 'auto') {
      this.themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.themeChangeHandler = (e) => {
        const root = this.shadow.querySelector('.widget-root');
        root?.classList.toggle('theme-dark', e.matches);
      };
      this.themeMediaQuery.addEventListener('change', this.themeChangeHandler);
    }
  }

  /**
   * Update connection status (stub - connection indicator removed from UI)
   */
  private updateConnectionStatus(_connected: boolean, _state?: 'error'): void {
    // Connection status indicator removed from UI for cleaner design
    // Connection state is still tracked internally and passed to callbacks
  }

  /**
   * Collapse to bubble
   */
  collapse(): void {
    if (this._isCollapsed) return;

    // Stop audio and reset avatar state before collapsing
    if (this.chatManager) {
      this.chatManager.resetOnMinimize();
    }

    this._isCollapsed = true;
    this.classList.add('collapsed');

    // Hide the widget root but don't destroy it
    const widgetRoot = this.shadow.querySelector('.widget-root') as HTMLElement;
    if (widgetRoot) {
      widgetRoot.style.display = 'none';
    }

    // Show bubble
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
    this.style.maxHeight = `${this.config.height}px`;

    // Check if widget is already initialized
    const widgetRoot = this.shadow.querySelector('.widget-root') as HTMLElement;
    if (widgetRoot) {
      // Widget exists, just show it and remove bubble
      const bubble = this.shadow.querySelector('.chat-bubble');
      if (bubble) bubble.remove();
      widgetRoot.style.display = 'flex';

      // Reconnect to server and resume avatar
      if (this.chatManager) {
        await this.chatManager.reconnectOnExpand();
      }
    } else {
      // First time expanding, render everything
      await this.renderWidget();
    }
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
   * Manually reconnect to the server
   * Useful after network changes or connection failures
   */
  async reconnect(): Promise<void> {
    if (!this.chatManager) {
      throw new Error('Widget not initialized');
    }
    return this.chatManager.reconnect();
  }

  /**
   * Web Component lifecycle: Called when element is removed from DOM
   * Ensures cleanup happens even if element is removed externally (not via destroy())
   */
  disconnectedCallback(): void {
    // Only cleanup if we were mounted and haven't already been destroyed
    // This prevents double-cleanup if destroy() was called first (which calls this.remove())
    if (this._isMounted) {
      log.info('Widget removed from DOM - cleaning up resources');
      this.cleanup();
    }
  }

  /**
   * Internal cleanup logic (shared by destroy() and disconnectedCallback())
   */
  private cleanup(): void {
    // Remove theme listener to prevent memory leak
    if (this.themeMediaQuery && this.themeChangeHandler) {
      this.themeMediaQuery.removeEventListener('change', this.themeChangeHandler);
      this.themeMediaQuery = null;
      this.themeChangeHandler = null;
    }

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

    this._isMounted = false;
    this._isConnected = false;
  }

  /**
   * Cleanup and remove from DOM
   */
  destroy(): void {
    log.info('Destroying widget');

    this.cleanup();

    // Remove from DOM (this will trigger disconnectedCallback, but cleanup() will be skipped
    // since _isMounted is already false)
    this.remove();
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
   * Get the URL for the default included avatar
   * Auto-detects CDN usage and returns the appropriate URL
   */
  getDefaultAvatarUrl(): string {
    // Check if loaded from CDN by scanning script tags
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src;
      if (src.includes('jsdelivr.net') && src.includes('avatar-chat-widget')) {
        const baseUrl = src.substring(0, src.lastIndexOf('/'));
        return `${baseUrl}/avatar-chat-widget/public/asset/nyx.zip`;
      }
      if (src.includes('unpkg.com') && src.includes('avatar-chat-widget')) {
        const baseUrl = src.substring(0, src.lastIndexOf('/'));
        return `${baseUrl}/avatar-chat-widget/public/asset/nyx.zip`;
      }
    }
    // Fallback for npm usage or local development
    return '/asset/nyx.zip';
  },

  /**
   * Initialize and mount the widget
   */
  init(config: AvatarChatConfig): AvatarChatInstance {
    // Validate required config
    if (!config.serverUrl) {
      throw new Error('AvatarChat.init(): serverUrl is required');
    }

    // Validate serverUrl format
    if (!config.serverUrl.match(/^wss?:\/\/.+/)) {
      throw new Error('AvatarChat.init(): serverUrl must be a valid WebSocket URL (ws:// or wss://)');
    }

    if (!config.container) {
      throw new Error('AvatarChat.init(): container is required');
    }

    // Validate container is a valid DOM element or selector
    const containerElement = typeof config.container === 'string'
      ? document.querySelector(config.container)
      : config.container;

    if (!containerElement) {
      throw new Error(`AvatarChat.init(): container not found: ${config.container}`);
    }

    // Validate dimensions if provided
    if (config.width !== undefined) {
      if (typeof config.width !== 'number' || config.width < 200 || config.width > 2000) {
        throw new Error('AvatarChat.init(): width must be a number between 200 and 2000 pixels');
      }
    }

    if (config.height !== undefined) {
      if (typeof config.height !== 'number' || config.height < 300 || config.height > 2000) {
        throw new Error('AvatarChat.init(): height must be a number between 300 and 2000 pixels');
      }
    }

    // Validate callbacks if provided
    if (config.onReady !== undefined && typeof config.onReady !== 'function') {
      throw new Error('AvatarChat.init(): onReady must be a function');
    }

    if (config.onMessage !== undefined && typeof config.onMessage !== 'function') {
      throw new Error('AvatarChat.init(): onMessage must be a function');
    }

    if (config.onError !== undefined && typeof config.onError !== 'function') {
      throw new Error('AvatarChat.init(): onError must be a function');
    }

    // Validate logLevel if provided
    if (config.logLevel !== undefined) {
      const validLogLevels = ['none', 'error', 'warn', 'info', 'debug'];
      if (!validLogLevels.includes(config.logLevel)) {
        throw new Error(`AvatarChat.init(): logLevel must be one of: ${validLogLevels.join(', ')}`);
      }
    }

    // Validate theme if provided
    if (config.theme !== undefined) {
      const validThemes = ['light', 'dark', 'auto'];
      if (!validThemes.includes(config.theme)) {
        throw new Error(`AvatarChat.init(): theme must be one of: ${validThemes.join(', ')}`);
      }
    }

    // Validate position if provided
    if (config.position !== undefined) {
      const validPositions = ['inline', 'bottom-right', 'bottom-left', 'top-right', 'top-left'];
      if (!validPositions.includes(config.position)) {
        throw new Error(`AvatarChat.init(): position must be one of: ${validPositions.join(', ')}`);
      }
    }

    // Auto-detect assets base URL if not provided
    if (config.assetsBaseUrl) {
      setConfig({ assets: { baseUrl: config.assetsBaseUrl, defaultAvatarPath: '/asset/nyx.zip' } });
    } else {
      // Auto-detect from script tag
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (src.includes('jsdelivr.net') && src.includes('avatar-chat-widget')) {
          const baseUrl = src.substring(0, src.lastIndexOf('/'));
          setConfig({ assets: { baseUrl: `${baseUrl}/public`, defaultAvatarPath: '/asset/nyx.zip' } });
          break;
        }
        if (src.includes('unpkg.com') && src.includes('avatar-chat-widget')) {
          const baseUrl = src.substring(0, src.lastIndexOf('/'));
          setConfig({ assets: { baseUrl: `${baseUrl}/public`, defaultAvatarPath: '/asset/nyx.zip' } });
          break;
        }
      }
    }

    // Use default avatar if not specified
    if (!config.avatarUrl) {
      config.avatarUrl = this.getDefaultAvatarUrl();
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
      reconnect: () => widget.reconnect(),
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
      reconnect: () => widget.reconnect(),
    };
  },
};

// Expose globally for script tag usage
if (typeof window !== 'undefined') {
  (window as { AvatarChat?: typeof AvatarChat }).AvatarChat = AvatarChat;
}

export default AvatarChat;
