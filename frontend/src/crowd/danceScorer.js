export const DEFAULT_DANCE_CONFIG = {
  visibilityThreshold: 0.55,
  smoothing: 0.32,
  minMotionSpeed: 0.08,
  maxMotionSpeed: 3.2,
  flickSpeed: 1.55,
  flickReversalDot: -0.2,
  flickMinTravel: 0.18,
  flickWindowMs: 280,
  flickCooldownMs: 420,
  pumpSpeed: 0.72,
  pumpMinTravel: 0.24,
  pumpWindowMs: 720,
  pumpCooldownMs: 480,
  raisedMargin: 0,
  pulseMs: 620,
  motionWeight: 0.55,
  raisedWeight: 0.16,
  flickWeight: 0.17,
  pumpWeight: 0.12,
};

export const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const length = vector => Math.hypot(vector.x, vector.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = vector => {
  const magnitude = length(vector);
  return magnitude ? { x: vector.x / magnitude, y: vector.y / magnitude } : { x: 0, y: 0 };
};
const visible = (point, threshold) =>
  point && (point.visibility ?? 1) >= threshold && (point.presence ?? 1) >= threshold;

function blankArm() {
  return {
    wrist: null,
    elbow: null,
    velocity: { x: 0, y: 0 },
    travel: 0,
    verticalTravel: 0,
    lastFlickAt: -Infinity,
    lastPumpAt: -Infinity,
  };
}

export function createDanceState() {
  return {
    timestamp: null,
    motion: 0,
    left: blankArm(),
    right: blankArm(),
    lastFlickAt: -Infinity,
    lastPumpAt: -Infinity,
  };
}

function armFrame(side, landmarks, previous, dt, scale, now, config) {
  const prefix = side === "left" ? "left" : "right";
  const wrist = landmarks[POSE[prefix + "Wrist"]];
  const elbow = landmarks[POSE[prefix + "Elbow"]];
  const shoulder = landmarks[POSE[prefix + "Shoulder"]];
  const isVisible = [wrist, elbow, shoulder].every(point => visible(point, config.visibilityThreshold));

  const aboveShoulder = isVisible && wrist.y < shoulder.y + config.raisedMargin;
  if (!isVisible || !aboveShoulder) {
    return {
      arm: { ...blankArm(), lastFlickAt: previous.lastFlickAt, lastPumpAt: previous.lastPumpAt },
      speed: 0,
      raised: false,
      flick: false,
      pump: false,
      visible: isVisible,
    };
  }

  if (!previous.wrist || !previous.elbow || dt <= 0) {
    return {
      arm: { ...previous, wrist, elbow, velocity: { x: 0, y: 0 }, travel: 0, verticalTravel: 0 },
      speed: 0,
      raised: true,
      flick: false,
      pump: false,
      visible: true,
    };
  }

  const wristDelta = { x: wrist.x - previous.wrist.x, y: wrist.y - previous.wrist.y };
  const elbowDelta = { x: elbow.x - previous.elbow.x, y: elbow.y - previous.elbow.y };
  const velocity = { x: wristDelta.x / dt / scale, y: wristDelta.y / dt / scale };
  const elbowVelocity = { x: elbowDelta.x / dt / scale, y: elbowDelta.y / dt / scale };
  const wristSpeed = length(velocity);
  const elbowSpeed = length(elbowVelocity);
  const reversal = dot(unit(previous.velocity), unit(velocity));
  const elapsedSinceFlick = now - previous.lastFlickAt;
  const flick = wristSpeed >= config.flickSpeed
    && length(previous.velocity) >= config.flickSpeed
    && reversal <= config.flickReversalDot
    && previous.travel >= config.flickMinTravel
    && dt * 1000 <= config.flickWindowMs
    && elapsedSinceFlick >= config.flickCooldownMs;

  const verticalReversal = Math.sign(previous.velocity.y) !== 0
    && Math.sign(velocity.y) !== 0
    && Math.sign(previous.velocity.y) !== Math.sign(velocity.y);
  const pump = Math.abs(velocity.y) >= config.pumpSpeed
    && Math.abs(previous.velocity.y) >= config.pumpSpeed
    && verticalReversal
    && previous.verticalTravel >= config.pumpMinTravel
    && dt * 1000 <= config.pumpWindowMs
    && now - previous.lastPumpAt >= config.pumpCooldownMs;

  return {
    arm: {
      wrist,
      elbow,
      velocity,
      travel: flick ? 0 : previous.travel + length(wristDelta) / scale,
      verticalTravel: pump ? 0 : previous.verticalTravel + Math.abs(wristDelta.y) / scale,
      lastFlickAt: flick ? now : previous.lastFlickAt,
      lastPumpAt: pump ? now : previous.lastPumpAt,
    },
    speed: wristSpeed * 0.7 + elbowSpeed * 0.3,
    raised: true,
    flick,
    pump,
    visible: true,
  };
}

export function analyzeDance(
  landmarks,
  timestamp,
  previous = createDanceState(),
  overrides = {},
) {
  const config = { ...DEFAULT_DANCE_CONFIG, ...overrides };
  if (!landmarks?.length) {
    return {
      state: { ...previous, timestamp },
      metrics: { detected: false, score: 0, crowd: 0, burst: 0, motion: 0, raised: 0, armsUp: 0, flickPulse: 0, pumpPulse: 0 },
      gestures: { leftFlick: false, rightFlick: false, leftPump: false, rightPump: false },
    };
  }

  const leftShoulder = landmarks[POSE.leftShoulder];
  const rightShoulder = landmarks[POSE.rightShoulder];
  const shouldersVisible = visible(leftShoulder, config.visibilityThreshold)
    && visible(rightShoulder, config.visibilityThreshold);
  const shoulderWidth = shouldersVisible
    ? Math.max(0.08, Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y))
    : 0.2;
  const dt = previous.timestamp === null ? 0 : clamp((timestamp - previous.timestamp) / 1000, 0.016, 0.2);
  const left = armFrame("left", landmarks, previous.left, dt, shoulderWidth, timestamp, config);
  const right = armFrame("right", landmarks, previous.right, dt, shoulderWidth, timestamp, config);
  const validArms = Number(left.visible) + Number(right.visible);
  const raisedArms = [left, right].filter(arm => arm.visible && arm.raised);
  const rawSpeed = raisedArms.length ? raisedArms.reduce((sum, arm) => sum + arm.speed, 0) / raisedArms.length : 0;
  const motionTarget = clamp(
    (rawSpeed - config.minMotionSpeed) / (config.maxMotionSpeed - config.minMotionSpeed),
  );
  const motion = previous.motion + (motionTarget - previous.motion) * config.smoothing;
  const raised = validArms ? (Number(left.raised) + Number(right.raised)) / validArms : 0;
  const lastFlickAt = left.flick || right.flick ? timestamp : previous.lastFlickAt;
  const lastPumpAt = left.pump || right.pump ? timestamp : previous.lastPumpAt;
  const flickPulse = clamp(1 - (timestamp - lastFlickAt) / config.pulseMs);
  const pumpPulse = clamp(1 - (timestamp - lastPumpAt) / config.pulseMs);
  const score = validArms ? clamp(
    motion * config.motionWeight
      + raised * config.raisedWeight
      + flickPulse * config.flickWeight
      + pumpPulse * config.pumpWeight,
  ) : 0;

  return {
    state: {
      timestamp,
      motion,
      left: left.arm,
      right: right.arm,
      lastFlickAt,
      lastPumpAt,
    },
    metrics: {
      detected: validArms > 0,
      score,
      crowd: raisedArms.length ? motion : 0,
      burst: raisedArms.length ? motionTarget : 0,
      motion,
      raised,
      armsUp: Number(left.raised) + Number(right.raised),
      flickPulse,
      pumpPulse,
    },
    gestures: {
      leftFlick: left.flick,
      rightFlick: right.flick,
      leftPump: left.pump,
      rightPump: right.pump,
    },
  };
}
