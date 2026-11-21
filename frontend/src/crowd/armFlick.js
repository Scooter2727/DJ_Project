export const ARM_FLICK = { cooldownMs: 160 };

export function createArmFlickState() {
  return { lastAt: -Infinity };
}

export function detectArmFlick(state, gestures, timestamp, config = ARM_FLICK) {
  if ((gestures.leftFlick || gestures.rightFlick) && timestamp - state.lastAt >= config.cooldownMs) {
    return { state: { lastAt: timestamp }, flick: true };
  }
  return { state, flick: false };
}
