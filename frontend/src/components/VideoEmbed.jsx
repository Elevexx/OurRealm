/**
 * VideoEmbed — universal inline video renderer.
 *
 *   • Uploaded files (.mp4/.webm/.ogg/.mov) → <AutoplayVideo/> with the
 *     native <video> element, intersection-observer autoplay/pause, and
 *     our custom mute pill.
 *   • YouTube URLs (youtu.be / youtube.com / shorts) → poster + Play
 *     overlay until the user explicitly taps Play. On tap we mount the
 *     official YouTube IFrame Player against `youtube-nocookie.com`
 *     with `enablejsapi=1` so we can `stopVideo()` / `destroy()` on
 *     route change, page-visibility-hidden, unmount, or modal close.
 *     We do NOT pass `controls=0`, `modestbranding=1`, or `rel=0` —
 *     the player must render YouTube's standard controls, branding,
 *     links, and related-video behaviour. No custom overlays cover
 *     the player once it starts.
 *   • Vimeo URLs → player.vimeo.com iframe (same stability guarantee).
 *   • Anything else → click-through preview card with a Play affordance.
 *
 * The YouTube embed is intentionally user-initiated only — there is no
 * autoplay on mount and no intersection-observer auto-resume. Spec
 * compliance: see /app/frontend/src/lib/youtube.js for the registry +
 * cleanup primitives and `<YouTubeRouteCleanup />` in App.js for the
 * route-change cleanup hook.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, ExternalLink, AlertCircle } from "lucide-react";
import AutoplayVideo from "@/components/AutoplayVideo";
import { loadYouTubeApi } from "@/lib/loadYouTubeApi";
import {
  detectYouTubeUrl,
  registerYouTubePlayer,
  unregisterYouTubePlayer,
} from "@/lib/youtube";

export function classifyVideoUrl(raw) {
  if (!raw) return { kind: "none" };
  const url = String(raw);
  // PRIORITY ORDER — uploaded files (or our own video server) always win
  // over the iframe/embed branch, even if the URL happens to contain a
  // "vimeo.com" query parameter or similar.
  const stripped = url.split("?")[0].split("#")[0];
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(stripped) || url.includes("/api/videos/")) {
    return { kind: "file", url };
  }
  // YouTube — long form, short form, shorts, embed form.
  const ytId = detectYouTubeUrl(url);
  if (ytId) return { kind: "youtube", id: ytId, url };
  // Vimeo — handles `vimeo.com/<id>` and `vimeo.com/video/<id>`.
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (m) return { kind: "vimeo", id: m[1], url };
  return { kind: "external", url };
}

export function youtubeWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}
export function vimeoWatchUrl(id) {
  return `https://vimeo.com/${id}`;
}

/**
 * YouTubeEmbed — user-initiated YouTube playback.
 *
 * Render lifecycle:
 *   1. Poster image + Play button — no iframe in the DOM, no network
 *      requests to YouTube.
 *   2. User taps Play → mount a `YT.Player` via the IFrame API against
 *      a placeholder div. The player loads the video and (because the
 *      mount happened inside the user's tap) is allowed by browser
 *      policy to play with sound. We register the player so route-change
 *      / visibility-change hooks can stop it.
 *   3. On unmount we `stopVideo()` + `destroy()` and unregister.
 *
 * No custom mute button, no z-index overlay over the iframe, no
 * pointer-events: none banners — once the player is up, only YouTube's
 * own controls and ad UI exist on top of the iframe.
 */
let _ytEmbedCounter = 0;

