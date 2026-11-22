import assert from "node:assert/strict";
import test from "node:test";
import { createMenuMusic } from "./menuMusic.js";

function setup() {
  const audio = Object.assign(new EventTarget(), {
    currentTime: 0,
    paused: true,
    volume: 0.4,
    playCount: 0,
    play() {
      this.playCount++;
      this.paused = false;
      return Promise.resolve();
    },
    pause() { this.paused = true; },
  });
  let callback;
  const menu = createMenuMusic(audio, {
    requestFrame(next) { callback = next; return 1; },
    cancelFrame() { callback = undefined; },
  });
  return { audio, menu, playing: () => audio.dispatchEvent(new Event("playing")),
    runFrame: now => callback?.(now) };
}

test("previews pause and resume the menu soundtrack at the same position", () => {
  const { audio, menu, playing, runFrame } = setup();
  menu.setBrowsing(true);
  playing();
  runFrame(0);
  runFrame(1600);
  assert.equal(audio.volume, 0.4);
  audio.currentTime = 12;
  menu.setPreviewing(true);
  menu.play();
  menu.setPreviewing(true);
  assert.equal(audio.paused, true);
  assert.equal(audio.playCount, 1);
  menu.setPreviewing(false);
  playing();
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 12);
  assert.equal(audio.volume, 0.4);
});

test("loading resets the soundtrack and late preview events cannot restart it", () => {
  const { audio, menu, playing, runFrame } = setup();
  menu.setBrowsing(true);
  playing();
  runFrame(0);
  runFrame(800);
  assert.equal(audio.volume, 0.1);
  audio.currentTime = 20;
  menu.setPreviewing(true);
  menu.setBrowsing(false);
  menu.setPreviewing(false);
  menu.play();
  playing();
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.playCount, 1);

  menu.setBrowsing(true);
  playing();
  runFrame(0);
  assert.equal(audio.volume, 0);
  runFrame(800);
  assert.equal(audio.volume, 0.1);
  runFrame(1600);
  assert.equal(audio.volume, 0.4);
  assert.equal(audio.playCount, 2);
});
