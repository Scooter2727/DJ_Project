import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDance, createDanceState } from "./danceScorer.js";
import { createBeatState, judgeArmFlick } from "./beatJudge.js";

function pose({ leftWrist = [0.3, 0.45], rightWrist = [0.7, 0.45], visibility = 1 } = {}) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility, presence: visibility }));
  const set = (index, [x, y]) => { points[index] = { x, y, visibility, presence: visibility }; };
  set(11, [0.4, 0.4]);
  set(12, [0.6, 0.4]);
  set(13, [0.35, 0.48]);
  set(14, [0.65, 0.48]);
  set(15, leftWrist);
  set(16, rightWrist);
  set(23, [0.44, 0.68]);
  set(24, [0.56, 0.68]);
  return points;
}

function runFrames(frames, config = {}) {
  let state = createDanceState();
  return frames.map(([timestamp, landmarks]) => {
    const result = analyzeDance(landmarks, timestamp, state, config);
    state = result.state;
    return result;
  });
}

test("still arms do not build motion or trigger a gesture", () => {
  const results = runFrames(Array.from({ length: 15 }, (_, index) => [index * 50, pose()]));
  const final = results.at(-1);
  assert.equal(final.metrics.motion, 0);
  assert.equal(final.metrics.score, 0);
  assert.deepEqual(final.gestures, {
    leftFlick: false,
    rightFlick: false,
    leftPump: false,
    rightPump: false,
  });
});

test("sustained arm movement raises the dance score", () => {
  const frames = Array.from({ length: 18 }, (_, index) => [
    index * 60,
    pose({
      leftWrist: [0.3 + (index % 2 ? 0.12 : 0), 0.18 + (index % 3) * 0.04],
      rightWrist: [0.7 - (index % 2 ? 0.12 : 0), 0.18 + ((index + 1) % 3) * 0.04],
    }),
  ]);
  const final = runFrames(frames).at(-1);
  assert.ok(final.metrics.motion > 0.65, `motion was ${final.metrics.motion}`);
  assert.ok(final.metrics.score > 0.5, `score was ${final.metrics.score}`);
  assert.equal(final.metrics.raised, 1);
});

test("horizontal, vertical and diagonal arm motion registers without a stop or reversal", () => {
  for (const [dx, dy] of [[0.035, 0], [-0.035, 0], [0, 0.035], [0, -0.035], [0.035, -0.035]]) {
    const results = runFrames([0, 1, 1].map((step, index) => [
      index * 50, pose({ leftWrist: [0.3 + dx * step, 0.28 + dy * step] }),
    ]));
    assert.deepEqual(results.map(result => result.gestures.leftFlick), [false, true, false]);
    assert.equal(results[1].flickAt, 50);
  }
});

test("small wrist jitter does not accumulate enough displacement to score", () => {
  const results = runFrames([0, 0.004, -0.004, 0.004, -0.004, 0].map((offset, index) => [
    index * 50, pose({ leftWrist: [0.3 + offset, 0.27] }),
  ]));
  assert.ok(results.every(frame => !frame.gestures.leftFlick));
});

test("slow repositioning does not accumulate into a flick", () => {
  const frames = runFrames([850, 950, 1050, 1150, 1250, 1350, 1450, 1550].map((time, index) => [
    time, pose({ leftWrist: [0.3 + index * 0.004, 0.27] }),
  ]));
  assert.ok(frames.every(frame => frame.flickAt === null));
});

test("a compact flick can build across several frames and score immediately", () => {
  const beat = 1000;
  const frames = runFrames([1130, 1170, 1210, 1250].map((time, index) => [
    time, pose({ leftWrist: [0.3 + index * 0.011, 0.27] }),
  ]));
  assert.deepEqual(frames.map(frame => frame.gestures.leftFlick), [false, false, false, true]);
  const flick = frames.at(-1);
  assert.equal(flick.flickAt, 1250);
  assert.equal(judgeArmFlick(createBeatState(), flick.flickAt, [beat], 8000).judgment, "perfect");
});

