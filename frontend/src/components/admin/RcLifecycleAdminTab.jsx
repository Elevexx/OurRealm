import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const fmt = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};

// Bundle D — Admin Lifecycle tab. Every mutating action requires a
// written reason; the backend writes an immutable lifecycle audit row.
export const RcLifecycleAdminTab = ({ centerId }) => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/admin/responsibility-center/${centerId}/lifecycle`);
      setData(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not load lifecycle data"); }
  }, [centerId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="or-surface p-5 text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  const c = data.center || {};
  const closure = c.closure || { status: "none" };
  const pendingTransfer = (data.transfers || []).find((t) => t.status === "pending");
  const pendingRecovery = (data.recovery_requests || []).find((r) => r.status === "pending");

  const act = async (url, body, ok) => {
    const reason = window.prompt("Written reason (required):");
    if (!reason || reason.trim().length < 5) { toast.error("A written reason is required"); return; }
    setBusy(true);
    try {
      await apiClient.post(url, { ...body, reason });
      toast.success(ok);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="rc-admin-lifecycle-tab">
      <div className="or-surface p-4">
        <div className="text-sm font-semibold mb-2">Lifecycle state</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <div>Operational: <b className="uppercase" style={{ color: "var(--text-main)" }} data-testid="rc-admin-lc-status">{c.status}</b></div>
          <div>Ownership: <b>{c.ownership_status || "stable"}</b></div>
          <div>Closure: <b data-testid="rc-admin-lc-closure">{closure.status || "none"}</b></div>
          <div>Vault frozen: <b>{c.vault_frozen ? "yes" : "no"}</b></div>
          <div>Retention hold: <b style={{ color: closure.retention_hold ? "#FF6B6B" : undefined }}>{closure.retention_hold ? "ACTIVE" : "no"}</b></div>
          {closure.cancellation_deadline && ["requested", "review", "approved"].includes(closure.status)
            && <div>Cancel window ends: {fmt(closure.cancellation_deadline)}</div>}
          {closure.final_vault_balance != null && <div>Final Vault balance: {closure.final_vault_balance}</div>}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {["requested", "review"].includes(closure.status) && (
            <>
              <button className="or-btn text-xs" disabled={busy} data-testid="rc-admin-lc-closure-approve"
                onClick={() => act(`/admin/responsibility-center/${centerId}/lifecycle/closure/decide`, { decision: "approve" }, "Closure approved")}>
                Approve closure
              </button>
              <button className="or-btn or-btn-ghost text-xs" disabled={busy} data-testid="rc-admin-lc-closure-deny"
                onClick={() => act(`/admin/responsibility-center/${centerId}/lifecycle/closure/decide`, { decision: "deny" }, "Closure denied")}>
                Deny closure
              </button>
            </>
          )}
          {["requested", "review", "approved"].includes(closure.status) && (
            <button className="or-btn or-btn-ghost text-xs" disabled={busy} data-testid="rc-admin-lc-closure-cancel"
              onClick={() => act(`/admin/responsibility-center/${centerId}/lifecycle/closure/cancel`, {}, "Closure canceled")}>
              Cancel closure
            </button>
          )}
          <button className="or-btn or-btn-ghost text-xs" disabled={busy} data-testid="rc-admin-lc-hold-toggle"
            onClick={() => act(`/admin/responsibility-center/${centerId}/lifecycle/retention-hold`,
              { hold: !closure.retention_hold }, closure.retention_hold ? "Retention hold removed" : "Retention hold applied")}>
            {closure.retention_hold ? "Remove retention hold" : "Place retention hold"}
          </button>
          {["paused", "archived"].includes(c.status) && (
            <button className="or-btn text-xs" disabled={busy} data-testid="rc-admin-lc-restore"
              onClick={() => act(`/admin/responsibility-center/${centerId}/lifecycle/restore`, {}, "Center restored")}>
              Restore Center
            </button>
          )}
        </div>
      </div>

      {pendingTransfer && (
        <div className="or-surface p-4" data-testid="rc-admin-lc-transfer">
          <div className="text-sm font-semibold mb-1">Pending ownership transfer</div>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            @{pendingTransfer.from_username} → @{pendingTransfer.to_username} · expires {fmt(pendingTransfer.expires_at)}
          </div>
          <button className="or-btn or-btn-ghost text-xs" disabled={busy} data-testid="rc-admin-lc-transfer-cancel"
            onClick={() => act(`/admin/responsibility-center/${centerId}/lifecycle/transfer/${pendingTransfer.id}/cancel`, {}, "Transfer canceled")}>
            Cancel transfer
          </button>
        </div>
      )}

      {pendingRecovery && (
        <div className="or-surface p-4" data-testid="rc-admin-lc-recovery">
          <div className="text-sm font-semibold mb-1">Ownership recovery request</div>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            By @{pendingRecovery.requested_by_username} ({pendingRecovery.requester_role}) · {fmt(pendingRecovery.created_at)}
            <div className="mt-1">“{pendingRecovery.reason}”</div>
          </div>
          <div className="flex gap-2">
            <button className="or-btn text-xs" disabled={busy} data-testid="rc-admin-lc-recovery-approve"
              onClick={() => act(`/admin/responsibility-center/${centerId}/lifecycle/recovery/${pendingRecovery.id}/decide`, { decision: "approve" }, "Recovery approved — ownership transferred")}>
              Approve recovery
            </button>
            <button className="or-btn or-btn-ghost text-xs" disabled={busy} data-testid="rc-admin-lc-recovery-deny"
              onClick={() => act(`/admin/responsibility-center/${centerId}/lifecycle/recovery/${pendingRecovery.id}/decide`, { decision: "deny" }, "Recovery denied")}>
              Deny
            </button>
          </div>
        </div>
      )}

      <div className="or-surface p-4">
        <div className="text-sm font-semibold mb-2">Transfer history</div>
        {(data.transfers || []).length === 0 ? (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>No ownership transfers yet.</div>
        ) : data.transfers.map((t) => (
          <div key={t.id} className="text-xs py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            @{t.from_username} → @{t.to_username} · <b className="uppercase">{t.status}</b> · {fmt(t.created_at)}
          </div>
        ))}
      </div>

      <div className="or-surface p-4" data-testid="rc-admin-lc-audit">
        <div className="text-sm font-semibold mb-2">Lifecycle audit (immutable)</div>
        {(data.lifecycle_audit || []).map((a) => (
          <div key={a.id} className="text-[11px] py-0.5" style={{ color: "var(--text-muted)" }}>
            {fmt(a.created_at)} · @{a.actor_username || a.actor_id} · <b style={{ color: "var(--text-main)" }}>{a.action.replace(/_/g, " ")}</b>
            {a.reason ? ` — "${a.reason}"` : ""}
          </div>
        ))}
      </div>
    </div>
  );
};
