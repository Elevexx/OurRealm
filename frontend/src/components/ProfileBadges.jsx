/**
 * ProfileBadges — renders admin-assigned badges on a public profile.
 *
 * Phase 3 (Feb 26, 2026) — Rectangular pill style with optional icon,
 * gradient background, custom text/border/glow colors. Falls back to
 * the legacy single-accent style when only `color` is set on the
 * badge, so old admin badges continue to render correctly.
 *
 * Backend source: /api/profile/{username}/badges (filters disabled
 * badges server-side). Renders nothing for users with zero assigned
 * badges so the layout doesn't shift.
 */
import React, { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";

export default function ProfileBadges({ username }) {
  const [badges, setBadges] = useState([]);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/profile/${username}/badges`);
        if (!cancelled) setBadges(data?.badges || []);
      } catch { /* silent — admin badges are non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [username]);

  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="profile-badges">
      {badges.map((b) => <BadgePill key={b.key} badge={b} />)}
    </div>
  );
}

/**
 * Rectangular pill renderer. Supports:
 *   • icon          — lucide icon name (defaults to Award)
 *   • gradient      — CSS gradient string (takes precedence over bg_color)
 *   • bg_color      — solid background color
 *   • text_color    — text + icon color
 *   • border_color  — pill border
 *   • glow_color    — outer drop-shadow / box-shadow
 *   • color         — legacy single-accent fallback
 */
export function BadgePill({ badge }) {
  const b = badge || {};
  const Icon = Icons[b.icon] || Icons.Award;
  const accent = b.color || "#00FF66";
  const bg = b.gradient || b.bg_color || `color-mix(in srgb, ${accent} 18%, transparent)`;
  const fg = b.text_color || (b.gradient || b.bg_color ? "#0a0a0a" : accent);
  const border = b.border_color || accent;
  const glow = b.glow_color || accent;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-1 rounded-md whitespace-nowrap"
      style={{
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        boxShadow: `0 0 12px color-mix(in srgb, ${glow} 35%, transparent)`,
      }}
      title={b.description || b.name}
      data-testid={`profile-badge-${b.key}`}
      data-badge-key={b.key}
    >
      <Icon size={11} strokeWidth={2.5} /> {b.name}
    </span>
  );
}
