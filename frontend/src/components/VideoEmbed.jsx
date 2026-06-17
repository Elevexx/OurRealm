/**
 * VideoEmbed — universal inline video renderer.
 *
 *   • Uploaded files (.mp4/.webm/.ogg/.mov) → <AutoplayVideo/> with the
 *     native <video> element, intersection-observer autoplay/pause, and
 *     our custom mute pill.
 *   • YouTube URLs (youtu.be / youtube.com / shorts) → privacy-enhanced
 *     iframe at youtube-nocookie.com — STABLE: rendered once, never
 *     remounted on scroll. Provider controls (incl. sound) are visible.
 *   • Vimeo URLs → player.vimeo.com iframe (same stability guarantee).
 *   • Anything else → click-through preview card with a Play affordance.
 *
 * The previous implementation rebuilt the iframe whenever the video
 * crossed the 50% visibility line (via a `key={id:autoplay}` swap). That
 * produced YouTube black-boxes after refresh + on every scroll because
 * the embed reloaded with `autoplay=1` from a cold state, which the
 * provider often rejects, and because the React key churn dropped state.
 * We now mount the iframe a single time with `autoplay=1&mute=1` —
 * YouTube ignores the autoplay hint when its policy disallows it AND we
 * surface a tap-to-play overlay only until the user interacts once.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, ExternalLink, AlertCircle, Volume2, VolumeX } from "lucide-react";
import AutoplayVideo from "@/components/AutoplayVideo";
import { loadYouTubeApi } from "@/lib/loadYouTubeApi";

export function classifyVideoUrl(raw) {
  if (!raw) return { kind: "none" };
  const url = String(raw);
  // PRIORITY ORDER — uploaded files (or our own video server) always win
  // over the iframe/embed branch, even if the URL happens to contain a
  // "vimeo.com" query parameter or similar. iOS Safari needs the native
  // <video> path with autoplay + playsInline, not an iframe.
  const stripped = url.split("?")[0].split("#")[0];
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(stripped) || url.includes("/api/videos/")) {
    return { kind: "file", url };
  }
  // YouTube — long form, short form, shorts, embed form. All collapse to
  // a stable youtube-nocookie embed URL with the 11-char video id.
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([\w-]{6,})/i);
  if (m) return { kind: "youtube", id: m[1], url };
  // Vimeo — handles `vimeo.com/<id>` and `vimeo.com/video/<id>`.
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
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
 * YouTubeEmbed — a single YouTube post's iframe, controlled via the
 * official YouTube IFrame Player API so the audio button can call real
 * player methods (`unMute`, `setVolume`, `playVideo`) synchronously
 * inside the user's tap. iOS Safari REQUIRES that those calls happen
 * inside the gesture handler — no timers, no async chains.
 *
 * Each instance owns its own `YT.Player` against a unique <div id> so
 * multiple YouTube posts in the feed never share state.
 */
let _ytEmbedCounter = 0;

