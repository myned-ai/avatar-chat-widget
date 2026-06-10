import * as GaussianSplats3D from "@myned-ai/gsplat-flame-avatar-renderer"
import { TextureLoader, SRGBColorSpace, Object3D, type Scene } from 'three';
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
  // Not talking → active gaze
  'Idle': {
    mutualMean: 1000, mutualSigma: 350, returnProb: 0.45,
    awayMean:    250, awaySigma:   100,
    magnitudeMaxDeg: 12,
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
    mutualMean: 939, mutualSigma: 97, returnProb: 0.41,
    awayMean:   278, awaySigma:   49,
    magnitudeMaxDeg: 12,
  },
};

// State-independent constants (movement physics + ARKit mapping)
// Main sequence (Lee & Badler "Eyes Alive" SIGGRAPH 2002, verified from SmartBody source):
//   duration_seconds = INTERCEPT + SLOPE × amplitude_degrees
// → 3° saccade = 32 ms, 10° = 49 ms, 12° = 54 ms. Biologically grounded.
const SACCADE_DURATION_INTERCEPT_S = 0.025;
const SACCADE_DURATION_SLOPE_S_PER_DEG = 0.0024;
const SACCADE_DURATION_MIN_MS = 25;          // floor — never instantaneous
const SACCADE_ARKIT_DEG_PER_UNIT = 30;       // ARKit eyeLook* value=1 ≈ 30° rotation
const SACCADE_MICROSACCADE_DEG  = 3;         // ±3° jitter on mutual gaze — visible at render scale

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
// PCM16 → float32 scales by 1/32768; even quiet TTS bursts sit around 0.05+ RMS
// while real silence is < 0.005. So the threshold sits well below speech energy.
const PAUSE_RMS_THRESHOLD = 0.01;
const PAUSE_ENTER_MS = 400;          // canonical 800ms canon, halved for TTS pauses
const PAUSE_EXIT_MS = 100;
const PAUSE_RMS_EMA_ALPHA = 0.4;     // strong smoothing; new samples at 30 Hz

// During Responding-mode saccade picks, the returnProb (chance of staying on
// mutual gaze) shifts based on whether we're in a pause:
//   in fluent speech  → bias TOWARD listener (look at them while talking)
//   in a pause        → bias AWAY (cluster gaze aversions at pauses)
const RESPONDING_FLUENT_RETURN_PROB = 0.85;
const RESPONDING_PAUSE_RETURN_PROB  = 0.25;

// ─── Live → neutral fade on Talking → Idle ──────────────────────────────────
// When the TTS stream stops, the widget's liveBlendshapeData goes null and
// the avatar would snap to neutralBlendshapes within ~33ms. That reads as
// unnatural — the face goes from emotive to dead in one frame.
//
// Per-channel-group fade durations follow industry conventions:
//   - mouth/jaw  fade fast so the avatar doesn't appear mid-word
//   - brow       fade slowest (lingering emotional residue is natural)
//   - eye region intermediate
// (Confirmed against NVIDIA Audio2Face MotionSettings 500ms default + Apple
//  ARKit live-mode docs in research pass 2026-06-10. Cubic-out easing matches
//  the GDC/SIGGRAPH consensus for snappy-but-not-jarring decay.)
const FADE_DURATION_MS: Record<string, number> = {
  mouth:  250,   // mouth* + jaw*  — close fast
  brow:   600,   // brow*          — relax slow
  eye:    500,   // eyeSquint, eyeWide, cheek, nose
  other:  500,   // safe default
};
// Map blendshape name -> fade group via prefix match.
function fadeGroupFor(name: string): keyof typeof FADE_DURATION_MS {
  if (name.startsWith('mouth') || name.startsWith('jaw')) return 'mouth';
  if (name.startsWith('brow')) return 'brow';
  if (name.startsWith('eyeSquint') || name.startsWith('eyeWide') ||
      name.startsWith('cheek') || name.startsWith('nose')) return 'eye';
  return 'other';
}
// Cubic-out: 1 - (1-t)^3. Fast initial relaxation, slow settle.
function cubicOut(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}
// Longest fade we ever apply — once elapsed, drop the cached last frame.
const FADE_MAX_MS = Math.max(...Object.values(FADE_DURATION_MS));

