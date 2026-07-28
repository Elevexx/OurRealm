/**
 * PremiumUsernameModal — unlock short usernames by permanently burning
 * Fire Power from the Fire Vault. All pricing/eligibility is
 * server-authoritative; this UI only mirrors /premium-usernames/check.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Flame, Loader2, Check, AlertCircle, Search } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const fmt = (n) => Number(n || 0).toLocaleString();

export default function PremiumUsernameModal({ open, onClose }) {
  const { refreshMe } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setQ(""); setRes(null); setConfirming(false);
    apiClient.get("/fire/wallet").then((r) => setWallet(r.data)).catch(() => setWallet(null));
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (!q || q.length < 1) { setRes(null); return undefined; }
    setChecking(true); setConfirming(false);
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get(`/premium-usernames/check?u=${encodeURIComponent(q)}`);
        setRes(data);
      } catch (e) {
        setRes({ status: "error", message: e?.response?.data?.detail || "Check failed" });
      } finally { setChecking(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [q, open]);

  if (!open) return null;

  const w = wallet?.wallet || {};
  const pool = wallet?.pool || {};
  const canUnlock = res?.status === "available" && res?.cost != null;
  const canRename = res?.status === "standard";

  const doUnlock = async (key = idemKey) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post("/premium-usernames/unlock", {
        username: res.username, idempotency_key: key,
      });
      toast.success(data.message || `Premium username unlocked! @${data.username}`);
      await refreshMe();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Unlock failed — nothing was charged.");
      setConfirming(false);
    } finally { setBusy(false); }
  };

  const stateLine = () => {
    if (checking) return <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Checking…</span>;
    if (!res) return null;
    const color = res.status === "available" ? "var(--brand-green, #00FF66)"
      : res.status === "standard" ? "var(--text-muted)" : "#FF8080";
    const label = {
      available: "Available", taken: "Already exists", reserved: "Reserved / locked",
      prohibited: "Reserved / locked", retired: "Reserved / locked", locked: "Locked",
      verification_required: "Verification required", invalid: "Invalid",
      insufficient_vault: "Insufficient Fire Vault balance", standard: "Standard username",
      error: "Error",
    }[res.status] || res.status;
    return (
      <span className="text-[11px] font-bold flex items-center gap-1" style={{ color }}
        data-testid="premium-username-state">
        {res.status === "available" ? <Check size={11} /> : <AlertCircle size={11} />} {label}
      </span>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[98] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={onClose} role="dialog" aria-modal="true" aria-label="Unlock Premium Username"
      data-testid="premium-username-modal">
      <div className="or-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col"
        style={{ maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="text-sm font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
            <Flame size={15} style={{ color: "#FF7A00" }} /> Unlock Premium Username
          </div>
          <button className="starbar-icon" style={{ width: 30, height: 30 }} onClick={onClose}
            aria-label="Close" data-testid="premium-username-close"><X size={13} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded" style={{ background: "var(--surface-2)" }}>
              <div style={{ color: "var(--text-muted)" }}>Fire Vault</div>
              <div className="font-bold text-sm" data-testid="premium-vault-balance">{fmt(w.vault_balance)} 🔥</div>
            </div>
            <div className="p-2 rounded" style={{ background: "var(--surface-2)" }}>
              <div style={{ color: "var(--text-muted)" }}>Claimable Fire</div>
              <div className="font-bold text-sm" data-testid="premium-claimable">{fmt(w.collectable_balance)}</div>
            </div>
            {Number(w.pending_balance) > 0 && (
              <div className="p-2 rounded" style={{ background: "var(--surface-2)" }}>
                <div style={{ color: "var(--text-muted)" }}>Pending Fire</div>
                <div className="font-bold text-sm" data-testid="premium-pending">{fmt(w.pending_balance)}</div>
              </div>
            )}
            <div className="p-2 rounded" style={{ background: "var(--surface-2)" }}>
              <div style={{ color: "var(--text-muted)" }}>Daily Fire Pool</div>
              <div className="font-bold text-sm" data-testid="premium-daily-pool">{fmt(pool.available)}</div>
            </div>
          </div>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Only Fire Power collected into your <b>Fire Vault</b> can be used. Claimable,
            pending, and Daily Pool Fire must be collected first.
          </p>

          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }} />
            <input className="or-input w-full pl-8 text-sm" placeholder="Search a username…"
              value={q} maxLength={24}
              onChange={(e) => setQ(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))}
              data-testid="premium-username-search" />
          </div>
          <div className="flex items-center justify-between">
            {stateLine()}
            {res && !checking && (
              <span className="text-[10px] font-bold" data-testid="premium-username-kind"
                style={{ color: res.premium ? "#FF7A00" : "var(--text-muted)" }}>
                {res.premium ? "Premium Username" : "Normal username"}
              </span>
            )}
          </div>
          {res?.message && !["available", "standard"].includes(res?.status) && (
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{res.message}</p>
          )}

          {canRename && (
            <button className="or-btn w-full text-xs" disabled={busy}
              onClick={() => doUnlock((crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`)}
              data-testid="premium-rename-standard-btn">
              {busy ? <Loader2 size={13} className="animate-spin" /> : `Change username to @${res.username} (free)`}
            </button>
          )}

          {canUnlock && !confirming && (
            <div className="p-3 rounded space-y-1.5 text-xs"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)" }}
              data-testid="premium-unlock-summary">
              <div className="flex justify-between"><span>Username</span><b>@{res.username}</b></div>
              <div className="flex justify-between"><span>Characters</span><b>{res.length}</b></div>
              <div className="flex justify-between"><span>Required Fire Power</span><b>{fmt(res.cost)} 🔥</b></div>
              <div className="flex justify-between"><span>Vault balance</span><b>{fmt(res.vault_balance)}</b></div>
              <div className="flex justify-between"><span>Balance after unlock</span><b>{fmt(res.balance_after)}</b></div>
              <button className="or-btn w-full mt-1"
                onClick={() => { setIdemKey((crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`); setConfirming(true); }}
                data-testid="premium-unlock-btn">
                Unlock Username with {fmt(res.cost)} Fire Power 🔥
              </button>
            </div>
          )}

          {canUnlock && confirming && (
            <div className="p-3 rounded space-y-2 text-xs"
              style={{ background: "rgba(255,122,0,0.08)", border: "1px solid rgba(255,122,0,0.5)" }}
              data-testid="premium-unlock-confirm">
              <p>
                You are <b>permanently burning {fmt(res.cost)} Fire Power</b> from your Fire
                Vault to unlock <b>@{res.username}</b>. This cannot be undone.
              </p>
              <div className="flex justify-between"><span>Old username</span><b>@{wallet ? "" : ""}{res.old_username || ""}{!res.old_username && <CurrentUsername />}</b></div>
              <div className="flex justify-between"><span>New username</span><b>@{res.username}</b></div>
              <div className="flex justify-between"><span>Balance before</span><b>{fmt(res.vault_balance)}</b></div>
              <div className="flex justify-between"><span>Balance after</span><b>{fmt(res.balance_after)}</b></div>
              <div className="flex gap-2">
                <button className="or-btn flex-1" disabled={busy} onClick={() => doUnlock()}
                  data-testid="premium-unlock-confirm-btn">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : "Confirm permanent burn 🔥"}
                </button>
                <button className="or-chip" disabled={busy} onClick={() => setConfirming(false)}
                  data-testid="premium-unlock-cancel">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function CurrentUsername() {
  const { user } = useAuth();
  return <>{user?.username}</>;
}
