import test from "node:test";
import assert from "node:assert/strict";
import { createBeatState, judgeArmFlick, skippedCueDeadline, timerBars, timerWindow, visibleCues } from "./beatJudge.js";
import { chartForBpm } from "./beatTrack.js";

const cues = [0, 2000];
const loopMs = 8000;

test("a cue can be scored only once and repeat movement leaves its result alone", () => {
  const first = judgeArmFlick(createBeatState(), 40, cues, loopMs);
  const duplicate = judgeArmFlick(first.state, 70, cues, loopMs);
  assert.equal(first.judgment, "perfect");
  assert.equal(duplicate.judgment, null);
  assert.equal(duplicate.noteTime, null);
});

test("good exists only before the yellow hit window", () => {
  const cases = [
    [-481, "miss"], [-480, "good"], [-261, "good"], [-260, "perfect"],
    [0, "perfect"], [260, "perfect"], [261, "miss"], [480, "miss"],
  ];
  for (const [offset, judgment] of cases) {
    const result = judgeArmFlick(createBeatState(), 2000 + offset, cues, loopMs);
    assert.equal(result.judgment, judgment, `at timing offset ${offset}`);
    assert.equal(result.noteTime, judgment === "miss" ? null : 2000);
  }
});

test("a later movement can score a different live cue when windows overlap", () => {
  const closeCues = [1000, 1300];
  const result = judgeArmFlick(createBeatState(), 1000, closeCues, loopMs);
  const follow = judgeArmFlick(result.state, 1090, closeCues, loopMs);
  assert.equal(result.noteTime, 1000);
  assert.equal(result.judgment, "perfect");
  assert.equal(follow.judgment, "perfect");
  assert.equal(follow.noteTime, 1300);
});

test("an early miss leaves the upcoming cue available", () => {
  const result = judgeArmFlick(createBeatState(), 700, [2000], loopMs);
  const next = judgeArmFlick(result.state, 1700, [2000], loopMs);
  assert.equal(result.judgment, "miss");
  assert.equal(next.judgment, "good");
});

test("movement during the count-in gets no judgment until the first cue can score", () => {
  const state = createBeatState();
  assert.equal(judgeArmFlick(state, -1800, cues, loopMs).judgment, null);
  assert.equal(judgeArmFlick(state, -481, cues, loopMs).judgment, null);
  assert.equal(judgeArmFlick(state, -480, cues, loopMs).judgment, "good");
});

test("the skip penalty waits for the second missed cue and resets after a scored flick", () => {
  assert.equal(skippedCueDeadline(null, cues, loopMs), 2460);
  const firstHit = judgeArmFlick(createBeatState(), 0, cues, loopMs);
  assert.equal(skippedCueDeadline(firstHit.noteTime, cues, loopMs), 8460);
  const secondHit = judgeArmFlick(firstHit.state, 2000, cues, loopMs);
  assert.equal(skippedCueDeadline(secondHit.noteTime, cues, loopMs), 10460);
});

for (const bpm of [104, 180]) {
  test(`separate movements can hit consecutive cues at ${bpm} BPM`, () => {
    const chart = chartForBpm(bpm);
    const [firstCue, secondCue] = chart.cues;
    const first = judgeArmFlick(createBeatState(), firstCue + 240, chart.cues, chart.loopMs);
    const second = judgeArmFlick(first.state, secondCue - 300, chart.cues, chart.loopMs);
    assert.equal(first.judgment, "perfect");
    assert.equal(second.judgment, "good");
    assert.equal(second.noteTime, secondCue);
    assert.equal(judgeArmFlick(second.state, secondCue - 280, chart.cues, chart.loopMs).judgment, null);
  });
}

test("a cue reaches the line at the beat and disappears after the yellow window", () => {
  const early = visibleCues(200, cues, loopMs, 1800);
  const due = visibleCues(2000, cues, loopMs, 1800);
  const expired = visibleCues(2261, cues, loopMs, 1800);
  assert.ok(early.find(cue => cue.time === 2000).progress < 0.1);
  assert.equal(due.find(cue => cue.time === 2000).progress, 1);
  assert.equal(expired.some(cue => cue.time === 2000), false);
});

test("the visible timing zones match the scoring windows", () => {
  const lead = 1800;
  const due = timerBars(2000, cues, loopMs, lead).find(bar => bar.time === 2000);
  const early = timerBars(1530, cues, loopMs, lead).find(bar => bar.time === 2000);
  const waiting = timerBars(1000, cues, loopMs, lead).find(bar => bar.time === 2000);
  const goodWindow = timerWindow(480, 260, lead);
  const yellowWindow = timerWindow(260, -260, lead);
  assert.equal(due.zone, "perfect");
  assert.equal(due.left, 86);
  assert.equal(early.zone, "good");
  assert.equal(waiting.zone, "wait");
  assert.ok(early.left >= goodWindow.left && early.left < yellowWindow.left);
  assert.ok(Math.abs(goodWindow.left + goodWindow.width - yellowWindow.left) < 1e-10);
});
