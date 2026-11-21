export const BEAT_WINDOWS = { perfectMs: 260, goodMs: 480 };
const SKIPS_BEFORE_CROWD_DROP = 2;
const FRAME_PROCESSING_GRACE_MS = 200;

export function createBeatState() {
  return { resolved: new Set() };
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

function cueZone(remainingMs, windows) {
  if (remainingMs > windows.goodMs) return "wait";
  if (remainingMs > windows.perfectMs) return "good";
  if (remainingMs >= -windows.perfectMs) return "perfect";
  return "miss";
}

export function judgeArmFlick(state, songTimeMs, cues, loopMs, windows = BEAT_WINDOWS) {
  if (songTimeMs < -windows.goodMs) return { state, judgment: null, noteTime: null };
  let noteTime = null;
  let bestDistance = Infinity;
  let alreadyScored = false;
  for (const time of noteTimes(songTimeMs, loopMs, cues, windows.goodMs)) {
    const remainingMs = time - songTimeMs;
    const zone = cueZone(remainingMs, windows);
    if (zone !== "perfect" && zone !== "good") continue;
    if (state.resolved.has(time)) {
      alreadyScored = true;
      continue;
    }
    const distance = Math.abs(remainingMs);
    if (distance < bestDistance) {
      noteTime = time;
      bestDistance = distance;
    }
  }
  if (noteTime === null) return { state, judgment: alreadyScored ? null : "miss", noteTime: null };
  const resolved = new Set([...state.resolved].filter(time => time >= songTimeMs - windows.perfectMs));
  resolved.add(noteTime);
  return { state: { resolved }, judgment: cueZone(noteTime - songTimeMs, windows), noteTime };
}

export function skippedCueDeadline(lastScoredCue, cues, loopMs) {
  const nextCues = noteTimes(lastScoredCue ?? 0, loopMs, cues, loopMs)
    .filter(time => lastScoredCue === null || time > lastScoredCue);
  const skippedCue = nextCues[SKIPS_BEFORE_CROWD_DROP - 1];
  return skippedCue === undefined ? Infinity : skippedCue + BEAT_WINDOWS.perfectMs + FRAME_PROCESSING_GRACE_MS;
}

export function visibleCues(songTimeMs, cues, loopMs, leadMs, windows = BEAT_WINDOWS) {
  return noteTimes(songTimeMs, loopMs, cues, Math.max(leadMs, windows.perfectMs))
    .filter(time => time >= songTimeMs - windows.perfectMs && time <= songTimeMs + leadMs)
    .map(time => ({ time, progress: 1 - (time - songTimeMs) / leadMs }));
}

export const TIMER_TRACK = { start: 4, span: 82 };

export function timerWindow(startMs, endMs, leadMs, track = TIMER_TRACK) {
  const hit = track.start + track.span;
  return { left: hit - (startMs / leadMs) * track.span, width: ((startMs - endMs) / leadMs) * track.span };
}

export function timerBars(songTimeMs, cues, loopMs, leadMs, windows = BEAT_WINDOWS, track = TIMER_TRACK) {
  return visibleCues(songTimeMs, cues, loopMs, leadMs, windows).map(cue => {
    const remainingMs = cue.time - songTimeMs;
    const zone = cueZone(remainingMs, windows);
    return { ...cue, remainingMs, zone, left: track.start + cue.progress * track.span };
  });
}
