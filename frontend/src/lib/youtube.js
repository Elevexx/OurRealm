/**
 * YouTube embed compliance helpers (Feb 18 2026).
 *
 * OurRealm must use only YouTube's standard embedded player behaviour:
 *   • No background playback
 *   • No audio-only playback
 *   • No ad blocking
 *   • No hidden / minimised playback
 *   • No modified player UI (no controls=0, no modestbranding=1 hacks)
 *   • User-initiated playback only — autoplay is reserved for the exact
 *     moment the user taps Play.
 *
 * This module is intentionally tiny and side-effect-free: it exposes
 * three pure helpers plus a global player registry so the route-change
 * cleanup hook (see `useYouTubeRouteCleanup`) can stop / destroy any
 * active player when the user navigates away or the tab is hidden.
 */

const _activePlayers = new Set();
let _docListenerAttached = false;

// ── URL helpers ─────────────────────────────────────────────────────────
/**
 * Returns the 11-char (or longer) video id for any YouTube URL we
 * recognise — long form, short form, shorts, embed form. Returns null
 * for anything else.
 */
export function detectYouTubeUrl(raw) {
  if (!raw) return null;
  const url = String(raw);
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([\w-]{6,})/i,
  );
  return m ? m[1] : null;
}

/**
 * Build a standard youtube-nocookie embed URL. We DO NOT pass
 * `controls=0`, `modestbranding=1`, or `rel=0` — the player must render
 * with YouTube's standard UI, branding, links, and related-video
 * behaviour. `enablejsapi=1` is required so we can call
 * `stopVideo()`/`destroy()` on route changes and visibility changes.
 *
 *   @param {string} videoId
 *   @param {{ autoplay?: boolean }} opts
 *     autoplay:true is set ONLY when the user just tapped Play. We
 *     never autoplay without an explicit user gesture, and we never
 *     autoplay with sound — YouTube handles mute internally if the
 *     browser blocks the gesture, and the user can unmute via the
 *     player's own UI.
 */
export function getYouTubeEmbedUrl(videoId, opts = {}) {
  const params = new URLSearchParams({
    enablejsapi: "1",
    // `playsinline=1` is the inline-rendering hint (no full-screen
    // takeover on iOS) — not a control modifier. Spec-compliant.
    playsinline: "1",
  });
  if (typeof window !== "undefined") {
    params.set("origin", window.location.origin);
  }
  if (opts.autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

// ── Player registry ────────────────────────────────────────────────────
export function registerYouTubePlayer(player) {
  if (player) _activePlayers.add(player);
  _attachDocListenerOnce();
}

export function unregisterYouTubePlayer(player) {
  _activePlayers.delete(player);
}

/**
 * Stop & destroy every currently-mounted YT.Player. Called by the
 * route-change cleanup hook so navigating from /feed → /home (or any
 * other route) immediately silences any active YouTube player even if
 * the previous page's React subtree hasn't unmounted yet.
 */
export function cleanupYouTubePlayers() {
  for (const p of _activePlayers) {
    try { p.stopVideo?.(); } catch (_e) { /* noop */ }
    try { p.destroy?.(); }   catch (_e) { /* noop */ }
  }
  _activePlayers.clear();
}

/**
 * Pause (don't destroy) every active player. Used when the browser tab
 * becomes hidden — destroying would force the user to reload state on
 * return, but pausing is enough to silence background audio.
 */
export function pauseAllYouTubePlayers() {
  for (const p of _activePlayers) {
    try { p.pauseVideo?.(); } catch (_e) { /* noop */ }
  }
}

function _attachDocListenerOnce() {
  if (_docListenerAttached || typeof document === "undefined") return;
  _docListenerAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pauseAllYouTubePlayers();
    }
  });
}
