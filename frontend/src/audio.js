const MIDI_MAX = 16383;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const normalized = value => clamp((value ?? MIDI_MAX / 2) / MIDI_MAX, 0, 1);

function smooth(parameter, value, context) {
  parameter.setTargetAtTime(value, context.currentTime, 0.018);
}

export class MixAudioEngine {
  constructor({ deckA, deckB }) {
    this.context = new AudioContext();
    this.players = {
      a: new Audio(deckA),
      b: new Audio(deckB),
    };
    this.nodes = {};

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

      source.connect(trim).connect(low).connect(mid).connect(high).connect(cfx).connect(volume).connect(this.context.destination);
      this.nodes[deck] = { trim, low, mid, high, cfx, volume };
      volume.gain.value = 0;
    }
  }

  async resume() {
    if (this.context.state !== "running") await this.context.resume();
  }

  update(values) {
    const crossfade = normalized(values["mixer.crossfade"]);
    const angle = crossfade * Math.PI / 2;
    smooth(this.nodes.a.volume.gain, Math.cos(angle), this.context);
    smooth(this.nodes.b.volume.gain, Math.sin(angle), this.context);

    for (const deck of ["a", "b"]) {
      const nodes = this.nodes[deck];
      const trim = normalized(values[deck + ".trim"]);
      const low = normalized(values[deck + ".low"]);
      const mid = normalized(values[deck + ".mid"]);
      const high = normalized(values[deck + ".high"]);
      const volume = normalized(values[deck + ".volume"]);
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
      smooth(nodes.volume.gain, volume, this.context);
    }
  }

  async setPlaying(deck, playing) {
    await this.resume();
    const player = this.players[deck];
    if (playing) {
      if (player.paused) await player.play();
    } else if (!player.paused) {
      player.pause();
    }
  }

  async startBoth() {
    await this.resume();
    await Promise.all([this.players.a.play(), this.players.b.play()]);
  }

  stop() {
    for (const player of Object.values(this.players)) {
      player.pause();
      player.currentTime = 0;
    }
  }
}
