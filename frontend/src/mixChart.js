import { createMixScoring, hypeBonus } from "./mixScoring.js";

export const ROW_BY_CONTROL = { trim: "TRIM", high: "HI", mid: "MID", low: "LOW", cfx: "CFX" };
const MAX = 16383;
const DEAD_BAND = 256;
const APPROACH = 4;
const clampMidi = value => Math.max(0, Math.min(MAX, value));

function indexAt(points, t) {
  let low = 0, high = points.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (points[mid].t <= t) low = mid; else high = mid;
  }
  return low;
}

function recordedPositions(events, key) {
  const changes = [];
  for (const { t, values } of events) {
    if (!Number.isFinite(values?.[key])) continue;
    const value = clampMidi(values[key]);
    const last = changes.at(-1);
    if (last?.t === t) last.value = value;
    else if (value !== last?.value) changes.push({ t, value });
  }
  return changes;
}

// Group the two bytes of a MIDI update when identifying gestures for scoring.
// The visual guide uses the original timestamps, just like audio playback.
function controlChanges(points) {
  const changes = [];
  for (const { t, value } of points) {
    const last = changes.at(-1);
    if (last && t - last.t <= 4) last.value = value;
    else changes.push({ t, value });
  }
  return changes.filter((p, i) => !i || p.value !== changes[i - 1].value);
}

function gestures(points, emit) {
  let base = 0, first = 1, peak = 0, sign = 0;
  for (let i = 1; i < points.length; i++) {
    if (i > first && points[i].t - points[i - 1].t > 180) {
      if (sign) emit(points[first], points[base], points[peak]);
      base = peak = i - 1;
      first = i;
      sign = 0;
    }
    const value = points[i].value;
    if (!sign) {
      const delta = value - points[base].value;
      if (Math.abs(delta) >= DEAD_BAND) {
        sign = Math.sign(delta);
        peak = i;
      }
    } else if ((value - points[peak].value) * sign >= 0) {
      peak = i;
    } else if ((points[peak].value - value) * sign >= DEAD_BAND) {
      emit(points[first], points[base], points[peak]);
      base = peak;
      first = peak + 1;
      peak = i;
      sign = -sign;
    }
  }
  if (sign) emit(points[first], points[base], points[peak]);
}

const MIN_RAIL_SECONDS = 0.18;
const TIGHT_TOLERANCE = 0.045;
const NEAR_TOLERANCE = 0.12;
const MAX_SAMPLE_GAP = 0.25;

function makeRail(positions, start, end, from, to, songTime) {
  const time = songTime(start);
  const endTime = Math.max(songTime(end), time + MIN_RAIL_SECONDS);
  const points = [{ t: time, value: from / MAX }];
  for (const point of positions) {
    if (point.t > start && point.t < end) points.push({ t: songTime(point.t), value: point.value / MAX });
  }
  if (end > start && endTime > songTime(end)) {
    const scale = (endTime - time) / (songTime(end) - time);
    for (const point of points) point.t = time + (point.t - time) * scale;
  }
  points.push({ t: endTime, value: to / MAX });
  return { endTime, rail: points };
}

export function railPositionAt(note, time) {
  const points = note.rail;
  const index = indexAt(points, time);
  const a = points[index], b = points[index + 1];
  if (!b || time <= a.t) return a.value;
  return a.value + (b.value - a.value) * (time - a.t) / (b.t - a.t);
}

