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

const COLORS = {
  live:      "#FF3F5A",
  online:    "var(--brand-green)",
  messenger: "#2EA0FF",
  invisible: "#5A6378",
  offline:   "#5A6378",
};

const ANIMATED = new Set(["live", "online"]);

const wrapStyle = { position: "relative", display: "inline-block", verticalAlign: "middle" };

export default function PresenceDot({
  size = 12,
  color,
  status,
  showOffline = false,
  "data-testid": testid,
}) {
  const effective = status || "online";
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
      <style>{`@keyframes or-radar { 0% { transform: scale(0.6); opacity: 0.85 } 80% { transform: scale(2.2); opacity: 0 } 100% { transform: scale(2.2); opacity: 0 } }`}</style>
      <span style={{
        position: "absolute", top: 2, left: 2, width: size, height: size, borderRadius: "50%",
        background: dotColor, boxShadow: `0 0 8px ${dotColor}`,
      }} />
      {isAnimated && (
        <>
          <span style={{
            position: "absolute", top: 2, left: 2, width: size, height: size, borderRadius: "50%",
            background: dotColor, opacity: 0.6, animation: "or-radar 1.8s ease-out infinite",
          }} />
          <span style={{
            position: "absolute", top: 2, left: 2, width: size, height: size, borderRadius: "50%",
            background: dotColor, opacity: 0.4, animation: "or-radar 1.8s ease-out infinite", animationDelay: "0.9s",
          }} />
        </>
      )}
    </span>
  );
}
