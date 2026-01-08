// Centralized Logging System with Log Levels
// Reduces CPU overhead by skipping string formatting when log level is disabled

export const LogLevel = {
  None: 0,
  Error: 1,
  Warning: 2,
  Info: 3,
  Debug: 4
} as const;

export type LogLevelType = typeof LogLevel[keyof typeof LogLevel];

// Detect development mode safely (works in Vite and bundled contexts)
const isDevelopment = (): boolean => {
  try {
    // Vite injects these at build time - use dynamic access to avoid TS errors
    const meta = (import.meta as any);
    if (meta?.env) {
      return meta.env.DEV === true || meta.env.MODE === 'development';
    }
  } catch {
    // Ignore - not in Vite context
  }
  return false;
};

// Default to Info in production, Debug in development
const DEFAULT_LEVEL: LogLevelType = isDevelopment() ? LogLevel.Debug : LogLevel.Info;

class Logger {
  private level: LogLevelType = DEFAULT_LEVEL;

  /**
   * Set the current log level
   * Messages below this level will be completely skipped (no string formatting)
   */
  setLevel(level: LogLevelType): void {
    this.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevelType {
    return this.level;
  }

  /**
   * Debug level - verbose information for development
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.Debug) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Info level - general operational information
   */
  info(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.Info) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  /**
   * Warning level - potential issues that don't stop operation
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.Warning) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  /**
   * Error level - errors that affect operation
   */
  error(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.Error) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  /**
   * Create a scoped logger with a prefix
   * Useful for per-module logging
   */
  scope(name: string): ScopedLogger {
    return new ScopedLogger(this, name);
  }
}

class ScopedLogger {
  constructor(private parent: Logger, private scope: string) {}

  debug(message: string, ...args: unknown[]): void {
    this.parent.debug(`[${this.scope}] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.parent.info(`[${this.scope}] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.parent.warn(`[${this.scope}] ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.parent.error(`[${this.scope}] ${message}`, ...args);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export type for scoped loggers
export type { ScopedLogger };
