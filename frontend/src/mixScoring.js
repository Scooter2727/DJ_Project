import { hypeTier } from "./crowd/mainstageHype.js";

const RAIL_POINTS_PER_SECOND = { tight: 300, near: 150, off: 0 };
const COMBO_TICK_SECONDS = 0.4;
const COMBO_GRACE_SECONDS = 0.18;
const HYPE_BONUSES = [0, 5, 10, 15];

export function hypeBonus({ level = 0, celebration = null } = {}) {
  return celebration ? 25 : HYPE_BONUSES[hypeTier(level)];
}

export function createMixScoring(getHype, onAward) {
  let score = 0, combo = 0, bestCombo = 0, bonusPoints = 0;
  let tightTime = 0, looseTime = 0, tracked = 0, available = 0;

  function multiplier() { return Math.min(4, 1 + Math.floor(combo / 10)); }

  function credit(seconds, rate, percent) {
    const base = seconds * rate * multiplier();
    const extra = base * percent / 100;
    score += base + extra;
    bonusPoints += extra;
  }

  return {
    sample(seconds, bands, demo) {
      if (!bands.length || seconds <= 0) return;
      available += seconds * bands.length;
      tracked += seconds * bands.filter(band => band !== "off").length;
      const rate = bands.reduce((sum, band) => sum + RAIL_POINTS_PER_SECOND[band], 0);
      const percent = demo ? 0 : hypeBonus(getHype());
      if (bands.some(band => band !== "tight")) {
        const beforeBreak = Math.max(0, COMBO_GRACE_SECONDS - looseTime);
        credit(Math.min(seconds, beforeBreak), rate, percent);
        looseTime += seconds;
        if (looseTime >= COMBO_GRACE_SECONDS - 1e-9) {
          combo = 0;
          tightTime = 0;
        }
        credit(Math.max(0, seconds - beforeBreak), rate, percent);
        return;
      }

      looseTime = 0;
      while (tightTime + seconds >= COMBO_TICK_SECONDS - 1e-9) {
        const toTick = COMBO_TICK_SECONDS - tightTime;
        credit(toTick, rate, percent);
        seconds = Math.max(0, seconds - toTick);
        tightTime = 0;
        const previous = multiplier();
        combo++;
        bestCombo = Math.max(bestCombo, combo);
        if (multiplier() > previous) {
          onAward({ points: 0, label: "Multiplier x" + multiplier(), multiplier: multiplier(), milestone: true });
        }
      }
      tightTime += seconds;
      credit(seconds, rate, percent);
    },
    bonus(points, label) {
      if (points <= 0) return;
      score += points;
      bonusPoints += points;
      onAward({ points, label, multiplier: multiplier() });
    },
    stats() {
      return {
        score: Math.round(score), combo, bestCombo, multiplier: multiplier(),
        bonusPoints: Math.round(bonusPoints), accuracy: available ? tracked / available : 0,
      };
    },
  };
}
