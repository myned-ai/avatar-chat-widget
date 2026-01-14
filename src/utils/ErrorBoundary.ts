// Error Boundary and Handler with Time-Windowed Circuit Breaker

interface ErrorWindow {
  count: number;
  firstError: number;
  circuitOpen: boolean;
  circuitOpenedAt?: number;
}

export class ErrorBoundary {
  private readonly errorHandlers: Map<string, (error: Error) => void> = new Map();
  private readonly errorWindows: Map<string, ErrorWindow> = new Map();
  private readonly maxErrorsPerWindow = 10;
  private readonly errorWindowMs = 60000; // 1 minute
  private readonly circuitResetMs = 30000; // 30 seconds to try recovery

  registerHandler(context: string, handler: (error: Error) => void): void {
    this.errorHandlers.set(context, handler);
  }

  handleError(error: Error, context: string): void {
    console.error(`[${context}]`, error);

    const now = Date.now();
    const errorWindow = this.errorWindows.get(context);

    // Check if circuit breaker is open
    if (errorWindow?.circuitOpen) {
      // Try to reset circuit after cooldown period
      if (errorWindow.circuitOpenedAt && (now - errorWindow.circuitOpenedAt) > this.circuitResetMs) {
        console.info(`[${context}] Circuit breaker reset attempt - clearing error history`);
        this.errorWindows.delete(context);
      } else {
        // Still in cooldown - skip error handling
        console.warn(`[${context}] Circuit breaker open - error suppressed`);
        return;
      }
    }

    // Initialize or update error window
    if (!errorWindow || (now - errorWindow.firstError) > this.errorWindowMs) {
      // Start new error window
      this.errorWindows.set(context, {
        count: 1,
        firstError: now,
        circuitOpen: false,
      });
    } else {
      // Increment error count in current window
      errorWindow.count++;

      // Trip circuit breaker if threshold exceeded
      if (errorWindow.count > this.maxErrorsPerWindow) {
        errorWindow.circuitOpen = true;
        errorWindow.circuitOpenedAt = now;
        console.error(
          `[${context}] Too many errors (${errorWindow.count} in ${this.errorWindowMs}ms). Circuit breaker triggered for ${this.circuitResetMs}ms.`
        );
        this.notifyUser(`Service temporarily unavailable: ${context}. Retrying in ${this.circuitResetMs / 1000}s...`);
        return;
      }
    }

    // Call custom handler if registered
    const handler = this.errorHandlers.get(context);
    if (handler) {
      try {
        handler(error);
      } catch (handlerError) {
        console.error('Error in error handler:', handlerError);
      }
    }

    // Provide user-friendly messages
    this.handleSpecificError(error, context);
  }

  private handleSpecificError(error: Error, context: string): void {
    const errorMap: Record<string, string> = {
      'websocket': 'Connection lost. Attempting to reconnect...',
      'audio-input': 'Microphone unavailable. Please check permissions.',
      'audio-output': 'Audio playback failed. Check your speakers.',
      'blendshape': 'Avatar animation paused. Will resume shortly.',
    };

    const message = errorMap[context] || `An error occurred in ${context}`;
    this.notifyUser(message);
  }

  private notifyUser(message: string): void {
    // Emit notification event (can be caught by UI)
    const event = new CustomEvent('app-notification', {
      detail: { message, type: 'error' }
    });
    window.dispatchEvent(event);
  }

  /**
   * Reset error tracking for a context (or all contexts)
   */
  reset(context?: string): void {
    if (context) {
      this.errorWindows.delete(context);
    } else {
      this.errorWindows.clear();
    }
  }

  /**
   * Get current error count for a context
   */
  getErrorCount(context: string): number {
    return this.errorWindows.get(context)?.count || 0;
  }

  /**
   * Check if circuit breaker is open for a context
   */
  isCircuitOpen(context: string): boolean {
    return this.errorWindows.get(context)?.circuitOpen || false;
  }

  /**
   * Get error window stats for monitoring/debugging
   */
  getStats(context: string): ErrorWindow | null {
    return this.errorWindows.get(context) || null;
  }
}

// Singleton instance
export const errorBoundary = new ErrorBoundary();
