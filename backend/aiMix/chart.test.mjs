import assert from "node:assert/strict";
import { test } from "node:test";
import { bestPair, buildInput, compileChart } from "./chart.mjs";
import { buildMixChart, createMixSource } from "../../frontend/src/mixChart.js";

const makeTrack = (id,bpm=126) => ({
  id, title:id, artist:"Test artist", genre:"edm", durationSeconds:90,
  sections:[{startSeconds:12,bpm,beats:55,gridErrorBeats:0.02}],
});
const a = makeTrack("a"), b = makeTrack("b",128), pair = bestPair(a,b);
const move = (id,startBeat,endBeat,deck,control,from,to)=>({
  id,startBeat,endBeat,controls:[{deck,control,from,to,curve:"linear"}],instruction:id,
});
const plan = {
  status:"ready_for_validation", eligibility:{status:"eligible_with_tempo_sync"},
  transition:{startBeat:4,endBeat:40},
  actions:[
    move("cut",4,8,"A","LOW",0.5,0.1),
    move("blend",16,20,"MIXER","CROSSFADER",0,0.5),
    move("filter",22,24,"B","CFX",0.5,0.7),
    move("restore",26,28,"B","CFX",0.7,0.5),
    move("handoff",32,40,"MIXER","CROSSFADER",0.5,1),
  ],
};

test("matching enforces the measured tempo and grid criteria", () => {
  assert.equal(bestPair(a,a),null);
  assert.equal(bestPair(a,makeTrack("different",145)),null);
  const unstable = makeTrack("unstable");
  unstable.sections[0].gridErrorBeats = 0.15;
  assert.equal(bestPair(a,unstable),null);
  assert.ok(Math.abs(pair.rate * 128 - 126) < 1e-8);
  const input=buildInput(a,b,pair);
  assert.equal(input.beatGrid.beats[pair.entry].deckBSeconds,12);
  assert.equal(input.beatGrid.beats[pair.entry-1].deckBSeconds,null);
});

test("downbeat hints are only surfaced when the estimate is confident", () => {
  assert.deepEqual(buildInput(a,b,pair).beatGrid.downbeatIndices,[]);
  assert.deepEqual(buildInput(a,b,pair).beatGrid.deckBDownbeatIndices,[]);

  const confidentA = makeTrack("confidentA");
  confidentA.sections[0] = {...confidentA.sections[0], downbeatPhase:1, downbeatConfidence:0.3};
  const confidentB = makeTrack("confidentB",128);
  confidentB.sections[0] = {...confidentB.sections[0], downbeatPhase:2, downbeatConfidence:0.3};
  const confidentPair = bestPair(confidentA,confidentB);
  const confidentInput = buildInput(confidentA,confidentB,confidentPair);
  assert.ok(confidentInput.beatGrid.downbeatIndices.every(index => (index - 1) % 4 === 0));
  assert.ok(confidentInput.beatGrid.deckBDownbeatIndices.every(
    index => index >= confidentPair.entry && (index - confidentPair.entry - 2) % 4 === 0,
  ));

  const unsure = makeTrack("unsure");
  unsure.sections[0] = {...unsure.sections[0], downbeatPhase:1, downbeatConfidence:0.05};
  const unsurePair = bestPair(unsure,b);
  assert.deepEqual(buildInput(unsure,b,unsurePair).beatGrid.downbeatIndices,[]);
});

test("a validated plan becomes exact knob and crossfade cues", () => {
  const { manifest, recording } = compileChart(plan,a,b,pair);
  const chart = buildMixChart(recording,manifest);
  assert.deepEqual(chart.notes.map(note=>[note.channel,note.row]),[[1,"LOW"],[2,"CFX"],[2,"CFX"]]);
  const [firstFade] = chart.fades;
  assert.equal(chart.crossfadeCueAt(firstFade.start).to,firstFade.to);
  assert.ok(Math.abs(chart.entry-pair.entry*60/126)<0.001);
  assert.ok(recording.events.every((event,i,list)=>!i||event.t>list[i-1].t));
  let transport = {playing:true, playerCrossfade:0, time:firstFade.start, demo:false};
  const source = createMixSource(chart,126,()=>transport,()=>{});
  source.attach({onTurn:()=>()=>{},showJudgment(){}});
  assert.equal(source.frame().score,0);
  transport = {...transport,time:firstFade.end-0.2,playerCrossfade:8192};
  assert.equal(source.frame().score,0);
  transport.time = firstFade.end;
  assert.equal(source.frame().score,500);
  assert.equal(source.frame().score,500);
  transport.time = chart.fades[1].end+0.6;
  assert.equal(source.frame().score,500);
});

test("long, well-matched sections get a much larger transition window than before", () => {
  const longA = makeTrack("longA"); longA.sections[0] = {...longA.sections[0], beats:200};
  const longB = makeTrack("longB",128); longB.sections[0] = {...longB.sections[0], beats:200};
  const longPair = bestPair(longA,longB);
  assert.ok(longPair.end - longPair.entry > 32, "expected the window to grow past the old 32-beat cap");
  assert.ok(longPair.end - longPair.entry <= 128, "expected the window to stay within the new cap");
});

test("short sections still clamp to a short window instead of being forced wider", () => {
  const shortA = makeTrack("shortA"); shortA.sections[0] = {...shortA.sections[0], beats:40};
  const shortB = makeTrack("shortB",128); shortB.sections[0] = {...shortB.sections[0], beats:40};
  const shortPair = bestPair(shortA,shortB);
  assert.ok(shortPair.end - shortPair.entry < 32, "a short validated section should not get a long window");
});

test("a confident downbeat estimate snaps Deck A's entry onto a real bar line", () => {
  const trackA = makeTrack("barAlignedA"); trackA.sections[0] = {...trackA.sections[0], downbeatPhase:3, downbeatConfidence:0.3};
  const trackB = makeTrack("barAlignedB",128);
  const alignedPair = bestPair(trackA,trackB);
  assert.equal((alignedPair.entry - 3) % 4, 0);
  assert.notEqual(alignedPair.entry, 16);
});

test("a low-confidence downbeat estimate falls back to the fixed entry offset", () => {
  const trackA = makeTrack("unsureEntryA"); trackA.sections[0] = {...trackA.sections[0], downbeatPhase:3, downbeatConfidence:0.05};
  const trackB = makeTrack("unsureEntryB",128);
  const unsurePair = bestPair(trackA,trackB);
  assert.equal(unsurePair.entry, 16);
});

test("the chart compiler rejects overlapping, discontinuous and premature movements", () => {
  const overlap=structuredClone(plan);
  overlap.actions[2].startBeat=19;
  assert.throws(()=>compileChart(overlap,a,b,pair),/non-overlapping/);
  const invalid=structuredClone(plan);
  invalid.actions[2].controls[0].from=0.2;
  assert.throws(()=>compileChart(invalid,a,b,pair),/continuity/);
  const premature=structuredClone(plan);
  premature.actions[1].startBeat=12;
  assert.throws(()=>compileChart(premature,a,b,pair),/scheduled entry/);
  assert.throws(()=>compileChart({...plan,status:"needs_analysis"},a,b,pair),/did not approve/);
});
