const BUTTON_CONTROLS = new Set([
  "a.sync", "a.loopIn", "a.loopOut", "a.play",
  "b.sync", "b.loopIn", "b.loopOut", "b.play",
]);

const CONTINUOUS_CONTROLS = [
  "a.trim", "a.high", "a.mid", "a.low", "a.cfx", "a.tempo",
  "b.trim", "b.high", "b.mid", "b.low", "b.cfx", "b.tempo",
  "mixer.crossfade", "a.jog", "b.jog",
];

const CONTROL_WEIGHTS = {
  "mixer.crossfade": 1.4,
  "a.low": 1.1,
  "b.low": 1.1,
};

const SAMPLE_INTERVAL_MS = 50;
const ACTIVE_CHANGE_THRESHOLD = 128;
const BUTTON_TIMING_WINDOW_MS = 250;

const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

function lastEventTime(events) {
  return events.length ? events[events.length - 1].t : 0;
}

function createSampler(events = []) {
  let index = 0;
  let values = events[0]?.values || {};

  return time => {
    while (index + 1 < events.length && events[index + 1].t <= time) {
      index += 1;
      values = events[index].values || values;
    }
    return values;
  };
}

function findActiveControls(events) {
  const firstSeen = {};
  const minimum = {};
  const maximum = {};
  const previous = {};

  for (const event of events) {
    for (const control of CONTINUOUS_CONTROLS) {
      const value = event.values?.[control];
      if (value === undefined) continue;
      minimum[control] = minimum[control] === undefined ? value : Math.min(minimum[control], value);
      maximum[control] = maximum[control] === undefined ? value : Math.max(maximum[control], value);
      if (previous[control] !== undefined
        && firstSeen[control] === undefined
        && Math.abs(value - previous[control]) >= ACTIVE_CHANGE_THRESHOLD) {
        firstSeen[control] = event.t;
      }
      previous[control] = value;
    }
  }

  return CONTINUOUS_CONTROLS.filter(control =>
    firstSeen[control] !== undefined
    && maximum[control] - minimum[control] >= ACTIVE_CHANGE_THRESHOLD
  ).map(control => ({ control, start: firstSeen[control] }));
}

function collectButtonChanges(events) {
  const previous = {};
  const changes = [];

  for (const event of events) {
    for (const control of BUTTON_CONTROLS) {
      const value = event.values?.[control];
      if (typeof value !== "boolean" || value === previous[control]) continue;
      changes.push({ t: event.t, control, pressed: value });
      previous[control] = value;
    }
  }
  return changes;
}

function continuousAccuracy(target, actual) {
  if (target === undefined || actual === undefined) return 0;
  const error = Math.abs(target - actual) / 16383;
  const grace = 0.025;
  const failure = 0.35;
  if (error <= grace) return 1;
  return clamp(1 - (error - grace) / (failure - grace));
}

function scoreContinuous(referenceEvents, attemptEvents, durationMs) {
  const activeControls = findActiveControls(referenceEvents);
  if (!activeControls.length) return { score: 100, controls: [] };

  const targetAt = createSampler(referenceEvents);
  const playerAt = createSampler(attemptEvents);
  const totals = new Map(activeControls.map(({ control }) => [control, { points: 0, weight: 0 }]));

  for (let time = 0; time <= durationMs; time += SAMPLE_INTERVAL_MS) {
    const target = targetAt(time);
    const player = playerAt(time);
    for (const { control, start } of activeControls) {
      if (time < start) continue;
      const weight = CONTROL_WEIGHTS[control] || 1;
      const result = totals.get(control);
      result.points += continuousAccuracy(target[control], player[control]) * weight;
      result.weight += weight;
    }
  }

  const controls = activeControls.map(({ control }) => {
    const result = totals.get(control);
    return {
      control,
      score: result.weight ? Math.round(result.points / result.weight * 100) : 100,
    };
  });
  const totalWeight = controls.reduce((sum, item) => sum + (CONTROL_WEIGHTS[item.control] || 1), 0);
  const score = controls.reduce((sum, item) => sum + item.score * (CONTROL_WEIGHTS[item.control] || 1), 0) / totalWeight;
  return { score: Math.round(score), controls };
}

function scoreButtons(referenceEvents, attemptEvents) {
  const reference = collectButtonChanges(referenceEvents);
  const attempt = collectButtonChanges(attemptEvents);
  if (!reference.length) return { score: 100, matched: 0, total: 0 };

  const used = new Set();
  let points = 0;
  let matched = 0;
  for (const target of reference) {
    let bestIndex = -1;
    let bestDelta = Infinity;
    attempt.forEach((candidate, index) => {
      if (used.has(index) || candidate.control !== target.control || candidate.pressed !== target.pressed) return;
      const delta = Math.abs(candidate.t - target.t);
      if (delta <= BUTTON_TIMING_WINDOW_MS && delta < bestDelta) {
        bestIndex = index;
        bestDelta = delta;
      }
    });
    if (bestIndex === -1) continue;
    used.add(bestIndex);
    matched += 1;
    points += 1 - bestDelta / BUTTON_TIMING_WINDOW_MS;
  }

  const extraPenalty = Math.max(0, attempt.length - matched) * 0.25;
  const score = clamp((points - extraPenalty) / reference.length) * 100;
  return { score: Math.round(score), matched, total: reference.length };
}

export function gradeForScore(score) {
  if (score >= 95) return "Perfect!";
  if (score >= 88) return "Great!";
  if (score >= 75) return "Good";
  if (score >= 60) return "Needs work";
  return "Keep practicing";
}

export function scoreRecording(reference, attempt) {
  const referenceEvents = reference?.events || [];
  const attemptEvents = attempt?.events || [];
  const durationMs = Math.max(reference?.durationMs || 0, attempt?.durationMs || lastEventTime(attemptEvents));
  const continuous = scoreContinuous(referenceEvents, attemptEvents, durationMs);
  const buttons = scoreButtons(referenceEvents, attemptEvents);
  const score = Math.round(continuous.score * 0.8 + buttons.score * 0.2);

  return {
    score,
    grade: gradeForScore(score),
    continuousScore: continuous.score,
    buttonScore: buttons.score,
    controls: continuous.controls,
    buttons,
  };
}

export function targetStateAt(events, time) {
  return createSampler(events)(time);
}

export function upcomingContinuousControls(events = [], time, horizonMs = 500) {
  const upcoming = new Set();
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.t <= time) continue;
    if (event.t > time + horizonMs) break;
    const previous = events[index - 1]?.values || {};
    for (const control of CONTINUOUS_CONTROLS) {
      const currentValue = event.values?.[control];
      const previousValue = previous[control];
      if (currentValue === undefined || previousValue === undefined) continue;
      const threshold = control.endsWith(".jog") ? 3 : ACTIVE_CHANGE_THRESHOLD;
      if (Math.abs(currentValue - previousValue) >= threshold) upcoming.add(control);
    }
  }
  return upcoming;
}
