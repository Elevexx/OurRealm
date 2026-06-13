import React from "react";

/**
 * OurRealm Orbital Glyph Logo.
 * - Original SVG: a dual orbital ring around a stylized "R" with a connecting node.
 * - Stroke colors react to the current theme mode via CSS variables.
 */
export default function Logo({ size = 44, withWordmark = false, className = "", glow = true }) {
  const sw = size <= 32 ? 6 : 5.5;
  return (
    <div className={`inline-flex items-center gap-3 ${className}`} data-testid="ourrealm-logo">
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={glow ? "animate-pulse-glow" : ""}
        style={{ overflow: "visible" }}
        aria-label="OurRealm logo"
      >
        <defs>
          <linearGradient id="or-ring" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--secondary)" />
          </linearGradient>
        </defs>
        {/* Outer orbital ring */}
        <circle cx="50" cy="50" r="40" fill="none" stroke="url(#or-ring)" strokeWidth={sw - 1} opacity="0.95" />
        {/* Tilted inner orbit */}
        <ellipse cx="50" cy="50" rx="44" ry="14" fill="none" stroke="var(--secondary)" strokeWidth={sw - 3} transform="rotate(-22 50 50)" opacity="0.75" />
        {/* Node planet */}
        <circle cx="86" cy="32" r="4" fill="var(--accent)" />
        {/* Stylized R */}
        <path
          d="M36 30 H56 A14 14 0 0 1 56 60 H46 V74 M46 60 L62 74"
          fill="none"
          stroke="var(--text-main)"
          strokeWidth={sw + 1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withWordmark && (
        <span
          className="font-cypher tracking-tight"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--text-main)",
            fontWeight: 700,
            letterSpacing: "-0.01em",
            fontSize: size * 0.5,
            lineHeight: 1,
          }}
        >
          Our<span style={{ color: "var(--primary)" }}>Realm</span>
        </span>
      )}
    </div>
  );
}
