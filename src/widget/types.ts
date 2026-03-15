/**
 * Widget TypeScript Interfaces and Types
 */

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

  /** Path to avatar model (default: uses included default avatar) */
  avatarUrl?: string;

  /** Base URL for loading assets like worklet and default avatar (default: auto-detected) */
  assetsBaseUrl?: string;

  /** Enable authentication (default: false) */
  authEnabled?: boolean;

  /** Log level for debugging */
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';

  /** Custom CSS to inject (optional) */
  customStyles?: string;

  /** Primary brand color for user bubbles, suggestions, widget accents (default: #4B4ACF) */
  primaryColor?: string;

  /** Secondary color for header text, toolbar icons, widget icon (default: #1F2937) */
  secondaryColor?: string;

  /** Quick reply suggestions shown below chat (default: built-in suggestions) */
  suggestions?: string[];

  /** Tooltip text shown on the chat bubble (default: greeting message) */
  tooltipText?: string;

  /**
   * If true, the widget will internally render rich content items in the chat feed.
   * If false, it will only dispatch an event for the host site to handle.
   * (default: true)
   */
  handleRichContentLocally?: boolean;

  /** Callback when widget is ready */
  onReady?: () => void;

  /** Arbitrary context data sent to the AI upon connection for logic customization */
  clientContext?: Record<string, any>;

  /** Callback when connection state changes */
  onConnectionChange?: (connected: boolean) => void;

  /** Callback when a message is received */
  onMessage?: (message: { role: 'user' | 'assistant'; text: string }) => void;

  /** Callback on error */
  onError?: (error: Error) => void;

  /** Debug mode */
  debug?: boolean;
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
  /** Manually reconnect to the server (resets reconnection counter) */
  reconnect(): Promise<void>;

  /** Trigger a client-side action manually for debugging */
  triggerAction(function_name: string, args?: Record<string, any>): void;

  /** Send a background event to the AI server */
  sendEvent(
    name: string,
    data?: Record<string, any>,
    options?: { directive?: 'context' | 'speak' | 'trigger' }
  ): Promise<void>;

  /** Send a background event and await a response */
  sendEventAsync(
    name: string,
    data?: Record<string, any>,
    options?: {
      directive?: 'context' | 'speak' | 'trigger';
      timeoutMs?: number;
      attachments?: any[];
    }
  ): Promise<any>;

  /** Register a custom renderer for server-sent rich content */
  registerRichRenderer(
    type: string,
    subtypeOrRenderer: string | ((payload: Record<string, any>, container: HTMLElement) => void),
    renderer?: (payload: Record<string, any>, container: HTMLElement) => void
  ): void;

  /** Register a handler for standalone server-pushed events */
  onServerEvent(
    name: string,
    handler: (event: import('../types/protocol').ServerEventMessage) => void
  ): void;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<AvatarChatConfig> = {
  position: 'bottom-right',
  startCollapsed: true,
  width: 380,
  height: 550,
  enableVoice: true,
  enableText: true,
  authEnabled: false,
  logLevel: 'error',
  suggestions: [
    'What is your story?',
    'What services do you provide?',
    'Can I book a meeting?',
  ],
  tooltipText: 'Hi! 👋 Ask me anything.',
  handleRichContentLocally: true,
};
