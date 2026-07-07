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
// PCM16 → float32 scales by 1/32768; even quiet TTS bursts sit around 0.05+ RMS
// while real silence is < 0.005. So the threshold sits well below speech energy.
const PAUSE_RMS_THRESHOLD = 0.01;
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

// Listening baseline — near-still attentiveness. Listener heads are still
// 40-90% of conversation time and listener motion is dominated by
// intermittent pitch nods (Hadar et al. 1983; Hládek & Seeber 2025);
// continuous roll oscillation has no empirical basis. The baseline stays
// ≤~1° total and the cue-triggered nod below carries the visible
// "listening" signal. The head-locked rig inflates visible angles, so err
// small.
const LISTEN_SWAY = {
  yawHz1: 0.7,   yawHz2: 1.3,   yawPeakDeg: 1.0,
  pitchHz1: 0.5, pitchHz2: 1.1, pitchPeakDeg: 0.7,
  breatheHz: 0.3,                breathePeakDeg: 0.4, // breathing reads <1° at the head
  rollHz1: 0.25, rollHz2: 0.55, rollPeakDeg: 0.8,
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

// Speech-driven head motion. A single energy envelope (ENERGY_* below) is the
// only speech signal: it drives a low-frequency pitch bob whose amplitude
// tracks loudness, and gates the slow yaw/roll drift. Continuous voice
// co-motion is low-frequency (McClave 2000; Munhall 2004 — head motion
// correlates with the F0/energy envelope at ~0.83 sentence-level). No discrete
// per-syllable beat: it read as a fast forward jerk and any per-word nodding
// on staccato speech is worse than a smooth carrier.
const SPEECH_HEAD = {
  rhythmHz:            0.9,     // sub-1 Hz carrier reads as calm engagement
  rhythmRmsToAmpScale: 35,      // envelope 0.05 → amp ≈ 1.8°; 0.10 → ≈ 3.5°
  rhythmAmpClampDeg:   4,       // hard cap
  gateRef:             0.03,    // envelope value that maps to full drift gate
  // Baselines.
  breatheHz:           0.4,
  breathePeakDeg:      0.5,     // breathing reads <1° at the head
  yawSlowHz1:          0.4,
  yawSlowHz2:          0.95,
  yawSlowPeakDeg:      3.0,
  rollHz1:             0.18,
  rollHz2:             0.42,
  rollPeakDeg:         2.5,
};

// Cervical distribution for roll (§2 biomech — slightly more even split than
// pitch/yaw because lower-cervical contributes more to lateral flexion).
const NECK_DIST_ROLL = {
  head:      0.45,
  neckUpper: 0.35,
  neckLower: 0.20,
};

// State-transition blend duration (ms). On any state change the neck output
// eases from its current pose to the new state's pose in a single phase
// (cubic-out) — never through neutral, never snapping between formulas.
// 250 ms follows common engine transition durations (Unity 0.25 s crossfade,
// Unreal 0.2 s; Bollo, GDC 2018 "Inertialization").
const STATE_BLEND_MS = 250;

// Energy envelope follower (per-frame EMA rates at ~60 Hz). One smoothed
// signal is derived from the raw audio RMS and drives all speech-reactive
// head motion. Computed at RENDER rate from the latest raw sample, so it is
// immune to audio-callback burst timing. Asymmetric: quicker attack so the
// head engages as speech starts, slow release so it settles rather than cuts
// (fast attack / slow release is the standard envelope-follower shape).
const ENERGY_ATTACK = 0.20;   // ~55 ms rise
const ENERGY_RELEASE = 0.04;  // ~350 ms fall
const ENERGY_FEED_STALE_MS = 150; // no fresh RMS for this long ⇒ treat as silence

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
  // Energy signal. updateAudioRMS only captures the latest raw sample; the
  // smoothed envelope (_energyEnv) is advanced at render rate in getNeckPose
  // and is the single source for all speech-reactive head motion.
  private _rawRms = 0;
  private _energyEnv = 0;
  private _lastRmsUpdateMs = 0;
  private _lastPauseUpdateMs = 0;
  // State-transition blend: on state change, capture the current output pose
  // and ease from it to the new state's live target (single phase,
  // cubic-out). A change mid-blend re-captures the current output, so blends
  // never stack and the pose never snaps.
  private _prevStateForRamp: ChatState = 'Idle';
  private _blendStartMs = 0;
  private readonly _blendFromDeg = { pitch: 0, yaw: 0, roll: 0 };
  private readonly _lastOutDeg = { pitch: 0, yaw: 0, roll: 0 };

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
        getNeckPose: this.getNeckPose.bind(this),
        // Supported by the current renderer build; not yet in the published
        // package's type declarations, hence the cast below.
        getGazeOffset: this.getGazeOffset.bind(this),
        backgroundColor: "0xffffff"
      } as Parameters<typeof GaussianSplats3D.GaussianSplatRenderer.getInstance>[2],
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
      log.info(
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
    log.info('[teardown] live blendshapes cleared — face falls back to neutral');
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
  // Temporary diagnostic: reports renderer callback rates and within-frame
  // call order every 5 s. The face frame is read before the neck pose each
  // frame, so head-dependent eye logic lags the head by one frame.
  private _t3 = { neck: 0, face: 0, faceThenNeck: 0, neckThenFace: 0, last: '' as '' | 'neck' | 'face', lastMs: 0, reportMs: 0 };

  private _t3note(kind: 'neck' | 'face'): void {
    const now = performance.now();
    const t = this._t3;
    t[kind]++;
    if (t.last && t.last !== kind && now - t.lastMs < 8) {
      if (kind === 'neck') t.faceThenNeck++; else t.neckThenFace++;
    }
    t.last = kind;
    t.lastMs = now;
    if (now - t.reportMs > 5000) {
      if (t.reportMs > 0) {
        log.info(`[T3] neck=${(t.neck / 5).toFixed(1)}/s face=${(t.face / 5).toFixed(1)}/s | order: face→neck=${t.faceThenNeck} neck→face=${t.neckThenFace}`);
      }
      t.neck = 0; t.face = 0; t.faceThenNeck = 0; t.neckThenFace = 0;
      t.reportMs = now;
    }
  }

  public getNeckPose(): {
    head: [number, number, number],
    neckUpper: [number, number, number],
    neckLower: [number, number, number],
  } | null {
    this._t3note('neck');
    const nowMs = performance.now();

    // Advance the single energy envelope at render rate from the latest raw
    // RMS. A stale feed (playback stopped) reads as silence, so the envelope
    // releases smoothly to zero — no separate decay hack, no freeze. This is
    // the only place the energy signal is smoothed; everything downstream
    // reads _energyEnv.
    const rawEnergy = (nowMs - this._lastRmsUpdateMs < ENERGY_FEED_STALE_MS)
      ? this._rawRms : 0;
    const envK = rawEnergy > this._energyEnv ? ENERGY_ATTACK : ENERGY_RELEASE;
    this._energyEnv += envK * (rawEnergy - this._energyEnv);
    this._updatePauseState(nowMs);

    // ── State-transition blend ─────────────────────────────────────────────
    // Baked clips loop start=end, so hard cuts between them still stitch. The
    // procedural layer has no such guarantee, so on ANY state change the
    // output eases from wherever the head currently is to the new state's
    // live pose. Fire-and-forget: a change mid-blend re-captures the current
    // output as the new blend source, so blends never stack. Oscillator phase
    // (t below) stays continuous throughout.
    if (this.curState !== this._prevStateForRamp) {
      this._prevStateForRamp = this.curState;
      this._blendFromDeg.pitch = this._lastOutDeg.pitch;
      this._blendFromDeg.yaw   = this._lastOutDeg.yaw;
      this._blendFromDeg.roll  = this._lastOutDeg.roll;
      this._blendStartMs = nowMs;
      // Cancel any nod in flight — it belongs to the previous state.
      this._nodPendingFireAtMs = 0;
      this._nodStartMs = 0;
    }

    const blendT = this._blendStartMs === 0
      ? 1
      : Math.min(1, (nowMs - this._blendStartMs) / STATE_BLEND_MS);
    const blendK = 1 - Math.pow(1 - blendT, 3); // cubic-out: settle, don't snap

    // Blend finished with an Idle target (= identity delta): hand the body
    // fully back to the baked clip.
    if (this.curState === 'Idle' && blendT >= 1) {
      this._lastOutDeg.pitch = 0;
      this._lastOutDeg.yaw = 0;
      this._lastOutDeg.roll = 0;
      return null;
    }

    // Targets are always computed from the CURRENT state's formulas; Idle's
    // target is simply zero (the lerp below eases the pose down to it).
    const computeState = this.curState;

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
      // One low-frequency pitch bob whose amplitude tracks the energy
      // envelope: quiet speech → small bob, loud speech → bigger bob, and it
      // swells/settles with the voice because the envelope already carries
      // the attack/release. Negative sin dips the head on the downbeat.
      const rhythmAmp = Math.min(
        SPEECH_HEAD.rhythmAmpClampDeg,
        this._energyEnv * SPEECH_HEAD.rhythmRmsToAmpScale,
      );
      baselinePitchDeg += -rhythmAmp * Math.sin(2 * Math.PI * SPEECH_HEAD.rhythmHz * t);
      // Breathing (barely visible at the head).
      baselinePitchDeg += Math.sin(2 * Math.PI * SPEECH_HEAD.breatheHz * t)
                       * SPEECH_HEAD.breathePeakDeg;
      // Slow yaw/roll drift, gated softly by the same envelope so it belongs
      // to the speech and settles in silences (0..1 with a smooth knee).
      const gate = Math.min(1, this._energyEnv / SPEECH_HEAD.gateRef);
      baselineYawDeg = (
        Math.sin(2 * Math.PI * SPEECH_HEAD.yawSlowHz1 * t)
        + 0.5 * Math.sin(2 * Math.PI * SPEECH_HEAD.yawSlowHz2 * t)
      ) / 1.5 * SPEECH_HEAD.yawSlowPeakDeg * gate;
      baselineRollDeg = (
        Math.sin(2 * Math.PI * SPEECH_HEAD.rollHz1 * t)
        + 0.6 * Math.sin(2 * Math.PI * SPEECH_HEAD.rollHz2 * t)
      ) / 1.6 * SPEECH_HEAD.rollPeakDeg * gate;
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

    // Transition blend: ease from the captured pose to the live target. The
    // renderer composes our output as a DELTA on the clip rotation
    // (postmultiply, identity = clip wins). Roll uses a slightly different
    // cervical distribution (45/35/20) because lower-cervical contributes
    // more to lateral flexion (§2 biomech). Renderer reads [pitch, yaw, roll]
    // = [x, y, z] in 'YXZ' Euler order.
    const targetPitchDeg = smoothPitchDeg + nodPitchDeg;
    const outPitchDeg = this._blendFromDeg.pitch + (targetPitchDeg - this._blendFromDeg.pitch) * blendK;
    const outYawDeg   = this._blendFromDeg.yaw   + (smoothYawDeg  - this._blendFromDeg.yaw)   * blendK;
    const outRollDeg  = this._blendFromDeg.roll  + (smoothRollDeg - this._blendFromDeg.roll)  * blendK;
    this._lastOutDeg.pitch = outPitchDeg;
    this._lastOutDeg.yaw   = outYawDeg;
    this._lastOutDeg.roll  = outRollDeg;

    const totalPitchRad = outPitchDeg * DEG_TO_RAD;
    const totalYawRad   = outYawDeg * DEG_TO_RAD;
    const totalRollRad  = outRollDeg * DEG_TO_RAD;

    // DEBUG: log every ~1 s (state / blend progress / output degrees).
    if (!(this as any)._lastNeckDebugMs || nowMs - (this as any)._lastNeckDebugMs > 1000) {
      (this as any)._lastNeckDebugMs = nowMs;
      const p = outPitchDeg.toFixed(2);
      const y = outYawDeg.toFixed(2);
      const r = outRollDeg.toFixed(2);
      // eslint-disable-next-line no-console
      console.log(`[NeckPose] state=${this.curState}  blend=${blendK.toFixed(2)}  energy=${this._energyEnv.toFixed(3)}  pitch=${p}°  yaw=${y}°  roll=${r}°`);
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
    // The silence cue is only meaningful while an audio feed is actually
    // driving the energy signal. Between turns there is no feed, so the
    // accumulated-silence counter is stale — don't schedule phantom nods.
    // (A real user-speech feed will replace this cue.)
    if (nowMs - this._lastRmsUpdateMs > 200) {
      this.msInLowEnergy = 0;
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
   * Feed the RMS energy of an audio frame. Only captures the latest raw
   * sample; the smoothed envelope and pause state are advanced at render rate
   * (see getNeckPose / _updatePauseState), so motion is decoupled from
   * audio-callback timing. RMS is linear in [0, 1].
   */
  public updateAudioRMS(rms: number): void {
    this._rawRms = rms;
    this._lastRmsUpdateMs = performance.now();
  }

  /**
   * Hysteretic speech-pause detector, advanced once per rendered frame off the
   * energy envelope. Feeds the Responding-state gaze aversion clustering.
   */
  private _updatePauseState(nowMs: number): void {
    const dt = this._lastPauseUpdateMs === 0
      ? 16 : Math.min(100, nowMs - this._lastPauseUpdateMs);
    this._lastPauseUpdateMs = nowMs;

    if (this._energyEnv < PAUSE_RMS_THRESHOLD) {
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
    this._t3note('face');
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