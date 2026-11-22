import { createMixSource, ROW_BY_CONTROL } from "./mixChart.js";

const silence = { bands: Array(16).fill(0), kick: 0, bass: 0, hats: 0, energy: 0 };
const LEVELS_START_DELAY_SECONDS = 0.75;
const JOG_LEAD_SECONDS = 3;
const JOG_HOLD_SECONDS = 1.2;
const JOG_PERFECT_SECONDS = 0.12;
const JOG_GOOD_SECONDS = 0.30;
const JOG_PERFECT_BONUS = 300;
const JOG_GOOD_BONUS = 100;
const REWIND_SECONDS = 5;
const DECK_SYNC_TOLERANCE_SECONDS = 0.035;
const PRESET_FADERS = ["mixer.crossfade", "a.volume", "b.volume"];

export function createMixSession(chart, selection, bpm, {
  getAudio, liveValues, onState, onError, getLevelsDelayMs = () => 0,
  recordedLevels = null, recordedPlayButtons = [], onRecording = () => {},
}) {
  const master = selection === "levels" ? "b" : "a";
  let rightCueTime = chart.entry + LEVELS_START_DELAY_SECONDS;
  const initialValues = chart.valuesAt(0);
  let audio, screen, mode = "ready", lastValues;
  let liveMixerValues, presetFaders;
  let crossfade = initialValues["mixer.crossfade"] ?? 8191;
  let resumeSecond = false;
  let capture, levelsEventIndex = 0, replayLevelsEntry;
  let guided = false;
  let armedFor = null;
  let tailOffset = null;
  const leftStarts = [0, ...recordedPlayButtons
    .filter(event => event.deck === "a" && event.requestedPlaying && Number.isFinite(event.t) && event.t > 0)
    .map(event => event.t / 1000)];
  const rightStarts = (recordedLevels ?? []).filter((event, index) =>
    event.position !== null && recordedLevels[index - 1]?.position == null).map(event => event.t / 1000);
  let acknowledgedLeft = null;
  const rightBonuses = new Map();
  const pending = new Map();

  function mixTime() {
    return tailOffset === null ? audio.players[master].currentTime : tailOffset + audio.players.b.currentTime;
  }

  function captureMixer(values) {
    if (!capture) return;
    const t = mixTime() * 1000;
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
    const durationMs = Math.max(mixTime() * 1000, recording.events.at(-1)?.t ?? 0, recording.levelsEvents.at(-1)?.t ?? 0);
    onRecording({ ...recording, durationMs: Math.max(1, durationMs) });
  }

  function captureRightTransport(position) {
    if (!capture) return;
    const events = capture.levelsEvents;
    if ((events.at(-1)?.position ?? null) === position) return;
    events.push({ t: mixTime() * 1000, position });
  }

  function capturePlayButton(deck, source, requestedPlaying) {
    if (!capture || !source) return;
    capture.playButtonEvents.push({
      t: mixTime() * 1000,
      deck,
      source,
      requestedPlaying,
    });
  }

  function state(next) {
    mode = next;
    onState(next);
  }

  function jogCuesAt(time, replaying) {
    const decks = replaying ? [["a", leftStarts], ["b", rightStarts]] : [["b", [rightCueTime]]];
    return decks.flatMap(([deck, starts]) => {
      const next = starts.findIndex(start => start >= time);
      const previous = starts[next < 0 ? starts.length - 1 : next - 1];
      const upcoming = starts[next];
      const showPrevious = time - previous < JOG_HOLD_SECONDS && !(upcoming - time <= time - previous);
      const at = showPrevious ? previous : upcoming;
      if (at - time > JOG_LEAD_SECONDS) return [];
      const bonus = deck === "b" ? rightBonuses.get(rightCueKey(at)) ?? 0 : 0;
      if (at === undefined || (deck === "b" && !bonus && at - time < -JOG_GOOD_SECONDS)) return [];
      return [{ deck, at, remaining: at - time, matched: deck === "a" && acknowledgedLeft === at, bonus }];
    });
  }

  function rightCueKey(at) {
    return guided && recordedLevels ? at : "preset";
  }

  function awardRightBonus(at, points) {
    const key = rightCueKey(at);
    if (rightBonuses.has(key)) return;
    rightBonuses.set(key, points);
    source.addJogBonus(points);
  }

  function transport() {
    const active = mode === "live" || mode === "demo";
    const first = audio?.players[master];
    const second = audio?.players.b;
    if (active && tailOffset === null && master === "a" && first.ended && !second.paused && !second.ended) {
      if (capture) tailOffset = first.currentTime - second.currentTime;
      else if (guided || mode === "demo") tailOffset = replayLevelsEntry ?? null;
    }
    const player = tailOffset === null ? first : second;
    const time = mode === "finished" ? chart.duration : active ? mixTime() : 0;
    const wheels = audio ? {
      a: { time: audio.players.a.currentTime, playing: !audio.players.a.paused && !audio.players.a.ended },
      b: { time: audio.players.b.currentTime, playing: !audio.players.b.paused && !audio.players.b.ended },
    } : { a: { time: 0, playing: false }, b: { time: 0, playing: false } };
    const replaying = (mode === "demo" || guided) && recordedLevels !== null;
    const remaining = rightCueTime - time;
    const entryCue = mode === "demo" && !replaying && selection === "mix1" && remaining <= 3 && remaining > -1.2
      ? remaining > 0 ? String(Math.ceil(remaining)) : "DECK B IN" : null;
    const showJogBonus = mode === "live" && selection === "mix1" && !capture;
    const playing = active && !!player && !player.paused && !player.ended && !player.seeking && player.readyState >= 2;
    return { time, playing,
      demo: mode === "demo", guided: guided || armedFor === "practice", entryCue, wheels, crossfade,
      jogCues: armedFor === "practice" ? jogCuesAt(0, true).filter(cue => cue.deck === master)
        : active && (replaying || showJogBonus) ? jogCuesAt(time, replaying) : [],
      mixerGuide: ((mode === "demo" || guided) && recordedLevels)
        ? { target: chart.valuesAt(time), live: guided ? liveValues() : null } : null };
  }
  function stop(next = "ready") {
    finishCapture();
    guided = false;
    armedFor = null;
    acknowledgedLeft = null;
    rightBonuses.clear();
    tailOffset = null;
    levelsEventIndex = 0;
    replayLevelsEntry = undefined;
    pending.clear();
    audio?.stop();
    resumeSecond = false;
    lastValues = undefined;
    liveMixerValues = presetFaders = undefined;
    if (next === "ready") source.reset();
    state(next);
  }
  function play(deck, position) {
    if (pending.has(deck)) return;
    const token = Symbol();
    pending.set(deck, token);
    if (position !== undefined) audio.players[deck].currentTime = position;
    audio.setPlaying(deck, true).then(() => {
      if (pending.get(deck) === token && deck === "b" && !audio.players.b.paused) {
        captureRightTransport(audio.players.b.currentTime);
        if (usesPresetEntry() && !audio.players.a.paused) {
          alignDeckB(audio.players.a.currentTime - rightCueTime);
        }
      }
    }).catch(error => {
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

  function refreshLevelsTiming() {
    rightCueTime = chart.entry + LEVELS_START_DELAY_SECONDS + getLevelsDelayMs() / 1000;
  }

  function canCalibrate() {
    return !recordedLevels && usesPresetEntry();
  }

  function usesPresetEntry() {
    return selection === "mix1" && !capture && !guided
      && (mode === "live" || (mode === "demo" && !recordedLevels));
  }

  function alignDeckB(position) {
    const second = audio.players.b;
    if (!second.seeking && position >= 0 && Math.abs(second.currentTime - position) > DECK_SYNC_TOLERANCE_SECONDS) {
      second.currentTime = position;
    }
  }

  function applyPresetBlend(time, force = false) {
    const reference = chart.valuesAt(time);
    if (!force && PRESET_FADERS.every(key => reference[key] === presetFaders?.[key])) return;
    presetFaders = reference;
    const values = { ...liveMixerValues };
    for (const key of PRESET_FADERS) values[key] = reference[key];
    crossfade = values["mixer.crossfade"] ?? crossfade;
    audio.update(values);
  }

  function syncPresetLevels(time, force = false) {
    const second = audio.players.b;
    if (time < rightCueTime) {
      if (force) {
        pause("b");
        second.currentTime = 0;
      }
      return;
    }
    const position = time - rightCueTime;
    if (force) {
      second.currentTime = position;
      if (audio.players.a.paused) return;
    }
    if (second.paused && (!second.ended || force)) {
      play("b", position);
    } else if (!second.paused) alignDeckB(position);
  }

  function start(demo, recording = false) {
    if (mode === "finished" || mode === "armed") source.reset();
    try {
      if (selection === "mix1") refreshLevelsTiming();
      audio = getAudio();
      const values = demo || guided ? initialValues : { ...initialValues, ...liveValues() };
      crossfade = values["mixer.crossfade"] ?? crossfade;
      mirrorKnobs(guided ? { ...values, ...liveValues() } : values);
      if (guided) lastValues = values;
      state(demo ? "demo" : "live");
      liveMixerValues = values;
      if (!demo && !recording && usesPresetEntry()) applyPresetBlend(0, true);
      else audio.update(values);
      play(master, 0);
      if (recording) {
        capture = { events: [], levelsEvents: [], playButtonEvents: [], midiEvents: [] };
        captureMixer(values);
      }
      return true;
    } catch (error) {
      stop();
      onError("Audio could not start. " + error.message);
      return false;
    }
  }
  function beginArmed(source) {
    const recording = armedFor === "record";
    guided = armedFor === "practice";
    armedFor = null;
    if (guided && source === "jog") acknowledgedLeft = 0;
    if (start(false, recording)) capturePlayButton(master, source, true);
  }

  function replayRecordedLevels(time) {
    const previousIndex = levelsEventIndex;
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
    if (second.paused && (!second.ended || levelsEventIndex !== previousIndex)) play("b", position);
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
    if (tailOffset !== null) {
      if (playing) play("b");
      else pause("b");
      return;
    }
    if (guided && deck !== master) return;
    if (capture && deck === "b") {
      if (!playing) {
        pause(deck);
        captureRightTransport(null);
      } else if (!audio.players.a.paused && (audio.players.b.paused || audio.players.b.ended)) {
        const second = audio.players.b;
        play(deck, second.ended ? 0 : undefined);
      }
      return;
    }
    if (!playing) {
      pause(deck);
      if (deck === master && selection === "mix1") {
        if (capture) resumeSecond ||= !audio.players.b.paused || pending.has("b");
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
    const clockDeck = tailOffset === null ? master : "b";
    if ((!capture && time >= chart.duration) || audio.players[clockDeck].ended) { stop("finished"); return; }
    if (playing && usesPresetEntry()) syncPresetLevels(time);
    if (!demo && !guided) {
      if (usesPresetEntry()) applyPresetBlend(time);
      if (capture && playing && tailOffset === null) {
        const events = capture.levelsEvents;
        const wasPlaying = events.length > 0 && events.at(-1).position !== null;
        const second = audio.players.b;
        const isPlaying = !second.paused && !second.ended;
        if (wasPlaying !== isPlaying) captureRightTransport(isPlaying ? second.currentTime : null);
      }
      return;
    }
    if (!playing) {
      if (!audio.players.b.paused) pause("b");
      return;
    }
    const values = chart.valuesAt(time);
    if (values !== lastValues) {
      crossfade = values["mixer.crossfade"] ?? crossfade;
      audio.update(values);
      if (demo) mirrorKnobs(values);
      else lastValues = values;
    }
    if (tailOffset !== null) return;
    if (selection === "mix1" && recordedLevels) {
      replayRecordedLevels(time);
    } else if (selection === "mix1" && guided) syncPresetLevels(time);
  });
  return {
    source, stop,
    updateLevelsOffset() {
      if (!canCalibrate()) return;
      refreshLevelsTiming();
      syncPresetLevels(mixTime(), true);
    },
    rewind() {
      if (!canCalibrate()) return;
      const time = Math.max(0, mixTime() - REWIND_SECONDS);
      audio.players.a.currentTime = time;
      source.reset(time);
      rightBonuses.clear();
      syncPresetLevels(time, true);
    },
    startRecording() {
      if (selection !== "mix1" || !["ready", "finished"].includes(mode)) return false;
      armedFor = "record";
      state("armed");
      return true;
    },
    practice() {
      if (!["ready", "finished"].includes(mode)) return;
      armedFor = "practice";
      state("armed");
    },
    attach(view) { screen = view; },
    preview() { if (mode === "demo" || mode === "live" || mode === "armed") stop(); else start(true); },
    togglePlayback() {
      if (armedFor) beginArmed("screen");
      else if (mode === "ready" || mode === "finished") {
        start(false);
        capturePlayButton(master, "screen", true);
      } else {
        const deck = tailOffset === null ? master : "b";
        const playing = audio.players[deck].paused && !pending.has(deck);
        capturePlayButton(master, "screen", playing);
        setDeckPlayback(master, playing);
      }
    },
    input(deck, playing, buttonSource) {
      if (mode === "demo" || (selection !== "mix1" && deck !== master)) return;
      if (armedFor) {
        if (deck === master && (armedFor === "record" ? buttonSource === "midi" : buttonSource === "jog")) {
          beginArmed(buttonSource);
        }
        return;
      }
      if (mode === "live" && !capture && selection === "mix1" && (deck === "b" || guided)) {
        if (buttonSource !== "jog") return;
        const frame = transport();
        if (!frame.playing) return;
        const cue = frame.jogCues.find(item => item.deck === deck);
        if (!cue) return;
        const error = Math.abs(cue.remaining);
        if (deck === "b" && error <= JOG_GOOD_SECONDS) {
          awardRightBonus(cue.at, error <= JOG_PERFECT_SECONDS ? JOG_PERFECT_BONUS : JOG_GOOD_BONUS);
        } else if (deck === "a" && error <= 0.65) {
          acknowledgedLeft = cue.at;
        }
        return;
      }
      if (mode !== "live") {
        if (deck === master && playing) {
          start(false);
          capturePlayButton(deck, buttonSource, playing);
        }
        return;
      }
      if (capture && buttonSource === "midi") playing = audio.players[deck].paused && !pending.has(deck);
      capturePlayButton(deck, buttonSource, playing);
      setDeckPlayback(deck, playing);
    },
    recordMidi(bytes) {
      if (capture) capture.midiEvents.push([mixTime() * 1000, ...bytes]);
    },
    update(values) {
      if (mode === "live" && !guided) {
        const next = { ...initialValues, ...values };
        liveMixerValues = next;
        if (usesPresetEntry()) applyPresetBlend(mixTime(), true);
        else {
          crossfade = next["mixer.crossfade"] ?? crossfade;
          audio.update(next);
        }
        captureMixer(next);
      }
    },
    get demo() { return mode === "demo"; },
    destroy() { capture = undefined; stop(); source.destroy(); }
  };
}
