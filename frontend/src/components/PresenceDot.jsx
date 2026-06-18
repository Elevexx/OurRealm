/**
 * Presence dot — colored status indicator.
 *
 *   live      → red, pulsing radar rings
 *   online    → green, pulsing radar rings
 *   messenger → blue, steady dot
 *   offline   → grey (rendered as a faint hollow ring when shown)
 *
 * The legacy "active" usage (no status passed) still renders the
 * pulsing green dot for back-compatibility.
 */
import React from "react";
import { ENABLE_LIVE_PRESENCE } from "@/lib/presence";

const COLORS = {
  live:      "#FF3F5A",
  online:    "var(--brand-green)",
  messenger: "#2EA0FF",
  invisible: "#5A6378",
  offline:   "#5A6378",
};

const ANIMATED = new Set(["live", "online", "messenger"]);

const wrapStyle = { position: "relative", display: "inline-block", verticalAlign: "middle" };

export default function PresenceDot({
  size = 12,
  color,
  status,
  showOffline = false,
  "data-testid": testid,
}) {
  // Defense-in-depth: collapse "live" to "online" while the live feature
  // is gated off, so a red dot can never appear via any code path.
  let effective = status || "online";
  if (effective === "live" && !ENABLE_LIVE_PRESENCE) effective = "online";
  // Hide completely when offline and not explicitly requested
  if (effective === "offline" && !showOffline) return null;
  const dotColor = color || COLORS[effective] || COLORS.online;
  const isAnimated = ANIMATED.has(effective);
  return (
    <span
      role="img"
      aria-label={`Status: ${effective}`}
      title={effective.charAt(0).toUpperCase() + effective.slice(1)}
      data-testid={testid || `presence-dot-${effective}`}
      data-status={effective}
      style={{ ...wrapStyle, width: size + 4, height: size + 4 }}
    >
      <style>{`
        @keyframes or-pulse-soft {
          0%   { box-shadow: 0 0 0 0 var(--orp-color, ${dotColor}AA); }
          70%  { box-shadow: 0 0 0 6px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        @media (prefers-reduced-motion: reduce) {
          .or-presence-dot { animation: none !important; }
        }
      `}</style>
      <span
        className="or-presence-dot"
        style={{
          position: "absolute", top: 2, left: 2, width: size, height: size, borderRadius: "50%",
          background: dotColor,
          "--orp-color": dotColor,
          animation: isAnimated ? "or-pulse-soft 2.4s ease-out infinite" : "none",
        }}
      />
      {/* Radar/glow intentionally omitted — the requirement is a small,
          subtle dot with NO large glow or translucent bubble. */}
    </span>
  );
}
