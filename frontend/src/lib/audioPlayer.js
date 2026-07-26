// Singleton HTML5 audio player. Lightweight, no external deps.
// One <audio> element drives the whole app — Sounds page, MiniPlayer,
// detail modal — through a simple subscribe pattern.
import apiClient from "@/api/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");

/**
 * Resolve a sound's playable URL. Delegates to the shared media-URL
 * resolver so every surface — feed, sounds page, post popup, mini
 * player — agrees on the canonical playback path. The resolver
 * rewrites legacy `/api/sounds/file/<name>` URLs AND public R2 CDN
 * URLs through `/api/media/audio/<name>`, which mints a fresh signed
 * GET on every fetch (immune to R2 public-access regressions).
 */
export function resolveSoundUrl(track) {
  const u = typeof track === "string"
    ? track
    : (track?.file_url || track?.audio_url || track?.media_url || track?.url || "");
  return resolveMediaUrl(u);
}

function absUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${BACKEND}${u}`;
  return u;
}

const subscribers = new Set();
let current = {
  track: null,           // { id, title, artist, cover_url, file_url, ... }
  playing: false,
  position: 0,
  duration: 0,
  volume: 1,
  loading: false,
  error: null,
  queue: [],             // ordered track list (playlist playback)
  queueIndex: -1,
  shuffle: false,
  repeat: false,
  queueName: null,       // e.g. "playlist:<id>" / "soundtrack:<username>"
};

let _failStreak = 0;

const audio = typeof window !== "undefined" ? new Audio() : null;
if (audio) {
  audio.preload = "metadata";
  audio.volume = 1;
  audio.addEventListener("loadedmetadata", () => emit({ duration: audio.duration || 0 }));
  audio.addEventListener("timeupdate",  () => emit({ position: audio.currentTime || 0 }));
  audio.addEventListener("play",        () => { _failStreak = 0; emit({ playing: true, loading: false, error: null }); });
  audio.addEventListener("pause",       () => emit({ playing: false }));
  audio.addEventListener("ended",       () => {
    if (current.queue.length && current.queueIndex >= 0) { _step(1, true); return; }
    emit({ playing: false, position: 0 });
  });
  audio.addEventListener("waiting",     () => emit({ loading: true }));
  audio.addEventListener("canplay",     () => emit({ loading: false }));
  audio.addEventListener("error",       () => {
    // Surface the real MediaError + the failing URL + Range probe so
    // production triage doesn't need a screenshare. Codes:
    //   1 MEDIA_ERR_ABORTED       2 MEDIA_ERR_NETWORK
    //   3 MEDIA_ERR_DECODE        4 MEDIA_ERR_SRC_NOT_SUPPORTED
    const err = audio.error;
    const src = audio.src || "(no src)";
    // eslint-disable-next-line no-console
    console.warn(
      `[audio] playback error code=${err?.code} msg=${err?.message || ""} src=${src}`
    );
    // Best-effort: probe the URL so we capture HTTP status + Content-Type
    // in the same log line — turns "Playback failed" into something
    // we can actually action against R2 / the legacy route.
    if (src && /^https?:\/\//i.test(src)) {
      fetch(src, { method: "GET", headers: { Range: "bytes=0-0" }, cache: "no-store" })
        .then((r) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[audio] probe status=${r.status} ct=${r.headers.get("content-type")} ` +
            `cors=${r.headers.get("access-control-allow-origin") || "none"} url=${src}`
          );
        })
        .catch((pe) => {
          // eslint-disable-next-line no-console
          console.warn(`[audio] probe failed: ${pe} url=${src}`);
        });
    }
    emit({
      playing: false,
      loading: false,
      error: `Playback failed (code ${err?.code || "?"}).`,
    });
  });
}

function emit(patch) {
  current = { ...current, ...patch };
  for (const fn of subscribers) {
    try { fn(current); } catch { /* ignore */ }
  }
}

export function getState() { return current; }

export function subscribe(fn) {
  subscribers.add(fn);
  try { fn(current); } catch { /* ignore */ }
  return () => subscribers.delete(fn);
}

