/**
 * LazyAvatar - Lazy-loads the heavy 3D avatar renderer
 * 
 * Provides a lightweight proxy that:
 * 1. Shows a placeholder/loading state immediately
 * 2. Loads the heavy renderer in the background
 * 3. Forwards all calls once loaded
 */

import type { ChatState, Disposable } from '../types/common';
import type { IAvatarController } from '../types/avatar';
import { logger } from '../utils/Logger';

const log = logger.scope('LazyAvatar');

export interface LazyAvatarOptions {
  /** Load immediately in background (default: true) */
  preload?: boolean;
  /** Callback when avatar is ready */
  onReady?: () => void;
  /** Callback on load error */
  onError?: (error: Error) => void;
  /** Show loading indicator */
  onLoadingStart?: () => void;
}

export class LazyAvatar implements IAvatarController, Disposable {
  private _container: HTMLDivElement;
  private _assetsPath: string;
  private _options: LazyAvatarOptions;
  
  private _avatar: IAvatarController | null = null;
  private _isLoading = false;
  private _isLoaded = false;
  private _loadPromise: Promise<void> | null = null;
  
  // Queue state changes until avatar loads
  private _pendingState: ChatState = 'Idle';
  private _pendingBlendshapes: Record<string, number> | null = null;
  private _liveBlendshapesEnabled = false;
  
  constructor(
    container: HTMLDivElement, 
    assetsPath: string,
    options: LazyAvatarOptions = {}
  ) {
    this._container = container;
    this._assetsPath = assetsPath;
    this._options = { preload: true, ...options };
    
    // Show placeholder
    this._showPlaceholder();
    
    // Start preloading if enabled
    if (this._options.preload) {
      this.load();
    }
  }
  
  /**
   * Show a lightweight placeholder while loading
   */
  private _showPlaceholder(): void {
    // Create a simple loading placeholder
    const placeholder = document.createElement('div');
    placeholder.id = 'avatar-placeholder';
    placeholder.style.cssText = `
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      color: #fff;
      font-family: system-ui, sans-serif;
    `;
    placeholder.innerHTML = `
      <div style="text-align: center;">
        <div class="avatar-loader" style="
          width: 60px;
          height: 60px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        "></div>
        <div style="opacity: 0.7; font-size: 14px;">Loading avatar...</div>
      </div>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    `;
    this._container.appendChild(placeholder);
  }
  
  /**
   * Remove placeholder when avatar is ready
   */
  private _removePlaceholder(): void {
    const placeholder = this._container.querySelector('#avatar-placeholder');
    if (placeholder) {
      placeholder.remove();
    }
  }
  
  /**
   * Load the heavy avatar renderer
   */
  public async load(): Promise<void> {
    if (this._isLoaded || this._isLoading) {
      return this._loadPromise ?? Promise.resolve();
    }
    
    this._isLoading = true;
    this._options.onLoadingStart?.();
    
    this._loadPromise = this._doLoad();
    return this._loadPromise;
  }
  
  private async _doLoad(): Promise<void> {
    try {
      // Dynamic import - this creates the separate chunk
      const { GaussianAvatar } = await import('./GaussianAvatar');
      
      // Remove placeholder before creating avatar
      this._removePlaceholder();
      
      // Create the actual avatar
      this._avatar = new GaussianAvatar(this._container, this._assetsPath);
      
      // Start rendering - this creates the canvas (await it!)
      if ('start' in this._avatar && typeof (this._avatar as { start?: () => Promise<void> }).start === 'function') {
        await (this._avatar as { start: () => Promise<void> }).start();
      }
      
      // Apply any pending state
      if (this._pendingState !== 'Idle') {
        this._avatar.setChatState(this._pendingState);
      }
      
      if (this._liveBlendshapesEnabled) {
        this._avatar.enableLiveBlendshapes();
      }
      
      if (this._pendingBlendshapes) {
        this._avatar.updateBlendshapes(this._pendingBlendshapes);
      }
      
      this._isLoaded = true;
      this._isLoading = false;
      this._options.onReady?.();
      
    } catch (error) {
      this._isLoading = false;
      const err = error instanceof Error ? error : new Error(String(error));
      this._options.onError?.(err);
      log.error('Failed to load avatar:', err);
      throw err;
    }
  }
  
  /**
   * Start rendering - triggers load if not already loading
   */
  public start(): void {
    if (this._avatar) {
      if ('start' in this._avatar && typeof (this._avatar as { start?: () => void }).start === 'function') {
        (this._avatar as { start: () => void }).start();
      }
    } else {
      // Will start automatically when loaded
      this.load();
    }
  }
  
  // === IAvatarController implementation ===
  
  public updateBlendshapes(weights: Record<string, number>): void {
    if (this._avatar) {
      this._avatar.updateBlendshapes(weights);
    } else {
      this._pendingBlendshapes = weights;
    }
  }
  
  public setChatState(state: ChatState): void {
    this._pendingState = state;
    if (this._avatar) {
      this._avatar.setChatState(state);
    }
  }

  public getChatState(): ChatState {
    if (this._avatar) {
      return this._avatar.getChatState();
    }
    return this._pendingState;
  }
  
  public enableLiveBlendshapes(): void {
    this._liveBlendshapesEnabled = true;
    if (this._avatar) {
      this._avatar.enableLiveBlendshapes();
    }
  }
  
  public disableLiveBlendshapes(): void {
    this._liveBlendshapesEnabled = false;
    this._pendingBlendshapes = null;
    if (this._avatar) {
      this._avatar.disableLiveBlendshapes();
    }
  }

  public pause(): void {
    if (this._avatar && 'pause' in this._avatar && typeof (this._avatar as { pause?: () => void }).pause === 'function') {
      (this._avatar as { pause: () => void }).pause();
    }
  }

  public resume(): void {
    if (this._avatar && 'resume' in this._avatar && typeof (this._avatar as { resume?: () => void }).resume === 'function') {
      (this._avatar as { resume: () => void }).resume();
    }
  }
  
  public dispose(): void {
    this._removePlaceholder();
    if (this._avatar) {
      this._avatar.dispose();
    }
    this._avatar = null;
    this._isLoaded = false;
  }
  
  // === Getters ===
  
  public get isLoaded(): boolean {
    return this._isLoaded;
  }
  
  public get isLoading(): boolean {
    return this._isLoading;
  }
}
