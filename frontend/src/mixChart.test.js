import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { buildMixChart } from "./mixChart.js";
import { createMixSession } from "./mixSession.js";

const asset = path => readFileSync(new URL("../public/" + path, import.meta.url), "utf8");
const manifest = JSON.parse(asset("mixes/mix1/tracks.json"));
const recording = JSON.parse(asset(manifest.recording.slice(1)));
const chart = buildMixChart(recording, manifest);

test("the first turn and forecast are anchored to the calibrated reference recording", () => {
  const first = chart.notes[0];
  assert.deepEqual([first.channel, first.row, first.dir], [1, "LOW", "ccw"]);
  assert.ok(Math.abs(first.time - 7.1362) < 0.001);
  assert.ok(Math.abs(first.degrees - first.startPosition * 180) < 0.001);
  assert.deepEqual(chart.tracesAt(first.time - 4.01)["1:LOW"].changes, []);
  const trace = chart.tracesAt(first.time - 3)["1:LOW"];
  assert.equal(trace.position, chart.valuesAt(first.time - 3)["a.low"] / 16383);
  assert.ok(Math.abs(trace.changes[0].fraction - 0.75) < 1e-10);
  assert.equal(trace.changes.at(-1).position, chart.valuesAt(first.time + 1)["a.low"] / 16383);
  assert.deepEqual(chart.tracesAt(10)["1:LOW"], { position: 0, changes: [] });
  assert.ok(chart.notes.every((n, i) => n.time < chart.duration && (!i || n.time >= chart.notes[i - 1].time)));
  assert.equal(chart.valuesAt(54)["mixer.crossfade"], 0);
});

test("each forecast matches the recording at the playhead and throughout the four-second window", () => {
  for (const selection of ["mix1", "heroes", "levels"]) {
    const data = buildMixChart(recording, manifest, selection);
    for (let time = 0; time < data.duration; time += 0.673) {
      for (const [lane, trace] of Object.entries(data.tracesAt(time))) {
        const [channel, row] = lane.split(":");
        const control = (channel === "1" ? "a." : "b.") + (row === "HI" ? "high" : row.toLowerCase());
        for (const ahead of [0, 0.019, 0.111, 1.59, 4]) {
          const latest = trace.changes.findLast(change => change.fraction <= ahead / 4 + 1e-12);
          const expected = data.valuesAt(time + ahead)[control] / 16383;
          assert.equal(latest?.position ?? trace.position, expected, selection + " " + lane + " at " + (time + ahead));
        }
      }
    }
  }
});

test("the guide drops vertically onto the knob pointer throughout its upper semicircle", () => {
  const window = {};
  runInNewContext(asset("mainstage/components/bundle.js"), { window });
  const { makeLayout, NoteLanes, Deck } = window.FLXHero;
  const layout = makeLayout({ rows: ["LOW"] }), lane = layout.lanes[1].LOW;
  const paths = [];
  let path;
  const ctx = { save() {}, restore() {}, fill() {}, stroke() {}, fillText() {}, closePath() {},
    beginPath() { path = []; paths.push(path); },
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); } };
  for (const position of [0, 0.25, 0.5, 0.75, 1]) {
    paths.length = 0;
    const nextPosition = 1 - position;
    const traces = { "1:LOW": { position, changes: [{ fraction: 0.5, position: nextPosition }] } };
    NoteLanes.drawGuides(ctx, layout, {}, traces);
    const start = paths[0][0];
    const angle = (position - 0.5) * Math.PI;
    assert.equal(start[0], lane.x + Math.sin(angle) * lane.pointerRadius);
    assert.deepEqual(paths[0].at(-1), [lane.x + Math.sin(-angle) * lane.pointerRadius, layout.spawnY]);
    const knobs = { "1:LOW": { angle } };
    assert.equal(paths[0][1][0], start[0]);
    Deck.drawOverlay(ctx, layout, knobs);
    const pointer = paths.find(p => p.length === 2 && p[0][0] === lane.x && p[0][1] === lane.hitY);
    assert.deepEqual(start, pointer[1]);
    if (position === 0 || position === 1) assert.equal(pointer[1][1], lane.hitY);
    else assert.ok(pointer[1][1] < lane.hitY);
  }
});

