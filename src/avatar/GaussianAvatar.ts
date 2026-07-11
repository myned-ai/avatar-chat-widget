import * as GaussianSplats3D from "@myned-ai/gsplat-flame-avatar-renderer"
import { TextureLoader, SRGBColorSpace, Object3D, type Scene } from 'three';
import { createNeutralWeights } from '../constants/arkit';
import { logger } from '../utils/Logger';
import { EnergyEnvelope, ENERGY_FEED_STALE_SEC } from './EnergyEnvelope';
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
// Listening blinks more like a speaker than a passive Idle:
// Hess 1965 / Holland & Tarlow 1975 — blink rate rises with cognitive load
// (active listening, backchannel signaling). Same band as Responding.
const BLINK_INTERVALS: Record<ChatState, [number, number]> = {
  'Idle': [2000, 4000],      // Relaxed, not in conversation: 2-4 seconds
  'Listening': [1500, 3300], // User speaking, avatar engaged: slightly faster
  'Responding': [1300, 3300], // Avatar speaking: natural rate
};

// ─── Procedural gaze (saccade scheduler) ────────────────────────────────────
// Ported from worldforge/smartbody me_ct_saccade.cpp parameters (Lee & Badler
// "Eyes Alive" SIGGRAPH 2002). SmartBody stores times in centiseconds;
// converted here to milliseconds.
//
// Per-state behavior:
//   Idle (not in conversation) — eyes ACTIVE: shorter mutual hold, lower return
//     probability so they look around more, bigger sweep magnitude
//   Listening (user is speaking) — eyes FOCUSED on speaker: ~75% mutual fixation
//     per Eyes Alive, smaller sweeps, faster returns to mutual
//   Responding (talking) — eyes FOCUSED on listener: longer mutual hold, higher
//     return probability, smaller sweep magnitude
const SACCADE_BY_STATE: Record<ChatState, {
  mutualMean: number; mutualSigma: number; returnProb: number;
  awayMean: number;   awaySigma: number;
  magnitudeMaxDeg: number;
}> = {
  // Not in conversation → calm, waiting gaze. A service avatar at rest
  // should read as attentive toward the user, not scanning the room:
  // long mutual holds with an occasional brief glance away (human
  // conversational aversions recur on the order of 5-7 s and last 1-2 s;
  // Andrist et al. 2014).
  'Idle': {
    mutualMean: 2500, mutualSigma: 600, returnProb: 0.70,
    awayMean:    220, awaySigma:    80,
    magnitudeMaxDeg: 8,
  },
  // User speaking → listener-focused gaze.
  // Lee & Badler "Eyes Alive" SIGGRAPH 2002: listeners hold mutual gaze ~75% of
  // the time vs speakers' ~41%. Counter-intuitively the *listener* is the more
  // focused party in dyadic conversation.
  // Solved for mutualMean/(mutualMean + awayMean/returnProb) ≈ 0.76:
  //   1300/(1300 + 200/0.5) = 0.76 ✓
  // Smaller magnitude (8°) keeps the focused look stable; faster mean away with
  // higher returnProb biases the wanderings back to mutual gaze.
  'Listening': {
    mutualMean: 1300, mutualSigma: 250, returnProb: 0.50,
    awayMean:   200, awaySigma:    60,
    magnitudeMaxDeg: 8,
  },
  // Talking → counter-intuitively LESS focused on listener.
  // Verified from Lee & Badler "Eyes Alive" (SIGGRAPH 2002) via SmartBody source
  // (worldforge/smartbody/me_ct_saccade.cpp TALKING mode parameters).
  // Speakers look away ~60% of the time to plan / think / form words.
  // Numbers converted from centiseconds: 93.9cs→939ms, √94.9≈97ms σ, 27.8cs→278ms, √24.0≈49ms σ.
  'Responding': {
    mutualMean: 1400, mutualSigma: 300, returnProb: 0.41,
    awayMean:    278, awaySigma:    49,
    magnitudeMaxDeg: 10,
  },
};

