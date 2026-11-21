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
  assert.equal(chart.tracesAt(first.time - 4.01)["1:LOW"], undefined);
  const trace = chart.tracesAt(first.time - 3)["1:LOW"];
  assert.equal(trace[0], 0);
  assert.ok(trace.at(-1) < 0);
  assert.equal(trace.at(-1), (chart.valuesAt(first.time + 1)["a.low"] - chart.valuesAt(first.time - 3)["a.low"]) / 16383);
  assert.ok(chart.notes.every((n, i) => n.time < chart.duration && (!i || n.time >= chart.notes[i - 1].time)));
  assert.equal(chart.valuesAt(54)["mixer.crossfade"], 0);
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
  for (const [time, cue] of [[19.934, "3"], [20.934, "2"], [21.934, "1"], [22.933, "SPIN RIGHT"]]) {
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

test("preview handles a skipped frame at the entry, replays the recorded fade, and ends once", () => {
  const { players, session, frame, starts, mixes, states } = setup();
  session.preview();
  players.a.currentTime = chart.entry - 0.01;
  frame();
  assert.deepEqual(starts, ["a"]);
  players.a.currentTime = chart.entry + 0.4;
  frame();
  assert.deepEqual(starts, ["a", "b"]);
  assert.ok(Math.abs(players.b.currentTime - 0.4) < 0.00001);
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
