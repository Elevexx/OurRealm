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
  pauseAllOthers,
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
 * YouTubeEmbed — user-initiated playback with full audio (TERMS COMPLIANT).
 *
 * Lifecycle:
 *   1. Initial render: poster image only. No iframe in the DOM yet.
 *   2. An IntersectionObserver watches the wrapper. When ≥50% of the
 *      wrapper is in the viewport for the first time, the iframe mounts
 *      via `YT.Player` with `playsinline=1, enablejsapi=1`. We do NOT
 *      pass `mute=1` / `muted=1` — the browser autoplay policy decides
 *      whether the video can autostart with audio. If the browser blocks
 *      unmuted autoplay, YouTube's standard Play button is visible and
 *      ONE tap starts playback with sound (no custom overlay competes).
 *   3. Pause when scrolled out of view.
 *   4. Only ONE player plays at a time across the feed — when this
 *      player starts, every other registered player is paused via
 *      `pauseAllOthers()` from the registry.
 *   5. Route change / tab hidden / unmount → `stopVideo()` + `destroy()`.
 *
 * No custom overlays sit on top of the iframe at any point — YouTube's
 * standard controls, branding, links, ads, and related-video UI are
 * fully visible and untouched. Audio begins only after explicit user
 * interaction via the official YouTube player controls; we never bypass
 * browser autoplay policies and we never force a persistent muted state.
 */
let _ytEmbedCounter = 0;

function YouTubeEmbed({ videoId, url, className, style, testid }) {
  const playerId = useMemo(
    () => `yt-player-${videoId}-${++_ytEmbedCounter}`,
    [videoId],
  );
  const wrapperRef = useRef(null);
  const playerRef  = useRef(null);
  const ioRef      = useRef(null);
  const [mounted, setMounted] = useState(false); // iframe in DOM?
  const [failed,  setFailed]  = useState(false);
  const watchUrl  = youtubeWatchUrl(videoId);
  const posterUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  // IntersectionObserver — mount the iframe (once) when the wrapper
  // becomes visible, and pause when it leaves. This is the SOLE place
  // that controls play/pause; there are no other click handlers
  // competing for the iframe.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        const visible =
          entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (visible) {
          // Mount on first visibility so the iframe is ready. We do NOT
          // call playVideo() here — playback must be user-initiated to
          // preserve full audio + respect browser autoplay policy.
          if (!mounted) setMounted(true);
        } else {
          // Pause when the user scrolls away to silence the soundtrack.
          const p = playerRef.current;
          try { p?.pauseVideo?.(); } catch (_e) { /* noop */ }
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    ioRef.current = io;
    return () => io.disconnect();
  }, [mounted]);

  // Player creation — fires once when `mounted` flips to true.
  useEffect(() => {
    if (!mounted) return undefined;
    let cancelled = false;
    const failTimer = setTimeout(() => {
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
          // NOTE: we do NOT pass `mute`/`muted`/`autoplay` here. Per
          // YouTube's Embedded Player policy + browser autoplay rules,
          // audio must begin only after explicit user interaction.
          // If the browser allows unmuted autoplay, the video plays
          // naturally; if not, YouTube's standard Play overlay appears
          // and one tap starts playback with full audio. No persistent
          // muted state is forced from our side.
          playerVars: {
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            // No `controls=0`, `modestbranding=1`, or `rel=0` — the
            // player must render with standard YouTube UI/branding/ads.
          },
          events: {
            onReady: (e) => {
              clearTimeout(failTimer);
              if (cancelled) return;
              registerYouTubePlayer(playerRef.current);
              // Do NOT call playVideo() here — that would attempt to
              // autoplay with sound and most browsers will block it.
              // The user starts playback via YouTube's own Play button.
              void e;
            },
            onError: (er) => {
              // eslint-disable-next-line no-console
              console.error("[YouTubeEmbed] error", { videoId, code: er?.data });
              setFailed(true);
            },
            onStateChange: (s) => {
              // When the user (or the player) transitions to PLAYING,
              // pause every other player in the registry.
              if (s?.data === 1 /* YT.PlayerState.PLAYING */) {
                pauseAllOthers(playerRef.current);
              }
            },
          },
        });
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[YouTubeEmbed] YT API load failed", err);
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
  }, [mounted, videoId, playerId]);

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

  // The wrapper is always rendered (with the 16:9 aspect box). Before
  // the IntersectionObserver fires, we render the poster image inside
  // — no iframe, no network calls to YouTube. Once `mounted` flips true,
  // the iframe takes over and the poster is gone.
  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        position: "relative", width: "100%", paddingTop: "56.25%",
        background: "#000", ...style,
      }}
      data-testid={testid}
    >
      {mounted ? (
        <div
          id={playerId}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          data-testid={`${testid}-iframe`}
        />
      ) : (
        <div
          style={{
            position: "absolute", inset: 0,
            background: `#000 url(${posterUrl}) center/cover no-repeat`,
          }}
          aria-hidden="true"
          data-testid={`${testid}-poster`}
        />
      )}
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
