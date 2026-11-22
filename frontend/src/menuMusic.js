const START_VOLUME = 0.001;
const MENU_VOLUME = 0.4;
const FADE_MS = 1600;

export function createMenuMusic(audio, {
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
} = {}) {
  let browsing = false;
  let previewing = false;
  let needsFade = true;
  let frame = 0;

  const canPlay = () => browsing && !previewing;

  function play() {
    if (canPlay() && audio.paused) void audio.play().catch(() => {});
  }

  function pause() {
    cancelFrame(frame);
    frame = 0;
    audio.pause();
  }

  function onPlaying() {
    if (!canPlay()) {
      pause();
      return;
    }
    if (!needsFade || frame) return;
    const initialVolume = audio.volume <= START_VOLUME ? 0 : audio.volume;
    let started;
    audio.volume = initialVolume;
    function fade(now) {
      if (!canPlay() || audio.paused) {
        frame = 0;
        return;
      }
      started ??= now;
      const progress = Math.min(1, (now - started) / FADE_MS);
      audio.volume = initialVolume + (MENU_VOLUME - initialVolume) * progress * progress;
      frame = progress < 1 ? requestFrame(fade) : 0;
      needsFade = progress < 1;
    }
    frame = requestFrame(fade);
  }

  audio.volume = START_VOLUME;
  audio.addEventListener("playing", onPlaying);

  return {
    canPlay,
    play,
    setBrowsing(value) {
      if (browsing === value) return;
      browsing = value;
      if (browsing) {
        play();
      } else {
        previewing = false;
        pause();
        audio.currentTime = 0;
        audio.volume = START_VOLUME;
        needsFade = true;
      }
    },
    setPreviewing(value) {
      if (!browsing || previewing === value) return;
      previewing = value;
      if (previewing) pause();
      else play();
    },
    destroy() {
      audio.removeEventListener("playing", onPlaying);
      pause();
    },
  };
}
