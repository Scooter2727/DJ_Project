const deckKnobs = {
  0x00: "tempo", 0x04: "trim", 0x07: "high", 0x0b: "mid",
  0x0f: "low", 0x13: "volume"
};
const mixerKnobs = { 0x08: "master", 0x1f: "crossfade" };
const cfxKnobs = { 0x17: "a.cfx", 0x18: "b.cfx" };
const transportButtons = { 0x10: "loopIn", 0x11: "loopOut", 0x4d: "loop4", 0x58: "sync" };
const JOG_SENSITIVITY = 0.35;

export function decodeMidi([status, id, value], current) {
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  const deck = channel === 0 ? "a" : "b";
  if (kind === 0xb0) {
    if (channel === 6 && cfxKnobs[id]) {
      return { [cfxKnobs[id]]: value * 129 };
    }
    if (channel === 6 && id === 0x37) {
      return { "a.cfx": (current["a.cfx"] ?? 0) + value };
    }
    if (channel === 6 && id === 0x38) {
      return { "b.cfx": (current["b.cfx"] ?? 0) + value };
    }
    if (channel < 2 && id >= 0x21 && id <= 0x23) {
      const key = deck + ".jog";
      return { [key]: (current[key] ?? 0) + (value - 64) * JOG_SENSITIVITY };
    }
    const controls = channel === 6 ? mixerKnobs : channel < 2 ? deckKnobs : {};
    const coarseId = id >= 0x20 ? id - 0x20 : id;
    const control = controls[coarseId];
    if (!control) return {};
    const key = (channel === 6 ? "mixer" : deck) + "." + control;
    const previous = current[key];
    if (id < 0x20) return { [key]: value * 128 + ((previous ?? 0) & 127) };
    if (previous !== undefined) return { [key]: (previous & 0x3f80) + value };
  }

  if (kind === 0x90 || kind === 0x80) {
    const pressed = kind === 0x90 && value > 0;
    if (channel < 2 && transportButtons[id]) {
      return { [deck + "." + transportButtons[id]]: pressed };
    }
    if ((channel === 7 || channel === 9) && id < 8) {
      return { [(channel === 7 ? "a" : "b") + ".pad" + (id + 1)]: pressed };
    }
    if (channel < 2 && id === 0x0c) return { [deck + ".cue"]: pressed };
    if (channel < 2 && id === 0x0b && pressed) {
      return { [deck + ".play"]: !current[deck + ".play"] };
    }
  }
  return {};
}