// ─── Procedural neck/head sway ──────────────────────────────────────────────
// Multi-sine "idle motion" recipe transposed from privacypuppet (MIT). Two
// detuned sinusoids per axis avoid the obvious looped feel of a single
// frequency; a high-frequency jitter term adds micro-motion; a low-frequency
// breathing term gives subtle, periodic pitch rocking.
//
// Peak amplitude < 1.3° per the source — small enough that the renderer
// reads it as ambient life, not deliberate motion. State multipliers gate it
// off while the baked Responding clip is driving the neck.
//
// Axes are FLAME-bone local: X = pitch (nod), Y = yaw (left/right), Z = roll.
// We use the axis-angle representation expected by FlameAnimator.setBoneRotation:
// the returned vector is (angle * axis) so each component is the rotation
// (in radians) about that axis. For small angles this approximates Euler
// composition closely enough.
const NECK_SWAY = {
  yawHz1: 0.7,    yawHz2: 1.3,    yawPeakDeg: 1.0,
  pitchHz1: 0.5,  pitchHz2: 1.1,  pitchPeakDeg: 0.7,
  jitterHz1: 18,  jitterHz2: 14,  jitterPeakDeg: 0.25,
  breatheHz: 0.8,                 breathePeakDeg: 0.4,
};
const DEG_TO_RAD = Math.PI / 180;

