/**
 * LevelBadge — compact current-level pill beside display names, rendered
 * with the SAME canonical badge artwork assigned in the Level Builder
 * (optimized thumb variant). Falls back to the star icon only when no
 * artwork is assigned. Refreshes instantly after a level claim.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Star } from "lucide-react";
import apiClient from "@/api/client";

const cache = new Map(); // username -> {at, data}
// Responsive artwork size: ~24px phone → ~36px desktop, no device detection.
const ART_SIZE = "clamp(24px, 16px + 1.4vw, 36px)";

export default function LevelBadge({ username, onClick, testid = "level-badge" }) {
  const [data, setData] = useState(cache.get(username)?.data || null);
  const [imgOk, setImgOk] = useState(true);

  const fetchSummary = useCallback((force = false) => {
    if (!username) return;
    const hit = cache.get(username);
    if (!force && hit && Date.now() - hit.at < 60000) { setData(hit.data); return; }
    apiClient.get(`/progression/summary/${username}`)
      .then((r) => {
        cache.set(username, { at: Date.now(), data: r.data });
        setData(r.data);
        setImgOk(true);
      })
      .catch(() => {});
  }, [username]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => {
    const onClaim = () => fetchSummary(true);
    window.addEventListener("or-progression-claimed", onClaim);
    return () => window.removeEventListener("or-progression-claimed", onClaim);
  }, [fetchSummary]);

  if (!data?.enabled || !data?.visible || !data?.level?.name) return null;
  const g = data.level.graphics || {};
  const accent = g.accent_color || "var(--primary)";
  const glow = g.glow_color || accent;
  const art = g.badge_thumb_url || g.badge_url || g.icon_url;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold align-middle"
      style={{
        background: `color-mix(in srgb, ${accent} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)`,
        color: "var(--text-main)",
        boxShadow: g.glow ? `0 0 10px color-mix(in srgb, ${accent} 30%, transparent)` : "none",
        cursor: onClick ? "pointer" : "default",
      }}
      aria-label={`Level: ${data.level.name}${data.level.level_number ? ` (level ${data.level.level_number})` : ""}`}
      title={`${data.level.name} — tap for progression details`}
      data-testid={testid}
    >
      {art && imgOk
        ? <img src={art} alt="" onError={() => setImgOk(false)}
               style={{
                 width: ART_SIZE, height: ART_SIZE, objectFit: "contain",
                 flexShrink: 0, filter: `drop-shadow(0 0 3px ${glow})`,
               }} />
        : <Star size={11} style={{ color: accent }} aria-hidden="true" />}
      <span data-testid={`${testid}-name`}>{data.level.name}</span>
    </button>
  );
}

export function invalidateLevelBadge(username) {
  cache.delete(username);
}
