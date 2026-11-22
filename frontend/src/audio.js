const MIDI_MAX = 16383;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const normalized = value => clamp((value ?? MIDI_MAX / 2) / MIDI_MAX, 0, 1);

function smooth(parameter, value, context) {
  parameter.setTargetAtTime(value, context.currentTime, 0.018);
}

// Shared 16-band energy split (45Hz and up, two bands per octave) used by both the deck
// equalizer (fed from MixAudioEngine.audioFrame below) and any other analyser that wants
// the same {bands, kick, bass, hats, energy} shape the bundled game renderer expects.
function bandsFromSpectrum(spectrum, sampleRate, fftSize) {
  const hzPerBin = sampleRate / fftSize;
  const bands = Array.from({ length: 16 }, (_, i) => {
    const start = Math.floor(45 * 2 ** (i / 2) / hzPerBin);
    const end = Math.min(spectrum.length, Math.max(start + 1, Math.floor(45 * 2 ** ((i + 1) / 2) / hzPerBin)));
    let total = 0;
    for (let bin = start; bin < end; bin++) total += spectrum[bin];
    return total / (255 * Math.max(1, end - start));
  });
  return { bands, kick: bands[1], bass: bands[4], hats: bands[14], energy: bands.reduce((a, b) => a + b) / bands.length };
}

// A minimal analyser for a plain <audio> element that isn't part of the deck mix -- e.g. a
// background music track. Routes through an AnalyserNode so the bundled renderer can draw real
// audio-reactive visuals, without touching MixAudioEngine's deck gain/filter chain at all.
export function createAudioAnalyser(audioElement) {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const source = context.createMediaElementSource(audioElement);
  source.connect(analyser).connect(context.destination);
  return {
    resume: () => context.resume(),
    frame: () => {
      analyser.getByteFrequencyData(spectrum);
      return bandsFromSpectrum(spectrum, context.sampleRate, analyser.fftSize);
    },
  };
}

export class MixAudioEngine {
  constructor({ deckA, deckB }) {
    this.context = new AudioContext();
    this.players = {
      a: new Audio(deckA),
      b: new Audio(deckB),
    };
    this.nodes = {};
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
    this.playRequests = { a: 0, b: 0 };
    this.analyser.connect(this.context.destination);
    this.timingDeck = "a";

    for (const deck of ["a", "b"]) {
      const player = this.players[deck];
      player.preload = "auto";
      player.loop = false;
      player.crossOrigin = "anonymous";

      const source = this.context.createMediaElementSource(player);
      const trim = this.context.createGain();
      const low = this.context.createBiquadFilter();
      const mid = this.context.createBiquadFilter();
      const high = this.context.createBiquadFilter();
      const cfx = this.context.createBiquadFilter();
      const volume = this.context.createGain();

      low.type = "lowshelf";
      low.frequency.value = 180;
      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 0.8;
      high.type = "highshelf";
      high.frequency.value = 5000;
      cfx.type = "lowpass";
      cfx.frequency.value = 20000;

      source.connect(trim).connect(low).connect(mid).connect(high).connect(cfx).connect(volume).connect(this.analyser);
      this.nodes[deck] = { trim, low, mid, high, cfx, volume };
      volume.gain.value = 0;
    }
  }

  async resume() {
    if (this.context.state !== "running") await this.context.resume();
  }

  update(values) {
    const crossfade = normalized(values["mixer.crossfade"]);
    const master = normalized(values["mixer.master"] ?? MIDI_MAX);
    const deckAGain = crossfade <= 0.5 ? 1 : 2 * (1 - crossfade);
    const deckBGain = crossfade >= 0.5 ? 1 : 2 * crossfade;
    smooth(this.nodes.a.volume.gain, deckAGain * master * normalized(values["a.volume"] ?? MIDI_MAX), this.context);
    smooth(this.nodes.b.volume.gain, deckBGain * master * normalized(values["b.volume"] ?? MIDI_MAX), this.context);

    for (const deck of ["a", "b"]) {
      const nodes = this.nodes[deck];
      const trim = normalized(values[deck + ".trim"]);
      const low = normalized(values[deck + ".low"]);
      const mid = normalized(values[deck + ".mid"]);
      const high = normalized(values[deck + ".high"]);
      const cfx = normalized(values[deck + ".cfx"]);

      smooth(nodes.trim.gain, 0.55 + trim * 0.9, this.context);
      smooth(nodes.low.gain, (low - 0.5) * 24, this.context);
      smooth(nodes.mid.gain, (mid - 0.5) * 24, this.context);
      smooth(nodes.high.gain, (high - 0.5) * 24, this.context);

      if (cfx <= 0.5) {
        nodes.cfx.type = "lowpass";
        smooth(nodes.cfx.frequency, 22000 * Math.pow(100 / 22000, (0.5 - cfx) * 2), this.context);
      } else {
        nodes.cfx.type = "highpass";
        smooth(nodes.cfx.frequency, 25 * Math.pow(9000 / 25, (cfx - 0.5) * 2), this.context);
      }
    }
  }

  async setPlaying(deck, playing) {
    const request = ++this.playRequests[deck];
    await this.resume();
    if (request !== this.playRequests[deck]) return;
    const player = this.players[deck];
    if (playing) {
      if (player.paused || player.ended) await player.play();
    } else if (!player.paused) {
      player.pause();
    }
  }

  async startBoth() {
    await this.resume();
    await Promise.all([this.players.a.play(), this.players.b.play()]);
  }

  loadDecks(deckA, deckB) {
    this.stop();
    this.players.a.src = deckA;
    this.players.b.src = deckB;
    this.timingDeck = "a";
  }

  pause(deck) {
    this.playRequests[deck]++;
    this.players[deck].pause();
  }

  isPlaying(deck) {
    const player = this.players[deck];
    return !player.paused && !player.ended;
  }

  playbackPosition() {
    const otherDeck = this.timingDeck === "a" ? "b" : "a";
    if (!this.isPlaying(this.timingDeck) && this.isPlaying(otherDeck)) {
      this.timingDeck = otherDeck;
    }
    const player = this.players[this.timingDeck];
    return {
      deck: this.timingDeck,
      positionMs: player.currentTime * 1000,
      playbackRate: player.playbackRate,
      playing: this.isPlaying(this.timingDeck) && !player.seeking && player.readyState >= 3 && this.context.state === "running",
    };
  }

  stop() {
    for (const [deck, player] of Object.entries(this.players)) {
      this.pause(deck);
      player.playbackRate = 1;
      player.currentTime = 0;
    }
    this.timingDeck = "a";
  }

  audioFrame() {
    this.analyser.getByteFrequencyData(this.spectrum);
    return bandsFromSpectrum(this.spectrum, this.context.sampleRate, this.analyser.fftSize);
  }
}
