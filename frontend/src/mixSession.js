import { createMixSource, ROW_BY_CONTROL } from "./mixChart.js";

const silence = { bands: Array(16).fill(0), kick: 0, bass: 0, hats: 0, energy: 0 };

export function createMixSession(chart, selection, bpm, { getAudio, liveValues, onState, onError }) {
  const master = selection === "levels" ? "b" : "a";
  const initialValues = chart.valuesAt(0);
  let audio, screen, mode = "ready", lastValues, entryStarted = false;
  let resumeSecond = false, resumePreview = false;
  const pending = new Map();

  function state(next) {
    mode = next;
    onState(next);
  }
  function transport() {
    const player = audio?.players[master];
    const active = mode === "live" || mode === "demo";
    const time = mode === "finished" ? chart.duration : active ? player?.currentTime || 0 : 0;
    const remaining = chart.entry - time;
    let entryCue = null;
    if (active && selection === "mix1" && remaining <= 3 && remaining > -1.2) {
      entryCue = remaining > 0 ? String(Math.ceil(remaining)) : "SPIN RIGHT";
    }
    return { time, playing: active && !!player && !player.paused && !player.ended && player.readyState >= 2,
      demo: mode === "demo", entryCue };
  }
  function stop(next = "ready") {
    pending.clear();
    audio?.stop();
    entryStarted = resumeSecond = resumePreview = false;
    lastValues = undefined;
    if (next === "ready") source.reset();
    state(next);
  }
  function play(deck, position) {
    if (pending.has(deck)) return;
    const token = Symbol();
    pending.set(deck, token);
    if (position !== undefined) audio.players[deck].currentTime = position;
    audio.setPlaying(deck, true).catch(error => {
      if (pending.get(deck) !== token) return;
      stop();
      onError("Audio could not start. " + error.message);
    }).finally(() => { if (pending.get(deck) === token) pending.delete(deck); });
  }
  function pause(deck) {
    pending.delete(deck);
    audio.pause(deck);
  }
  function start(demo) {
    if (mode === "finished") stop();
    try {
      audio = getAudio();
      const values = demo ? initialValues : { ...initialValues, ...liveValues() };
      mirrorKnobs(values);
      state(demo ? "demo" : "live");
      audio.update(values);
      play(master, 0);
    } catch (error) {
      stop();
      onError("Audio could not start. " + error.message);
    }
  }
  function mirrorKnobs(values) {
    for (const [control, row] of Object.entries(ROW_BY_CONTROL)) {
      for (const [side, channel] of [["a", 1], ["b", 2]]) {
        const key = side + "." + control;
        if (Number.isFinite(values[key]) && values[key] !== lastValues?.[key]) {
          screen.knob({ channel, row, position: values[key] / 16383 });
        }
      }
    }
    lastValues = values;
  }
  const source = createMixSource(chart, bpm, transport, frame => {
    const { time, demo, playing } = frame;
    frame.audio = playing ? audio.audioFrame() : silence;
    if (mode !== "live" && mode !== "demo") return;
    if (time >= chart.duration || audio.players[master].ended) { stop("finished"); return; }
    if (!demo) return;
    if (!playing) {
      if (entryStarted && !audio.players.b.paused) { pause("b"); resumePreview = true; }
      return;
    }
    const values = chart.valuesAt(time);
    if (values !== lastValues) {
      audio.update(values);
      mirrorKnobs(values);
    }
    if (selection === "mix1" && time >= chart.entry) {
      const elapsed = time - chart.entry, second = audio.players.b;
      if (!entryStarted || resumePreview) {
        entryStarted = true;
        resumePreview = false;
        play("b", elapsed);
      } else if (!second.paused && !second.seeking && Math.abs(second.currentTime - elapsed) > 0.12) {
        second.currentTime = elapsed;
      }
    }
  });
  return {
    source, stop,
    attach(view) { screen = view; },
    preview() { if (mode === "demo" || mode === "live") stop(); else start(true); },
    input(deck, playing) {
      if (mode === "demo" || (selection !== "mix1" && deck !== master)) return;
      if (mode !== "live") {
        if (deck === master && playing) start(false);
        return;
      }
      if (!playing) {
        pause(deck);
        if (deck === master && selection === "mix1") {
          resumeSecond = !audio.players.b.paused;
          pause("b");
        }
      } else if (deck === master || !audio.players[master].paused) {
        if (audio.players[deck].paused) play(deck);
        if (deck === master && resumeSecond) { resumeSecond = false; play("b"); }
      }
    },
    update(values) {
      if (mode === "live") audio.update({ ...initialValues, ...values });
    },
    get demo() { return mode === "demo"; },
    destroy() { stop(); source.destroy(); }
  };
}
