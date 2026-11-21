import React, { useEffect, useRef, useState } from "react";
import { detectArmFlick, createArmFlickState } from "./armFlick.js";
import { collectMisses, createBeatState, judgeArmFlick } from "./beatJudge.js";
import { BEAT_TRACK, chartForBpm, createBeatTrack } from "./beatTrack.js";
import { BeatLane } from "./BeatLane.jsx";
import { applyBeatResult, decayCrowd, smoothToward } from "./crowdModel.js";
import { DEFAULT_DANCE_CONFIG } from "./danceScorer.js";
import { usePoseTracker } from "./usePoseTracker.js";

export function DanceScreen() {
  const videoRef = useRef(null);
  const tracker = usePoseTracker({ videoRef, config: DEFAULT_DANCE_CONFIG, maxFps: 24 });
  const running = ["loading", "tracking", "no-pose"].includes(tracker.status);
  const started = useRef(false);
  const bpmRef = useRef(BEAT_TRACK.bpm);
  const trackRef = useRef(null);
  const beatRef = useRef(createBeatState());
  const flickRef = useRef(createArmFlickState());
  const lastDecayAt = useRef(null);
  const levelRef = useRef(24);
  const [shown, setShown] = useState(24);
  const [songTimeMs, setSongTimeMs] = useState(null);
  const [judgment, setJudgment] = useState("");
  const [bothArms, setBothArms] = useState(false);
  const [bpm, setBpm] = useState(BEAT_TRACK.bpm);
  const [chart, setChart] = useState(() => chartForBpm(BEAT_TRACK.bpm));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    tracker.start();
  }, [tracker.start]);

  useEffect(() => {
    const track = createBeatTrack(bpmRef.current);
    trackRef.current = track;
    let frame = null;
    const tick = now => {
      const songTime = track.songTimeMs();
      if (songTime !== null) {
        const elapsed = lastDecayAt.current === null ? 0 : (now - lastDecayAt.current) / 1000;
        lastDecayAt.current = now;
        const misses = collectMisses(beatRef.current, songTime, track.cues, track.loopMs);
        beatRef.current = misses.state;
        levelRef.current = misses.missed.reduce(happiness => applyBeatResult(happiness, "miss"), decayCrowd(levelRef.current, elapsed));
        setShown(current => smoothToward(current, levelRef.current, elapsed));
        if (misses.missed.length) {
          setJudgment("miss");
          setBothArms(false);
        }
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

  useEffect(() => {
    const track = trackRef.current;
    const songTime = track?.songTimeMs();
    if (songTime === null || songTime === undefined) return;
    const detected = detectArmFlick(flickRef.current, tracker.metrics.burst, performance.now());
    flickRef.current = detected.state;
    if (!detected.flick) return;
    const judged = judgeArmFlick(beatRef.current, songTime, track.cues, track.loopMs);
    beatRef.current = judged.state;
    const raisedTogether = tracker.metrics.armsUp === 2;
    setJudgment(judged.judgment);
    setBothArms(raisedTogether);
    const nextLevel = applyBeatResult(levelRef.current, judged.judgment, raisedTogether);
    if (nextLevel > levelRef.current) setShown(nextLevel);
    levelRef.current = nextLevel;
  }, [tracker.metrics]);

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
    setBpm(next.bpm);
    setChart(next);
    const song = trackRef.current?.songTimeMs();
    if (song !== null && song !== undefined) setSongTimeMs(song);
    begin();
  }

  const percent = Math.round(shown);

  return <main className="dance-screen" onClick={begin}>
    <video ref={videoRef} muted playsInline autoPlay aria-label="Front camera" />
    <div className="dance-bar" role="meter" aria-label="Crowd level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <i style={{ height: shown.toFixed(2) + "%" }} />
    </div>
    <BeatLane
      songTimeMs={songTimeMs}
      cues={chart.cues}
      loopMs={chart.loopMs}
      leadMs={chart.leadMs}
      judgment={judgment}
      bothArms={bothArms}
      bpm={bpm}
      onBpm={changeBpm}
    />
    {tracker.status === "error" && <p className="dance-error">{tracker.message}</p>}
  </main>;
}
