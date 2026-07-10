import { SpringDamped } from './SpringDamped';
import { CoherentNoise } from './CoherentNoise';
import { EnergyEnvelope } from './EnergyEnvelope';
import {
  STATE_PACKS, BREATHING, POSE_HALFLIFE_SEC, CERVICAL, ENERGY_FEED_STALE_SEC,
  type HeadMotionState,
} from './params';

const DEG_TO_RAD = Math.PI / 180;

/** Per-bone Euler ('YXZ', radians) delta the renderer post-multiplies onto the clip. */
export interface NeckPose {
  head: [number, number, number];
  neckUpper: [number, number, number];
  neckLower: [number, number, number];
}

/**
 * Procedural head/neck motion — the single owner of the neck pose delta.
 *
 * Pipeline per frame (all advanced on the render clock, so motion is
 * decoupled from audio-callback timing):
 *   raw RMS ─▶ EnergyEnvelope ─▶ per-axis target = coherentNoise · (ambient +
 *   energy·speech) + breathing ─▶ SpringDamped ─▶ cervical distribution.
 *
 * The state only selects a parameter pack; generators run continuously and the
 * spring eases between packs, so transitions and interruptions are smooth by
 * construction — there is no separate blend/fade code, and no code path can
 * make the output jump.
 *
 * Gaze is handled elsewhere (renderer camera look-at); this owns head pose only.
 */
export class HeadMotionController {
  private readonly energy = new EnergyEnvelope();
  // Independent noise per axis so the axes are uncorrelated.
  private readonly noisePitch = new CoherentNoise(101);
  private readonly noiseYaw = new CoherentNoise(211);
  private readonly noiseRoll = new CoherentNoise(307);
  private readonly springPitch = new SpringDamped(0);
  private readonly springYaw = new SpringDamped(0);
  private readonly springRoll = new SpringDamped(0);

  private tSec = 0;
  private lastRawRms = 0;
  private secSinceRms = Infinity;

  // Cached output — allocation-free (called every render frame).
  private readonly pose: NeckPose = {
    head: [0, 0, 0], neckUpper: [0, 0, 0], neckLower: [0, 0, 0],
  };

  /** Feed the latest audio RMS (linear amplitude). Cheap; call as samples arrive. */
  setAudioRms(rms: number): void {
    this.lastRawRms = Math.max(0, rms);
    this.secSinceRms = 0;
  }

  /**
   * Advance one frame and return the neck-pose delta.
   * @param state current conversational state
   * @param dtSec elapsed seconds since the last call (clamped internally)
   */
  update(state: HeadMotionState, dtSec: number): NeckPose {
    const dt = Math.min(Math.max(dtSec, 0), 0.1); // robust to tab stalls
    this.tSec += dt;
    this.secSinceRms += dt;

    // Energy: a stale feed means playback stopped ⇒ silence ⇒ release to 0.
    const rawRms = this.secSinceRms < ENERGY_FEED_STALE_SEC ? this.lastRawRms : 0;
    const energy = this.energy.update(rawRms, dt);

    const pack = STATE_PACKS[state] ?? STATE_PACKS.Idle;
    const t = this.tSec;

    const pitchTarget =
      this.noisePitch.sample(t, pack.noiseHz) * (pack.pitch.ambient + energy * pack.pitch.speech)
      + Math.sin(2 * Math.PI * BREATHING.hz * t) * BREATHING.peakDeg;
    const yawTarget =
      this.noiseYaw.sample(t, pack.noiseHz) * (pack.yaw.ambient + energy * pack.yaw.speech);
    const rollTarget =
      this.noiseRoll.sample(t, pack.noiseHz) * (pack.roll.ambient + energy * pack.roll.speech);

    const pitchDeg = this.springPitch.update(pitchTarget, POSE_HALFLIFE_SEC, dt);
    const yawDeg = this.springYaw.update(yawTarget, POSE_HALFLIFE_SEC, dt);
    const rollDeg = this.springRoll.update(rollTarget, POSE_HALFLIFE_SEC, dt);

    this.distribute(pitchDeg * DEG_TO_RAD, yawDeg * DEG_TO_RAD, rollDeg * DEG_TO_RAD);
    return this.pose;
  }

  /** Current smoothed energy 0..1 (for diagnostics). */
  get energyLevel(): number {
    return this.energy.value;
  }

  private distribute(pitchRad: number, yawRad: number, rollRad: number): void {
    const d = CERVICAL.pitchYaw;
    const r = CERVICAL.roll;
    this.pose.head[0] = pitchRad * d.head;
    this.pose.head[1] = yawRad * d.head;
    this.pose.head[2] = rollRad * r.head;
    this.pose.neckUpper[0] = pitchRad * d.neckUpper;
    this.pose.neckUpper[1] = yawRad * d.neckUpper;
    this.pose.neckUpper[2] = rollRad * r.neckUpper;
    this.pose.neckLower[0] = pitchRad * d.neckLower;
    this.pose.neckLower[1] = yawRad * d.neckLower;
    this.pose.neckLower[2] = rollRad * r.neckLower;
  }
}
