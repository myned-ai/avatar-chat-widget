/**
 * Generic Object Pool
 * Reuses objects to reduce GC pressure in hot paths
 *
 * Usage:
 * const pool = new ObjectPool(
 *   () => ({ weights: {}, timestamp: 0 }),  // factory
 *   (obj) => { obj.timestamp = 0; }          // reset
 * );
 *
 * const obj = pool.acquire();
 * // ... use obj ...
 * pool.release(obj);
 */

import { logger } from './Logger';

const log = logger.scope('ObjectPool');

export class ObjectPool<T> {
  private available: T[] = [];
  private inUse = new Set<T>();

  constructor(
    private factory: () => T,
    private reset: (obj: T) => void,
    initialSize: number = 10
  ) {
    // Pre-populate pool
    for (let i = 0; i < initialSize; i++) {
      this.available.push(factory());
    }
  }

  /**
   * Get an object from the pool
   * Creates a new one if pool is empty
   */
  acquire(): T {
    let obj = this.available.pop();

    if (!obj) {
      // Pool exhausted, create new object
      obj = this.factory();
    }

    this.inUse.add(obj);
    return obj;
  }

  /**
   * Return an object to the pool for reuse
   */
  release(obj: T): void {
    if (!this.inUse.has(obj)) {
      log.warn('Attempting to release object not from this pool');
      return;
    }

    this.inUse.delete(obj);

    // Reset object to initial state
    this.reset(obj);

    // Add back to available pool
    this.available.push(obj);
  }

  /**
   * Get pool statistics
   */
  getStats(): { available: number; inUse: number; total: number } {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size
    };
  }

  /**
   * Clear the pool (for cleanup)
   */
  clear(): void {
    this.available = [];
    this.inUse.clear();
  }
}

/**
 * Specialized pool for blendshape result objects
 * Pre-configured for BlendshapeBuffer hot path
 * OPTIMIZED: Uses passed arkitNames array to avoid redundant imports
 */

export interface PooledBlendshapeResult {
  weights: Record<string, number>;
  status: 'SPEAKING' | 'LISTENING';
  endOfSpeech: boolean;
}

export class BlendshapeResultPool {
  private pool: ObjectPool<PooledBlendshapeResult>;
  private arkitNames: readonly string[];

  constructor(arkitNames: string[], poolSize: number = 60) {
    // Store reference - avoid copying the array
    this.arkitNames = arkitNames;
    
    this.pool = new ObjectPool<PooledBlendshapeResult>(
      () => ({
        weights: this.createEmptyWeights(),
        status: 'LISTENING',
        endOfSpeech: false
      }),
      (obj) => {
        // Reset weights to zero - optimized loop
        const names = this.arkitNames;
        const weights = obj.weights;
        for (let i = 0; i < names.length; i++) {
          weights[names[i]] = 0;
        }
        obj.status = 'LISTENING';
        obj.endOfSpeech = false;
      },
      poolSize
    );
  }

  private createEmptyWeights(): Record<string, number> {
    const weights: Record<string, number> = {};
    const names = this.arkitNames;
    for (let i = 0; i < names.length; i++) {
      weights[names[i]] = 0;
    }
    return weights;
  }

  acquire() {
    return this.pool.acquire();
  }

  release(obj: PooledBlendshapeResult) {
    this.pool.release(obj);
  }

  getStats() {
    return this.pool.getStats();
  }

  clear() {
    this.pool.clear();
  }
}