test("the jog arrows point and travel counterclockwise on A and clockwise on B, including before play", () => {
  const window = {};
  runInNewContext(asset("mainstage/components/bundle.js"), { window });
  const { Deck, makeLayout } = window.FLXHero;
  const layout = makeLayout();
  function firstArrow(deck, remaining, clock, reduced = false) {
    const triangles = [];
    let path;
    const ctx = { save() {}, restore() {}, translate() {}, scale() {}, fillRect() {}, strokeRect() {},
      fillText() {}, strokeText() {}, fill() {}, stroke() {}, measureText: () => ({ width: 150 }),
      beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
      closePath() { if (path.length === 3) triangles.push(path); } };
    Deck.drawJogCue(ctx, layout, { deck, remaining, lead: 3 }, 60 / 126, reduced, clock);
    return triangles[0];
  }
  for (const [deck, direction] of [["a", -1], ["b", 1]]) {
    for (const remaining of [0, 2]) {
      const [tip, side1, side2] = firstArrow(deck, remaining, 0);
      const [nextTip] = firstArrow(deck, remaining, 0.05);
      assert.equal(Math.sign(tip[0] - (side1[0] + side2[0]) / 2), direction);
      assert.equal(Math.sign(nextTip[0] - tip[0]), direction);
      assert.deepEqual(firstArrow(deck, remaining, 1, true), firstArrow(deck, remaining, 0, true));
    }
  }
});

test("signals drop on ten persistent guides that end at their projected knobs", () => {
  const window = {};
  runInNewContext(asset("mainstage/components/bundle.js"), { window });
  const api = window.FLXHero, layout = api.makeLayout(), paths = [];
  let path;
  const ctx = { save() {}, restore() {}, stroke() {}, beginPath() { path = []; paths.push(path); },
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); } };
  api.NoteLanes.drawGuides(ctx, layout, {}, {});
  assert.equal(paths.length, 10);
  assert.equal(new Set(paths.map(p => p[0][0])).size, 10);
  for (const [i, row] of layout.rows.entries()) {
    for (const channel of [1, 2]) {
      const projected = layout.P(layout.flat.knobX[channel][row], layout.flat.rowY[row]);
      const p = paths[i * 2 + channel - 1];
      assert.deepEqual(p[0], [projected.x, projected.y - layout.knobH * projected.s]);
      assert.deepEqual(p.at(-1), [projected.x, layout.spawnY]);
    }
  }
});

function setup(selection = "mix1", options = {}, customRecording) {
  const player = () => ({ currentTime: 0, paused: true, ended: false, readyState: 4, pause() { this.paused = true; } });
  const players = { a: player(), b: player() }, starts = [], mixes = [], judgments = [], states = [];
  const engine = { players, audioFrame: () => ({}), update: values => mixes.push(values),
    pause: deck => players[deck].pause(),
    async setPlaying(deck) { starts.push(deck); players[deck].paused = false; },
    stop() { for (const p of Object.values(players)) { p.pause(); p.currentTime = 0; } } };
  let turn;
  const view = { knob() {}, onTurn(fn) { turn = fn; return () => {}; }, showJudgment(j) { judgments.push(j); } };
  const data = buildMixChart(customRecording ?? recording,
    customRecording ? { ...manifest, cueOffsetMs: 0 } : manifest, selection);
  const session = createMixSession(data, selection, 126, {
    getAudio: () => engine, liveValues: () => ({}), onState: state => states.push(state), onError: assert.fail,
    ...options,
  });
  session.source.attach(view);
  session.attach(view);
  return { session, players, starts, states, mixes, judgments, frame: () => session.source.frame(50), turn, data };
}