test("lifting into position primes the detector for a separate flick", () => {
  const results = runFrames([0.47, 0.33, 0.33, 0.30, 0.30].map((y, index) => [
    index * 50, pose({ leftWrist: [0.3, y] }),
  ]));
  assert.deepEqual(results.map(frame => frame.gestures.leftFlick), [false, false, false, true, false]);
});

test("a small movement is ignored and returning the arm within the delay does not flick again", () => {
  const frames = [[0, 0.30], [50, 0.325], [100, 0.36], [200, 0.36], [300, 0.36], [400, 0.30], [500, 0.30], [550, 0.36]]
    .map(([time, x]) => [time, pose({ leftWrist: [x, 0.3] })]);
  const flicks = runFrames(frames).map(frame => frame.flickAt).filter(time => time !== null);
  assert.deepEqual(flicks, [100, 550]);
});

test("brief tracking loss does not clear an arm's return delay", () => {
  const raised = x => pose({ leftWrist: [x, 0.3] });
  const frames = [[0, raised(0.30)], [50, raised(0.36)], [100, null], [200, raised(0.36)], [300, raised(0.36)],
    [400, raised(0.30)], [450, raised(0.30)], [500, raised(0.36)]];
  const flicks = runFrames(frames).map(frame => frame.flickAt).filter(time => time !== null);
  assert.deepEqual(flicks, [50, 500]);
});

test("moving the body and raised arm together does not trigger a flick", () => {
  const frames = [0, 0.06, -0.03, 0.03].map((offset, index) => [
    index * 50,
    pose({ leftWrist: [0.32, 0.27] }).map(point => ({ ...point, x: point.x + offset })),
  ]);
  for (const frame of runFrames(frames)) {
    assert.equal(frame.metrics.armsUp, 1);
    assert.equal(frame.metrics.burst, 0);
    assert.equal(frame.gestures.leftFlick, false);
  }
});

test("losing the wrist clears the motion history before tracking resumes", () => {
  const raised = x => pose({ leftWrist: [x, 0.31] });
  const hiddenWrist = raised(0.44);
  hiddenWrist[15].visibility = 0.3;
  for (const interruption of [hiddenWrist, null]) {
    const frames = runFrames([[0, raised(0.26)], [50, raised(0.44)], [100, interruption], [150, raised(0.26)]]);
    assert.equal(frames[2].metrics.armsUp, 0);
    assert.equal(frames[3].metrics.armsUp, 1);
    assert.equal(frames[3].metrics.burst, 0);
    assert.equal(frames[3].gestures.leftFlick, false);
  }

  const stalled = runFrames([[0, raised(0.26)], [50, raised(0.44)], [300, raised(0.26)]]);
  assert.equal(stalled.at(-1).metrics.burst, 0);
  assert.equal(stalled.at(-1).gestures.leftFlick, false);
});

test("a visible raised wrist can flick when its elbow is occluded", () => {
  const frames = [0.26, 0.30, 0.30].map((x, index) => {
    const landmarks = pose({ leftWrist: [x, 0.31] });
    landmarks[13].visibility = 0.3;
    return [index * 50, landmarks];
  });
  const results = runFrames(frames);
  assert.ok(results.every(frame => frame.metrics.armsUp === 1));
  assert.deepEqual(results.map(frame => frame.gestures.leftFlick), [false, true, false]);
});

test("a compact wrist snap scores only above that wrist's own shoulder", () => {
  for (const shoulderHeight of [0.4, 0.25]) {
    const frames = [[0.32, 0.31], [0.35, 0.28], [0.32, 0.31]].map((leftWrist, index) => {
      const landmarks = pose({ leftWrist });
      landmarks[11].y = shoulderHeight;
      return [index * 50, landmarks];
    });
    assert.equal(runFrames(frames).some(frame => frame.gestures.leftFlick), shoulderHeight === 0.4);
  }
});

test("continuous arm movement can score on successive cues without scoring twice on one cue", () => {
  const frames = runFrames(Array.from({ length: 16 }, (_, index) => [
    index * 100, pose({ leftWrist: [0.25 + index * 0.04, 0.3] }),
  ]));
  const cues = [400, 1200];
  let state = createBeatState();
  const hits = [];
  for (const frame of frames) {
    if (frame.flickAt === null) continue;
    const result = judgeArmFlick(state, frame.flickAt, cues, 8000);
    state = result.state;
    if (result.noteTime !== null) hits.push(result.noteTime);
  }
  assert.deepEqual(hits, cues);
});

