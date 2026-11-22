import React, { useEffect, useRef, useState } from "react";
import "./customMixPicker.css";

const GENRES = [["rap", "Rap"], ["edm", "EDM"], ["pop", "Pop"]];
const GENRE_SEARCH = new Map([["rap", "rap"], ["hip hop", "rap"], ["hip-hop", "rap"], ["edm", "edm"], ["electronic", "edm"], ["pop", "pop"]]);
const PREVIEW_SECONDS = 12;

async function requestMix(path, options) {
  const response = await fetch("/api/custom-mix/" + path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    throw new Error(typeof body?.error === "string" ? body.error : "Custom Mix is unavailable. Try again.");
  }
  return body;
}

function externalLink(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}

function Credits({ track }) {
  const source = externalLink(track.sourceUrl ?? track.source);
  const license = externalLink(track.licenseUrl);
  if (!source && !track.license) return null;
  return <span className="custom-mix-credits">
    {track.license && (license
      ? <a href={license} target="_blank" rel="noreferrer">{track.license}</a>
      : <span>{track.license}</span>)}
    {source && <a href={source} target="_blank" rel="noreferrer" aria-label={`Source for ${track.title}`}>Source</a>}
  </span>;
}

export default function CustomMixPicker({ onClose, onReady, lastMix }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const titleRef = useRef(null);
  const previewRef = useRef(null);
  const planRef = useRef(null);
  const [genre, setGenre] = useState("edm");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState({ tracks: [], loading: true, error: "" });
  const [songOne, setSongOne] = useState(null);
  const [shortlist, setShortlist] = useState({ matches: [], loading: false, error: "" });
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [building, setBuilding] = useState(null);
  const [planError, setPlanError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      dialog.close();
      planRef.current?.abort();
      if (previewRef.current) {
        previewRef.current.pause();
        previewRef.current.removeAttribute("src");
        previewRef.current.load();
        previewRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ tracks: [], loading: true, error: "" });
    requestMix("catalog?genre=" + encodeURIComponent(genre), { signal: controller.signal }).then(body => {
      if (!controller.signal.aborted) setCatalog({ tracks: body.tracks, loading: false, error: "" });
    }).catch(error => {
      if (!controller.signal.aborted) setCatalog({ tracks: [], loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [genre, attempt]);

  useEffect(() => {
    if (!songOne) {
      searchRef.current?.focus();
      return;
    }
    const controller = new AbortController();
    titleRef.current?.focus();
    setShortlist({ matches: [], loading: true, error: "" });
    requestMix("matches?trackId=" + encodeURIComponent(songOne.id), { signal: controller.signal }).then(body => {
      if (!controller.signal.aborted) setShortlist({ matches: body.matches.slice(0, 5), loading: false, error: "" });
    }).catch(error => {
      if (!controller.signal.aborted) setShortlist({ matches: [], loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [songOne, attempt]);

  function stopPreview() {
    const audio = previewRef.current;
    previewRef.current = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlaying(null);
  }

  function listen(track) {
    stopPreview();
    setPreviewError("");
    if (playing === track.id) return;
    const audio = new Audio(track.file);
    previewRef.current = audio;
    setPlaying(track.id);
    const start = Number.isFinite(track.previewStartSeconds) ? Math.max(track.previewStartSeconds, 0) : 0;
    if (start > 0) audio.currentTime = start;
    function finish() {
      if (previewRef.current === audio) stopPreview();
    }
    audio.onended = finish;
    audio.ontimeupdate = () => { if (audio.currentTime >= start + PREVIEW_SECONDS) finish(); };
    audio.play().catch(() => {
      if (previewRef.current !== audio) return;
      finish();
      setPreviewError("This track preview could not play.");
    });
  }

  function changeGenre(next) {
    stopPreview();
    setPreviewError("");
    if (next !== genre) {
      setCatalog({ tracks: [], loading: true, error: "" });
      setGenre(next);
    }
  }

  function changeQuery(value) {
    const typedGenre = GENRE_SEARCH.get(value.trim().toLowerCase());
    if (typedGenre) changeGenre(typedGenre);
    setQuery(value);
  }

  function pickFirst(track) {
    stopPreview();
    setPreviewError("");
    setShortlist({ matches: [], loading: true, error: "" });
    setSongOne(track);
  }

  function goBack() {
    planRef.current?.abort();
    setBuilding(null);
    setPlanError("");
    setPreviewError("");
    stopPreview();
    setSongOne(null);
  }

  async function buildMix(track) {
    if (planRef.current && !planRef.current.signal.aborted) return;
    stopPreview();
    setPreviewError("");
    setPlanError("");
    const controller = new AbortController();
    planRef.current = controller;
    setBuilding(track.title);
    try {
      const result = await requestMix("plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackAId: songOne.id, trackBId: track.id }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) onReady(result);
    } catch (error) {
      if (!controller.signal.aborted) setPlanError(error.message);
    } finally {
      if (planRef.current === controller) {
        planRef.current = null;
        if (!controller.signal.aborted) setBuilding(null);
      }
    }
  }

  const search = query.trim().toLowerCase();
  const filteredTracks = !search || GENRE_SEARCH.has(search)
    ? catalog.tracks
    : catalog.tracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(search));
  const tracks = songOne ? shortlist.matches : filteredTracks;
  const { loading, error } = songOne ? shortlist : catalog;
  const genreLabel = GENRES.find(([value]) => value === genre)[1];

  return <dialog className="custom-mix-picker" ref={dialogRef} aria-labelledby="custom-mix-picker-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="custom-mix-header">
      <div>
        <div className="custom-mix-name">AI Mix</div>
        <h2 id="custom-mix-picker-title" tabIndex={-1} ref={titleRef}>Select Song {songOne ? 2 : 1}</h2>
      </div>
      <button className="mainstage-button custom-mix-close" type="button" onClick={onClose}>Close</button>
    </header>

    {songOne ? <div className="custom-mix-selected">
      <div><span className="custom-mix-deck">Deck A</span> <strong>{songOne.title}</strong> <span className="custom-mix-artist">{songOne.artist}</span></div>
      <button className="mainstage-button" type="button" onClick={goBack}>Change Song 1</button>
    </div> : <>
      {lastMix && <button className="mainstage-button custom-mix-resume" type="button" onClick={() => {
        stopPreview();
        onReady(lastMix);
      }}>Resume last AI mix</button>}
      <div className="custom-mix-genres" role="group" aria-label="Genre">
        {GENRES.map(([value, label]) => <button className="mainstage-button" type="button" key={value} aria-pressed={value === genre}
          onClick={() => { setQuery(""); changeGenre(value); }}>{label}</button>)}
      </div>
      <label className="custom-mix-search">
        <span>Search songs</span>
        <input ref={searchRef} type="search" value={query} onChange={event => changeQuery(event.currentTarget.value)}
          placeholder="Title, artist, or genre" />
      </label>
    </>}

    {loading && <p className="custom-mix-status" role="status">{songOne ? "Finding mixable tracks…" : `Loading ${genreLabel} tracks…`}</p>}
    {error && <div className="custom-mix-status">
      <p role="alert">{error}</p>
      <button className="mainstage-button" type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
    </div>}
    {previewError && <p className="custom-mix-status" role="alert">{previewError}</p>}
    {building && <p className="custom-mix-status" role="status">Gemini is analyzing both songs and building the mix with {building}…</p>}
    {planError && <p className="custom-mix-status" role="alert">{planError} Select a partner to try again.</p>}
    {!loading && !error && tracks.length === 0 && <p className="custom-mix-status" role="status">
      {songOne ? "No mixable partners found. Try a different first song."
        : search && catalog.tracks.length ? "No tracks match your search." : `No playable ${genreLabel} tracks available yet.`}
    </p>}

    {!loading && !error && tracks.length > 0 && <ul className="custom-mix-list">
      {tracks.map((track, index) => <li className="custom-mix-track" key={track.id}>
        <div className="custom-mix-track-info">
          <strong>{track.title}</strong>
          <span className="custom-mix-artist">{track.artist} · {track.bpm} BPM</span>
          {songOne && (track.reason || index === 0) && <span className="custom-mix-reason">
            {index === 0 && <strong>Recommended</strong>}{index === 0 && track.reason && " · "}{track.reason}
          </span>}
          <Credits track={track} />
        </div>
        <div className="custom-mix-actions">
          <button className="mainstage-button" type="button" disabled={!!building} aria-label={`${playing === track.id ? "Stop preview of" : "Preview"} ${track.title}`}
            onClick={() => listen(track)}>{playing === track.id ? "Stop preview" : "Listen"}</button>
          <button className={songOne && index === 0 ? "mainstage-button custom-mix-recommended" : "mainstage-button"}
            type="button" disabled={!!building} aria-label={`Select ${track.title} as Song ${songOne ? 2 : 1}`}
            onClick={() => songOne ? buildMix(track) : pickFirst(track)}>Select</button>
        </div>
      </li>)}
    </ul>}
  </dialog>;
}
