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
   * Get or create the shared AudioContext
   * @param sampleRate Optional sample rate (only used on first creation)
   */
  getContext(sampleRate?: number): AudioContext {
    if (this._context) {
      return this._context;
    }

    if (sampleRate) {
      this._sampleRate = sampleRate;
    }

    try {
      const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('AudioContext not supported in this browser');
      }
      this._context = new AudioContextClass({
        sampleRate: this._sampleRate,
        latencyHint: 'interactive', // Optimize for real-time
      });

      log.info(`AudioContext created: sampleRate=${this._context.sampleRate}, state=${this._context.state}`);

      // Setup single resume listener for entire app
      this.setupResumeListener();

      // Handle context state changes
      this._context.onstatechange = () => {
        log.debug(`AudioContext state changed: ${this._context?.state}`);
      };

    } catch (error) {
      errorBoundary.handleError(error as Error, 'audio-context-manager');
      throw error;
    }

    return this._context;
  }

  /**
   * Setup a single click listener to resume AudioContext (browser policy)
   * This replaces multiple listeners scattered across services
   */
  private setupResumeListener(): void {
    if (this._isResumeListenerAdded) {
      return;
    }

    const resumeHandler = async () => {
      await this.resume();
    };

    // Use multiple event types for better mobile support
    const events = ['click', 'touchstart', 'keydown'];
    
    const removeListeners = () => {
      events.forEach(event => {
        document.removeEventListener(event, onInteraction);
      });
    };

    const onInteraction = async () => {
      removeListeners();
      await resumeHandler();
    };

    events.forEach(event => {
      document.addEventListener(event, onInteraction, { once: true, passive: true });
    });

    this._isResumeListenerAdded = true;
    log.debug('Audio resume listeners added');
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
