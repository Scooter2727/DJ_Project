import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { decodeMidi } from "./midi.js";
import { scoreRecording, upcomingContinuousControls } from "./scoring.js";
import "./style.css";

const percent = value => value === undefined ? "—" : Math.round(value / 16383 * 100) + "%";
const pairs = [["trim", "Trim"], ["high", "High EQ"], ["mid", "Mid EQ"], ["low", "Low EQ"], ["cfx", "CFX"]];
const RECORDINGS_KEY = "deck-relay-recordings";

function savedRecordings() {
  try {
    const value = JSON.parse(localStorage.getItem(RECORDINGS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function Meter({ label, value, targetValue, vertical = false }) {
  const position = value === undefined ? 50 : value / 16383 * 100;
  const targetPosition = targetValue === undefined ? undefined : targetValue / 16383 * 100;
  return <div className={vertical ? "meter vertical" : "meter"}>
    <div className="meter-label"><span>{label}</span><output>{percent(value)}</output></div>
    <div className="rail">
      {targetPosition !== undefined && <span className="target-thumb" style={{ "--position": targetPosition + "%" }} />}
      <span className={value === undefined ? "thumb idle" : "thumb"} style={{ "--position": position + "%" }} />
    </div>
  </div>;
}

function Knob({ label, value, targetValue, highlighted = false }) {
  const rotation = value === undefined ? 0 : value / 16383 * 270 - 135;
  const targetRotation = targetValue === undefined ? 0 : targetValue / 16383 * 270 - 135;
  return <div className="knob-control">
    <div className={highlighted ? "knob highlighted" : "knob"}>
      {targetValue !== undefined && <span className="knob-target" style={{ "--target-angle": targetRotation + "deg" }} />}
      {highlighted && <span className="knob-cue-line" style={{ "--target-angle": targetRotation + "deg" }} />}
      <i style={{ transform: "rotate(" + rotation + "deg)" }} />
    </div>
    <span>{label}</span><output>{percent(value)}</output>
  </div>;
}

function Deck({ side, values, targetValues, cueControls = new Set() }) {
  const read = control => values[side + "." + control];
  const readTarget = control => targetValues?.[side + "." + control];
  const transport = [["cue", "CUE"], ["play", "▶ PLAY"]];
  return <section className={"deck " + side} aria-label="Deck controls">
    <div className="deck-heading">
      <div className="loop-buttons" aria-label="Loop controls">
        <span className={"loop-button " + (read("loopIn") ? "lit" : "") + (readTarget("loopIn") ? " target-active" : "")} aria-label="Loop in">IN</span>
        <span className={"loop-button " + (read("loopOut") ? "lit" : "") + (readTarget("loopOut") ? " target-active" : "")} aria-label="Loop out">OUT</span>
      </div>
      <span className={"sync-button " + (read("sync") ? "lit" : "") + (readTarget("sync") ? " target-active" : "")} aria-label="Sync">SYNC</span>
    </div>
    <div className="deck-body">
      <div className={cueControls.has(side + ".jog") ? "platter highlighted" : "platter"} style={{ "--angle": (read("jog") ?? 0) + "deg", "--target-angle": (readTarget("jog") ?? read("jog") ?? 0) + "deg" }}>
        <div className="disc"><div className="disc-label" /></div>
      </div>
    </div>
    <div className="transport">{transport.map(([control, label]) =>
      <span className={read(control) ? "lit" : ""} key={control}>{label}</span>
    )}</div>
  </section>;
}

function ScoreCard({ result }) {
  return <aside className="score-card" aria-live="polite">
    <div className="score-grade">{result.grade}</div>
    <div className="score-number">{result.score}<span>/100</span></div>
    <div className="score-breakdown">
      <span>Controls <strong>{result.continuousScore}%</strong></span>
      <span>Buttons <strong>{result.buttonScore}%</strong></span>
    </div>
  </aside>;
}

function App() {
  const [access, setAccess] = useState(null);
  const [ports, setPorts] = useState([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [frame, setFrame] = useState({ values: {} });
  const [recordings, setRecordings] = useState(savedRecordings);
  const [selectedRecordingId, setSelectedRecordingId] = useState("");
  const [loadedRecording, setLoadedRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [targetValues, setTargetValues] = useState({});
  const [cueControls, setCueControls] = useState(new Set());
  const [isChallenging, setIsChallenging] = useState(false);
  const [scoreResult, setScoreResult] = useState(null);
  const live = useRef(frame);
  const recordingRef = useRef(null);
  const playbackRef = useRef(null);
  const challengeRef = useRef(null);
  const targetPlaybackRef = useRef(null);

  useEffect(() => {
    if (!access) return;
    function refresh(event) {
      if (event?.port.type === "output") return;
      const available = Array.from(access.inputs.values()).filter(port => port.state === "connected");
      setPorts(available);
      setSelected(current => available.find(port => port.id === current)?.id
        ?? available.find(port => /flx4/i.test(port.name ?? ""))?.id ?? available[0]?.id ?? "");
    }
    refresh();
    access.addEventListener("statechange", refresh);
    return () => access.removeEventListener("statechange", refresh);
  }, [access]);

  const port = ports.find(candidate => candidate.id === selected);
  useEffect(() => {
    live.current = { values: {} };
    setFrame(live.current);
    setConnected(false);
    setMessage("");
    if (!port) return;
    let active = true;
    let redraw = null;
    function receive(event) {
      if (playbackRef.current) return;
      const bytes = Array.from(event.data);
      const { values } = live.current;
      const nextValues = { ...values, ...decodeMidi(bytes, values) };
      live.current = {
        values: nextValues,
      };
      if (recordingRef.current) {
        recordingRef.current.events.push({
          t: performance.now() - recordingRef.current.startedAt,
          values: nextValues,
          data: bytes,
        });
      }
      if (challengeRef.current) {
        challengeRef.current.events.push({
          t: performance.now() - challengeRef.current.startedAt,
          values: nextValues,
          data: bytes,
        });
      }
      if (redraw === null) redraw = requestAnimationFrame(() => {
        redraw = null;
        setFrame(live.current);
      });
    }
    port.addEventListener("midimessage", receive);
    port.open().then(() => {
      if (active) setConnected(true);
    }).catch(error => {
      if (active) setMessage("Could not open MIDI input. Close other DJ apps and reconnect. " + error.message);
    });
    return () => {
      active = false;
      port.removeEventListener("midimessage", receive);
      if (redraw !== null) cancelAnimationFrame(redraw);
      port.close().catch(() => {});
    };
  }, [port]);

  function stopPlayback() {
    if (playbackRef.current?.raf) cancelAnimationFrame(playbackRef.current.raf);
    playbackRef.current = null;
    setIsPlaying(false);
  }

  function startRecording() {
    if (!port || !connected || isPlaying) return;
    stopPlayback();
    const startedAt = performance.now();
    recordingRef.current = {
      startedAt,
      events: [{ t: 0, values: { ...live.current.values }, data: [] }],
    };
    setIsRecording(true);
  }

  function stopRecording() {
    const active = recordingRef.current;
    if (!active) return;
    recordingRef.current = null;
    setIsRecording(false);

    const enteredName = window.prompt("Name this recording", "Untitled recording");
    const recording = {
      id: crypto.randomUUID(),
      name: enteredName?.trim() || "Untitled recording",
      createdAt: new Date().toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - active.startedAt)),
      events: active.events,
    };
    const next = [recording, ...recordings];
    setRecordings(next);
    setSelectedRecordingId(recording.id);
    setLoadedRecording(recording);
    setTargetValues({});
    setCueControls(new Set());
    localStorage.setItem(RECORDINGS_KEY, JSON.stringify(next));
  }

  function loadRecording() {
    const recording = recordings.find(item => item.id === selectedRecordingId);
    if (!recording) return;
    stopPlayback();
    setLoadedRecording(recording);
    setFrame({ values: {} });
    setTargetValues({});
    setCueControls(new Set());
  }

  function playRecording() {
    if (!loadedRecording || !loadedRecording.events.length || isRecording) return;
    stopPlayback();
    const playback = {
      recording: loadedRecording,
      startedAt: performance.now(),
      eventIndex: 0,
      values: {},
      raf: null,
    };
    playbackRef.current = playback;
    setFrame({ values: {} });
    setIsPlaying(true);

    const tick = now => {
      if (playbackRef.current !== playback) return;
      const elapsed = now - playback.startedAt;
      while (playback.eventIndex < playback.recording.events.length
        && playback.recording.events[playback.eventIndex].t <= elapsed) {
        playback.values = playback.recording.events[playback.eventIndex].values;
        playback.eventIndex += 1;
      }
      setFrame({ values: playback.values });
      if (elapsed >= playback.recording.durationMs) {
        playbackRef.current = null;
        setIsPlaying(false);
        return;
      }
      playback.raf = requestAnimationFrame(tick);
    };
    playback.raf = requestAnimationFrame(tick);
  }

  function finishChallenge() {
    const challenge = challengeRef.current;
    if (!challenge || !loadedRecording) return;
    const durationMs = Math.min(
      loadedRecording.durationMs,
      Math.max(0, performance.now() - challenge.startedAt),
    );
    challengeRef.current = null;
    if (targetPlaybackRef.current?.raf) cancelAnimationFrame(targetPlaybackRef.current.raf);
    targetPlaybackRef.current = null;
    setTargetValues({});
    setCueControls(new Set());
    setIsChallenging(false);
    setScoreResult(scoreRecording(loadedRecording, {
      durationMs,
      events: challenge.events,
    }));
  }

  function startChallenge() {
    if (!loadedRecording || !loadedRecording.events.length || !port || !connected || isRecording || isPlaying) return;
    stopPlayback();
    setScoreResult(null);
    setIsChallenging(true);
    setCueControls(new Set());
    const startedAt = performance.now();
    challengeRef.current = {
      startedAt,
      events: [{ t: 0, values: { ...live.current.values }, data: [] }],
    };
    const targetPlayback = {
      startedAt,
      eventIndex: 0,
      values: {},
      raf: null,
    };
    targetPlaybackRef.current = targetPlayback;

    const tick = now => {
      if (targetPlaybackRef.current !== targetPlayback) return;
      const elapsed = now - targetPlayback.startedAt;
      while (targetPlayback.eventIndex < loadedRecording.events.length
        && loadedRecording.events[targetPlayback.eventIndex].t <= elapsed) {
        targetPlayback.values = loadedRecording.events[targetPlayback.eventIndex].values;
        targetPlayback.eventIndex += 1;
      }
      setTargetValues(targetPlayback.values);
      setCueControls(upcomingContinuousControls(loadedRecording.events, elapsed));
      if (elapsed >= loadedRecording.durationMs) {
        finishChallenge();
        return;
      }
      targetPlayback.raf = requestAnimationFrame(tick);
    };
    targetPlayback.raf = requestAnimationFrame(tick);
  }

  async function connect() {
    setConnecting(true);
    setMessage("");
    try {
      if (!navigator.requestMIDIAccess) throw new Error("Open the app on localhost in desktop Chrome or Edge.");
      setAccess(await navigator.requestMIDIAccess());
    } catch (error) {
      setMessage(error.message || "Allow MIDI access in your browser and try again.");
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    setAccess(null);
    setPorts([]);
    setSelected("");
  }

  const { values } = frame;
  const status = message || (connected ? "Listening to " + (port?.name || "MIDI input")
    : port ? "Opening MIDI input…" : access ? "No MIDI input found. Check the USB data cable." : "Plug in your FLX4 to get started.");

  return <main className="console">
    <div className="toolbar">
    <div className="connection">
        {ports.length > 1 && <select aria-label="MIDI input" value={selected} onChange={event => setSelected(event.target.value)}>
          {ports.map(input => <option key={input.id} value={input.id}>{input.name || "MIDI input"}</option>)}
        </select>}
        <button className="connect-button" onClick={access ? disconnect : connect} disabled={connecting}>{connecting ? "Requesting MIDI…" : access ? "Disconnect" : "Connect DDJ-FLX4"}</button>
    </div>
      <div className="recording-controls">
        <button className={isRecording ? "record-button recording" : "record-button"} onClick={isRecording ? stopRecording : startRecording} disabled={!isRecording && (!port || !connected || isPlaying || isChallenging)}>
          {isRecording ? "Stop recording" : "Record"}
        </button>
        <select className="recording-select" aria-label="Saved recordings" value={selectedRecordingId} onChange={event => setSelectedRecordingId(event.target.value)} disabled={!recordings.length || isRecording}>
          <option value="">Select recording</option>
          {recordings.map(recording => <option key={recording.id} value={recording.id}>{recording.name}</option>)}
        </select>
        <button className="secondary-button" onClick={loadRecording} disabled={!selectedRecordingId || isRecording || isChallenging}>Load</button>
        <button className="secondary-button" onClick={isPlaying ? stopPlayback : playRecording} disabled={!loadedRecording || isRecording || isChallenging}>
          {isPlaying ? "Stop" : "Play"}
        </button>
        <button className="challenge-button" onClick={isChallenging ? finishChallenge : startChallenge} disabled={!isChallenging && (!loadedRecording || !port || !connected || isRecording || isPlaying)}>
          {isChallenging ? "Finish challenge" : "Start challenge"}
        </button>
        {loadedRecording && <span className="loaded-recording">{loadedRecording.name}</span>}
      </div>
    </div>
    <div className="surface">
      <Deck side="a" values={values} targetValues={targetValues} cueControls={cueControls} />
      <section className="mixer" aria-label="Mixer">
        <div className="channels">
          {["a", "b"].map(side => <div className={"channel " + side} key={side}>
            {pairs.map(([key, label]) => <Knob key={key} label={label} value={values[side + "." + key]} targetValue={targetValues[side + "." + key]} highlighted={cueControls.has(side + "." + key)} />)}
          </div>)}
        </div>
        <div className="mix-faders">
          <Meter label="Crossfader" value={values["mixer.crossfade"]} targetValue={targetValues["mixer.crossfade"]} />
        </div>
      </section>
      <Deck side="b" values={values} targetValues={targetValues} cueControls={cueControls} />
    </div>
    {scoreResult && <ScoreCard result={scoreResult} />}
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
