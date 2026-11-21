import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDance, createDanceState, DEFAULT_DANCE_CONFIG } from "./danceScorer.js";

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

test("a fast direction reversal produces one wrist flick", () => {
  const config = { ...DEFAULT_DANCE_CONFIG, smoothing: 1 };
  const results = runFrames([
    [0, pose({ leftWrist: [0.25, 0.32] })],
    [80, pose({ leftWrist: [0.38, 0.32] })],
    [160, pose({ leftWrist: [0.51, 0.32] })],
    [240, pose({ leftWrist: [0.33, 0.32] })],
    [300, pose({ leftWrist: [0.26, 0.32] })],
  ], config);
  assert.equal(results.filter(result => result.gestures.leftFlick).length, 1);
  assert.ok(results[3].metrics.flickPulse > 0.9);
});

test("gesture cooldown prevents rapid repeated flick scores", () => {
  const results = runFrames([
    [0, pose({ leftWrist: [0.24, 0.32] })],
    [80, pose({ leftWrist: [0.42, 0.32] })],
    [160, pose({ leftWrist: [0.24, 0.32] })],
    [240, pose({ leftWrist: [0.42, 0.32] })],
    [320, pose({ leftWrist: [0.24, 0.32] })],
  ]);
  assert.equal(results.filter(result => result.gestures.leftFlick).length, 1);
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
