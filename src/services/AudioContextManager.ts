// Shared AudioContext Manager (Singleton)
// Browsers limit AudioContexts to 6-8. This service ensures we only create one.

import { logger } from '../utils/Logger';
import { errorBoundary } from '../utils/ErrorBoundary';

const log = logger.scope('AudioContextManager');

/**
 * AudioContextManager - Singleton for shared AudioContext
 *
 * Why this matters:
 * - Browsers limit AudioContexts (Chrome: 6, Firefox: 8)
 * - Each AudioContext consumes significant resources
 * - Sharing one context ensures consistent timing across audio operations
 */
class AudioContextManagerImpl {
  private static _instance: AudioContextManagerImpl | null = null;

  private _context: AudioContext | null = null;
  private _isResumeListenerAdded = false;
  private _resumePromise: Promise<void> | null = null;
  private _suspendPromise: Promise<void> | null = null;
  private _sampleRate: number = 24000;

  // Store listener references for cleanup (prevents memory leaks)
  private _interactionHandler: (() => void) | null = null;
  private _listenerEvents: string[] = [];

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): AudioContextManagerImpl {
    if (!AudioContextManagerImpl._instance) {
      AudioContextManagerImpl._instance = new AudioContextManagerImpl();
    }
    return AudioContextManagerImpl._instance;
  }

  /**
   * Set the sample rate for when the AudioContext is eventually created.
   * Call this early (e.g., from server config) before any audio session starts.
   */
  setSampleRate(sampleRate: number): void {
    this._sampleRate = sampleRate;
  }

  /**
   * Get the shared AudioContext. Creates lazily if needed.
   * Prefer ensureAudioReady() from user-gesture handlers to guarantee iOS unlock.
   * @param sampleRate Optional sample rate (only used on first creation)
   */
  getContext(sampleRate?: number): AudioContext {
    if (this._context) {
      return this._context;
    }

    if (sampleRate) {
      this._sampleRate = sampleRate;
    }

    return this.createContext();
  }

  /**
   * Single idempotent entry point: create (if needed) + resume AudioContext.
   * Call this synchronously from any user-gesture handler (pointerdown, touchend,
   * click, keydown) to guarantee iOS audio unlock.
   */
  ensureAudioReady(source?: string): void {
    const tag = source ? `[${source}]` : '';

    // Create if it doesn't exist yet (lazy)
    if (!this._context) {
      this.createContext();
    }

    const ctx = this._context;
    if (!ctx) return;

    if (ctx.state === 'running') return;

    // Call native .resume() DIRECTLY in the gesture call stack.
    // Do NOT route through this.resume() — its async wrapper adds indirection
    // that can break the gesture-to-resume association on iOS Safari.
    log.debug(`${tag} Attempting AudioContext unlock, current state=${ctx.state}`);
    ctx.resume().then(() => {
      log.info(`${tag} AudioContext unlocked via ensureAudioReady`);
      this.removeResumeListeners();
    }).catch((error) => {
      log.warn(`${tag} ensureAudioReady resume failed (will retry on next gesture):`, error);
    });
  }

  /**
   * Internal: create the AudioContext and wire up fallback document listeners.
   */
  private createContext(): AudioContext {
    try {
      const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('AudioContext not supported in this browser');
      }
      this._context = new AudioContextClass({
        sampleRate: this._sampleRate,
        latencyHint: 'interactive',
      });

      log.info(`AudioContext created: sampleRate=${this._context.sampleRate}, state=${this._context.state}`);

      // Only setup fallback listeners if context starts suspended (iOS).
      // Desktop browsers typically start in 'running' — no need for extra listeners.
      if (this._context.state !== 'running') {
        this.setupResumeListener();
      }

      this._context.onstatechange = () => {
        log.debug(`AudioContext state changed: ${this._context?.state}`);
        // Remove listeners once context is running (successful unlock)
        if (this._context?.state === 'running') {
          this.removeResumeListeners();
        }
      };

    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-context-manager');
      throw error;
    }

    return this._context;
  }

  /**
   * Fallback document-level listeners for audio unlock.
   * These are a safety net — primary unlock happens via ensureAudioReady()
   * called from widget gesture handlers.
   */
  private setupResumeListener(): void {
    if (this._isResumeListenerAdded) {
      return;
    }

    // pointerdown fires before click; touchend is most reliable on iOS Safari
    this._listenerEvents = ['pointerdown', 'touchend', 'keydown'];

    this._interactionHandler = () => {
      // Don't remove listeners here — only remove once state is 'running'
      // (handled by onstatechange above)
      if (this._context && this._context.state !== 'running') {
        this._context.resume().catch(() => {
          // Will retry on next gesture — listeners stay attached
        });
      }
    };

    this._listenerEvents.forEach(event => {
      document.addEventListener(event, this._interactionHandler!, { passive: true });
    });

    this._isResumeListenerAdded = true;
    log.debug('Audio resume fallback listeners added');
  }

  /**
   * Remove resume listeners (only after context is running, or on cleanup)
   */
  private removeResumeListeners(): void {
    if (this._interactionHandler) {
      this._listenerEvents.forEach(event => {
        document.removeEventListener(event, this._interactionHandler!);
      });
      this._interactionHandler = null;
      this._listenerEvents = [];
      this._isResumeListenerAdded = false;
      log.debug('Audio resume fallback listeners removed');
    }
  }

  /**
   * Resume the AudioContext (call after user interaction)
   * Race-condition safe: multiple calls will share the same promise
   */
  async resume(): Promise<void> {
    if (!this._context) {
      return;
    }

    // Already running - nothing to do
    if (this._context.state === 'running') {
      return;
    }

    // Already resuming - return existing promise
    if (this._resumePromise) {
      return this._resumePromise;
    }

    // Start resume operation
    this._resumePromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Checked above
        await this._context!.resume();
        log.info('AudioContext resumed successfully');
        this.removeResumeListeners();
      } catch (error) {
        log.error('Failed to resume AudioContext:', error);
        errorBoundary.handleError(error as Error, 'audio-context-manager');
        // Re-throw to notify callers of failure
        throw error;
      } finally {
        // Clear promise after completion (success or failure)
        this._resumePromise = null;
      }
    })();

    return this._resumePromise;
  }

  /**
   * Suspend the AudioContext (save resources when not needed)
   * Race-condition safe: multiple calls will share the same promise
   */
  async suspend(): Promise<void> {
    if (!this._context) {
      return;
    }

    // Already suspended - nothing to do
    if (this._context.state === 'suspended') {
      return;
    }

    // Already suspending - return existing promise
    if (this._suspendPromise) {
      return this._suspendPromise;
    }

    // Start suspend operation
    this._suspendPromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Checked above
        await this._context!.suspend();
        log.debug('AudioContext suspended');
      } catch (error) {
        log.error('Failed to suspend AudioContext:', error);
        // Don't throw - suspend failures are less critical
      } finally {
        // Clear promise after completion
        this._suspendPromise = null;
      }
    })();

    return this._suspendPromise;
  }

  /**
   * Get current AudioContext state
   */
  getState(): AudioContextState | 'uninitialized' {
    return this._context?.state ?? 'uninitialized';
  }

  /**
   * Get the current sample rate
   */
  getSampleRate(): number {
    return this._context?.sampleRate ?? this._sampleRate;
  }

  /**
   * Get current time from AudioContext (for scheduling)
   */
  getCurrentTime(): number {
    return this._context?.currentTime ?? 0;
  }

  /**
   * Check if context is ready for playback
   */
  isReady(): boolean {
    return this._context !== null && this._context.state === 'running';
  }

  /**
   * Create a buffer source node
   */
  createBufferSource(): AudioBufferSourceNode | null {
    return this._context?.createBufferSource() ?? null;
  }

  /**
   * Create an audio buffer
   */
  createBuffer(numberOfChannels: number, length: number, sampleRate?: number): AudioBuffer | null {
    if (!this._context) return null;
    return this._context.createBuffer(
      numberOfChannels,
      length,
      sampleRate ?? this._context.sampleRate
    );
  }

  /**
   * Get the destination node
   */
  getDestination(): AudioDestinationNode | null {
    return this._context?.destination ?? null;
  }

  /**
   * Close the AudioContext (cleanup)
   */
  async close(): Promise<void> {
    // Remove any remaining document listeners to prevent memory leaks
    this.removeResumeListeners();

    if (this._context) {
      try {
        await this._context.close();
        log.info('AudioContext closed');
      } catch (error) {
        log.error('Failed to close AudioContext:', error);
      }
      this._context = null;
      this._isResumeListenerAdded = false;
    }
  }

  /**
   * Reset for testing purposes
   */
  _reset(): void {
    this.removeResumeListeners();
    this._context = null;
    this._isResumeListenerAdded = false;
    this._resumePromise = null;
    AudioContextManagerImpl._instance = null;
  }
}

// Export singleton instance
export const AudioContextManager = AudioContextManagerImpl.getInstance();

// Export type for dependency injection
export type { AudioContextManagerImpl };
