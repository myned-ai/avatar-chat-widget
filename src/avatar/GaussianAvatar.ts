import * as GaussianSplats3D from "@myned-ai/gsplat-flame-avatar-renderer"
import { createNeutralWeights } from '../constants/arkit';
import { logger } from '../utils/Logger';
import type { Disposable, ChatState } from '../types/common';

const log = logger.scope('GaussianAvatar');

// Blink patterns matching server's BLINK_PATTERNS (7 frames each)
const BLINK_PATTERNS = [
  [0.1, 0.3, 0.7, 1.0, 0.7, 0.3, 0.1],
  [0.15, 0.4, 0.8, 1.0, 0.6, 0.25, 0.1],
  [0.1, 0.35, 0.75, 1.0, 0.75, 0.35, 0.1],
  [0.2, 0.5, 0.9, 1.0, 0.7, 0.3, 0.05],
];

// Blink intervals per state (min, max) in milliseconds
const BLINK_INTERVALS: Record<ChatState, [number, number]> = {
  'Idle': [2000, 4000],      // Relaxed: 2-4 seconds
  'Responding': [1300, 3300], // Speaking: natural rate
};

/**
 * GaussianAvatar - Gaussian Splat Avatar with Animation States
 * 
 * TWO animation systems work together:
 * 1. BODY ANIMATIONS (from animation.glb) - Controlled by ChatState:
 *    - 'Idle': Subtle idle movement
 *    - 'Hello': Attentive greeting posture (animation index 2)
 *    - 'Responding': Speaking body movements (head sway, gestures)
 *    
 * 2. FACIAL BLENDSHAPES (from LAM) - Real-time from audio:
 *    - 52 ARKit blendshapes control facial expressions
 *    - Mouth, eyes, brows sync with speech
 * 
 * The ChatState drives BODY animations while blendshapes drive FACE.
 */
export class GaussianAvatar implements Disposable {
  private _avatarDivEle: HTMLDivElement;
  private _assetsPath = "";
  public curState: ChatState = "Idle";
  private _renderer!: GaussianSplats3D.GaussianSplatRenderer;
  private forceEyesClosed = false;
  private liveBlendshapeData: Record<string, number> | null = null;
  private isPaused = false;
  private neutralBlendshapes: Record<string, number>;
  
  // Blink state (used for ALL states, not just idle)
  private lastBlinkTime = 0;
  private nextBlinkInterval = 2000; // ms between blinks
  private blinkFrame = -1; // -1 = not blinking, 0-6 = blink frame
  private currentBlinkPattern: number[] = BLINK_PATTERNS[0];
  private blinkIntensity = 1.0;
  private lastBlinkFrameTime = 0; // For frame timing at 30fps
  
  constructor(container: HTMLDivElement, assetsPath: string) {
    this._avatarDivEle = container;
    this._assetsPath = assetsPath;
    // Initialize neutral blendshapes using centralized constants
    this.neutralBlendshapes = createNeutralWeights();
    this._init();
  }
  
  private _init() {
    if (!this._avatarDivEle || !this._assetsPath) {
      throw new Error("Lack of necessary initialization parameters");
    }
  }

  public async start(): Promise<void> {
    await this.render();
  }

  /**
   * Closes the avatar's eyes by setting the appropriate blendshape/morph target.
   */
  public closeEyes() {
    this.forceEyesClosed = true;
  }

  public async render() {
    this._renderer = await GaussianSplats3D.GaussianSplatRenderer.getInstance(
      this._avatarDivEle,
      this._assetsPath,
      {
        getChatState: this.getChatState.bind(this),
        getExpressionData: this.getArkitFaceFrame.bind(this),
        backgroundColor: "0xffffff"
      },
    );
    
    this.startTime = performance.now() / 1000;
    // Initial state is 'Idle' - ChatManager will set appropriate states based on conversation
    // State flow: Idle → Hello (user interaction) → Responding (AI speaks) → Idle
    log.info('Avatar ready, initial state:', this.curState);
  }

  /**
   * Pause animation - returns neutral pose
   */
  public pause(): void {
    this.isPaused = true;
    log.debug('Avatar paused');
  }

