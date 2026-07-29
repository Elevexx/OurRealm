/**
 * AdminModerationCenter — Trust & Safety Moderation Center (/admin/moderation).
 *
 * Tabs: Overview · AI Flagged · Urgent · User Reports · Blurred · Removed · Audit Log.
 * Unified queue shows AI flags + report counts; every action reuses the
 * existing /admin/moderation endpoints (approve/hide/restore/delete/ban)
 * plus the new blur/unblur/rescan + report administration.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Shield, ShieldAlert, Loader2, CheckCircle2, EyeOff, RotateCcw, Trash2,
  UserX, RefreshCcw, Eye, Flag, FileText, AlertTriangle, FolderOpen,
} from "lucide-react";
import apiClient from "@/api/client";
import AdminBackButton from "@/components/AdminBackButton";
import AdminBlurModal from "@/components/AdminBlurModal";
import ModUserPanel from "@/components/admin/ModUserPanel";
import ModContentSearch from "@/components/admin/ModContentSearch";
import ModCaseDetail from "@/components/admin/ModCaseDetail";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "content", label: "All Content" },
  { id: "ai", label: "AI Flagged" },
  { id: "urgent", label: "Urgent" },
  { id: "reports", label: "User Reports" },
  { id: "review", label: "Under Review" },
  { id: "blurred", label: "Blurred" },
  { id: "locked", label: "Private Review" },
  { id: "hidden", label: "Hidden" },
  { id: "removed", label: "Removed" },
  { id: "users", label: "Users" },
  { id: "log", label: "Audit Log" },
];

const CASE_TABS = new Set(["ai", "urgent", "blurred", "review", "hidden", "locked"]);

const STAT_CARDS = [
  { id: "total_scanned", label: "Content scanned" },
  { id: "ai_flagged", label: "AI flagged" },
  { id: "open_reports", label: "Open reports" },
  { id: "urgent", label: "Urgent cases" },
  { id: "pending_review", label: "Pending review" },
  { id: "manual_blurred", label: "Manually blurred" },
  { id: "removed_today", label: "Removed today" },
  { id: "reports_today", label: "Reports (24h)" },
];

function StatCard({ label, value, testid }) {
  return (
    <div className="or-surface p-4" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-2xl mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>{value ?? 0}</div>
    </div>
  );
}

function SeverityPill({ severity, urgent }) {
  const colors = { 1: "#FFC94D", 2: "#FF8A3D", 3: "#FF5A5A", 4: "#FF2D55" };
  const c = colors[severity] || "var(--text-muted)";
  return (
    <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
      style={{ color: c, border: `1px solid ${c}` }}>
      {urgent ? "URGENT · " : ""}L{severity}
    </span>
  );
}

function CaseRow({ item, onAction, onBlur, onOpenCase, busy }) {
  const blurred = item.manual_blur?.active;
  return (
    <div className="or-surface p-3" data-testid={`ts-case-${item.content_type}-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{item.content_type}</span>
        <SeverityPill severity={item.severity} urgent={item.urgent} />
        {item.review_locked && <span className="or-chip text-[10px]" style={{ color: "#B98CFF" }}>private review</span>}
        {(item.categories || []).map((c) => (
          <span key={c} className="or-chip text-[10px]">{c}</span>
        ))}
        {blurred && <span className="or-chip text-[10px]" style={{ color: "#FFC94D" }}>manual blur</span>}
        {item.report_count > 0 && (
          <span className="or-chip text-[10px]"><Flag size={10} /> {item.report_count} report{item.report_count > 1 ? "s" : ""}</span>
        )}
        <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
          {item.detection_source} · {Math.round((item.confidence || 0) * 100)}%
        </span>
      </div>
      <div className="text-sm or-wrap mb-1" style={{ color: "var(--text-main)" }}>
        {item.preview || <em>(no text preview)</em>}
      </div>
      <div className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
        @{item.uploader_username || item.uploader_id || "unknown"} · status: {item.moderation_status || "approved"} · scanned {item.scanned_at || "—"}
      </div>
      <div className="flex flex-wrap gap-1">
        <button className="or-chip" disabled={busy} onClick={() => onAction(item, "approve")} data-testid={`ts-approve-${item.id}`}>
          <CheckCircle2 size={11} /> No violation
        </button>
        {blurred ? (
          <button className="or-chip" disabled={busy} onClick={() => onAction(item, "unblur")} data-testid={`ts-unblur-${item.id}`}>
            <Eye size={11} /> Remove blur
          </button>
        ) : (
          <button className="or-chip" disabled={busy} onClick={() => onBlur(item)} data-testid={`ts-blur-${item.id}`}>
            <EyeOff size={11} /> Blur
          </button>
        )}
        <button className="or-chip" disabled={busy} onClick={() => onAction(item, "hide")} data-testid={`ts-hide-${item.id}`}>
          <EyeOff size={11} /> Hide
        </button>
        <button className="or-chip" disabled={busy} onClick={() => onAction(item, "restore")} data-testid={`ts-restore-${item.id}`}>
          <RotateCcw size={11} /> Restore
        </button>
        <button className="or-chip" disabled={busy} onClick={() => onAction(item, "rescan")} data-testid={`ts-rescan-${item.id}`}>
          <RefreshCcw size={11} /> Rescan
        </button>
        <button className="or-chip" disabled={busy} style={{ color: "#FF8080", borderColor: "rgba(255,80,80,0.4)" }}
          onClick={() => onAction(item, "delete")} data-testid={`ts-delete-${item.id}`}>
          <Trash2 size={11} /> Remove
        </button>
        <button className="or-chip" disabled={busy} style={{ color: "#FF8080", borderColor: "rgba(255,80,80,0.4)" }}
          onClick={() => onAction(item, "ban")} data-testid={`ts-ban-${item.id}`}>
          <UserX size={11} /> Ban user
        </button>
        <button className="or-chip" disabled={busy} onClick={() => onOpenCase?.(item.content_type, item.id)} data-testid={`ts-case-open-${item.id}`}>
          <FolderOpen size={11} /> Case
        </button>
      </div>
    </div>
  );
}

function ReportRow({ r, onUpdate, onContentAction, busy }) {
  return (
    <div className="or-surface p-3" data-testid={`ts-report-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="or-chip text-[10px]">{r.reason?.replace(/_/g, " ")}</span>
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          {r.content_type} · {r.status}{r.removed_from_active_queue ? " · removed from queue" : ""}
        </span>
        <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>{r.created_at}</span>
      </div>
      <div className="text-sm or-wrap" style={{ color: "var(--text-main)" }}>
        {r.detail || <em>(no notes)</em>}
      </div>
      <div className="text-[10px] mt-0.5 mb-2" style={{ color: "var(--text-muted)" }}>
        Reporter: @{r.reporter_username || "unknown"} · target: {r.content_type}:{r.content_id}
        {r.ticket_number ? ` · ticket #${r.ticket_number}` : ""}
      </div>
      <div className="flex flex-wrap gap-1">
        {r.status === "open" && !r.removed_from_active_queue && (
          <>
            <button className="or-chip" disabled={busy} onClick={() => onUpdate(r, "close")} data-testid={`ts-report-close-${r.id}`}>
              <CheckCircle2 size={11} /> No violation
            </button>
            <button className="or-chip" disabled={busy} onClick={() => onContentAction(r, "hide")} data-testid={`ts-report-hide-${r.id}`}>
              <EyeOff size={11} /> Hide content
            </button>
            <button className="or-chip" disabled={busy} onClick={() => onContentAction(r, "delete")}
              style={{ color: "#FF8080", borderColor: "rgba(255,80,80,0.4)" }} data-testid={`ts-report-remove-content-${r.id}`}>
              <Trash2 size={11} /> Remove content
            </button>
            <button className="or-chip" disabled={busy} onClick={() => onUpdate(r, "remove")} data-testid={`ts-report-remove-${r.id}`}>
              <Flag size={11} /> Remove report
            </button>
          </>
        )}
        {(r.status !== "open" || r.removed_from_active_queue) && (
          <button className="or-chip" disabled={busy} onClick={() => onUpdate(r, "reopen")} data-testid={`ts-report-reopen-${r.id}`}>
            <RotateCcw size={11} /> Reopen
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminModerationCenter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "overview");
  const [caseTarget, setCaseTarget] = useState(() => {
    const c = searchParams.get("case");
    if (c && c.includes(":")) {
      const [ct, id] = c.split(":");
      return { contentType: ct, contentId: id };
    }
    return null;
  });
  const [summary, setSummary] = useState(null);
  const [cases, setCases] = useState([]);
  const [reports, setReports] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [logItems, setLogItems] = useState([]);
  const [reportStatus, setReportStatus] = useState("open");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [blurTarget, setBlurTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const s = await apiClient.get("/admin/moderation/safety-summary");
      setSummary(s.data);
      if (CASE_TABS.has(tab)) {
        const c = await apiClient.get(`/admin/moderation/cases?tab=${tab}&limit=50`);
        setCases(c.data?.items || []);
      } else if (tab === "reports") {
        const r = await apiClient.get(`/admin/moderation/reports?status=${reportStatus}&limit=100`);
        setReports(r.data?.reports || []);
      } else if (tab === "removed") {
        const r = await apiClient.get("/admin/moderation/removed?limit=50");
        setRemoved(r.data?.items || []);
      } else if (tab === "log") {
        const l = await apiClient.get("/admin/moderation/log?limit=150");
        setLogItems(l.data?.items || []);
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load Trust & Safety data");
    } finally { setLoading(false); }
  }, [tab, reportStatus]);

  useEffect(() => { load(); }, [load]);

  const act = async (item, action) => {
    setBusy(true); setErr("");
    try {
      if (action === "unblur") {
        await apiClient.post(`/admin/moderation/${item.content_type}/${item.id}/unblur`, { reason: null });
      } else if (action === "rescan") {
        await apiClient.post(`/admin/moderation/${item.content_type}/${item.id}/rescan`);
      } else {
        await apiClient.post(`/admin/moderation/${item.content_type}/${item.id}/action`, { action });
      }
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Action failed");
    } finally { setBusy(false); }
  };

  const updateReport = async (r, action) => {
    let reason = null;
    if (action === "remove") {
      reason = window.prompt("Reason for removing this report from the active queue (required):");
      if (!reason) return;
    }
    setBusy(true); setErr("");
    try {
      await apiClient.post(`/admin/moderation/reports/${r.id}/update`, { action, reason });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Report update failed");
    } finally { setBusy(false); }
  };

  const reportContentAction = async (r, action) => {
    setBusy(true); setErr("");
    try {
      await apiClient.post(`/admin/moderation/${r.content_type}/${r.content_id}/action`, { action });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Action failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto pb-16" data-testid="admin-moderation-center">
      <AdminBackButton />
      <div className="flex items-center gap-2 mb-1 mt-2">
        <Shield size={22} style={{ color: "var(--primary)" }} />
        <h1 className="text-3xl" style={{ fontFamily: "var(--font-display)" }}>Trust &amp; Safety</h1>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Moderation Center — AI detection assists review; it never assumes guilt.
        {summary?.detection_enabled === false && (
          <span style={{ color: "#FF8080" }}> Vision detection is OFFLINE (no key).</span>
        )}
      </p>

      <div className="flex gap-1.5 flex-wrap mb-5" data-testid="ts-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="text-[11px] uppercase tracking-wide px-3 py-1.5"
            style={{
              borderRadius: 999,
              background: tab === t.id ? "color-mix(in srgb, var(--primary) 22%, transparent)" : "transparent",
              color: tab === t.id ? "var(--primary)" : "var(--text-muted)",
              border: tab === t.id ? "1px solid var(--primary)" : "1px solid var(--border-col)",
            }}
            data-testid={`ts-tab-${t.id}`}
          >
            {t.id === "urgent" && <AlertTriangle size={10} style={{ display: "inline", marginRight: 4 }} />}
            {t.label}
          </button>
        ))}
      </div>

      {err && <div className="or-surface p-3 mb-3 text-sm" style={{ color: "#FF8080" }} data-testid="ts-error">{err}</div>}

      {loading ? (
        <div className="or-surface p-8 flex justify-center" style={{ color: "var(--text-muted)" }}>
          <Loader2 className="animate-spin" />
        </div>
      ) : tab === "overview" ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-testid="ts-stats">
            {STAT_CARDS.map((c) => (
              <StatCard key={c.id} label={c.label} value={summary?.[c.id]} testid={`ts-stat-${c.id}`} />
            ))}
          </div>
          <div className="or-surface p-4 mb-4">
            <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
              Most common categories
            </div>
            {(summary?.top_categories || []).length === 0 ? (
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>No flagged categories yet.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {summary.top_categories.map((c) => (
                  <span key={c.category} className="or-chip text-[11px]" data-testid={`ts-cat-${c.category}`}>
                    {c.category} · {c.count}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="or-surface p-4 text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="ts-model-info">
            <ShieldAlert size={12} style={{ display: "inline", marginRight: 6 }} />
            Detection model: {summary?.detection_model} · media is scanned once at
            upload and cached — feeds never rescan.
          </div>
        </>
      ) : tab === "users" ? (
        <ModUserPanel onOpenCase={(ct, id) => setCaseTarget({ contentType: ct, contentId: id })} />
      ) : tab === "content" ? (
        <ModContentSearch onOpenCase={(ct, id) => setCaseTarget({ contentType: ct, contentId: id })} />
      ) : tab === "reports" ? (
        <>
          <div className="flex gap-1.5 mb-3">
            {["open", "resolved", "removed", "all"].map((s) => (
              <button key={s} className="or-chip text-[11px]"
                style={reportStatus === s ? { color: "var(--primary)", borderColor: "var(--primary)" } : undefined}
                onClick={() => setReportStatus(s)} data-testid={`ts-report-filter-${s}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="space-y-2" data-testid="ts-reports-list">
            {reports.length === 0 ? (
              <div className="or-surface p-5 text-sm" style={{ color: "var(--text-muted)" }} data-testid="ts-reports-empty">
                No {reportStatus} reports.
              </div>
            ) : reports.map((r) => (
              <ReportRow key={r.id} r={r} onUpdate={updateReport} onContentAction={reportContentAction} busy={busy} />
            ))}
          </div>
        </>
      ) : tab === "removed" ? (
        <div className="space-y-2" data-testid="ts-removed-list">
          {removed.length === 0 ? (
            <div className="or-surface p-5 text-sm" style={{ color: "var(--text-muted)" }}>Nothing removed.</div>
          ) : removed.map((it) => (
            <div key={`${it.content_type}-${it.id}`} className="or-surface p-3" data-testid={`ts-removed-${it.id}`}>
              <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
                {it.content_type} · {it.moderation_reason || "n/a"} · {it.moderated_at}
              </div>
              <div className="text-sm or-wrap mb-2" style={{ color: "var(--text-main)" }}>{it.title || <em>(no preview)</em>}</div>
              <div className="flex gap-1">
                <button className="or-chip" disabled={busy} onClick={() => act({ content_type: it.content_type, id: it.id }, "restore")} data-testid={`ts-removed-restore-${it.id}`}>
                  <RotateCcw size={11} /> Restore
                </button>
                <button className="or-chip" disabled={busy} style={{ color: "#FF8080", borderColor: "rgba(255,80,80,0.4)" }}
                  onClick={() => act({ content_type: it.content_type, id: it.id }, "delete")} data-testid={`ts-removed-delete-${it.id}`}>
                  <Trash2 size={11} /> Delete permanently
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : tab === "log" ? (
        <div className="space-y-1.5" data-testid="ts-log-list">
          {logItems.length === 0 ? (
            <div className="or-surface p-5 text-sm" style={{ color: "var(--text-muted)" }}>No audit entries yet.</div>
          ) : logItems.map((l) => (
            <div key={l.id} className="or-surface p-2.5 flex items-start gap-2 text-[11px]" data-testid={`ts-log-${l.id}`}>
              <FileText size={12} style={{ color: "var(--text-muted)", marginTop: 2 }} />
              <div className="flex-1 min-w-0" style={{ color: "var(--text-main)" }}>
                <b>{l.action}</b> · {l.content_type}:{String(l.content_id).slice(0, 10)}…
                {l.reason ? ` · ${l.reason}` : ""}
                <div style={{ color: "var(--text-muted)" }}>
                  {l.created_at} · actor {l.actor_id ? String(l.actor_id).slice(0, 8) : "system"}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2" data-testid={`ts-cases-${tab}`}>
          {cases.length === 0 ? (
            <div className="or-surface p-5 text-sm" style={{ color: "var(--text-muted)" }} data-testid="ts-cases-empty">
              {tab === "urgent" ? "No urgent safety cases — good." : "No cases in this queue."}
            </div>
          ) : cases.map((it) => (
            <CaseRow key={`${it.content_type}-${it.id}`} item={it} onAction={act} onBlur={setBlurTarget} busy={busy} />
          ))}
        </div>
      )}

      {blurTarget && (
        <AdminBlurModal
          contentType={blurTarget.content_type}
          contentId={blurTarget.id}
          onClose={() => setBlurTarget(null)}
          onDone={() => load()}
        />
      )}

      {caseTarget && (
        <ModCaseDetail
          contentType={caseTarget.contentType}
          contentId={caseTarget.contentId}
          onClose={() => { setCaseTarget(null); setSearchParams({}, { replace: true }); }}
          onChanged={() => load()}
        />
      )}
    </div>
  );
}
