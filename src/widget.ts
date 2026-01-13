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
   * Update connection status (stub - connection indicator removed from UI)
   */
  private updateConnectionStatus(connected: boolean, state?: 'error'): void {
    // Connection status indicator removed from UI for cleaner design
    // Connection state is still tracked internally and passed to callbacks
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
        return `${baseUrl}/public/asset/nyx.zip`;
      }
      if (src.includes('unpkg.com') && src.includes('avatar-chat-widget')) {
        const baseUrl = src.substring(0, src.lastIndexOf('/'));
        return `${baseUrl}/public/asset/nyx.zip`;
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
    if (!config.container) {
      throw new Error('AvatarChat.init(): container is required');
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