test("both arms above the shoulders are counted together", () => {
  const both = analyzeDance(pose({ leftWrist: [0.3, 0.2], rightWrist: [0.7, 0.2] }), 0);
  const one = analyzeDance(pose({ leftWrist: [0.3, 0.2], rightWrist: [0.7, 0.7] }), 0);
  assert.equal(both.metrics.armsUp, 2);
  assert.equal(one.metrics.armsUp, 1);
});

test("one still arm above the shoulder does not raise the crowd signal", () => {
  const frames = Array.from({ length: 8 }, (_, index) => [
    index * 80,
    pose({ leftWrist: [0.32, 0.22], rightWrist: [0.72, 0.62] }),
  ]);
  const final = runFrames(frames).at(-1);
  assert.ok(final.metrics.crowd < 0.05, `crowd was ${final.metrics.crowd}`);
});

test("a short raised-arm snap is visible before the smoothed crowd rises", () => {
  const still = analyzeDance(pose({ leftWrist: [0.28, 0.18], rightWrist: [0.74, 0.7] }), 0);
  const snapped = analyzeDance(pose({ leftWrist: [0.42, 0.16], rightWrist: [0.74, 0.7] }), 80, still.state);
  assert.ok(snapped.metrics.burst >= 0.28, `burst was ${snapped.metrics.burst}`);
  assert.ok(snapped.metrics.crowd < snapped.metrics.burst);
});

test("one moving arm above the shoulder raises the crowd signal", () => {
  const frames = Array.from({ length: 12 }, (_, index) => [
    index * 70,
    pose({
      leftWrist: [0.28 + (index % 2 ? 0.14 : 0), 0.18 + (index % 3) * 0.04],
      rightWrist: [0.74, 0.7],
    }),
  ]);
  const final = runFrames(frames).at(-1);
  assert.ok(final.metrics.crowd > 0.4, `crowd was ${final.metrics.crowd}`);
});

test("a small hand flick above the shoulder counts and the same flick below does not", () => {
  const raisedStill = analyzeDance(pose({ leftWrist: [0.32, 0.28], rightWrist: [0.74, 0.7] }), 0);
  const raisedFlick = analyzeDance(pose({ leftWrist: [0.35, 0.26], rightWrist: [0.74, 0.7] }), 80, raisedStill.state);
  const lowStill = analyzeDance(pose({ leftWrist: [0.32, 0.41], rightWrist: [0.74, 0.7] }), 0);
  const lowFlick = analyzeDance(pose({ leftWrist: [0.4, 0.41], rightWrist: [0.74, 0.7] }), 80, lowStill.state);
  assert.ok(raisedFlick.metrics.burst >= 0.12, `burst was ${raisedFlick.metrics.burst}`);
  assert.equal(raisedFlick.metrics.armsUp, 1);
  assert.equal(lowFlick.metrics.burst, 0);
  assert.equal(lowFlick.metrics.armsUp, 0);
});

test("arm movement below the shoulders does not raise the crowd signal", () => {
  const frames = Array.from({ length: 14 }, (_, index) => [
    index * 60,
    pose({
      leftWrist: [0.22 + (index % 2 ? 0.16 : 0), 0.68],
      rightWrist: [0.78 - (index % 2 ? 0.16 : 0), 0.68],
    }),
  ]);
  const final = runFrames(frames).at(-1);
  assert.equal(final.metrics.crowd, 0);
  assert.equal(final.metrics.motion, 0);
  assert.equal(final.gestures.leftFlick, false);
  assert.equal(final.gestures.rightPump, false);
});

test("low-confidence landmarks pause scoring", () => {
  const [result] = runFrames([[0, pose({ visibility: 0.2 })]]);
  assert.equal(result.metrics.detected, false);
  assert.equal(result.metrics.score, 0);
});

test("missing pose data returns a safe zero score", () => {
  const result = analyzeDance([], 100, createDanceState());
  assert.equal(result.metrics.detected, false);
  assert.equal(result.metrics.score, 0);
});
