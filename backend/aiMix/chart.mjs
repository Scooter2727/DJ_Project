const TEMPO_LIMIT = 3;
const MAX_GRID_ERROR = 0.125;
const MIN_OVERLAP_BEATS = 16;
const MAX_OVERLAP_BEATS = 128;
const TAIL_BEATS = 4;
const MIN_REST_BEATS = 1;
const MAX_TRAVEL_PER_SECOND = 1.8;
const DOWNBEAT_CONFIDENCE_MIN = 0.12;
const START = { "mixer.crossfade": 0, "a.volume": 1, "b.volume": 1 };
const ROTARIES = { HI: "high", MID: "mid", LOW: "low", CFX: "cfx" };
for (const deck of ["a", "b"]) {
  for (const knob of ["trim", ...Object.values(ROTARIES)]) START[deck+"."+knob] = 0.5;
}

// Snap Deck A's entry point to the nearest confident downbeat so the
// transition window starts on a real bar line instead of an arbitrary fixed
// beat offset. Falls back to the plain offset when the estimate isn't
// confident enough to trust.
function entryFor(section) {
  const minimum = section.beats >= 44 ? 16 : 8;
  if (section.downbeatPhase == null || (section.downbeatConfidence ?? 0) < DOWNBEAT_CONFIDENCE_MIN) return minimum;
  let entry = minimum;
  while ((entry - section.downbeatPhase) % 4 !== 0) entry++;
  return entry;
}

export function bestPair(outgoing, incoming) {
  if (!outgoing || !incoming || outgoing.id === incoming.id) return null;
  let best = null;
  for (const a of outgoing.sections) {
    for (const b of incoming.sections) {
      const rate = a.bpm / b.bpm;
      const shift = Math.abs(rate - 1) * 100;
      if (shift > TEMPO_LIMIT || a.gridErrorBeats + b.gridErrorBeats > MAX_GRID_ERROR) continue;
      const entry = entryFor(a);
      const overlap = Math.min(MAX_OVERLAP_BEATS, a.beats - entry - TAIL_BEATS, b.beats - TAIL_BEATS);
      if (overlap < MIN_OVERLAP_BEATS) continue;
      const end = entry + Math.floor(overlap / 4) * 4;
      // Cap the length term's influence at the old ~32-beat scale so a much
      // longer but less steady/well-matched pair can't outrank a tighter,
      // better-fitting one just by virtue of being long.
      const lengthBonus = Math.min(end - entry, 32);
      const score = shift * 2 + (a.gridErrorBeats + b.gridErrorBeats) * 10
        - lengthBonus * 0.08 + (a.startSeconds + b.startSeconds) * 0.012;
      if (!best || score < best.score) best = { a, b, rate, shift, entry, end, score };
    }
  }
  return best;
}

const number = { type: "number" };
const text = { type: "string" };
const beat = { type: ["integer", "null"] };
const object = properties => ({ type: "object", properties, required: Object.keys(properties) });
const enumeration = (...values) => ({ type: "string", enum: values });
export const responseSchema = object({
  status: enumeration("ready_for_validation", "needs_analysis", "ineligible"),
  eligibility: object({
    status: enumeration("eligible", "eligible_with_tempo_sync", "ineligible", "needs_analysis"),
    bpmA: number, bpmB: number, bpmDifference: number, requiredTempoAdjustmentPercent: number,
    estimatedBeatDrift: {type:["number","null"]}, beatCompatible: {type:"boolean"}, phraseCompatible: {type:"boolean"},
    harmonicAssessment: text, energyAssessment: text, reason: text,
  }),
  transition: object({difficulty: text, startBeat: beat, endBeat: beat, summary: text, musicalReasoning: text}),
  actions: {type: "array", maxItems: 16, items: object({
    id: text, startBeat: {type:"integer"}, endBeat: {type:"integer"},
    controls: {type:"array", minItems:1, maxItems:1, items: object({
      deck: enumeration("A", "B", "MIXER"),
      control: enumeration(...Object.keys(ROTARIES), "CROSSFADER"),
      from: number, to: number, curve: enumeration("linear", "smoothstep"),
    })}, instruction: text, musicalReason: text,
  })},
  warnings: {type:"array", items:text},
});

