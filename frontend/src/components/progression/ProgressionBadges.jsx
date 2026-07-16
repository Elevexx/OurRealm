/**
 * ProgressionBadges — earned + current + locked level badges, plus the
 * prominent VIEW LEADERBOARDS button directly underneath (spec §5C/D).
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, Lock, Star, TrendingUp, Trophy } from "lucide-react";
import apiClient from "@/api/client";
import { CollapsibleHeader, useAccordionState } from "./CollapsibleHeader";

function BadgeArt({ g, name, locked, isCurrent, earned, accent }) {
  const [ok, setOk] = useState(true);
  const art = g.badge_thumb_url || g.badge_url;
  if (!art || !ok) {
    return locked ? <Lock size={20} style={{ color: "var(--text-muted)" }} />
      : isCurrent ? <Star size={20} style={{ color: accent }} />
        : <Trophy size={20} style={{ color: accent }} />;
  }
  const glow = g.glow_color || accent;
  const gi = g.glow_intensity || 1;
  const filter = locked
    ? (g.locked_treatment === "icon" ? "none" : "grayscale(0.85) brightness(0.45)")
    : isCurrent ? `drop-shadow(0 0 ${Math.round(9 * gi)}px ${glow})`
      : earned ? `drop-shadow(0 0 ${Math.round(4 * gi)}px ${glow})` : "none";
  if (locked && g.locked_treatment === "icon") {
    return <Lock size={20} style={{ color: "var(--text-muted)" }} />;
  }
  return (
    <span style={{ position: "relative", width: 56, height: 56, display: "block", flexShrink: 0 }}>
      <img src={art} alt={g.alt_text || `${name} level badge`} loading="lazy"
        width={56} height={56} onError={() => setOk(false)}
        style={{ width: 56, height: 56, objectFit: "contain", filter, opacity: locked ? 0.8 : 1 }} />
      {locked && (
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

export default function ProgressionBadges({ username, isOwner }) {
  const navigate = useNavigate();
  const [ladder, setLadder] = useState(null);
  const [summary, setSummary] = useState(null);
  const [rank, setRank] = useState(null);
  const [detail, setDetail] = useState(null);
  const [expanded, setExpanded] = useAccordionState(`badges:${username}`, false);

  useEffect(() => {
    const loadAll = () => {
      apiClient.get("/progression/ladder").then((r) => setLadder(r.data.levels)).catch(() => setLadder([]));
      apiClient.get(`/progression/summary/${username}`).then((r) => setSummary(r.data)).catch(() => {});
      if (isOwner) apiClient.get("/leaderboards/me").then((r) => setRank(r.data)).catch(() => {});
    };
    loadAll();
    // Refetch badges + rank the moment a level claim succeeds anywhere on the page.
    window.addEventListener("or-progression-claimed", loadAll);
    return () => window.removeEventListener("or-progression-claimed", loadAll);
  }, [username, isOwner]);

  if (!summary?.enabled || !summary?.visible || !ladder) return null;
  const completedByName = {};
  (summary.history || []).forEach((h) => { completedByName[h.level_name] = h; });
  const currentName = summary.level?.name;

  return (
    <div className="or-surface p-4 mb-5" data-testid="progression-badges">
      <CollapsibleHeader
        icon={<Award size={16} style={{ color: "var(--primary)" }} aria-hidden="true" />}
        title="Progression Badges"
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
        testid="progression-badges-header"
        titleTestid="progression-badges-title"
        arrowTestid="progression-badges-toggle"
      />
      {expanded && (
      <>
      <div
        className="grid gap-2 mt-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(104px, 100%), 1fr))" }}
        data-testid="progression-badges-row">
        {ladder.map((l) => {
          const earned = completedByName[l.name];
          const isCurrent = l.name === currentName;
          const g = l.graphics || {};
          const accent = g.accent_color || "var(--primary)";
          const glow = g.glow_color || accent;
          const gi = g.glow_intensity || 1;
          const locked = !earned && !isCurrent;
          return (
            <button key={l.id} type="button"
              onClick={() => setDetail(detail?.id === l.id ? null : { ...l, earned, isCurrent })}
              className="flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg w-full"
              style={{
                minHeight: 104,
                border: isCurrent ? `2px solid ${accent}` : `1px solid ${locked ? "var(--border-col)" : accent}`,
                background: isCurrent ? `color-mix(in srgb, ${accent} 12%, transparent)` : "var(--surface-2)",
                boxShadow: isCurrent ? `0 0 ${Math.round(14 * gi)}px color-mix(in srgb, ${glow} 45%, transparent)`
                  : earned ? `0 0 ${Math.round(6 * gi)}px color-mix(in srgb, ${glow} 25%, transparent)` : "none",
                opacity: locked ? 0.7 : 1,
              }}
              aria-label={`${l.name} badge ${earned ? "earned" : isCurrent ? "current" : "locked"}`}
              data-testid={`progression-badge-${l.level_number}`}>
              <BadgeArt g={g} name={l.name} locked={locked} isCurrent={isCurrent} earned={earned} accent={accent} />
              <span className="text-[11px] font-semibold text-center leading-tight break-words w-full"
                style={{ color: locked ? "var(--text-muted)" : "var(--text-main)" }}>
                {l.name}
              </span>
              {isCurrent && (
                <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: accent }}>current</span>
              )}
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
      </>
      )}
    </div>
  );
}
