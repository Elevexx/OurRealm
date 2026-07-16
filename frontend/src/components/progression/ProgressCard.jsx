/**
 * ProgressCard — the profile progression card.
 * Owner: detailed tasks, claim flow, history. Others: public summary only
 * (backend enforces visibility). Handles skeleton / error / paused /
 * archived / highest-level / no-next-level states.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, History, Loader2,
  RefreshCw, Sparkles, Trophy, PauseCircle, Archive,
} from "lucide-react";
import apiClient from "@/api/client";
import CelebrationModal from "./CelebrationModal";
import { invalidateLevelBadge } from "./LevelBadge";

// Survives component remounts on the same page; cleared on full page load.
const expandedMemory = new Map();

function Bar({ pct, accent }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" role="progressbar"
      aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)" }}>
      <div className="h-full rounded-full" style={{
        width: `${pct}%`, background: accent,
        transition: "width 0.5s ease",
        boxShadow: `0 0 8px color-mix(in srgb, ${accent} 50%, transparent)`,
      }} />
    </div>
  );
}

function TaskRow({ t, accent, navigate }) {
  return (
    <div className="flex items-start gap-2.5 py-2 flex-wrap" data-testid={`progress-task-${t.id}`}>
      {t.completed
        ? <CheckCircle2 size={17} style={{ color: accent, flexShrink: 0, marginTop: 1 }} aria-label="Completed" />
        : <Circle size={17} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }} aria-label="Not completed" />}
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-medium break-words" style={{
          color: t.completed ? "var(--text-muted)" : "var(--text-main)",
          textDecoration: t.completed ? "line-through" : "none",
        }}>
          {t.name}{!t.required && <span className="text-[10px] ml-1.5" style={{ color: "var(--text-muted)" }}>(optional)</span>}
        </div>
        {t.description && !t.completed && (
          <div className="text-xs mt-0.5 break-words" style={{ color: "var(--text-muted)" }}>{t.description}</div>
        )}
        {t.required_value > 1 && (
          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {Math.min(t.current_value, t.required_value)}/{t.required_value}
          </div>
        )}
        {t.completed && t.completed_at && (
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            Completed {new Date(t.completed_at).toLocaleDateString()}
          </div>
        )}
      </div>
      {!t.completed && t.button_destination && (
        <button className="or-chip shrink-0" onClick={() => navigate(t.button_destination)}
          data-testid={`progress-task-${t.id}-go`}>
          {t.button_label || "Go"}
        </button>
      )}
    </div>
  );
}

export default function ProgressCard({ username, isOwner }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(null);
  // Expanded state persists across remounts on the same page (spec: no
  // reset on ordinary React rerenders). Keyed per profile username.
  const [expanded, setExpandedState] = useState(() =>
    expandedMemory.has(username) ? expandedMemory.get(username) : true);
  const setExpanded = (v) => {
    const next = typeof v === "function" ? v(expandedMemory.get(username) ?? true) : v;
    expandedMemory.set(username, next);
    setExpandedState(next);
  };
  const claimingRef = useRef(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = isOwner
        ? await apiClient.get("/progression/me")
        : await apiClient.get(`/progression/summary/${username}`);
      setData(r.data);
    } catch {
      setErr("Could not load progression.");
    } finally {
      setLoading(false);
    }
  }, [username, isOwner]);

  useEffect(() => { load(); }, [load]);

  const claim = async () => {
    if (claimingRef.current) return;         // hard double-submit guard
    claimingRef.current = true;
    setClaiming(true); setErr("");
    try {
      const r = await apiClient.post("/progression/claim", {
        level_id: data.level.id,
        idempotency_key: `${data.level.id}:${Date.now()}`,
      });
      // Celebration only when the backend confirms a completed level
      // (idempotent replays of an already-claimed level are safe no-ops).
      if (r.data?.completed_level) setCelebration(r.data);
      invalidateLevelBadge(username);
      setExpanded(true);                     // new current level opens expanded
      // Let sibling components (badges, rank, leaderboards) refetch.
      window.dispatchEvent(new CustomEvent("or-progression-claimed"));
      try { await load(); } catch { /* refetch failure ≠ claim failure */ }
    } catch (e) {
      setErr(e?.response?.data?.detail || "Claim failed — please try again.");
    } finally {
      claimingRef.current = false;
      setClaiming(false);
    }
  };

  const toggleHistory = async () => {
    if (!showHistory && history === null) {
      try {
        const r = await apiClient.get("/progression/history/me");
        setHistory(r.data.history || []);
      } catch { setHistory([]); }
    }
    setShowHistory((s) => !s);
  };

  if (loading) {
    return (
      <div className="or-surface p-4 mb-5 animate-pulse" data-testid="progress-card-skeleton">
        <div className="h-4 w-40 rounded mb-3" style={{ background: "var(--surface-2)" }} />
        <div className="h-2 w-full rounded mb-3" style={{ background: "var(--surface-2)" }} />
        <div className="h-3 w-3/4 rounded" style={{ background: "var(--surface-2)" }} />
      </div>
    );
  }
  if (err && !data) {
    return (
      <div className="or-surface p-4 mb-5 flex items-center justify-between gap-3" data-testid="progress-card-error">
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>{err}</span>
        <button className="or-chip" onClick={() => { setLoading(true); load(); }} data-testid="progress-card-retry">
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }
  if (!data || data.enabled === false) return null;
  if (!isOwner && (!data.visible || !data.summary)) return null;

  const level = data.level || {};
  const summary = data.summary || {};
  const g = level.graphics || {};
  const accent = g.accent_color || "var(--primary)";
  const settings = level.progress_settings || {};
  const pct = summary.progress_percentage ?? 0;
  const status = data.status || summary.status || "active";
  const highest = status === "highest_level_reached";

  return (
    <div className="or-surface p-4 mb-5 relative overflow-hidden" data-testid="progress-card"
      style={g.card_background_url ? {
        backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url(${g.card_background_url})`,
        backgroundSize: "cover", backgroundPosition: "center",
      } : undefined}>
      {isOwner ? (
        <button type="button" className="w-full flex items-center gap-2 flex-wrap text-left"
          style={{ minHeight: 44 }}
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={`${settings.progress_bar_label || `${level.name || "Level"} Progress`} — ${expanded ? "collapse" : "expand"}`}
          data-testid="progress-card-header">
          <Sparkles size={16} style={{ color: accent }} aria-hidden="true" />
          <h3 className="font-semibold text-sm flex-1" style={{ color: "var(--text-main)" }} data-testid="progress-card-title">
            {settings.progress_bar_label || `${level.name || "Level"} Progress`}
          </h3>
          <span className="text-xs font-semibold" style={{ color: accent }} data-testid="progress-card-count">
            {summary.completed_task_count ?? 0}/{summary.required_task_count ?? 0} Tasks Completed
          </span>
          <span className="starbar-icon" style={{ width: 30, height: 30 }} aria-hidden="true" data-testid="progress-card-toggle">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles size={16} style={{ color: accent }} aria-hidden="true" />
          <h3 className="font-semibold text-sm flex-1" style={{ color: "var(--text-main)" }} data-testid="progress-card-title">
            {settings.progress_bar_label || `${level.name || "Level"} Progress`}
          </h3>
          <span className="text-xs font-semibold" style={{ color: accent }} data-testid="progress-card-count">
            {summary.completed_task_count ?? 0}/{summary.required_task_count ?? 0} Tasks Completed
          </span>
        </div>
      )}
      <div className="mt-2.5"><Bar pct={pct} accent={accent} /></div>
      {(expanded || !isOwner) && (
      <>

      {status === "paused_level" && (
        <div className="mt-3 text-xs flex items-center gap-2" style={{ color: "var(--text-muted)" }} data-testid="progress-card-paused">
          <PauseCircle size={13} /> {settings.paused_message || "This level is temporarily paused. Your progress is safe."}
        </div>
      )}
      {status === "archived_level" && (
        <div className="mt-3 text-xs flex items-center gap-2" style={{ color: "var(--text-muted)" }} data-testid="progress-card-archived">
          <Archive size={13} /> This level was archived. Your earned progress and rewards are preserved.
        </div>
      )}
      {highest && (
        <div className="mt-3 text-sm font-semibold flex items-center gap-2" style={{ color: accent }} data-testid="progress-card-highest">
          <Trophy size={15} /> {settings.no_next_level_message || "Highest Available Level Reached"}
        </div>
      )}

      {isOwner && !highest && (
        <div className="mt-2 divide-y" style={{ borderColor: "var(--border-col)" }} data-testid="progress-card-tasks">
          {(data.tasks || []).map((t) => (
            <TaskRow key={t.id} t={t} accent={accent} navigate={navigate} />
          ))}
          {(data.tasks || []).length === 0 && (
            <div className="text-xs py-2" style={{ color: "var(--text-muted)" }} data-testid="progress-card-no-tasks">
              No tasks configured for this level yet.
            </div>
          )}
        </div>
      )}

      {isOwner && summary.claim_available && status === "active" && (
        data.claims_enabled ? (
          <button className="or-btn w-full mt-3" onClick={claim} disabled={claiming}
            style={{ background: accent, borderColor: accent }}
            data-testid="progress-claim-button">
            {claiming ? <><Loader2 size={14} className="animate-spin" /> Claiming…</>
              : <><Trophy size={14} /> {settings.claim_button_text || "Claim Level Upgrade"}</>}
          </button>
        ) : (
          <div className="mt-3 text-xs text-center py-2 rounded" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }} data-testid="progress-claims-disabled">
            {settings.completion_message || "All tasks complete!"} Level claims are temporarily unavailable.
          </div>
        )
      )}
      {isOwner && err && data && (
        <div className="mt-2 text-xs" style={{ color: "#ff8080" }} data-testid="progress-claim-error">{err}</div>
      )}

      {isOwner && (
        <button className="mt-3 text-xs flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}
          onClick={toggleHistory} data-testid="progress-history-toggle">
          <History size={12} /> {showHistory ? "Hide" : "View"} progression history
        </button>
      )}
      {showHistory && (
        <div className="mt-2 space-y-1.5" data-testid="progress-history">
          {(history || []).length === 0 ? (
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>No completed levels yet — this is where your journey will be recorded.</div>
          ) : history.map((h) => (
            <div key={h.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded"
              style={{ background: "var(--surface-2)" }} data-testid={`progress-history-${h.id}`}>
              <Trophy size={12} style={{ color: (h.graphics || {}).accent_color || accent }} />
              <span className="font-semibold" style={{ color: "var(--text-main)" }}>{h.level_name}</span>
              <span className="flex-1" />
              <span style={{ color: "var(--text-muted)" }}>{h.completed_at ? new Date(h.completed_at).toLocaleDateString() : ""}</span>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      <CelebrationModal result={celebration} onClose={() => setCelebration(null)} />
    </div>
  );
}