// State-independent constants (movement physics + ARKit mapping)
// Main sequence (Lee & Badler "Eyes Alive" SIGGRAPH 2002, verified from SmartBody source):
//   duration_seconds = INTERCEPT + SLOPE × amplitude_degrees
// → 3° saccade = 32 ms, 10° = 49 ms, 12° = 54 ms. Biologically grounded.
const SACCADE_DURATION_INTERCEPT_S = 0.025;
const SACCADE_DURATION_SLOPE_S_PER_DEG = 0.0024;
const SACCADE_DURATION_MIN_MS = 25;          // floor — never instantaneous
const SACCADE_ARKIT_DEG_PER_UNIT = 30;       // nominal ARKit scale — used in debug logs only
// Eye morph rotation scales in degrees per unit of morph influence, measured
// from the mesh (morph displacement ÷ eyeball radius; left eye, right
// assumed mirrored). The rig's eye morphs are asymmetric (out ≠ in), so
// driving both eyes with one shared value produces unequal binocular
// rotation (vergence error). Estimates carry some eyelid-follow
// contamination — refine empirically if gaze over/under-shoots.
const EYE_DEG_PER_UNIT = { out: 21.4, in: 9.6, up: 14.2, down: 11.9 };
// Jitter applied on each mutual-gaze re-pick. True microsaccades are
// sub-degree (classical bound ~0.25°; Collewijn & Kowler 2008) — larger
// values read as deliberate re-fixations and make steady gaze look flicky.
const SACCADE_MICROSACCADE_DEG  = 0.25;

// Gaze realization is renderer-side: the renderer solves a camera look-at
// against the head bone's true world pose (baked clip + procedural delta)
// and adds the behavioral offset provided via getGazeOffset. Widget-side
// head compensation was removed — it could only see the procedural
// component and would double-compensate once the look-at is active.

// Pejsa et al. (Eurographics 2013, "Stylized and Performative Gaze") argue that
// biological gaze parameters need to be SLOWED DOWN for character animation.
// Real eyes move faster than viewers expect to see on a virtual character.
// Multiplier applies to BOTH hold durations and saccade transitions.
//   1.0 = pure biological (twitchy on a render)
//   1.5 = mild stylization
//   2.0 = canonical Pejsa stylization
//   2.5+ = explicitly slow / cinematic
const GAZE_PACE_MULTIPLIER = 2.0;

// Audio-driven pause detection. Kendon 1967 + "Knowing Where to Look" (arXiv
// 2210.02866) — speakers avert gaze during planning pauses, not randomly through
// fluent speech. We compute RMS energy from the SyncPlayback PCM stream, smooth
// it with an EMA, then hysteretically enter "in pause" mode once we've seen
// PAUSE_ENTER_MS of low energy. Faster to exit (PAUSE_EXIT_MS) to prevent flicker.
//
// The pause detector reads the head-motion energy envelope (perceptual, 0..1),
// entering "in pause" after PAUSE_ENTER_MS below threshold and exiting faster
// (PAUSE_EXIT_MS) to avoid flicker.
const PAUSE_ENERGY_THRESHOLD = 0.05;
const PAUSE_ENTER_MS = 400;          // canonical 800ms canon, halved for TTS pauses
const PAUSE_EXIT_MS = 100;

// During Responding-mode saccade picks, the returnProb (chance of staying on
// mutual gaze) shifts based on whether we're in a pause:
//   in fluent speech  → bias TOWARD listener (look at them while talking)
//   in a pause        → bias AWAY (cluster gaze aversions at pauses)
// Strong mutual bias while speaking fluently; pauses still bias away but
// gently — the avatar keeps focus on the user while talking, and the
// look-away behavior belongs primarily to idle/thinking.
const RESPONDING_FLUENT_RETURN_PROB = 0.92;
const RESPONDING_PAUSE_RETURN_PROB  = 0.55;

