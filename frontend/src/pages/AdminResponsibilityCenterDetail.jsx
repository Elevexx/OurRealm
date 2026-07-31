import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ExternalLink, Snowflake, Lock, Unlock, PauseCircle, PlayCircle, Archive, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { rcTypeMeta, ROLE_COLORS } from "@/lib/rcTypes";

const fmt = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
};

const TABS = ["Overview", "Members", "Vault", "Transactions", "Renewals", "Activity", "Admin Notes", "Audit History", "Settings"];

// Responsibility Center — Admin Center Detail (Bundle A).
// Every mutating action requires a written reason; the backend records
// an immutable audit row with before/after state.
export default function AdminResponsibilityCenterDetail() {
  const { centerId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState("Overview");
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState(null); // {title, onConfirm, extraInput?}

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/admin/responsibility-center/centers/${centerId}`);
      setDetail(r.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not load Center");
    }
  }, [centerId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="max-w-3xl mx-auto or-surface p-8 text-center text-sm" style={{ color: "#FF6B6B" }} data-testid="rc-admin-detail-error">{err}</div>;
  if (!detail) return <div className="max-w-3xl mx-auto or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>;

  const { center, owner, renewal_summary: rs } = detail;
  const meta = rcTypeMeta(center.center_type);

  const doAction = (action, title) => setModal({
    title,
    onConfirm: async (reason) => {
      await apiClient.post(`/admin/responsibility-center/centers/${centerId}/action`, { action, reason });
      toast.success(`${title} complete`);
      load();
    },
  });

  return (
    <div className="max-w-5xl mx-auto" data-testid="rc-admin-detail-page">
      <button className="or-btn or-btn-ghost mb-4" onClick={() => navigate("/admin/responsibility-center")} data-testid="rc-admin-detail-back">
        <ChevronLeft size={14} /> All Centers
      </button>

      <div className="or-surface p-5 mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-full flex items-center justify-center shrink-0"
            style={{ width: 48, height: 48, background: `${meta.color}22`, color: meta.color }}>
            <meta.Icon size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl truncate" style={{ fontFamily: "var(--font-display)" }} data-testid="rc-admin-detail-name">{center.name}</h1>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {meta.label} · Owner @{owner?.username} · <span className="font-mono">{center.id}</span> · Created {fmt(center.created_at)}
            </div>
            <div className="flex gap-2 mt-1 text-[11px] uppercase font-semibold">
              <span style={{ color: center.status === "active" ? "#7BD88F" : "#F4C84A" }} data-testid="rc-admin-detail-status">{center.status}</span>
              {center.vault_frozen && <span style={{ color: "#5AB2FF" }}>Vault Frozen</span>}
              {center.invitations_locked && <span style={{ color: "#F4C84A" }}>Invites Locked</span>}
              {center.needs_review && <span style={{ color: "#FF6B6B" }}>Needs Review</span>}
            </div>
          </div>
          <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${center.id}`)} data-testid="rc-admin-open-center">
            <ExternalLink size={12} /> Open Center
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {center.status === "active"
            ? <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("pause", "Pause Center")} data-testid="rc-admin-act-pause"><PauseCircle size={12} /> Pause</button>
            : <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("restore", "Restore Center")} data-testid="rc-admin-act-restore"><PlayCircle size={12} /> Restore</button>}
          {center.status !== "archived" &&
            <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("archive", "Archive Center")} data-testid="rc-admin-act-archive"><Archive size={12} /> Archive</button>}
          {center.invitations_locked
            ? <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("unlock_invitations", "Unlock Invitations")} data-testid="rc-admin-act-unlock"><Unlock size={12} /> Unlock Invites</button>
            : <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("lock_invitations", "Lock Invitations")} data-testid="rc-admin-act-lock"><Lock size={12} /> Lock Invites</button>}
          {center.vault_frozen
            ? <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("unfreeze_vault", "Unfreeze Vault")} data-testid="rc-admin-act-unfreeze"><Snowflake size={12} /> Unfreeze Vault</button>
            : <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("freeze_vault", "Freeze Vault")} data-testid="rc-admin-act-freeze"><Snowflake size={12} /> Freeze Vault</button>}
          {center.needs_review
            ? <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("clear_needs_review", "Clear Review Flag")} data-testid="rc-admin-act-clear-review"><AlertTriangle size={12} /> Clear Review</button>
            : <button className="or-btn or-btn-ghost text-xs" onClick={() => doAction("mark_needs_review", "Mark Needs Review")} data-testid="rc-admin-act-review"><AlertTriangle size={12} /> Needs Review</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[["Members", center.member_count], ["Paused", detail.counts.paused],
          ["Vault", `${center.vault_balance.toLocaleString()} 🔥`],
          ["Vault Coverage", `${rs.vault_coverage_seats} seats`]].map(([l, v]) => (
          <div key={l} className="or-surface p-3" data-testid={`rc-admin-detail-stat-${l.toLowerCase().replace(" ", "-")}`}>
            <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{l}</div>
            <div className="text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button key={t} className="or-chip shrink-0" data-active={tab === t} onClick={() => setTab(t)}
            data-testid={`rc-admin-detail-tab-${t.toLowerCase().replace(" ", "-")}`}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && <OverviewPane detail={detail} />}
      {tab === "Members" && <MembersPane centerId={centerId} reload={load} setModal={setModal} />}
      {tab === "Vault" && <VaultPane detail={detail} centerId={centerId} reload={load} />}
      {tab === "Transactions" && <ListPane url={`/admin/responsibility-center/centers/${centerId}/transactions`} field="transactions" render={TxnRow} testid="rc-admin-detail-txns" />}
      {tab === "Renewals" && <ListPane url={`/admin/responsibility-center/centers/${centerId}/renewals`} field="renewal_attempts" render={RenewalRow} testid="rc-admin-detail-renewals" />}
      {tab === "Activity" && <ListPane url={`/admin/responsibility-center/centers/${centerId}/activity`} field="activity" render={ActivityRow} testid="rc-admin-detail-activity" />}
      {tab === "Admin Notes" && <NotesPane centerId={centerId} />}
      {tab === "Audit History" && <ListPane url={`/admin/responsibility-center/centers/${centerId}/audit`} field="audit" render={AuditRow} testid="rc-admin-detail-audit" />}
      {tab === "Settings" && <SettingsPane center={center} owner={owner} />}

      {modal && <ReasonModal modal={modal} close={() => setModal(null)} />}
    </div>
  );
}

