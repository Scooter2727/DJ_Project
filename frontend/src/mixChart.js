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

export function buildMixChart(recording, manifest, selection = "mix1") {
  if (!recording?.events?.length || !(recording.durationMs > 0)) throw new Error("The mix recording is empty.");
  const { events } = recording;
  const entry = manifest.deckBEntryMs / 1000;
  const offset = manifest.cueOffsetMs / 1000 - (selection === "levels" ? entry : 0);
  const songTime = t => t / 1000 + offset;
  const curves = {};
  const notes = [];
  for (const [control, row] of Object.entries(ROW_BY_CONTROL)) {
    for (const [side, channel] of [["a", 1], ["b", 2]]) {
      if ((selection === "heroes" && side === "b") || (selection === "levels" && side === "a")) continue;
      const positions = recordedPositions(events, side + "." + control);
      if (!positions.length) continue;
      curves[channel + ":" + row] = positions;
      gestures(controlChanges(positions), (first, base, peak) => {
        const time = songTime(first.t);
        if (time < 0) return;
        const delta = peak.value - base.value;
        notes.push({ channel, row, time, dir: delta > 0 ? "cw" : "ccw",
          degrees: Math.abs(delta) / MAX * 180, startPosition: base.value / MAX });
      });
    }
  }
  notes.sort((a, b) => a.time - b.time);
  return { notes, entry, duration: songTime(recording.durationMs), valuesAt(time) {
    return events[indexAt(events, (time - offset) * 1000)].values;
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

// Both drawing and MIDI judgments read the media playhead, including after a slow frame.
export function createMixSource(chart, bpm, readTransport, onFrame) {
  let screen, unsubscribe, notes, score, combo;
  function reset(fromTime = 0) {
    notes = chart.notes.map((n, id) => ({ ...n, id, state: n.time < fromTime ? "skipped" : "pending" }));
    score = combo = 0;
  }
  reset();
  function award(points, multiplier) {
    if (points <= 0) return;
    score += points;
    screen?.showScoreAward?.({ points, multiplier });
  }
  function applyJudgment(result) {
    combo = result === "miss" ? 0 : combo + 1;
    const multiplier = Math.min(4, 1 + Math.floor(combo / 10));
    award((result === "perfect" ? 300 : result === "good" ? 100 : 0) * multiplier, multiplier);
  }
  function judge(note, time, result, reason) {
    note.state = result === "miss" ? "miss" : "hit";
    note.judgedAt = time;
    applyJudgment(result);
    screen.showJudgment({ channel: note.channel, row: note.row, judgment: result, reason });
  }
  return {
    reset,
    addJogBonus(points) { award(points, 1); },
    attach(view) {
      screen = view;
      unsubscribe = view.onTurn(turn => {
        const { time, playing, demo } = readTransport();
        if (!playing || demo || !turn.dir) return;
        const candidates = notes.filter(n => n.state === "pending" && n.channel === turn.channel &&
          n.row === turn.row && Math.abs(n.time - time) <= 0.15);
        const n = candidates.sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
        if (!n) return;
        const error = Math.abs(n.time - time);
        if (n.dir !== turn.dir) judge(n, time, "miss", "wrong-way");
        else judge(n, time, error <= 0.05 ? "perfect" : error <= 0.11 ? "good" : "miss");
      });
    },
    frame() {
      const transport = readTransport();
      const { time, demo, playing } = transport;
      if (playing) {
        for (const n of notes) {
          if (n.time > time) break;
          if (n.state !== "pending") continue;
          if (demo) judge(n, time, "perfect");
          else if (time - n.time > 0.15) judge(n, time, "miss");
        }
      }
      onFrame(transport);
      const visible = notes.filter(n => n.time <= time + APPROACH && (n.state === "pending" || time - n.judgedAt < 0.35));
      return { time, bpm, approach: APPROACH, notes: visible, score, combo,
        multiplier: Math.min(4, 1 + Math.floor(combo / 10)), mode: demo ? "demo" : "live",
        audio: transport.audio, entryCue: transport.entryCue, jogCues: transport.jogCues, recordedMix: true, traces: chart.tracesAt(time),
        wheels: transport.wheels, crossfade: transport.crossfade, guided: transport.guided, mixerGuide: transport.mixerGuide };
    },
    destroy() { unsubscribe?.(); }
  };
}