function YouTubeEmbed({ videoId, url, className, style, testid }) {
  const playerId = useMemo(
    () => `yt-player-${videoId}-${++_ytEmbedCounter}`,
    [videoId],
  );
  const playerRef = useRef(null);
  const [active, setActive] = useState(false); // user tapped Play?
  const [failed, setFailed] = useState(false);
  const watchUrl = youtubeWatchUrl(videoId);
  const posterUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  // Mount the player only after the user taps Play. This guarantees
  // user-initiated playback (no autoplay-on-mount, no intersection
  // observer auto-resume) and means no iframe exists in the DOM until
  // the user explicitly opts in.
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let failTimer = setTimeout(() => {
      if (!cancelled && !playerRef.current) {
        // eslint-disable-next-line no-console
        console.warn("[YouTubeEmbed] API load timeout", { videoId });
        setFailed(true);
      }
    }, 8000);

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        if (!document.getElementById(playerId)) return;
        playerRef.current = new YT.Player(playerId, {
          videoId,
          playerVars: {
            // Autoplay is set BECAUSE this mount happens synchronously
            // inside the user's tap — browser policies treat this as
            // user-initiated and allow playback with sound. We never
            // mount autoplay outside of a tap.
            autoplay: 1,
            // playsinline is the inline-rendering hint, not a control
            // modifier. Required so iOS doesn't take the player full
            // screen on tap.
            playsinline: 1,
            // Required so we can call stopVideo()/destroy() on cleanup.
            enablejsapi: 1,
            origin: window.location.origin,
            // Intentionally NOT setting `controls`, `modestbranding`,
            // or `rel` — YouTube renders its standard player UI.
          },
          events: {
            onReady: () => {
              clearTimeout(failTimer);
              if (cancelled) return;
              registerYouTubePlayer(playerRef.current);
            },
            onError: (e) => {
              // eslint-disable-next-line no-console
              console.error("[YouTubeEmbed] player error", { videoId, code: e?.data });
              setFailed(true);
            },
          },
        });
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[YouTubeEmbed] failed to load YT API", err);
        setFailed(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(failTimer);
      const p = playerRef.current;
      try { p?.stopVideo?.(); } catch (_e) { /* noop */ }
      try { p?.destroy?.();   } catch (_e) { /* noop */ }
      unregisterYouTubePlayer(p);
      playerRef.current = null;
    };
  }, [active, videoId, playerId]);

  if (failed) {
    return (
      <div
        className={className}
        style={{
          ...style,
          background: "var(--surface-2)",
          border: "1px solid var(--border-col)",
          borderRadius: "var(--radius)",
          padding: 16,
          display: "flex", alignItems: "center", gap: 10,
          color: "var(--text-main)", fontSize: 13,
        }}
        data-testid={`${testid}-failed`}
      >
        <AlertCircle size={16} style={{ color: "#FF8080", flexShrink: 0 }} />
        <span className="flex-1">Video failed to load.</span>
        <a
          href={watchUrl} target="_blank" rel="noopener noreferrer"
          className="or-chip"
          data-testid={`${testid}-open-external`}
        >
          <ExternalLink size={12} /> Open on YouTube
        </a>
      </div>
    );
  }

  // Before the user taps Play — render the poster + tap-to-play button.
  // No iframe yet, so no network calls to YouTube and no possibility of
  // background audio.
  if (!active) {
    return (
      <div
        className={className}
        style={{
          position: "relative", width: "100%", paddingTop: "56.25%",
          background: "#000", ...style,
        }}
        data-testid={testid}
      >
        <button
          type="button"
          onClick={() => setActive(true)}
          data-testid={`${testid}-play`}
          aria-label="Play video on YouTube embed"
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            background: `#000 url(${posterUrl}) center/cover no-repeat`,
            border: 0, padding: 0,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 64, height: 64, borderRadius: 999,
              background: "rgba(0,0,0,0.62)",
              border: "2px solid rgba(255,255,255,0.85)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff",
            }}
          >
            <Play size={26} fill="#fff" />
          </span>
        </button>
      </div>
    );
  }

  // After tap — the iframe lives at full size with YouTube's own
  // controls. NO overlays sit on top of the iframe.
  return (
    <div
      className={className}
      style={{
        position: "relative", width: "100%", paddingTop: "56.25%",
        background: "#000", ...style,
      }}
      data-testid={testid}
    >
      <div
        id={playerId}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        data-testid={`${testid}-iframe`}
      />
    </div>
  );
}

export default function VideoEmbed({
  url,
  className = "",
  style,
  testid = "video-embed",
}) {
  const info = useMemo(() => classifyVideoUrl(url), [url]);
  const iframeRef = useRef(null);
  const failTimer = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [userTapped, setUserTapped] = useState(false);

  useEffect(() => {
    if (info.kind !== "vimeo") return undefined;
    setLoaded(false); setFailed(false); setUserTapped(false);
    failTimer.current = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn("[VideoEmbed] vimeo iframe load timeout", { id: info.id, url: info.url });
      setFailed(true);
    }, 6000);
    return () => clearTimeout(failTimer.current);
  }, [info.kind, info.id, info.url]);

  if (info.kind === "none") return null;

  if (info.kind === "file") {
    return (
      <AutoplayVideo
        src={info.url}
        className={`w-full ${className}`}
        style={{ maxHeight: 480, ...style }}
        testid={testid}
      />
    );
  }

  if (info.kind === "youtube") {
    return (
      <YouTubeEmbed
        videoId={info.id}
        url={info.url}
        className={className}
        style={style}
        testid={testid}
      />
    );
  }

  if (info.kind === "vimeo") {
    const src = `https://player.vimeo.com/video/${info.id}?dnt=1&muted=1&autoplay=1`;
    const watchUrl = vimeoWatchUrl(info.id);

    if (failed) {
      return (
        <div
          className={className}
          style={{
            ...style,
            background: "var(--surface-2)",
            border: "1px solid var(--border-col)",
            borderRadius: "var(--radius)",
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--text-main)",
            fontSize: 13,
          }}
          data-testid={`${testid}-failed`}
        >
          <AlertCircle size={16} style={{ color: "#FF8080", flexShrink: 0 }} />
          <span className="flex-1">Video failed to load.</span>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="or-chip"
            data-testid={`${testid}-open-external`}
          >
            <ExternalLink size={12} /> Open on Vimeo
          </a>
        </div>
      );
    }

    return (
      <div
        className={className}
        style={{
          position: "relative", width: "100%", paddingTop: "56.25%",
          background: "#000", ...style,
        }}
        data-testid={testid}
      >
        <iframe
          ref={iframeRef}
          src={src}
          title="Video player"
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => { setLoaded(true); clearTimeout(failTimer.current); }}
          onError={() => {
            // eslint-disable-next-line no-console
            console.error("[VideoEmbed] vimeo iframe error", { id: info.id, url: info.url });
            setFailed(true); clearTimeout(failTimer.current);
          }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          data-testid={`${testid}-iframe`}
        />
      </div>
    );
  }

  // External / unknown provider — click-through preview card.
  return (
    <a
      href={info.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 p-3 ${className}`}
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-col)",
        borderRadius: "var(--radius)",
        color: "var(--text-main)",
        textDecoration: "none",
        ...style,
      }}
      data-testid={`${testid}-external`}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="rounded-full flex items-center justify-center shrink-0"
        style={{ width: 36, height: 36, background: "var(--primary)", color: "var(--primary-fg)" }}
      >
        <Play size={16} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          External video
        </span>
        <span className="block text-sm break-all">{info.url}</span>
      </span>
      <ExternalLink size={14} style={{ color: "var(--text-muted)" }} />
    </a>
  );
}