test("the right platter countdown follows the calibrated Levels entry in play and preview", () => {
  const entry = chart.entry + 0.75 - 0.525;
  for (const preview of [false, true]) {
    const { session, players, frame } = setup("mix1", { getLevelsDelayMs: () => -525 });
    assert.equal(frame().jogCues[0].deck, "a");
    if (preview) session.preview(); else session.togglePlayback();
    players.a.currentTime = entry - 3.01;
    assert.deepEqual(frame().jogCues, []);
    for (const remaining of [2.99, 1.99, 0.99, 0]) {
      players.a.currentTime = entry - remaining;
      const [cue] = frame().jogCues;
      assert.equal(cue.deck, "b");
      assert.equal(Math.ceil(cue.remaining), Math.ceil(remaining));
      assert.equal(players.b.paused, remaining > 0);
    }
  }
});

test("live fader mirrors the player while preview and move targets use the selected recording", () => {
  const mix = { durationMs: 15000, events: [
    { t: 0, values: { "mixer.crossfade": 8192 } },
    { t: 10000, values: { "mixer.crossfade": 6500 } },
    { t: 10100, values: { "mixer.crossfade": 4900 } },
  ] };
  const live = { "mixer.crossfade": 100 };
  const { session, players, frame } = setup("mix1", { liveValues: () => live }, mix);
  assert.equal(frame().crossfade, 100);
  session.togglePlayback();
  players.a.currentTime = 8;
  assert.deepEqual(frame().crossfadeCue, { to: 4900 / 16383, ready: 0.5 });
  live["mixer.crossfade"] = 12000;
  assert.equal(frame().crossfade, 12000);
  session.stop();
  session.preview();
  players.a.currentTime = 10;
  assert.equal(frame().crossfade, 6500);
  players.a.currentTime = 11;
  assert.equal(frame().crossfade, 4900);
  assert.equal(frame().crossfadeCue, null);
});

test("a captured mix replays the recorded crossfader and manual Levels entry", () => {
  let captured;
  const live = setup("mix1", { onRecording: value => { captured = value; } });
  assert.equal(live.session.startRecording(), true);
  assert.deepEqual(live.starts, []);
  live.session.input("a", true, "midi");
  assert.deepEqual(live.starts, ["a"]);
  live.players.a.currentTime = 5;
  live.session.input("b", true, "midi");
  live.players.a.currentTime = 10;
  live.session.update({ "mixer.crossfade": 12000 });
  live.players.a.currentTime = 30;
  live.session.input("b", true);
  live.frame();
  const levelsPosition = live.players.b.currentTime;
  live.players.a.currentTime = 34;
  live.session.input("b", false, "midi");
  live.frame();
  live.players.a.currentTime = 38;
  live.session.stop();

  const saved = JSON.parse(JSON.stringify(captured));
  assert.deepEqual(saved.playButtonEvents, [
    { t: 0, deck: "a", source: "midi", requestedPlaying: true },
    { t: 5000, deck: "b", source: "midi", requestedPlaying: true },
    { t: 34000, deck: "b", source: "midi", requestedPlaying: false },
  ]);
  const replay = setup("mix1", { recordedLevels: saved.levelsEvents }, saved);
  replay.session.preview();
  replay.players.a.currentTime = 29;
  replay.frame();
  assert.deepEqual(replay.starts, ["a"]);
  assert.equal(replay.mixes.at(-1)["mixer.crossfade"], 12000);
  replay.players.a.currentTime = 30;
  replay.frame();
  assert.deepEqual(replay.starts, ["a", "b"]);
  assert.equal(replay.players.b.currentTime, levelsPosition);
  replay.players.a.currentTime = 34;
  replay.frame();
  assert.equal(replay.players.b.paused, true);
});

