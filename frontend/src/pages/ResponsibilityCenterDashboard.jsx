import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Users, Vault, Activity, Settings as SettingsIcon, UserPlus, Flame, LogOut, Clock, ClipboardList, FolderTree, CalendarDays, BarChart3, Flag } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { rcTypeMeta, ROLE_COLORS } from "@/lib/rcTypes";
import { RcImg } from "@/lib/rcAssets";
import { RcWorkTab } from "@/components/rc/RcWorkTab";
import { RcLifecyclePanel } from "@/components/rc/RcLifecyclePanel";
import { RcUnitsTab } from "@/components/rc/RcUnitsTab";
import { RcCalendarTab } from "@/components/rc/RcCalendarTab";
import { RcReportsTab } from "@/components/rc/RcReportsTab";
import { RcBirthdayPanel } from "@/components/rc/RcBirthdayPanel";
import { RcWidgetBoard } from "@/components/rc/RcWidgetBoard";
import { RcSearchPanel } from "@/components/rc/RcSearchPanel";
import ReportModal from "@/components/ReportModal";

const uuid = () =>
  (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const fmtDate = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
};

const TABS = [
  { id: "overview", label: "Overview", Icon: Activity },
  { id: "work",     label: "Work",     Icon: ClipboardList },
  { id: "units",    label: "Groups",   Icon: FolderTree },
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "reports",  label: "Reports",  Icon: BarChart3 },
  { id: "members",  label: "Members",  Icon: Users },
  { id: "vault",    label: "Vault",    Icon: Vault },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
];