function downbeatIndicesFor(section, offset, length) {
  if (section.downbeatPhase == null || (section.downbeatConfidence ?? 0) < DOWNBEAT_CONFIDENCE_MIN) return [];
  const indices = [];
  for (let index = offset; index < length; index++) {
    if (((index - offset - section.downbeatPhase) % 4 + 4) % 4 === 0) indices.push(index);
  }
  return indices;
}

export function buildInput(trackA, trackB, pair) {
  const secondsPerBeat = 60 / pair.a.bpm;
  const startB = pair.b.startSeconds;
  const track = (value, section) => ({
    id: value.id, title: value.title, artist: value.artist, genre: value.genre,
    measuredBPM: section.bpm, key: null, analyzedBeatOriginSeconds: section.startSeconds,
    beatGridErrorBeats: section.gridErrorBeats, durationSeconds: value.durationSeconds,
  });
  const length = pair.end + TAIL_BEATS + 1;
  const beats = Array.from({length}, (_, index) => ({
    index, gameSeconds: Number((index * secondsPerBeat).toFixed(5)),
    deckASeconds: Number((pair.a.startSeconds + index * secondsPerBeat).toFixed(5)),
    deckBSeconds: index < pair.entry ? null : Number((startB + (index - pair.entry) * secondsPerBeat * pair.rate).toFixed(5)),
  }));
  return {
    tracks: {A:track(trackA,pair.a), B:track(trackB,pair.b)},
    beatGrid: {beats,
      downbeatIndices: downbeatIndicesFor(pair.a, 0, length),
      deckBDownbeatIndices: downbeatIndicesFor(pair.b, pair.entry, length),
      phraseBoundaries: [],
      note: "Beat timing was measured from decoded audio. downbeatIndices/deckBDownbeatIndices are an automated low-frequency-periodicity "
        + "estimate of each deck's bar-start beats, assuming 4/4 time -- they are a hint, not verified fact, and are empty when the "
        + "estimate was not confident. True musical phrase boundaries (8/16/32-bar sections) are unavailable; listen to the supplied "
        + "audio to evaluate phrasing and to confirm or override the downbeat hint. Beat indices themselves are fixed and verified. "
        + "The allowed transition window below may now span many bars -- it is not already a single tight phrase, so keep listening "
        + "for the real intro/outro/build/drop/vocal structure within it and choose the best musical moment inside the window, rather "
        + "than assuming the window's edges are themselves the right place to start or finish the mix."},
    playback: {gameTimeline: "Beat 0 is Deck A playback start. All action timing is in game beats.",
      deckAOriginSeconds: pair.a.startSeconds, deckBOriginSeconds: startB,
      deckBEntryBeat: pair.entry, deckBPlaybackRate: pair.rate, preservesPitch: true,
      allowedTransitionWindow: {startBeat:2, endBeat:pair.end}},
    controller: {model:"Pioneer DDJ-FLX4", initial: START,
      enabledRotaries: Object.keys(ROTARIES), sharedControl:"CROSSFADER", trimEnabled:false,
      cfx:"Bipolar filter, neutral 0.5", crossfaderCurve:"0 is A only, 0.5 both, 1 is B only",
      allowedSimultaneousControlPairs: [], maxNormalizedTravelPerSecond:MAX_TRAVEL_PER_SECOND,
      minimumMovementDurationBeats:1},
    game: {difficulty:"beginner", maximumSimultaneousControls:1, minimumRestBeats:MIN_REST_BEATS,
      desiredEndingState:{"mixer.crossfade":1,"b.low":0.5,"b.mid":0.5,"b.high":0.5,"b.cfx":0.5}},
    eligibilityRules: {maximumTempoAdjustmentPercent:TEMPO_LIMIT, maximumBeatDrift:MAX_GRID_ERROR,
      minimumOverlapBeats:MIN_OVERLAP_BEATS, maximumOverlapBeats:MAX_OVERLAP_BEATS, phraseAlignmentRequired:true},
  };
}

function check(condition, issue) {
  if (!condition) throw new Error(issue);
}

