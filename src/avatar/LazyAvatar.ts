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

/**
 * Type for GaussianAvatar constructor (ensures type safety on dynamic import)
 */
type GaussianAvatarConstructor = new (container: HTMLDivElement, assetsPath: string) => IAvatarController & {
  start?: () => Promise<void> | void;
};

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

/**
 * Extended avatar controller type that includes optional start method
 * GaussianAvatar implements this extended interface
 */
type AvatarControllerWithStart = IAvatarController & {
  start?: () => Promise<void> | void;
};

export class LazyAvatar implements IAvatarController, Disposable {
  private _container: HTMLDivElement;
  private _assetsPath: string;
  private _options: LazyAvatarOptions;
  
  private _avatar: AvatarControllerWithStart | null = null;
  private _isLoading = false;
  private _isLoaded = false;
  private _loadPromise: Promise<void> | null = null;
  
  // Queue state changes until avatar loads
  private _pendingState: ChatState = 'Idle';
  private _pendingBlendshapes: Record<string, number> | null = null;
  private _liveBlendshapesEnabled = false;
  private _loadFailed = false;
  
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
   * Show error state when avatar fails to load
   * Replaces the loading spinner with a user-friendly error message
   */
  private _showErrorState(error: Error): void {
    this._removePlaceholder();
    this._loadFailed = true;
    
    const errorDiv = document.createElement('div');
    errorDiv.id = 'avatar-error';
    errorDiv.style.cssText = `
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
      color: #666;
      font-family: system-ui, sans-serif;
    `;
    errorDiv.innerHTML = `
      <div style="text-align: center; padding: 20px;">
        <div style="
          width: 60px;
          height: 60px;
          margin: 0 auto 16px;
          background: #e0e0e0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 15s1.5 2 4 2 4-2 4-2"/>
            <circle cx="9" cy="9" r="1" fill="#999"/>
            <circle cx="15" cy="9" r="1" fill="#999"/>
          </svg>
        </div>
        <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">Avatar unavailable</div>
        <div style="font-size: 12px; opacity: 0.7;">Chat is still available below</div>
      </div>
    `;
    this._container.appendChild(errorDiv);
    
    log.warn('Avatar load failed, showing fallback UI:', error.message);
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
      const module = await import('./GaussianAvatar');
      
      // Type-safe cast: GaussianAvatar must implement IAvatarController
      const GaussianAvatarClass = module.GaussianAvatar as GaussianAvatarConstructor;
      
      // Remove placeholder before creating avatar
      this._removePlaceholder();
      
      // Create the actual avatar (now properly typed)
      this._avatar = new GaussianAvatarClass(this._container, this._assetsPath);
      
      // Start rendering if the avatar has a start method
      if (this._avatar.start) {
        await this._avatar.start();
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
      
      // Show fallback UI instead of permanent spinner
      this._showErrorState(err);
      
      this._options.onError?.(err);
      log.error('Failed to load avatar:', err);
      // Don't re-throw - we've handled it gracefully with fallback UI
    }
  }
  
  /**
   * Start rendering - triggers load if not already loading
   */
  public start(): void {
    if (this._avatar) {
      // _avatar is typed as AvatarControllerWithStart which has optional start()
      if (this._avatar.start) {
        this._avatar.start();
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
    if (this._avatar?.pause) {
      this._avatar.pause();
    }
  }

  public resume(): void {
    if (this._avatar?.resume) {
      this._avatar.resume();
    }
  }
  
  public dispose(): void {
    this._removePlaceholder();
    // Also remove error state if present
    const errorEl = this._container.querySelector('#avatar-error');
    if (errorEl) {
      errorEl.remove();
    }
    if (this._avatar) {
      this._avatar.dispose();
    }
    this._avatar = null;
    this._isLoaded = false;
    this._loadFailed = false;
  }
  
  // === Getters ===
  
  public get isLoaded(): boolean {
    return this._isLoaded;
  }
  
  public get isLoading(): boolean {
    return this._isLoading;
  }
}
