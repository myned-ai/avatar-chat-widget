/**
 * Procedural head/neck motion for the avatar.
 *
 * A small, layered, testable motion system: a signal stage (EnergyEnvelope)
 * turns audio RMS into a smooth speech-energy signal; coherent noise drives
 * non-periodic ambient drift; per-state parameter packs retarget amplitudes;
 * and a critically-damped spring integrates everything into a continuous pose.
 * See HeadMotionController for the composed pipeline.
 */
export { HeadMotionController, type NeckPose } from './HeadMotionController';
export { type HeadMotionState } from './params';
