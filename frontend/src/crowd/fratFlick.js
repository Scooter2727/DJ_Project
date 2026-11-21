import { POSE } from "./danceScorer.js";

export const FRAT_FLICK_BONUS = 3;

export const DEFAULT_FRAT_CONFIG = {
  visibilityThreshold: 0.55,
  raisedMargin: 0,
  fratMatchDistance: 0.18,
  fratFlickSpeed: 3.5,
  fratFlickReversal: 0.15,
  fratFlickWindowMs: 280,
  fratFlickCooldownMs: 500,
};

const length = vector => Math.hypot(vector.x, vector.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = vector => {
  const magnitude = length(vector);
  return magnitude ? { x: vector.x / magnitude, y: vector.y / magnitude } : { x: 0, y: 0 };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const visible = (point, threshold) =>
  point && (point.visibility ?? 1) >= threshold && (point.presence ?? 1) >= threshold;

export function createFratState() {
  return { timestamp: null, tracks: [], lastFlickAt: -Infinity };
}

export function raisedWrists(pose, config = DEFAULT_FRAT_CONFIG) {
  if (!pose?.length) return [];
  return [[POSE.leftShoulder, POSE.leftWrist], [POSE.rightShoulder, POSE.rightWrist]].flatMap(([shoulderIndex, wristIndex]) => {
    const shoulder = pose[shoulderIndex];
    const wrist = pose[wristIndex];
    if (!visible(shoulder, config.visibilityThreshold) || !visible(wrist, config.visibilityThreshold)) return [];
    return wrist.y < shoulder.y + config.raisedMargin ? [wrist] : [];
  });
}

export function isFratShape(hand) {
  if (!hand || hand.length < 21) return false;
  const wrist = hand[0];
  const indexMcp = hand[5];
  const indexTip = hand[8];
  const palm = Math.max(dist(wrist, indexMcp), 0.02);
  const indexReach = dist(wrist, indexTip);
  const indexExtended = indexReach > palm * 1.45 && dist(indexMcp, indexTip) > palm * 0.8;
  const curled = tip => dist(wrist, hand[tip]) < indexReach * 0.72;
  return indexExtended && curled(12) && curled(16) && curled(20);
}

function nearest(point, items, read) {
  let best = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const distance = dist(point, read(item));
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return { item: best, distance: bestDistance };
}

export function analyzeFratFlick(pose, hands, timestamp, previous = createFratState(), overrides = {}) {
  const config = { ...DEFAULT_FRAT_CONFIG, ...overrides };
  const raised = raisedWrists(pose, config);
  const candidates = (hands ?? []).filter(hand => hand?.length >= 21 && isFratShape(hand) && nearest(hand[0], raised, wrist => wrist).distance <= config.fratMatchDistance);
  const dt = previous.timestamp === null ? 0 : Math.min(0.2, Math.max(0.016, (timestamp - previous.timestamp) / 1000));
  const used = new Set();
  let flick = false;

  const tracks = candidates.map(hand => {
    const wrist = hand[0];
    const palm = Math.max(dist(wrist, hand[5]), 0.02);
    const relative = { x: hand[8].x - hand[5].x, y: hand[8].y - hand[5].y };
    let prior = null;
    let priorDistance = config.fratMatchDistance;
    previous.tracks.forEach((track, index) => {
      if (used.has(index)) return;
      const distance = dist(wrist, track.wrist);
      if (distance < priorDistance) {
        prior = track;
        priorDistance = distance;
      }
    });
    if (prior) used.add(previous.tracks.indexOf(prior));
    const velocity = prior && dt > 0
      ? { x: (relative.x - prior.relative.x) / dt / palm, y: (relative.y - prior.relative.y) / dt / palm }
      : { x: 0, y: 0 };
    const reversal = prior ? dot(unit(prior.velocity), unit(velocity)) : 1;
    const snapped = prior
      && length(velocity) >= config.fratFlickSpeed
      && length(prior.velocity) >= config.fratFlickSpeed * 0.65
      && reversal <= config.fratFlickReversal
      && dt * 1000 <= config.fratFlickWindowMs
      && timestamp - previous.lastFlickAt >= config.fratFlickCooldownMs;
    if (snapped) flick = true;
    return { wrist, relative, velocity };
  });

  return {
    state: { timestamp, tracks, lastFlickAt: flick ? timestamp : previous.lastFlickAt },
    flick,
    raised: raised.length > 0,
  };
}