  /**
   * Resume animation
   */
  public resume(): void {
    this.isPaused = false;
    log.debug('Avatar resumed');
  }
  
  private startTime = 0;
  
  public getChatState(): ChatState {
    return this.curState;
  }
  
  public setChatState(state: ChatState): void {
    if (this.curState !== state) {
      // Log with timestamp for easier debugging of animation state machine
      const timestamp = new Date().toLocaleTimeString();
      log.info(`[${timestamp}] Avatar state: ${this.curState} → ${state}`);
      this.curState = state;
    }
  }
  
  /**
   * Enable live blendshape streaming mode
   * (Kept for API compatibility, but no longer toggles behavior)
   */
  public enableLiveBlendshapes(): void {
    log.debug('Live blendshapes mode active');
  }
  
  /**
   * Disable live blendshapes - resets to idle state
   * (Kept for API compatibility - clears live data)
   */
  public disableLiveBlendshapes(): void {
    this.liveBlendshapeData = null;
    log.debug('Live blendshapes cleared');
  }
  
  /**
   * Update blendshapes from real-time stream
   * OpenAvatarChat pattern: Always accept updates, they're applied in getArkitFaceFrame
   */
  public updateBlendshapes(weights: Record<string, number>): void {
    this.liveBlendshapeData = weights;
  }
  
  /**
   * Get current blendshapes for rendering
   * Frontend handles ALL blinking - server blink values are overridden
   */
  public getArkitFaceFrame() {
    // Return neutral pose when paused
    if (this.isPaused) {
      return this.neutralBlendshapes;
    }
    
    let result: Record<string, number>;
    
    // Use live blendshapes if available (always - following OpenAvatarChat)
    if (this.liveBlendshapeData) {
      result = { ...this.liveBlendshapeData };
    } else {
      // No live data: use neutral pose
      result = { ...this.neutralBlendshapes };
    }
    
    // Force eyes closed if requested (overrides everything)
    if (this.forceEyesClosed) {
      result["eyeBlinkLeft"] = 1.0;
      result["eyeBlinkRight"] = 1.0;
      return result;
    }
    
    // Apply frontend-controlled blinking (overrides any server blink values)
    this.applyBlink(result);
    
    return result;
  }
  
  /**
   * Apply random blinking to blendshapes
   * Called for ALL states - frontend owns blinking entirely
   */
  private applyBlink(blendshapes: Record<string, number>): void {
    const now = performance.now();
    // Fallback to Idle intervals if state not found (safety for any edge cases)
    const [minInterval, maxInterval] = BLINK_INTERVALS[this.curState] || BLINK_INTERVALS['Idle'];
    
    // Check if we should start a new blink
    if (this.blinkFrame === -1) {
      if (now - this.lastBlinkTime >= this.nextBlinkInterval) {
        // Start new blink
        this.blinkFrame = 0;
        this.lastBlinkFrameTime = now;
        this.currentBlinkPattern = BLINK_PATTERNS[Math.floor(Math.random() * BLINK_PATTERNS.length)];
        this.blinkIntensity = 0.8 + Math.random() * 0.2; // 0.8 - 1.0
        // Schedule next blink based on current state
        this.nextBlinkInterval = minInterval + Math.random() * (maxInterval - minInterval);
      }
    }
    
    // Apply blink if in progress
    if (this.blinkFrame >= 0 && this.blinkFrame < 7) {
      const blinkValue = this.currentBlinkPattern[this.blinkFrame] * this.blinkIntensity;
      blendshapes["eyeBlinkLeft"] = blinkValue;
      blendshapes["eyeBlinkRight"] = blinkValue;
      
      // Advance blink frame at ~30fps (every 33ms)
      if (now - this.lastBlinkFrameTime >= 33) {
        this.blinkFrame++;
        this.lastBlinkFrameTime = now;
        
        if (this.blinkFrame >= 7) {
          // Blink complete
          this.blinkFrame = -1;
          this.lastBlinkTime = now;
        }
      }
    } else {
      // Not blinking - ensure eyes are open (override any server blink values)
      blendshapes["eyeBlinkLeft"] = 0;
      blendshapes["eyeBlinkRight"] = 0;
    }
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    this.liveBlendshapeData = null;
    log.debug('GaussianAvatar disposed');
  }
}