// Responsibility Center — member dashboard.
export default function ResponsibilityCenterDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") && TABS.some((t) => t.id === searchParams.get("tab"))
    ? searchParams.get("tab") : "overview");
  const [deepItem, setDeepItem] = useState(searchParams.get("item") || null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    const t = searchParams.get("tab");
    const it = searchParams.get("item");
    if (t && TABS.some((x) => x.id === t)) setTab(t);
    if (it) setDeepItem(it);
  }, [searchParams]);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${id}`);
      setData(r.data);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not load this Center");
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="rc-dash-error">
        <div className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>{error}</div>
        <button className="or-btn" onClick={() => navigate("/responsibility-center")}>Back to Responsibility Center</button>
      </div>
    );
  }
  if (!data) {
    return <div className="max-w-3xl mx-auto or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="rc-dash-loading">Loading Center…</div>;
  }

  const { center, my_membership: me, config } = data;
  const meta = rcTypeMeta(center.center_type);
  const perms = new Set(me.permissions || []);
  const canViewVault = perms.has("view_vault");

  // Paused membership — safe status information ONLY. No members,
  // activity, vault history, or private Center content.
  if (data.paused_notice) {
    return (
      <div className="max-w-2xl mx-auto" data-testid="rc-dash-paused">
        <button className="or-btn or-btn-ghost mb-4" onClick={() => navigate("/responsibility-center")} data-testid="rc-dash-back">
          <ChevronLeft size={14} /> All Centers
        </button>
        <div className="or-surface p-6">
          <RcImg assetKey="responsibility_center.landing.paused_member" className="w-full rounded-lg mb-4"
            style={{ maxHeight: 180, objectFit: "cover" }} fallback={null} />
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-full flex items-center justify-center shrink-0"
              style={{ width: 44, height: 44, background: "rgba(244,200,74,0.15)", color: "#F4C84A" }}>
              <Clock size={22} />
            </div>
            <div>
              <h1 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>{center.name}</h1>
              <div className="text-xs uppercase font-semibold" style={{ color: "#F4C84A" }} data-testid="rc-paused-badge">Membership Paused</div>
            </div>
          </div>
          <p className="text-sm mb-3" data-testid="rc-paused-message">{data.paused_notice.message}</p>
          <div className="p-3 rounded text-xs space-y-1 mb-4" style={{ background: "rgba(244,200,74,0.08)", border: "1px solid rgba(244,200,74,0.3)" }}>
            <div>Fire Power Requirement to reactivate: <b>{data.paused_notice.fire_power_needed} 🔥</b></div>
            <div>Current Center Vault: <b>{data.paused_notice.vault_balance.toLocaleString()} 🔥</b></div>
            {data.paused_notice.paused_at && <div>Paused since: {fmtDate(data.paused_notice.paused_at)}</div>}
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="rc-paused-help">{data.paused_notice.help}</p>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            Your history, assignments, and records in this Center are fully preserved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto" data-testid="rc-dash-page">
      <button className="or-btn or-btn-ghost mb-4" onClick={() => navigate("/responsibility-center")} data-testid="rc-dash-back">
        <ChevronLeft size={14} /> All Centers
      </button>

      <div className="or-surface p-5 mb-4">
        <div className="flex items-center gap-4">
          <div className="rounded-full flex items-center justify-center shrink-0 overflow-hidden"
            style={{ width: 52, height: 52, background: `${meta.color}22`, color: meta.color }}>
            {center.branding?.icon_url || center.branding?.logo_url ? (
              <img src={center.branding.icon_url || center.branding.logo_url} alt=""
                style={{ width: 52, height: 52, objectFit: "cover" }} data-testid="rc-dash-center-logo" />
            ) : (
              <RcImg assetKey="responsibility_center.default_center_icon" width={30} height={30}
                fallback={<meta.Icon size={26} />} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl truncate" style={{ fontFamily: "var(--font-display)" }} data-testid="rc-dash-name">{center.name}</h1>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {meta.label} · Created {fmtDate(center.created_at)} · You are{" "}
              <b className="uppercase tracking-wide" style={{ color: ROLE_COLORS[me.role] }} data-testid="rc-dash-my-role">{me.role}</b>
            </div>
          </div>
          {me.role !== "owner" && (
            <button className="or-btn or-btn-ghost p-1.5 shrink-0" title="Report this Center"
              onClick={() => setReportOpen(true)} aria-label="Report this Center" data-testid="rc-dash-report-center">
              <Flag size={14} />
            </button>
          )}
        </div>
        <ReportModal open={reportOpen} targetType="rc_center" targetId={id}
          onClose={() => setReportOpen(false)} testid="rc-center-report-modal" />
        {center.description && (
          <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>{center.description}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Members" value={center.member_count} testid="rc-stat-members" />
        <StatCard label="Center Vault" value={`${center.vault_balance.toLocaleString()} 🔥`} testid="rc-stat-vault" />
        <StatCard label="My seat until" value={fmtDate(me.seat_paid_until)} testid="rc-stat-seat" />
      </div>

      <div className="mb-4">
        <RcSearchPanel centerId={id} />
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        {TABS.filter(({ id: tid }) => tid !== "reports" || perms.has("view_reports")).map(({ id: tid, label, Icon }) => (
          <button key={tid} className="or-chip shrink-0" data-active={tab === tid} onClick={() => setTab(tid)} data-testid={`rc-dash-tab-${tid}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab data={data} reload={load} centerId={id} goVault={() => setTab("vault")} />}
      {tab === "work" && (
        <RcWorkTab centerId={id} data={data} initialItemId={deepItem}
          onItemOpenChange={(iid) => {
            setDeepItem(iid);
            setSearchParams(iid ? { tab: "work", item: iid } : { tab: "work" }, { replace: true });
          }} />
      )}
      {tab === "units" && <RcUnitsTab centerId={id} data={data} />}
      {tab === "calendar" && (
        <RcCalendarTab centerId={id} data={data}
          initialEventId={searchParams.get("event") || null}
          onOpenItem={(iid) => setSearchParams({ tab: "work", item: iid })}
          onEventOpenChange={(eid) => setSearchParams(eid ? { tab: "calendar", event: eid } : { tab: "calendar" }, { replace: true })} />
      )}
      {tab === "reports" && <RcReportsTab centerId={id} data={data} />}
      {tab === "members" && <MembersTab data={data} me={me} perms={perms} reload={load} centerId={id} config={config} />}
      {tab === "vault" && <VaultTab data={data} canViewVault={canViewVault} reload={load} centerId={id} config={config} />}
      {tab === "settings" && (<>
        <SettingsTab data={data} me={me} perms={perms} reload={load} centerId={id} navigate={navigate} userId={user?.id} />
        <RcBirthdayPanel centerId={id} />
      </>)}
    </div>
  );
}

