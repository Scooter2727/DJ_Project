import React, { useEffect, useState } from "react";
import { BEAT_WINDOWS, timerBars, timerWindow } from "./beatJudge.js";
import { BEAT_TRACK } from "./beatTrack.js";
import { beatPoints } from "./crowdModel.js";

const STATUS = {
  perfect: "PERFECT",
  good: "GOOD",
  miss: "MISS",
  offbeat: "OFF BEAT",
};

function timerLabel(remainingMs) {
  if (Math.abs(remainingMs) <= BEAT_WINDOWS.perfectMs) return "NOW";
  if (remainingMs < 0) return "LATE";
  return (remainingMs / 1000).toFixed(1) + "s";
}

function formatPoints(points) {
  const text = Number.isInteger(points) ? String(points) : points.toFixed(1);
  return points > 0 ? `+${text}` : text;
}

function statusText(songTimeMs, judgment, bothArms) {
  if (songTimeMs === null) return "TAP TO START";
  if (!judgment) return "FLICK AT THE LINE";
  const points = beatPoints(judgment, bothArms);
  const pointsLabel = points === 0 ? "" : " " + formatPoints(points);
  const bonus = bothArms && points > 0 ? " BOTH ARMS" : "";
  return `${STATUS[judgment]}${pointsLabel}${bonus}`;
}

export function BeatLane({ songTimeMs, cues, loopMs, leadMs, judgment, bothArms, bpm, onBpm }) {
  const [bpmDraft, setBpmDraft] = useState(String(bpm));
  useEffect(() => setBpmDraft(String(bpm)), [bpm]);
  function commitBpm(value) {
    const next = Math.round(Number(value));
    if (!Number.isFinite(next)) {
      setBpmDraft(String(bpm));
      return;
    }
    onBpm(next);
  }
  const bars = songTimeMs === null ? [] : timerBars(songTimeMs, cues, loopMs, leadMs);
  const good = timerWindow(BEAT_WINDOWS.goodMs, leadMs);
  const perfect = timerWindow(BEAT_WINDOWS.perfectMs, leadMs);

  return <div className="beat-lane" aria-label="Arm flick cues">
    <p className={"beat-call " + (judgment || "")}>{statusText(songTimeMs, judgment, bothArms)}</p>
    <div className="timer-track">
      <div className="timer-window good" style={{ left: `${good.left}%`, width: `${good.width}%` }} aria-hidden="true" />
      <div className="timer-window perfect" style={{ left: `${perfect.left}%`, width: `${perfect.width}%` }} aria-hidden="true" />
      <div className="hit-line" style={{ left: `${good.left + good.width / 2}%` }} aria-hidden="true"><span>FLICK</span></div>
      {bars.map(bar => <div className={"timer-bar " + bar.zone} key={bar.time} style={{ left: `${bar.left}%` }} aria-label={timerLabel(bar.remainingMs)}>
        <b>{timerLabel(bar.remainingMs)}</b>
        <i />
      </div>)}
    </div>
    <label className="bpm-field">
      <span>BPM</span>
      <input
        type="number"
        inputMode="numeric"
        min={BEAT_TRACK.minBpm}
        max={BEAT_TRACK.maxBpm}
        step="1"
        value={bpmDraft}
        aria-label="Beats per minute"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onChange={event => setBpmDraft(event.target.value)}
        onBlur={() => commitBpm(bpmDraft)}
        onKeyDown={event => {
          if (event.key === "Enter") commitBpm(bpmDraft);
        }}
      />
    </label>
  </div>;
}
