export const BEAT_WINDOWS = { perfectMs: 200, goodMs: 420 };
export const BEAT_DELTAS = { perfect: 10, good: 5, miss: 0, offbeat: -3 };

export function createBeatState() {
  return { resolved: new Map() };
}

export function noteTimes(songTimeMs, loopMs, cues, horizonMs) {
  if (!Number.isFinite(songTimeMs)) return [];
  const firstLap = Math.max(0, Math.floor((songTimeMs - horizonMs) / loopMs) - 1);
  const lastLap = Math.floor((songTimeMs + horizonMs) / loopMs) + 1;
  const times = [];
  for (let lap = firstLap; lap <= lastLap; lap += 1) {
    for (const cue of cues) times.push(lap * loopMs + cue);
  }
  return times;
}

function closestPending(state, songTimeMs, cues, loopMs, windowMs) {
  let best = null;
  let bestDistance = Infinity;
  for (const time of noteTimes(songTimeMs, loopMs, cues, windowMs)) {
    if (state.resolved.has(time)) continue;
    const distance = Math.abs(time - songTimeMs);
    if (distance <= windowMs && distance < bestDistance) {
      best = time;
      bestDistance = distance;
    }
  }
  return best === null ? null : { time: best, distance: bestDistance };
}

export function judgeArmFlick(state, songTimeMs, cues, loopMs, windows = BEAT_WINDOWS) {
  const pending = closestPending(state, songTimeMs, cues, loopMs, windows.goodMs);
  if (!pending) return { state, judgment: "offbeat", noteTime: null };
  const judgment = pending.distance <= windows.perfectMs ? "perfect" : "good";
  const resolved = new Map(state.resolved);
  resolved.set(pending.time, judgment);
  return { state: { resolved }, judgment, noteTime: pending.time };
}

export function collectMisses(state, songTimeMs, cues, loopMs, windows = BEAT_WINDOWS) {
  const resolved = new Map(state.resolved);
  const missed = [];
  for (const time of noteTimes(songTimeMs, loopMs, cues, loopMs)) {
    if (resolved.has(time) || time > songTimeMs - windows.goodMs || time < 0) continue;
    resolved.set(time, "miss");
    missed.push(time);
  }
  return { state: { resolved }, missed };
}

export function visibleCues(songTimeMs, cues, loopMs, leadMs) {
  return noteTimes(songTimeMs, loopMs, cues, leadMs)
    .filter(time => time >= songTimeMs - BEAT_WINDOWS.goodMs && time <= songTimeMs + leadMs)
    .map(time => ({ time, progress: 1 - (time - songTimeMs) / leadMs }));
}

export const TIMER_TRACK = { start: 4, span: 82 };

export function timerWindow(windowMs, leadMs, track = TIMER_TRACK) {
  const half = (windowMs / leadMs) * track.span;
  const hit = track.start + track.span;
  return { left: hit - half, width: half * 2 };
}

export function timerBars(songTimeMs, cues, loopMs, leadMs, windows = BEAT_WINDOWS, track = TIMER_TRACK) {
  return visibleCues(songTimeMs, cues, loopMs, leadMs).map(cue => {
    const remainingMs = cue.time - songTimeMs;
    const distance = Math.abs(remainingMs);
    const zone = distance <= windows.perfectMs ? "perfect" : distance <= windows.goodMs ? "good" : remainingMs > 0 ? "wait" : "late";
    return { ...cue, remainingMs, zone, left: track.start + cue.progress * track.span };
  });
}
