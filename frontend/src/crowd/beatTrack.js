export const BEAT_TRACK = {
  bpm: 104,
  minBpm: 60,
  maxBpm: 180,
  beatsPerLoop: 16,
  cueBeats: [0, 2, 4, 6, 8, 10, 12, 14],
  leadMs: 1800,
};

export function chartForBpm(bpm) {
  const rounded = Math.round(Number(bpm));
  const safe = Math.min(BEAT_TRACK.maxBpm, Math.max(BEAT_TRACK.minBpm, Number.isFinite(rounded) ? rounded : BEAT_TRACK.bpm));
  const intervalMs = 60000 / safe;
  return {
    bpm: safe,
    loopMs: intervalMs * BEAT_TRACK.beatsPerLoop,
    cues: BEAT_TRACK.cueBeats.map(beat => beat * intervalMs),
    leadMs: BEAT_TRACK.leadMs,
  };
}

function noiseBuffer(context) {
  const buffer = context.createBuffer(1, context.sampleRate * 0.08, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
  return buffer;
}

function tone(context, when, frequency, duration, amount, type = "sine") {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  gain.gain.setValueAtTime(amount, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.02);
}

export function createBeatTrack(bpm = BEAT_TRACK.bpm) {
  const context = new AudioContext();
  const hat = noiseBuffer(context);
  let chart = chartForBpm(bpm);
  let startTime = null;
  let nextBeat = 0;
  let timer = null;

  function schedule(when, beat) {
    tone(context, when, beat % 4 === 0 ? 150 : 118, 0.09, beat % 2 === 0 ? 0.45 : 0.22);
    const noise = context.createBufferSource();
    const gain = context.createGain();
    noise.buffer = hat;
    gain.gain.setValueAtTime(beat % 2 === 0 ? 0.045 : 0.02, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
    noise.connect(gain).connect(context.destination);
    noise.start(when);
    noise.stop(when + 0.05);
    if (BEAT_TRACK.cueBeats.includes(beat)) tone(context, when, 660, 0.06, 0.04, "triangle");
  }

  function fill() {
    const interval = chart.loopMs / BEAT_TRACK.beatsPerLoop / 1000;
    const horizon = context.currentTime + 0.18;
    while (startTime + nextBeat * interval < horizon) {
      const beatInLoop = nextBeat % BEAT_TRACK.beatsPerLoop;
      schedule(startTime + nextBeat * interval, beatInLoop);
      nextBeat += 1;
    }
  }

  const api = {
    get loopMs() { return chart.loopMs; },
    get cues() { return chart.cues; },
    get bpm() { return chart.bpm; },
    leadMs: BEAT_TRACK.leadMs,
    songTimeMs() {
      return startTime === null ? null : (context.currentTime - startTime) * 1000;
    },
    setBpm(next) {
      const updated = chartForBpm(next);
      if (updated.bpm === chart.bpm) return updated;
      chart = updated;
      if (startTime !== null) {
        startTime = context.currentTime + 0.7;
        nextBeat = 0;
      }
      return updated;
    },
    async start() {
      if (context.state === "suspended") await context.resume();
      if (startTime !== null) return;
      startTime = context.currentTime + BEAT_TRACK.leadMs / 1000;
      const countInterval = (BEAT_TRACK.leadMs / 1000) / 4;
      for (let count = 1; count <= 3; count += 1) tone(context, context.currentTime + count * countInterval, 196, 0.05, 0.16);
      fill();
      timer = setInterval(fill, 40);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      context.close();
    },
  };
  return api;
}
