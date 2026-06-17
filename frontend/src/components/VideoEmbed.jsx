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
import { Play, ExternalLink, AlertCircle } from "lucide-react";
import AutoplayVideo from "@/components/AutoplayVideo";

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

export default function VideoEmbed({
  url,
  className = "",
  style,
  testid = "video-embed",
}) {
  const info = useMemo(() => classifyVideoUrl(url), [url]);
  const iframeRef = useRef(null);
  const failTimer = useRef(null);
  // `loaded`: iframe fired its onload. `failed`: never loaded within 6 s.
  // `userTapped`: the user has at least once tapped the embed — used to
  // hide our "Tap to play with sound" overlay so taps reach provider UI.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [userTapped, setUserTapped] = useState(false);

  useEffect(() => {
    if (info.kind !== "youtube" && info.kind !== "vimeo") return undefined;
    setLoaded(false); setFailed(false); setUserTapped(false);
    failTimer.current = setTimeout(() => {
      // If onload hasn't fired in 6 s assume the embed was blocked
      // (CDN, network, provider). Surface the fallback card.
      // eslint-disable-next-line no-console
      console.warn("[VideoEmbed] iframe load timeout", { kind: info.kind, id: info.id, url: info.url });
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

  if (info.kind === "youtube" || info.kind === "vimeo") {
    const src =
      info.kind === "youtube"
        ? `https://www.youtube-nocookie.com/embed/${info.id}` +
          `?rel=0&modestbranding=1&playsinline=1&mute=1&autoplay=1`
        : `https://player.vimeo.com/video/${info.id}` +
          `?dnt=1&muted=1&autoplay=1`;
    const watchUrl =
      info.kind === "youtube" ? youtubeWatchUrl(info.id) : vimeoWatchUrl(info.id);

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
            <ExternalLink size={12} /> {info.kind === "youtube" ? "Open on YouTube" : "Open on Vimeo"}
          </a>
        </div>
      );
    }

    return (
      <div
        className={className}
        style={{
          position: "relative",
          width: "100%",
          paddingTop: "56.25%", // 16:9
          background: "#000",
          ...style,
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
            console.error("[VideoEmbed] iframe error", { kind: info.kind, id: info.id, url: info.url });
            setFailed(true); clearTimeout(failTimer.current);
          }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          data-testid={`${testid}-iframe`}
        />

        {/* "Tap for sound" hint — appears once, dismisses on the first tap so
            it can NEVER intercept provider clicks afterwards. We do NOT
            render an invisible blocker over the iframe. */}
        {loaded && !userTapped && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setUserTapped(true); }}
            className="absolute"
            style={{
              left: 12, bottom: 12,
              background: "rgba(0,0,0,0.6)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 999,
              padding: "0.4rem 0.7rem",
              fontSize: 12,
              display: "flex", alignItems: "center", gap: 6,
              cursor: "pointer",
              zIndex: 2,
            }}
            data-testid={`${testid}-sound-hint`}
            aria-label="Tap for sound"
          >
            <Play size={12} /> Tap for sound
          </button>
        )}
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
