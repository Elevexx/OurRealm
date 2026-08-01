import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Landmark, Search, RefreshCw, Settings as SettingsIcon, LayoutGrid, Table2, AlertTriangle, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { rcTypeMeta } from "@/lib/rcTypes";
import { RcImg } from "@/lib/rcAssets";

const fmtDate = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
};

const STATUS_COLORS = { active: "#7BD88F", paused: "#F4C84A", archived: "#9AA7BD" };

// Responsibility Center — Founder/Admin operations panel (Bundle A).
// Real database values only. Backend enforces every permission.
export default function AdminResponsibilityCenter() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [err, setErr] = useState("");

  const loadOverview = useCallback(async () => {
    try {
      const r = await apiClient.get("/admin/responsibility-center/overview");
      setOverview(r.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not load the Responsibility Center admin panel");
    }
  }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  if (err) {
    return (
      <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="rc-admin-error">
        <div className="text-sm" style={{ color: "#FF6B6B" }}>{err}</div>
      </div>
    );
  }

  const TABS = [
    { id: "overview", label: "Overview", Icon: LayoutGrid },
    { id: "centers",  label: "All Centers", Icon: Table2 },
    { id: "reports",  label: "Reports", Icon: BarChart3 },
    { id: "settings", label: "Global Settings", Icon: SettingsIcon },
  ];

  return (
    <div className="max-w-6xl mx-auto" data-testid="rc-admin-page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Admin</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
            <RcImg assetKey="responsibility_center.admin_icon" width={30} height={30} eager
              className="inline mr-2 align-[-4px]"
              fallback={<Landmark size={26} className="inline mr-2" style={{ color: "#F4C84A" }} />} />
            Responsibility Center
          </h1>
        </div>
        <div className="flex gap-2">
          <button className="or-btn or-btn-ghost" onClick={() => navigate("/admin/media/responsibility-center")} data-testid="rc-admin-media-link">
            Media
          </button>
          <button className="or-btn or-btn-ghost" onClick={loadOverview} data-testid="rc-admin-refresh"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className="or-chip shrink-0" data-active={tab === id} onClick={() => setTab(id)} data-testid={`rc-admin-tab-${id}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab data={overview} navigate={navigate} />}
      {tab === "centers" && <CentersTab navigate={navigate} />}
      {tab === "reports" && <AdminReportsTab />}
      {tab === "settings" && <SettingsTab canManage={overview?.my_permissions?.includes("responsibility_center.manage_settings")} />}
    </div>
  );
}

const Stat = ({ label, value, accent, testid }) => (
  <div className="or-surface p-3" data-testid={testid}>
    <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</div>
    <div className="text-lg font-semibold mt-0.5" style={accent ? { color: accent } : undefined}>{value ?? "—"}</div>
  </div>
);

// Bundle F — platform-level aggregated analytics (counts only, no private content)
function AdminReportsTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const from = new Date(Date.now() - days * 86400000).toISOString();
    apiClient.get("/admin/responsibility-center/reports/overview", { params: { date_from: from } })
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load analytics"));
  }, [days]);
  if (err) return <div className="or-surface p-6 text-sm" style={{ color: "#FF6B6B" }} data-testid="rc-admin-reports-error">{err}</div>;
  if (!data) return <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}>Loading analytics…</div>;
  const cards = Object.entries(data).filter(([k, v]) => typeof v === "number");
  const lists = Object.entries(data).filter(([, v]) => Array.isArray(v));
  return (
    <div className="space-y-4" data-testid="rc-admin-reports-tab">
      <div className="or-surface p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Platform analytics</h3>
          <select className="or-input text-xs" style={{ width: "auto" }} value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))} data-testid="rc-admin-reports-range">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {cards.map(([k, v]) => (
            <div key={k} className="rounded p-2.5" style={{ background: "rgba(255,255,255,0.04)" }} data-testid={`rc-admin-metric-${k}`}>
              <div className="text-lg font-semibold">{v}</div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}</div>
            </div>
          ))}
        </div>
      </div>
      {lists.map(([k, rows]) => (
        <div key={k} className="or-surface p-4" data-testid={`rc-admin-breakdown-${k}`}>
          <h4 className="text-xs font-semibold uppercase tracking-wide mb-2">{k.replace(/_/g, " ")}</h4>
          {rows.map((r) => (
            <div key={String(r.key)} className="flex items-center justify-between py-1 text-sm"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span>{String(r.key).replace(/_/g, " ")}</span><span>{r.count}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function OverviewTab({ data, navigate }) {
  if (!data) return <div className="or-surface p-6 text-sm text-center" style={{ color: "var(--text-muted)" }} data-testid="rc-admin-loading">Loading…</div>;
  const c = data.centers, m = data.memberships, f = data.fire_power, r = data.renewals;
  const groups = [
    { title: "Center Growth", stats: [
      ["Total Centers", c.total], ["Active", c.active, "#7BD88F"], ["Paused", c.paused, "#F4C84A"],
      ["Archived", c.archived], ["Created Today", c.created_today], ["Created This Week", c.created_this_week],
      ["Created This Month", c.created_this_month]] },
    { title: "Memberships & Adoption", stats: [
      ["Total Memberships", m.total], ["Active Managed Members", m.active_managed, "#7BD88F"],
      ["Paused Members", m.paused, "#F4C84A"], ["Awaiting Fire Power", m.awaiting_fire_power, "#FF8A5A"],
      ["Pending Invitations", m.pending_invitations], ["Upcoming Renewals (7d)", m.upcoming_renewals_7d]] },
    { title: "Vault Coverage & Warnings", stats: [
      ["Low Vault Centers", c.low_vault, c.low_vault ? "#FF8A5A" : undefined],
      ["Frozen Vaults", c.frozen_vaults, c.frozen_vaults ? "#5AB2FF" : undefined],
      ["Failed Renewal Attempts (30d)", r.failed_attempts_30d, r.failed_attempts_30d ? "#FF6B6B" : undefined],
      ["Successful Renewals (30d)", r.successful_30d], ["Invitations Locked", c.invitations_locked],
      ["Needs Review", c.needs_review, c.needs_review ? "#FF6B6B" : undefined], ["Reported Centers", c.reported]] },
    { title: "Fire Power Activity", stats: [
      ["Burned — Center Creation", `${(f.burned_center_creation || 0).toLocaleString()} 🔥`],
      ["Burned — Seat Activations", `${(f.burned_seat_activations || 0).toLocaleString()} 🔥`],
      ["Burned — Seat Renewals", `${(f.burned_seat_renewals || 0).toLocaleString()} 🔥`],
      ["Stored Across Center Vaults", `${(f.stored_in_vaults || 0).toLocaleString()} 🔥`, "#F4C84A"]] },
  ];
  return (
    <div className="space-y-5" data-testid="rc-admin-overview">
      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="text-sm uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>{g.title}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {g.stats.map(([label, value, accent]) => (
              <Stat key={label} label={label} value={value} accent={accent}
                testid={`rc-admin-stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} />
            ))}
          </div>
        </div>
      ))}
      <div className="or-surface p-4" data-testid="rc-admin-recent-actions">
        <h3 className="text-sm font-semibold mb-2">Recent Administrative Actions</h3>
        {(data.recent_admin_actions || []).length === 0 ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>No administrative actions recorded yet.</div>
        ) : data.recent_admin_actions.map((a) => (
          <div key={a.id} className="text-sm flex flex-wrap justify-between gap-2 py-1.5"
            style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
            <span><b>@{a.admin_username}</b> · {a.action.replace(/_/g, " ")}{a.reason ? ` — ${a.reason}` : ""}</span>
            <button className="text-xs underline shrink-0" style={{ color: "var(--primary)" }}
              onClick={() => a.center_id && navigate(`/admin/responsibility-center/${a.center_id}`)}>
              {fmtDate(a.created_at)}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const FILTERS = [
  { id: "", label: "All" }, { id: "active", label: "Active", type: "status" },
  { id: "paused", label: "Paused", type: "status" }, { id: "archived", label: "Archived", type: "status" },
  { id: "official", label: "Official" }, { id: "user_created", label: "User-created" },
  { id: "low_vault", label: "Low Vault" }, { id: "frozen_vault", label: "Frozen Vault" },
  { id: "invitations_locked", label: "Invites Locked" }, { id: "needs_review", label: "Needs Review" },
];

function CentersTab({ navigate }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [centerType, setCenterType] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const f = FILTERS.find((x) => x.id === filter);
    const params = new URLSearchParams({ q, page: String(page), limit: "25" });
    if (f?.type === "status") params.set("status", filter);
    else if (filter) params.set("flag", filter);
    if (centerType) params.set("center_type", centerType);
    try {
      const r = await apiClient.get(`/admin/responsibility-center/centers?${params}`);
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load centers");
    }
  }, [q, filter, centerType, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <div data-testid="rc-admin-centers-tab">
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input className="or-input w-full pl-9" placeholder="Search name, Center ID, owner username or email"
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="rc-admin-search" />
        </div>
        <select className="or-input" value={centerType} onChange={(e) => { setCenterType(e.target.value); setPage(1); }} data-testid="rc-admin-type-filter">
          <option value="">All types</option>
          {["family","household","business","team","organization","community","other"].map((t) => (
            <option key={t} value={t}>{rcTypeMeta(t).label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 mb-3 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => (
          <button key={f.id || "all"} className="or-chip shrink-0" data-active={filter === f.id}
            onClick={() => { setFilter(f.id); setPage(1); }} data-testid={`rc-admin-filter-${f.id || "all"}`}>
            {f.label}
          </button>
        ))}
      </div>
      {!data ? (
        <div className="or-surface p-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>
      ) : data.centers.length === 0 ? (
        <div className="or-surface p-8 text-sm text-center" style={{ color: "var(--text-muted)" }} data-testid="rc-admin-centers-empty">
          No Centers match these filters.
        </div>
      ) : (
        <div className="or-surface p-2 overflow-x-auto" data-testid="rc-admin-centers-table">
          <table className="w-full text-sm" style={{ minWidth: 900 }}>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                {["Center", "Type", "Owner", "Created", "Status", "Members", "Paused", "Invites", "Vault", "Next Requirement", "Failed", ""].map((h) => (
                  <th key={h} className="px-2 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.centers.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: "var(--border-col, rgba(255,255,255,0.08))" }}
                  data-testid={`rc-admin-row-${c.id}`}>
                  <td className="px-2 py-2">
                    <div className="font-semibold">{c.name}{c.official && <span className="text-[10px] ml-1 px-1 rounded" style={{ background: "#5AB2FF22", color: "#5AB2FF" }}>OFFICIAL</span>}</div>
                    <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{c.id.slice(0, 12)}…</div>
                  </td>
                  <td className="px-2 py-2">{rcTypeMeta(c.center_type).label}</td>
                  <td className="px-2 py-2">@{c.owner_username}</td>
                  <td className="px-2 py-2">{fmtDate(c.created_at)}</td>
                  <td className="px-2 py-2">
                    <span className="uppercase text-[11px] font-semibold" style={{ color: STATUS_COLORS[c.status] }}>{c.status}</span>
                    {c.vault_frozen && <span className="text-[10px] ml-1" style={{ color: "#5AB2FF" }}>❄</span>}
                    {c.invitations_locked && <span className="text-[10px] ml-1" style={{ color: "#F4C84A" }}>🔒</span>}
                    {c.needs_review && <AlertTriangle size={11} className="inline ml-1" style={{ color: "#FF6B6B" }} />}
                  </td>
                  <td className="px-2 py-2">{c.member_count}</td>
                  <td className="px-2 py-2" style={c.paused_members ? { color: "#F4C84A" } : undefined}>{c.paused_members}</td>
                  <td className="px-2 py-2">{c.pending_invitations}</td>
                  <td className="px-2 py-2">{c.vault_balance.toLocaleString()} 🔥</td>
                  <td className="px-2 py-2">{fmtDate(c.next_requirement_date)}</td>
                  <td className="px-2 py-2" style={c.failed_renewals ? { color: "#FF6B6B" } : undefined}>{c.failed_renewals}</td>
                  <td className="px-2 py-2">
                    <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/admin/responsibility-center/${c.id}`)}
                      data-testid={`rc-admin-open-${c.id}`}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.limit && (
        <div className="flex items-center justify-between mt-3 text-sm" data-testid="rc-admin-pagination">
          <button className="or-btn or-btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
          <span style={{ color: "var(--text-muted)" }}>Page {page} of {totalPages} · {data.total} Centers</span>
          <button className="or-btn or-btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

const SETTING_FIELDS = [
  { key: "create_cost", label: "Center Creation Fire Power Requirement", type: "int" },
  { key: "seat_cost", label: "Managed-Member Fire Power Requirement", type: "int" },
  { key: "period_days", label: "Active-Period Length (days)", type: "int" },
  { key: "grace_days", label: "Grace Period (days before pause)", type: "int" },
  { key: "max_centers_per_user", label: "Max Centers per User (0 = unlimited)", type: "int" },
  { key: "max_members_per_center", label: "Max Members per Center (0 = unlimited)", type: "int" },
  { key: "invitation_limit", label: "Pending Invitation Limit per Center", type: "int" },
  { key: "reminder_days", label: "Renewal Reminder Schedule (days, comma-separated)", type: "list" },
  { key: "creator_first_seat_included", label: "Creator's First Seat Included", type: "bool" },
  { key: "owner_exempt", label: "Owner Seat Exempt from Renewals", type: "bool" },
  { key: "auto_renewals_enabled", label: "Automatic Renewals Enabled", type: "bool" },
  { key: "emergency_renewal_pause", label: "EMERGENCY Renewal Pause", type: "bool", danger: true },
  { key: "center_creation_enabled", label: "Center Creation Enabled", type: "bool" },
  { key: "member_activation_enabled", label: "Member Activation Enabled", type: "bool" },
];

function SettingsTab({ canManage }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiClient.get("/admin/responsibility-center/settings");
    setData(r.data);
    setDraft({ ...r.data.settings, reminder_days: (r.data.settings.reminder_days || []).join(", ") });
  }, []);
  useEffect(() => { load().catch(() => toast.error("Could not load settings")); }, [load]);

  const save = async () => {
    const updates = {};
    for (const f of SETTING_FIELDS) {
      let v = draft[f.key];
      if (f.type === "int") v = parseInt(v, 10);
      if (f.type === "list") v = String(v).split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
      updates[f.key] = v;
    }
    setBusy(true);
    try {
      const r = await apiClient.patch("/admin/responsibility-center/settings", { updates, reason });
      toast.success(r.data.changed.length ? `Settings updated (v${r.data.version})` : "No changes detected");
      setReason("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Settings update failed");
    } finally { setBusy(false); }
  };

  if (!data) return <div className="or-surface p-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  return (
    <div className="grid lg:grid-cols-2 gap-4" data-testid="rc-admin-settings-tab">
      <div className="or-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Global Settings</h3>
          <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="rc-admin-settings-version">Version {data.version}</span>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          Changes apply prospectively only — historical transactions and active periods are never rewritten.
        </p>
        <div className="space-y-3">
          {SETTING_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3">
              <label className="text-xs flex-1" style={{ color: f.danger ? "#FF6B6B" : "var(--text-muted)" }}>{f.label}</label>
              {f.type === "bool" ? (
                <button className="or-chip" data-active={!!draft[f.key]} disabled={!canManage}
                  onClick={() => setDraft((d) => ({ ...d, [f.key]: !d[f.key] }))}
                  data-testid={`rc-setting-${f.key}`}>
                  {draft[f.key] ? "ON" : "OFF"}
                </button>
              ) : (
                <input className="or-input text-sm py-1" style={{ width: 140 }} disabled={!canManage}
                  value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  data-testid={`rc-setting-${f.key}`} />
              )}
            </div>
          ))}
        </div>
        {canManage ? (
          <div className="mt-4">
            <input className="or-input w-full mb-2" placeholder="Written reason for this change (required)"
              value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rc-settings-reason" />
            <button className="or-btn" disabled={busy || reason.trim().length < 5} onClick={save} data-testid="rc-settings-save">
              {busy ? "Saving…" : "Save Settings"}
            </button>
          </div>
        ) : (
          <div className="text-xs mt-4" style={{ color: "var(--text-muted)" }}>You have view-only access to these settings.</div>
        )}
      </div>
      <div className="or-surface p-5" data-testid="rc-admin-settings-history">
        <h3 className="text-sm font-semibold mb-3">Change History</h3>
        {(data.history || []).length === 0 ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>No settings changes recorded yet.</div>
        ) : data.history.map((h) => (
          <div key={h.id} className="text-xs py-2" style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
            <div><b>v{h.version}</b> · @{h.admin_username} · {fmtDate(h.created_at)} — {h.reason}</div>
            <div style={{ color: "var(--text-muted)" }}>
              {(h.changes || []).map((c) => `${c.key}: ${JSON.stringify(c.previous)} → ${JSON.stringify(c.new)}`).join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
