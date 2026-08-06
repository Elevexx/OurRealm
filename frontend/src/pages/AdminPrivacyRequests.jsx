/**
 * /admin/privacy-requests — Privacy Requests queue + Deletion jobs.
 * Deadline tracking, overdue/urgent escalation, decision panel
 * (approve / partial / refuse / restricted retention), calendar-month
 * extensions, identity verification, manual intake, job stage view
 * with retry + founder stop (only before irreversible erasure).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, FileText,
  Loader2, Plus, RefreshCw, ShieldCheck, StopCircle, UserCheck,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import AdminBackButton from "@/components/AdminBackButton";
import { toast } from "sonner";

const STATUS_COLORS = {
  received: "#FFD166", identity_pending: "#FFA94D", under_review: "#4DD2FF",
  approved: "#00FF66", partially_approved: "#9AE66E", refused: "#FF6B6B",
  restricted_retention: "#C084FC", withdrawn: "#8B8B8B", completed: "#00FF66",
};

function Pill({ text, color }) {
  const c = color || "var(--text-muted)";
  return (
    <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
      style={{ color: c, background: `${c}1f`, border: `1px solid ${c}55` }}>
      {text}
    </span>
  );
}

function DeadlineChip({ req }) {
  if (req.days_remaining == null) return null;
  if (req.overdue) return <Pill text={`OVERDUE ${Math.abs(req.days_remaining)}d`} color="#FF4444" />;
  if (req.urgent) return <Pill text={`Due in ${req.days_remaining}d`} color="#FFA94D" />;
  return <Pill text={`${req.days_remaining}d left`} color="#8B8B8B" />;
}

function DecisionPanel({ req, isFounder, onDone }) {
  const [action, setAction] = useState("approve");
  const [reason, setReason] = useState("");
  const [categories, setCategories] = useState("");
  const [purpose, setPurpose] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const body = { action, reason };
      if (action === "restricted_retention") {
        body.retention = {
          categories: categories.split(",").map((c) => c.trim()).filter(Boolean),
          purpose, review_date: reviewDate, expires_at: expiresAt || null,
        };
      }
      await apiClient.post(`/admin/privacy/requests/${req.id}/decision`, body);
      toast.success("Decision recorded");
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 p-3 rounded" style={{ border: "1px solid var(--border-col)" }}
      data-testid={`decision-panel-${req.id}`}>
      <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Decision</div>
      <div className="flex flex-wrap gap-1 mb-2">
        {["approve", "partial", "refuse", ...(isFounder ? ["restricted_retention"] : [])].map((a) => (
          <button key={a} type="button" className="or-chip text-xs" data-active={action === a}
            onClick={() => setAction(a)} data-testid={`decision-action-${a}`}
            style={action === a ? { borderColor: "#4DD2FF", color: "#4DD2FF" } : {}}>
            {a.replace("_", " ")}
          </button>
        ))}
      </div>
      {action === "approve" && (
        <p className="text-[11px] mb-2" style={{ color: "#FFA94D" }}>
          Approving hides the account immediately and starts permanent erasure.
        </p>
      )}
      {(action === "refuse" || action === "partial") && (
        <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
          Refusal / partial approval keeps the account's current visibility state —
          it never automatically restores a closed or restricted account.
        </p>
      )}
      {action === "restricted_retention" && (
        <div className="space-y-2 mb-2">
          <input className="or-input" placeholder="Retained data categories (comma-separated)"
            value={categories} onChange={(e) => setCategories(e.target.value)}
            data-testid="retention-categories" />
          <input className="or-input" placeholder="Documented purpose"
            value={purpose} onChange={(e) => setPurpose(e.target.value)}
            data-testid="retention-purpose" />
          <div className="flex gap-2">
            <input className="or-input" type="date" title="Review date"
              value={reviewDate} onChange={(e) => setReviewDate(e.target.value)}
              data-testid="retention-review-date" />
            <input className="or-input" type="date" title="Expiration date (optional)"
              value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              data-testid="retention-expires" />
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            The rest of the account is erased; only the listed categories are
            retained under access restrictions with no public visibility,
            advertising, profiling or unrelated use.
          </p>
        </div>
      )}
      <textarea className="or-input mb-2" rows={2} value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Documented reason (required, min 10 chars)"
        data-testid="decision-reason" />
      <button type="button" className="or-btn text-xs" disabled={busy || reason.trim().length < 10}
        onClick={submit} data-testid="decision-submit">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
        &nbsp;Record Decision
      </button>
    </div>
  );
}

function RequestRow({ req, isFounder, onChanged }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [extendReason, setExtendReason] = useState("");
  const [showExtend, setShowExtend] = useState(false);

  const loadDetail = async () => {
    if (open) { setOpen(false); return; }
    try {
      const { data } = await apiClient.get(`/admin/privacy/requests/${req.id}`);
      setDetail(data.request); setOpen(true);
    } catch (e) { toast.error("Could not load request"); }
  };

  const identity = async (action) => {
    try {
      await apiClient.post(`/admin/privacy/requests/${req.id}/identity`, { action });
      toast.success(action === "mark_verified" ? "Identity marked verified" : "Info requested");
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const extend = async () => {
    try {
      await apiClient.post(`/admin/privacy/requests/${req.id}/extend`, { reason: extendReason });
      toast.success("Deadline extended"); setShowExtend(false); onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Extension failed"); }
  };

  const isOpen = ["received", "identity_pending", "under_review"].includes(req.status);

  return (
    <li className="or-surface p-3" data-testid={`privacy-request-row-${req.id}`}>
      <div className="flex items-center gap-2 flex-wrap cursor-pointer" onClick={loadDetail}>
        <span className="text-sm font-semibold">@{req.username}</span>
        <Pill text={req.status.replace(/_/g, " ")} color={STATUS_COLORS[req.status]} />
        <DeadlineChip req={req} />
        {req.identity_verified_at
          ? <Pill text="identity verified" color="#00FF66" />
          : <Pill text="identity unverified" color="#FFA94D" />}
        {req.hide_account_selected && <Pill text="user chose hide" color="#C084FC" />}
        <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
          received {String(req.received_at).slice(0, 10)} · due {String(req.extended_due_at || req.response_due_at).slice(0, 10)}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>

      {open && detail && (
        <div className="mt-3 text-sm space-y-2" data-testid={`privacy-request-detail-${req.id}`}>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            Jurisdiction: {detail.jurisdiction} · Source: {detail.source}
            {detail.account && <> · Account status: {detail.account.account_status || "active"}{detail.account.disabled ? " (hidden)" : " (publicly visible)"}</>}
          </div>
          {detail.details && <p className="text-xs">"{detail.details}"</p>}
          {detail.original_evidence && (
            <div className="text-[11px] p-2 rounded" style={{ background: "rgba(192,132,252,0.08)", border: "1px solid rgba(192,132,252,0.3)" }}>
              <FileText size={11} className="inline mr-1" />Restricted evidence: {detail.original_evidence}
            </div>
          )}
          {detail.extension_applied_at && (
            <div className="text-[11px]" style={{ color: "#FFA94D" }}>
              Extended to {String(detail.extended_due_at).slice(0, 10)} — {detail.extension_reason}
            </div>
          )}
          {detail.timeline?.length > 0 && (
            <ul className="text-[11px] space-y-0.5" style={{ color: "var(--text-muted)" }}>
              {detail.timeline.map((t, i) => (
                <li key={i}>• {String(t.at).slice(0, 16).replace("T", " ")} — {t.event}{t.note ? `: ${t.note}` : ""}</li>
              ))}
            </ul>
          )}
          {detail.decision_reason && (
            <p className="text-xs"><strong>Decision:</strong> {detail.decision} — {detail.decision_reason}</p>
          )}
          {detail.retention && (
            <div className="text-[11px] p-2 rounded" style={{ border: "1px solid rgba(192,132,252,0.35)" }}>
              Restricted retention: {detail.retention.categories?.join(", ")} · purpose: {detail.retention.purpose} ·
              review {detail.retention.review_date} · status {detail.retention.status}
            </div>
          )}
          {detail.job && (
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Erasure job: {detail.job.status} (stage {detail.job.current_stage})
            </div>
          )}

          {isOpen && (
            <>
              <div className="flex flex-wrap gap-1">
                {!req.identity_verified_at && (
                  <>
                    <button type="button" className="or-chip text-xs" onClick={() => identity("request_info")}
                      data-testid={`identity-request-${req.id}`}>Request identity info</button>
                    <button type="button" className="or-chip text-xs" onClick={() => identity("mark_verified")}
                      data-testid={`identity-verify-${req.id}`}><UserCheck size={11} />&nbsp;Mark identity verified</button>
                  </>
                )}
                {!req.extension_applied_at && (
                  <button type="button" className="or-chip text-xs" onClick={() => setShowExtend((v) => !v)}
                    data-testid={`extend-toggle-${req.id}`}><Clock size={11} />&nbsp;Extend deadline</button>
                )}
              </div>
              {showExtend && (
                <div className="flex gap-2 items-start">
                  <input className="or-input" placeholder="Documented reason (complex/numerous request)"
                    value={extendReason} onChange={(e) => setExtendReason(e.target.value)}
                    data-testid={`extend-reason-${req.id}`} />
                  <button type="button" className="or-btn text-xs" disabled={extendReason.trim().length < 10}
                    onClick={extend} data-testid={`extend-submit-${req.id}`}>+2 months</button>
                </div>
              )}
              <DecisionPanel req={req} isFounder={isFounder} onDone={onChanged} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

function JobRow({ job, stages, isFounder, onChanged }) {
  const [open, setOpen] = useState(false);
  const act = async (verb) => {
    try {
      await apiClient.post(`/admin/privacy/deletion-jobs/${job.id}/${verb}`);
      toast.success(verb === "stop" ? "Stop requested" : "Job re-queued");
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const color = { completed: "#00FF66", failed: "#FF6B6B", running: "#4DD2FF",
    queued: "#FFD166", stopped: "#8B8B8B" }[job.status] || "#8B8B8B";
  return (
    <li className="or-surface p-3" data-testid={`deletion-job-row-${job.id}`}>
      <div className="flex items-center gap-2 flex-wrap cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <span className="text-sm">@{job.username_snapshot}</span>
        <Pill text={job.status} color={color} />
        <Pill text={job.source} color="#8B8B8B" />
        {job.irreversible && <Pill text="irreversible" color="#FF4444" />}
        <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
          {String(job.created_at).slice(0, 16).replace("T", " ")} · {job.current_stage}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>
      {open && (
        <div className="mt-2">
          <ul className="text-[11px] space-y-0.5">
            {stages.map((s) => {
              const st = (job.stages || {})[s.key] || {};
              const c = { done: "#00FF66", failed: "#FF6B6B", running: "#4DD2FF" }[st.status] || "var(--text-muted)";
              return (
                <li key={s.key} style={{ color: c }} data-testid={`job-stage-${job.id}-${s.key}`}>
                  {st.status === "done" ? "✓" : st.status === "failed" ? "✗" : "·"} {s.label}
                  {st.error ? ` — ${st.error}` : ""}{st.attempts > 1 ? ` (attempt ${st.attempts})` : ""}
                </li>
              );
            })}
          </ul>
          <div className="flex gap-1 mt-2">
            {(job.status === "failed" || job.status === "queued") && (
              <button type="button" className="or-chip text-xs" onClick={() => act("retry")}
                data-testid={`job-retry-${job.id}`}><RefreshCw size={11} />&nbsp;Retry</button>
            )}
            {isFounder && !job.irreversible && !["completed", "stopped"].includes(job.status) && (
              <button type="button" className="or-chip text-xs" onClick={() => act("stop")}
                data-testid={`job-stop-${job.id}`} style={{ color: "#FF8080" }}>
                <StopCircle size={11} />&nbsp;Stop (before erasure)</button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function IntakeForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ username: "", received_at: "", jurisdiction: "other",
    details: "", original_evidence: "", hide_account: false });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await apiClient.post("/admin/privacy/requests/intake", {
        ...f, received_at: f.received_at ? new Date(f.received_at).toISOString() : null,
      });
      toast.success("Request logged"); setOpen(false);
      setF({ username: "", received_at: "", jurisdiction: "other", details: "", original_evidence: "", hide_account: false });
      onCreated();
    } catch (e) { toast.error(e?.response?.data?.detail || "Intake failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mb-4">
      <button type="button" className="or-chip text-xs" onClick={() => setOpen((v) => !v)}
        data-testid="intake-toggle"><Plus size={12} />&nbsp;Log request received elsewhere</button>
      {open && (
        <div className="or-surface p-3 mt-2 space-y-2" data-testid="intake-form">
          <input className="or-input" placeholder="Username" value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })} data-testid="intake-username" />
          <div className="flex gap-2">
            <input className="or-input" type="date" title="Original message date (received_at)"
              value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })}
              data-testid="intake-received-at" />
            <select className="or-input" value={f.jurisdiction}
              onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} data-testid="intake-jurisdiction">
              <option value="other">Other / Unknown</option>
              <option value="gdpr_eu">EU (GDPR)</option>
              <option value="gdpr_uk">UK (UK GDPR)</option>
              <option value="us_ca">California (CCPA)</option>
            </select>
          </div>
          <textarea className="or-input" rows={2} placeholder="Original request message (preserved as restricted evidence)"
            value={f.original_evidence} onChange={(e) => setF({ ...f, original_evidence: e.target.value })}
            data-testid="intake-evidence" />
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={f.hide_account}
              onChange={(e) => setF({ ...f, hide_account: e.target.checked })} data-testid="intake-hide" />
            Hide the account immediately (documented safety restriction)
          </label>
          <button type="button" className="or-btn text-xs" disabled={busy || !f.username}
            onClick={submit} data-testid="intake-submit">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}&nbsp;Create Request
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminPrivacyRequests() {
  const { user } = useAuth();
  const isFounder = (user?.admin_role === "founder") || (user?.username || "").toLowerCase() === "stealth";
  const [tab, setTab] = useState("queue");
  const [view, setView] = useState("");
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, j] = await Promise.all([
        apiClient.get(`/admin/privacy/requests${view ? `?view=${view}` : ""}`),
        apiClient.get("/admin/privacy/deletion-jobs"),
      ]);
      setRequests(r.data.requests); setSummary(r.data.summary);
      setJobs(j.data.jobs); setStages(j.data.stages);
    } catch (e) { /* 403 for non-admins */ }
    finally { setLoading(false); }
  }, [view]);

  useEffect(() => { load(); }, [load]);

  if (!isAdmin(user)) {
    return <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>Admin access required</div>;
  }

  return (
    <div className="max-w-4xl mx-auto" data-testid="admin-privacy-page">
      <AdminBackButton />
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={20} style={{ color: "#4DD2FF" }} />
        <h1 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Privacy Requests</h1>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Erasure requests require a documented decision — approval, partial
        approval, refusal, or restricted retention. Deadlines follow
        calendar-month rules per jurisdiction.
      </p>

      {summary && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="or-surface p-3" data-testid="privacy-stat-open">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Open</div>
            <div className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>{summary.open}</div>
          </div>
          <div className="or-surface p-3" data-testid="privacy-stat-urgent">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: "#FFA94D" }}>Due ≤ 7d</div>
            <div className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "#FFA94D" }}>{summary.urgent}</div>
          </div>
          <div className="or-surface p-3" data-testid="privacy-stat-overdue">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: "#FF4444" }}>Overdue</div>
            <div className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "#FF4444" }}>{summary.overdue}</div>
          </div>
        </div>
      )}

      <div className="flex gap-1 mb-4">
        <button type="button" className="or-chip text-xs" data-active={tab === "queue"}
          onClick={() => setTab("queue")} data-testid="privacy-tab-queue"
          style={tab === "queue" ? { borderColor: "#4DD2FF", color: "#4DD2FF" } : {}}>Requests</button>
        <button type="button" className="or-chip text-xs" data-active={tab === "jobs"}
          onClick={() => setTab("jobs")} data-testid="privacy-tab-jobs"
          style={tab === "jobs" ? { borderColor: "#4DD2FF", color: "#4DD2FF" } : {}}>Deletion Jobs ({jobs.length})</button>
        <button type="button" className="or-chip text-xs ml-auto" onClick={load} data-testid="privacy-refresh">
          <RefreshCw size={12} />
        </button>
      </div>

      {tab === "queue" && (
        <>
          <IntakeForm onCreated={load} />
          <div className="flex gap-1 mb-3">
            {[["", "All"], ["emergency", "Emergency (urgent + overdue)"], ["overdue", "Overdue"]].map(([v, l]) => (
              <button key={v} type="button" className="or-chip text-xs" data-active={view === v}
                onClick={() => setView(v)} data-testid={`privacy-view-${v || "all"}`}
                style={view === v ? { borderColor: v ? "#FF4444" : "#4DD2FF", color: v ? "#FF4444" : "#4DD2FF" } : {}}>
                {v === "emergency" && <AlertTriangle size={11} className="inline mr-1" />}{l}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" /></div>
          ) : requests.length === 0 ? (
            <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="privacy-empty">
              No privacy requests in this view.
            </div>
          ) : (
            <ul className="space-y-2" data-testid="privacy-request-list">
              {requests.map((r) => (
                <RequestRow key={r.id} req={r} isFounder={isFounder} onChanged={load} />
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "jobs" && (
        jobs.length === 0 ? (
          <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="jobs-empty">
            No deletion jobs yet.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="deletion-job-list">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} stages={stages} isFounder={isFounder} onChanged={load} />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
