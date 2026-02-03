/**
 * TranscriptManager - Manages streaming transcript display
 * 
 * Handles buffering, streaming, and finalization of transcript messages.
 * Supports both user and assistant messages with item-based tracking.
 * 
 * @example
 * ```typescript
 * const transcripts = new TranscriptManager({
 *   chatMessages: document.getElementById('chat'),
 *   onMessage: (msg) => console.log(msg),
 *   onScrollToBottom: () => container.scrollTop = container.scrollHeight
 * });
 * transcripts.streamText('Hello', 'assistant', 'item_123');
 * transcripts.finalize('item_123', 'assistant');
 * ```
 */

import { CHAT_TIMING, BUFFER_CONFIG } from '../constants/chat';
import { logger } from '../utils/Logger';
import type { ChatMessage } from '../types/messages';
import type { Disposable } from '../types/common';

const log = logger.scope('TranscriptManager');

export interface TranscriptManagerOptions {
  /** Container element for message bubbles */
  chatMessages: HTMLElement;
  /** Callback when a message is finalized */
  onMessage?: (msg: { role: 'user' | 'assistant'; text: string }) => void;
  /** Callback to scroll to bottom */
  onScrollToBottom?: () => void;
}

export interface StreamingEntry {
  role: 'user' | 'assistant';
  element: HTMLElement;
}

export class TranscriptManager implements Disposable {
    /**
     * Debug: Log clear state
     */
    private debugLogClear(): void {
      log.debug('[TranscriptManager] clear() called');
      log.debug(`[TranscriptManager] streamingByItem.size: ${this.streamingByItem.size}`);
      log.debug(`[TranscriptManager] bufferedDeltas.size: ${this.bufferedDeltas.size}`);
      log.debug(`[TranscriptManager] bufferTimeouts.size: ${this.bufferTimeouts.size}`);
      log.debug(`[TranscriptManager] currentAssistantTurnElement: ${!!this.currentAssistantTurnElement}`);
      log.debug(`[TranscriptManager] currentAssistantTurnText: "${this.currentAssistantTurnText}"`);
    }
  private chatMessages: HTMLElement;
  private options: TranscriptManagerOptions;
  
  // Streaming state
  private streamingByItem: Map<string, StreamingEntry> = new Map();
  private latestItemForRole: { user?: string; assistant?: string } = {};
  private bufferedDeltas: Map<string, string[]> = new Map();
  private bufferTimeouts: Map<string, number> = new Map();
  
  // Assistant turn state (single bubble per turn)
  private currentAssistantTurnElement: HTMLElement | null = null;
  private currentAssistantTurnText: string = '';
  private assistantAppendInterval: number | null = null;
  
  // Message history
  private messages: ChatMessage[] = [];
  
  // Scroll throttling - prevents layout thrashing during streaming
  private scrollPending = false;

  constructor(options: TranscriptManagerOptions) {
    this.chatMessages = options.chatMessages;
    this.options = options;
  }