function YouTubeEmbed({ videoId, url, className, style, testid }) {
  // Stable, unique placeholder id — the YT API replaces this div with an iframe.
  const playerId = useMemo(
    () => `yt-player-${videoId}-${++_ytEmbedCounter}`,
    [videoId],
  );
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const ioRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [userPrefersSound, setUserPrefersSound] = useState(false);
  // True once the user has tapped the sound button at least once. If the
  // player is still muted after that, we surface a fallback hint asking
  // them to tap inside the iframe (the spec calls this out for iOS).
  const [soundTapAttempted, setSoundTapAttempted] = useState(false);
  const watchUrl = youtubeWatchUrl(videoId);

  // Create the player once per (videoId, playerId).
  useEffect(() => {
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
        // Mount only when the placeholder is present.
        if (!document.getElementById(playerId)) return;
        playerRef.current = new YT.Player(playerId, {
          videoId,
          playerVars: {
            // Spec'd query parameters.
            autoplay: 1,
            mute: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            // `origin` helps the API postMessage handshake on Safari.
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              clearTimeout(failTimer);
              if (cancelled) return;
              setReady(true);
              // Autoplay-muted is the only reliable default — the spec also
              // calls this out. We'll honour the user's audio preference
              // when they tap the sound button.
              try { e.target.mute(); e.target.playVideo(); } catch (err) { /* noop */ }
              setIsMuted(true);
            },
            onError: (e) => {
              // eslint-disable-next-line no-console
              console.error("[YouTubeEmbed] player error", { videoId, code: e?.data });
              setFailed(true);
            },
            onStateChange: () => {
              // Re-check mute state after any state transition so the UI
              // stays in sync with what the user did inside the player.
              try {
                const p = playerRef.current;
                if (p && typeof p.isMuted === "function") setIsMuted(!!p.isMuted());
              } catch (err) { /* noop */ }
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
      try { playerRef.current?.destroy?.(); } catch (e) { /* noop */ }
      playerRef.current = null;
    };
  }, [videoId, playerId]);

  // Pause when scrolled out of view, resume with the user's last audio
  // preference when back in view. One IntersectionObserver per post.
  useEffect(() => {
    if (!ready || !containerRef.current) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        const p = playerRef.current;
        if (!p) return;
        try {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (userPrefersSound) { p.unMute?.(); p.setVolume?.(100); }
            else p.mute?.();
            p.playVideo?.();
          } else {
            p.pauseVideo?.();
          }
        } catch (e) { /* noop */ }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(containerRef.current);
    ioRef.current = io;
    return () => io.disconnect();
  }, [ready, userPrefersSound]);

  // ⚡ Synchronous unmute — MUST stay inside the React tap handler. No
  // timers, no awaits, no setState-before-call. iOS Safari and Home
  // Screen PWAs reject the audio gesture otherwise.
  const onSoundTap = (e) => {
    e.stopPropagation();
    const p = playerRef.current;
    if (!p) return;
    try {
      p.unMute();
      p.setVolume(100);
      p.playVideo();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[YouTubeEmbed] unmute failed", err);
    }
    // Read back immediately. If still muted, we leave the button visible
    // and show the fallback hint.
    let stillMuted = true;
    try { stillMuted = !!p.isMuted?.(); } catch (err) { /* noop */ }
    setIsMuted(stillMuted);
    setUserPrefersSound(!stillMuted);
    setSoundTapAttempted(true);
  };

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

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative", width: "100%", paddingTop: "56.25%",
        background: "#000", ...style,
      }}
      data-testid={testid}
    >
      {/* YT.Player replaces this <div> with an <iframe>. */}
      <div
        id={playerId}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        data-testid={`${testid}-iframe`}
      />

      {/* Sound button — visible while the player reports muted. Calls
          the YT.Player methods SYNCHRONOUSLY inside the tap handler. */}
      {ready && isMuted && (
        <button
          type="button"
          onClick={onSoundTap}
          onTouchEnd={onSoundTap}
          className="absolute"
          style={{
            left: 12, bottom: 12,
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 999,
            padding: "0.4rem 0.75rem",
            fontSize: 12,
            display: "flex", alignItems: "center", gap: 6,
            cursor: "pointer",
            zIndex: 3,
          }}
          data-testid={`${testid}-sound-hint`}
          aria-label="Tap for sound"
        >
          <VolumeX size={12} /> Tap for sound
        </button>
      )}

      {/* Fallback hint — appears only when an earlier tap on our sound
          button failed to actually un-mute the player (the policy
          rejected the call). Sits above the iframe so it's visible, but
          uses `pointer-events: none` so it cannot intercept clicks on
          the actual YouTube controls. */}
      {ready && isMuted && soundTapAttempted && (
        <div
          className="absolute"
          style={{
            left: 0, right: 0, top: 0,
            margin: "10px auto",
            width: "fit-content",
            maxWidth: "90%",
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 999,
            padding: "0.35rem 0.7rem",
            fontSize: 11,
            zIndex: 4,
            pointerEvents: "none",
          }}
          data-testid={`${testid}-sound-fallback`}
        >
          Tap the YouTube video itself to enable sound
        </div>
      )}

      {ready && !isMuted && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const p = playerRef.current;
            if (!p) return;
            try { p.mute(); } catch (err) { /* noop */ }
            setIsMuted(true);
            setUserPrefersSound(false);
          }}
          className="absolute"
          style={{
            right: 12, bottom: 12,
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 999,
            width: 32, height: 32,
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 3,
          }}
          data-testid={`${testid}-sound-mute`}
          aria-label="Mute"
        >
          <Volume2 size={14} />
        </button>
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