export function buildMixChart(recording, manifest, selection = "mix1") {
  if (!recording?.events?.length || !(recording.durationMs > 0)) throw new Error("The mix recording is empty.");
  const { events } = recording;
  const entry = manifest.deckBEntryMs / 1000;
  const offset = manifest.cueOffsetMs / 1000 - (selection === "levels" ? entry : 0);
  const songTime = t => t / 1000 + offset;
  const curves = {};
  const aiCues = manifest.kind === "ai" ? recording.cues : null;
  const notes = (aiCues ?? []).filter(cue => cue.control !== "mixer.crossfade").map(cue => {
    const [deck, control] = cue.control.split(".");
    return { channel: deck === "a" ? 1 : 2, row: ROW_BY_CONTROL[control], time: songTime(cue.t),
      dir: cue.to > cue.from ? "cw" : "ccw", degrees: Math.abs(cue.to - cue.from) / MAX * 180,
      startPosition: cue.from / MAX, label: cue.label,
      ...makeRail(recordedPositions(events, cue.control), cue.t, cue.endMs, cue.from, cue.to, songTime) };
  });
  for (const [control, row] of Object.entries(ROW_BY_CONTROL)) {
    for (const [side, channel] of [["a", 1], ["b", 2]]) {
      if ((selection === "heroes" && side === "b") || (selection === "levels" && side === "a")) continue;
      const positions = recordedPositions(events, side + "." + control);
      if (!positions.length) continue;
      curves[channel + ":" + row] = positions;
      if (aiCues) continue;
      gestures(controlChanges(positions), (first, base, peak) => {
        const time = songTime(first.t);
        if (time < 0) return;
        const delta = peak.value - base.value;
        notes.push({ channel, row, time, dir: delta > 0 ? "cw" : "ccw",
          degrees: Math.abs(delta) / MAX * 180, startPosition: base.value / MAX,
          ...makeRail(positions, first.t, peak.t, base.value, peak.value, songTime) });
      });
    }
  }
  notes.sort((a, b) => a.time - b.time);
  const fades = (aiCues ?? []).filter(cue => cue.control === "mixer.crossfade").map(cue => ({
    start:songTime(cue.t), end:songTime(cue.endMs), from:cue.from/MAX, to:cue.to/MAX,
  }));
  if (selection === "mix1" && !aiCues) {
    const points = controlChanges(recordedPositions(events, "mixer.crossfade"));
    gestures(points, (first, base, peak) => {
      fades.push({ start: songTime(first.t), end: songTime(peak.t), from: base.value / MAX, to: peak.value / MAX });
    });
  }
  return { notes, entry, aiCues, fades, duration: songTime(recording.durationMs), valuesAt(time) {
    return events[indexAt(events, (time - offset) * 1000)].values;
  }, crossfadeCueAt(time) {
    const fade = fades.find(move => move.end >= time);
    if (!fade || fade.start - time > APPROACH) return null;
    return { to: fade.to, ready: Math.min(1, 1 - (fade.start - time) / APPROACH) };
  }, tracesAt(time) {
    const from = (time - offset) * 1000, windowMs = APPROACH * 1000, traces = {};
    for (const [lane, points] of Object.entries(curves)) {
      const current = from < points[0].t ? -1 : indexAt(points, from);
      const changes = [];
      for (let i = current + 1; i < points.length && points[i].t <= from + windowMs; i++) {
        changes.push({ fraction: (points[i].t - from) / windowMs, position: points[i].value / MAX });
      }
      traces[lane] = { position: current < 0 ? 0.5 : points[current].value / MAX, changes };
    }
    return traces;
  } };
}

const FADE_EARLY_SECONDS = 0.3;
const FADE_LATE_SECONDS = 0.35;
const FADE_HOLD_SECONDS = 0.18;
const FADE_TARGET_TOLERANCE = 0.06;

