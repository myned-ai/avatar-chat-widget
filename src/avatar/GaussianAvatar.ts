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

// ─── Procedural head/neck pose (v1 — see .claude/research/3dmm_transitions_and_state_machine.md §10) ──
//
// State-branched driver:
//   Idle       → return null (baked idle clip drives entirely)
//   Listening  → still-listening baseline sway + cue-triggered damped-sine nod
//                on 110 ms of audio silence (Ward & Tsukahara 2000 placeholder
//                — proper version needs user-mic F0)
//   Responding → RMS-driven head + breathing baseline + yaw drift (RMS is a
//                placeholder for F0 per §3; head rises slightly on louder
//                speech which roughly approximates rising on pitch peaks)
//
// All rotations are Euler 'YXZ' radians and distributed along the DAZ
// cervical chain (head 0.55 / neckUpper 0.30 / neckLower 0.15 — §2).
// Output passes through a 1€ filter (Casiez 2012, §7) per axis on the
// baseline (NOT on the nod transient — that would smear it).
const DEG_TO_RAD = Math.PI / 180;

// Listening baseline ("still listening" floor — visible motion so the avatar
// reads as engaged). Catalog §12 amplitudes: empathy tilts 8-15°, attentive
// nods 5-10°. Previous values (sub-degree) were below visibility threshold.
const LISTEN_SWAY = {
  yawHz1: 0.7,   yawHz2: 1.3,   yawPeakDeg: 3.0,   // was 0.8
  pitchHz1: 0.5, pitchHz2: 1.1, pitchPeakDeg: 2.0, // was 0.5
  breatheHz: 0.3,                breathePeakDeg: 1.0, // was 0.3
  rollHz1: 0.25, rollHz2: 0.55, rollPeakDeg: 8.0,  // was 5.0 (now in catalog range)
};

// Nod (damped sine; §4 — Ward & Tsukahara cue → 3-cycle damped sine).
const NOD = {
  amplitudeDeg:        6,    // peak pitch, chin-down (negative pitch)
  frequencyHz:         1.6,
  decayTauS:           0.4,
  cycles:              3,    // ≈ 1.9 s total
  triggerSilenceMs:    110,  // §4 — Ward & Tsukahara low-pitch threshold
  triggerDelayMinMs:   200,
  triggerDelayMaxMs:   400,
};

// Responding driver — REV 2 (2026-06-11 evening).
// REV 1 mapped absolute RMS level to absolute pitch position → head stayed
// pinned at +5° the whole time the avatar talked. Wrong: real speakers MOVE
// the head on speech BURSTS (stressed syllables), not on overall volume.
//
// REV 2 high-passes RMS: pitch is driven by (RMS - smoothed(RMS, slow)), i.e.
// how much the current syllable rises above the surrounding average. Settles
// back to zero between syllables. Pitch CHANGES with speech rhythm, doesn't
// pin to level.
// Responding driver — REV 3 (2026-06-11 night).
// REV 2 high-passed RMS to get rid of "head pinned up" bias, but produced
// nearly-zero output during steady speech (the slow EMA tracks the level
// and the residual collapses). Live test confirmed ±1.4° pitch — invisible.
//
// REV 3 adds a "speech rhythm" pitch oscillator: while speech is active
// (RMS > threshold) the head bobs at ~1.5 Hz with amplitude proportional to
// the current RMS. This is the speech-rhythm pattern in McClave 2000 and
// the classic visual-prosody finding (Munhall 2004 — head motion correlates
// with F0 envelope at ~0.83 sentence-level). High-pass burst stays on top
// for transients. Plus larger breathing, yaw drift, and roll.
const SPEECH_HEAD = {
  // Speech-rhythm oscillator (gated by RMS > silenceThresh).
  rhythmHz:            1.6,    // ~1.5 Hz = syllable rate
  rhythmRmsToAmpScale: 90,     // RMS 0.05 → amp ≈ 4.5°; RMS 0.10 → ≈ 9°
  rhythmAmpClampDeg:   10,     // hard cap
  rhythmSilenceThresh: 0.005,  // gate: skip oscillator below this RMS
  // High-pass burst (REV 2, kept for transients).
  pitchBurstScale:     350,    // was 220
  pitchBurstClampDeg:  8,      // was 6
  slowRmsEmaAlpha:     0.04,   // ~1 s timescale
  pitchReleaseAlpha:   0.35,   // faster release for visible motion
  // Baselines.
  breatheHz:           0.4,
  breathePeakDeg:      3.0,    // was 1.5
  yawSlowHz1:          0.4,
  yawSlowHz2:          0.95,
  yawSlowPeakDeg:      6.0,    // was 3.0
  rollHz1:             0.18,
  rollHz2:             0.42,
  rollPeakDeg:         5.0,    // was 2.5
};

