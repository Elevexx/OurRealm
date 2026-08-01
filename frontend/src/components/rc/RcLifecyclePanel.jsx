import React, { useCallback, useEffect, useState } from "react";
import { Crown, PauseCircle, PlayCircle, Archive, Download, ShieldAlert, LogOut, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const fmt = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};

// Bundle D — Center Lifecycle: ownership transfer, pause/archive/restore,
// export, safe closure, recovery, and member departure. Progressive
// disclosure; destructive actions are separated and require typed confirmation.
export const RcLifecyclePanel = ({ centerId, members, reload }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [lc, setLc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState(null); // transfer|archive|close|leave|recovery

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/lifecycle`);
      setLc(r.data);
    } catch { /* non-members simply don't see the panel */ }
  }, [centerId]);
  useEffect(() => { load(); }, [load]);

  if (!lc) return null;
  const isOwner = lc.my_role === "owner";
  const canRecover = ["admin", "manager"].includes(lc.my_role);
  const t = lc.pending_transfer;
  const closure = lc.closure || { status: "none" };
  const closurePending = ["requested", "review", "approved"].includes(closure.status);
  const op = lc.operational_status;
  const me = user || {};

  const api = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); setSection(null); load(); reload?.(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };

  const exportData = async () => {
    setBusy(true);
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/lifecycle/export`);
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `center-export-${centerId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Export downloaded");
    } catch (e) { toast.error(e?.response?.data?.detail || "Export failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="or-surface p-5" data-testid="rc-lifecycle-panel">
      <div className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Crown size={14} style={{ color: "#5AB2FF" }} /> Center Lifecycle
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        <div>Owner: <b style={{ color: "var(--text-main)" }} data-testid="rc-lc-owner">@{lc.owner?.username || "—"}</b></div>
        <div>Status: <b className="uppercase" style={{ color: op === "active" ? "#7BD88F" : "#F4C84A" }} data-testid="rc-lc-status">{op}</b></div>
        <div>Members: {lc.member_count}</div>
        <div>Vault: {lc.vault_balance?.toLocaleString()} Fire Power</div>
        {lc.retention_hold && <div className="col-span-2 font-semibold" style={{ color: "#FF6B6B" }}>Retention hold active</div>}
      </div>

      {/* Pending ownership transfer */}
      {t && (
        <div className="p-3 rounded mb-4" data-testid="rc-lc-transfer-pending"
          style={{ background: "rgba(90,178,255,0.08)", border: "1px solid rgba(90,178,255,0.3)" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: "#5AB2FF" }}>Ownership transfer pending</div>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            @{t.from_username} → @{t.to_username} · expires {fmt(t.expires_at)}
            {t.note ? <> · “{t.note}”</> : null}
          </div>
          {t.to_user_id === me.id && (
            <div className="flex gap-2">
              <button className="or-btn text-xs" disabled={busy} data-testid="rc-lc-transfer-accept"
                onClick={() => window.confirm("Accept ownership of this Center? You become fully responsible for it.")
                  && api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/transfer/${t.id}/respond`, { accept: true }), "You are now the owner")}>
                Accept ownership
              </button>
              <button className="or-btn or-btn-ghost text-xs" disabled={busy} data-testid="rc-lc-transfer-decline"
                onClick={() => api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/transfer/${t.id}/respond`, { accept: false }), "Transfer declined")}>
                Decline
              </button>
            </div>
          )}
          {isOwner && (
            <button className="or-btn or-btn-ghost text-xs" disabled={busy} data-testid="rc-lc-transfer-cancel"
              onClick={() => api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/transfer/${t.id}/cancel`), "Transfer canceled")}>
              <XCircle size={12} /> Cancel transfer
            </button>
          )}
        </div>
      )}

      {/* Closure state */}
      {closurePending && (
        <div className="p-3 rounded mb-4" data-testid="rc-lc-closure-pending"
          style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.35)" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: "#FF6B6B" }}>
            Closure {closure.status === "review" ? "under review" : closure.status}
          </div>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            Cancellation window ends {fmt(closure.cancellation_deadline)}. All records are preserved until then.
            {lc.retention_hold ? " A retention hold currently blocks completion." : ""}
          </div>
          {isOwner && !lc.retention_hold && (
            <button className="or-btn text-xs" disabled={busy} data-testid="rc-lc-closure-cancel"
              onClick={() => window.confirm("Cancel the closure request and keep this Center?")
                && api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/close/cancel`), "Closure canceled")}>
              Cancel closure request
            </button>
          )}
        </div>
      )}

      {/* Owner controls */}
      {isOwner && (
        <div className="flex flex-wrap gap-2 mb-2">
          {!t && !closurePending && op !== "archived" && (
            <button className="or-btn or-btn-ghost text-xs" onClick={() => setSection(section === "transfer" ? null : "transfer")}
              data-testid="rc-lc-transfer-btn"><Crown size={12} /> Transfer Ownership</button>
          )}
          {op === "active" && lc.settings.allow_owner_pause && (
            <button className="or-btn or-btn-ghost text-xs" style={{ borderColor: "rgba(244,200,74,0.4)", color: "#F4C84A" }}
              disabled={busy} data-testid="rc-lc-pause-btn"
              onClick={() => window.confirm("Pause this Center? Members lose access until you restore it. All data is preserved.")
                && api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/pause`, { reason: "" }), "Center paused")}>
              <PauseCircle size={12} /> Pause Center
            </button>
          )}
          {["paused", "archived"].includes(op) && !closurePending && (
            <button className="or-btn text-xs" disabled={busy} data-testid="rc-lc-restore-btn"
              onClick={() => api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/restore`), "Center restored")}>
              <PlayCircle size={12} /> Restore Center
            </button>
          )}
          {["active", "paused"].includes(op) && lc.settings.allow_owner_archive && !closurePending && (
            <button className="or-btn or-btn-ghost text-xs" style={{ borderColor: "rgba(244,200,74,0.4)", color: "#F4C84A" }}
              onClick={() => setSection(section === "archive" ? null : "archive")} data-testid="rc-lc-archive-btn">
              <Archive size={12} /> Archive Center
            </button>
          )}
          <button className="or-btn or-btn-ghost text-xs" disabled={busy} onClick={exportData} data-testid="rc-lc-export-btn">
            <Download size={12} /> Export Data
          </button>
          {!closurePending && lc.settings.allow_owner_closure && (
            <button className="or-btn or-btn-ghost text-xs" style={{ borderColor: "rgba(255,107,107,0.4)", color: "#FF6B6B" }}
              onClick={() => setSection(section === "close" ? null : "close")} data-testid="rc-lc-close-btn">
              Close Center…
            </button>
          )}
        </div>
      )}

      {section === "transfer" && isOwner && (
        <TransferForm centerId={centerId} members={members} lc={lc} busy={busy} api={api} />
      )}
      {section === "archive" && isOwner && (
        <ConfirmNameForm label="Archive keeps every record and can be reversed anytime. Members lose access until restored."
          color="#F4C84A" centerName={lc.center.name} cta="Archive Center" busy={busy}
          testid="rc-lc-archive"
          onSubmit={(name, reason) => api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/archive`,
            { confirm_name: name, reason }), "Center archived")} />
      )}
      {section === "close" && isOwner && (
        <CloseForm centerId={centerId} lc={lc} busy={busy} api={api} />
      )}

      {/* Recovery for admins/managers */}
      {!isOwner && canRecover && lc.settings && (
        <div className="mt-2">
          <button className="or-btn or-btn-ghost text-xs" onClick={() => setSection(section === "recovery" ? null : "recovery")}
            data-testid="rc-lc-recovery-btn"><ShieldAlert size={12} /> Request Ownership Recovery</button>
          {section === "recovery" && (
            <RecoveryForm centerId={centerId} busy={busy} api={api} pending={lc.pending_recovery} />
          )}
        </div>
      )}

      {/* Member departure */}
      {!isOwner && (
        <LeaveSection centerId={centerId} busy={busy} navigate={navigate} setBusy={setBusy} />
      )}
      {isOwner && (
        <div className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }} data-testid="rc-lc-owner-note">
          As the owner you can't leave directly — transfer ownership first, or archive / close the Center.
        </div>
      )}
    </div>
  );
};