// State multipliers for the sway amplitude. Idle = full ambient, Listening =
// subdued (focused on user), Responding = 0 so the baked clip's neck data
// passes through unaltered.
const NECK_SWAY_STATE_MUL: Record<ChatState, number> = {
  'Idle':       1.0,
  'Listening':  0.6,
  'Responding': 0.0,
};

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
  private smoothedAudioRMS = 0;                 // EMA over incoming RMS samples
  private lastAudioRMSUpdateMs = 0;             // wall-clock of last audio sample
  private msInLowEnergy = 0;                    // contiguous ms below threshold
  private msInHighEnergy = 0;                   // contiguous ms above threshold
  private inSpeechPause = false;                // hysteretic pause state

  // Procedural neck sway state. Cached return object + array reused across
  // frames to keep getNeckPose() allocation-free (called at 30 Hz inside the
  // renderer's RAF loop).
  private _swayStartTimeMs = 0;
  private readonly _neckPoseResult: { neck: [number, number, number] } = {
    neck: [0, 0, 0],
  };

  // Live → neutral fade state. On disableLiveBlendshapes() we snapshot the
  // last live frame and stamp the wall-clock; getArkitFaceFrame() then lerps
  // each channel toward neutral over its per-group fade duration. New live
  // data via updateBlendshapes() cancels the fade.
  private _fadeFromBlendshapes: Record<string, number> | null = null;
  private _fadeStartTimeMs = 0;
  
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

  public async render() {
    this._renderer = await GaussianSplats3D.GaussianSplatRenderer.getInstance(
      this._avatarDivEle,
      this._assetsPath,
      {
        getChatState: this.getChatState.bind(this),
        getExpressionData: this.getArkitFaceFrame.bind(this),
        getNeckPose: this.getNeckPose.bind(this),
        backgroundColor: "0xffffff"
      },
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
    return this.curState;
  }
  
  public setChatState(state: ChatState): void {
    if (this.curState !== state) {
      // Log with timestamp for easier debugging of animation state machine
      const timestamp = new Date().toLocaleTimeString();
      log.info(`[${timestamp}] Avatar state: ${this.curState} → ${state}`);
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
    // Capture the last live frame so getArkitFaceFrame can fade FROM it
    // toward neutralBlendshapes instead of snapping in one frame. Called from
    // ChatManager on playback-end / interrupt / minimize.
    if (this.liveBlendshapeData) {
      this._fadeFromBlendshapes = { ...this.liveBlendshapeData };
      this._fadeStartTimeMs = performance.now();
    }
    this.liveBlendshapeData = null;
    log.debug('Live blendshapes cleared — fading to neutral');
  }

  /**
   * Update blendshapes from real-time stream
   * OpenAvatarChat pattern: Always accept updates, they're applied in getArkitFaceFrame
   */
  public updateBlendshapes(weights: Record<string, number>): void {
    this.liveBlendshapeData = weights;
    // Any new live data cancels an in-progress fade. The next response's
    // own emotion EMA (model-side, ~5s) handles the ramp-in.
    if (this._fadeFromBlendshapes !== null) {
      this._fadeFromBlendshapes = null;
    }
  }

  /**
   * Procedural neck-sway callback consumed by the renderer once per RAF frame
   * (~30 Hz). Returns a multi-sine ambient motion for the FLAME 'neck' bone in
   * axis-angle form (component = radians about that local axis). Returning
   * `null` lets the baked animation.glb clip drive the neck unmodified — used
   * during Responding so the speech clips are not fought.
   *
   * Allocation-free: the cached _neckPoseResult is mutated in place. Renderer
   * copies values into a Quaternion on the bone, so mutating across frames is
   * safe.
   */
  public getNeckPose(): { neck: [number, number, number] } | null {
    const stateMul = NECK_SWAY_STATE_MUL[this.curState];
    if (stateMul === 0) return null;

    const nowMs = performance.now();
    if (this._swayStartTimeMs === 0) this._swayStartTimeMs = nowMs;
    const t = (nowMs - this._swayStartTimeMs) / 1000;

    // Multi-sine yaw: two detuned frequencies, peak normalized to yawPeakDeg.
    // (sin1 + 0.6*sin2) has theoretical peak 1.6, so divide by 1.6 to land at amp.
    const yawDeg = (
      Math.sin(2 * Math.PI * NECK_SWAY.yawHz1 * t) +
      0.6 * Math.sin(2 * Math.PI * NECK_SWAY.yawHz2 * t)
    ) / 1.6 * NECK_SWAY.yawPeakDeg;

    // Pitch: dual sinusoids + breathing rhythm + tiny high-freq jitter.
    // Peak budget: pitchPeakDeg + breathePeakDeg + jitterPeakDeg ~ 1.35°.
    const pitchBase = (
      Math.sin(2 * Math.PI * NECK_SWAY.pitchHz1 * t) +
      0.5 * Math.sin(2 * Math.PI * NECK_SWAY.pitchHz2 * t)
    ) / 1.5 * NECK_SWAY.pitchPeakDeg;
    const breathe = Math.sin(2 * Math.PI * NECK_SWAY.breatheHz * t)
      * NECK_SWAY.breathePeakDeg;
    const jitter = (
      Math.sin(2 * Math.PI * NECK_SWAY.jitterHz1 * t) +
      Math.sin(2 * Math.PI * NECK_SWAY.jitterHz2 * t)
    ) / 2 * NECK_SWAY.jitterPeakDeg;
    const pitchDeg = pitchBase + breathe + jitter;

    const pitchRad = pitchDeg * DEG_TO_RAD * stateMul;
    const yawRad   = yawDeg   * DEG_TO_RAD * stateMul;

    // Axis-angle: FlameAnimator interprets [x, y, z] as (axis * angle).
    // For small composed rotations this is ~Euler XYZ with X=pitch, Y=yaw.
    this._neckPoseResult.neck[0] = pitchRad;
    this._neckPoseResult.neck[1] = yawRad;
    this._neckPoseResult.neck[2] = 0;
    return this._neckPoseResult;
  }

  /**
   * Feed RMS energy of an incoming audio frame so the procedural gaze controller
   * can detect speech pauses and cluster away-glances there. Called once per
   * SyncFrame from ChatManager. RMS is linear in [0, 1].
   */
  public updateAudioRMS(rms: number): void {
    const now = performance.now();
    // EMA smoothing — strong because frames arrive at ~30 Hz
    this.smoothedAudioRMS = PAUSE_RMS_EMA_ALPHA * rms
      + (1 - PAUSE_RMS_EMA_ALPHA) * this.smoothedAudioRMS;

    // Per-frame dt is ~33 ms but be robust to gaps in the stream
    const dt = this.lastAudioRMSUpdateMs === 0
      ? 33
      : Math.min(200, now - this.lastAudioRMSUpdateMs);
    this.lastAudioRMSUpdateMs = now;

    if (this.smoothedAudioRMS < PAUSE_RMS_THRESHOLD) {
      this.msInLowEnergy += dt;
      this.msInHighEnergy = 0;
      if (!this.inSpeechPause && this.msInLowEnergy >= PAUSE_ENTER_MS) {
        this.inSpeechPause = true;
        log.info(`[gaze] entered speech pause after ${this.msInLowEnergy.toFixed(0)}ms low energy`);
      }
    } else {
      this.msInHighEnergy += dt;
      this.msInLowEnergy = 0;
      if (this.inSpeechPause && this.msInHighEnergy >= PAUSE_EXIT_MS) {
        this.inSpeechPause = false;
        log.info(`[gaze] exited speech pause after ${this.msInHighEnergy.toFixed(0)}ms high energy`);
      }
    }
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

    if (this.liveBlendshapeData) {
      // Live stream active — pass through
      result = { ...this.liveBlendshapeData };
    } else if (this._fadeFromBlendshapes !== null) {
      // Talking → Idle fade: lerp each channel from its last live value
      // toward neutral over a per-group duration with cubic-out easing.
      const elapsed = performance.now() - this._fadeStartTimeMs;
      result = {};
      for (const name in this.neutralBlendshapes) {
        const dur = FADE_DURATION_MS[fadeGroupFor(name)];
        const t = Math.min(elapsed / dur, 1.0);
        const a = cubicOut(t);
        const from = this._fadeFromBlendshapes[name] ?? this.neutralBlendshapes[name];
        const to = this.neutralBlendshapes[name];
        result[name] = from * (1 - a) + to * a;
      }
      // Drop the snapshot once the longest fade has completed.
      if (elapsed >= FADE_MAX_MS) {
        this._fadeFromBlendshapes = null;
      }
    } else {
      // Fully idle: neutral pose
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
      log.info(
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

    // Zero all 8 eyeLook channels first (so server values don't bleed through)
    for (const ch of EYE_LOOK_CHANNELS) blendshapes[ch] = 0;

    // Yaw convention: positive = looking RIGHT (viewer's right).
    // Pitch convention: positive = looking UP.
    const yawUnits = Math.min(Math.abs(curYaw) / SACCADE_ARKIT_DEG_PER_UNIT, 1);
    const pitchUnits = Math.min(Math.abs(curPitch) / SACCADE_ARKIT_DEG_PER_UNIT, 1);

    if (curYaw > 0) {
      blendshapes["eyeLookOutLeft"] = yawUnits;
      blendshapes["eyeLookInRight"] = yawUnits;
    } else if (curYaw < 0) {
      blendshapes["eyeLookInLeft"] = yawUnits;
      blendshapes["eyeLookOutRight"] = yawUnits;
    }

    if (curPitch > 0) {
      blendshapes["eyeLookUpLeft"] = pitchUnits;
      blendshapes["eyeLookUpRight"] = pitchUnits;
    } else if (curPitch < 0) {
      blendshapes["eyeLookDownLeft"] = pitchUnits;
      blendshapes["eyeLookDownRight"] = pitchUnits;
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