import { BEAT_WINDOWS, TIMER_TRACK, createBeatState, judgeArmFlick, skippedCueDeadline, timerBars, timerWindow } from "./beatJudge.js";
import { chartForTempo } from "./beatTrack.js";
import { BOTH_ARMS_MULTIPLIER, smoothToward } from "./crowdModel.js";

export const STARTING_HYPE = 60;
const CELEBRATION_RESET = 75;
const CELEBRATION_SECONDS = 4;
const MISS_DECAY_PER_SECOND = 3;
const METER_RESPONSE_SECONDS = 0.35;
const METER_SETTLED = 0.15;
const HYPE_GAIN = { perfect: 8, good: 5 };
const DECK_HYPE_GAIN = { perfect: 6, good: 3, fade: 8 };

export function hypeTier(level) {
  if (level > 75) return 3;
  if (level >= 50) return 2;
  if (level >= 25) return 1;
  return 0;
}

export function createMainstageHype() {
  let level = STARTING_HYPE;
  let target = level;
  let decayStartsMs = Infinity;
  let celebration = null;
  let returning = false;
  let burst = 0;
  let timing = null;
  let beatState = createBeatState();
  let windows = null;
  let deckMisses = 0;

  function syncPlayback(playback) {
    const { deck, tempo, positionMs, beatOffsetMs = 0 } = playback ?? {};
    if (!Number.isFinite(tempo) || tempo <= 0 || !Number.isFinite(positionMs) || !Number.isFinite(beatOffsetMs)) return null;

    const newClock = !timing || timing.deck !== deck || timing.tempo !== tempo || timing.beatOffsetMs !== beatOffsetMs;
    if (newClock) {
      timing = { deck, tempo, beatOffsetMs, chart: chartForTempo(tempo), positionMs };
      windows = timerWindowForChart(timing.chart);
    }
    const songTimeMs = positionMs - beatOffsetMs;
    if (newClock || Math.abs(positionMs - timing.positionMs) > 750 || positionMs < timing.positionMs - 20) {
      beatState = createBeatState();
      decayStartsMs = skippedCueDeadline(null, timing.chart.cues, timing.chart.loopMs, songTimeMs - BEAT_WINDOWS.perfectMs);
    }
    timing.positionMs = positionMs;
    return { ...timing, songTimeMs };
  }

  function awardFlick(playback, frame, nowMs) {
    if (!playback?.playing || frame.flickAt == null || celebration || returning || target === 100) return;
    const clock = syncPlayback(playback);
    if (!clock) return;

    const { chart } = clock;
    const frameAge = Math.max(0, nowMs - frame.flickAt);
    const songTimeMs = clock.songTimeMs - frameAge * (playback.playbackRate ?? 1);
    const result = judgeArmFlick(beatState, songTimeMs, chart.cues, chart.loopMs);
    beatState = result.state;
    if (result.noteTime === null) return;

    const multiplier = frame.metrics.armsUp === 2 ? BOTH_ARMS_MULTIPLIER : 1;
    target = Math.min(100, target + HYPE_GAIN[result.judgment] * multiplier);
    decayStartsMs = skippedCueDeadline(result.noteTime, chart.cues, chart.loopMs);
  }

  function awardDeck(result) {
    if (result === "miss") {
      deckMisses++;
      return;
    }
    if (!Object.hasOwn(DECK_HYPE_GAIN, result)) return;
    deckMisses = 0;
    if (!celebration && !returning) target = Math.min(100, target + DECK_HYPE_GAIN[result]);
  }

  function frame(playback, dt, { danceEnabled = true } = {}) {
    const clock = syncPlayback(playback);
    const active = Boolean(clock && playback.playing);
    const elapsed = Math.min(Math.max(dt, 0), 0.25);

    if (celebration) {
      const time = celebration.elapsed + elapsed;
      if (time >= CELEBRATION_SECONDS) {
        celebration = null;
        returning = true;
        target = CELEBRATION_RESET;
      } else {
        celebration = { ...celebration, elapsed: time };
      }
    } else if (returning || active) {
      const shouldDrain = danceEnabled ? clock?.songTimeMs > decayStartsMs : deckMisses >= 2;
      if (active && !returning && target < 100 && shouldDrain) {
        target = Math.max(0, target - MISS_DECAY_PER_SECOND * elapsed);
      }
      level = smoothToward(level, target, elapsed, METER_RESPONSE_SECONDS);
      if (Math.abs(level - target) <= METER_SETTLED) {
        level = target;
        if (returning) {
          returning = false;
          decayStartsMs = clock
            ? skippedCueDeadline(null, clock.chart.cues, clock.chart.loopMs, clock.songTimeMs)
            : Infinity;
        } else if (level === 100) {
          celebration = { id: ++burst, elapsed: 0, duration: CELEBRATION_SECONDS };
        }
      }
    }

    const bars = clock ? timerBars(clock.songTimeMs, clock.chart.cues, clock.chart.loopMs, clock.chart.leadMs)
      .filter(bar => !beatState.resolved.has(bar.time)) : [];
    return {
      level,
      tier: hypeTier(level),
      celebration,
      tempo: clock?.tempo ?? null,
      beat: clock ? clock.songTimeMs * clock.tempo / 60000 : null,
      bars,
      windows,
      cueLine: TIMER_TRACK.start + TIMER_TRACK.span,
    };
  }

  return { awardFlick, awardDeck, frame, scoreState: () => ({ level, celebration }) };
}

function timerWindowForChart(chart) {
  return {
    good: timerWindow(BEAT_WINDOWS.goodMs, BEAT_WINDOWS.perfectMs, chart.leadMs),
    perfect: timerWindow(BEAT_WINDOWS.perfectMs, -BEAT_WINDOWS.perfectMs, chart.leadMs),
  };
}