// Cervical distribution for roll (§2 biomech — slightly more even split than
// pitch/yaw because lower-cervical contributes more to lateral flexion).
const NECK_DIST_ROLL = {
  head:      0.45,
  neckUpper: 0.35,
  neckLower: 0.20,
};

// State-enter ramp duration (ms). Procedural amplitude ramps from 0 to 1 over
// this window after a state change so the bones drift smoothly out of the
// previous state's pose rather than snapping. The speak clip's body motion
// also crossfades over ~0.5 s (renderer's blendingTime constant), so these are
// matched.
const STATE_ENTER_RAMP_MS = 500;

// Cervical distribution along chain. §2 biomech.
const NECK_DIST = {
  head:      0.55,
  neckUpper: 0.30,
  neckLower: 0.15,
};

// 1€ filter parameters (§7 — Casiez 2012). beta=0.02 = slow social motion.
const ONE_EURO_MIN_CUTOFF_HZ = 1.0;
const ONE_EURO_BETA = 0.02;

/**
 * Casiez 2012 1€ filter — simple speed-based low-pass with derivative-adaptive
 * cutoff. Filters noise at low velocity, preserves transients at high velocity.
 * One instance per axis; state persists across frames.
 * https://gery.casiez.net/1euro/
 */
class OneEuroFilter {
  private xPrev = 0;
  private dxPrev = 0;
  private tPrevSec = 0;
  private initialized = false;
  constructor(private readonly minCutoff: number, private readonly beta: number) {}
  reset() { this.initialized = false; }
  filter(x: number, tSec: number): number {
    if (!this.initialized) {
      this.xPrev = x; this.dxPrev = 0; this.tPrevSec = tSec; this.initialized = true;
      return x;
    }
    const dt = Math.max(1e-3, tSec - this.tPrevSec);
    const dx = (x - this.xPrev) / dt;
    // Smooth the derivative itself with min_cutoff
    const aD = this.alpha(this.minCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    // Adapt cutoff to derivative magnitude
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const aX = this.alpha(cutoff, dt);
    this.xPrev = aX * x + (1 - aX) * this.xPrev;
    this.tPrevSec = tSec;
    return this.xPrev;
  }
  private alpha(cutoffHz: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoffHz);
    return 1 / (1 + tau / dt);
  }
}

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

  // Procedural neck sway state. Cached return object + arrays reused across
  // frames to keep getNeckPose() allocation-free (called at 30 Hz inside the
  // renderer's RAF loop). DAZ-style cervical chain: chestUpper → neckLower →
  // neckUpper → head. Distribute rotation 10/30/60 along the chain — looks
  // more natural than driving 'head' alone (which gives a rigid-neck dolly
  // effect). The renderer iterates pose keys as bone names.
  private _swayStartTimeMs = 0;
  private readonly _neckPoseResult: {
    head: [number, number, number],
    neckUpper: [number, number, number],
    neckLower: [number, number, number],
  } = {
    head: [0, 0, 0],
    neckUpper: [0, 0, 0],
    neckLower: [0, 0, 0],
  };
  // Nod scheduler state (Listening backchannel cue).
  // _nodPendingFireAtMs > 0 means a nod has been scheduled but not yet started.
  // _nodStartMs > 0 means a nod is in progress.
  private _nodPendingFireAtMs = 0;
  private _nodStartMs = 0;

  // 1€ filter per axis (baseline only — nod transient is added unfiltered).
  private readonly _pitchFilter = new OneEuroFilter(ONE_EURO_MIN_CUTOFF_HZ, ONE_EURO_BETA);
  private readonly _yawFilter = new OneEuroFilter(ONE_EURO_MIN_CUTOFF_HZ, ONE_EURO_BETA);
  private readonly _rollFilter = new OneEuroFilter(ONE_EURO_MIN_CUTOFF_HZ, ONE_EURO_BETA);
  // High-pass state for the Responding RMS driver (REV 2). Slow EMA tracks
  // overall speech level (~1s timescale); the residual (current - slow) is the
  // burst signal that drives head pitch impulses.
  private _slowRmsEma = 0;
  private _pitchBurstEma = 0;
  // State change tracker for the symmetric two-phase ramp:
  //   0   → halfway through ramp: emit PREV state's pose, amplitude 1 → 0
  //   half → end of ramp:         emit CURRENT state's pose, amplitude 0 → 1
  // This mirrors the speak/idle clip authoring convention where every clip
  // starts and ends at the same neutral pose, so the transition passes
  // through the default position before the next state engages.
  private _prevStateForRamp: ChatState = 'Idle';
  private _stateChangeMs = 0;
  // Used by the fade-out half: when we transition INTO Idle, we still need to
  // emit the previous procedural pattern (Listening or Responding) for
  // ~250 ms while decaying its amplitude. Captures the last non-Idle state.
  private _lastNonIdleStateForFade: ChatState | null = null;
  
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

    // DEBUG: expose renderer for devtools probing (bone-color visualization, etc.)
    (window as unknown as { __nyxRenderer: unknown }).__nyxRenderer = this._renderer;

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
   * Procedural head/neck pose callback consumed by the renderer once per RAF
   * frame (~30 Hz). Returns Euler 'YXZ' radians for each bone in the DAZ
   * cervical chain (head, neckUpper, neckLower).
   *
   * State machine (v1 — see .claude/research/3dmm_transitions_and_state_machine.md §10):
   *   Idle       → null (baked idle clip drives)
   *   Listening  → baseline sway + cue-triggered damped-sine nod on 110 ms silence
   *   Responding → RMS-driven head + breathing baseline + yaw drift
   *
   * Allocation-free: mutates cached _neckPoseResult in place.
   */
  public getNeckPose(): {
    head: [number, number, number],
    neckUpper: [number, number, number],
    neckLower: [number, number, number],
  } | null {
    const nowMs = performance.now();

    // Detect state change → start the two-phase ramp.
    if (this.curState !== this._prevStateForRamp) {
      // Don't reset filters mid-transition — keep them smoothing through the
      // ramp so the per-axis 1€ output doesn't jump.
      this._stateChangeMs = nowMs;
      this._nodPendingFireAtMs = 0;
      this._nodStartMs = 0;
      // Snapshot the OUTGOING state for the fade-out phase; new state becomes
      // the incoming target. Special-case Idle → x: skip the fade-out phase
      // entirely (we were emitting null, nothing to fade from).
      const wasIdle = this._prevStateForRamp === 'Idle';
      this._prevStateForRamp = this.curState;
      // Mark the change so the ramp computation below knows the elapsed time.
      // wasIdle path: jump straight into fade-IN by back-dating the ramp by half.
      if (wasIdle) this._stateChangeMs -= STATE_ENTER_RAMP_MS / 2;
    }

    const msSinceChange = nowMs - this._stateChangeMs;
    const rampHalf = STATE_ENTER_RAMP_MS / 2;

    // Phase selection:
    //   msSinceChange < rampHalf:  emit the *previous* procedural state's pose,
    //                              amplitude 1 → 0 (fade out to neutral)
    //   msSinceChange >= rampHalf: emit the *current* procedural state's pose,
    //                              amplitude 0 → 1 (fade in from neutral)
    let computeState: ChatState;
    let amplitude: number;
    if (msSinceChange < rampHalf) {
      // Fade-out half. If we're now Idle, the prev state was procedural and
      // we should emit its decaying pose. If we're STILL in a procedural
      // state (rare — happens only mid-transition), use the new state.
      if (this.curState === 'Idle' && this._lastNonIdleStateForFade !== null) {
        computeState = this._lastNonIdleStateForFade;
      } else {
        computeState = this.curState;
      }
      amplitude = 1 - (msSinceChange / rampHalf);
    } else if (msSinceChange < STATE_ENTER_RAMP_MS) {
      // Fade-in half. Use new state.
      computeState = this.curState;
      amplitude = (msSinceChange - rampHalf) / rampHalf;
    } else {
      // Past the ramp window — full amplitude.
      computeState = this.curState;
      amplitude = 1;
    }

    // If we're now in Idle AND past the ramp, return null so the baked clip
    // drives entirely. Inside the ramp we keep emitting (with amplitude=0 at
    // worst) so the bone glides to neutral instead of snapping.
    if (this.curState === 'Idle' && msSinceChange >= rampHalf) return null;

    // Remember the most recent procedural state so the fade-out half can
    // continue emitting its pattern after we transition to Idle.
    if (this.curState !== 'Idle') this._lastNonIdleStateForFade = this.curState;

    if (this._swayStartTimeMs === 0) this._swayStartTimeMs = nowMs;
    const t = (nowMs - this._swayStartTimeMs) / 1000;
    const tSec = nowMs / 1000;

    let baselinePitchDeg = 0;
    let baselineYawDeg = 0;
    let baselineRollDeg = 0;

    if (computeState === 'Listening') {
      // Baseline still-listening sway (subtle floor under the nod cue).
      baselineYawDeg = (
        Math.sin(2 * Math.PI * LISTEN_SWAY.yawHz1 * t)
        + 0.6 * Math.sin(2 * Math.PI * LISTEN_SWAY.yawHz2 * t)
      ) / 1.6 * LISTEN_SWAY.yawPeakDeg;
      baselinePitchDeg = (
        Math.sin(2 * Math.PI * LISTEN_SWAY.pitchHz1 * t)
        + 0.5 * Math.sin(2 * Math.PI * LISTEN_SWAY.pitchHz2 * t)
      ) / 1.5 * LISTEN_SWAY.pitchPeakDeg
        + Math.sin(2 * Math.PI * LISTEN_SWAY.breatheHz * t) * LISTEN_SWAY.breathePeakDeg;
      // Slow roll — empathy/attentiveness lean (catalog §12: tilt is the
      // listener's primary semantic channel besides nods). Detuned slow
      // sines avoid periodic-loop feel; amplitude is ~5° max so the head
      // gently tilts rather than dramatically cocks.
      baselineRollDeg = (
        Math.sin(2 * Math.PI * LISTEN_SWAY.rollHz1 * t)
        + 0.7 * Math.sin(2 * Math.PI * LISTEN_SWAY.rollHz2 * t)
      ) / 1.7 * LISTEN_SWAY.rollPeakDeg;
    } else if (computeState === 'Responding') {
      // REV 3 PRIMARY: speech-rhythm pitch oscillator.
      // Active whenever speech audio is above silence threshold. Amplitude
      // scales with current RMS so quiet speech = small bobs, loud speech =
      // big bobs. Frequency ~1.5 Hz approximates syllable rate (catalog §12,
      // McClave OM band 1.9–3.6 Hz scaled down for "head-level" pitch motion).
      if (this.smoothedAudioRMS > SPEECH_HEAD.rhythmSilenceThresh) {
        const rhythmAmp = Math.min(
          SPEECH_HEAD.rhythmAmpClampDeg,
          this.smoothedAudioRMS * SPEECH_HEAD.rhythmRmsToAmpScale,
        );
        baselinePitchDeg += -rhythmAmp * Math.sin(2 * Math.PI * SPEECH_HEAD.rhythmHz * t);
        // Negative sin so the head DIPS on stressed syllable downbeats (catalog
        // §12: stress beat = down-dip).
      }
      // REV 2 SECONDARY: high-pass burst layered on top for transient emphasis.
      this._slowRmsEma = SPEECH_HEAD.slowRmsEmaAlpha * this.smoothedAudioRMS
                       + (1 - SPEECH_HEAD.slowRmsEmaAlpha) * this._slowRmsEma;
      const burst = this.smoothedAudioRMS - this._slowRmsEma;
      const rawPitchBurstDeg = Math.max(
        -SPEECH_HEAD.pitchBurstClampDeg,
        Math.min(SPEECH_HEAD.pitchBurstClampDeg, burst * SPEECH_HEAD.pitchBurstScale),
      );
      this._pitchBurstEma = SPEECH_HEAD.pitchReleaseAlpha * rawPitchBurstDeg
                          + (1 - SPEECH_HEAD.pitchReleaseAlpha) * this._pitchBurstEma;
      baselinePitchDeg += this._pitchBurstEma;
      // Breathing baseline (always present, non-RMS).
      baselinePitchDeg += Math.sin(2 * Math.PI * SPEECH_HEAD.breatheHz * t)
                       * SPEECH_HEAD.breathePeakDeg;
      // Slow yaw drift — head turns gently across long utterances.
      baselineYawDeg = (
        Math.sin(2 * Math.PI * SPEECH_HEAD.yawSlowHz1 * t)
        + 0.5 * Math.sin(2 * Math.PI * SPEECH_HEAD.yawSlowHz2 * t)
      ) / 1.5 * SPEECH_HEAD.yawSlowPeakDeg;
      // Slow roll drift during speech — head tilts during long phrases.
      baselineRollDeg = (
        Math.sin(2 * Math.PI * SPEECH_HEAD.rollHz1 * t)
        + 0.6 * Math.sin(2 * Math.PI * SPEECH_HEAD.rollHz2 * t)
      ) / 1.6 * SPEECH_HEAD.rollPeakDeg;
    }

    // 1€ filter ONLY on the slow baseline (filters out frame-to-frame jitter
    // without smearing the nod transient added below).
    const smoothPitchDeg = this._pitchFilter.filter(baselinePitchDeg, tSec);
    const smoothYawDeg = this._yawFilter.filter(baselineYawDeg, tSec);
    const smoothRollDeg = this._rollFilter.filter(baselineRollDeg, tSec);

    // Listening nod (added AFTER 1€ filter so the transient is preserved).
    // Nod scheduler only runs while CURRENT state is Listening — we don't
    // want to start a new nod during the fade-out half after leaving Listening.
    let nodPitchDeg = 0;
    if (this.curState === 'Listening') {
      this._updateNodScheduler(nowMs);
    }
    if (computeState === 'Listening' && this._nodStartMs > 0) {
      const tSinceNod = (nowMs - this._nodStartMs) / 1000;
      const nodDuration = NOD.cycles / NOD.frequencyHz;
      if (tSinceNod < nodDuration) {
        const envelope = Math.exp(-tSinceNod / NOD.decayTauS);
        nodPitchDeg = -NOD.amplitudeDeg * envelope
                    * Math.sin(2 * Math.PI * NOD.frequencyHz * tSinceNod);
      } else {
        this._nodStartMs = 0;
      }
    }

    // Compose Euler 'YXZ' per bone via cervical share distribution. With the
    // renderer composing procedural as a DELTA on top of clip rotation
    // (postmultiply), amplitude=0 means identity-delta = clip wins, so we don't
    // need to pass through bind pose mid-transition. Roll uses a slightly
    // different distribution (45/35/20) because lower-cervical contributes
    // more to lateral flexion than to flex/yaw (§2 biomech). Renderer
    // interprets [pitch, yaw, roll] = [x, y, z] in 'YXZ' Euler order and
    // POSTMULTIPLIES onto bone.quaternion.
    const totalPitchRad = (smoothPitchDeg + nodPitchDeg) * amplitude * DEG_TO_RAD;
    const totalYawRad   = smoothYawDeg * amplitude * DEG_TO_RAD;
    const totalRollRad  = smoothRollDeg * amplitude * DEG_TO_RAD;

    // DEBUG 2026-06-11 evening: log every ~1 s so we can confirm roll is non-zero.
    if (!(this as any)._lastNeckDebugMs || nowMs - (this as any)._lastNeckDebugMs > 1000) {
      (this as any)._lastNeckDebugMs = nowMs;
      const p = (totalPitchRad / DEG_TO_RAD).toFixed(2);
      const y = (totalYawRad / DEG_TO_RAD).toFixed(2);
      const r = (totalRollRad / DEG_TO_RAD).toFixed(2);
      // eslint-disable-next-line no-console
      console.log(`[NeckPose] state=${this.curState}  amp=${amplitude.toFixed(2)}  pitch=${p}°  yaw=${y}°  roll=${r}°`);
    }

    this._neckPoseResult.head[0]      = totalPitchRad * NECK_DIST.head;
    this._neckPoseResult.head[1]      = totalYawRad   * NECK_DIST.head;
    this._neckPoseResult.head[2]      = totalRollRad  * NECK_DIST_ROLL.head;
    this._neckPoseResult.neckUpper[0] = totalPitchRad * NECK_DIST.neckUpper;
    this._neckPoseResult.neckUpper[1] = totalYawRad   * NECK_DIST.neckUpper;
    this._neckPoseResult.neckUpper[2] = totalRollRad  * NECK_DIST_ROLL.neckUpper;
    this._neckPoseResult.neckLower[0] = totalPitchRad * NECK_DIST.neckLower;
    this._neckPoseResult.neckLower[1] = totalYawRad   * NECK_DIST.neckLower;
    this._neckPoseResult.neckLower[2] = totalRollRad  * NECK_DIST_ROLL.neckLower;
    return this._neckPoseResult;
  }

  /**
   * Listening backchannel cue scheduler — Ward & Tsukahara 2000 placeholder.
   * Triggers a damped-sine nod 200-400 ms after detecting 110 ms of audio
   * silence (proper version needs user-mic F0 — §4 deferred work).
   */
  private _updateNodScheduler(nowMs: number): void {
    // Fire a scheduled nod.
    if (this._nodPendingFireAtMs > 0 && nowMs >= this._nodPendingFireAtMs) {
      this._nodStartMs = nowMs;
      this._nodPendingFireAtMs = 0;
      return;
    }
    // Schedule a new nod if silence cue tripped AND no nod active/pending.
    if (this._nodStartMs === 0 && this._nodPendingFireAtMs === 0
        && this.msInLowEnergy >= NOD.triggerSilenceMs) {
      const delay = NOD.triggerDelayMinMs
                  + Math.random() * (NOD.triggerDelayMaxMs - NOD.triggerDelayMinMs);
      this._nodPendingFireAtMs = nowMs + delay;
    }
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