  /**
   * Get all messages
   */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * Stream transcript text
   */
  streamText(
    text: string,
    role: 'user' | 'assistant',
    itemId?: string,
    previousItemId?: string,
    startOffset?: number,
    finalize = false
  ): void {
    if (!text && !finalize) return;

    // User message finalizes any previous assistant turn
    if (role === 'user' && this.currentAssistantTurnElement) {
      this.finalizeAssistantTurn();
    }

    const effectiveId = itemId || `${role}_${Date.now().toString()}`;

    // If assistant streaming is disabled, buffer for batch display
    if (role === 'assistant' && !BUFFER_CONFIG.SHOW_ASSISTANT_STREAMING) {
      const bufferKey = BUFFER_CONFIG.ASSISTANT_TURN_KEY;
      const buf = this.bufferedDeltas.get(bufferKey) || [];
      buf.push(text);
      this.bufferedDeltas.set(bufferKey, buf);
      
      // Start interval to append buffered content periodically
      if (!this.assistantAppendInterval) {
        this.assistantAppendInterval = window.setInterval(() => {
          this.appendBufferedToAssistantBubble();
        }, CHAT_TIMING.ASSISTANT_APPEND_INTERVAL_MS);
      }
      return;
    }

    // Buffer if previous item not yet seen
    if (previousItemId && !this.streamingByItem.has(previousItemId) && !this.latestItemForRole[role]) {
      const buf = this.bufferedDeltas.get(effectiveId) || [];
      buf.push(text);
      this.bufferedDeltas.set(effectiveId, buf);
      
      if (this.bufferTimeouts.has(effectiveId)) {
        clearTimeout(this.bufferTimeouts.get(effectiveId));
      }
      const t = window.setTimeout(() => {
        this.flushBufferedDeltas(effectiveId, role, effectiveId);
      }, CHAT_TIMING.BUFFER_WAIT_MS);
      this.bufferTimeouts.set(effectiveId, t);
      return;
    }

    // Flush any buffered deltas for this item
    if (this.bufferedDeltas.has(effectiveId)) {
      const buffered = this.bufferedDeltas.get(effectiveId) || [];
      for (const part of buffered) {
        this.appendToStreamingItem(effectiveId, role, part);
      }
      this.bufferedDeltas.delete(effectiveId);
      const to = this.bufferTimeouts.get(effectiveId);
      if (to) { clearTimeout(to); this.bufferTimeouts.delete(effectiveId); }
    }

    // Create or append to streaming element
    if (!this.streamingByItem.has(effectiveId)) {
      this.createStreamingElement(effectiveId, role, text);
    } else {
      this.appendToStreamingItem(effectiveId, role, text);
    }
  }

  /**
   * Finalize a streaming message
   */
  finalizeMessage(itemId?: string, role?: 'user' | 'assistant', _interrupted = false): void {
    // Assistant with current turn element - skip (handled by finalizeAssistantTurn)
    if (role === 'assistant' && this.currentAssistantTurnElement) {
      log.debug('Skipping finalizeMessage - assistant turn already handled');
      return;
    }
    
    // Check assistant turn buffer
    if (role === 'assistant') {
      const buffered = this.bufferedDeltas.get(BUFFER_CONFIG.ASSISTANT_TURN_KEY);
      if (buffered && buffered.length) {
        const text = this.joinWordsSmartly(buffered);
        this.addFinalizedMessage(text, 'assistant', `assistant_turn_${Date.now()}`);
        this.bufferedDeltas.delete(BUFFER_CONFIG.ASSISTANT_TURN_KEY);
        this.clearBufferTimeout(BUFFER_CONFIG.ASSISTANT_TURN_KEY);
        return;
      }
    }

    // Finalize by item ID
    if (itemId) {
      const entry = this.streamingByItem.get(itemId);
      if (entry) {
        const bubbleEl = entry.element.querySelector('.message-bubble');
        const text = bubbleEl?.textContent || '';
        this.finalizeEntry(itemId, entry.role, text, entry.element);
        return;
      }

      // Check buffered deltas for this item
      if (this.bufferedDeltas.has(itemId)) {
        const parts = this.bufferedDeltas.get(itemId) || [];
        const text = parts.join('');
        this.addFinalizedMessage(text, role || 'assistant', itemId);
        this.bufferedDeltas.delete(itemId);
        this.clearBufferTimeout(itemId);
        return;
      }
    }

    // Fallback: finalize by role
    const rolesToFinalize = role ? [role] : (['user', 'assistant'] as const);
    for (const r of rolesToFinalize) {
      const latestId = this.latestItemForRole[r];
      if (!latestId) continue;
      const entry = this.streamingByItem.get(latestId);
      if (!entry) continue;
      const bubbleEl = entry.element.querySelector('.message-bubble');
      const text = bubbleEl?.textContent || '';
      this.finalizeEntry(latestId, r, text, entry.element);
    }
  }

