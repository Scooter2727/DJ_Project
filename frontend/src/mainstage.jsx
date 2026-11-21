import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { decodeMidi } from "./midi.js";
import { MixAudioEngine } from "./audio.js";
import { buildMixChart, ROW_BY_CONTROL } from "./mixChart.js";
import { createMixSession } from "./mixSession.js";
import { DEFAULT_DANCE_CONFIG } from "./crowd/danceScorer.js";
import { createMainstageHype, STARTING_HYPE } from "./crowd/mainstageHype.js";
import { createWebcamFilters } from "./crowd/webcamFilters.js";
import { usePoseTracker } from "./crowd/usePoseTracker.js";
import "./mainstage.css";

const ROWS = Object.values(ROW_BY_CONTROL);
const SAVED_MIXES_KEY = "mainstage-saved-mixes";

function readSavedMixes() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_MIXES_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}
async function loadJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Could not load " + url);
  return response.json();
}
const TRACKS = [
  { id: "mix1", name: "HEROES / LEVELS", color: "#34e0ff", icon: "bolt", bpm: 126 },
  { id: "heroes", name: "HEROES", color: "#ffb330", icon: "mic", bpm: 126 },
  { id: "levels", name: "LEVELS", color: "#ff3d9a", icon: "star", bpm: 126 },
];

