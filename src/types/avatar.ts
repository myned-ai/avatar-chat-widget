// Avatar Controller Interface
// Any avatar renderer must implement this interface to work with the chat widget

import type { ChatState } from './common';

/**
 * Interface that any avatar controller must implement
 * to integrate with the chat widget
 */
export interface IAvatarController {
  /**
   * Update blendshape weights for facial animation
   * @param weights - Record of blendshape names to weight values (0-1)
   */
  updateBlendshapes(weights: Record<string, number>): void;

  /**
   * Set the current chat state for avatar behavior
   * @param state - Current state: Idle, Listening, Thinking, Responding
   */
  setChatState(state: ChatState): void;

  /**
   * Get the current chat state
   * @returns Current chat state
   */
  getChatState(): ChatState;

  /**
   * Enable real-time blendshape streaming mode
   */
  enableLiveBlendshapes(): void;

  /**
   * Disable live blendshapes and return to idle animation
   */
  disableLiveBlendshapes(): void;

  /**
   * Clean up resources when widget is destroyed
   */
  dispose(): void;

  /**
   * Pause avatar animation (return to neutral pose)
   */
  pause?(): void;

  /**
   * Resume avatar animation
   */
  resume?(): void;
}

/**
 * Optional: Extended interface for avatars that support additional features
 */
export interface IAvatarControllerExtended extends IAvatarController {
  /**
   * Get current chat state
   */
  getChatState(): ChatState;

  /**
   * Force specific expressions (e.g., close eyes)
   */
  setExpression?(expression: string, value: number): void;
}
