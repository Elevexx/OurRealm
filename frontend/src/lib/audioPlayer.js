// Singleton HTML5 audio player. Lightweight, no external deps.
// One <audio> element drives the whole app — Sounds page, MiniPlayer,
// detail modal — through a simple subscribe pattern.
import apiClient from "@/api/client";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
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
};

const audio = typeof window !== "undefined" ? new Audio() : null;
if (audio) {
  audio.preload = "metadata";
  audio.volume = 1;
  audio.addEventListener("loadedmetadata", () => emit({ duration: audio.duration || 0 }));
  audio.addEventListener("timeupdate",  () => emit({ position: audio.currentTime || 0 }));
  audio.addEventListener("play",        () => emit({ playing: true, loading: false, error: null }));
  audio.addEventListener("pause",       () => emit({ playing: false }));
  audio.addEventListener("ended",       () => emit({ playing: false, position: 0 }));
  audio.addEventListener("waiting",     () => emit({ loading: true }));
  audio.addEventListener("canplay",     () => emit({ loading: false }));
  audio.addEventListener("error",       () => emit({ playing: false, loading: false, error: "Playback failed" }));
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
  if (!next?.file_url) return;
  // If same track and paused, resume rather than reload
  if (current.track?.id === next.id && audio.src) {
    try { await audio.play(); } catch { /* user gesture required */ }
    emit({ playing: !audio.paused });
    return;
  }
  emit({ track: next, loading: true, position: 0, duration: 0, error: null });
  audio.src = absUrl(next.file_url);
  try {
    await audio.play();
    // Best-effort play counter — fire & forget
    apiClient.post(`/sounds/${next.id}/play`).catch(() => { /* ignore */ });
  } catch (e) {
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

export function toggle() { current.playing ? pause() : resume(); }

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
  emit({ track: null, playing: false, position: 0, duration: 0, loading: false, error: null });
}

export function formatTime(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}
