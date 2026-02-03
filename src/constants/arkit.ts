// Centralized ARKit Blendshape Names
// Single source of truth for all 52 ARKit blendshape names

export const ARKIT_BLENDSHAPE_NAMES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut'
] as const;

export type ArkitBlendshapeName = typeof ARKIT_BLENDSHAPE_NAMES[number];

export const ARKIT_BLENDSHAPE_COUNT = ARKIT_BLENDSHAPE_NAMES.length; // 52

/**
 * Create a neutral weights object with all blendshapes set to 0
 * Pre-frozen for safety and performance
 */
export function createNeutralWeights(): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    weights[name] = 0;
  }
  // Add a subtle smile to the neutral expression
  weights['mouthSmileLeft'] = 0.40;
  weights['mouthSmileRight'] = 0.40;
  weights['jawOpen'] = 0.05;

  return weights;
}

/**
 * Create a mutable weights object (for live updates)
 */
export function createMutableWeights(): Record<string, number> {
  return createNeutralWeights();
}

/**
 * Fast copy weights from source to destination
 * Avoids Object.assign and spread operator overhead
 */
export function copyWeights(
  source: Record<string, number>,
  dest: Record<string, number>
): void {
  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    dest[name] = source[name] ?? 0;
  }
}
