/**
 * ProgressionBadges — earned + current + locked level badges, plus the
 * prominent VIEW LEADERBOARDS button directly underneath (spec §5C/D).
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, Lock, Star, TrendingUp, Trophy } from "lucide-react";
import apiClient from "@/api/client";

export default function ProgressionBadges({ username, isOwner }) {
  const navigate = useNavigate();
  const [ladder, setLadder] = useState(null);
  const [summary, setSummary] = useState(null);
  const [rank, setRank] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    apiClient.get("/progression/ladder").then((r) => setLadder(r.data.levels)).catch(() => setLadder([]));
    apiClient.get(`/progression/summary/${username}`).then((r) => setSummary(r.data)).catch(() => {});
    if (isOwner) apiClient.get("/leaderboards/me").then((r) => setRank(r.data)).catch(() => {});
  }, [username, isOwner]);

  if (!summary?.enabled || !summary?.visible || !ladder) return null;
  const completedByName = {};
  (summary.history || []).forEach((h) => { completedByName[h.level_name] = h; });
  const currentName = summary.level?.name;

  return (
    <div className="or-surface p-4 mb-5" data-testid="progression-badges">
      <div className="text-xs uppercase tracking-[0.25em] mb-3 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Award size={13} style={{ color: "var(--primary)" }} /> Progression Badges
      </div>
      <div className="flex gap-2 flex-wrap" data-testid="progression-badges-row">
        {ladder.map((l) => {
          const earned = completedByName[l.name];
          const isCurrent = l.name === currentName;
          const accent = (l.graphics || {}).accent_color || "var(--primary)";
          const locked = !earned && !isCurrent;
          return (
            <button key={l.id} type="button"
              onClick={() => setDetail(detail?.id === l.id ? null : { ...l, earned, isCurrent })}
              className="flex flex-col items-center gap-1 px-2 py-2 rounded-lg"
              style={{
                width: 74,
                border: `1px solid ${locked ? "var(--border-col)" : accent}`,
                background: isCurrent ? `color-mix(in srgb, ${accent} 12%, transparent)` : "var(--surface-2)",
                opacity: locked ? 0.55 : 1,
              }}
              aria-label={`${l.name} badge ${earned ? "earned" : isCurrent ? "current" : "locked"}`}
              data-testid={`progression-badge-${l.level_number}`}>
              {(l.graphics || {}).badge_url
                ? <img src={l.graphics.badge_url} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} />
                : locked ? <Lock size={20} style={{ color: "var(--text-muted)" }} />
                  : isCurrent ? <Star size={20} style={{ color: accent }} />
                    : <Trophy size={20} style={{ color: accent }} />}
              <span className="text-[10px] font-semibold text-center leading-tight" style={{ color: locked ? "var(--text-muted)" : "var(--text-main)" }}>
                {l.name}
              </span>
            </button>
          );
        })}
      </div>
      {detail && (
        <div className="mt-3 text-xs p-3 rounded" style={{ background: "var(--surface-2)" }} data-testid="progression-badge-detail">
          <b style={{ color: "var(--text-main)" }}>#{detail.level_number} {detail.name}</b>
          {detail.isCurrent && <span className="ml-2" style={{ color: (detail.graphics || {}).accent_color }}>— your current level</span>}
          {detail.earned && <span className="ml-2" style={{ color: "var(--text-muted)" }}>— earned {new Date(detail.earned.completed_at).toLocaleDateString()}</span>}
          {!detail.earned && !detail.isCurrent && <span className="ml-2" style={{ color: "var(--text-muted)" }}>— locked</span>}
          <div className="mt-1" style={{ color: "var(--text-muted)" }}>{detail.short_description}</div>
        </div>
      )}

      {isOwner && rank && (
        <div className="mt-3 flex items-center gap-3 text-xs flex-wrap" data-testid="reputation-summary">
          <TrendingUp size={13} style={{ color: "var(--primary)" }} />
          <span><b style={{ color: "var(--text-main)" }}>{rank.reputation.toLocaleString()}</b> reputation</span>
          <span style={{ color: "var(--text-muted)" }}>+{rank.weekly_reputation} this week</span>
          {rank.global_rank && <span style={{ color: "var(--text-muted)" }}>Global rank #{rank.global_rank} of {rank.total_ranked}</span>}
        </div>
      )}

      <button className="or-btn w-full mt-4" onClick={() => navigate("/leaderboards")} data-testid="view-leaderboards-button">
        <Trophy size={14} /> VIEW LEADERBOARDS
      </button>
    </div>
  );
}
