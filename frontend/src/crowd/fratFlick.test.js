import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFratFlick, createFratState, isFratShape } from "./fratFlick.js";
import { updateCrowdHappiness } from "./crowdModel.js";

function hand(indexTip) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.3, z: 0 }));
  const set = (index, x, y) => { points[index] = { x, y, z: 0 }; };
  set(0, 0.3, 0.3);
  set(5, 0.4, 0.24);
  set(8, indexTip[0], indexTip[1]);
  set(9, 0.36, 0.28);
  set(12, 0.34, 0.33);
  set(13, 0.33, 0.3);
  set(16, 0.32, 0.34);
  set(17, 0.3, 0.32);
  set(20, 0.29, 0.35);
  return points;
}

function pose(wristY = 0.3) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.6, visibility: 1, presence: 1 }));
  points[11] = { x: 0.42, y: 0.48, visibility: 1, presence: 1 };
  points[12] = { x: 0.62, y: 0.48, visibility: 1, presence: 1 };
  points[15] = { x: 0.3, y: wristY, visibility: 1, presence: 1 };
  points[16] = { x: 0.7, y: 0.72, visibility: 1, presence: 1 };
  return points;
}

function run(tips, wristY = 0.3) {
  let state = createFratState();
  return tips.map((tip, index) => {
    const result = analyzeFratFlick(pose(wristY), [hand(tip)], index * 70, state);
    state = result.state;
    return result;
  });
}

test("the pointed index shape is recognized and an open hand is not", () => {
  assert.equal(isFratShape(hand([0.56, 0.12])), true);
  const open = hand([0.56, 0.12]);
  open[12] = { x: 0.52, y: 0.1, z: 0 };
  open[16] = { x: 0.48, y: 0.1, z: 0 };
  open[20] = { x: 0.44, y: 0.12, z: 0 };
  assert.equal(isFratShape(open), false);
});

test("holding the frat shape still does not count as a flick", () => {
  const results = run([[0.56, 0.12], [0.56, 0.12], [0.56, 0.12], [0.56, 0.12]]);
  assert.equal(results.some(result => result.flick), false);
});

test("one raised hand snapping its index finger counts as a frat flick", () => {
  const results = run([[0.56, 0.12], [0.5, 0.02], [0.58, 0.2]]);
  assert.equal(results.filter(result => result.flick).length, 1);
});

test("the same finger snap below the shoulder does not count", () => {
  const results = run([[0.56, 0.12], [0.5, 0.02], [0.58, 0.2]], 0.7);
  assert.equal(results.some(result => result.flick), false);
});

test("a finger flick adds no points beyond the arm movement itself", () => {
  const moved = updateCrowdHappiness(20, { detected: true, score: 0.6 }, 0.1);
  const flicked = updateCrowdHappiness(20, { detected: true, score: 0.6, bonus: 14 }, 0.1);
  assert.equal(flicked, moved);
});