const TransferForm = ({ centerId, members, lc, busy, api }) => {
  const [to, setTo] = useState("");
  const [role, setRole] = useState("admin");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState("");
  const eligible = (members || []).filter((m) => m.status === "active" && m.role !== "owner");
  return (
    <div className="p-3 rounded mb-3 space-y-2" data-testid="rc-lc-transfer-form"
      style={{ background: "rgba(90,178,255,0.06)", border: "1px solid rgba(90,178,255,0.25)" }}>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        The new owner must accept before anything changes. Open work: {lc.open_items} · Vault: {lc.vault_balance?.toLocaleString()} Fire Power · Members: {lc.member_count}
      </div>
      <select className="or-input w-full" value={to} onChange={(e) => setTo(e.target.value)} data-testid="rc-lc-transfer-to">
        <option value="">Choose the new owner…</option>
        {eligible.map((m) => <option key={m.user_id} value={m.user_id}>@{m.username} ({m.role})</option>)}
      </select>
      <select className="or-input w-full" value={role} onChange={(e) => setRole(e.target.value)} data-testid="rc-lc-transfer-role">
        <option value="admin">I stay as Administrator</option>
        <option value="manager">I stay as Manager</option>
        <option value="member">I stay as Member</option>
        <option value="leave">I leave after the transfer</option>
      </select>
      <input className="or-input w-full" placeholder="Optional note to the new owner" maxLength={500}
        value={note} onChange={(e) => setNote(e.target.value)} data-testid="rc-lc-transfer-note" />
      <input className="or-input w-full" placeholder={`Type the Center name to confirm: ${lc.center.name}`}
        value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="rc-lc-transfer-confirm" />
      <button className="or-btn text-xs" disabled={busy || !to || confirm.trim() !== lc.center.name}
        data-testid="rc-lc-transfer-submit"
        onClick={() => api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/transfer`,
          { to_user_id: to, post_transfer_role: role, note, confirm_name: confirm }), "Transfer request sent")}>
        Send transfer request
      </button>
    </div>
  );
};

const ConfirmNameForm = ({ label, color, centerName, cta, busy, onSubmit, testid }) => {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="p-3 rounded mb-3 space-y-2" data-testid={`${testid}-form`}
      style={{ background: `${color}11`, border: `1px solid ${color}55` }}>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
      <input className="or-input w-full" placeholder={`Type the Center name to confirm: ${centerName}`}
        value={name} onChange={(e) => setName(e.target.value)} data-testid={`${testid}-confirm`} />
      <input className="or-input w-full" placeholder="Optional reason" maxLength={300}
        value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${testid}-reason`} />
      <button className="or-btn text-xs" style={{ background: color, color: "#111" }}
        disabled={busy || name.trim() !== centerName} data-testid={`${testid}-submit`}
        onClick={() => onSubmit(name.trim(), reason)}>{cta}</button>
    </div>
  );
};

