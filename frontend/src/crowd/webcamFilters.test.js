import test from "node:test";
import assert from "node:assert/strict";
import { getHeadTransform, getNeckTransform } from "./webcamFilters.js";

const view = { width: 392, height: 221, drawWidth: 392, drawHeight: 294, left: 0, top: -36.5 };
const points = {
  leftEye: { x: 0.31, y: 0.35 },
  rightEye: { x: 0.39, y: 0.38 },
  nose: { x: 0.36, y: 0.4 },
};

test("accessories follow the webcam crop and mirror without flipping the artwork", () => {
  const head = getHeadTransform(points, view);
  const selfie = getHeadTransform(points, { ...view, mirror: true });
  assert.ok(Math.abs(head.y - (view.top + 0.365 * view.drawHeight)) < 1e-9);
  assert.ok(Math.abs(head.x + selfie.x - view.width) < 1e-9);
  assert.ok(Math.abs(head.angle + selfie.angle) < 1e-9);
  assert.ok(Math.abs(head.turn + selfie.turn) < 1e-9);
  assert.ok(Math.abs(head.width - selfie.width) < 1e-9);
});

test("accessories hide when eye landmarks are missing or unreliable", () => {
  assert.equal(getHeadTransform(null, view), null);
  assert.equal(getHeadTransform({ ...points, leftEye: { ...points.leftEye, visibility: 0.2 } }, view), null);
  assert.equal(getHeadTransform({ ...points, leftEye: points.rightEye }, view), null);
});

test("the chain follows the shoulders through the camera crop and selfie mirror", () => {
  const shoulders = {
    leftShoulder: { x: 0.24, y: 0.65 },
    rightShoulder: { x: 0.53, y: 0.71 },
  };
  const neck = getNeckTransform(shoulders, view);
  const selfie = getNeckTransform(shoulders, { ...view, mirror: true });
  assert.ok(Math.abs(neck.x + selfie.x - view.width) < 1e-9);
  assert.ok(Math.abs(neck.angle + selfie.angle) < 1e-9);
  assert.ok(Math.abs(neck.width - selfie.width) < 1e-9);
  assert.equal(getNeckTransform({ ...shoulders, rightShoulder: null }, view), null);
});
