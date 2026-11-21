import React, { useCallback, useMemo, useRef, useState } from "react";
import { CrowdCamera } from "./CrowdCamera.jsx";
import { crowdMood, updateCrowdHappiness } from "./crowdModel.js";
import { DEFAULT_DANCE_CONFIG } from "./danceScorer.js";

const CONTROLS = [
  ["minMotionSpeed", "Motion floor", 0.05, 1.2, 0.01],
  ["maxMotionSpeed", "Full-energy speed", 1, 6, 0.05],
  ["smoothing", "Motion smoothing", 0.05, 1, 0.01],
  ["flickSpeed", "Flick speed", 0.5, 4, 0.05],
  ["flickMinTravel", "Flick travel", 0.04, 0.6, 0.01],
  ["flickWindowMs", "Flick reversal window", 80, 600, 10],
  ["flickCooldownMs", "Flick cooldown", 100, 1200, 10],
  ["pumpSpeed", "Pump speed", 0.2, 2.5, 0.05],
  ["pumpMinTravel", "Pump travel", 0.05, 0.8, 0.01],
  ["visibilityThreshold", "Landmark confidence", 0.1, 0.95, 0.05],
];

const MODELS = [
  ["ARM MOTION", "Continuous wrist and elbow speed, normalized by shoulder width."],
  ["ARMS UP", "Rewards one or both wrists moving above shoulder level."],
  ["FRAT FLICK", "Detects a fast wrist direction reversal with travel and cooldown guards."],
  ["ARM PUMP", "Detects larger vertical reversals for overhead and chest-level pumping."],
];

export function VisionLab() {
  const [config, setConfig] = useState(DEFAULT_DANCE_CONFIG);
  const [happiness, setHappiness] = useState(20);
  const [counts, setCounts] = useState({ flicks: 0, pumps: 0 });
  const lastFrameAt = useRef(null);
  const mood = crowdMood(happiness);
  const json = useMemo(() => JSON.stringify(config, null, 2), [config]);

  const onFrame = useCallback(frame => {
    const now = performance.now();
    const elapsed = lastFrameAt.current === null ? 0 : (now - lastFrameAt.current) / 1000;
    lastFrameAt.current = now;
    setHappiness(current => updateCrowdHappiness(current, frame.metrics, elapsed));
    const flicks = Number(frame.gestures.leftFlick) + Number(frame.gestures.rightFlick);
    const pumps = Number(frame.gestures.leftPump) + Number(frame.gestures.rightPump);
    if (flicks || pumps) setCounts(current => ({
      flicks: current.flicks + flicks,
      pumps: current.pumps + pumps,
    }));
  }, []);

  function update(key, value) {
    setConfig(current => ({ ...current, [key]: Number(value) }));
  }

  function exportConfig() {
    const href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = "crowd-factor-config.json";
    link.click();
    URL.revokeObjectURL(href);
  }

  return <main className="vision-lab">
    <header className="lab-header">
      <div>
        <a href="/" className="back-link">← Deck Relay</a>
        <span className="eyebrow">LIVE MODEL WORKBENCH</span>
        <h1>Crowd Factor Lab</h1>
        <p>Tune each dance detector against your own movement before bringing it into a song.</p>
      </div>
      <div className={"lab-crowd " + mood.tier}>
        <span>{mood.label}</span>
        <strong>{Math.round(happiness)}</strong>
        <div><i style={{ width: happiness + "%" }} /></div>
      </div>
    </header>

    <div className="lab-grid">
      <div className="lab-preview">
        <CrowdCamera config={config} onFrame={onFrame} lab />
        <div className="model-cards">
          {MODELS.map(([name, description]) => <article key={name}>
            <span>{name}</span>
            <p>{description}</p>
          </article>)}
        </div>
      </div>

      <aside className="tuning-panel">
        <div className="tuning-heading">
          <div><span className="eyebrow">DETECTOR SETTINGS</span><h2>Live tuning</h2></div>
          <button className="secondary" onClick={() => setConfig(DEFAULT_DANCE_CONFIG)}>Reset</button>
        </div>
        <div className="event-counts">
          <span>Flicks <strong>{counts.flicks}</strong></span>
          <span>Pumps <strong>{counts.pumps}</strong></span>
          <button className="text-button" onClick={() => setCounts({ flicks: 0, pumps: 0 })}>Clear counts</button>
        </div>
        <div className="sliders">
          {CONTROLS.map(([key, label, min, max, step]) => <label key={key}>
            <span>{label}<output>{config[key]}</output></span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={config[key]}
              onChange={event => update(key, event.target.value)}
            />
          </label>)}
        </div>
        <div className="config-export">
          <div><span className="eyebrow">CONFIG JSON</span><button className="secondary" onClick={exportConfig}>Export</button></div>
          <pre>{json}</pre>
        </div>
      </aside>
    </div>
  </main>;
}