// Confirmation modal — every high-risk action needs a written reason.
function ReasonModal({ modal, close }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await modal.onConfirm(reason);
      close();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed");
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={close} data-testid="rc-admin-reason-modal">
      <div className="or-surface p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>{modal.title}</h3>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          This action is recorded in the immutable audit log with your identity, timestamp, and before/after state.
        </p>
        <textarea className="or-input w-full mb-3" rows={2} placeholder="Written reason (required, min 5 characters)"
          value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rc-admin-reason-input" autoFocus />
        <div className="flex justify-end gap-2">
          <button className="or-btn or-btn-ghost" onClick={close} disabled={busy}>Cancel</button>
          <button className="or-btn" disabled={busy || reason.trim().length < 5} onClick={confirm} data-testid="rc-admin-reason-confirm">
            {busy ? "Working…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OverviewPane({ detail }) {
  const rs = detail.renewal_summary;
  const rows = [
    ["Renewing in 7 days", rs.renewing_in_7_days], ["Renewing in 3 days", rs.renewing_in_3_days],
    ["Renewing in 1 day", rs.renewing_in_1_day], ["Awaiting Fire Power", rs.awaiting_fire_power],
    ["Paused members", rs.paused_members], ["Fire Power needed (7d)", `${rs.fire_power_needed_7d} 🔥`],
    ["Shortfall (7d)", `${rs.fire_power_shortfall_7d} 🔥`], ["Reactivation cost (all paused)", `${rs.paused_reactivation_cost} 🔥`],
  ];
  return (
    <div className="or-surface p-4" data-testid="rc-admin-detail-overview">
      <h3 className="text-sm font-semibold mb-3">Renewal & Vault Coverage</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {rows.map(([l, v]) => (
          <div key={l} className="p-2 rounded" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))" }}>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{l}</div>
            <div className="text-sm font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {detail.center.description && <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>{detail.center.description}</p>}
    </div>
  );
}

const STATE_COLORS = { active: "#7BD88F", renewal_soon: "#F4C84A", awaiting_fire_power: "#FF8A5A", paused: "#FF6B6B", invited: "#9AA7BD" };

function MembersPane({ centerId, reload, setModal }) {
  const [members, setMembers] = useState(null);
  const load = useCallback(() =>
    apiClient.get(`/admin/responsibility-center/centers/${centerId}/members`).then((r) => setMembers(r.data.members)), [centerId]);
  useEffect(() => { load(); }, [load]);
  const retry = (m) => setModal({
    title: m.status === "paused" ? `Reactivate @${m.username}` : `Retry renewal for @${m.username}`,
    onConfirm: async (reason) => {
      await apiClient.post(`/admin/responsibility-center/centers/${centerId}/members/${m.user_id}/retry-renewal`, { reason });
      toast.success("Renewal action complete");
      load(); reload();
    },
  });
  if (!members) return <div className="or-surface p-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  return (
    <div className="or-surface p-4" data-testid="rc-admin-detail-members">
      {members.map((m) => (
        <div key={m.user_id} className="flex flex-wrap items-center gap-3 py-2"
          style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}
          data-testid={`rc-admin-member-${m.username}`}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">@{m.username} <span className="uppercase text-[10px] ml-1" style={{ color: ROLE_COLORS[m.role] }}>{m.role}</span></div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              Seat until {fmt(m.seat_paid_until)}{m.paused_at ? ` · Paused ${fmt(m.paused_at)} (${m.paused_reason})` : ""}
            </div>
          </div>
          <span className="text-[11px] uppercase font-semibold" style={{ color: STATE_COLORS[m.state] || "var(--text-muted)" }}>
            {(m.state || m.status).replace(/_/g, " ")}
          </span>
          {(m.status === "paused" || m.status === "active") && m.role !== "owner" && (
            <button className="or-btn or-btn-ghost text-xs" onClick={() => retry(m)} data-testid={`rc-admin-retry-${m.username}`}>
              <RotateCcw size={11} /> {m.status === "paused" ? "Reactivate" : "Retry Renewal"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function VaultPane({ detail, centerId, reload }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const adjust = async (sign) => {
    const amt = parseInt(amount, 10) * sign;
    if (!amt) { toast.error("Enter a valid amount"); return; }
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/responsibility-center/centers/${centerId}/vault/adjust`, {
        amount: amt, reason, idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      toast.success(`Vault adjusted: ${r.data.before.toLocaleString()} → ${r.data.after.toLocaleString()} 🔥`);
      setAmount(""); setReason("");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Adjustment failed");
    } finally { setBusy(false); }
  };
  return (
    <div className="or-surface p-5" data-testid="rc-admin-detail-vault">
      <div className="text-lg mb-1" style={{ fontFamily: "var(--font-display)" }}>
        Center Vault: <b style={{ color: "#F4C84A" }} data-testid="rc-admin-vault-balance">{detail.center.vault_balance.toLocaleString()} 🔥</b>
        {detail.center.vault_frozen && <span className="text-xs ml-2" style={{ color: "#5AB2FF" }}>FROZEN</span>}
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Documented adjustments only — every change records admin identity, reason, and before/after balances. Never silent.
      </p>
      <div className="flex flex-wrap gap-2">
        <input className="or-input" type="number" min="1" placeholder="Amount" style={{ width: 120 }}
          value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="rc-admin-adjust-amount" />
        <input className="or-input flex-1 min-w-[200px]" placeholder="Written reason (required)"
          value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rc-admin-adjust-reason" />
        <button className="or-btn" disabled={busy || !amount || reason.trim().length < 5} onClick={() => adjust(1)} data-testid="rc-admin-adjust-add">Add 🔥</button>
        <button className="or-btn or-btn-ghost" disabled={busy || !amount || reason.trim().length < 5} onClick={() => adjust(-1)} data-testid="rc-admin-adjust-remove">Remove 🔥</button>
      </div>
    </div>
  );
}

const TxnRow = (t) => (
  <div key={t.id} className="flex flex-wrap justify-between gap-2 text-sm py-1.5" style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
    <div className="min-w-0">
      <div>{t.transaction_type.replace(/_/g, " ")} {t.reversed_by && <span className="text-[10px]" style={{ color: "#FF6B6B" }}>REVERSED</span>}</div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{t.username ? `@${t.username} · ` : ""}{fmt(t.created_at)} · {t.status}{t.idempotency_key ? ` · ${t.idempotency_key.slice(0, 28)}…` : ""}</div>
    </div>
    <b style={{ color: t.amount >= 0 ? "#7BD88F" : "#FF8A5A" }}>{t.amount >= 0 ? "+" : ""}{(t.amount || 0).toLocaleString()} 🔥</b>
  </div>
);

const RESULT_COLORS = { success: "#7BD88F", reactivated: "#7BD88F", insufficient: "#FF8A5A", paused: "#FF6B6B", vault_frozen: "#5AB2FF" };
const RenewalRow = (r) => (
  <div key={r.id} className="flex flex-wrap justify-between gap-2 text-sm py-1.5" style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
    <div className="min-w-0">
      <div>@{r.username || r.membership_user_id?.slice(0, 8)} · <b style={{ color: RESULT_COLORS[r.result] }}>{r.result.replace(/_/g, " ")}</b></div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{fmt(r.created_at)} · {r.source}{r.detail ? ` · ${r.detail}` : ""}</div>
    </div>
    <span className="text-xs" style={{ color: "var(--text-muted)" }}>{r.result === "success" ? `-${r.amount} 🔥` : r.fire_power_needed ? `needs ${r.fire_power_needed} 🔥` : ""}</span>
  </div>
);

const ActivityRow = (a) => (
  <div key={a.id} className="flex justify-between gap-3 text-sm py-1.5" style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
    <span>{a.detail}</span>
    <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{fmt(a.created_at)}</span>
  </div>
);

const AuditRow = (a) => (
  <div key={a.id} className="text-sm py-2" style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
    <div><b>@{a.admin_username}</b> · {a.action.replace(/_/g, " ")} · <span className="text-xs" style={{ color: "var(--text-muted)" }}>{fmt(a.created_at)}</span></div>
    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
      {a.reason}{a.before ? ` · before: ${JSON.stringify(a.before)}` : ""}{a.after ? ` · after: ${JSON.stringify(a.after)}` : ""}
    </div>
  </div>
);

function ListPane({ url, field, render, testid }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    apiClient.get(url).then((r) => setRows(r.data[field])).catch(() => setRows([]));
  }, [url, field]);
  if (!rows) return <div className="or-surface p-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  return (
    <div className="or-surface p-4" data-testid={testid}>
      {rows.length === 0
        ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>Nothing recorded yet.</div>
        : rows.map(render)}
    </div>
  );
}

function NotesPane({ centerId }) {
  const [notes, setNotes] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() =>
    apiClient.get(`/admin/responsibility-center/centers/${centerId}/notes`).then((r) => setNotes(r.data.notes)), [centerId]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/admin/responsibility-center/centers/${centerId}/notes`, { note });
      setNote("");
      load();
      toast.success("Note added");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add note");
    } finally { setBusy(false); }
  };
  return (
    <div className="or-surface p-4" data-testid="rc-admin-detail-notes">
      <div className="flex gap-2 mb-3">
        <input className="or-input flex-1" placeholder="Internal admin note" value={note}
          onChange={(e) => setNote(e.target.value)} data-testid="rc-admin-note-input" />
        <button className="or-btn" disabled={busy || !note.trim()} onClick={add} data-testid="rc-admin-note-add">Add Note</button>
      </div>
      {notes === null ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>
        : notes.length === 0 ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>No admin notes yet.</div>
        : notes.map((n) => (
          <div key={n.id} className="text-sm py-2" style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}>
            <div>{n.note}</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>@{n.admin_username} · {fmt(n.created_at)}</div>
          </div>
        ))}
    </div>
  );
}

function SettingsPane({ center, owner }) {
  return (
    <div className="or-surface p-5 text-sm space-y-2" data-testid="rc-admin-detail-settings">
      <h3 className="text-sm font-semibold mb-2">Immutable Record</h3>
      {[["Center ID", center.id], ["Owner", `@${owner?.username} (${owner?.id})`],
        ["Created", fmt(center.created_at)], ["Status", center.status],
        ["Vault Frozen", String(!!center.vault_frozen)], ["Invitations Locked", String(!!center.invitations_locked)],
        ["Official", String(!!center.official)], ["Needs Review", String(!!center.needs_review)]].map(([l, v]) => (
        <div key={l} className="flex justify-between gap-3">
          <span style={{ color: "var(--text-muted)" }}>{l}</span>
          <span className="font-mono text-xs">{v}</span>
        </div>
      ))}
      <p className="text-xs pt-2" style={{ color: "var(--text-muted)" }}>
        Ownership transfer and Center closure ship in a later bundle with full safeguards.
      </p>
    </div>
  );
}