const StatCard = ({ label, value, testid }) => (
  <div className="or-surface p-4" data-testid={testid}>
    <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</div>
    <div className="text-lg font-semibold mt-1">{value}</div>
  </div>
);

function OverviewTab({ data, reload, centerId, goVault }) {
  const activity = data.activity || [];
  const rs = data.renewal_summary;
  const [busy, setBusy] = useState(false);
  const reactivateAll = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/reactivate-eligible`);
      toast.success(`${r.data.reactivated} member(s) reactivated${r.data.remaining_paused ? ` — ${r.data.remaining_paused} still paused (Vault needs more Fire Power)` : ""}`);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reactivation failed");
    } finally { setBusy(false); }
  };
  const needsAttention = rs && (rs.paused_members > 0 || rs.awaiting_fire_power > 0 || rs.fire_power_shortfall_7d > 0);
  return (
    <div className="space-y-4" data-testid="rc-tab-overview">
      <RcWidgetBoard centerId={centerId} />
      {rs && (
        <div className="or-surface p-4" data-testid="rc-renewal-panel"
          style={needsAttention ? { borderColor: "rgba(244,200,74,0.45)" } : undefined}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold">Seat Renewals & Vault Coverage</h3>
            {needsAttention && (
              <span className="text-[11px] uppercase font-semibold" style={{ color: "#F4C84A" }} data-testid="rc-renewal-warning">Needs attention</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mb-3">
            {[["Renewing in 7 days", rs.renewing_in_7_days], ["Renewing in 3 days", rs.renewing_in_3_days],
              ["Renewing tomorrow", rs.renewing_in_1_day],
              ["Awaiting Fire Power", rs.awaiting_fire_power, rs.awaiting_fire_power ? "#FF8A5A" : undefined],
              ["Paused members", rs.paused_members, rs.paused_members ? "#FF6B6B" : undefined],
              ["Vault Fire Power", `${rs.vault_balance.toLocaleString()} 🔥`, "#F4C84A"],
              ["Needed next 7 days", `${rs.fire_power_needed_7d} 🔥`],
              ["Vault coverage", `${rs.vault_coverage_seats} seat${rs.vault_coverage_seats === 1 ? "" : "s"}`]].map(([l, v, col]) => (
              <div key={l} className="p-2 rounded" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))" }}>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{l}</div>
                <div className="font-semibold" style={col ? { color: col } : undefined}>{v}</div>
              </div>
            ))}
          </div>
          {rs.fire_power_shortfall_7d > 0 && (
            <div className="text-xs mb-2" style={{ color: "#FF8A5A" }} data-testid="rc-renewal-shortfall">
              The Vault needs {rs.fire_power_shortfall_7d.toLocaleString()} more Fire Power to cover the next 7 days of renewals.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="or-btn text-xs" onClick={goVault} data-testid="rc-renewal-add-fp">Add Fire Power</button>
            {rs.paused_members > 0 && (
              <button className="or-btn or-btn-ghost text-xs" disabled={busy} onClick={reactivateAll} data-testid="rc-reactivate-eligible-btn">
                {busy ? "Reactivating…" : `Reactivate Eligible Members (${rs.seat_cost} 🔥 each)`}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="or-surface p-5">
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>
          <Clock size={16} className="inline mr-1" /> Recent Activity
        </h3>
        {activity.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>No activity yet.</div>
        ) : (
          <div className="space-y-2">
            {activity.map((a) => (
              <div key={a.id} className="text-sm flex justify-between gap-3 py-1.5"
                style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
                <span>{a.detail}</span>
                <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{fmtDate(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MembersTab({ data, me, perms, reload, centerId, config }) {
  const [inviteName, setInviteName] = useState("");
  const [busy, setBusy] = useState(false);
  const members = data.members || [];
  const canInvite = perms.has("invite_members");
  const canManage = perms.has("manage_roles");
  const canRemove = perms.has("remove_members");

  const invite = async () => {
    if (!inviteName.trim()) return;
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/invite`, { username: inviteName.trim() });
      toast.success(`Invite sent to @${r.data.invited_username}`);
      setInviteName("");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invite failed");
    } finally { setBusy(false); }
  };

  const setRole = async (uid, role) => {
    try {
      await apiClient.post(`/responsibility-center/${centerId}/members/${uid}/role`, { role });
      toast.success(`Role updated to ${role}`);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Role change failed"); }
  };

  const remove = async (uid, username) => {
    if (!window.confirm(`Remove @${username} from this Center?`)) return;
    try {
      await apiClient.post(`/responsibility-center/${centerId}/members/${uid}/remove`);
      toast.success(`@${username} removed`);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Remove failed"); }
  };

  const reactivate = async (uid, username) => {
    try {
      await apiClient.post(`/responsibility-center/${centerId}/members/${uid}/reactivate`);
      toast.success(`@${username}'s seat reactivated — new ${config?.seat_days ?? 30}-day active period started`);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Reactivation failed"); }
  };
  const canReactivate = perms.has("manage_renewals");

  const STATE_LABELS = {
    active: ["ACTIVE", "#7BD88F"], renewal_soon: ["RENEWAL SOON", "#F4C84A"],
    awaiting_fire_power: ["AWAITING 🔥", "#FF8A5A"], paused: ["PAUSED", "#FF6B6B"],
    invited: ["INVITED", "#9AA7BD"],
  };

  return (
    <div className="space-y-4" data-testid="rc-tab-members">
      {canInvite && (
        <div className="or-surface p-4" data-testid="rc-invite-panel">
          <div className="text-sm font-semibold mb-2"><UserPlus size={14} className="inline mr-1" /> Invite a member</div>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            When they accept, their {config?.seat_days ?? 30}-day seat ({config?.seat_cost ?? 100} 🔥) is drawn from the Center Vault.
          </div>
          <div className="flex gap-2">
            <input className="or-input flex-1" placeholder="username" value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && invite()}
              data-testid="rc-invite-input" />
            <button className="or-btn" disabled={busy || !inviteName.trim()} onClick={invite} data-testid="rc-invite-send-btn">Invite</button>
          </div>
        </div>
      )}
      <div className="or-surface p-4">
        <div className="text-sm font-semibold mb-3">Members ({members.filter((m) => m.status === "active").length})</div>
        <div className="space-y-2">
          {members.map((m) => {
            const isSelf = m.user_id === me.user_id;
            const manageable = !isSelf && m.role !== "owner" && m.status === "active";
            return (
              <div key={m.user_id} className="flex flex-wrap items-center gap-3 py-2"
                style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}
                data-testid={`rc-member-row-${m.username}`}>
                <img src={m.avatar_url || `https://api.dicebear.com/9.x/initials/svg?seed=${m.username}`}
                  alt="" className="rounded-full" style={{ width: 32, height: 32, objectFit: "cover" }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">
                    {m.name || `@${m.username}`}{isSelf && <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>(you)</span>}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    @{m.username}
                    {m.status === "invited"
                      ? " · Invite pending"
                      : m.status === "paused"
                        ? " · Seat paused — records preserved"
                        : m.seat_paid_until ? ` · Seat until ${fmtDate(m.seat_paid_until)}` : ""}
                  </div>
                </div>
                {(() => {
                  const [label, color] = STATE_LABELS[m.state || m.status] || [m.role.toUpperCase(), ROLE_COLORS[m.role]];
                  return (
                    <span className="text-xs uppercase tracking-wide font-semibold" style={{ color }}
                      data-testid={`rc-member-state-${m.username}`}>
                      {m.status === "active" && m.state === "active" ? m.role : label}
                    </span>
                  );
                })()}
                {canReactivate && m.status === "paused" && (
                  <button className="or-btn text-xs" onClick={() => reactivate(m.user_id, m.username)}
                    data-testid={`rc-member-reactivate-${m.username}`}>
                    Reactivate ({config?.seat_cost ?? 100} 🔥)
                  </button>
                )}
                {canManage && manageable && (
                  <select className="or-input text-xs py-1" value={m.role}
                    onChange={(e) => setRole(m.user_id, e.target.value)}
                    data-testid={`rc-member-role-select-${m.username}`}>
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="member">Member</option>
                  </select>
                )}
                {canRemove && !isSelf && m.role !== "owner" && (
                  <button className="or-btn or-btn-ghost text-xs" onClick={() => remove(m.user_id, m.username)}
                    data-testid={`rc-member-remove-${m.username}`}>Remove</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VaultTab({ data, canViewVault, reload, centerId, config }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const idemKey = useMemo(() => uuid(), []);
  const [keySalt, setKeySalt] = useState(0);
  const txns = data.vault_transactions || [];

  const fund = async () => {
    const amt = parseInt(amount, 10);
    if (!amt || amt < 1) { toast.error("Enter a valid amount"); return; }
    setBusy(true);
    try {
      await apiClient.post(`/responsibility-center/${centerId}/vault/fund`, {
        amount: amt, idempotency_key: `${idemKey}:${keySalt}`,
      });
      toast.success(`${amt.toLocaleString()} 🔥 added to the Center Vault`);
      setAmount("");
      setKeySalt((s) => s + 1);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Fire Up failed");
    } finally { setBusy(false); }
  };

  const TXN_LABELS = {
    center_created: "Center created (burn)",
    vault_fund: "Vault fired up",
    seat_charge: "Member seat (30 days)",
    seat_renewal: "Seat renewal",
  };

  return (
    <div className="space-y-4" data-testid="rc-tab-vault">
      <div className="or-surface p-5" data-testid="rc-vault-fund-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
              <Vault size={16} className="inline mr-1" /> Center Vault:{" "}
              <b style={{ color: "#F4C84A" }} data-testid="rc-vault-balance">{data.center.vault_balance.toLocaleString()} 🔥</b>
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Your Fire Vault: <b data-testid="rc-vault-my-balance">{(data.my_fire_vault_balance ?? 0).toLocaleString()} 🔥</b> ·
              Each member seat requires {config?.seat_cost ?? 100} 🔥 per {config?.seat_days ?? 30} days, drawn from this Vault. The Vault is simply the Center's long-term storage for engagement resources — Fire Power is never money and has no monetary value.
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <input className="or-input flex-1" type="number" min="1" placeholder="Amount of Fire Power"
            value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="rc-vault-fund-input" />
          <button className="or-btn" disabled={busy || !amount} onClick={fund} data-testid="rc-vault-fund-btn">
            <Flame size={14} /> Fire Up Vault
          </button>
        </div>
      </div>

      {canViewVault ? (
        <div className="or-surface p-4" data-testid="rc-vault-txns">
          <div className="text-sm font-semibold mb-3">Vault Transactions</div>
          {txns.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>No transactions yet.</div>
          ) : (
            <div className="space-y-2">
              {txns.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 text-sm py-1.5"
                  style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
                  <div className="min-w-0">
                    <div>{TXN_LABELS[t.transaction_type] || t.transaction_type}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {t.username ? `@${t.username} · ` : ""}{fmtDate(t.created_at)}
                    </div>
                  </div>
                  <b style={{ color: t.amount >= 0 ? "var(--brand-green, #7BD88F)" : "#FF8A5A" }}>
                    {t.amount >= 0 ? "+" : ""}{t.amount.toLocaleString()} 🔥
                  </b>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="rc-vault-no-perm">
          Transaction history is visible to Managers, Admins, and the Owner.
        </div>
      )}
    </div>
  );
}

function SettingsTab({ data, me, perms, reload, centerId, navigate }) {
  const [name, setName] = useState(data.center.name);
  const [description, setDescription] = useState(data.center.description || "");
  const [busy, setBusy] = useState(false);
  const canEdit = perms.has("edit_center");
  const isOwner = me.role === "owner";
  const SELF_TASK_DEFAULT_ON = ["family", "household"].includes(data.center.center_type);
  const selfTaskValue = data.center.allow_member_self_tasks === null || data.center.allow_member_self_tasks === undefined
    ? "default" : data.center.allow_member_self_tasks ? "on" : "off";
  const [tz, setTz] = useState(data.center.timezone || "UTC");

  const save = async () => {
    setBusy(true);
    try {
      await apiClient.patch(`/responsibility-center/${centerId}`, { name: name.trim(), description: description.trim() });
      toast.success("Center updated");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    } finally { setBusy(false); }
  };

  const saveSelfTasks = async (v) => {
    try {
      await apiClient.patch(`/responsibility-center/${centerId}`,
        { allow_member_self_tasks: v === "default" ? null : v === "on" });
      toast.success("Self-task setting updated");
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Update failed"); }
  };

  const saveTimezone = async () => {
    try {
      await apiClient.patch(`/responsibility-center/${centerId}`, { timezone: tz.trim() });
      toast.success("Center timezone updated");
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Invalid timezone"); }
  };

  const leave = async () => {
    if (!window.confirm("Leave this Center? Your seat will not be refunded.")) return;
    try {
      await apiClient.post(`/responsibility-center/${centerId}/leave`);
      toast.success("You left the Center");
      navigate("/responsibility-center");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not leave");
    }
  };

  return (
    <div className="space-y-4" data-testid="rc-tab-settings">
      {canEdit && (
        <div className="or-surface p-5" data-testid="rc-settings-edit-panel">
          <div className="text-sm font-semibold mb-3">Center details</div>
          <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Name</label>
          <input className="or-input w-full mt-1 mb-3" maxLength={60} value={name}
            onChange={(e) => setName(e.target.value)} data-testid="rc-settings-name-input" />
          <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Description</label>
          <textarea className="or-input w-full mt-1 mb-3" rows={3} maxLength={500} value={description}
            onChange={(e) => setDescription(e.target.value)} data-testid="rc-settings-desc-input" />
          <button className="or-btn" disabled={busy || !name.trim()} onClick={save} data-testid="rc-settings-save-btn">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
      {isOwner && (
        <div className="or-surface p-5" data-testid="rc-settings-work-panel">
          <div className="text-sm font-semibold mb-3">Work & tasks</div>
          <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Allow Members to Create Self-Tasks
          </label>
          <select className="or-input w-full mt-1 mb-1" value={selfTaskValue}
            onChange={(e) => saveSelfTasks(e.target.value)} data-testid="rc-settings-self-tasks">
            <option value="default">Template default ({SELF_TASK_DEFAULT_ON ? "Enabled" : "Disabled"})</option>
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
          <div className="text-[11px] mb-4" style={{ color: "var(--text-muted)" }}>
            When enabled, plain members can create personal tasks assigned only to themselves.
            They can never assign work to others or bypass Center permissions.
          </div>
          <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Center timezone (for recurring schedules)
          </label>
          <div className="flex gap-2 mt-1">
            <input className="or-input flex-1" list="rc-tz-options" value={tz}
              onChange={(e) => setTz(e.target.value)} data-testid="rc-settings-timezone-input" />
            <datalist id="rc-tz-options">
              {["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
                "Europe/London", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"].map((z) => <option key={z} value={z} />)}
            </datalist>
            <button type="button" className="or-btn text-xs" onClick={saveTimezone} data-testid="rc-settings-timezone-save">Save</button>
          </div>
        </div>
      )}
      <div className="or-surface p-5">
        <div className="text-sm font-semibold mb-2">My membership</div>
        <div className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
          <div>Role: <b className="uppercase" style={{ color: ROLE_COLORS[me.role] }}>{me.role}</b></div>
          <div>Seat active until: <b style={{ color: "var(--text-main)" }}>{fmtDate(me.seat_paid_until)}</b></div>
          <div>Permissions: {(me.permissions || []).join(", ") || "—"}</div>
        </div>
        {!isOwner && (
          <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
            Departure options moved to the Center Lifecycle section below.
          </div>
        )}
        {isOwner && (
          <div className="text-xs mt-4" style={{ color: "var(--text-muted)" }} data-testid="rc-settings-owner-note">
            Ownership transfer, pause, archive, export, and closure live in the Center Lifecycle section below.
          </div>
        )}
      </div>
      <RcLifecyclePanel centerId={centerId} members={data.members} reload={reload} />
    </div>
  );
}
