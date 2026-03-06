/**
 * Widget TypeScript Interfaces and Types
 */

/**
 * Camera framing configuration for the 3D avatar
 */
export interface CameraConfig {
  /** Camera position [x, y, z] — default: [0, 1.8, 1] */
  position?: [number, number, number];
  /** Camera lookAt target [x, y, z] — default: [0, 1.6, 0] */
  lookAt?: [number, number, number];
  /** Field of view in degrees — default: 50 */
  fov?: number;
}

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

  /** Callback when widget is ready */
  onReady?: () => void;

  /** Callback when connection state changes */
  onConnectionChange?: (connected: boolean) => void;

  /** Callback when a message is received */
  onMessage?: (message: { role: 'user' | 'assistant'; text: string }) => void;

  /** Callback on error */
  onError?: (error: Error) => void;

  /** Camera framing configuration for the 3D avatar */
  camera?: CameraConfig;

  /** Camera framing for the small avatar in text-focus view (default: tight close-up) */
  smallCamera?: CameraConfig;
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
  /** Update camera framing at runtime */
  setCamera(config: CameraConfig): void;
}

/**
 * Default configuration values
 */
export const DEFAULT_CAMERA: CameraConfig = {
  position: [0, 1.8, 1],
  lookAt: [0, 1.6, 0],
  fov: 50,
};

export const DEFAULT_SMALL_CAMERA: CameraConfig = {
  position: [0, 1.85, 0.25],
  lookAt: [0, 1.75, 0],
  fov: 30,
};

export const DEFAULT_CONFIG: Partial<AvatarChatConfig> = {
  position: 'bottom-right',
  startCollapsed: true,
  width: 380,
  height: 550,
  enableVoice: true,
  enableText: true,
  authEnabled: false,
  logLevel: 'error',
  camera: DEFAULT_CAMERA,
  smallCamera: DEFAULT_SMALL_CAMERA,
  suggestions: [
    'What is your story?',
    'What services do you provide?',
    'Can I book a meeting?',
  ],
  tooltipText: 'Hi! 👋 Ask me anything.',
};