function MainstageApp() {
  const mountRef = useRef(null);
  const pageRef = useRef(null);
  const screenRef = useRef(null);
  const sessionRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const webcamFiltersRef = useRef(null);
  const hypeRef = useRef(null);
  const hypeMeterRef = useRef(null);
  const audioRef = useRef(null);
  const playbackButtonState = useRef(false);
  const valuesRef = useRef({});
  const modeRef = useRef("title");
  const [mode, setMode] = useState("title");
  const [access, setAccess] = useState(null);
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [receivingMidi, setReceivingMidi] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedTrack, setSelectedTrack] = useState(TRACKS[0]);
  const [cameraOn, setCameraOn] = useState(false);
  const [mix, setMix] = useState(null);
  const [transport, setTransport] = useState("ready");
  const [levelsDelayMs, setLevelsDelayMs] = useState(-150);
  const levelsDelayRef = useRef(levelsDelayMs);
  const [savedMixes, setSavedMixes] = useState(readSavedMixes);
  const [chosenMix, setChosenMix] = useState("");
  const [loadedMix, setLoadedMix] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [draftMix, setDraftMix] = useState(null);
  const [mixName, setMixName] = useState("");
  const saveDialogRef = useRef(null);
  const gameMix = mode === "game" ? mix : null;

  useEffect(() => {
    if (draftMix) saveDialogRef.current?.showModal();
  }, [draftMix]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const manifest = await loadJson("/mixes/mix1/tracks.json", controller.signal);
      const recording = await loadJson(manifest.recording, controller.signal);
      setMix({ manifest, recording });
    }
    load().catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);

  function getAudio() {
    if (!audioRef.current) {
      audioRef.current = new MixAudioEngine({ deckA: mix.manifest.deckA.file, deckB: mix.manifest.deckB.file });
    }
    return audioRef.current;
  }
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewDeck = selectedTrack.id === "levels" ? "b" : "a";
  if (hypeRef.current === null) hypeRef.current = createMainstageHype();
  if (webcamFiltersRef.current === null) webcamFiltersRef.current = createWebcamFilters();

  const readPlayback = useCallback(() => {
    const playback = audioRef.current?.playbackPosition();
    if (!playback) return null;
    const deck = playback.deck === "a" ? gameMix?.manifest.deckA : gameMix?.manifest.deckB;
    return { ...playback, tempo: deck?.tempo, beatOffsetMs: (deck?.beatOffsetSeconds ?? 0) * 1000 };
  }, [gameMix]);

  const onPoseFrame = useCallback(frame => {
    if (modeRef.current === "game") hypeRef.current.awardFlick(readPlayback(), frame, performance.now());
    webcamFiltersRef.current.updatePose(frame.landmarks, frame.timestamp);
  }, [readPlayback]);

  const camera = usePoseTracker({
    videoRef: cameraVideoRef, config: DEFAULT_DANCE_CONFIG, maxFps: 24,
    onFrame: onPoseFrame, onMask: webcamFiltersRef.current.updateMask,
  });
  const { start: startCamera, stop: stopCamera } = camera;
  const cameraFailed = cameraOn && camera.status === "error" && !camera.cameraActive;

  const F = () => window.FLXHero;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!cameraOn) return undefined;
    startCamera();
    return () => stopCamera();
  }, [cameraOn, startCamera, stopCamera]);

  useEffect(() => {
    const api = F();
    if (!api || !mountRef.current) return undefined;
    pageRef.current = null;
    screenRef.current = null;
    mountRef.current.innerHTML = "";

    if (mode === "title") {
      const stage = api.createStage(mountRef.current);
      const backdrop = new api.TitleBackdrop();
      let clock = 0;
      const startSelect = () => setMode("select");
      stage.el.addEventListener("click", startSelect);
      const onKey = event => {
        event.preventDefault();
        startSelect();
      };
      window.addEventListener("keydown", onKey, { once: true });
      stage.run((dt, absolute) => {
        clock += dt;
        const beat = backdrop.draw(stage, dt, absolute, 126, 0.5);
        api.Title.draw(stage.sharp, 800, 300, {
          text: "MAINSTAGE",
          sub: "",
          size: 110,
          px: 5,
          maxWidth: 1240,
          beat,
          t: clock,
        });
        const ctx = stage.sharp;
        ctx.font = "16px " + api.FONT;
        ctx.textAlign = "center";
        ctx.fillStyle = Math.floor(clock * 1.5) % 2 ? "#f6ecd6" : "rgba(246,236,214,.35)";
        ctx.fillText("TURN ANY KNOB TO START", 800, 800);
      });
      pageRef.current = {
        destroy() {
          stage.stop();
          stage.el.removeEventListener("click", startSelect);
          window.removeEventListener("keydown", onKey);
          stage.el.remove();
        },
      };
      return () => pageRef.current?.destroy();
    }

    if (mode === "select") {
      pageRef.current = api.TrackSelect.create(mountRef.current, {
        tracks: TRACKS,
        index: 0,
        keyboard: true,
        onConfirm: track => {
          if (track.id !== selectedTrack.id) {
            audioRef.current?.stop();
            hypeRef.current = createMainstageHype();
          }
          setSelectedTrack(track);
          setMode("game");
        },
      });
      return () => pageRef.current?.destroy();
    }

    if (!mix) return;
    const customMix = selectedTrack.id === "mix1" ? loadedMix : null;
    const chart = buildMixChart(customMix ?? mix.recording,
      customMix ? { ...mix.manifest, cueOffsetMs: 0 } : mix.manifest, selectedTrack.id);
    const session = createMixSession(chart, selectedTrack.id, selectedTrack.bpm, {
      getAudio, liveValues: () => valuesRef.current,
      onState: next => {
        setTransport(next);
        if (next === "ready" || next === "finished") setIsRecording(false);
      },
      onError: setMessage,
      getLevelsDelayMs: () => levelsDelayRef.current,
      recordedLevels: customMix?.levelsEvents,
      onRecording: recording => {
        if (!recording) return;
        setDraftMix(recording);
        setMixName("Untitled mix");
      },
    });
    const screen = api.createScreen(mountRef.current, {
      rows: ROWS,
      source: session.source,
      knobSmoothing: 0,
      show: { venue: true, crowd: true, deck: true, hud: true, webcam: true },
      drawWebcamEffects: webcamFiltersRef.current.draw,
      getCrowdHype: dt => {
        const playing = audioRef.current?.isPlaying(previewDeck) ?? false;
        if (playing !== playbackButtonState.current) {
          playbackButtonState.current = playing;
          setPreviewPlaying(playing);
        }
        const frame = hypeRef.current.frame(readPlayback(), dt);
        const value = String(Math.floor(frame.level));
        const meter = hypeMeterRef.current;
        if (meter && meter.getAttribute("aria-valuenow") !== value) meter.setAttribute("aria-valuenow", value);
        return frame;
      },
    });
    screenRef.current = screen;
    session.attach(screen);
    sessionRef.current = session;
    pageRef.current = screen;
    return () => {
      sessionRef.current = null;
      session.destroy();
      screen.destroy();
    };
  }, [mode, selectedTrack, gameMix, previewDeck, readPlayback, loadedMix]);

  useEffect(() => {
    screenRef.current?.setWebcam(cameraOn ? cameraVideoRef.current : null);
    if (!cameraOn || mode !== "game") webcamFiltersRef.current.reset();
  }, [mode, gameMix, cameraOn]);

  useEffect(() => {
    if (!access) return undefined;
    const refresh = () => {
      const available = Array.from(access.inputs.values()).filter(input => input.state === "connected");
      setPorts(available);
      setSelectedPort(current => available.find(input => input.id === current)?.id
        ?? available.find(input => /flx4/i.test(input.name ?? ""))?.id
        ?? available[0]?.id ?? "");
    };
    refresh();
    access.addEventListener("statechange", refresh);
    return () => access.removeEventListener("statechange", refresh);
  }, [access]);

  const port = ports.find(candidate => candidate.id === selectedPort);

  useEffect(() => {
    valuesRef.current = {};
    setConnected(false);
    setReceivingMidi(false);
    if (!port) return undefined;
    let active = true;
    let received = false;

    const receive = event => {
      if (!received) {
        received = true;
        setReceivingMidi(true);
      }
      const bytes = Array.from(event.data);
      const previous = valuesRef.current;
      const changes = decodeMidi(bytes, previous);
      const next = { ...previous, ...changes };
      valuesRef.current = next;

      const leftJogDelta = changes["a.jog"] === undefined ? 0 : changes["a.jog"] - (previous["a.jog"] ?? 0);
      const rightJogDelta = changes["b.jog"] === undefined ? 0 : changes["b.jog"] - (previous["b.jog"] ?? 0);
      const leftJogTrigger = leftJogDelta < -0.05;
      const rightJogTrigger = rightJogDelta > 0.05;
      const leftDelta = leftJogDelta / 360;
      const rightDelta = rightJogDelta / 360;

      if (modeRef.current === "title") {
        const changedKnob = Object.keys(changes).some(key => ROW_BY_CONTROL[key.split(".")[1]]);
        if (changedKnob || leftJogDelta || rightJogDelta) setMode("select");
        return;
      } else if (modeRef.current === "select") {
        if (leftDelta) pageRef.current?.jog({ side: "left", delta: leftDelta });
        if (rightDelta) pageRef.current?.jog({ side: "right", delta: rightDelta });
        if ("a.play" in changes || "b.play" in changes) {
          delete next["a.play"];
          delete next["b.play"];
          pageRef.current?.confirm();
        }
        return;
      } else {
        if (!sessionRef.current || sessionRef.current.demo) return;
        const screen = screenRef.current;
        for (const [key, value] of Object.entries(changes)) {
          const [deck, control] = key.split(".");
          const row = ROW_BY_CONTROL[control];
          if (!screen || !row || deck === "mixer") continue;
          screen.knob({ channel: deck === "a" ? 1 : 2, row, position: Math.max(0, Math.min(1, value / 16383)) });
        }
      }

      for (const [deck, jog] of [["a", leftJogTrigger], ["b", rightJogTrigger]]) {
        const key = deck + ".play";
        if (jog) next[key] = true;
        if (jog || key in changes) {
          sessionRef.current.input(deck, next[key], key in changes ? "midi" : undefined);
        }
      }
      sessionRef.current.update(next);
    };

    port.addEventListener("midimessage", receive);
    port.open().then(() => { if (active) setConnected(true); }).catch(error => {
      if (active) setMessage("Could not open MIDI input: " + error.message);
    });
    return () => {
      active = false;
      port.removeEventListener("midimessage", receive);
      port.close().catch(() => {});
    };
  }, [port]);

  async function connect() {
    setConnecting(true);
    setMessage("");
    try {
      if (!navigator.requestMIDIAccess) throw new Error("Use desktop Chrome or Edge on localhost for Web MIDI.");
      // Start audio unlock from the click, but let MIDI connect independently.
      void Promise.resolve().then(() => getAudio().resume()).catch(() => {});
      const nextAccess = await navigator.requestMIDIAccess();
      setAccess(nextAccess);
    } catch (error) {
      setMessage(error.message || "MIDI access was not granted.");
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    sessionRef.current?.stop();
    audioRef.current?.stop();
    setAccess(null);
    setPorts([]);
    setSelectedPort("");
    setConnected(false);
  }

  function toggleCamera() {
    if (cameraFailed) startCamera();
    else setCameraOn(current => !current);
  }

  function openMainMenu() {
    setCameraOn(false);
    audioRef.current?.stop();
    hypeRef.current = createMainstageHype();
    setMode("title");
  }

  function saveMix(event) {
    event.preventDefault();
    if (!draftMix || !mixName.trim()) return;
    const recording = { ...draftMix, name: mixName.trim(), id: crypto.randomUUID() };
    const next = [recording, ...savedMixes];
    try {
      localStorage.setItem(SAVED_MIXES_KEY, JSON.stringify(next));
    } catch {
      setMessage("Could not save the mix in this browser.");
      return;
    }
    setMessage("");
    setSavedMixes(next);
    setChosenMix(recording.id);
    setLoadedMix(recording);
    setDraftMix(null);
  }

  const mixActive = transport === "live" || transport === "demo";
  const canRecord = mode === "game" && selectedTrack.id === "mix1" && !!mix;

  return <main className="mainstage-shell">
    <video className="mainstage-camera-source" ref={cameraVideoRef} muted playsInline aria-hidden="true" />
    {mode === "game" && <div className="mainstage-hype-accessible" ref={hypeMeterRef} role="meter" aria-label="Crowd hype" aria-valuemin={0} aria-valuemax={100} aria-valuenow={STARTING_HYPE} />}
    <div className="mainstage-stage" ref={mountRef} />
    <div className="mainstage-controls" aria-label="MAINSTAGE controls">
      <button className="mainstage-button" disabled={isRecording} onClick={mode === "title" ? () => setMode("select") : openMainMenu}>
        {mode === "title" ? "Start" : "Main menu"}
      </button>
      {mode === "game" && <button className="mainstage-button" disabled={isRecording} onClick={() => setMode("select")}>Tracks</button>}
      {mode === "game" && <button className="mainstage-button" disabled={!mix || isRecording || !!draftMix} onClick={() => sessionRef.current?.preview()}>
        {mixActive ? "Stop mix" : canRecord && loadedMix ? "Play saved mix" : "Preview mix"}
      </button>}
      {mode === "game" && <button className="mainstage-button" disabled={!mix} onClick={() => sessionRef.current?.togglePlayback()}>
        {previewPlaying ? "Pause track" : "Play track"}
      </button>}
      {mode === "game" && selectedTrack.id === "mix1" && <label className="mainstage-levels-delay">
        Levels intro offset
        <input type="range" min={-2000} max={2000} step={25} value={levelsDelayMs}
          disabled={transport === "live" || transport === "demo"}
          aria-valuetext={levelsDelayMs === 0 ? "Default timing" : `${Math.abs(levelsDelayMs)} milliseconds ${levelsDelayMs < 0 ? "earlier" : "later"}`}
          onChange={event => {
            const delay = event.currentTarget.valueAsNumber;
            levelsDelayRef.current = delay;
            setLevelsDelayMs(delay);
          }} />
        <span>{levelsDelayMs > 0 ? "+" : ""}{levelsDelayMs} ms</span>
      </label>}
      <button className="mainstage-button" disabled={!mix || connecting} onClick={access ? disconnect : connect}>{connecting ? "Requesting MIDI…" : access ? "Disconnect DDJ" : "Connect DDJ-FLX4"}</button>
      {mode === "game" && <button className="mainstage-button" onClick={toggleCamera}>{cameraFailed ? "Retry camera" : cameraOn ? "Hide camera" : "Use camera"}</button>}
      {ports.length > 1 && <select className="mainstage-select" value={selectedPort} onChange={event => setSelectedPort(event.target.value)} aria-label="MIDI input">
        {ports.map(input => <option key={input.id} value={input.id}>{input.name || "MIDI input"}</option>)}
      </select>}
      <span className={connected ? "mainstage-status online" : "mainstage-status"}>{message || (access && !port ? "No MIDI input found. Check the USB data cable." : access && !connected ? "Opening MIDI input…" : connected && !receivingMidi ? "MIDI input open. Move a knob to test." : null) || (cameraOn && camera.status === "error" && camera.message) || (mode === "game" && transport === "finished" ? "Mix complete" :
        mode === "game" && transport === "ready" && connected ? (selectedTrack.id === "levels" ? "Spin right clockwise to start Levels" : "Spin left counterclockwise to start Heroes") :
        connected ? "DDJ connected" : selectedTrack.name)}</span>
    </div>
    {canRecord && <div className="mainstage-controls mainstage-mix-controls" aria-label="Mix recordings">
      <button className="mainstage-button" disabled={(!isRecording && mixActive) || !!draftMix} onClick={() => {
        if (isRecording) sessionRef.current?.stop();
        else if (sessionRef.current?.startRecording()) {
          setMessage("");
          setIsRecording(true);
        }
      }}>{isRecording ? "Stop recording" : "Record mix"}</button>
      {isRecording && <span role="status">Recording mix</span>}
      {draftMix && <dialog ref={saveDialogRef} className="mainstage-save-dialog" aria-labelledby="save-mix-title"
        onCancel={event => event.preventDefault()}>
        <h2 id="save-mix-title">Name and save your mix</h2>
        <form className="mainstage-mix-controls" onSubmit={saveMix}>
          <input className="mainstage-select" aria-label="Mix name" maxLength={80} autoFocus
            value={mixName} onFocus={event => event.currentTarget.select()} onChange={event => setMixName(event.target.value)} />
          <button className="mainstage-button" disabled={!mixName.trim()}>Save mix</button>
          <button type="button" className="mainstage-button" onClick={() => setDraftMix(null)}>Discard</button>
        </form>
        {message && <p role="alert">{message}</p>}
      </dialog>}
      <select className="mainstage-select" aria-label="Saved mix" value={chosenMix}
        disabled={mixActive || isRecording || !!draftMix} onChange={event => setChosenMix(event.target.value)}>
        <option value="">Original mix</option>
        {savedMixes.map(recording => <option key={recording.id} value={recording.id}>{recording.name}</option>)}
      </select>
      <button className="mainstage-button" disabled={mixActive || isRecording || !!draftMix}
        onClick={() => setLoadedMix(savedMixes.find(recording => recording.id === chosenMix) ?? null)}>Load mix</button>
      <span role="status">Loaded: {loadedMix?.name ?? "Original mix"}</span>
    </div>}
  </main>;
}

createRoot(document.getElementById("root")).render(<MainstageApp />);
