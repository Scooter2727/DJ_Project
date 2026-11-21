import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { decodeMidi } from "./midi.js";
import { MixAudioEngine } from "./audio.js";
import { buildMixChart, ROW_BY_CONTROL } from "./mixChart.js";
import { createMixSession } from "./mixSession.js";
import { DEFAULT_DANCE_CONFIG } from "./crowd/danceScorer.js";
import { createMainstageHype, STARTING_HYPE } from "./crowd/mainstageHype.js";
import { usePoseTracker } from "./crowd/usePoseTracker.js";
import "./mainstage.css";

const ROWS = Object.values(ROW_BY_CONTROL);
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
  const [message, setMessage] = useState("");
  const [selectedTrack, setSelectedTrack] = useState(TRACKS[0]);
  const [cameraOn, setCameraOn] = useState(false);
  const [mix, setMix] = useState(null);
  const [transport, setTransport] = useState("ready");
  const gameMix = mode === "game" ? mix : null;

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

  const readPlayback = useCallback(() => {
    const playback = audioRef.current?.playbackPosition();
    if (!playback) return null;
    const deck = playback.deck === "a" ? gameMix?.manifest.deckA : gameMix?.manifest.deckB;
    return { ...playback, tempo: deck?.tempo, beatOffsetMs: (deck?.beatOffsetSeconds ?? 0) * 1000 };
  }, [gameMix]);

  const onPoseFrame = useCallback(frame => {
    if (modeRef.current === "game") hypeRef.current.awardFlick(readPlayback(), frame, performance.now());
  }, [readPlayback]);

  const camera = usePoseTracker({ videoRef: cameraVideoRef, config: DEFAULT_DANCE_CONFIG, maxFps: 24, onFrame: onPoseFrame });
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
    const chart = buildMixChart(mix.recording, mix.manifest, selectedTrack.id);
    const session = createMixSession(chart, selectedTrack.id, selectedTrack.bpm, {
      getAudio, liveValues: () => valuesRef.current, onState: setTransport, onError: setMessage,
    });
    const screen = api.createScreen(mountRef.current, {
      rows: ROWS,
      source: session.source,
      knobSmoothing: 0,
      show: { venue: true, crowd: true, deck: true, hud: true, webcam: true },
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
  }, [mode, selectedTrack, gameMix, previewDeck, readPlayback]);

  useEffect(() => {
    screenRef.current?.setWebcam(cameraOn ? cameraVideoRef.current : null);
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
    if (!port) return undefined;
    let active = true;

    const receive = event => {
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
        if (jog || key in changes) sessionRef.current.input(deck, next[key]);
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
    try {
      if (!navigator.requestMIDIAccess) throw new Error("Use desktop Chrome or Edge on localhost for Web MIDI.");
      await getAudio().resume();
      const nextAccess = await navigator.requestMIDIAccess();
      setAccess(nextAccess);
      setMessage("");
    } catch (error) {
      setMessage(error.message || "MIDI access was not granted.");
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

  return <main className="mainstage-shell">
    <video className="mainstage-camera-source" ref={cameraVideoRef} muted playsInline aria-hidden="true" />
    {mode === "game" && <div className="mainstage-hype-accessible" ref={hypeMeterRef} role="meter" aria-label="Crowd hype" aria-valuemin={0} aria-valuemax={100} aria-valuenow={STARTING_HYPE} />}
    <div className="mainstage-stage" ref={mountRef} />
    <div className="mainstage-controls" aria-label="MAINSTAGE controls">
      <button className="mainstage-button" onClick={mode === "title" ? () => setMode("select") : openMainMenu}>
        {mode === "title" ? "Start" : "Main menu"}
      </button>
      {mode === "game" && <button className="mainstage-button" onClick={() => setMode("select")}>Tracks</button>}
      {mode === "game" && <button className="mainstage-button" disabled={!mix} onClick={() => sessionRef.current?.preview()}>
        {transport === "demo" || transport === "live" ? "Stop mix" : "Preview mix"}
      </button>}
      {mode === "game" && <button className="mainstage-button" disabled={!mix} onClick={() => sessionRef.current?.togglePlayback()}>
        {previewPlaying ? "Pause track" : "Play track"}
      </button>}
      <button className="mainstage-button" disabled={!mix} onClick={access ? disconnect : connect}>{access ? "Disconnect DDJ" : "Connect DDJ-FLX4"}</button>
      {mode === "game" && <button className="mainstage-button" onClick={toggleCamera}>{cameraFailed ? "Retry camera" : cameraOn ? "Hide camera" : "Use camera"}</button>}
      {ports.length > 1 && <select className="mainstage-select" value={selectedPort} onChange={event => setSelectedPort(event.target.value)} aria-label="MIDI input">
        {ports.map(input => <option key={input.id} value={input.id}>{input.name || "MIDI input"}</option>)}
      </select>}
      <span className={connected ? "mainstage-status online" : "mainstage-status"}>{(cameraOn && camera.status === "error" && camera.message) || message || (mode === "game" && transport === "finished" ? "Mix complete" :
        mode === "game" && transport === "ready" && connected ? (selectedTrack.id === "levels" ? "Spin right clockwise to start Levels" : "Spin left counterclockwise to start Heroes") :
        connected ? "DDJ connected" : selectedTrack.name)}</span>
    </div>
  </main>;
}

createRoot(document.getElementById("root")).render(<MainstageApp />);
