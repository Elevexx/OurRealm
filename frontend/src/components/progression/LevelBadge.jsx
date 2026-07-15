/**
 * LevelBadge — compact level pill shown beside display names.
 * Public summary endpoint respects backend visibility; renders nothing
 * when progression display is disabled or hidden. Never replaces or
 * interferes with existing badges (VIP/founder/verified pills).
 */
import React, { useEffect, useState } from "react";
import { Star } from "lucide-react";
import apiClient from "@/api/client";

const cache = new Map(); // username -> {at, data}

export default function LevelBadge({ username, onClick, testid = "level-badge" }) {
  const [data, setData] = useState(cache.get(username)?.data || null);
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    if (!username) return;
    const hit = cache.get(username);
    if (hit && Date.now() - hit.at < 60000) { setData(hit.data); return; }
    let cancelled = false;
    apiClient.get(`/progression/summary/${username}`)
      .then((r) => {
        if (cancelled) return;
        cache.set(username, { at: Date.now(), data: r.data });
        setData(r.data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [username]);

  if (!data?.enabled || !data?.visible || !data?.level?.name) return null;
  const g = data.level.graphics || {};
  const accent = g.accent_color || "var(--primary)";
  const icon = g.badge_url || g.icon_url;

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
      {icon && imgOk
        ? <img src={icon} alt="" onError={() => setImgOk(false)}
               style={{ width: 14, height: 14, borderRadius: 3, objectFit: "cover" }} />
        : <Star size={11} style={{ color: accent }} aria-hidden="true" />}
      <span data-testid={`${testid}-name`}>{data.level.name}</span>
    </button>
  );
}

export function invalidateLevelBadge(username) {
  cache.delete(username);
}
