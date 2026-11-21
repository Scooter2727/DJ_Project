import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { decodeMidi } from "./midi.js";
import { MixAudioEngine } from "./audio.js";
import { buildMixChart, ROW_BY_CONTROL } from "./mixChart.js";
import { createMixSession } from "./mixSession.js";
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
  const audioRef = useRef(null);
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

  const F = () => window.FLXHero;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
      knobSmoothing: 0.035,
      show: { venue: true, crowd: true, deck: true, hud: true, webcam: true },
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
  }, [mode, mode === "game" ? mix : null, selectedTrack]);

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

  async function toggleCamera() {
    if (!screenRef.current) return;
    if (cameraOn) {
      screenRef.current.setWebcam(null);
      setCameraOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      screenRef.current.setWebcam(stream);
      setCameraOn(true);
    } catch (error) {
      setMessage("Camera unavailable: " + error.message);
    }
  }

  return <main className="mainstage-shell">
    <div className="mainstage-stage" ref={mountRef} />
    <div className="mainstage-controls" aria-label="MAINSTAGE controls">
      <button className="mainstage-button" onClick={mode === "title" ? () => setMode("select") : () => setMode("title")}>
        {mode === "title" ? "Start" : "Main menu"}
      </button>
      {mode === "game" && <button className="mainstage-button" onClick={() => setMode("select")}>Tracks</button>}
      {mode === "game" && <button className="mainstage-button" disabled={!mix} onClick={() => sessionRef.current?.preview()}>
        {transport === "demo" || transport === "live" ? "Stop mix" : "Preview mix"}
      </button>}
      <button className="mainstage-button" disabled={!mix} onClick={access ? disconnect : connect}>{access ? "Disconnect DDJ" : "Connect DDJ-FLX4"}</button>
      {mode === "game" && <button className="mainstage-button" onClick={toggleCamera}>{cameraOn ? "Hide camera" : "Use camera"}</button>}
      {ports.length > 1 && <select className="mainstage-select" value={selectedPort} onChange={event => setSelectedPort(event.target.value)} aria-label="MIDI input">
        {ports.map(input => <option key={input.id} value={input.id}>{input.name || "MIDI input"}</option>)}
      </select>}
      <span className={connected ? "mainstage-status online" : "mainstage-status"}>{message || (mode === "game" && transport === "finished" ? "Mix complete" :
        mode === "game" && transport === "ready" && connected ? (selectedTrack.id === "levels" ? "Spin right clockwise to start Levels" : "Spin left counterclockwise to start Heroes") :
        connected ? "DDJ connected" : selectedTrack.name)}</span>
    </div>
  </main>;
}

createRoot(document.getElementById("root")).render(<MainstageApp />);
