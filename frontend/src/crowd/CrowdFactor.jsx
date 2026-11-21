import React, { useCallback, useRef, useState } from "react";
import { CrowdCamera } from "./CrowdCamera.jsx";
import { crowdMood, updateCrowdHappiness } from "./crowdModel.js";
import { DEFAULT_DANCE_CONFIG } from "./danceScorer.js";

export function CrowdFactor() {
  const [active, setActive] = useState(false);
  const [happiness, setHappiness] = useState(20);
  const [detected, setDetected] = useState(false);
  const lastFrameAt = useRef(null);
  const mood = crowdMood(happiness, detected || !active);

  const onFrame = useCallback(frame => {
    const now = performance.now();
    const elapsed = lastFrameAt.current === null ? 0 : (now - lastFrameAt.current) / 1000;
    lastFrameAt.current = now;
    setDetected(frame.metrics.detected);
    setHappiness(current => updateCrowdHappiness(current, frame.metrics, elapsed, active));
  }, [active]);

  function toggleBreak() {
    lastFrameAt.current = null;
    setActive(current => !current);
  }

  return <section className={"crowd-factor-shell " + mood.tier}>
    <div className="crowd-factor-heading">
      <div>
        <span className="eyebrow">OFF-DECK BONUS</span>
        <h2>Crowd Factor</h2>
        <p>When the deck gives you a break, dance, pump your arms, or land a frat flick to lift the room.</p>
      </div>
      <div className="crowd-factor-actions">
        <a className="lab-link" href="/vision-lab.html">Open vision lab</a>
        <button onClick={toggleBreak}>{active ? "End crowd break" : "Start crowd break"}</button>
      </div>
    </div>

    <div className="crowd-factor-grid">
      <CrowdCamera config={DEFAULT_DANCE_CONFIG} onFrame={onFrame} />
      <div className="crowd-stage" aria-label={`Crowd happiness ${Math.round(happiness)} out of 100`}>
        <div className="stage-lights" aria-hidden="true"><i /><i /><i /></div>
        <div className="crowd-score">
          <span>{active ? mood.label : "WAITING FOR CROWD BREAK"}</span>
          <strong>{Math.round(happiness)}</strong>
          <div><i style={{ width: happiness + "%" }} /></div>
        </div>
        <div className="crowd-people" aria-hidden="true">
          {Array.from({ length: 15 }, (_, index) =>
            <i key={index} style={{ "--person": index, "--height": `${38 + (index % 5) * 7}%` }} />
          )}
        </div>
        <div className="crowd-prompt">
          {active ? "Keep both arms in frame. Bigger, faster movement fills the meter." : "Start a crowd break to score camera movement."}
        </div>
      </div>
    </div>
  </section>;
}
