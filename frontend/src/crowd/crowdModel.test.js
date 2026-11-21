import test from "node:test";
import assert from "node:assert/strict";
import { applyBeatResult, beatPoints, crowdMood, decayCrowd, smoothToward, updateCrowdHappiness } from "./crowdModel.js";

test("continuous dancing raises crowd happiness slowly", () => {
  let next = 20;
  for (let frame = 0; frame < 4; frame += 1) {
    next = updateCrowdHappiness(next, { detected: true, score: 0.9 }, 0.25);
  }
  assert.ok(next > 22 && next < 32, `one second reached ${next}`);
  for (let frame = 0; frame < 16; frame += 1) {
    next = updateCrowdHappiness(next, { detected: true, score: 0.9 }, 0.25);
  }
  assert.ok(next > 55, `five seconds reached ${next}`);
});

test("weak movement slowly loses crowd happiness", () => {
  const next = updateCrowdHappiness(50, { detected: true, score: 0.05 }, 1);
  assert.ok(next < 50);
  assert.ok(next > 38);
});

test("anything other than qualifying movement lowers the bar", () => {
  const missed = updateCrowdHappiness(42, { detected: false, score: 0 }, 1);
  const still = updateCrowdHappiness(42, { detected: true, score: 0 }, 1);
  assert.ok(missed < 42 && still < 42);
  assert.equal(updateCrowdHappiness(42, { detected: true, score: 1, bonus: 14 }, 0.1), updateCrowdHappiness(42, { detected: true, score: 1 }, 0.1));
  assert.equal(updateCrowdHappiness(42, { detected: true, score: 1 }, 1, false), 42);
});

test("happiness remains between zero and one hundred", () => {
  assert.equal(updateCrowdHappiness(99, { detected: true, score: 1 }, 10), 100);
  assert.equal(updateCrowdHappiness(1, { detected: true, score: 0 }, 10), 0);
});

test("on-beat arm flicks raise the bar by timing and everything else lowers it", () => {
  assert.ok(applyBeatResult(20, "perfect") > applyBeatResult(20, "good"));
  assert.equal(applyBeatResult(20, "perfect"), 30);
  assert.equal(applyBeatResult(20, "good"), 25);
  assert.equal(applyBeatResult(20, "miss"), 20);
  assert.ok(applyBeatResult(20, "offbeat") < 20);
  assert.equal(beatPoints("perfect", true), 15);
  assert.equal(beatPoints("good", true), 7.5);
  assert.equal(applyBeatResult(20, "perfect", true), 35);
  assert.equal(applyBeatResult(20, "good", true), 27.5);
  assert.equal(applyBeatResult(20, "miss", true), 20);
  assert.ok(decayCrowd(20, 1) < 20);
});

test("the displayed bar eases toward the score without overshooting", () => {
  const halfway = smoothToward(20, 40, 0.35);
  assert.ok(halfway > 20 && halfway < 40, `moved to ${halfway}`);
  assert.equal(smoothToward(20, 40, 0), 20);
  let eased = 20;
  for (let step = 0; step < 12; step += 1) eased = smoothToward(eased, 40, 0.25);
  assert.ok(eased > 39 && eased <= 40, `settled at ${eased}`);
});

test("mood tiers have stable player-facing labels", () => {
  assert.equal(crowdMood(10).label, "MOVE MORE");
  assert.equal(crowdMood(75).label, "HYPE");
  assert.equal(crowdMood(95).label, "CROWD GOING WILD");
  assert.equal(crowdMood(95, false).label, "FIND YOUR POSE");
});
