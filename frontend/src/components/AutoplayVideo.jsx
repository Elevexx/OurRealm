/**
 * AutoplayVideo — `<video>` that auto-plays muted when ≥50% in view and
 * pauses when scrolled out. Plus tap-to-reveal-controls (auto-fade after
 * 2.5s), mute/unmute toggle, and a graceful error overlay.
 *
 * iOS Safari specifically requires BOTH the `autoPlay` attribute on the
 * element AND `muted` + `playsInline` to be in the initial HTML — without
 * the explicit attribute the browser short-circuits the load and renders
 * a crossed-out play badge even though our IntersectionObserver would
 * have called `.play()` shortly after.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Volume2, VolumeX, AlertCircle } from "lucide-react";
import { useAutoplayOnVisible } from "@/lib/useAutoplayOnVisible";
import { resolveMediaUrl, isPlayableMediaUrl, probeMediaUrl, markMediaUrlBroken } from "@/lib/mediaUrl";

export default function AutoplayVideo({
  src,
  className = "",
  style,
  testid,
}) {
  const resolvedSrc = resolveMediaUrl(src);
  // Pre-mount validation — keeps known-bad URLs from ever reaching
  // the <video> element. Async HEAD probe runs in the background and
  // flips us to the fallback overlay if the backend file is missing.
  const initiallyPlayable = isPlayableMediaUrl(src);
  const ioRef = useAutoplayOnVisible({ threshold: 0.5 });
  // Single canonical ref shared with the IntersectionObserver hook + our
  // local UI (mute toggle, error overlay, tap-to-reveal-controls).
  const videoRef = useCallback((node) => {
    ioRef.current = node;
    // eslint-disable-next-line no-param-reassign
    internalRef.current = node;
  }, [ioRef]);
  const internalRef = useRef(null);

  const [muted, setMuted] = useState(true);
  // `controlsVisible` toggles the native browser chrome on/off. We default
  // to off so playback isn't dominated by the persistent paused/play icon
  // that some platforms render. Tap → show 2.5 s → fade.
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimer = useRef(null);
  const [errored, setErrored] = useState(!initiallyPlayable);

  // Background HEAD probe — only runs once per URL across the page
  // lifetime (the cache is in /app/frontend/src/lib/mediaUrl.js).
  useEffect(() => {
    if (!initiallyPlayable || !resolvedSrc) return;
    let cancelled = false;
    probeMediaUrl(resolvedSrc).then((ok) => {
      if (!cancelled && !ok) setErrored(true);
    });
    return () => { cancelled = true; };
  }, [resolvedSrc, initiallyPlayable]);

  // Reveal native controls for a moment whenever the user taps the
  // surface. Re-tap extends the window. Touch-friendly + matches the
  // YouTube/TikTok behaviour of auto-fading controls.
  const reveal = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 2500);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const toggleMute = (e) => {
    e.stopPropagation();
    const v = internalRef.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    setMuted(next);
    if (!next) {
      // Unmuting counts as a user gesture — attempt play() in case the
      // observer paused us while off-screen. catch() suppresses the
      // policy errors iOS Safari throws even after a tap.
      v.play().catch(() => {});
    }
    reveal();
  };

  const onError = () => {
    const v = internalRef.current;
    setErrored(true);
    markMediaUrlBroken(resolvedSrc);
    // Use console.debug instead of console.error so seeded broken
    // URLs don't pollute the production console. Real bugs are still
    // inspectable via DevTools (Default → Verbose).
    // eslint-disable-next-line no-console
    console.debug("[AutoplayVideo] playback failed", {
      src: resolvedSrc,
      networkState: v?.networkState,
      readyState: v?.readyState,
      errorCode: v?.error?.code,
      errorMessage: v?.error?.message,
    });
  };

  if (errored) {
    return (
      <div
        className={className}
        style={{
          ...style,
          background: "#111418",
          border: "1px solid var(--border-col)",
          borderRadius: "var(--radius)",
          padding: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--text-muted)",
          fontSize: 13,
        }}
        data-testid={testid ? `${testid}-error` : "video-error"}
      >
        <AlertCircle size={16} style={{ color: "#FF8080", flexShrink: 0 }} />
        Video failed to load
      </div>
    );
  }

  return (
    <div
      onClick={reveal}
      style={{ position: "relative", lineHeight: 0, ...style }}
      className={className}
      data-testid={testid ? `${testid}-wrap` : undefined}
    >
      <video
        ref={videoRef}
        src={resolvedSrc}
        controls={controlsVisible}
        muted={muted}
        autoPlay
        playsInline
        loop
        preload="metadata"
        onError={onError}
        // eslint-disable-next-line react/no-unknown-property
        webkit-playsinline="true"
        // eslint-disable-next-line react/no-unknown-property
        x5-playsinline="true"
        className="block w-full"
        style={{ display: "block", width: "100%", maxHeight: "inherit" }}
        data-testid={testid}
      />

      {/* Mute / unmute pill — always visible, lower-right. Tapping doesn't
          toggle the surrounding "reveal" because we stopPropagation above. */}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute"
        style={{
          right: 8,
          bottom: 8,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 999,
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        data-testid={testid ? `${testid}-mute` : "video-mute"}
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
    </div>
  );
}
