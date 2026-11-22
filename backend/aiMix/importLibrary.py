"""Import the supplied local music and fit beat grids from decoded audio."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parent
LIBRARY = ROOT / "library"
SAMPLE_RATE = 22050
HOP = 128


def fit_section(beats, sample, duration):
    # Fit a local steady section so a change in tempo elsewhere does not affect its grid.
    positions = beats[(beats >= sample) & (beats < sample + 31)]
    if len(positions) < 25:
        return None
    steps = np.diff(positions)
    period = np.median(steps)
    # Reject windows crossing a tempo change or containing plenty of missed beats.
    if np.mean(np.abs(steps - period) > 0.055) > 0.14:
        return None
    indices = np.arange(len(positions))
    period, origin = np.polyfit(indices, positions, 1)
    residual = np.abs(positions - (origin + indices * period))
    if np.percentile(residual, 90) > 0.075 or origin < 0:
        return None
    count = min(len(positions), int((duration - origin) / period))
    return {
        "startSeconds": round(float(origin), 6),
        "bpm": round(float(60 / period), 5),
        "beats": count,
        "gridErrorBeats": round(float(np.percentile(residual, 90) / period), 4),
    }


EXTEND_ERROR_BUDGET = 0.125  # beats; matches chart.mjs's MAX_GRID_ERROR pair tolerance.
EXTEND_WINDOW_SECONDS = 31


def extend_section(beats, section, duration):
    # fit_section only ever fits beats inside a single 31-second slice, so a
    # steady section is reported as ~31 seconds long even when the track
    # actually holds that same tempo/phase for much longer. Walk the already
    # detected beat times forward against the fitted model and keep extending
    # the reported beat count for as long as the grid keeps holding, instead
    # of silently throwing away real steadiness past the initial slice.
    period = 60 / section["bpm"]
    origin = section["startSeconds"]
    window_end = origin + EXTEND_WINDOW_SECONDS
    count = section["beats"]
    residuals = []
    # Seed the running error estimate from the beats already inside the
    # fitted window so it reflects the whole confirmed grid, not just the
    # newly extended tail.
    seed = beats[(beats >= origin - period * 0.5) & (beats < window_end)]
    for i in range(min(len(seed), count)):
        predicted = origin + i * period
        nearby = seed[np.abs(seed - predicted) < period * 0.5]
        if len(nearby):
            residuals.append(float(np.min(np.abs(nearby - predicted))))
    while True:
        predicted = origin + count * period
        if predicted + period * 0.5 > duration:
            break
        candidates = beats[(beats >= predicted - period * 0.5) & (beats < predicted + period * 0.5)]
        if not len(candidates):
            break
        residual = float(np.min(np.abs(candidates - predicted)))
        if residual / period > EXTEND_ERROR_BUDGET:
            break
        residuals.append(residual)
        count += 1
    if residuals:
        section["gridErrorBeats"] = round(float(np.percentile(residuals, 90) / period), 4)
    section["beats"] = count
    return section


def low_band_envelope(samples):
    # A coarse proxy for kick/sub emphasis, used only to guess which beat in a
    # 4/4 bar most likely carries the downbeat. This is a heuristic, not a
    # verified musical analysis -- callers must treat the result as a hint.
    stft = np.abs(librosa.stft(samples, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=SAMPLE_RATE, n_fft=2048)
    band = stft[freqs <= 150].sum(axis=0)
    clock = librosa.frames_to_time(np.arange(len(band)), sr=SAMPLE_RATE, hop_length=HOP)
    return band, clock


def estimate_downbeat_phase(band, clock, section):
    # Sample the low-band energy at each beat of the section and group by
    # position in a 4-beat bar. The phase with the strongest mean low-band
    # energy is reported as the likely downbeat, with a confidence based on
    # how far it stands out from the next-strongest phase. Low separation
    # (or too few beats) returns no estimate rather than a guess.
    period = 60 / section["bpm"]
    start = section["startSeconds"]
    count = section["beats"]
    if count < 16:
        return None, 0.0
    energies = np.zeros(count)
    for i in range(count):
        t = start + i * period
        window = (clock >= t - 0.05) & (clock < t + period * 0.5)
        if window.any():
            energies[i] = band[window].sum()
    if not energies.sum():
        return None, 0.0
    phase_means = np.array([energies[i::4].mean() for i in range(4)])
    order = np.argsort(phase_means)[::-1]
    best, second = phase_means[order[0]], phase_means[order[1]]
    if best <= 0:
        return None, 0.0
    confidence = round(float((best - second) / best), 4)
    return int(order[0]), confidence


def fit_repeated_pulse(envelope, clock, start, duration, tempo):
    # Some syncopated tracks pull individual beat picks off the grid. Confirm the
    # recurring pulse independently across shorter blocks before accepting it.
    mask = (clock >= start) & (clock < start + 31)
    times = clock[mask]
    weights = envelope[mask]
    weight = np.sum(weights)
    if not weight:
        return None
    frequencies = np.linspace(tempo * 0.975, tempo * 1.025, 111) / 60
    phases = 2 * np.pi * frequencies[:, None] * times
    pulse = np.exp(1j * phases) @ weights
    best = int(np.argmax(np.abs(pulse)))
    frequency = frequencies[best]
    if abs(pulse[best]) < weight * 0.18:
        return None
    phase = np.angle(pulse[best]) / (2 * np.pi)
    errors = []
    for block in np.array_split(np.arange(len(times)), 4):
        local_weights = weights[block]
        local = np.exp(1j * phases[best, block]) @ local_weights
        if abs(local) < 0.14 * local_weights.sum():
            return None
        errors.append(abs(np.angle(local * np.conj(pulse[best]))) / (2 * np.pi))
    error = max(errors)
    if error > 0.075:
        return None
    origin = (phase + np.ceil(start * frequency - phase)) / frequency
    end = min(start + 31, duration)
    return {"startSeconds": round(float(origin), 6), "bpm": round(float(frequency * 60), 5),
            "beats": int((end - origin) * frequency), "gridErrorBeats": round(float(error),4)}


def measure(path, decoder):
    result = subprocess.run(
        [decoder, "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        check=True, stdout=subprocess.PIPE,
    )
    samples = np.frombuffer(result.stdout, dtype="<f4").copy()
    duration = len(samples) / SAMPLE_RATE
    envelope = librosa.onset.onset_strength(y=samples, sr=SAMPLE_RATE, hop_length=HOP)
    tempo, frames = librosa.beat.beat_track(onset_envelope=envelope, sr=SAMPLE_RATE, hop_length=HOP, trim=False)
    beats = librosa.frames_to_time(frames, sr=SAMPLE_RATE, hop_length=HOP)
    sections = [fit_section(beats, start, duration) for start in range(0, int(duration) - 28, 8)]
    sections = [section for section in sections if section]
    for section in sections:
        extend_section(beats, section, duration)
    # Favor steady sections and retain different portions of the actual recording.
    sections.sort(key=lambda section: (section["gridErrorBeats"], section["startSeconds"]))
    if not sections and np.asarray(tempo).item() > 0:
        center = float(np.asarray(tempo).item())
        clock = librosa.frames_to_time(np.arange(len(envelope)), sr=SAMPLE_RATE, hop_length=HOP)
        sections = [fit_repeated_pulse(envelope, clock, start, duration, center)
                    for start in range(0, int(duration) - 31, 8)]
        sections = sorted((section for section in sections if section), key=lambda section: section["gridErrorBeats"])
    if sections:
        band, band_clock = low_band_envelope(samples)
        for section in sections:
            phase, confidence = estimate_downbeat_phase(band, band_clock, section)
            section["downbeatPhase"] = phase
            section["downbeatConfidence"] = confidence
    return {"durationSeconds": duration, "sections": sections}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("downloads", type=Path)
    args = cli.parse_args()
    decoder = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
    if not decoder:
        cli.error("Provide FFmpeg in PATH or with FFMPEG_BIN.")
    LIBRARY.mkdir(exist_ok=True)
    audio = LIBRARY / "audio"
    audio.mkdir(exist_ok=True)
    catalog_file = LIBRARY / "tracks.json"
    cached = {track["id"]: track for track in json.loads(catalog_file.read_text())} if catalog_file.exists() else {}
    tracks = []
    for song_id, genre, artist, title, prefix in json.loads((ROOT / "tracks.json").read_text()):
        folder = args.downloads / ("Rap" if genre == "rap" else genre)
        matches = [p for p in folder.iterdir() if p.suffix.lower() == ".mp3" and p.name.startswith(prefix)]
        if len(matches) != 1:
            cli.error(f"Expected one MP3 for {title} in {folder}")
        source, = matches
        fingerprint = hashlib.sha256(source.read_bytes()).hexdigest()
        destination = audio / f"{song_id}-{fingerprint[:12]}.mp3"
        prior = cached.get(song_id)
        analysis = prior if prior and prior["fingerprint"] == fingerprint and prior["sections"] else measure(source, decoder)
        if not destination.exists():
            shutil.copyfile(source, destination)
        entry = {**analysis, "id": song_id, "genre": genre, "artist": artist, "title": title,
                 "fingerprint": fingerprint, "file": destination.name}
        tracks.append(entry)
        print(f"{title}: {len(entry['sections'])} steady sections", flush=True)
    temporary = catalog_file.with_suffix(".tmp")
    temporary.write_text(json.dumps(tracks, indent=2) + "\n", encoding="utf8")
    temporary.replace(catalog_file)


if __name__ == "__main__":
    main()
