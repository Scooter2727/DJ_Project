import React, { useEffect, useState } from "react";
import { BEAT_WINDOWS, TIMER_TRACK, timerBars, timerWindow } from "./beatJudge.js";
import { BEAT_TRACK } from "./beatTrack.js";

const STATUS = {
  perfect: "PERFECT",
  good: "GOOD",
  miss: "MISS",
};

function timerLabel(bar) {
  if (bar.zone === "perfect") return "NOW";
  return (bar.remainingMs / 1000).toFixed(1) + "s";
}

function statusText(songTimeMs, judgment, bothArms) {
  if (songTimeMs === null) return "TAP TO START";
  if (!judgment) return "FLICK AT THE LINE";
  const bonus = bothArms && judgment !== "miss" ? " BOTH ARMS" : "";
  return `${STATUS[judgment]}${bonus}`;
}

export function BeatLane({ songTimeMs, cues, loopMs, leadMs, result, scoredCues, bpm, onBpm }) {
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
  const bars = songTimeMs === null ? [] : timerBars(songTimeMs, cues, loopMs, leadMs)
    .filter(bar => !scoredCues.has(bar.time));
  const good = timerWindow(BEAT_WINDOWS.goodMs, BEAT_WINDOWS.perfectMs, leadMs);
  const perfect = timerWindow(BEAT_WINDOWS.perfectMs, -BEAT_WINDOWS.perfectMs, leadMs);

  return <div className="beat-lane" aria-label="Arm flick cues">
    <p className={"beat-call " + (result?.judgment ?? "")} aria-live="polite">
      <span key={result?.timestamp}>{statusText(songTimeMs, result?.judgment, result?.bothArms)}</span>
    </p>
    <div className="timer-track">
      <div className="timer-window good" style={{ left: `${good.left}%`, width: `${good.width}%` }} aria-hidden="true" />
      <div className="timer-window perfect" style={{ left: `${perfect.left}%`, width: `${perfect.width}%` }} aria-hidden="true" />
      <div className="hit-line" style={{ left: `${TIMER_TRACK.start + TIMER_TRACK.span}%` }} aria-hidden="true"><span>FLICK</span></div>
      {bars.map(bar => {
        const label = timerLabel(bar);
        return <div className={"timer-bar " + bar.zone} key={bar.time} style={{ left: `${bar.left}%` }} aria-label={label}>
          <b>{label}</b>
          <i />
        </div>;
      })}
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