test("recording accepts an early right deck start and guided playback keeps the audio and dial cues on the recorded timeline", async () => {
  let saved;
  const live = setup("mix1", { onRecording: value => { saved = value; } });
  live.session.startRecording();
  live.session.input("a", true, "midi");
  live.players.a.currentTime = 2;
  live.session.input("b", true, "jog");
  await Promise.resolve();
  assert.deepEqual(live.starts, ["a", "b"]);
  live.players.a.currentTime = 3;
  live.players.b.currentTime = 1;
  live.session.recordMidi([0xb6, 0x1f, 0x5e]);
  live.session.update({ "mixer.crossfade": 12000, "a.volume": 10000, "a.low": 14000 });
  live.session.input("b", false, "midi");
  live.players.a.currentTime = 4;
  live.session.input("b", true, "midi");
  await Promise.resolve();
  live.players.a.currentTime = 5;
  live.session.stop();
  assert.deepEqual(saved.levelsEvents, [
    { t: 2000, position: 0 }, { t: 3000, position: null }, { t: 4000, position: 1 },
  ]);
  assert.deepEqual(saved.midiEvents, [[3000, 0xb6, 0x1f, 0x5e]]);

  const practice = setup("mix1", { recordedLevels: saved.levelsEvents }, saved);
  practice.session.practice();
  assert.deepEqual(practice.starts, []);
  assert.equal(practice.frame().jogCues[0].deck, "a");
  practice.session.input("a", true, "midi");
  assert.deepEqual(practice.starts, []);
  practice.session.input("a", true, "jog");
  assert.equal(practice.frame().jogCues.find(cue => cue.deck === "a").matched, true);
  practice.players.a.currentTime = 2;
  practice.session.input("b", true, "jog");
  assert.equal(practice.frame().jogCues.find(cue => cue.deck === "b").bonus, 300);
  assert.equal(practice.frame().guided, true);
  assert.deepEqual(practice.starts, ["a", "b"]);
  practice.players.a.currentTime = 3;
  const frame = practice.frame();
  assert.equal(practice.players.b.paused, true);
  assert.equal(frame.mixerGuide.target["a.volume"], 10000);
  assert.equal(practice.mixes.at(-1)["mixer.crossfade"], 12000);
  assert.ok(frame.notes.some(note => note.row === "LOW" && note.time === 3));
  practice.turn({ channel: 1, row: "LOW", dir: "cw" });
  assert.equal(practice.frame().score, 600);
  practice.players.a.currentTime = 4;
  assert.equal(practice.frame().jogCues.find(cue => cue.deck === "b").at, 4);
  assert.equal(practice.players.b.currentTime, 1);
});

test("recording and replay continue on the right deck after the left track ends", async () => {
  let saved;
  const live = setup("mix1", { onRecording: value => { saved = value; } });
  live.session.startRecording();
  live.session.input("a", true, "midi");
  live.players.a.currentTime = 2;
  live.session.input("b", true, "jog");
  await Promise.resolve();
  live.players.a.currentTime = 5;
  live.players.a.ended = true;
  live.players.b.currentTime = 3;
  assert.equal(live.frame().time, 5);
  live.players.b.currentTime = 4;
  live.session.update({ "mixer.crossfade": 14000 });
  live.session.stop();
  assert.equal(saved.durationMs, 6000);
  assert.equal(saved.events.at(-1).t, 6000);

  const replay = setup("mix1", { recordedLevels: saved.levelsEvents }, saved);
  replay.session.preview();
  replay.players.a.currentTime = 2;
  replay.frame();
  replay.players.a.currentTime = 5;
  replay.players.a.ended = true;
  replay.players.b.currentTime = 3.5;
  assert.equal(replay.frame().time, 5.5);
  assert.equal(replay.players.b.paused, false);
});

test("Levels offset nudges an already playing deck in real time and rewind replays its adjusted entry", async () => {
  let delayMs = 0;
  const { session, players, frame, data } = setup("mix1", { getLevelsDelayMs: () => delayMs });
  session.preview();
  const playhead = data.entry + 2;
  players.a.currentTime = playhead;
  frame();
  await Promise.resolve();
  assert.equal(players.b.currentTime, 1.25);

  delayMs = 25;
  session.updateLevelsOffset();
  assert.ok(Math.abs(players.b.currentTime - 1.225) < 1e-9);
  assert.equal(players.a.currentTime, playhead);

  session.rewind();
  assert.equal(players.a.currentTime, playhead - 5);
  assert.equal(players.a.paused, false);
  assert.equal(players.b.paused, true);
  assert.equal(players.b.currentTime, 0);
  players.a.currentTime = data.entry + 0.75;
  frame();
  assert.equal(players.b.paused, true);
  players.a.currentTime += 0.025;
  frame();
  assert.equal(players.b.paused, false);
  assert.ok(players.b.currentTime < 1e-9);
});