// Both drawing and MIDI judgments read the media playhead, including after a slow frame.
export function createMixSource(chart, bpm, readTransport, onFrame, {
  getHype = () => ({}), onDeckResult = () => {},
} = {}) {
  let screen, unsubscribe, notes, scoring, fades, fadeIndex, nextNote, lastTime;
  const knobPositions = new Map();
  const active = [];
  function reset(fromTime = 0) {
    notes = chart.notes.map((n, id) => ({ ...n, id, state: n.endTime <= fromTime ? "skipped" : "pending",
      movement: 0, engaged: false, nearTime: 0, tightTime: 0, totalTime: 0 }));
    active.length = 0;
    nextNote = 0;
    lastTime = null;
    fades = (chart.fades ?? []).filter(fade => fade.end >= fromTime && Math.abs(fade.to - fade.from) >= 0.12)
      .map(fade => ({ ...fade, hadMovement: false, enteredAt: null }));
    fadeIndex = 0;
    scoring = createMixScoring(getHype, award => screen?.showScoreAward?.(award));
  }
  reset();

  function bandAt(note, time, demo) {
    if (demo) return "tight";
    const key = note.channel + ":" + note.row;
    const position = knobPositions.get(key);
    if (!Number.isFinite(position) || !note.engaged) return "off";
    const error = Math.abs(position - railPositionAt(note, time));
    return error <= TIGHT_TOLERANCE ? "tight" : error <= NEAR_TOLERANCE ? "near" : "off";
  }

  function finishRail(note, demo) {
    const { totalTime, nearTime, tightTime } = note;
    if (!totalTime) { note.state = "skipped"; return; }
    const result = tightTime / totalTime >= 0.72 ? "perfect" : nearTime / totalTime >= 0.5 ? "good" : "miss";
    note.state = result === "miss" ? "miss" : "hit";
    note.judgedAt = note.endTime;
    if (!demo) onDeckResult(result);
    screen?.showJudgment({ channel: note.channel, row: note.row, judgment: result });
  }

  function trackRails({ time, demo, playing, scoringEnabled }) {
    const previous = lastTime;
    lastTime = playing && scoringEnabled !== false ? time : null;
    if (scoringEnabled === false) return [];
    while (notes[nextNote] && notes[nextNote].time <= time) {
      const note = notes[nextNote++];
      if (note.state === "pending") {
        note.state = "tracking";
        active.push(note);
      }
    }
    if (lastTime !== null && previous !== null && time > previous) {
      const skipped = time - previous > MAX_SAMPLE_GAP;
      const boundaries = [...new Set([previous, time, ...active.flatMap(note => [note.time, note.endTime])
        .filter(t => t > previous && t < time)])].sort((a, b) => a - b);
      for (let index = 1; index < boundaries.length; index++) {
        const seconds = boundaries[index] - boundaries[index - 1];
        const middle = boundaries[index] - seconds / 2;
        const bands = active.filter(note => note.time <= middle && middle < note.endTime).map(note => {
          const band = skipped ? "off" : bandAt(note, middle, demo);
          note.totalTime += seconds;
          if (band !== "off") note.nearTime += seconds;
          if (band === "tight") note.tightTime += seconds;
          return band;
        });
        scoring.sample(seconds, bands, demo);
      }
    }
    for (let index = active.length - 1; index >= 0; index--) {
      const note = active[index];
      if (time < note.endTime) continue;
      finishRail(note, demo);
      active.splice(index, 1);
    }
    return active.map(note => ({
      channel: note.channel, row: note.row,
      target: railPositionAt(note, time), band: bandAt(note, time, demo),
    }));
  }

  function trackCrossfade({ time, playerCrossfade, demo, scoringEnabled }) {
    if (scoringEnabled === false) return;
    while (fades[fadeIndex] && time > fades[fadeIndex].end + FADE_LATE_SECONDS + FADE_HOLD_SECONDS) fadeIndex++;
    const fade = fades[fadeIndex];
    if (!fade || time < fade.start - FADE_EARLY_SECONDS) return;
    if (demo) {
      if (time >= fade.end) {
        fadeIndex++;
        scoring.bonus(500, "Clean fade");
      }
      return;
    }
    if (!Number.isFinite(playerCrossfade)) return;
    const distance = fade.to - playerCrossfade / MAX;
    if (Math.abs(distance) > FADE_TARGET_TOLERANCE) {
      fade.hadMovement ||= Math.sign(fade.to - fade.from) * distance > FADE_TARGET_TOLERANCE;
      fade.enteredAt = null;
      return;
    }
    if (!fade.hadMovement) return;
    fade.enteredAt ??= time;
    if (fade.enteredAt > fade.end + FADE_LATE_SECONDS ||
      time < Math.max(fade.end, fade.enteredAt + FADE_HOLD_SECONDS)) return;
    fadeIndex++;
    const onTime = fade.enteredAt <= fade.end + 0.001;
    scoring.bonus(onTime ? 500 : 250, onTime ? "Clean fade" : "Recovered fade");
    onDeckResult("fade");
  }

  return {
    reset,
    summary() { return scoring.stats(); },
    addJogBonus(points) { scoring.bonus(points, "Deck B jog"); },
    attach(view) {
      screen = view;
      unsubscribe = view.onTurn(turn => {
        if (!Number.isFinite(turn.position)) return;
        const { time, playing, demo, scoringEnabled } = readTransport();
        knobPositions.set(turn.channel + ":" + turn.row, turn.position);
        if (!playing || demo || scoringEnabled === false || !Number.isFinite(turn.amount)) return;
        for (const note of notes) {
          if (note.time > time + 0.08) break;
          if (note.channel === turn.channel && note.row === turn.row && time <= note.endTime &&
            (note.state === "tracking" || note.state === "pending") && !note.engaged) {
            note.movement += turn.amount;
            const threshold = Math.min(0.035, Math.max(0.006, note.degrees / 180 * 0.15));
            note.engaged = Math.abs(note.movement) >= threshold;
          }
        }
      });
    },
    frame() {
      const transport = readTransport();
      const { time, demo, playing } = transport;
      if (playing && transport.scoringEnabled !== false) trackCrossfade(transport);
      const rails = trackRails(transport);
      onFrame(transport);
      const visible = notes.filter(n => n.time <= time + APPROACH &&
        (n.state === "pending" || n.state === "tracking" || (n.state === "miss" && time - n.judgedAt < 0.35)));
      const { score, combo, multiplier } = scoring.stats();
      return { time, bpm, approach: APPROACH, notes: visible, rails, score, combo, multiplier,
        hypeBonus: demo ? 0 : hypeBonus(getHype()), mode: demo ? "demo" : "live",
        audio: transport.audio, entryCue: transport.entryCue, jogCues: transport.jogCues, recordedMix: true, traces: chart.tracesAt(time),
        wheels: transport.wheels, crossfade: transport.crossfade, crossfadeCue: transport.crossfadeCue,
        guided: transport.guided, mixerGuide: transport.mixerGuide };
    },
    destroy() { unsubscribe?.(); }
  };
}
