import test from "node:test";
import assert from "node:assert/strict";
import { createArmFlickState, detectArmFlick } from "./armFlick.js";

test("ordinary arm motion and pumps are never accepted as flicks", () => {
  const result = detectArmFlick(createArmFlickState(), { leftPump: true }, 100);
  assert.equal(result.flick, false);
});

test("a two-arm flick is accepted once even if the frame is repeated", () => {
  const gestures = { leftFlick: true, rightFlick: true };
  const first = detectArmFlick(createArmFlickState(), gestures, 100);
  const repeated = detectArmFlick(first.state, gestures, 100);
  assert.equal(first.flick, true);
  assert.equal(repeated.flick, false);
});

test("a slightly staggered second arm is ignored but the next distinct flick is accepted", () => {
  const first = detectArmFlick(createArmFlickState(), { leftFlick: true }, 100);
  const staggered = detectArmFlick(first.state, { rightFlick: true }, 230);
  const next = detectArmFlick(staggered.state, { rightFlick: true }, 270);
  assert.equal(staggered.flick, false);
  assert.equal(next.flick, true);
});
