import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { decodeMidi } from "./midi.js";
import "./style.css";

const percent = value => value === undefined ? "—" : Math.round(value / 16383 * 100) + "%";
const pairs = [["trim", "Trim"], ["high", "High EQ"], ["mid", "Mid EQ"], ["low", "Low EQ"], ["cfx", "CFX"]];

function Meter({ label, value, vertical = false }) {
  const position = value === undefined ? 50 : value / 16383 * 100;
  return <div className={vertical ? "meter vertical" : "meter"}>
    <div className="meter-label"><span>{label}</span><output>{percent(value)}</output></div>
    <div className="rail"><span className={value === undefined ? "thumb idle" : "thumb"} style={{ "--position": position + "%" }} /></div>
  </div>;
}

function Knob({ label, value }) {
  const rotation = value === undefined ? 0 : value / 16383 * 270 - 135;
  return <div className="knob-control">
    <div className="knob"><i style={{ transform: "rotate(" + rotation + "deg)" }} /></div>
    <span>{label}</span><output>{percent(value)}</output>
  </div>;
}

function Deck({ side, values }) {
  const read = control => values[side + "." + control];
  const transport = [["cue", "CUE"], ["play", "▶ PLAY"]];
  return <section className={"deck " + side} aria-label="Deck controls">
    <div className="deck-heading">
      <div className="loop-buttons" aria-label="Loop controls">
        <span className={"loop-button " + (read("loopIn") ? "lit" : "")} aria-label="Loop in">IN</span>
        <span className={"loop-button " + (read("loopOut") ? "lit" : "")} aria-label="Loop out">OUT</span>
      </div>
      <span className={"sync-button " + (read("sync") ? "lit" : "")} aria-label="Sync">SYNC</span>
    </div>
    <div className="deck-body">
      <div className="platter" style={{ "--angle": (read("jog") ?? 0) + "deg" }}>
        <div className="disc"><div className="disc-label" /></div>
      </div>
    </div>
    <div className="transport">{transport.map(([control, label]) =>
      <span className={read(control) ? "lit" : ""} key={control}>{label}</span>
    )}</div>
  </section>;
}

function App() {
  const [access, setAccess] = useState(null);
  const [ports, setPorts] = useState([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [frame, setFrame] = useState({ values: {} });
  const live = useRef(frame);

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
      const bytes = Array.from(event.data);
      const { values } = live.current;
      live.current = {
        values: { ...values, ...decodeMidi(bytes, values) },
      };
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
    <div className="connection">
        {ports.length > 1 && <select aria-label="MIDI input" value={selected} onChange={event => setSelected(event.target.value)}>
          {ports.map(input => <option key={input.id} value={input.id}>{input.name || "MIDI input"}</option>)}
        </select>}
        <button onClick={access ? disconnect : connect} disabled={connecting}>{connecting ? "Requesting MIDI…" : access ? "Disconnect" : "Connect DDJ-FLX4"}</button>
    </div>
    <div className="surface">
      <Deck side="a" values={values} />
      <section className="mixer" aria-label="Mixer">
        <div className="channels">
          {["a", "b"].map(side => <div className={"channel " + side} key={side}>
            {pairs.map(([key, label]) => <Knob key={key} label={label} value={values[side + "." + key]} />)}
          </div>)}
        </div>
        <div className="mix-faders">
          <Meter label="Crossfader" value={values["mixer.crossfade"]} />
        </div>
      </section>
      <Deck side="b" values={values} />
    </div>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