export function compileChart(plan, trackA, trackB, pair) {
  check(plan?.status === "ready_for_validation" &&
    ["eligible", "eligible_with_tempo_sync"].includes(plan.eligibility?.status), "Gemini did not approve this pairing.");
  const { transition, actions } = plan;
  check(Array.isArray(actions) && actions.length >= 3 && actions.length <= 16, "Use 3–16 meaningful actions.");
  check(Number.isInteger(transition?.startBeat) && Number.isInteger(transition?.endBeat)
    && transition.startBeat >= 2 && transition.endBeat <= pair.end && transition.startBeat < transition.endBeat,
  "Transition is outside the permitted beat window.");

  const state = {...START};
  const cues = [];
  const midi = value => Math.round(value * 16383);
  const beatSeconds = 60 / pair.a.bpm;
  const msAt = beat => Math.round(beat * beatSeconds * 1000);
  const values = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, midi(value)]));
  const events = [{ t:0, values:{...values} }];
  const ids = new Set();
  let previousEnd = -1;
  for (const action of actions) {
    const { id, startBeat, endBeat, controls } = action ?? {};
    check(typeof id === "string" && id.length > 0 && !ids.has(id), "Use unique action IDs.");
    ids.add(id);
    check(Number.isInteger(startBeat) && Number.isInteger(endBeat) && startBeat >= transition.startBeat
      && endBeat <= transition.endBeat && endBeat > startBeat && startBeat - previousEnd >= MIN_REST_BEATS,
    "Use ordered non-overlapping moves with one beat of rest.");
    check(Array.isArray(controls) && controls.length === 1, "Move one control at a time.");
    const move = controls[0] ?? {};
    const isFade = move.deck === "MIXER" && move.control === "CROSSFADER";
    const knob = Object.hasOwn(ROTARIES,move.control) ? ROTARIES[move.control] : null;
    const control = isFade ? "mixer.crossfade"
      : knob && ["A","B"].includes(move.deck) ? move.deck.toLowerCase()+"."+knob : null;
    check(control, "Use supported controls and deck names.");
    check([move.from, move.to].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
      && Math.abs(state[control] - move.from) <= 0.001 && Math.abs(move.to - move.from) >= 0.05
      && ["linear","smoothstep"].includes(move.curve), "Use valid values, movement curves and control continuity.");
    check((!isFade || move.to > move.from) &&
      (!(isFade || move.deck === "B") || startBeat >= pair.entry), "Keep Deck B inaudible until its scheduled entry.");
    const durationSeconds = (endBeat - startBeat) * beatSeconds;
    const peakSpeed = Math.abs(move.to - move.from) * (move.curve === "smoothstep" ? 1.5 : 1) / durationSeconds;
    check(peakSpeed <= MAX_TRAVEL_PER_SECOND, "Keep movement speed feasible.");
    const steps = Math.ceil(durationSeconds / 0.08);
    const from = state[control];
    for (let step = 0; step <= steps; step++) {
      const fraction = step / steps;
      const progress = move.curve === "smoothstep" ? fraction*fraction*(3-2*fraction) : fraction;
      values[control] = midi(from + (move.to - from) * progress);
      events.push({t:msAt(startBeat + (endBeat-startBeat)*fraction), values:{...values}});
    }
    cues.push({t:msAt(startBeat), endMs:msAt(endBeat), control, from:midi(from), to:midi(move.to),
      label: typeof action.instruction === "string" ? action.instruction.slice(0,48) : ""});
    state[control] = move.to;
    previousEnd = endBeat;
  }
  check(state["mixer.crossfade"] === 1 && Object.values(ROTARIES).every(knob => state["b."+knob] === 0.5),
    "Finish with Deck B audible and its EQ and filter neutral.");
  check(cues.some(cue => cue.control.startsWith("a.")) && cues.some(cue => cue.control.startsWith("b.")),
    "Give each deck at least one meaningful knob cue.");
  const deck = (track, section, rate) => ({
    id: track.id, title: track.title, artist: track.artist, file:"/api/custom-mix/audio/"+track.id,
    tempo:section.bpm, beatOffsetSeconds:section.startSeconds, startSeconds:section.startSeconds, playbackRate:rate,
  });
  return {
    manifest: {kind:"ai", name:trackA.title+" / "+trackB.title, cueOffsetMs:0, deckBEntryMs:msAt(pair.entry),
      deckA:deck(trackA,pair.a,1), deckB:deck(trackB,pair.b,pair.rate)},
    recording: {durationMs:msAt(Math.max(transition.endBeat,pair.entry + MIN_OVERLAP_BEATS)+TAIL_BEATS), events, cues},
    plan, provider:"gemini",
  };
}
