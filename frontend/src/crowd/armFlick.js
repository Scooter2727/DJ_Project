export const ARM_FLICK = { trigger: 0.12, rearm: 0.06, cooldownMs: 320 };

export function createArmFlickState() {
  return { ready: true, lastAt: -Infinity };
}

export function detectArmFlick(state, crowd, timestamp, config = ARM_FLICK) {
  const level = Number.isFinite(crowd) ? crowd : 0;
  if (!state.ready) {
    const rearmed = level <= config.rearm && timestamp - state.lastAt >= config.cooldownMs;
    return { state: rearmed ? { ...state, ready: true } : state, flick: false };
  }
  if (level >= config.trigger) {
    return { state: { ready: false, lastAt: timestamp }, flick: true };
  }
  return { state, flick: false };
}
