import test from "node:test";
import assert from "node:assert/strict";
import { MixAudioEngine } from "../audio.js";
import { createMainstageHype, hypeTier } from "./mainstageHype.js";

const playing = { deck: "a", tempo: 126, beatOffsetMs: 95, playbackRate: 1, playing: true };

function settle(hype, playback, seconds = 2) {
  let frame;
  for (let i = 0; i < seconds * 20; i += 1) frame = hype.frame(playback, 0.05);
  return frame;
}

function flick(hype, positionMs, armsUp = 1, overrides = {}) {
  hype.awardFlick({ ...playing, positionMs, ...overrides }, { flickAt: 1000, metrics: { armsUp } }, 1000);
}

test("MAINSTAGE starts at 60 percent and 75 is the top of the third tier", () => {
  const initial = createMainstageHype().frame(null, 0.05);
  assert.equal(initial.level, 60);
  assert.equal(initial.tier, 2);
  assert.deepEqual([0, 24.9, 25, 49.9, 50, 75, 75.01, 100].map(hypeTier), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test("cue timing follows song offset and exact tempo, and a scored cue pays once", () => {
  const hype = createMainstageHype();
  const exactTempo = { ...playing, tempo: 125.5, positionMs: 95 };
  const initial = hype.frame(exactTempo, 0.05);
  assert.equal(initial.tempo, 125.5);
  assert.equal(initial.beat, 0);
  assert.equal(initial.bars[0].zone, "perfect");
  flick(hype, 95 + 120000 / 125.5, 1, { tempo: 125.5 });
  flick(hype, 105 + 120000 / 125.5, 1, { tempo: 125.5 });
  assert.equal(settle(hype, { ...exactTempo, positionMs: 105 + 120000 / 125.5 }).level, 68);
});

test("hype drains smoothly only after two missed cues and pauses with the song", () => {
  const hype = createMainstageHype();
  const at = offset => ({ ...playing, positionMs: 95 + offset });
  const frameAt = offset => hype.frame(at(offset), 0.05);
  assert.equal(frameAt(0).level, 60);
  assert.equal(frameAt(500).level, 60);
  assert.equal(frameAt(1000).level, 60);
  assert.equal(frameAt(1400).level, 60); // second cue is still being judged
  const start = frameAt(1450).level;
  const lower = settle(hype, at(1500), 0.25).level;
  assert.ok(lower < start && lower > 59);
  assert.equal(settle(hype, { ...at(1500), playing: false }).level, lower);

  const thirdCue = 240000 / playing.tempo;
  flick(hype, 95 + thirdCue);
  const rising = frameAt(thirdCue).level;
  assert.ok(rising > lower);
  assert.ok(settle(hype, at(thirdCue + 500)).level > 67);
});

test("seeking during a drain starts a fresh streak of eligible cues", () => {
  const hype = createMainstageHype();
  for (let positionMs = 95; positionMs <= 1645; positionMs += 50) {
    hype.frame({ ...playing, positionMs }, 0.05);
  }
  const seek = { ...playing, positionMs: 20095 };
  const before = hype.frame(seek, 0.05).level;
  const after = settle(hype, seek).level;
  assert.equal(settle(hype, seek).level, after);
  assert.ok(before - after < 0.5);
});

test("confetti holds full hype once for four seconds and then settles at exactly 75", () => {
  const hype = createMainstageHype();
  const beatMs = 120000 / playing.tempo;
  for (let i = 0; i < 5; i += 1) flick(hype, 95 + i * beatMs);
  const current = { ...playing, positionMs: 95 + 4 * beatMs };
  let frame = hype.frame(current, 0.05);
  for (let i = 0; i < 60 && !frame.celebration; i += 1) frame = hype.frame(current, 0.05);
  assert.equal(frame.level, 100);
  assert.deepEqual(frame.celebration, { id: 1, elapsed: 0, duration: 4 });

  flick(hype, 95 + 5 * beatMs, 2);
  frame = settle(hype, current, 3.5);
  assert.equal(frame.level, 100);
  assert.equal(frame.celebration.id, 1);
  frame = settle(hype, current, 0.75);
  assert.equal(frame.celebration, null);
  assert.ok(frame.level < 100 && frame.level > 75);
  frame = settle(hype, current, 2);
  assert.equal(frame.level, 75);
  assert.equal(frame.tier, 2);

  for (let i = 6; i < 9; i += 1) flick(hype, 95 + i * beatMs, 2);
  assert.equal(settle(hype, { ...current, positionMs: 95 + 8 * beatMs }).celebration.id, 2);
});

test("the audio clock stays anchored to its current deck until that deck stops", () => {
  const fake = {
    timingDeck: "a",
    context: { state: "running" },
    players: {
      a: { paused: false, ended: false, seeking: false, currentTime: 12, readyState: 4, playbackRate: 1 },
      b: { paused: false, ended: false, seeking: false, currentTime: 2, readyState: 4, playbackRate: 1 },
    },
    isPlaying: MixAudioEngine.prototype.isPlaying,
  };
  const read = () => MixAudioEngine.prototype.playbackPosition.call(fake);
  assert.equal(read().positionMs, 12000);
  fake.players.a.paused = true;
  assert.equal(read().deck, "b");
  fake.players.a.paused = false;
  fake.players.b.seeking = true;
  assert.equal(read().deck, "b");
  assert.equal(read().playing, false);
});

test("without a camera, deck hits and fades build hype and only repeated deck misses start a drain", () => {
  const hype = createMainstageHype();
  const clock = { ...playing, positionMs: 2000 };
  function settleDeck(seconds = 2) {
    for (let i = 0; i < seconds * 20; i++) hype.frame(clock, 0.05, { danceEnabled: false });
    return hype.scoreState().level;
  }
  assert.equal(settleDeck(), 60);
  hype.awardDeck("perfect");
  hype.awardDeck("good");
  hype.awardDeck("fade");
  assert.equal(settleDeck(), 77);
  hype.awardDeck("miss");
  assert.equal(settleDeck(), 77);
  hype.awardDeck("miss");
  assert.ok(settleDeck(1) < 76);
  hype.awardDeck("perfect");
  assert.ok(Math.abs(settleDeck() - 80) < 1e-9);
  for (let i = 0; i < 4; i++) hype.awardDeck("perfect");
  assert.equal(settleDeck(), 100);
  assert.equal(hype.scoreState().celebration.duration, 4);
});
