import { describe, it, expect } from 'vitest';
import { HeadMotionController } from './HeadMotionController';

const dt = 1 / 60;

/** Peak absolute head-pitch/yaw/roll (degrees) observed over a run. */
function peakDegrees(run: (c: HeadMotionController) => void) {
  const c = new HeadMotionController();
  const peak = { pitch: 0, yaw: 0, roll: 0 };
  const orig = c.update.bind(c);
  // Wrap update to record every emitted pose (head bone carries the largest share).
  (c as unknown as { update: typeof c.update }).update = (state, step) => {
    const p = orig(state, step);
    // Undo the cervical head-share (0.55 / 0.45) to recover total degrees.
    peak.pitch = Math.max(peak.pitch, Math.abs(p.head[0]) / 0.55);
    peak.yaw = Math.max(peak.yaw, Math.abs(p.head[1]) / 0.55);
    peak.roll = Math.max(peak.roll, Math.abs(p.head[2]) / 0.45);
    return p;
  };
  run(c);
  const R2D = 180 / Math.PI;
  return { pitch: peak.pitch * R2D, yaw: peak.yaw * R2D, roll: peak.roll * R2D };
}

describe('HeadMotionController', () => {
  it('emits small motion in Idle (well under a couple of degrees)', () => {
    const peak = peakDegrees((c) => {
      for (let i = 0; i < 60 * 60; i++) c.update('Idle', dt); // 60 s
    });
    expect(peak.pitch).toBeLessThan(1.5);
    expect(peak.yaw).toBeLessThan(2.0);
    expect(peak.roll).toBeLessThan(1.5);
  });

  it('moves more while Responding to loud speech than while Idle', () => {
    const idle = peakDegrees((c) => { for (let i = 0; i < 3600; i++) c.update('Idle', dt); });
    const talk = peakDegrees((c) => {
      for (let i = 0; i < 3600; i++) { c.setAudioRms(0.15); c.update('Responding', dt); }
    });
    // Energy ordering: speaking >> idle, and yaw is the widest axis in speech.
    expect(talk.yaw).toBeGreaterThan(idle.yaw * 2);
    expect(talk.yaw).toBeGreaterThan(talk.pitch); // yaw dominates pitch
  });

  it('keeps pitch modest even at full speech energy (no big nod)', () => {
    const talk = peakDegrees((c) => {
      for (let i = 0; i < 3600; i++) { c.setAudioRms(0.2); c.update('Responding', dt); }
    });
    expect(talk.pitch).toBeLessThan(4); // demoted pitch — never a large nod
  });

  it('settles toward stillness when speech stops (no dancing in silence)', () => {
    const c = new HeadMotionController();
    for (let i = 0; i < 1800; i++) { c.setAudioRms(0.15); c.update('Responding', dt); }
    // Stop feeding RMS: energy must release to ~0.
    for (let i = 0; i < 600; i++) c.update('Responding', dt);
    expect(c.energyLevel).toBeLessThan(0.05);
  });

  it('never produces a discontinuity, even on abrupt state + energy changes', () => {
    const c = new HeadMotionController();
    let prev = c.update('Idle', dt);
    let maxJump = 0;
    const states = ['Idle', 'Responding', 'Listening', 'Responding', 'Idle'] as const;
    for (let s = 0; s < states.length; s++) {
      for (let i = 0; i < 120; i++) {
        // Slam energy on/off every few frames to stress the spring.
        if (i % 7 === 0) c.setAudioRms(0.25);
        const p = c.update(states[s], dt);
        const jump = Math.abs(p.head[0] - prev.head[0])
          + Math.abs(p.head[1] - prev.head[1])
          + Math.abs(p.head[2] - prev.head[2]);
        maxJump = Math.max(maxJump, jump);
        prev = p;
      }
    }
    // Per-frame change stays tiny (radians) — provably no snap.
    expect(maxJump).toBeLessThan(0.02);
  });

  it('is allocation-free (returns the same cached object)', () => {
    const c = new HeadMotionController();
    const a = c.update('Responding', dt);
    const b = c.update('Responding', dt);
    expect(a).toBe(b);
  });
});
