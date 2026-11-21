import React, { useRef } from "react";
import { PoseOverlay } from "./PoseOverlay.jsx";
import { usePoseTracker } from "./usePoseTracker.js";

const pct = value => `${Math.round(value * 100)}%`;

export function CrowdCamera({ config, onFrame, lab = false }) {
  const videoRef = useRef(null);
  const tracker = usePoseTracker({ videoRef, config, onFrame, maxFps: lab ? 15 : 12 });
  const running = ["loading", "tracking", "no-pose"].includes(tracker.status);
  const gestureNames = [
    tracker.gestures.leftFlick && "LEFT FLICK",
    tracker.gestures.rightFlick && "RIGHT FLICK",
    tracker.gestures.leftPump && "LEFT PUMP",
    tracker.gestures.rightPump && "RIGHT PUMP",
  ].filter(Boolean);

  return <section className={"crowd-camera " + (lab ? "lab-camera" : "")} aria-label="Crowd Factor camera">
    <div className="camera-heading">
      <div>
        <span className="eyebrow">CROWD FACTOR</span>
        <h2>{lab ? "Vision lab" : "Dance cam"}</h2>
      </div>
      <span className={"camera-state " + tracker.status}>{tracker.status.replace("-", " ")}</span>
    </div>

    <div className="camera-stage">
      <video ref={videoRef} muted playsInline aria-label="Mirrored front camera" />
      <PoseOverlay landmarks={tracker.landmarks} />
      {!running && <div className="camera-placeholder">
        <strong>{tracker.status === "error" ? "Camera unavailable" : "Ready to get moving?"}</strong>
        <span>{tracker.message}</span>
      </div>}
      {running && !tracker.metrics.detected && <div className="pose-guide">Step back so your shoulders and arms are visible</div>}
      {gestureNames.length > 0 && <div className="gesture-flash" aria-live="polite">{gestureNames.join(" + ")}</div>}
    </div>

    <div className="camera-readout">
      <div>
        <span>Dance energy</span>
        <strong>{pct(tracker.metrics.score)}</strong>
      </div>
      <div className="energy-track" aria-label={`Dance energy ${pct(tracker.metrics.score)}`}>
        <i style={{ width: pct(tracker.metrics.score) }} />
      </div>
      <div className="metric-row">
        <span>Motion <b>{pct(tracker.metrics.motion)}</b></span>
        <span>Arms up <b>{pct(tracker.metrics.raised)}</b></span>
        <span>Flick <b>{pct(tracker.metrics.flickPulse)}</b></span>
        <span>Inference <b>{tracker.inferenceMs.toFixed(0)} ms</b></span>
      </div>
    </div>

    <div className="camera-actions">
      <button onClick={running ? tracker.stop : tracker.start} disabled={tracker.status === "loading"}>
        {tracker.status === "loading" ? tracker.message : running ? "Stop camera" : "Enable camera"}
      </button>
      <p>Frames stay on this device and are never recorded.</p>
    </div>
  </section>;
}
