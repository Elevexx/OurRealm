/**
 * VideoEmbed — universal inline video renderer.
 *
 *   • Uploaded files (.mp4/.webm/.ogg/.mov) → <AutoplayVideo/> with
 *     intersection-observer autoplay/pause + native controls.
 *   • YouTube URLs (youtu.be / youtube.com / shorts) → privacy-enhanced
 *     iframe at youtube-nocookie.com.
 *   • Vimeo URLs → player.vimeo.com iframe.
 *   • Anything else → a click-through preview card with a Play affordance.
 *
 * IntersectionObserver swaps the iframe's `autoplay=1` / `autoplay=0`
 * query so embeds pause when scrolled out of view *where the provider
 * supports it*. If the provider blocks the autoplay hint (mobile Safari,
 * cellular, etc.) the embed still works — users tap Play themselves.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, ExternalLink } from "lucide-react";
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
  // YouTube
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
  if (m) return { kind: "youtube", id: m[1], url };
  // Vimeo
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (m) return { kind: "vimeo", id: m[1], url };
  return { kind: "external", url };
}

function useInView(ref, threshold = 0.5) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      ([e]) => setInView(e.isIntersecting && e.intersectionRatio >= threshold),
      { threshold: [0, threshold, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return inView;
}

export default function VideoEmbed({
  url,
  className = "",
  style,
  testid = "video-embed",
  autoplayMuted = true,
}) {
  const info = useMemo(() => classifyVideoUrl(url), [url]);
  const wrapRef = useRef(null);
  const inView = useInView(wrapRef, 0.5);

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
    const ap = autoplayMuted && inView ? 1 : 0;
    const src =
      info.kind === "youtube"
        ? `https://www.youtube-nocookie.com/embed/${info.id}` +
          `?rel=0&modestbranding=1&playsinline=1&mute=1&autoplay=${ap}`
        : `https://player.vimeo.com/video/${info.id}` +
          `?dnt=1&muted=1&autoplay=${ap}`;
    return (
      <div
        ref={wrapRef}
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
          key={`${info.id}:${ap}`}     // re-mount on autoplay toggle so the
                                       // provider re-reads the query param
          src={src}
          title="Video player"
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          data-testid={`${testid}-iframe`}
        />
      </div>
    );
  }

  // External / unknown provider — show a click-through preview card.
  return (
    <a
      href={info.url}
      target="_blank"
      rel="noopener noreferrer"
      ref={wrapRef}
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
