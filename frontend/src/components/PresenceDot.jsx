/**
 * Tiny animated green radar dot used to indicate active presence.
 * Pure CSS — a colored dot + two pulsing rings via @keyframes.
 *
 * Hidden when the owner has `presence_visible=false` (decision made by
 * the parent before rendering this).
 */
import React from "react";

const wrapStyle = { position: "relative", display: "inline-block", width: 14, height: 14, verticalAlign: "middle" };

export default function PresenceDot({ size = 12, color = "var(--brand-green)", "data-testid": testid }) {
  // We inject the keyframes once at module evaluation. Browsers de-dupe
  // identical <style> tags; this avoids a global stylesheet dependency.
  return (
    <span
      role="img"
      aria-label="Active"
      title="Active"
      data-testid={testid || "presence-dot"}
      style={{ ...wrapStyle, width: size + 4, height: size + 4 }}
    >
      <style>{`@keyframes or-radar { 0% { transform: scale(0.6); opacity: 0.85 } 80% { transform: scale(2.2); opacity: 0 } 100% { transform: scale(2.2); opacity: 0 } }`}</style>
      <span style={{
        position: "absolute", top: 2, left: 2, width: size, height: size, borderRadius: "50%",
        background: color, boxShadow: `0 0 8px ${color}`,
      }} />
      <span style={{
        position: "absolute", top: 2, left: 2, width: size, height: size, borderRadius: "50%",
        background: color, opacity: 0.6, animation: "or-radar 1.8s ease-out infinite",
      }} />
      <span style={{
        position: "absolute", top: 2, left: 2, width: size, height: size, borderRadius: "50%",
        background: color, opacity: 0.4, animation: "or-radar 1.8s ease-out infinite", animationDelay: "0.9s",
      }} />
    </span>
  );
}
