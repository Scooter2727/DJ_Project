import test from "node:test";
import assert from "node:assert/strict";
import { collectMisses, createBeatState, judgeArmFlick, timerBars, visibleCues } from "./beatJudge.js";

const cues = [0, 2000];
const loopMs = 8000;

test("an on-time arm flick scores perfect and consumes the wave", () => {
  const first = judgeArmFlick(createBeatState(), 40, cues, loopMs);
  const second = judgeArmFlick(first.state, 70, cues, loopMs);
  assert.equal(first.judgment, "perfect");
  assert.equal(second.judgment, "offbeat");
});

test("a slightly early arm flick scores good", () => {
  const result = judgeArmFlick(createBeatState(), 2000 - 280, cues, loopMs);
  assert.equal(result.judgment, "good");
  assert.equal(result.noteTime, 2000);
});

test("an arm flick a little farther from the line still scores good", () => {
  const result = judgeArmFlick(createBeatState(), 2000 - 270, cues, loopMs);
  assert.equal(result.judgment, "good");
});

test("one flick hits only the closest wave", () => {
  const closeCues = [1000, 1300];
  const result = judgeArmFlick(createBeatState(), 1090, closeCues, loopMs);
  const follow = judgeArmFlick(result.state, 1090, closeCues, loopMs);
  assert.equal(result.noteTime, 1000);
  assert.equal(result.judgment, "perfect");
  assert.equal(follow.judgment, "good");
  assert.equal(follow.noteTime, 1300);
});

test("a flick outside the timing window is off-beat and leaves the upcoming wave pending", () => {
  const upcoming = [2000];
  const result = judgeArmFlick(createBeatState(), 700, upcoming, loopMs);
  const misses = collectMisses(result.state, 700, upcoming, loopMs);
  assert.equal(result.judgment, "offbeat");
  assert.deepEqual(misses.missed, []);
});

test("a wave that passes the window unresolved becomes a miss once", () => {
  const first = collectMisses(createBeatState(), 460, cues, loopMs);
  const second = collectMisses(first.state, 500, cues, loopMs);
  assert.deepEqual(first.missed, [0]);
  assert.deepEqual(second.missed, []);
});

test("a wave reaches the hit line when its beat arrives", () => {
  const early = visibleCues(200, cues, loopMs, 1800);
  const due = visibleCues(2000, cues, loopMs, 1800);
  assert.ok(early.find(cue => cue.time === 2000).progress < 0.1);
  assert.ok(Math.abs(due.find(cue => cue.time === 2000).progress - 1) < 0.001);
});

test("timer bars reach the flick line and name how close they are", () => {
  const due = timerBars(2000, cues, loopMs, 1800).find(bar => bar.time === 2000);
  const close = timerBars(1730, cues, loopMs, 1800).find(bar => bar.time === 2000);
  const waiting = timerBars(1000, cues, loopMs, 1800).find(bar => bar.time === 2000);
  assert.equal(due.zone, "perfect");
  assert.equal(due.left, 86);
  assert.equal(close.zone, "good");
  assert.equal(waiting.zone, "wait");
  assert.ok(waiting.left < close.left);
});
