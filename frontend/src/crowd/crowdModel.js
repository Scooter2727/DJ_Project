export const DEFAULT_CROWD_CONFIG = {
  activationScore: 0.2,
  gainPerSecond: 9,
  decayPerSecond: 4,
};

const clamp = value => Math.min(100, Math.max(0, value));

const CROWD_RATES = { perfect: 8, good: 2, miss: -1.25 };
const CONSECUTIVE_MISS_RATE = -9;
const CROWD_RESPONSE_SECONDS = 0.18;
export const BOTH_ARMS_MULTIPLIER = 1.5;

export function crowdRateForBeat(judgment, bothArms = false, consecutiveMisses = 0) {
  if (judgment === "miss" && consecutiveMisses >= 2) return CONSECUTIVE_MISS_RATE;
  const rate = CROWD_RATES[judgment] ?? 0;
  return rate > 0 && bothArms ? rate * BOTH_ARMS_MULTIPLIER : rate;
}

export function createCrowdMeter(level) {
  return { level, velocity: 0 };
}

export function advanceCrowdMeter(meter, elapsedSeconds, rate) {
  if (elapsedSeconds <= 0 || (meter.velocity === 0 && rate === 0)) return meter;
  const elapsed = Math.min(elapsedSeconds, 0.25);
  const remaining = Math.exp(-elapsed / CROWD_RESPONSE_SECONDS);
  const initialVelocity = rate * meter.velocity < 0 ? 0 : meter.velocity;
  const speedDifference = initialVelocity - rate;
  const velocity = rate + speedDifference * remaining;
  const distance = rate * elapsed + speedDifference * CROWD_RESPONSE_SECONDS * (1 - remaining);
  const level = clamp(meter.level + distance);
  const reachedLimit = (level === 0 && velocity < 0) || (level === 100 && velocity > 0);
  if (reachedLimit) return level === meter.level && meter.velocity === 0 ? meter : createCrowdMeter(level);
  if (rate === 0 && Math.abs(velocity) < 0.005) return createCrowdMeter(level);
  return { level, velocity };
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
