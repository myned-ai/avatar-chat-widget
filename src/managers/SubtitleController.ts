/**
 * SubtitleController - Manages real-time subtitle display
 * 
 * Handles chunking of transcript words into readable subtitle segments,
 * respecting natural sentence breaks and configurable word limits.
 * 
 * @example
 * ```typescript
 * const subtitles = new SubtitleController({
 *   onSubtitleUpdate: (text, role) => updateUI(text)
 * });
 * subtitles.addWord('Hello');
 * subtitles.addWord('world!');
 * ```
 */

import { SUBTITLE_CONFIG } from '../constants/chat';
import type { Disposable } from '../types/common';

export interface SubtitleControllerOptions {
  /** Callback when subtitle text should be displayed */
  onSubtitleUpdate?: (text: string, role: 'user' | 'assistant') => void;
}

export class SubtitleController implements Disposable {
    /**
     * Debug: Log reset/clear state
     */
    private debugLogReset(): void {
      if (typeof console !== 'undefined') {
        console.debug('[SubtitleController] reset/clear called');
        console.debug(`[SubtitleController] currentChunk: [${this.currentChunk.join(', ')}]`);
        console.debug(`[SubtitleController] nextChunk: [${this.nextChunk.join(', ')}]`);
        console.debug(`[SubtitleController] spokenInChunk: ${this.spokenInChunk}`);
        console.debug(`[SubtitleController] chunkLocked: ${this.chunkLocked}`);
      }
    }
  // Subtitle state: two-array design
  // currentChunk = words being displayed NOW
  // nextChunk = words waiting for next display
  private currentChunk: string[] = [];
  private nextChunk: string[] = [];
  private spokenInChunk: number = 0;
  private chunkLocked: boolean = false;
  
  private options: SubtitleControllerOptions;

  constructor(options: SubtitleControllerOptions = {}) {
    this.options = options;
  }

  /**
   * Add a word to the subtitle queue
   * Words are buffered and displayed in chunks for readability
   */
  addWord(word: string): void {
    if (!word || !word.trim()) return;
    
    // If chunk is locked, add to next chunk
    if (this.chunkLocked) {
      this.nextChunk.push(word);
    } else {
      // Add to current chunk
      this.currentChunk.push(word);
      
      // Check if we should lock (natural break or max reached)
      if (this.shouldLockChunk()) {
        this.chunkLocked = true;
      }
      
      // Display current chunk
      this.displayCurrentChunk();
    }
  }

  /**
   * Mark a word as spoken (for sync with audio playback)
   * When all words in current chunk are spoken, advances to next chunk
   */
  markWordSpoken(): void {
    if (!this.chunkLocked) return;
    
    this.spokenInChunk++;
    
    // When all words in current chunk are spoken, build next chunk
    if (this.spokenInChunk >= this.currentChunk.length && this.currentChunk.length > 0) {
      this.buildNextChunk();
    }
  }

  /**
   * Show any remaining words (called when playback ends)
   */
  showRemaining(): void {
    const all = [...this.currentChunk, ...this.nextChunk];
    if (all.length > 0) {
      const text = this.joinWordsSmartly(all);
      this.options.onSubtitleUpdate?.(text, 'assistant');
    }
  }

  /**
   * Clear all subtitle state
   */
  clear(): void {
    this.debugLogReset();
    this.currentChunk = [];
    this.nextChunk = [];
    this.spokenInChunk = 0;
    this.chunkLocked = false;
    this.options.onSubtitleUpdate?.('', 'assistant');
  }

  /**
   * Reset state for a new turn
   */
  reset(): void {
    this.debugLogReset();
    this.clear();
  }

  /**
   * Get current subtitle text (for external access)
   */
  getCurrentText(): string {
    return this.joinWordsSmartly(this.currentChunk);
  }

  /**
   * Build new current chunk from nextChunk (respects character limits)
   * Ensures new chunk doesn't start with punctuation
   */
  private buildNextChunk(): void {
    this.currentChunk = [];
    this.spokenInChunk = 0;
    this.chunkLocked = false;

    // If the next chunk would start with punctuation, move it to the end of the previous chunk
    while (this.nextChunk.length > 0 && this.isPunctuationOnly(this.nextChunk[0])) {
      const punct = this.nextChunk.shift()!;
      // If there is a previous chunk, append punctuation to its last word and redisplay
      if (this.options.onSubtitleUpdate && typeof this.options.onSubtitleUpdate === 'function' && this.currentChunk.length === 0) {
        // Try to append to the last displayed chunk (not tracked here), so instead, emit a special event or rely on transcript for now
        // For now, just ignore if no currentChunk, otherwise append
        // In practice, this will only happen if a chunk just ended
      } else if (this.currentChunk.length > 0) {
        this.currentChunk[this.currentChunk.length - 1] += punct;
      }
    }

    while (this.nextChunk.length > 0 && this.getChunkCharCount() < SUBTITLE_CONFIG.MAX_CHARS) {
      const word = this.nextChunk.shift()!;
      this.currentChunk.push(word);

      if (this.shouldLockChunk()) {
        this.chunkLocked = true;
        break;
      }
    }

    if (this.getChunkCharCount() >= SUBTITLE_CONFIG.MAX_CHARS) {
      this.chunkLocked = true;
    }

    if (this.currentChunk.length > 0) {
      this.displayCurrentChunk();
    }
  }

  /**
   * Display current subtitle chunk
   */
  private displayCurrentChunk(): void {
    if (this.currentChunk.length > 0) {
      const text = this.joinWordsSmartly(this.currentChunk);
      this.options.onSubtitleUpdate?.(text, 'assistant');
    }
  }

  /**
   * Get current chunk character count (for display width estimation)
   */
  private getChunkCharCount(): number {
    return this.joinWordsSmartly(this.currentChunk).length;
  }
  
  /**
   * Check if a token is punctuation-only (shouldn't start a new chunk)
   */
  private isPunctuationOnly(word: string): boolean {
    if (!word) return false;
    return /^[.,!?;:''"\-…)\]}>]+$/.test(word.trim());
  }

  /**
   * Check if current chunk should be locked (stop appending)
   */
  private shouldLockChunk(): boolean {
    const charCount = this.getChunkCharCount();
    const wordCount = this.currentChunk.length;
    
    // Max characters reached - must lock
    if (charCount >= SUBTITLE_CONFIG.MAX_CHARS) return true;
    
    // Not enough content yet (need minimum chars AND words)
    if (charCount < SUBTITLE_CONFIG.MIN_CHARS || wordCount < SUBTITLE_CONFIG.MIN_WORDS) return false;
    
    // Check for natural break (sentence end)
    const lastWord = this.currentChunk[wordCount - 1];
    if (!lastWord) return false;
    
    // Don't lock if next word in nextChunk is punctuation (keep it with current sentence)
    const nextWord = this.nextChunk[0];
    if (nextWord && this.isPunctuationOnly(nextWord)) {
      return false;
    }
    
    // Lock on sentence end
    return /[.!?]$/.test(lastWord);
  }

  /**
   * Join words with smart spacing - no space before punctuation
   */
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
