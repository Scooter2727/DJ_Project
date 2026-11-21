import React, { useCallback, useEffect, useRef, useState } from "react";
import { createArmFlickState, detectArmFlick } from "./armFlick.js";
import { createBeatState, judgeArmFlick, skippedCueDeadline } from "./beatJudge.js";
import { BEAT_TRACK, chartForBpm, createBeatTrack } from "./beatTrack.js";
import { BeatLane } from "./BeatLane.jsx";
import { advanceCrowdMeter, createCrowdMeter, crowdRateForBeat } from "./crowdModel.js";
import { DEFAULT_DANCE_CONFIG } from "./danceScorer.js";
import { usePoseTracker } from "./usePoseTracker.js";

export function DanceScreen() {
  const videoRef = useRef(null);
  const started = useRef(false);
  const bpmRef = useRef(BEAT_TRACK.bpm);
  const trackRef = useRef(null);
  const beatRef = useRef(createBeatState());
  const flickRef = useRef(createArmFlickState());
  const lastFrameAt = useRef(null);
  const crowdResponse = useRef(null);
  const skipDeadline = useRef(Infinity);
  const consecutiveMisses = useRef(0);
  const [meter, setMeter] = useState(() => createCrowdMeter(24));
  const [songTimeMs, setSongTimeMs] = useState(null);
  const [result, setResult] = useState(null);
  const [scoredCues, setScoredCues] = useState(() => new Set());
  const [bpm, setBpm] = useState(BEAT_TRACK.bpm);
  const [chart, setChart] = useState(() => chartForBpm(BEAT_TRACK.bpm));

  const onPoseFrame = useCallback(({ gestures, metrics, timestamp, flickAt }) => {
    const track = trackRef.current;
    const songTime = track?.songTimeMs();
    if (songTime == null || flickAt === null) return;

    const frameTime = songTime - Math.max(0, performance.now() - flickAt);
    const judged = judgeArmFlick(beatRef.current, frameTime, track.cues, track.loopMs);
    if (judged.judgment === null) return;
    if (judged.noteTime === null && !detectArmFlick(flickRef.current, gestures, timestamp).flick) return;
    flickRef.current = { lastAt: timestamp };
    beatRef.current = judged.state;
    const raisedTogether = metrics.armsUp === 2;
    setResult({ judgment: judged.judgment, bothArms: raisedTogether, timestamp });
    consecutiveMisses.current = judged.judgment === "miss" ? consecutiveMisses.current + 1 : 0;
    if (judged.noteTime !== null) {
      setScoredCues(judged.state.resolved);
      const nextDeadline = skippedCueDeadline(judged.noteTime, track.cues, track.loopMs);
      skipDeadline.current = Math.max(skipDeadline.current, nextDeadline);
    }
    crowdResponse.current = {
      rate: crowdRateForBeat(judged.judgment, raisedTogether, consecutiveMisses.current),
      until: songTime + track.loopMs / track.cues.length,
    };
  }, []);

  const tracker = usePoseTracker({ videoRef, config: DEFAULT_DANCE_CONFIG, maxFps: 24, onFrame: onPoseFrame });
  const running = ["loading", "tracking", "no-pose"].includes(tracker.status);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    tracker.start();
  }, [tracker.start]);

  useEffect(() => {
    const track = createBeatTrack(bpmRef.current);
    trackRef.current = track;
    skipDeadline.current = skippedCueDeadline(null, track.cues, track.loopMs);
    let frame = null;
    const tick = now => {
      const songTime = track.songTimeMs();
      if (songTime !== null) {
        const elapsed = (now - (lastFrameAt.current ?? now)) / 1000;
        lastFrameAt.current = now;
        const response = crowdResponse.current;
        let rate = response && songTime < response.until ? response.rate : 0;
        if (songTime > skipDeadline.current) rate = crowdRateForBeat("miss", false, 2);
        setMeter(current => advanceCrowdMeter(current, elapsed, rate));
        setSongTimeMs(songTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      track.stop();
      trackRef.current = null;
    };
  }, []);

  function begin() {
    if (!running) tracker.start();
    trackRef.current?.start();
  }

  function changeBpm(value) {
    const next = trackRef.current?.setBpm(Number(value)) ?? chartForBpm(Number(value));
    if (next.bpm === bpmRef.current) {
      begin();
      return;
    }
    bpmRef.current = next.bpm;
    beatRef.current = createBeatState();
    setScoredCues(beatRef.current.resolved);
    crowdResponse.current = null;
    consecutiveMisses.current = 0;
    skipDeadline.current = skippedCueDeadline(null, next.cues, next.loopMs);
    setBpm(next.bpm);
    setChart(next);
    const song = trackRef.current?.songTimeMs();
    if (song !== null && song !== undefined) setSongTimeMs(song);
    begin();
  }

  const percent = Math.round(meter.level);

  return <main className="dance-screen" onClick={begin}>
    <video ref={videoRef} muted playsInline autoPlay aria-label="Front camera" />
    <div className="dance-bar" role="meter" aria-label="Crowd level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <i style={{ transform: `scaleY(${meter.level / 100})` }} />
    </div>
    <BeatLane
      songTimeMs={songTimeMs}
      cues={chart.cues}
      loopMs={chart.loopMs}
      leadMs={chart.leadMs}
      result={result}
      scoredCues={scoredCues}
      bpm={bpm}
      onBpm={changeBpm}
    />
    {tracker.status === "error" && <p className="dance-error">{tracker.message}</p>}
  </main>;
}
