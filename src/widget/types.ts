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

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<AvatarChatConfig> = {
  position: 'bottom-right',
  theme: 'light',
  startCollapsed: true,
  width: 380,
  height: 550,
  enableVoice: true,
  enableText: true,
  authEnabled: false,
  logLevel: 'error',
};
