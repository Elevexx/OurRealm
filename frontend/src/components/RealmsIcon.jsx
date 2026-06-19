/**
 * RealmsIcon — bottom-nav icon for the Realms tab.
 *
 * Design brief (Feb 19, 2026 spec):
 *   • Minimal holographic realm — a glowing orb with one or two thin
 *     orbit rings and subtle internal grid lines.
 *   • Transparent background, clean outline styling optimised for
 *     24–28px nav sizes, lucide-style 1.75 stroke width.
 *   • Communicates: digital world · connected communities · virtual
 *     realms. No stars/sparkles/galaxy swirls/filled shapes.
 *
 * API matches the other lucide icons used in `BottomNav.jsx`:
 *   `<RealmsIcon size={22} />` — `currentColor` for stroke so the
 *   parent's active/inactive colour cascade just works.
 */
import React from "react";

export default function RealmsIcon({ size = 24, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {/* Outer orb — the realm itself. */}
      <circle cx="12" cy="12" r="6" />
      {/* Internal grid — a subtle longitudinal arc + equator hint to
          read as "world", not "moon". Two short arcs keep the icon
          legible at 22px without crowding. */}
      <path d="M6 12 h12" opacity="0.65" />
      <path d="M12 6 c2.2 1.8 2.2 10.2 0 12" opacity="0.65" />
      {/* Orbit ring — flattened ellipse tilted ≈25° to suggest a 3-D
          orbital plane. Drawn at full opacity so the "connected" idea
          reads even on a 1× retina. */}
      <ellipse cx="12" cy="12" rx="10" ry="3.2" transform="rotate(-22 12 12)" />
      {/* Connection node — a tiny dot on the orbit (10 o'clock) that
          implies "satellite / member". Filled so it's visible at
          small sizes. */}
      <circle cx="3.6" cy="9.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