  /**
   * Finalize the current assistant turn
   */
  finalizeAssistantTurn(): void {
    if (this.assistantAppendInterval) {
      clearInterval(this.assistantAppendInterval);
      this.assistantAppendInterval = null;
    }

    this.appendBufferedToAssistantBubble();
    this.bufferedDeltas.delete(BUFFER_CONFIG.ASSISTANT_TURN_KEY);

    if (!this.currentAssistantTurnElement) return;

    const msg: ChatMessage = {
      id: this.currentAssistantTurnElement.dataset.id || `assistant_${Date.now()}`,
      text: this.currentAssistantTurnText,
      sender: 'assistant',
      timestamp: Date.now(),
    };
    
    log.info(` TURN END [assistant] | Full text: "${this.currentAssistantTurnText}"`);
    
    this.messages.push(msg);
    this.options.onMessage?.({ role: 'assistant', text: this.currentAssistantTurnText });

    this.currentAssistantTurnElement.classList.add('finalized');
    this.currentAssistantTurnElement.dataset.finalized = 'true';

    this.currentAssistantTurnElement = null;
    this.currentAssistantTurnText = '';
  }

  /**
   * Add a complete message (non-streaming)
   */
  addMessage(text: string, sender: 'user' | 'assistant'): void {
    if (sender === 'user' && this.currentAssistantTurnElement) {
      this.finalizeAssistantTurn();
    }

    const message: ChatMessage = {
      id: Date.now().toString(),
      text,
      sender,
      timestamp: Date.now(),
    };

    this.messages.push(message);
    this.renderMessage(message);
    this.scrollToBottom();
    this.options.onMessage?.({ role: sender, text });
  }

