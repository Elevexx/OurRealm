/**
 * /admin/support — Phase B helpdesk dashboard.
 *
 * Reads from:
 *   GET  /api/admin/support/summary           → status totals
 *   GET  /api/admin/support/tickets?status=…  → ticket list
 *   POST /api/admin/support/tickets/{id}      → change status / subject
 *
 * Permission gating mirrors backend `require_admin`: @stealth, @support,
 * or any role==='admin'.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LifeBuoy, Loader2, MessageSquare, ShieldCheck, RefreshCw, Edit3, Check, X,
  Flag, ChevronDown, ChevronUp, UserCheck,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import AdminUserControlWidget from "@/components/AdminUserControlWidget";
import AdminPasswordResetWidget from "@/components/AdminPasswordResetWidget";
import AdminBackButton from "@/components/AdminBackButton";

const STATUSES = ["Submitted", "In Progress", "Completed", "Incomplete"];

const STATUS_COLORS = {
  Submitted:     "#FFD166",
  "In Progress": "#4DD2FF",
  Completed:     "#00FF66",
  Incomplete:    "#FF6B6B",
};

function StatusPill({ status }) {
  const c = STATUS_COLORS[status] || "var(--text-muted)";
  return (
    <span
      className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
      style={{ color: c, background: `${c}1f`, border: `1px solid ${c}55` }}
    >
      {status}
    </span>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="or-surface p-4" data-testid={`support-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div
        className="text-2xl mt-1"
        style={{ fontFamily: "var(--font-display)", color: accent || "var(--text-main)" }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function TicketRow({ t, onChanged, assignable }) {
  const navigate = useNavigate();
  const [editingSubj, setEditingSubj] = useState(false);
  const [subj, setSubj] = useState(t.subject || "");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);

  const loadReport = async () => {
    if (report) { setReportOpen((v) => !v); return; }
    try {
      const { data } = await apiClient.get(`/admin/support/tickets/${t.id}/report`);
      setReport(data.report);
      setReportOpen(true);
    } catch (e) {
      alert(e?.response?.data?.detail || "Could not load report");
    }
  };

  const submit = async (patch) => {
    setBusy(true);
    try {
      await apiClient.post(`/admin/support/tickets/${t.id}`, patch);
      onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className="or-surface p-3 flex flex-col sm:flex-row gap-3 sm:items-center"
      data-testid={`admin-ticket-row-${t.ticket_number}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>#{t.ticket_number}</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            @{t.username || "user"}
          </span>
          <StatusPill status={t.status} />
          {t.assignee_username ? (
            <span
              className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full inline-flex items-center gap-1"
              style={{ color: "#4DD2FF", background: "rgba(77,210,255,0.12)", border: "1px solid rgba(77,210,255,0.35)" }}
              data-testid={`admin-ticket-assignee-badge-${t.ticket_number}`}
              title={`Assigned to @${t.assignee_username}`}
            >
              <UserCheck size={10} /> @{t.assignee_username}
            </span>
          ) : (
            <span
              className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ color: "var(--text-muted)", background: "rgba(120,120,120,0.08)", border: "1px solid var(--border-col)" }}
              data-testid={`admin-ticket-assignee-badge-${t.ticket_number}`}
            >
              Unassigned
            </span>
          )}
        </div>
        {editingSubj ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              value={subj}
              onChange={(e) => setSubj(e.target.value)}
              maxLength={100}
              className="or-input flex-1 text-sm"
              data-testid={`admin-ticket-subject-input-${t.ticket_number}`}
            />
            <button
              className="or-btn or-btn-ghost"
              style={{ padding: "0.3rem 0.5rem" }}
              onClick={() => { submit({ subject: subj }); setEditingSubj(false); }}
              disabled={busy}
              data-testid={`admin-ticket-subject-save-${t.ticket_number}`}
              title="Save subject"
            >
              <Check size={14} />
            </button>
            <button
              className="or-btn or-btn-ghost"
              style={{ padding: "0.3rem 0.5rem" }}
              onClick={() => { setSubj(t.subject || ""); setEditingSubj(false); }}
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-1">
            <div className="font-semibold text-sm truncate" style={{ color: "var(--text-main)" }}>
              {t.subject}
            </div>
            <button
              className="opacity-60 hover:opacity-100"
              onClick={() => setEditingSubj(true)}
              data-testid={`admin-ticket-subject-edit-${t.ticket_number}`}
              title="Edit subject"
            >
              <Edit3 size={12} />
            </button>
          </div>
        )}
        <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          Updated {new Date(t.updated_at).toLocaleString()}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={t.status}
          onChange={(e) => submit({ status: e.target.value })}
          disabled={busy}
          className="or-input text-xs"
          style={{ padding: "0.35rem 0.5rem" }}
          data-testid={`admin-ticket-status-${t.ticket_number}`}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={t.assignee_id || ""}
          onChange={(e) => submit({ assignee_id: e.target.value })}
          disabled={busy || !assignable || assignable.length === 0}
          className="or-input text-xs"
          style={{ padding: "0.35rem 0.5rem", maxWidth: 160 }}
          data-testid={`admin-ticket-assignee-${t.ticket_number}`}
          title={t.assignee_username ? `Assigned to @${t.assignee_username}` : "Unassigned"}
        >
          <option value="">Unassigned</option>
          {(assignable || []).map((u) => (
            <option key={u.id} value={u.id}>
              @{u.username}{u.admin_role ? ` · ${u.admin_role.replace("_", " ")}` : ""}
            </option>
          ))}
        </select>
        <button
          className="or-btn or-btn-ghost"
          style={{ padding: "0.35rem 0.6rem", fontSize: "0.7rem" }}
          onClick={() => navigate(`/messages?dm=${encodeURIComponent(t.username || "")}`)}
          data-testid={`admin-ticket-open-chat-${t.ticket_number}`}
          title="Open DM with user"
        >
          <MessageSquare size={12} /> Chat
        </button>
        {t.report_type && (
          <button
            className="or-btn or-btn-ghost"
            style={{ padding: "0.35rem 0.6rem", fontSize: "0.7rem", color: "#FF8080" }}
            onClick={loadReport}
            data-testid={`admin-ticket-report-toggle-${t.ticket_number}`}
            title="View report details"
          >
            <Flag size={12} /> Report {reportOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
      </div>

      {/* Report details — privacy-safe: shows reporter metadata + their
          uploaded screenshots only. NEVER renders message text for
          target_type='message'. */}
      {reportOpen && report && (
        <div
          className="w-full mt-3 pt-3"
          style={{ borderTop: "1px dashed var(--border-col)" }}
          data-testid={`admin-ticket-report-details-${t.ticket_number}`}
        >
          <div className="grid grid-cols-2 gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <div><b style={{ color: "var(--text-main)" }}>Type:</b> {report.content_type}</div>
            <div><b style={{ color: "var(--text-main)" }}>Reason:</b> {(report.reason || "").replace(/_/g, " ")}</div>
            <div className="col-span-2 truncate">
              <b style={{ color: "var(--text-main)" }}>Target ID:</b>{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>{report.content_id}</code>
            </div>
            {report.detail && (
              <div className="col-span-2">
                <b style={{ color: "var(--text-main)" }}>Description:</b>{" "}
                <span style={{ color: "var(--text-main)" }}>{report.detail}</span>
              </div>
            )}
            {report.content_type === "message" && (
              <div
                className="col-span-2 text-[10px] mt-1 italic"
                style={{ color: "#FFD166" }}
              >
                Privacy: the reported conversation is not visible. Only the reporter's screenshots and description are available below.
              </div>
            )}
          </div>
          {(report.screenshots || []).length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-2" data-testid={`admin-ticket-report-screenshots-${t.ticket_number}`}>
              {report.screenshots.map((s) => (
                <a
                  key={s.id}
                  href={s.url?.startsWith("/api/") ? `${process.env.REACT_APP_BACKEND_URL || ""}${s.url}` : s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                  data-testid={`admin-ticket-report-shot-${s.id}`}
                >
                  <img
                    src={s.thumbnail_url?.startsWith("/api/")
                      ? `${process.env.REACT_APP_BACKEND_URL || ""}${s.thumbnail_url}`
                      : (s.thumbnail_url || s.url)}
                    alt=""
                    className="w-full h-20 object-cover rounded"
                    style={{ border: "1px solid var(--border-col)" }}
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function AdminSupport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [assignable, setAssignable] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const loadAssignable = async () => {
    try {
      const { data } = await apiClient.get("/admin/support/assignable");
      setAssignable(data.assignable || []);
    } catch (e) {
      // Non-fatal — picker just renders empty options.
      setAssignable([]);
    }
  };

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (assigneeFilter) params.assignee_id = assigneeFilter;
      const [s, t] = await Promise.all([
        apiClient.get("/admin/support/summary"),
        apiClient.get("/admin/support/tickets", { params }),
      ]);
      setSummary(s.data);
      setTickets(t.data.tickets || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user && isAdmin(user)) loadAssignable(); /* eslint-disable-next-line */ }, [user]);
  useEffect(() => { if (user && isAdmin(user)) load(); /* eslint-disable-next-line */ }, [user, statusFilter, assigneeFilter]);

  if (!user) {
    return (
      <div className="or-surface p-6 max-w-md mx-auto" style={{ color: "var(--text-muted)" }}>
        Sign in required.
      </div>
    );
  }
  if (!isAdmin(user)) {
    return (
      <div className="or-surface p-6 max-w-md mx-auto" data-testid="admin-support-forbidden">
        Admin access required.
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto" data-testid="admin-support-page">
      <AdminBackButton className="mb-3" />
      <header className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <ShieldCheck size={26} style={{ color: "#00FF66" }} />
          <div>
            <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>
              Admin · Support
            </div>
            <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              Helpdesk
            </h1>
          </div>
        </div>
        <button
          onClick={load}
          className="or-btn or-btn-ghost"
          data-testid="admin-support-refresh"
          title="Refresh"
        >
          <RefreshCw size={14} /> Refresh
        </button>
        <button
          onClick={() => navigate("/admin/faq")}
          className="or-btn or-btn-ghost"
          data-testid="admin-support-faq-link"
          title="Manage FAQ"
        >
          FAQ
        </button>
      </header>

      {/* Founder/admin tools — mounted above the helpdesk so admins can
          act on user accounts and reset passwords before triaging the
          ticket queue below. Both widgets render `null` for non-admins,
          but this page is already admin-gated so they always appear. */}
      <AdminUserControlWidget />
      <AdminPasswordResetWidget />

      {err && (
        <div
          className="or-surface p-4 mb-4 text-sm"
          style={{ color: "#ff8080", border: "1px solid rgba(255,80,80,0.4)" }}
          data-testid="admin-support-error"
        >
          {err}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          <Stat label="Total"        value={summary.total} />
          <Stat label="Submitted"    value={summary.Submitted}     accent={STATUS_COLORS.Submitted} />
          <Stat label="In Progress"  value={summary["In Progress"]} accent={STATUS_COLORS["In Progress"]} />
          <Stat label="Completed"    value={summary.Completed}     accent={STATUS_COLORS.Completed} />
          <Stat label="Incomplete"   value={summary.Incomplete}    accent={STATUS_COLORS.Incomplete} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 mb-3" data-testid="admin-support-filter">
        <button
          className="text-xs px-3 py-1.5"
          onClick={() => setStatusFilter("")}
          data-active={statusFilter === ""}
          data-testid="admin-support-filter-all"
          style={{
            borderRadius: 999,
            border: `1px solid ${statusFilter === "" ? "var(--primary)" : "var(--border-col)"}`,
            color: statusFilter === "" ? "var(--primary)" : "var(--text-muted)",
            background: statusFilter === "" ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "transparent",
          }}
        >All</button>
        {STATUSES.map((s) => (
          <button
            key={s}
            className="text-xs px-3 py-1.5"
            onClick={() => setStatusFilter(s)}
            data-active={statusFilter === s}
            data-testid={`admin-support-filter-${s.toLowerCase().replace(/\s+/g, "-")}`}
            style={{
              borderRadius: 999,
              border: `1px solid ${statusFilter === s ? STATUS_COLORS[s] : "var(--border-col)"}`,
              color: statusFilter === s ? STATUS_COLORS[s] : "var(--text-muted)",
              background: statusFilter === s ? `${STATUS_COLORS[s]}1f` : "transparent",
            }}
          >{s}</button>
        ))}
      </div>

      {/* Filter by assignee — appears only when assignable users are loaded. */}
      {assignable.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1 mb-3"
          data-testid="admin-support-assignee-filter"
        >
          <span className="text-[11px] uppercase tracking-widest mr-1" style={{ color: "var(--text-muted)" }}>
            Assignee:
          </span>
          <button
            className="text-xs px-3 py-1.5"
            onClick={() => setAssigneeFilter("")}
            data-active={assigneeFilter === ""}
            data-testid="admin-support-assignee-filter-all"
            style={{
              borderRadius: 999,
              border: `1px solid ${assigneeFilter === "" ? "var(--primary)" : "var(--border-col)"}`,
              color: assigneeFilter === "" ? "var(--primary)" : "var(--text-muted)",
              background: assigneeFilter === "" ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "transparent",
            }}
          >All</button>
          <button
            className="text-xs px-3 py-1.5"
            onClick={() => setAssigneeFilter("unassigned")}
            data-active={assigneeFilter === "unassigned"}
            data-testid="admin-support-assignee-filter-unassigned"
            style={{
              borderRadius: 999,
              border: `1px solid ${assigneeFilter === "unassigned" ? "#FFD166" : "var(--border-col)"}`,
              color: assigneeFilter === "unassigned" ? "#FFD166" : "var(--text-muted)",
              background: assigneeFilter === "unassigned" ? "rgba(255,209,102,0.12)" : "transparent",
            }}
          >Unassigned</button>
          {assignable.map((u) => (
            <button
              key={u.id}
              className="text-xs px-3 py-1.5"
              onClick={() => setAssigneeFilter(u.id)}
              data-active={assigneeFilter === u.id}
              data-testid={`admin-support-assignee-filter-${u.username}`}
              style={{
                borderRadius: 999,
                border: `1px solid ${assigneeFilter === u.id ? "#4DD2FF" : "var(--border-col)"}`,
                color: assigneeFilter === u.id ? "#4DD2FF" : "var(--text-muted)",
                background: assigneeFilter === u.id ? "rgba(77,210,255,0.14)" : "transparent",
              }}
              title={u.admin_role ? `@${u.username} · ${u.admin_role}` : `@${u.username}`}
            >@{u.username}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="admin-support-empty">
          No tickets in this view.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="admin-support-tickets">
          {tickets.map((t) => (
            <TicketRow key={t.id} t={t} onChanged={load} assignable={assignable} />
          ))}
        </ul>
      )}
    </div>
  );
}