test("live play uses the −525 ms preview entry and blend without overriding scored dials", () => {
  const options = {
    getLevelsDelayMs: () => -525,
    liveValues: () => ({ "mixer.crossfade": 0, "b.volume": 0, "b.low": 9300 }),
  };
  const preview = setup("mix1", options);
  const live = setup("mix1", options);
  preview.session.preview();
  live.session.togglePlayback();
  const entry = live.data.entry + 0.75 - 0.525;
  for (const mix of [preview, live]) {
    mix.players.a.currentTime = entry - 0.001;
    mix.frame();
    assert.equal(mix.players.b.paused, true);
    mix.players.a.currentTime = entry;
    mix.frame();
    assert.equal(mix.players.b.paused, false);
    assert.equal(mix.players.b.currentTime, 0);
    mix.players.a.currentTime = entry + 0.2;
    mix.players.b.currentTime = 0.15;
    mix.frame();
    assert.ok(Math.abs(mix.players.b.currentTime - 0.2) < 1e-9);
  }
  live.session.update({ "mixer.crossfade": 0, "b.volume": 0, "b.low": 12000 });
  assert.equal(live.mixes.at(-1)["mixer.crossfade"], preview.mixes.at(-1)["mixer.crossfade"]);
  assert.equal(live.mixes.at(-1)["b.volume"], preview.mixes.at(-1)["b.volume"]);
  assert.equal(live.mixes.at(-1)["b.low"], 12000);
});

test("live cues follow the first deck media position through pauses and automatic Deck B entry", async () => {
  const { players, session, starts, frame, turn, judgments } = setup();
  session.input("b", true);
  assert.equal(frame().time, 0);
  assert.deepEqual(starts, []);
  session.input("a", true);
  await Promise.resolve();
  players.a.currentTime = chart.notes[0].time;
  session.input("a", false);
  assert.equal(frame().time, players.a.currentTime);
  turn({ channel: 1, row: "LOW", dir: "ccw" });
  assert.equal(judgments.length, 0);
  session.input("a", true);
  turn({ channel: 1, row: "LOW", dir: "ccw" });
  assert.equal(judgments[0].judgment, "perfect");
  for (const [time, secondsUntil] of [[20.034, null], [20.284, 3], [21.284, 2], [22.284, 1], [23.283, 0]]) {
    players.a.currentTime = time;
    const [cue] = frame().jogCues;
    assert.equal(cue ? Math.ceil(cue.remaining) : null, secondsUntil);
    assert.equal(players.b.paused, secondsUntil !== 0);
  }
  session.stop();
  assert.equal(frame().time, 0);
  assert.equal(frame().score, 0);
});

test("wheel frames follow each deck independently and freeze when paused", async () => {
  const { players, session, frame } = setup();
  session.input("a", true);
  await Promise.resolve();
  players.a.currentTime = 1.25;
  let game = frame();
  assert.deepEqual(game.wheels.a, { time: 1.25, playing: true });
  assert.deepEqual(game.wheels.b, { time: 0, playing: false });
  players.a.currentTime = chart.entry + 0.75;
  frame();
  game = frame();
  assert.deepEqual(game.wheels.b, { time: 0, playing: true });
  session.input("b", false, "midi");
  assert.deepEqual(frame().wheels.b, { time: 0, playing: true });
  session.togglePlayback();
  game = frame();
  assert.deepEqual(game.wheels.a, { time: chart.entry + 0.75, playing: false });
  assert.deepEqual(game.wheels.b, { time: 0, playing: false });
});

