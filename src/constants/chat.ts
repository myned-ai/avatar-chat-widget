/**
 * Chat Manager Configuration Constants
 * 
 * Centralized timing and behavior constants for the ChatManager.
 * These values control UI feedback timing, buffering behavior, and subtitle display.
 * 
 * @example
 * ```typescript
 * import { CHAT_TIMING, SUBTITLE_CONFIG, BUFFER_CONFIG } from '../constants/chat';
 * ```
 */

/**
 * UI Timing Constants (in milliseconds)
 */
export const CHAT_TIMING = {
  /** Minimum time to show typing indicator for visual feedback */
  MIN_TYPING_DISPLAY_MS: 1500,
  
  /** Interval for appending buffered assistant content to bubble */
  ASSISTANT_APPEND_INTERVAL_MS: 500,
  
  /** Wait time for buffered deltas before auto-flush */
  BUFFER_WAIT_MS: 200,
} as const;

/**
 * Subtitle Display Configuration
 * 
 * Uses character-based limits to fit text in available space
 * rather than fixed word counts.
 */
export const SUBTITLE_CONFIG = {
  /** Minimum characters before considering a natural break */
  MIN_CHARS: 18,
  
  /** Maximum characters per subtitle chunk (fits within visible area) */
  MAX_CHARS: 38,
  
  /** Minimum words before considering a natural break (fallback) */
  MIN_WORDS: 3,
} as const;

/**
 * Streaming Behavior Configuration
 */
export const BUFFER_CONFIG = {
  /** Whether to show assistant text incrementally or only on finalize */
  SHOW_ASSISTANT_STREAMING: false,
  
  /** Buffer key for all assistant deltas in a turn (shared bubble) */
  ASSISTANT_TURN_KEY: 'assistant_current_turn',
} as const;

// Type exports for external use
export type ChatTiming = typeof CHAT_TIMING;
export type SubtitleConfig = typeof SUBTITLE_CONFIG;
export type BufferConfig = typeof BUFFER_CONFIG;
