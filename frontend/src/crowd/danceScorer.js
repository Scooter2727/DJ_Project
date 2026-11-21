export const DEFAULT_DANCE_CONFIG = {
  visibilityThreshold: 0.55,
  smoothing: 0.32,
  minMotionSpeed: 0.08,
  maxMotionSpeed: 3.2,
  flickMinTravel: 0.15,
  flickWindowMs: 140,
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
const visible = (point, threshold) =>
  point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && (point.visibility ?? 1) >= threshold && (point.presence ?? 1) >= threshold;
const relativeTo = (point, origin) => ({ x: point.x - origin.x, y: point.y - origin.y });
const MAX_POSE_GAP_MS = 150;
const FLICK_RETURN_DELAY_MS = 375;

function blankArm({ lastPumpAt = -Infinity, lastFlickAt = -Infinity } = {}) {
  return {
    wrist: null,
    elbow: null,
    velocity: { x: 0, y: 0 },
    verticalTravel: 0,
    lastPumpAt,
    lastFlickAt,
    movementSamples: [],
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
  const wristPoint = landmarks[POSE[prefix + "Wrist"]];
  const elbowPoint = landmarks[POSE[prefix + "Elbow"]];
  const shoulder = landmarks[POSE[prefix + "Shoulder"]];
  const isVisible = visible(wristPoint, config.visibilityThreshold) && visible(shoulder, config.visibilityThreshold);

  const wrist = isVisible ? relativeTo(wristPoint, shoulder) : null;
  const aboveShoulder = Boolean(wrist && wrist.y < config.raisedMargin);
  if (!aboveShoulder) {
    return {
      arm: { ...blankArm(previous), wrist },
      speed: 0,
      raised: false,
      flickAt: null,
      pump: false,
      visible: Boolean(isVisible),
    };
  }

  const elbow = visible(elbowPoint, config.visibilityThreshold) ? relativeTo(elbowPoint, shoulder) : null;
  const sample = { wrist, timestamp: now };
  const rearmAt = previous.lastFlickAt + FLICK_RETURN_DELAY_MS;
  const coolingDown = now < rearmAt;
  if (!previous.wrist || dt <= 0) {
    return {
      arm: { ...blankArm(previous), wrist, elbow, movementSamples: coolingDown ? [] : [sample] },
      speed: 0,
      raised: true,
      flickAt: null,
      pump: false,
      visible: true,
    };
  }

  let start = previous.wrist;
  if (start.y >= config.raisedMargin) {
    const crossing = (config.raisedMargin - start.y) / (wrist.y - start.y);
    start = { x: start.x + (wrist.x - start.x) * crossing, y: config.raisedMargin };
  }
  const wristDelta = relativeTo(wrist, start);
  const velocity = { x: wristDelta.x / dt / scale, y: wristDelta.y / dt / scale };
  const wristSpeed = length(velocity);
  const elbowSpeed = elbow && previous.elbow ? length(relativeTo(elbow, previous.elbow)) / dt / scale : wristSpeed;
  const recentMovement = coolingDown ? [] : previous.movementSamples.filter(point =>
    point.timestamp >= rearmAt && now - point.timestamp <= config.flickWindowMs,
  );
  const moved = recentMovement.some(sample => length(relativeTo(wrist, sample.wrist)) >= config.flickMinTravel * scale);

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
      verticalTravel: pump ? 0 : previous.verticalTravel + Math.abs(wristDelta.y) / scale,
      lastPumpAt: pump ? now : previous.lastPumpAt,
      lastFlickAt: moved ? now : previous.lastFlickAt,
      movementSamples: moved || coolingDown ? [] : [...recentMovement, sample],
    },
    speed: wristSpeed * 0.7 + elbowSpeed * 0.3,
    raised: true,
    flickAt: moved ? now : null,
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
      state: { ...previous, timestamp, left: blankArm(previous.left), right: blankArm(previous.right) },
      metrics: { detected: false, score: 0, crowd: 0, burst: 0, motion: 0, raised: 0, armsUp: 0, flickPulse: 0, pumpPulse: 0 },
      gestures: { leftFlick: false, rightFlick: false, leftPump: false, rightPump: false },
      flickAt: null,
    };
  }

  const leftShoulder = landmarks[POSE.leftShoulder];
  const rightShoulder = landmarks[POSE.rightShoulder];
  const shouldersVisible = visible(leftShoulder, config.visibilityThreshold)
    && visible(rightShoulder, config.visibilityThreshold);
  const shoulderWidth = shouldersVisible
    ? Math.max(0.08, Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y))
    : 0.2;
  const elapsedMs = previous.timestamp === null ? 0 : timestamp - previous.timestamp;
  const dt = elapsedMs > 0 && elapsedMs <= MAX_POSE_GAP_MS ? Math.max(elapsedMs / 1000, 0.016) : 0;
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
  const flickAt = left.flickAt ?? right.flickAt;
  const lastFlickAt = flickAt ?? previous.lastFlickAt;
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
      leftFlick: left.flickAt !== null,
      rightFlick: right.flickAt !== null,
      leftPump: left.pump,
      rightPump: right.pump,
    },
    flickAt,
  };
}
