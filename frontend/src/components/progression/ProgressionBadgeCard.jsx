/**
 * ProgressionBadgeCard — the ONE shared renderer for progression badge
 * cards (owner profile, public profiles, anywhere else). Status drives
 * the visual state; the Level Builder artwork is the single source of
 * truth — never silently replaced.
 *
 * status: "completed" | "current" | "next" | "locked"
 */
import React, { useState } from "react";
import { ImageOff, Lock } from "lucide-react";

function Art({ g, name, status }) {
  // Fallback chain: optimized thumb → full artwork → explicit placeholder.
  const sources = [g.badge_thumb_url, g.badge_url, g.badge_png_url].filter(Boolean);
  const [idx, setIdx] = useState(0);
  const art = sources[idx];
  const accent = g.accent_color || "var(--primary)";
  const glow = g.glow_color || accent;
  const gi = g.glow_intensity || 1;

  if (!art) {
    // Missing admin artwork: explicit placeholder + logged, never a
    // silent substitute.
    if (sources.length === 0) console.warn(`[progression] Missing badge artwork for level "${name}"`);
    return (
      <span className="flex items-center justify-center" data-testid="badge-art-missing"
        style={{ width: 56, height: 56, borderRadius: 12, border: "1.5px dashed var(--border-col)" }}>
        <ImageOff size={20} style={{ color: "var(--text-muted)" }} />
      </span>
    );
  }
  const filter = status === "locked" ? "grayscale(100%) brightness(0.45)"
    : status === "next" ? "grayscale(100%) brightness(0.62)"
      : status === "current" ? `drop-shadow(0 0 ${Math.round(9 * gi)}px ${glow})`
        : `drop-shadow(0 0 ${Math.round(4 * gi)}px ${glow})`;
  return (
    <span style={{ position: "relative", width: 56, height: 56, display: "block", flexShrink: 0 }}>
      <img src={art} alt={g.alt_text || `${name} level badge`} loading="lazy"
        width={56} height={56} onError={() => setIdx((i) => i + 1)}
        style={{ width: 56, height: 56, objectFit: "contain", filter,
                 opacity: status === "locked" ? 0.55 : 1 }} />
      {status === "locked" && (
        <span style={{
          position: "absolute", right: -3, bottom: -3, width: 18, height: 18,
          borderRadius: "50%", background: "var(--surface)", border: "1px solid var(--border-col)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} aria-hidden="true">
          <Lock size={10} style={{ color: "var(--text-muted)" }} />
        </span>
      )}
    </span>
  );
}

export const ProgressionBadgeCard = ({ level, status, progressText, onClick, testid }) => {
  const g = level.graphics || {};
  const accent = g.accent_color || "var(--primary)";
  const glow = g.glow_color || accent;
  const gi = g.glow_intensity || 1;
  const border =
    status === "current" ? `2px solid ${accent}`
      : status === "completed" ? `1px solid ${accent}`
        : status === "next" ? `1px solid color-mix(in srgb, ${accent} 65%, transparent)`
          : "1px solid var(--border-col)";
  const shadow =
    status === "current" ? `0 0 ${Math.round(14 * gi)}px color-mix(in srgb, ${glow} 45%, transparent)`
      : status === "completed" ? `0 0 ${Math.round(6 * gi)}px color-mix(in srgb, ${glow} 25%, transparent)`
        : "none";

  return (
    <button type="button" onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg w-full ${status === "current" ? "or-badge-current" : ""}`}
      style={{
        minHeight: 112,
        border,
        background: status === "current" ? `color-mix(in srgb, ${accent} 12%, transparent)` : "var(--surface-2)",
        boxShadow: shadow,
        opacity: status === "locked" ? 0.8 : 1,
        "--pulse-c": `color-mix(in srgb, ${glow} 40%, transparent)`,
        ...(status === "current" ? { animation: "or-badge-pulse 2.6s ease-in-out infinite" } : {}),
      }}
      aria-label={`${level.name} badge — ${status}${progressText ? ` (${progressText})` : ""}`}
      data-testid={testid}>
      <Art g={g} name={level.name} status={status} />
      <span className="text-[11px] font-semibold text-center leading-tight break-words w-full"
        style={{ color: status === "locked" ? "var(--text-muted)" : "var(--text-main)" }}>
        {level.name}
      </span>
      {status === "current" && (
        <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: accent }}>current</span>
      )}
      {status === "next" && progressText && (
        <span className="text-[9px] font-semibold" style={{ color: accent }} data-testid={`${testid}-progress`}>
          {progressText}
        </span>
      )}
    </button>
  );
};

export default ProgressionBadgeCard;
