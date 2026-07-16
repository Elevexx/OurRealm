/**
 * ProgressionBadges — earned + current + locked level badges, plus the
 * prominent VIEW LEADERBOARDS button directly underneath (spec §5C/D).
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, TrendingUp, Trophy } from "lucide-react";
import apiClient from "@/api/client";
import { CollapsibleHeader, useAccordionState } from "./CollapsibleHeader";
import { ProgressionBadgeCard } from "./ProgressionBadgeCard";

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
          const currentNumber = (ladder.find((x) => x.name === currentName) || {}).level_number;
          const isNext = !earned && !isCurrent && currentNumber != null && l.level_number === currentNumber + 1;
          const status = isCurrent ? "current" : earned ? "completed" : isNext ? "next" : "locked";
          const prog = summary?.summary;
          const progressText = isNext && prog?.required_task_count
            ? `${prog.completed_task_count ?? 0}/${prog.required_task_count} Tasks`
            : null;
          return (
            <ProgressionBadgeCard key={l.id} level={l} status={status}
              progressText={progressText}
              onClick={() => setDetail(detail?.id === l.id ? null : { ...l, earned, isCurrent })}
              testid={`progression-badge-${l.level_number}`} />
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
