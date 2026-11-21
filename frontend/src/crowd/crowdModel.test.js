import test from "node:test";
import assert from "node:assert/strict";
import { advanceCrowdMeter, createCrowdMeter, crowdMood, crowdRateForBeat, smoothToward, updateCrowdHappiness } from "./crowdModel.js";

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

test("perfects and goods raise the meter and misses lower it", () => {
  assert.equal(crowdRateForBeat("perfect"), 8);
  assert.equal(crowdRateForBeat("good"), 2);
  assert.equal(crowdRateForBeat("perfect", true), 12);
  assert.equal(crowdRateForBeat("miss", false, 1), -1.25);
  assert.equal(crowdRateForBeat("miss", true, 2), -9);
  assert.equal(crowdRateForBeat("miss", false, 3), -9);
});

test("two misses drive a much stronger drop without jumping the meter", () => {
  const start = createCrowdMeter(50);
  const firstMiss = crowdRateForBeat("miss", false, 1);
  const repeatedMiss = crowdRateForBeat("miss", false, 2);
  const firstFrame = advanceCrowdMeter(start, 1 / 60, repeatedMiss);
  assert.ok(firstFrame.level < start.level && start.level - firstFrame.level < 0.02);

  let gentle = start;
  let stronger = start;
  for (let frame = 0; frame < 60; frame += 1) {
    gentle = advanceCrowdMeter(gentle, 1 / 60, firstMiss);
    stronger = advanceCrowdMeter(stronger, 1 / 60, repeatedMiss);
  }
  assert.ok(start.level - gentle.level < 1.25);
  assert.ok(start.level - stronger.level > 7);
});

test("the meter rises gradually and changes direction smoothly after a miss", () => {
  const start = createCrowdMeter(24);
  const rise = crowdRateForBeat("perfect");
  const fall = crowdRateForBeat("miss");
  assert.equal(advanceCrowdMeter(start, 0.1, 0), start);
  const first = advanceCrowdMeter(start, 1 / 60, rise);
  assert.ok(first.level > 24 && first.level < 24.01);
  let meter = first;
  for (let frame = 0; frame < 60; frame += 1) {
    const next = advanceCrowdMeter(meter, 1 / 60, rise);
    assert.ok(next.level > meter.level && next.level - meter.level <= rise / 60);
    meter = next;
  }
  const switching = advanceCrowdMeter(meter, 1 / 60, fall);
  assert.ok(switching.velocity < 0 && switching.velocity > fall);
  assert.ok(switching.level < meter.level && meter.level - switching.level < 0.01);
  meter = switching;
  for (let frame = 0; frame < 50; frame += 1) meter = advanceCrowdMeter(meter, 1 / 60, fall);
  assert.ok(meter.level < switching.level);
  assert.ok(meter.velocity < 0);
  assert.ok(advanceCrowdMeter(meter, 1 / 60, rise).level > meter.level);
});

test("after a hit the meter settles and holds without dropping", () => {
  let meter = advanceCrowdMeter(createCrowdMeter(24), 0.25, crowdRateForBeat("perfect"));
  for (let frame = 0; frame < 120; frame += 1) {
    const next = advanceCrowdMeter(meter, 1 / 60, 0);
    assert.ok(next.level >= meter.level);
    meter = next;
  }
  assert.equal(meter.velocity, 0);
  assert.equal(advanceCrowdMeter(meter, 1 / 60, 0), meter);
});

test("meter movement matches across frame rates and clamps cleanly at both ends", () => {
  function simulate(fps) {
    let meter = createCrowdMeter(50);
    for (const rate of [4, -5, 2]) {
      for (let i = 0; i < fps; i += 1) meter = advanceCrowdMeter(meter, 1 / fps, rate);
    }
    return meter;
  }
  const at30 = simulate(30);
  const at144 = simulate(144);
  assert.ok(Math.abs(at30.level - at144.level) < 1e-10);
  assert.ok(Math.abs(at30.velocity - at144.velocity) < 1e-10);

  const bottom = createCrowdMeter(0);
  assert.equal(advanceCrowdMeter(bottom, 0.25, -5), bottom);
  assert.ok(advanceCrowdMeter(bottom, 0.1, 4).level > 0);
  const full = createCrowdMeter(100);
  assert.equal(advanceCrowdMeter(full, 0.25, 4), full);
  assert.ok(advanceCrowdMeter(full, 0.1, -5).level < 100);
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