const CloseForm = ({ centerId, lc, busy, api }) => {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="p-3 rounded mb-3 space-y-2" data-testid="rc-lc-close-form"
      style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.35)" }}>
      {step === 1 && (
        <>
          <div className="text-sm font-semibold" style={{ color: "#FF6B6B" }}>Before you close — consider the alternatives</div>
          <ul className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
            <li>• <b>Pause</b> — temporary break, everything stays, restore anytime.</li>
            <li>• <b>Archive</b> — preserved and restorable; the safest long-term option.</li>
            <li>• <b>Transfer ownership</b> — hand the Center to another member.</li>
            <li>• <b>Close</b> — starts a controlled retention process. Previously used Fire Power is not returned. Export your records first. Some records must be retained for security, auditing, and transaction integrity.</li>
          </ul>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            Open work: {lc.open_items} · Members: {lc.member_count} · Vault: {lc.vault_balance?.toLocaleString()} Fire Power.
            You can cancel within {lc.settings.closure_cancel_window_days} days.
          </div>
          <button className="or-btn or-btn-ghost text-xs" onClick={() => setStep(2)} data-testid="rc-lc-close-continue">
            I understand — continue
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <input className="or-input w-full" placeholder={`Type the Center name: ${lc.center.name}`}
            value={name} onChange={(e) => setName(e.target.value)} data-testid="rc-lc-close-name" />
          <input className="or-input w-full" placeholder='Type: CLOSE THIS CENTER'
            value={phrase} onChange={(e) => setPhrase(e.target.value)} data-testid="rc-lc-close-phrase" />
          <input className="or-input w-full" placeholder="Why are you closing? (required)" maxLength={500}
            value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rc-lc-close-reason" />
          <button className="or-btn text-xs" style={{ background: "#FF6B6B", color: "#111" }}
            disabled={busy || name.trim() !== lc.center.name || phrase.trim().toUpperCase() !== "CLOSE THIS CENTER" || reason.trim().length < 5}
            data-testid="rc-lc-close-submit"
            onClick={() => api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/close`,
              { confirm_name: name.trim(), confirm_phrase: phrase.trim(), reason }), "Closure requested")}>
            Request Center closure
          </button>
        </>
      )}
    </div>
  );
};

const RecoveryForm = ({ centerId, busy, api, pending }) => {
  const [reason, setReason] = useState("");
  if (pending) {
    return <div className="text-xs mt-2" style={{ color: "#F4C84A" }} data-testid="rc-lc-recovery-pending">
      A recovery request is pending administrator review.</div>;
  }
  return (
    <div className="mt-2 space-y-2" data-testid="rc-lc-recovery-form">
      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Use this when the owner is unavailable. A platform administrator reviews every request — ownership never changes automatically.
      </div>
      <textarea className="or-input w-full" rows={2} maxLength={1000} placeholder="Why is recovery needed? (required)"
        value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rc-lc-recovery-reason" />
      <button className="or-btn text-xs" disabled={busy || reason.trim().length < 10} data-testid="rc-lc-recovery-submit"
        onClick={() => api(() => apiClient.post(`/responsibility-center/${centerId}/lifecycle/recovery`, { reason }), "Recovery request sent for review")}>
        Submit recovery request
      </button>
    </div>
  );
};

const LeaveSection = ({ centerId, busy, navigate, setBusy }) => {
  const [preview, setPreview] = useState(null);
  const start = async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/lifecycle/leave-preview`);
      setPreview(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not load departure details"); }
  };
  const leave = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/responsibility-center/${centerId}/lifecycle/leave`);
      toast.success("You left the Center");
      navigate("/responsibility-center");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not leave"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3">
      {!preview ? (
        <button className="or-btn or-btn-ghost text-xs" onClick={start}
          style={{ borderColor: "rgba(255,107,107,0.4)", color: "#FF6B6B" }} data-testid="rc-lc-leave-btn">
          <LogOut size={12} /> Leave Center…
        </button>
      ) : (
        <div className="p-3 rounded space-y-2" data-testid="rc-lc-leave-preview"
          style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.3)" }}>
          <div className="text-sm font-semibold" style={{ color: "#FF6B6B" }}>Leave {preview.center_name}?</div>
          <ul className="text-xs space-y-0.5" style={{ color: "var(--text-muted)" }}>
            <li>• Open items assigned to you: <b style={{ color: "var(--text-main)" }}>{preview.open_items}</b></li>
            <li>• Items awaiting your approval: <b style={{ color: "var(--text-main)" }}>{preview.pending_my_approval}</b></li>
            {preview.notes.map((n, i) => <li key={i}>• {n}</li>)}
          </ul>
          {preview.blocked_by_transfer && (
            <div className="text-xs font-semibold" style={{ color: "#F4C84A" }}>Resolve the pending ownership transfer first.</div>
          )}
          <div className="flex gap-2">
            <button className="or-btn text-xs" style={{ background: "#FF6B6B", color: "#111" }}
              disabled={busy || preview.blocked_by_transfer} onClick={leave} data-testid="rc-lc-leave-confirm">
              Confirm — leave Center
            </button>
            <button className="or-btn or-btn-ghost text-xs" onClick={() => setPreview(null)} data-testid="rc-lc-leave-cancel">Stay</button>
          </div>
        </div>
      )}
    </div>
  );
};
