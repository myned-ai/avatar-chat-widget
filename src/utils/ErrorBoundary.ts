// Error Boundary and Handler

export class ErrorBoundary {
  private errorHandlers: Map<string, (error: Error) => void> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private readonly maxErrorsPerContext = 10;

  registerHandler(context: string, handler: (error: Error) => void): void {
    this.errorHandlers.set(context, handler);
  }

  handleError(error: Error, context: string): void {
    console.error(`[${context}]`, error);

    // Track error frequency
    const count = (this.errorCounts.get(context) || 0) + 1;
    this.errorCounts.set(context, count);

    // Circuit breaker: Stop handling if too many errors
    if (count > this.maxErrorsPerContext) {
      console.error(`Too many errors in context: ${context}. Circuit breaker triggered.`);
      this.notifyUser(`Service temporarily unavailable: ${context}`);
      return;
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

  reset(context?: string): void {
    if (context) {
      this.errorCounts.delete(context);
    } else {
      this.errorCounts.clear();
    }
  }

  getErrorCount(context: string): number {
    return this.errorCounts.get(context) || 0;
  }
}

// Singleton instance
export const errorBoundary = new ErrorBoundary();
