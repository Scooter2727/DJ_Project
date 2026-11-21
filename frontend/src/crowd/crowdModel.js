export const DEFAULT_CROWD_CONFIG = {
  activationScore: 0.2,
  gainPerSecond: 9,
  decayPerSecond: 4,
};

const clamp = value => Math.min(100, Math.max(0, value));

export const BEAT_POINTS = { perfect: 10, good: 5, miss: 0, offbeat: -3 };
export const BOTH_ARMS_MULTIPLIER = 1.5;

export function beatPoints(judgment, bothArms = false) {
  const points = BEAT_POINTS[judgment] ?? 0;
  return points > 0 && bothArms ? points * BOTH_ARMS_MULTIPLIER : points;
}

export function applyBeatResult(happiness, judgment, bothArms = false) {
  return clamp(happiness + beatPoints(judgment, bothArms));
}

export function decayCrowd(happiness, elapsedSeconds, perSecond = 1.6) {
  if (elapsedSeconds <= 0) return clamp(happiness);
  return clamp(happiness - perSecond * Math.min(elapsedSeconds, 0.25));
}

export function smoothToward(current, target, elapsedSeconds, responseSeconds = 0.35) {
  if (!Number.isFinite(current)) return target;
  if (elapsedSeconds <= 0 || responseSeconds <= 0) return current;
  const blend = 1 - Math.exp(-Math.min(elapsedSeconds, 0.25) / responseSeconds);
  return current + (target - current) * blend;
}

export function updateCrowdHappiness(
  happiness,
  metrics,
  elapsedSeconds,
  active = true,
  overrides = {},
) {
  if (!active) return clamp(happiness);
  const config = { ...DEFAULT_CROWD_CONFIG, ...overrides };
  const score = metrics?.detected ? Math.min(1, Math.max(0, metrics.score || 0)) : 0;
  const delta = score >= config.activationScore
    ? config.gainPerSecond * ((score - config.activationScore) / (1 - config.activationScore))
    : -config.decayPerSecond * ((config.activationScore - score) / config.activationScore);
  const rate = elapsedSeconds > 0 ? delta * Math.min(elapsedSeconds, 0.25) : 0;
  return clamp(happiness + rate);
}

export function crowdMood(happiness, detected = true) {
  if (!detected) return { label: "FIND YOUR POSE", tier: "missing" };
  if (happiness >= 90) return { label: "CROWD GOING WILD", tier: "wild" };
  if (happiness >= 70) return { label: "HYPE", tier: "hype" };
  if (happiness >= 40) return { label: "FEELING IT", tier: "moving" };
  return { label: "MOVE MORE", tier: "warming" };
}
