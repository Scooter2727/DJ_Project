export const ROW_BY_CONTROL = { trim: "TRIM", high: "HI", mid: "MID", low: "LOW", cfx: "CFX" };
const MAX = 16383;
const DEAD_BAND = 256;
const APPROACH = 4;
const TRACE_STEPS = 48;
const clampMidi = value => Math.max(0, Math.min(MAX, value));

function indexAt(points, t) {
  let low = 0, high = points.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (points[mid].t <= t) low = mid; else high = mid;
  }
  return low;
}

// A 14-bit knob update often arrives as two messages a fraction of a millisecond apart.
// Keep the first timestamp and the settled value so the low bits don't create false turns.
function controlChanges(events, key) {
  const changes = [];
  let previous;
  for (const { t, values } of events) {
    if (!Number.isFinite(values?.[key])) continue;
    const value = clampMidi(values[key]);
    if (value === previous) continue;
    previous = value;
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
      const changes = controlChanges(events, side + "." + control);
      if (changes.length) curves[channel + ":" + row] = changes;
      gestures(changes, (first, base, peak) => {
        const time = songTime(first.t);
        if (time < 0) return;
        const delta = peak.value - base.value;
        notes.push({ channel, row, time, dir: delta > 0 ? "cw" : "ccw",
          degrees: Math.abs(delta) / MAX * 298, startPosition: base.value / MAX });
      });
    }
  }
  notes.sort((a, b) => a.time - b.time);
  return { notes, entry, duration: songTime(recording.durationMs), valuesAt(time) {
    return events[indexAt(events, (time - offset) * 1000)].values;
  }, tracesAt(time) {
    const from = (time - offset) * 1000, traces = {};
    for (const [lane, points] of Object.entries(curves)) {
      let i = indexAt(points, from);
      if (!points[i + 1] || points[i + 1].t > from + APPROACH * 1000) continue;
      const origin = points[i].value, trace = [0];
      for (let step = 1; step <= TRACE_STEPS; step++) {
        const at = from + step / TRACE_STEPS * APPROACH * 1000;
        while (points[i + 1] && points[i + 1].t <= at) i++;
        trace.push((points[i].value - origin) / MAX);
      }
      traces[lane] = trace;
    }
    return traces;
  } };
}

// Both drawing and MIDI judgments read the media playhead, including after a slow frame.
export function createMixSource(chart, bpm, readTransport, onFrame) {
  let screen, unsubscribe, notes, score, combo;
  function reset() {
    notes = chart.notes.map((n, id) => ({ ...n, id, state: "pending" }));
    score = combo = 0;
  }
  reset();
  function judge(note, time, result, reason) {
    note.state = result === "miss" ? "miss" : "hit";
    note.judgedAt = time;
    combo = result === "miss" ? 0 : combo + 1;
    score += (result === "perfect" ? 300 : result === "good" ? 100 : 0) * Math.min(4, 1 + Math.floor(combo / 10));
    screen.showJudgment({ channel: note.channel, row: note.row, judgment: result, reason });
  }
  return {
    reset,
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
        audio: transport.audio, entryCue: transport.entryCue, recordedMix: true, traces: chart.tracesAt(time) };
    },
    destroy() { unsubscribe?.(); }
  };
}