export async function play(track) {
  if (!audio) return;
  const next = track || current.track;
  if (!next) return;
  const resolved = resolveSoundUrl(next);
  if (!resolved) {
    // eslint-disable-next-line no-console
    console.warn("[audio] play() aborted — no resolvable URL for track", next);
    emit({ track: next, playing: false, loading: false, error: "This sound is unavailable." });
    return;
  }
  // Keep the queue pointer honest: playing a track outside the queue
  // clears the queue; playing a queue member syncs the index.
  if (current.queue.length) {
    const qi = current.queue.findIndex((q) => q.id === next.id);
    if (qi === -1) emit({ queue: [], queueIndex: -1, queueName: null });
    else if (qi !== current.queueIndex) emit({ queueIndex: qi });
  }
  // If same track and just paused, resume rather than re-load.
  if (current.track?.id === next.id && audio.src) {
    try {
      await audio.play();
      emit({ playing: !audio.paused });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[audio] resume failed: ${e?.name || e} src=${audio.src}`);
      emit({ playing: false, error: "Tap play to start (autoplay blocked)." });
    }
    return;
  }
  emit({ track: next, loading: true, position: 0, duration: 0, error: null });
  // Switch source. Some mobile browsers (iOS Safari in particular)
  // require an explicit load() after assigning a new `src` for the new
  // media to actually start buffering. Without it, the play() promise
  // resolves but no `timeupdate` events fire and the audio never plays.
  audio.preload = "auto";
  audio.src = resolved;
  try { audio.load(); } catch { /* not all UAs implement load() */ }
  try {
    await audio.play();
    // Best-effort play counter — fire & forget
    apiClient.post(`/sounds/${next.id}/play`).catch(() => { /* ignore */ });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[audio] play() rejected: ${e?.name || e} msg=${e?.message || ""} src=${resolved}`
    );
    emit({ playing: false, loading: false, error: "Tap play to start (autoplay blocked)." });
  }
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: next.title || "OurRealm Track",
        artist: next.artist_username ? `@${next.artist_username}` : "OurRealm",
        artwork: next.cover_url ? [{ src: absUrl(next.cover_url), sizes: "512x512", type: "image/jpeg" }] : [],
      });
      navigator.mediaSession.setActionHandler("play", () => resume());
      navigator.mediaSession.setActionHandler("pause", () => pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => next());
      navigator.mediaSession.setActionHandler("previoustrack", () => prev());
    } catch { /* ignore */ }
  }
}

export function pause() {
  if (!audio) return;
  audio.pause();
  emit({ playing: false });
}

export async function resume() {
  if (!audio) return;
  if (!current.track) return;
  try { await audio.play(); emit({ playing: true }); } catch { /* ignore */ }
}

export function toggle() {
  if (!audio) return;
  // Trust the live <audio> element rather than the cached `current.playing`
  // flag — the latter can lag behind when the browser fires "play"/"pause"
  // events asynchronously (especially on iOS Safari).
  if (audio.paused) resume(); else pause();
}

export function seek(seconds) {
  if (!audio) return;
  if (!isFinite(seconds)) return;
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
}

export function setVolume(v) {
  if (!audio) return;
  const clamped = Math.max(0, Math.min(1, Number(v) || 0));
  audio.volume = clamped;
  emit({ volume: clamped });
}

export function stop() {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  emit({ track: null, playing: false, position: 0, duration: 0, loading: false, error: null,
         queue: [], queueIndex: -1, queueName: null });
}

/* ------------------------- queue playback (Bundle 1b) ------------------------- */
// Plays an ordered track list through THIS singleton player — no second
// audio element. Unavailable Sounds are skipped by the error handler.
export function playQueue(tracks, startIndex = 0, opts = {}) {
  const q = (tracks || []).filter((t) => t && t.id && resolveSoundUrl(t));
  if (!q.length) return;
  const idx = Math.max(0, Math.min(Number(startIndex) || 0, q.length - 1));
  _failStreak = 0;
  emit({ queue: q, queueIndex: idx, shuffle: !!opts.shuffle, repeat: !!opts.repeat,
         queueName: opts.name || null });
  play(q[idx]);
}

function _step(dir, auto = false) {
  const { queue, queueIndex, shuffle, repeat } = current;
  if (!queue.length) return;
  let nextIdx;
  if (shuffle && queue.length > 1 && dir > 0) {
    do { nextIdx = Math.floor(Math.random() * queue.length); } while (nextIdx === queueIndex);
  } else {
    nextIdx = queueIndex + dir;
    if (nextIdx >= queue.length) {
      if (repeat) nextIdx = 0;
      else { if (!auto) return; emit({ playing: false }); return; }
    }
    if (nextIdx < 0) nextIdx = repeat ? queue.length - 1 : 0;
  }
  emit({ queueIndex: nextIdx });
  play(queue[nextIdx]);
}

export function next() { _step(1); }
export function prev() { _step(-1); }
export function toggleShuffle() { emit({ shuffle: !current.shuffle }); }
export function toggleRepeat() { emit({ repeat: !current.repeat }); }

export function formatTime(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}
