/**
 * Layout Constants
 * 
 * Centralized layout constants shared between TypeScript and CSS.
 * These values control widget dimensions, spacing, and positioning.
 * 
 * IMPORTANT: When modifying these values, ensure CSS variables in styles.ts
 * are updated to match (see :host CSS custom properties).
 * 
 * @example
 * ```typescript
 * import { LAYOUT } from '../constants/layout';
 * // Use LAYOUT.HEADER_HEIGHT instead of magic number 56
 * ```
 */

/**
 * Fixed widget layout dimensions (in pixels)
 */
export const LAYOUT = {
  /** Header bar height - contains title, status, minimize button */
  HEADER_HEIGHT: 56,
  
  /** Input area height - contains text input and mic button */
  INPUT_HEIGHT: 90,
  
  /** Full widget height when expanded */
  FULL_WIDGET_HEIGHT: 540,
  
  /** Default widget width */
  DEFAULT_WIDTH: 350,
  
  /** Widget border radius */
  BORDER_RADIUS: 20,
  
  /** Z-index for floating widget position */
  Z_INDEX: 999999,
  
  /** Spacing from viewport edge for floating positions */
  EDGE_SPACING: 20,
} as const;

/**
 * Avatar section dimensions (in pixels)
 */
export const AVATAR_LAYOUT = {
  /** Extra padding for avatar to extend behind header */
  HEADER_OVERLAP_PADDING: 56,  // Matches LAYOUT.HEADER_HEIGHT
  
  /** Avatar height in avatar-focus mode (smaller, compact) */
  FOCUS_CONTENT_HEIGHT: 224,
  
  /** Full avatar height in avatar-focus mode (including header overlap) */
  get FOCUS_FULL_HEIGHT(): number {
    return this.FOCUS_CONTENT_HEIGHT + this.HEADER_OVERLAP_PADDING;  // 280px
  },
  
  /** Avatar height in text-focus mode (hidden/minimal) */
  TEXT_FOCUS_HEIGHT: 0,
} as const;

/**
 * Chat section dimensions (in pixels)
 */
export const CHAT_LAYOUT = {
  /** Chat section height in avatar-focus mode (hidden) */
  AVATAR_FOCUS_HEIGHT: 0,
  
  /** Chat section height in text-focus mode (full content area) */
  get TEXT_FOCUS_HEIGHT(): number {
    // Full widget - header - input = content area for chat
    return LAYOUT.FULL_WIDGET_HEIGHT - LAYOUT.HEADER_HEIGHT - LAYOUT.INPUT_HEIGHT;  // 394px
  },
} as const;

/**
 * Computed widget heights for each drawer state
 */
export const WIDGET_HEIGHTS = {
  /** Full height for text-focus mode */
  TEXT_FOCUS: LAYOUT.FULL_WIDGET_HEIGHT,  // 540px
  
  /** Compact height for avatar-focus mode */
  get AVATAR_FOCUS(): number {
    return LAYOUT.HEADER_HEIGHT + AVATAR_LAYOUT.FOCUS_CONTENT_HEIGHT + LAYOUT.INPUT_HEIGHT;  // 370px
  },
} as const;

// Type exports for external use
export type LayoutConstants = typeof LAYOUT;
export type AvatarLayoutConstants = typeof AVATAR_LAYOUT;
export type ChatLayoutConstants = typeof CHAT_LAYOUT;