const EYE_LOOK_CHANNELS = [
  'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeLookDownLeft', 'eyeLookDownRight',
];

/** Box-Muller Gaussian, clipped to [min, max]. */
function sampleGaussian(mean: number, sigma: number, min = 50, max = Infinity): number {
  for (let i = 0; i < 10; i++) {
    const u1 = Math.max(1e-9, Math.random());
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const v = mean + sigma * z;
    if (v >= min && v <= max) return v;
  }
  return Math.min(max, Math.max(min, mean));
}

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
  private _backgroundImage?: string;
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

  // Procedural gaze state (drives the 8 ARKit eyeLook* channels every frame)
  private gazeMode: 'mutual' | 'away' = 'mutual';
  private gazeStartYawDeg = 0;
  private gazeStartPitchDeg = 0;
  private gazeTargetYawDeg = 0;
  private gazeTargetPitchDeg = 0;
  private gazeTransitionStartMs = 0;
  private gazeTransitionDurationMs = 100;
  private nextGazeChangeMs = 0; // 0 = not yet initialised

  // Audio-RMS-driven pause detection (Responding only). When the avatar is
  // speaking, the saccade scheduler consults `inSpeechPause` to bias away
  // glances toward actual pauses in the audio (Kendon turn-holding cue).
  private msInLowEnergy = 0;                    // contiguous ms below threshold
  private msInHighEnergy = 0;                   // contiguous ms above threshold
  private inSpeechPause = false;                // hysteretic pause state

  // Speech-energy envelope feeding the pause detector above. Head/neck motion
  // itself is fully owned by the authored clips in the renderer — the widget
  // sends no procedural head pose.
  private readonly _speechEnergy = new EnergyEnvelope();
  private _lastRawRms = 0;
  private _lastRmsMs = 0;
  private _lastPauseUpdateMs = 0;

  // Behavioral gaze offset from the camera axis (degrees); see getGazeOffset.
  private readonly _gazeOffset = { yawDeg: 0, pitchDeg: 0 };
  
  constructor(container: HTMLDivElement, assetsPath: string, backgroundImage?: string) {
    this._avatarDivEle = container;
    this._assetsPath = assetsPath;
    this._backgroundImage = backgroundImage;
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

  /**
   * Behavioral gaze offset from the camera axis, in degrees ({0,0} = mutual
   * gaze at the camera). Consumed once per frame by the renderer's camera
   * look-at, which solves the eye rotation against the head's true world
   * pose and adds this offset. Returns a cached object — allocation-free.
   */
  public getGazeOffset(): { yawDeg: number, pitchDeg: number } {
    return this._gazeOffset;
  }

  public async render() {
    this._renderer = await GaussianSplats3D.GaussianSplatRenderer.getInstance(
      this._avatarDivEle,
      this._assetsPath,
      {
        getChatState: this.getChatState.bind(this),
        getExpressionData: this.getArkitFaceFrame.bind(this),
        // Supported by the current renderer build; not yet in the published
        // package's type declarations, hence the cast below.
        getGazeOffset: this.getGazeOffset.bind(this),
        backgroundColor: "0xffffff"
      } as unknown as Parameters<typeof GaussianSplats3D.GaussianSplatRenderer.getInstance>[2],
    );

    if (this._backgroundImage) {
      this._applySceneBackground(this._backgroundImage);
    }

    this.startTime = performance.now() / 1000;
    // Initial state is 'Idle' - ChatManager will set appropriate states based on conversation
    // State flow: Idle → Hello (user interaction) → Responding (AI speaks) → Idle
    log.info('Avatar ready, initial state:', this.curState);
  }

  /**
   * Set the scene background to an image. Replaces the renderer's white clear color
   * so the photo shows behind the splats instead of being covered by the canvas.
   *
   * The renderer (gsplat-flame-avatar-renderer) skips the threeScene render entirely
   * when threeScene has no visible children, so we also add a dummy Object3D to force
   * the scene-render path to run — that's what actually paints scene.background.
   */
  private _applySceneBackground(url: string): void {
    try {
      // Runtime scene is `viewer.threeScene` (the .d.ts file mislabels it as `scene`)
      const viewer = this._renderer?.viewer as unknown as { threeScene?: Scene; forceRenderNextFrame?: () => void } | undefined;
      const scene = viewer?.threeScene;
      if (!scene) {
        log.warn('Cannot apply scene background: viewer.threeScene not available');
        return;
      }

      // Force hasRenderables() to return true so the renderer takes the scene-render path
      if (!scene.children.some((c) => c.userData?.__bgAnchor)) {
        const anchor = new Object3D();
        anchor.userData.__bgAnchor = true;
        scene.add(anchor);
      }

      new TextureLoader().load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          scene.background = texture;
          viewer?.forceRenderNextFrame?.();
          log.debug('Scene background applied');
        },
        undefined,
        (err) => log.warn('Failed to load scene background image', { url, err }),
      );
    } catch (err) {
      log.warn('applySceneBackground failed', err);
    }
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
    // The renderer's Listening state has no clips of its own — it plays a
    // clone of the idle clip through a code path with known re-entry bugs
    // (upstream never exercised it: their demo ran Listening for one second
    // and their widget never sent a valid Listening state at all). Reporting
    // Idle instead keeps the primary idle action looping continuously across
    // listening phases — same visual, none of the clone lifecycle. Widget
    // behaviors (gaze, blinks, arbiter) still see the real state.
    if (this.curState === 'Listening') return 'Idle';
    return this.curState;
  }
  
  // ─── State-write trace ──────────────────────────────────────────────────
  // Counts every write (including redundant same-state writes) per source so
  // state churn can be audited against real writer behavior. ISO timestamps
  // allow correlation with server-side logs.
  private _stateEnteredAtMs = performance.now();
  private _stateWriteCounts: Record<string, number> = {};

  public setChatState(state: ChatState, source = 'untagged'): void {
    this._stateWriteCounts[source] = (this._stateWriteCounts[source] || 0) + 1;
    if (this.curState !== state) {
      const nowMs = performance.now();
      const dwellMs = Math.round(nowMs - this._stateEnteredAtMs);
      log.debug(
        `[state-trace] ${new Date().toISOString()} ${source}: ${this.curState} → ${state}`
        + ` | dwell=${dwellMs}ms | writesSinceLastChange=${JSON.stringify(this._stateWriteCounts)}`
      );
      this._stateWriteCounts = {};
      this._stateEnteredAtMs = nowMs;
      const prev = this.curState;
      this.curState = state;

      // Turn-yielding gaze (Kendon 1967): speakers look AT the listener at the
      // end of a long turn to signal they're done. When we leave the
      // Responding state, force the next saccade to fire immediately and
      // return to mutual gaze.
      if (prev === 'Responding' && state !== 'Responding') {
        this.gazeMode = 'away';                     // pretend we were just away
        this.nextGazeChangeMs = performance.now();  // fire next saccade NOW
        // Also clear any speech-pause state since we're not speaking anymore
        this.inSpeechPause = false;
        this.msInLowEnergy = 0;
        this.msInHighEnergy = 0;
      }
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
    log.debug('[teardown] live blendshapes cleared — face falls back to neutral');
  }
  
  /**
   * Update blendshapes from real-time stream
   * OpenAvatarChat pattern: Always accept updates, they're applied in getArkitFaceFrame
   */
  public updateBlendshapes(weights: Record<string, number>): void {
    this.liveBlendshapeData = weights;
  }

  /**
   * Feed the RMS energy of an audio frame. Only the raw sample is captured
   * here; the envelope is advanced at render rate by the pause detector, so
   * the signal is decoupled from audio-callback timing. RMS is linear [0, 1].
   */
  public updateAudioRMS(rms: number): void {
    this._lastRawRms = Math.max(0, rms);
    this._lastRmsMs = performance.now();
  }

  /**
   * Hysteretic speech-pause detector for gaze-aversion clustering, advanced
   * once per rendered frame. Drives the speech-energy envelope from the last
   * raw RMS sample (a stale feed reads as silence, so the envelope releases
   * smoothly when playback stops).
   */
  private _updatePauseState(nowMs: number): void {
    const dt = this._lastPauseUpdateMs === 0
      ? 16 : Math.min(100, nowMs - this._lastPauseUpdateMs);
    this._lastPauseUpdateMs = nowMs;

    const rmsIsFresh = this._lastRmsMs !== 0
      && (nowMs - this._lastRmsMs) / 1000 < ENERGY_FEED_STALE_SEC;
    const energy = this._speechEnergy.update(rmsIsFresh ? this._lastRawRms : 0, dt / 1000);

    if (energy < PAUSE_ENERGY_THRESHOLD) {
      this.msInLowEnergy += dt;
      this.msInHighEnergy = 0;
      if (!this.inSpeechPause && this.msInLowEnergy >= PAUSE_ENTER_MS) {
        this.inSpeechPause = true;
      }
    } else {
      this.msInHighEnergy += dt;
      this.msInLowEnergy = 0;
      if (this.inSpeechPause && this.msInHighEnergy >= PAUSE_EXIT_MS) {
        this.inSpeechPause = false;
      }
    }
  }
  
  // Face-output continuity gate. The emitted frame may never jump: live
  // frames pass through untouched (lipsync must track the audio exactly),
  // but when live data is absent — turn end, interruption, teardown of any
  // kind — the output eases from the LAST EMITTED frame to neutral with
  // per-region release rates (mouth fastest: residual jaw-open after silence
  // reads as an error; brows slowest, matching natural expression offset).
  // Continuity is enforced here at the output layer so no upstream code
  // path is able to snap the face.
  private _faceOut: Record<string, number> | null = null;
  private _faceReleaseAlpha: Record<string, number> = {};

  private static _releaseAlphaFor(key: string): number {
    // Per-frame EMA rates at ~60 Hz: mouth ≈95% released in ~180 ms,
    // brows ~350 ms, everything else ~280 ms.
    if (key.startsWith('mouth') || key.startsWith('jaw') || key.startsWith('tongue')) return 0.24;
    if (key.startsWith('brow')) return 0.13;
    return 0.16;
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

    // Canonical output object + per-channel release rates, built once.
    if (!this._faceOut) {
      this._faceOut = { ...this.neutralBlendshapes };
      for (const k of Object.keys(this.neutralBlendshapes)) {
        this._faceReleaseAlpha[k] = GaussianAvatar._releaseAlphaFor(k);
      }
    }
    const result = this._faceOut;

    if (this.liveBlendshapeData) {
      // Live stream present: pass through (and remember what we emitted).
      const live = this.liveBlendshapeData;
      for (const k in result) result[k] = live[k] ?? 0;
    } else {
      // No live data: glide from the last emitted frame toward neutral.
      for (const k in result) {
        const tgt = this.neutralBlendshapes[k] ?? 0;
        const next = result[k] + (tgt - result[k]) * this._faceReleaseAlpha[k];
        result[k] = Math.abs(next - tgt) < 0.001 ? tgt : next;
      }
    }
    
    // Force eyes closed if requested (overrides everything)
    if (this.forceEyesClosed) {
      result["eyeBlinkLeft"] = 1.0;
      result["eyeBlinkRight"] = 1.0;
      return result;
    }
    
    // Apply frontend-controlled blinking (overrides any server blink values)
    this.applyBlink(result);

    // Apply procedural gaze (overrides any server eyeLook* values)
    this.applyGaze(result);

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
   * Apply procedural eye gaze (saccade scheduler) to the 8 ARKit eyeLook*
   * channels. Overrides any server-supplied gaze values.
   *
   * State machine: 'mutual' (looking at camera, with µ-saccade jitter) ↔ 'away'
   * (brief glance to a corner within ±10° yaw/pitch). Hold durations sampled
   * from Gaussians derived from SmartBody's LISTENING-mode parameters, which
   * trace back to Lee & Badler's "Eyes Alive" SIGGRAPH 2002 data.
   *
   * Saccade transition itself is fast (50-150ms) with ease-out cubic.
   */
  private applyGaze(blendshapes: Record<string, number>): void {
    const now = performance.now();
    this._updatePauseState(now);
    // Pick the saccade config for the current ChatState (Idle = active eyes,
    // Responding = focused eyes). Falls back to Idle for any unknown state.
    const cfg = SACCADE_BY_STATE[this.curState] || SACCADE_BY_STATE['Idle'];

    // First-call init: schedule the first gaze change
    if (this.nextGazeChangeMs === 0) {
      this.nextGazeChangeMs = now + sampleGaussian(cfg.mutualMean, cfg.mutualSigma, 200);
    }

    // Time to pick a new gaze target?
    if (now >= this.nextGazeChangeMs) {
      const wasMutual = this.gazeMode === 'mutual';

      // During Responding, the audio-RMS pause detector swaps the return-prob:
      //   fluent speech (no pause) → strongly bias toward mutual gaze (0.85)
      //   in speech pause          → bias toward looking away (0.25)
      // This clusters away-glances at actual pauses (Kendon) instead of
      // sprinkling them randomly through fluent stretches.
      let returnProb = cfg.returnProb;
      if (this.curState === 'Responding') {
        returnProb = this.inSpeechPause
          ? RESPONDING_PAUSE_RETURN_PROB
          : RESPONDING_FLUENT_RETURN_PROB;
      }

      const stayOrReturnToMutual = wasMutual
        ? Math.random() < returnProb
        : true;                            // always return to mutual after away
      this.gazeMode = stayOrReturnToMutual ? 'mutual' : 'away';

      this.gazeStartYawDeg = this.gazeTargetYawDeg;
      this.gazeStartPitchDeg = this.gazeTargetPitchDeg;

      if (stayOrReturnToMutual) {
        const j = SACCADE_MICROSACCADE_DEG;
        this.gazeTargetYawDeg = (Math.random() - 0.5) * 2 * j;
        this.gazeTargetPitchDeg = (Math.random() - 0.5) * 2 * j;
      } else {
        // Sweep to a random off-camera target within ±cfg.magnitudeMaxDeg
        const r = Math.sqrt(Math.random()) * cfg.magnitudeMaxDeg;
        const theta = Math.random() * 2 * Math.PI;
        this.gazeTargetYawDeg = r * Math.cos(theta);
        this.gazeTargetPitchDeg = r * Math.sin(theta);
      }

      this.gazeTransitionStartMs = now;
      // Main-sequence saccade duration scaled by GAZE_PACE_MULTIPLIER (Pejsa
      // stylization). dur_s = (0.025 + 0.0024 × amp_deg) × pace_multiplier.
      const ampYaw = this.gazeTargetYawDeg - this.gazeStartYawDeg;
      const ampPitch = this.gazeTargetPitchDeg - this.gazeStartPitchDeg;
      const amplitudeDeg = Math.sqrt(ampYaw * ampYaw + ampPitch * ampPitch);
      const biologicalDurationMs = 1000 *
        (SACCADE_DURATION_INTERCEPT_S + SACCADE_DURATION_SLOPE_S_PER_DEG * amplitudeDeg);
      this.gazeTransitionDurationMs = Math.max(
        SACCADE_DURATION_MIN_MS,
        biologicalDurationMs * GAZE_PACE_MULTIPLIER,
      );

      const holdMean = (this.gazeMode === 'mutual' ? cfg.mutualMean : cfg.awayMean) * GAZE_PACE_MULTIPLIER;
      const holdSigma = (this.gazeMode === 'mutual' ? cfg.mutualSigma : cfg.awaySigma) * GAZE_PACE_MULTIPLIER;
      this.nextGazeChangeMs = now + this.gazeTransitionDurationMs
        + sampleGaussian(holdMean, holdSigma);

      // Debug log per saccade-change. Compute the blendshape values the eyes
      // will land on so user can verify both eyes get the same magnitude.
      const targetYawUnits   = Math.min(Math.abs(this.gazeTargetYawDeg)   / SACCADE_ARKIT_DEG_PER_UNIT, 1);
      const targetPitchUnits = Math.min(Math.abs(this.gazeTargetPitchDeg) / SACCADE_ARKIT_DEG_PER_UNIT, 1);
      const yawSide   = this.gazeTargetYawDeg   > 0 ? 'right' : this.gazeTargetYawDeg   < 0 ? 'left'  : 'centre';
      const pitchSide = this.gazeTargetPitchDeg > 0 ? 'up'    : this.gazeTargetPitchDeg < 0 ? 'down'  : 'centre';
      log.debug(
        `[gaze] mode=${this.gazeMode} state=${this.curState} ` +
        `target: yaw=${this.gazeTargetYawDeg.toFixed(2)}° (${yawSide}, ${targetYawUnits.toFixed(3)} unit) ` +
        `pitch=${this.gazeTargetPitchDeg.toFixed(2)}° (${pitchSide}, ${targetPitchUnits.toFixed(3)} unit) ` +
        `transition=${this.gazeTransitionDurationMs.toFixed(0)}ms ` +
        `hold≈${(this.nextGazeChangeMs - now - this.gazeTransitionDurationMs).toFixed(0)}ms`,
      );
    }

    // Interpolate during saccade with ease-out cubic
    const elapsed = now - this.gazeTransitionStartMs;
    const t = Math.min(elapsed / this.gazeTransitionDurationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const curYaw = this.gazeStartYawDeg
      + (this.gazeTargetYawDeg - this.gazeStartYawDeg) * eased;
    const curPitch = this.gazeStartPitchDeg
      + (this.gazeTargetPitchDeg - this.gazeStartPitchDeg) * eased;

    // Publish the current gaze intent as an offset from the camera axis. A
    // renderer with camera look-at support reads it via getGazeOffset() and
    // owns the eyeLook channels; the channel writes below only take effect on
    // renderers without look-at support.
    this._gazeOffset.yawDeg = curYaw;
    this._gazeOffset.pitchDeg = curPitch;

    // Zero all 8 eyeLook channels first (so server values don't bleed through)
    for (const ch of EYE_LOOK_CHANNELS) blendshapes[ch] = 0;

    // Yaw convention: positive = looking RIGHT (viewer's right).
    // Pitch convention: positive = looking UP.
    // Per-direction calibration so both eyes rotate the same physical angle —
    // the abducting eye uses the (stronger) Out morph scale, the adducting
    // eye the (weaker) In morph scale.
    if (curYaw > 0) {
      // viewer-right = subject-left: left eye abducts (Out), right adducts (In)
      blendshapes["eyeLookOutLeft"] = Math.min(curYaw / EYE_DEG_PER_UNIT.out, 1);
      blendshapes["eyeLookInRight"] = Math.min(curYaw / EYE_DEG_PER_UNIT.in, 1);
    } else if (curYaw < 0) {
      blendshapes["eyeLookInLeft"]  = Math.min(-curYaw / EYE_DEG_PER_UNIT.in, 1);
      blendshapes["eyeLookOutRight"] = Math.min(-curYaw / EYE_DEG_PER_UNIT.out, 1);
    }

    if (curPitch > 0) {
      const u = Math.min(curPitch / EYE_DEG_PER_UNIT.up, 1);
      blendshapes["eyeLookUpLeft"] = u;
      blendshapes["eyeLookUpRight"] = u;
    } else if (curPitch < 0) {
      const u = Math.min(-curPitch / EYE_DEG_PER_UNIT.down, 1);
      blendshapes["eyeLookDownLeft"] = u;
      blendshapes["eyeLookDownRight"] = u;
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