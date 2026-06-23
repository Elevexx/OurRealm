/**
 * mediaUrl.js — long-lived compatibility layer for video & sound URLs.
 *
 * The product has evolved through multiple storage shapes:
 *   1. Early uploads stored absolute URLs that pinned a specific
 *      preview hostname (broke after deployment / hostname change).
 *   2. Current uploads store RELATIVE paths under /api/videos/<name>,
 *      /api/sounds/<name>, /api/images/<name> — the right shape.
 *   3. A handful of seed posts contain placeholder URLs
 *      (e.g. /api/videos/abc.mp4) where the underlying file never
 *      existed and never will.
 *
 * Goals of this module:
 *   • Resolve any legacy or relative URL to an absolute URL pinned
 *     to the current REACT_APP_BACKEND_URL so the same database row
 *     keeps working across re-deployments and hostname changes.
 *   • Reject obviously-broken URLs (empty / null / data:application/...)
 *     before they reach a <video> or <audio> element.
 *   • Optionally probe the media via HEAD so the player NEVER mounts
 *     for a 404. The result is cached for the lifetime of the page
 *     so we don't re-probe the same URL.
 *   • Be import-safe in any component (no React, no deps).
 */

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
// Canonical R2 public base — synced with backend `R2_PUBLIC_BASE_URL`.
// Legacy sound rows that still carry `/api/sounds/file/<name>` URLs
// get rewritten to the R2 path here so they keep playing on pods
// whose local-disk fallback isn't populated (e.g. production after a
// container rotation).
const R2_BASE = "https://media.ourrealm.social";

// Domains that are ALWAYS playable without a HEAD probe (YouTube /
// Vimeo are iframe embeds, not <video>; same-origin probes would be
// blocked by CORS anyway). External http(s) URLs without an explicit
// allow-list still pass `isPlayableMediaUrl` but skip the HEAD probe.
const SKIP_PROBE_HOSTS = new Set([
  "www.youtube.com", "youtu.be", "m.youtube.com", "youtube.com",
  "www.youtube-nocookie.com", "youtube-nocookie.com",
  "vimeo.com", "player.vimeo.com",
]);

// Cache of probe results: url → boolean (true = playable, false = 404/error).
// Survives across components for the page lifetime so we never re-probe.
const probeCache = new Map();

// In-flight probes so two simultaneous mounts of the same URL share a
// single network request.
const inflightProbes = new Map();

/**
 * Normalises a media URL to its absolute form.
 *   - Empty/null/whitespace → "" (caller should bail out).
 *   - "//cdn.example.com/x.mp4" → "https://cdn.example.com/x.mp4"
 *   - "/api/videos/x.mp4" → `${BACKEND}/api/videos/x.mp4`
 *   - "http(s)://…" → unchanged
 *   - Anything else → unchanged (caller may still attempt it).
 */
export function resolveMediaUrl(url) {
  if (url === null || url === undefined) return "";
  const s = String(url).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s))         return `https:${s}`;
  // Legacy sound rows ('/api/sounds/file/<name>') → R2 CDN path.
  // Files were duplicated to R2 during the Feb 2026 migration, so the
  // rewritten URL is the canonical source of truth. If the file ever
  // disappears from R2 the player surfaces a real 404 instead of a
  // silent local-disk miss.
  if (s.startsWith("/api/sounds/file/")) {
    const name = s.slice("/api/sounds/file/".length);
    if (name && !name.includes("/") && !name.includes("..")) {
      return `${R2_BASE}/audio/${name}`;
    }
  }
  if (s.startsWith("/"))       return `${BACKEND}${s}`;
  return s;
}

/**
 * Basic shape validation — runs synchronously before any <video> or
 * <audio> element is mounted. Returns false for URLs we already know
 * to be 404 (from a previous probe) or that look structurally broken.
 *
 * NOTE: this is intentionally permissive. We want EXISTING uploads to
 * continue working even if they don't match our newest path shape.
 * The only definite rejections are: empty, javascript:, data: of a
 * non-audio/video type, and URLs cached as 404 by `probeMediaUrl`.
 */
export function isPlayableMediaUrl(url) {
  const s = resolveMediaUrl(url);
  if (!s) return false;
  if (/^javascript:/i.test(s)) return false;
  // data: URIs of an audio/video type are fine; anything else is not.
  if (/^data:/i.test(s) && !/^data:(audio|video)\//i.test(s)) return false;
  if (probeCache.get(s) === false) return false;
  return true;
}

/**
 * Probes a media URL once (via a 1-byte Range GET) and caches the
 * result for the lifetime of the page. External URLs (YouTube /
 * Vimeo) are returned `true` without a network call because:
 *   • CORS would block the probe anyway.
 *   • The native <video> / <audio> element's own `onError` handler
 *     remains the source of truth for cross-origin playback.
 *
 * Returns Promise<boolean>.
 *
 * Safe to call from a useEffect on every mount — duplicate calls
 * share the same in-flight Promise.
 */
export function probeMediaUrl(url) {
  const s = resolveMediaUrl(url);
  if (!s) return Promise.resolve(false);
  if (probeCache.has(s)) return Promise.resolve(probeCache.get(s));
  if (inflightProbes.has(s)) return inflightProbes.get(s);

  // Skip the network call for hosts where a HEAD probe is meaningless
  // or guaranteed to be blocked.
  try {
    const u = new URL(s);
    if (SKIP_PROBE_HOSTS.has(u.host.toLowerCase())) {
      probeCache.set(s, true);
      return Promise.resolve(true);
    }
  } catch { /* relative or malformed — keep going */ }

  // Use a 1-byte Range GET instead of HEAD. Reasons:
  //   • HEAD isn't supported by the current /api/videos/<name> route
  //     (returns 405) — using HEAD would mis-flag every working video
  //     as broken.
  //   • Range: bytes=0-0 returns 206 for any working file (FastAPI's
  //     StreamingResponse honours Range), 404 for a missing file, and
  //     it transfers only 1 byte so it's cheaper than a full GET.
  const p = fetch(s, {
    method:      "GET",
    headers:     { Range: "bytes=0-0" },
    credentials: "omit",
    cache:       "no-store",
  })
    .then((res) => {
      // 200 / 206 = file exists. 400 / 404 / 410 = definitely broken
      // (our backend returns 400 for an unsafe filename pattern and
      // 404 for a missing-on-disk file). Anything else (5xx, 405, 0,
      // etc.) is indeterminate — return true so the player still
      // mounts and its own onError handles edge cases.
      let ok;
      if (res.status === 200 || res.status === 206) ok = true;
      else if (res.status === 400 || res.status === 404 || res.status === 410) ok = false;
      else ok = true;
      probeCache.set(s, ok);
      inflightProbes.delete(s);
      return ok;
    })
    .catch(() => {
      // Network error, CORS block, etc. — fall through to the player's
      // own onError. We do NOT mark this URL as broken because plenty
      // of perfectly-playable external URLs reject probe requests.
      inflightProbes.delete(s);
      return true;
    });
  inflightProbes.set(s, p);
  return p;
}

/**
 * Imperatively mark a URL as broken (e.g. from a <video onError>
 * handler). Future mounts will short-circuit without trying again.
 */
export function markMediaUrlBroken(url) {
  const s = resolveMediaUrl(url);
  if (s) probeCache.set(s, false);
}
