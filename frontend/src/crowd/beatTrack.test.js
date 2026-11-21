import test from "node:test";
import assert from "node:assert/strict";
import { chartForBpm } from "./beatTrack.js";

test("the beat chart follows the selected tempo", () => {
  const slow = chartForBpm(60);
  const fast = chartForBpm(120);
  assert.equal(slow.cues[1] - slow.cues[0], 2000);
  assert.equal(fast.cues[1] - fast.cues[0], 1000);
  assert.equal(chartForBpm(20).bpm, 60);
  assert.equal(chartForBpm(240).bpm, 180);
});
