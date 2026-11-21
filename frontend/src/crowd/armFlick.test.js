import test from "node:test";
import assert from "node:assert/strict";
import { createArmFlickState, detectArmFlick } from "./armFlick.js";

test("a still or lowered arm does not create a flick", () => {
  let state = createArmFlickState();
  for (const level of [0, 0.03, 0.06]) {
    const result = detectArmFlick(state, level, 100);
    state = result.state;
    assert.equal(result.flick, false);
  }
});

test("a smaller above-shoulder snap still counts as a flick", () => {
  const result = detectArmFlick(createArmFlickState(), 0.12, 100);
  assert.equal(result.flick, true);
});

test("one above-shoulder burst creates one flick until the arm settles", () => {
  const first = detectArmFlick(createArmFlickState(), 0.7, 100);
  const held = detectArmFlick(first.state, 0.8, 220);
  const tooSoon = detectArmFlick({ ...held.state, ready: false }, 0.05, 300);
  const again = detectArmFlick(held.state, 0.05, 500);
  const next = detectArmFlick(again.state, 0.7, 560);
  assert.equal(first.flick, true);
  assert.equal(held.flick, false);
  assert.equal(tooSoon.flick, false);
  assert.equal(again.flick, false);
  assert.equal(next.flick, true);
});
