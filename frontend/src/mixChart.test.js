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

function setup(selection = "mix1") {
  const player = () => ({ currentTime: 0, paused: true, ended: false, readyState: 4, pause() { this.paused = true; } });
  const players = { a: player(), b: player() }, starts = [], mixes = [], judgments = [], states = [];
  const engine = { players, audioFrame: () => ({}), update: values => mixes.push(values),
    pause: deck => players[deck].pause(),
    async setPlaying(deck) { starts.push(deck); players[deck].paused = false; },
    stop() { for (const p of Object.values(players)) { p.pause(); p.currentTime = 0; } } };
  let turn;
  const view = { knob() {}, onTurn(fn) { turn = fn; return () => {}; }, showJudgment(j) { judgments.push(j); } };
  const data = buildMixChart(recording, manifest, selection);
  const session = createMixSession(data, selection, 126, {
    getAudio: () => engine, liveValues: () => ({}), onState: state => states.push(state), onError: assert.fail
  });
  session.source.attach(view);
  session.attach(view);
  return { session, players, starts, states, mixes, judgments, frame: () => session.source.frame(50), turn, data };
}

test("live cues follow the first deck media position through pauses and manual Deck B entry", async () => {
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
  for (const [time, cue] of [[20.034, null], [20.284, "3"], [21.284, "2"], [22.284, "1"], [23.283, "SPIN RIGHT"]]) {
    players.a.currentTime = time;
    assert.equal(frame().entryCue, cue);
    assert.equal(players.b.paused, true);
  }
  session.input("b", true);
  assert.equal(players.b.paused, false);
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
  session.input("b", true);
  players.b.currentTime = 0.75;
  game = frame();
  assert.deepEqual(game.wheels.b, { time: 0.75, playing: true });
  session.input("b", false);
  game = frame();
  assert.deepEqual(game.wheels.a, { time: chart.entry + 0.75, playing: true });
  assert.deepEqual(game.wheels.b, { time: 0.75, playing: false });
});

test("right deck rejects early spins, arms during countdown, and stays aligned after entry", async () => {
  const { players, session, frame, starts } = setup();
  session.input("a", true);
  await Promise.resolve();
  players.a.currentTime = chart.entry - 2.26;
  session.input("b", true);
  players.a.currentTime = chart.entry + 1;
  frame();
  assert.deepEqual(starts, ["a"]);
  players.a.currentTime = chart.entry - 2.25;
  session.input("b", true);
  frame();
  assert.equal(players.b.paused, true);
  players.a.currentTime = chart.entry + 0.2;
  frame();
  assert.deepEqual(starts, ["a"]);
  players.a.currentTime = chart.entry + 0.75;
  frame();
  assert.deepEqual(starts, ["a", "b"]);
  assert.equal(players.b.currentTime, 0.75);
  players.a.currentTime = chart.entry + 5;
  frame();
  assert.equal(players.b.currentTime, 5);
  session.input("b", false);
  await Promise.resolve();
  await Promise.resolve();
  players.a.currentTime = chart.entry + 7;
  session.input("b", true);
  assert.equal(players.b.currentTime, 7);
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
  assert.ok(Math.abs(players.b.currentTime - 0.9) < 0.00001);
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
    players.b.currentTime = 2;

    session.togglePlayback();
    assert.ok(players.a.paused && players.b.paused);
    assert.equal(frame().time, chart.entry + 2);
    session.togglePlayback();
    frame();
    assert.ok(!players.a.paused && !players.b.paused);
    assert.equal(players.b.currentTime, 2);
    assert.equal(session.demo, preview);
  }
});
