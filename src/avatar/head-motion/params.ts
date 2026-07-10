/**
 * Head-motion parameter packs — one per conversational state.
 *
 * The controller runs the same always-on generators (coherent-noise ambient
 * drift + breathing) in every state; the pack only retargets their
 * amplitudes. State changes therefore never toggle machinery on/off, they
 * just move parameters, and the spring integrator eases between them — the
 * "states as parameter packs over always-running generators" pattern
 * (Anguelov, Game AI Pro 2; SmartBody).
 *
 * Amplitudes are PEAK degrees before cervical distribution. They are small on
 * purpose: the avatar rig is head-locked (rotating the head bone moves the
 * upper body as a block), so visible angles are inflated, and over-driving
 * head motion measurably *reduces* perceived quality (Munhall et al. 2004).
 *
 * Axis priority reflects conversational kinematics: in real speech pitch stays
 * small (≈85% of frames within ±15°) while yaw (turning) is the widest axis —
 * so yaw carries the ambient variety and pitch is kept modest. Motion follows
 * the (irregular) energy envelope, never a fixed oscillator, so it reads as
 * belonging to the speech rather than as a metronomic nod.
 */

export type HeadMotionState = 'Idle' | 'Listening' | 'Responding' | 'Thinking';

/** Peak degrees for one axis: an always-on ambient part + a speech-scaled part. */
interface AxisAmp {
  /** Always present (× 1). */
  ambient: number;
  /** Added in proportion to speech energy 0..1. */
  speech: number;
}

export interface StatePack {
  pitch: AxisAmp;
  yaw: AxisAmp;
  roll: AxisAmp;
  /** Base frequency (Hz) of the ambient coherent noise. */
  noiseHz: number;
}

export const STATE_PACKS: Record<HeadMotionState, StatePack> = {
  // Not in conversation: barely-there life. Quiet-stance sway is <1°, ~0.3 Hz.
  Idle: {
    pitch: { ambient: 0.5, speech: 0 },
    yaw:   { ambient: 1.0, speech: 0 },
    roll:  { ambient: 0.6, speech: 0 },
    noiseHz: 0.16,
  },
  // User speaking: attentive, a touch more alive than idle, still small.
  Listening: {
    pitch: { ambient: 0.6, speech: 0 },
    yaw:   { ambient: 1.3, speech: 0 },
    roll:  { ambient: 0.8, speech: 0 },
    noiseHz: 0.18,
  },
  // Avatar speaking: the most animated state. Motion grows with speech energy;
  // yaw-dominant (widest axis in real speech), pitch kept modest. Noise (not a
  // sine) keeps it non-periodic.
  Responding: {
    pitch: { ambient: 0.6, speech: 2.5 },
    yaw:   { ambient: 1.5, speech: 7.0 },
    roll:  { ambient: 0.9, speech: 3.5 },
    noiseHz: 0.4,
  },
  // Deliberating (not yet wired widget-side): slow, low drift.
  Thinking: {
    pitch: { ambient: 0.4, speech: 0 },
    yaw:   { ambient: 0.6, speech: 0 },
    roll:  { ambient: 0.5, speech: 0 },
    noiseHz: 0.12,
  },
};

/** Breathing — a legitimately periodic, near-invisible pitch component (all states). */
export const BREATHING = { hz: 0.25, peakDeg: 0.4 };

/** Spring half-life (s) for the pose integrator — snappy without lag, no overshoot. */
export const POSE_HALFLIFE_SEC = 0.12;

/**
 * Cervical distribution: how the total rotation is split along head → neckUpper
 * → neckLower. Roll splits slightly more evenly (lower cervical contributes
 * more to lateral flexion; Bogduk & Mercer 2000).
 */
export const CERVICAL = {
  pitchYaw: { head: 0.55, neckUpper: 0.30, neckLower: 0.15 },
  roll: { head: 0.45, neckUpper: 0.35, neckLower: 0.20 },
};

/** Seconds since the last raw RMS sample beyond which the feed is treated as silent. */
export const ENERGY_FEED_STALE_SEC = 0.15;