test("Deck B enters at the preview's −525 ms offset and an optional spin adds points without changing the combo", () => {
  const oneDialCue = {
    durationMs: 30000,
    events: [{ t: 0, values: { "a.low": 8000 } }, { t: 21000, values: { "a.low": 12000 } }],
  };
  for (const [spinOffset, points] of [[-1, 0], [-0.22, 100], [0.08, 300], [0.5, 0], [null, 0]]) {
    const { players, session, frame, starts, data, turn } = setup("mix1", { getLevelsDelayMs: () => -525 }, oneDialCue);
    const entry = data.entry + 0.75 - 0.525;
    session.togglePlayback();
    players.a.currentTime = 21;
    turn({ channel: 1, row: "LOW", dir: "cw" });
    assert.equal(frame().combo, 1);
    const spin = (offset) => {
      players.a.currentTime = entry + offset;
      session.input("b", true, "jog");
    };
    if (spinOffset !== null && spinOffset < 0) spin(spinOffset);
    assert.deepEqual(starts, ["a"]);
    players.a.currentTime = entry - 0.01;
    frame();
    assert.equal(players.b.paused, true);
    players.a.currentTime = entry;
    frame();
    assert.deepEqual(starts, ["a", "b"]);
    assert.equal(players.b.currentTime, 0);
    if (spinOffset !== null && spinOffset >= 0) spin(spinOffset);
    players.a.currentTime = entry + 0.6;
    const resolved = frame();
    assert.equal(resolved.jogCues[0]?.bonus ?? 0, points);
    assert.equal(resolved.score, 300 + points);
    assert.equal(resolved.combo, 1);
    session.input("b", true, "jog");
    session.input("b", false, "midi");
    assert.equal(frame().score, 300 + points);
    assert.deepEqual(starts, ["a", "b"]);
    assert.equal(players.b.paused, false);
  }
});

test("preview handles a skipped frame at the entry, replays the recorded fade, and ends once", () => {
  const { players, session, frame, starts, mixes, states } = setup();
  session.preview();
  players.a.currentTime = chart.entry + 0.74;
  frame();
  assert.deepEqual(starts, ["a"]);
  players.a.currentTime = chart.entry + 0.9;
  frame();
  assert.deepEqual(starts, ["a", "b"]);
  assert.ok(Math.abs(players.b.currentTime - 0.15) < 0.00001);
  players.a.currentTime = 54;
  frame();
  assert.equal(mixes.at(-1)["mixer.crossfade"], 0);
  players.a.currentTime = chart.duration;
  frame(); frame();
  assert.deepEqual(states, ["demo", "finished"]);
  assert.ok(players.a.paused && players.b.paused);
  session.preview();
  assert.equal(frame().time, 0);
});

test("Levels solo uses Deck B audio and only Deck B movements relative to its entry", () => {
  const { data, frame, session, starts } = setup("levels");
  session.preview();
  assert.deepEqual(starts, ["b"]);
  assert.ok(data.notes.length && data.notes.every(n => n.channel === 2));
  assert.ok(Math.abs(data.notes[0].time - (chart.notes.find(n => n.channel === 2).time - chart.entry)) < 0.00001);
  assert.equal(frame().entryCue, null);
});

test("the on-screen playback control pauses and resumes both decks at their mix positions", () => {
  for (const preview of [true, false]) {
    const { session, players, frame } = setup();
    if (preview) session.preview();
    else session.togglePlayback();
    players.a.currentTime = chart.entry + 2;
    if (!preview) session.input("b", true);
    frame();
    players.b.currentTime = 1.25;

    session.togglePlayback();
    assert.ok(players.a.paused && players.b.paused);
    assert.equal(frame().time, chart.entry + 2);
    session.togglePlayback();
    frame();
    assert.ok(!players.a.paused && !players.b.paused);
    assert.equal(players.b.currentTime, 1.25);
    assert.equal(session.demo, preview);
  }
});
