import { createMixSource, ROW_BY_CONTROL } from "./mixChart.js";

const silence = { bands: Array(16).fill(0), kick: 0, bass: 0, hats: 0, energy: 0 };
const RIGHT_CUE_DELAY_SECONDS = 0.75;

export function createMixSession(chart, selection, bpm, {
  getAudio, liveValues, onState, onError, getLevelsDelayMs = () => 0,
  recordedLevels = null, onRecording = () => {},
}) {
  const master = selection === "levels" ? "b" : "a";
  let levelsEntry = chart.entry;
  let rightCueTime = levelsEntry + RIGHT_CUE_DELAY_SECONDS;
  const initialValues = chart.valuesAt(0);
  let audio, screen, mode = "ready", lastValues, entryStarted = false;
  let crossfade = initialValues["mixer.crossfade"] ?? 8191;
  let resumeSecond = false, resumePreview = false;
  let rightArmed = false;
  let capture, levelsEventIndex = 0, replayLevelsEntry;
  const pending = new Map();

  function captureMixer(values) {
    if (!capture) return;
    const t = audio.players.a.currentTime * 1000;
    const last = capture.events.at(-1);
    if (last && Object.keys(values).every(key => values[key] === last.values[key])) return;
    const event = { t, values: { ...values } };
    if (last?.t === t) capture.events[capture.events.length - 1] = event;
    else capture.events.push(event);
  }

  function finishCapture() {
    const recording = capture;
    capture = undefined;
    if (!recording) return;
    const durationMs = audio.players.a.currentTime * 1000;
    onRecording({ ...recording, durationMs: Math.max(1, durationMs) });
  }

  function capturePlayButton(deck, source, requestedPlaying) {
    if (!capture || !source) return;
    capture.playButtonEvents.push({
      t: audio.players.a.currentTime * 1000,
      deck,
      source,
      requestedPlaying,
    });
  }

  function state(next) {
    mode = next;
    onState(next);
  }
  function transport() {
    const player = audio?.players[master];
    const active = mode === "live" || mode === "demo";
    const time = mode === "finished" ? chart.duration : active ? player?.currentTime || 0 : 0;
    const wheels = audio ? {
      a: { time: audio.players.a.currentTime, playing: !audio.players.a.paused && !audio.players.a.ended },
      b: { time: audio.players.b.currentTime, playing: !audio.players.b.paused && !audio.players.b.ended },
    } : { a: { time: 0, playing: false }, b: { time: 0, playing: false } };
    const cue = demoCueTime();
    const remaining = cue - time;
    let entryCue = null;
    if (active && selection === "mix1" && remaining <= 3 && remaining > -1.2) {
      entryCue = remaining > 0 ? String(Math.ceil(remaining)) : "SPIN RIGHT";
    }
    return { time, playing: active && !!player && !player.paused && !player.ended && player.readyState >= 2,
      demo: mode === "demo", entryCue, wheels, crossfade };
  }
  function stop(next = "ready") {
    finishCapture();
    levelsEventIndex = 0;
    replayLevelsEntry = undefined;
    pending.clear();
    audio?.stop();
    entryStarted = resumeSecond = resumePreview = false;
    rightArmed = false;
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
      if (deck === master && audio.players[master].currentTime === 0) capture = undefined;
      stop();
      onError("Audio could not start. " + error.message);
    }).finally(() => { if (pending.get(deck) === token) pending.delete(deck); });
  }
  function pause(deck) {
    pending.delete(deck);
    audio.pause(deck);
  }
  function start(demo, recording = false) {
    if (mode === "finished") source.reset();
    try {
      levelsEntry = chart.entry + (selection === "mix1" ? getLevelsDelayMs() / 1000 : 0);
      rightCueTime = levelsEntry + RIGHT_CUE_DELAY_SECONDS;
      audio = getAudio();
      const values = demo ? initialValues : { ...initialValues, ...liveValues() };
      crossfade = values["mixer.crossfade"] ?? crossfade;
      mirrorKnobs(values);
      state(demo ? "demo" : "live");
      audio.update(values);
      play(master, 0);
      if (recording) {
        capture = { events: [], levelsEvents: [], playButtonEvents: [] };
        captureMixer(values);
      }
      return true;
    } catch (error) {
      stop();
      onError("Audio could not start. " + error.message);
      return false;
    }
  }
  function demoCueTime() {
    if (mode !== "demo" || !recordedLevels) return rightCueTime;
    return recordedLevels.length ? recordedLevels[0].t / 1000 : Infinity;
  }

  function replayRecordedLevels(time) {
    while (recordedLevels[levelsEventIndex]?.t <= time * 1000) {
      const event = recordedLevels[levelsEventIndex++];
      replayLevelsEntry = event.position === null ? undefined : event.t / 1000 - event.position;
    }
    const second = audio.players.b;
    if (replayLevelsEntry === undefined) {
      if (!second.paused || pending.has("b")) pause("b");
      return;
    }
    const position = time - replayLevelsEntry;
    if (second.paused && !second.ended) play("b", position);
    else if (!second.seeking && Math.abs(second.currentTime - position) > 0.12) second.currentTime = position;
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
  function setDeckPlayback(deck, playing) {
    if (selection === "mix1" && deck === "b" && mode === "live") {
      if (!playing) { rightArmed = false; pause("b"); return; }
      const time = audio.players.a.currentTime;
      if (audio.players.a.paused || time < rightCueTime - 3) return;
      rightArmed = true;
      if (time >= rightCueTime && audio.players.b.paused) play("b", time - levelsEntry);
      return;
    }
    if (!playing) {
      pause(deck);
      if (deck === master && selection === "mix1") {
        if (mode === "demo") resumePreview = entryStarted;
        else resumeSecond ||= !audio.players.b.paused || pending.has("b");
        pause("b");
      }
    } else if (deck === master || !audio.players[master].paused) {
      if (audio.players[deck].paused) play(deck);
      if (deck === master && resumeSecond) { resumeSecond = false; play("b"); }
    }
  }
  const source = createMixSource(chart, bpm, transport, frame => {
    const { time, demo, playing } = frame;
    frame.audio = playing ? audio.audioFrame() : silence;
    if (mode !== "live" && mode !== "demo") return;
    if ((!capture && time >= chart.duration) || audio.players[master].ended) { stop("finished"); return; }
    if (!demo) {
      if (selection === "mix1" && rightArmed && playing && time >= rightCueTime) {
        const second = audio.players.b, elapsed = time - levelsEntry;
        if (second.paused && !second.ended) play("b", elapsed);
        else if (!second.paused && !second.seeking && Math.abs(second.currentTime - elapsed) > 0.12) {
          second.currentTime = elapsed;
        }
      }
      if (capture && playing) {
        const events = capture.levelsEvents;
        const wasPlaying = events.length > 0 && events.at(-1).position !== null;
        const second = audio.players.b;
        const isPlaying = !second.paused && !second.ended;
        if (wasPlaying !== isPlaying) events.push({ t: time * 1000, position: isPlaying ? second.currentTime : null });
      }
      return;
    }
    if (!playing) {
      if (!audio.players.b.paused) { pause("b"); resumePreview = entryStarted; }
      return;
    }
    const values = chart.valuesAt(time);
    if (values !== lastValues) {
      crossfade = values["mixer.crossfade"] ?? crossfade;
      audio.update(values);
      mirrorKnobs(values);
    }
    if (selection === "mix1" && recordedLevels) {
      replayRecordedLevels(time);
    } else if (selection === "mix1" && time >= rightCueTime) {
      const elapsed = time - levelsEntry, second = audio.players.b;
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
    startRecording() {
      if (selection !== "mix1" || mode === "live" || mode === "demo") return false;
      return start(false, true);
    },
    attach(view) { screen = view; },
    preview() { if (mode === "demo" || mode === "live") stop(); else start(true); },
    togglePlayback() {
      if (mode === "ready" || mode === "finished") {
        start(false);
        capturePlayButton(master, "screen", true);
      } else {
        const playing = audio.players[master].paused && !pending.has(master);
        capturePlayButton(master, "screen", playing);
        setDeckPlayback(master, playing);
      }
    },
    input(deck, playing, buttonSource) {
      if (mode === "demo" || (selection !== "mix1" && deck !== master)) return;
      if (mode !== "live") {
        if (deck === master && playing) {
          start(false);
          capturePlayButton(deck, buttonSource, playing);
        }
        return;
      }
      capturePlayButton(deck, buttonSource, playing);
      setDeckPlayback(deck, playing);
    },
    update(values) {
      if (mode === "live") {
        const next = { ...initialValues, ...values };
        crossfade = next["mixer.crossfade"] ?? crossfade;
        audio.update(next);
        captureMixer(next);
      }
    },
    get demo() { return mode === "demo"; },
    destroy() { capture = undefined; stop(); source.destroy(); }
  };
}