  /**
   * Append text to assistant turn (for subtitle sync)
   */
  appendToAssistantTurn(text: string): void {
    if (!text || !text.trim()) return;

    if (!this.currentAssistantTurnElement) {
      this.createAssistantTurnElement(text);
    } else {
      const bubbleEl = this.currentAssistantTurnElement.querySelector('.message-bubble');
      if (bubbleEl) {
        const needsSpace = !/^[.,!?;:''"\-)\]}>…]/.test(text);
        const separator = needsSpace ? ' ' : '';
        this.currentAssistantTurnText += separator + text;
        bubbleEl.textContent = this.currentAssistantTurnText;
        this.scrollToBottom();
      }
    }
  }

  /**
   * Check if there's an active assistant turn
   */
  hasActiveAssistantTurn(): boolean {
    return this.currentAssistantTurnElement !== null;
  }

  /**
   * Replace assistant turn text (for interruptions)
   */
  replaceAssistantTurnText(text: string): void {
    if (this.currentAssistantTurnElement) {
      const bubble = this.currentAssistantTurnElement.querySelector('.message-bubble');
      if (bubble) {
        bubble.textContent = text;
        this.currentAssistantTurnText = text;
      }
    }
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.debugLogClear();
    this.streamingByItem.clear();
    this.latestItemForRole = {};
    this.bufferedDeltas.clear();
    for (const timeout of this.bufferTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.bufferTimeouts.clear();
    if (this.assistantAppendInterval) {
      clearInterval(this.assistantAppendInterval);
      this.assistantAppendInterval = null;
    }
    this.currentAssistantTurnElement = null;
    this.currentAssistantTurnText = '';
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createStreamingElement(id: string, role: 'user' | 'assistant', text: string): void {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    messageEl.dataset.id = id;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';
    bubbleEl.textContent = text;

    const footerEl = document.createElement('div');
    footerEl.className = 'message-footer';

    messageEl.appendChild(bubbleEl);
    messageEl.appendChild(footerEl);
    this.chatMessages.appendChild(messageEl);

    this.streamingByItem.set(id, { role, element: messageEl });
    this.latestItemForRole[role] = id;
    this.scrollToBottom();
  }

  private createAssistantTurnElement(text: string): void {
    const messageEl = document.createElement('div');
    messageEl.className = 'message assistant';
    messageEl.dataset.id = `assistant_turn_${Date.now()}`;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';
    bubbleEl.textContent = text;

    const footerEl = document.createElement('div');
    footerEl.className = 'message-footer';

    messageEl.appendChild(bubbleEl);
    messageEl.appendChild(footerEl);
    this.chatMessages.appendChild(messageEl);

    this.currentAssistantTurnElement = messageEl;
    this.currentAssistantTurnText = text;
    this.scrollToBottom();
  }

  private appendToStreamingItem(id: string, role: 'user' | 'assistant', text: string): void {
    const entry = this.streamingByItem.get(id);
    if (!entry) return;
    const bubbleEl = entry.element.querySelector('.message-bubble');
    if (bubbleEl) {
      bubbleEl.textContent += text;
      this.scrollToBottom();
    }
  }

  private appendBufferedToAssistantBubble(): void {
    const buffered = this.bufferedDeltas.get(BUFFER_CONFIG.ASSISTANT_TURN_KEY);
    if (!buffered || buffered.length === 0) return;

    const text = buffered.join('');
    this.bufferedDeltas.set(BUFFER_CONFIG.ASSISTANT_TURN_KEY, []);

    if (!this.currentAssistantTurnElement) {
      this.createAssistantTurnElement(text);
    } else {
      const bubbleEl = this.currentAssistantTurnElement.querySelector('.message-bubble');
      if (bubbleEl) {
        this.currentAssistantTurnText += text;
        bubbleEl.textContent = this.currentAssistantTurnText;
        this.scrollToBottom();
      }
    }
  }

  private flushBufferedDeltas(bufferKey: string, role: 'user' | 'assistant', fallbackId: string): void {
    const parts = this.bufferedDeltas.get(bufferKey);
    if (!parts) return;

    if (role === 'assistant' && !BUFFER_CONFIG.SHOW_ASSISTANT_STREAMING) {
      try {
        const text = parts.join('');
        this.addFinalizedMessage(text, 'assistant', fallbackId);
      } catch (err) {
        log.error('Failed to finalize buffered assistant parts:', err);
      }
    } else {
      for (const p of parts) {
        this.streamText(p, role, fallbackId);
      }
    }
    this.bufferedDeltas.delete(bufferKey);
    this.clearBufferTimeout(bufferKey);
  }

  private finalizeEntry(id: string, role: 'user' | 'assistant', text: string, element: HTMLElement): void {
    const msg: ChatMessage = {
      id,
      text,
      sender: role,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    this.options.onMessage?.({ role, text });
    
    element.classList.add('finalized');
    element.dataset.finalized = 'true';
    this.streamingByItem.delete(id);
    delete this.latestItemForRole[role];
  }

  private addFinalizedMessage(text: string, role: 'user' | 'assistant', id: string): void {
    const msg: ChatMessage = {
      id,
      text,
      sender: role,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    this.options.onMessage?.({ role, text });
    this.renderMessage(msg);
    
    const el = this.chatMessages.lastElementChild as HTMLElement | null;
    if (el) {
      el.classList.add('finalized');
      el.dataset.finalized = 'true';
    }
  }

  private renderMessage(message: ChatMessage): void {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.sender}`;
    
    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';
    bubbleEl.textContent = message.text;

    const footerEl = document.createElement('div');
    footerEl.className = 'message-footer';

    messageEl.appendChild(bubbleEl);
    messageEl.appendChild(footerEl);
    this.chatMessages.appendChild(messageEl);
  }

  /**
   * Scroll to bottom with throttling to prevent layout thrashing
   * Coalesces multiple calls within a single animation frame
   */
  private scrollToBottom(): void {
    if (this.scrollPending) return;
    this.scrollPending = true;
    
    if (this.options.onScrollToBottom) {
      requestAnimationFrame(() => {
        this.scrollPending = false;
        this.options.onScrollToBottom?.();
      });
    } else {
      requestAnimationFrame(() => {
        this.scrollPending = false;
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      });
    }
  }

  private clearBufferTimeout(key: string): void {
    const to = this.bufferTimeouts.get(key);
    if (to) {
      clearTimeout(to);
      this.bufferTimeouts.delete(key);
    }
  }

  private joinWordsSmartly(words: string[]): string {
    if (words.length === 0) return '';
    let result = words[0];
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const needsSpace = !/^[.,!?;:''"\-)\]}>…]/.test(word);
      result += needsSpace ? ' ' + word : word;
    }
    return result;
  }

  dispose(): void {
    this.clear();
  }
}
