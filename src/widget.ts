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
import { DrawerController, type DrawerState } from './widget/DrawerController';

/** Timing constants for UI interactions (in milliseconds) */
const UI_DELAY = {
  /** Visual feedback delay before triggering send action */
  CHIP_CLICK_SEND: 200,
  /** Delay to allow ChatManager to process before UI cleanup */
  INPUT_CLEANUP: 50,
} as const;
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

/**
 * Detect the base URL for assets by checking script tags
 * Returns the base URL where assets should be loaded from
 */
function detectAssetsBaseUrl(): string {
  const scripts = document.getElementsByTagName('script');
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].src;
    // Check for CDN usage (jsdelivr or unpkg)
    if (src.includes('jsdelivr.net') && src.includes('avatar-chat-widget')) {
      return src.substring(0, src.lastIndexOf('/')) + '/public';
    }
    if (src.includes('unpkg.com') && src.includes('avatar-chat-widget')) {
      return src.substring(0, src.lastIndexOf('/')) + '/public';
    }
    // Check if loaded from a custom path (not CDN)
    if (src.includes('avatar-chat-widget') && !src.includes('localhost')) {
      return src.substring(0, src.lastIndexOf('/'));
    }
  }
  // Fallback for local development or npm usage
  return '';
}

const DEFAULT_CONFIG: Partial<AvatarChatConfig> = {
  ...BASE_DEFAULT_CONFIG,
  // avatarUrl will be resolved dynamically using assetsBaseUrl
  avatarUrl: undefined,
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
  private drawerController: DrawerController | null = null;
  private _isMounted = false;
  private _isConnected = false;
  private _isCollapsed = false;
  private visualViewportHandler: (() => void) | null = null;

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

    // Generate color overrides from config
    const colorOverrides = this.generateColorOverrides();

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = WIDGET_STYLES + colorOverrides + (this.config.customStyles || '');
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
    const root = container.firstElementChild;
    
    if (!root) {
      log.error('Failed to create widget root element from template');
      return;
    }

    this.shadow.appendChild(root);

    // Initialize drawer controller for sliding sheet
    this.initializeDrawer();

    // Setup UI event listeners
    this.setupUIEvents();
    
    // Setup mobile keyboard handling
    this.setupMobileKeyboardHandling();

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
    const wrapper = container.firstElementChild;
    
    if (!wrapper) {
      log.error('Failed to create bubble wrapper from template');
      return;
    }
    
    // Attach events to actual bubble element
    const bubble = wrapper.querySelector('#chatBubble');
    if (bubble) {
      bubble.addEventListener('click', () => this.expand());
      bubble.addEventListener('keypress', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') this.expand();
      });
    }

    // Tooltip logic
    const closeBtn = wrapper.querySelector('#tooltipClose');
    const tooltip = wrapper.querySelector('#bubbleTooltip');
    const tooltipTextEl = wrapper.querySelector('#tooltipText');
    
    // Set tooltip text from config
    if (tooltipTextEl && this.config.tooltipText) {
      tooltipTextEl.textContent = this.config.tooltipText;
    }
    
    if (closeBtn && tooltip) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent bubble open
        tooltip.classList.add('hidden');
      });
    }

    this.shadow.appendChild(wrapper);
  }

  /**
   * Initialize avatar renderer
   */
  private async initializeAvatar(): Promise<void> {
    const avatarContainer = this.shadow.getElementById('avatarContainer');

    if (!avatarContainer) {
      log.error('Avatar container not found');
      return;
    }

    // Create render container with proper class for CSS styling
    const renderContainer = document.createElement('div');
    renderContainer.className = 'avatar-render-container';
    avatarContainer.appendChild(renderContainer);

    // Resolve avatar URL: use config value or construct from assets base URL
    const resolvedAvatarUrl = this.resolveAvatarUrl();

    try {
      this.avatar = new LazyAvatar(
        renderContainer as HTMLDivElement,
        resolvedAvatarUrl,
        {
          preload: false, // Changed: defer loading for better Core Web Vitals
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
   * Resolve the avatar URL from config or assets base URL
   * Ensures we always have an absolute URL that works across different deployment scenarios
   */
  private resolveAvatarUrl(): string {
    // If user provided a full URL, use it directly
    if (this.config.avatarUrl) {
      const url = this.config.avatarUrl;
      // Check if it's already an absolute URL
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
        return url;
      }
      // Check if assetsBaseUrl is configured
      if (this.config.assetsBaseUrl) {
        return `${this.config.assetsBaseUrl.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
      }
      // For relative paths, try to detect base URL
      const detectedBase = detectAssetsBaseUrl();
      if (detectedBase) {
        return `${detectedBase}${url.startsWith('/') ? '' : '/'}${url}`;
      }
      // Fallback: return as-is (works for local dev)
      return url;
    }
    
    // No avatarUrl provided, use default with detected or configured base
    const baseUrl = this.config.assetsBaseUrl || detectAssetsBaseUrl();
    const defaultPath = '/asset/nyx.zip';
    
    if (baseUrl) {
      return `${baseUrl.replace(/\/$/, '')}${defaultPath}`;
    }
    
    // Final fallback for local development
    return defaultPath;
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
      const micBtn = this.shadow.getElementById('micBtn') as HTMLButtonElement;
      const avatarSubtitles = this.shadow.getElementById('avatarSubtitles') as HTMLElement;

      if (!chatMessages || !chatInput || !micBtn) {
        throw new Error('Required DOM elements not found');
      }

      // Create ChatManager with shadow DOM elements
      this.chatManager = new ChatManager(this.avatar, {
        shadowRoot: this.shadow,
        chatMessages,
        chatInput,
        micBtn,
        onConnectionChange: (connected) => {
          this._isConnected = connected;
          this.updateConnectionStatus(connected);
          this.config.onConnectionChange?.(connected);
        },
        onMessage: (msg) => {
          this.config.onMessage?.(msg);
          // If we receive a message (e.g. welcome message or response), mark has messages
          this.markHasMessages(); 
        },
        onError: (err) => {
          this.config.onError?.(err);
        },
        onSubtitleUpdate: (text, role) => {
          // User messages: show directly
          if (role === 'user' && avatarSubtitles) {
            if (text) {
              avatarSubtitles.classList.add('visible', 'user-speaking');
              avatarSubtitles.textContent = text;
            } else {
              avatarSubtitles.classList.remove('visible', 'user-speaking');
              avatarSubtitles.textContent = '';
            }
          }
          
          // Assistant messages: Simple subtitle display (no karaoke)
          if (role === 'assistant' && avatarSubtitles) {
            if (!text) {
              // Turn ended - clear subtitle
              avatarSubtitles.classList.remove('visible');
              avatarSubtitles.textContent = '';
              return;
            }
            
            avatarSubtitles.classList.add('visible');
            avatarSubtitles.classList.remove('user-speaking');
            avatarSubtitles.textContent = text;
          }
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

    // Input Interaction Logic (Voice Priority)
    const chatInput = this.shadow.getElementById('chatInput') as HTMLInputElement;
    const inputControls = this.shadow.querySelector('.chat-input-controls');
    
    if (chatInput && inputControls) {
      chatInput.addEventListener('input', () => {
        if (chatInput.value.trim().length > 0) {
          inputControls.classList.add('has-text');
        } else {
          inputControls.classList.remove('has-text');
        }
      });
      // Toggle input-focused class for mobile styles
      chatInput.addEventListener('focus', () => {
        const root = this.shadow.querySelector('.widget-root');
        if (root) root.classList.add('input-focused');
      });
      chatInput.addEventListener('blur', () => {
        // Small delay to allow click events on suggestions to fire before hiding
        setTimeout(() => {
          const root = this.shadow.querySelector('.widget-root');
          if (root) root.classList.remove('input-focused');
        }, 100);
      });
    }

    // Quick Replies Logic
    const quickReplies = this.shadow.getElementById('quickReplies');
    const avatarSuggestions = this.shadow.getElementById('avatarSuggestions');
    const micBtn = this.shadow.getElementById('micBtn');
    
    // Populate suggestion chips from config (both in chat and avatar sections)
    if (this.config.suggestions && this.config.suggestions.length > 0) {
      // Sort suggestions by length so similar-length ones appear on the same line
      const sortedSuggestions = [...this.config.suggestions].sort((a, b) => a.length - b.length);
      const chipsHtml = sortedSuggestions
        .map(text => `<button class="suggestion-chip">${this.escapeHtml(text)}</button>`)
        .join('');
      
      if (quickReplies) {
        quickReplies.innerHTML = chipsHtml;
      }
      if (avatarSuggestions) {
        avatarSuggestions.innerHTML = chipsHtml;
      }
    }
    
    if (chatInput) {
      const hideSuggestions = () => {
        quickReplies?.classList.add('hidden');
        // Avatar suggestions are hidden via CSS when has-messages class is added
      };

      // Handle chip clicks from both chat and avatar suggestions
      const handleChipClick = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('suggestion-chip')) {
          this.markHasMessages(); // Mark has messages immediately
          hideSuggestions();
          const text = target.textContent;
          if (text) {
            chatInput.value = text;
            inputControls?.classList.add('has-text');
            // Dispatch enter key to trigger ChatManager's send
            chatInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
          }
        }
      };

      // 1. Chip Click handlers for both suggestion areas
      quickReplies?.addEventListener('click', handleChipClick);
      avatarSuggestions?.addEventListener('click', handleChipClick);

      // 2. Hide on Voice Start (mic click)
      micBtn?.addEventListener('click', () => {
        this.markHasMessages();
        hideSuggestions();
      });

      // 3. Hide on Enter Key and cleanup
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.markHasMessages(); // Mark has messages immediately
          hideSuggestions();
           // Force UI cleanup after ChatManager handles send
          setTimeout(() => {
             if (chatInput.value.trim() === '') {
                 inputControls?.classList.remove('has-text');
             }
          }, UI_DELAY.INPUT_CLEANUP);
        }
      });
    }
  }

  /**
   * Handle mobile keyboard appearance using VisualViewport API
   * Resizes the avatar to fit when keyboard opens
   */
  private setupMobileKeyboardHandling(): void {
    // Only needed if visualViewport API is available
    if (!window.visualViewport) {
      return;
    }

    const widgetRoot = this.shadow.querySelector('.widget-root') as HTMLElement;
    
    if (!widgetRoot) {
      return;
    }
    
    let initialViewportHeight = window.visualViewport.height;
    
    const handleViewportChange = () => {
      const viewport = window.visualViewport!;
      const currentHeight = viewport.height;
      
      // Check if keyboard opened (significant height reduction)
      const keyboardHeight = initialViewportHeight - currentHeight;
      
      if (keyboardHeight > 150) {
        // Keyboard is open - add class to trigger CSS resize
        widgetRoot.classList.add('keyboard-visible');
        
        // Set actual available height as CSS variable for dynamic sizing
        const inputHeight = 90; // matches --input-height
        const availableHeight = currentHeight - inputHeight;
        widgetRoot.style.setProperty('--keyboard-available-height', `${availableHeight}px`);
        
        // Force avatar container to recalculate position (fixes WebGL canvas offset)
        const avatarSection = this.shadow.querySelector('.avatar-section') as HTMLElement;
        if (avatarSection) {
          // Trigger reflow by reading and writing a layout property
          void avatarSection.offsetHeight;
          avatarSection.style.transform = 'translateZ(0)';
        }
      } else {
        // Keyboard is closed - remove class
        widgetRoot.classList.remove('keyboard-visible');
        widgetRoot.style.removeProperty('--keyboard-available-height');
        // Update baseline for next check
        initialViewportHeight = currentHeight;
        
        // Reset transform
        const avatarSection = this.shadow.querySelector('.avatar-section') as HTMLElement;
        if (avatarSection) {
          avatarSection.style.transform = '';
        }
      }
    };
    
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);
    
    // Store handler for cleanup
    this.visualViewportHandler = handleViewportChange;
  }

  /**
   * Escape HTML to prevent XSS in user-provided suggestions
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Generate CSS overrides for primaryColor and secondaryColor config options
   */
  private generateColorOverrides(): string {
    const overrides: string[] = [];
    
    if (this.config.primaryColor) {
      const primary = this.config.primaryColor;
      // Generate a darker shade for gradient (darken by ~20%)
      const darkerShade = this.darkenColor(primary, 0.2);
      overrides.push(`--primary-color: ${primary};`);
      overrides.push(`--primary-gradient: linear-gradient(135deg, ${primary} 0%, ${darkerShade} 100%);`);
    }
    
    if (this.config.secondaryColor) {
      overrides.push(`--secondary-color: ${this.config.secondaryColor};`);
    }
    
    if (overrides.length === 0) return '';
    
    return `:host { ${overrides.join(' ')} }`;
  }

  /**
   * Darken a hex color by a percentage
   */
  private darkenColor(hex: string, percent: number): string {
    // Remove # if present
    hex = hex.replace(/^#/, '');
    
    // Parse RGB
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    
    // Darken
    r = Math.max(0, Math.floor(r * (1 - percent)));
    g = Math.max(0, Math.floor(g * (1 - percent)));
    b = Math.max(0, Math.floor(b * (1 - percent)));
    
    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * Mark that conversation has messages (shows chat area instead of suggestions)
   */
  private markHasMessages(): void {
    const root = this.shadow.querySelector('.widget-root');
    if (root && !root.classList.contains('has-messages')) {
      root.classList.add('has-messages');
    }
  }

  /**
   * Initialize the drawer controller and view mode selector
   */
  private initializeDrawer(): void {
    const widgetRoot = this.shadow.querySelector('.widget-root') as HTMLElement;
    const avatarSection = this.shadow.getElementById('avatarSection') as HTMLElement;
    const chatSection = this.shadow.getElementById('chatSection') as HTMLElement;

    if (!widgetRoot || !avatarSection || !chatSection) {
      log.warn('Drawer elements not found');
      return;
    }

    this.drawerController = new DrawerController({
      widgetRoot,
      avatarSection,
      chatSection,
      onStateChange: (state: DrawerState) => {
        log.debug('Drawer state changed:', state);
        this.updateViewModeUI(state);
      },
    });

    // Setup view mode selector
    this.setupViewModeSelector();
    
    // Setup expand button
    this.setupExpandButton();
  }

  /**
   * Setup expand button for text-focus mode
   */
  private setupExpandButton(): void {
    const expandBtn = this.shadow.getElementById('expandBtn') as HTMLButtonElement;
    const widgetRoot = this.shadow.querySelector('.widget-root') as HTMLElement;

    if (!expandBtn || !widgetRoot) {
      log.warn('Expand button elements not found');
      return;
    }

    expandBtn.addEventListener('click', () => {
      const isExpanded = widgetRoot.classList.toggle('expanded');
      expandBtn.setAttribute('aria-label', isExpanded ? 'Collapse chat' : 'Expand chat');
      expandBtn.setAttribute('title', isExpanded ? 'Collapse' : 'Expand');
    });
  }

  /**
   * Setup view mode toggle button
   */
  private setupViewModeSelector(): void {
    const viewModeBtn = this.shadow.getElementById('viewModeBtn') as HTMLButtonElement;
    const widgetRoot = this.shadow.querySelector('.widget-root') as HTMLElement;
    const expandBtn = this.shadow.getElementById('expandBtn') as HTMLButtonElement;

    if (!viewModeBtn) {
      log.warn('View mode button not found');
      return;
    }

    // Toggle between avatar-focus and text-focus on click
    viewModeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.drawerController) {
        const currentState = this.drawerController.getState();
        const newState: DrawerState = currentState === 'avatar-focus' ? 'text-focus' : 'avatar-focus';
        
        // Remove expanded state when switching to avatar-focus
        if (newState === 'avatar-focus') {
          widgetRoot.classList.remove('expanded');
          expandBtn.setAttribute('aria-label', 'Expand chat');
          expandBtn.setAttribute('title', 'Expand');
        }
        
        // Update view mode button tooltip
        if (newState === 'text-focus') {
          viewModeBtn.setAttribute('title', 'Avatar View');
          viewModeBtn.setAttribute('aria-label', 'Switch to Avatar View');
        } else {
          viewModeBtn.setAttribute('title', 'Chat View');
          viewModeBtn.setAttribute('aria-label', 'Switch to Chat View');
        }
        
        this.drawerController.setState(newState);
      }
    });
  }

  /**
   * Update view mode UI to reflect current state (no longer needed with toggle button)
   */
  private updateViewModeUI(_state: DrawerState): void {
    // Icon switching is handled by CSS based on data-drawer-state attribute
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
    // Cleanup drawer controller event listeners
    if (this.drawerController) {
      this.drawerController.destroy();
      this.drawerController = null;
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

    // Validate suggestions array if provided
    if (config.suggestions !== undefined) {
      if (!Array.isArray(config.suggestions)) {
        throw new Error('AvatarChat.init(): suggestions must be an array of strings');
      }
      if (config.suggestions.some(s => typeof s !== 'string')) {
        throw new Error('AvatarChat.init(): all suggestions must be strings');
      }
      // Limit suggestion count and length to prevent abuse
      if (config.suggestions.length > 10) {
        throw new Error('AvatarChat.init(): maximum 10 suggestions allowed');
      }
      if (config.suggestions.some(s => s.length > 200)) {
        throw new Error('AvatarChat.init(): suggestion text must be 200 characters or less');
      }
    }

    // Validate customStyles if provided (basic check - CSS is sandboxed in Shadow DOM)
    if (config.customStyles !== undefined && typeof config.customStyles !== 'string') {
      throw new Error('AvatarChat.init(): customStyles must be a string');
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

    // Validate avatarUrl if provided (must be a URL or relative path ending in .zip)
    if (config.avatarUrl !== undefined) {
      if (typeof config.avatarUrl !== 'string') {
        throw new Error('AvatarChat.init(): avatarUrl must be a string');
      }
      // Must end with .zip and not contain dangerous characters
      if (!config.avatarUrl.endsWith('.zip')) {
        throw new Error('AvatarChat.init(): avatarUrl must be a .zip file');
      }
      // Prevent path traversal attacks
      if (config.avatarUrl.includes('..')) {
        throw new Error('AvatarChat.init(): avatarUrl cannot contain path traversal');
      }
    }

    // Validate logLevel if provided
    if (config.logLevel !== undefined) {
      const validLogLevels = ['none', 'error', 'warn', 'info', 'debug'];
      if (!validLogLevels.includes(config.logLevel)) {
        throw new Error(`AvatarChat.init(): logLevel must be one of: ${validLogLevels.join(', ')}`);
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
