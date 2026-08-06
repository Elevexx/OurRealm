/**
 * CloseAccountModal — recoverable account closure (1-365 days).
 * Requires password reauth + exact username confirmation. Public
 * access is removed immediately; the user can restore by signing
 * back in within the chosen window.
 */
import React, { useEffect, useState } from "react";
import { Clock, Loader2, X } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const PRESETS = [
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

export default function CloseAccountModal({ open, onClose, dataMap }) {
  const { user, logout } = useAuth();
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState(false);
  const [customDays, setCustomDays] = useState("");
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) {
      setDays(30); setCustom(false); setCustomDays(""); setPassword("");
      setConfirmName(""); setReason(""); setErr(""); setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const effectiveDays = custom ? parseInt(customDays, 10) : days;
  const daysValid = Number.isInteger(effectiveDays) && effectiveDays >= 1 && effectiveDays <= 365;
  const ready = daysValid && password.length > 0 &&
    confirmName.trim().toLowerCase() === (user?.username || "").toLowerCase();

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      await apiClient.post("/account/closure", {
        password, username_confirm: confirmName.trim(),
        recovery_days: effectiveDays, reason: reason || null,
      });
      await logout();
      onClose?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not close account");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}
      data-testid="close-account-backdrop">
      <div className="or-surface w-full max-w-md p-5 my-8"
        style={{ border: "1px solid rgba(255,209,102,0.4)" }}
        onClick={(e) => e.stopPropagation()} data-testid="close-account-modal"
        role="dialog">
        <div className="flex items-center mb-3">
          <Clock size={18} style={{ color: "#FFD166", flexShrink: 0 }} />
          <h3 className="flex-1 text-lg ml-2" style={{ fontFamily: "var(--font-display)" }}>Close Account</h3>
          <button type="button" onClick={onClose} className="or-chip" data-testid="close-account-close" aria-label="Close"><X size={12} /></button>
        </div>

        <p className="text-sm mb-3" style={{ color: "var(--text-main)" }} data-testid="close-account-warning">
          Your profile disappears from public view <strong>immediately</strong> and
          every active session is signed out. You can restore your account exactly
          as it was by signing back in within your recovery window. After the
          window ends, your account is <strong>permanently deleted</strong>.
        </p>
        {dataMap && (
          <div className="text-[11px] p-2 rounded mb-3" style={{ border: "1px solid rgba(255,209,102,0.35)", color: "var(--text-muted)" }} data-testid="close-account-preview">
            After the recovery window, deletion will remove:{" "}
            {dataMap.filter((c) => c.count > 0).map((c) => `${c.count} ${c.label.toLowerCase()}`).join(" · ")}
          </div>
        )}

        <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>Recovery window</label>
        <div className="flex flex-wrap gap-1 mb-2">
          {PRESETS.map((p) => (
            <button key={p.days} type="button" className="or-chip"
              data-active={!custom && days === p.days}
              onClick={() => { setCustom(false); setDays(p.days); }}
              data-testid={`close-account-days-${p.days}`}
              style={!custom && days === p.days ? { borderColor: "#FFD166", color: "#FFD166" } : {}}>
              {p.label}
            </button>
          ))}
          <button type="button" className="or-chip" data-active={custom}
            onClick={() => setCustom(true)} data-testid="close-account-days-custom"
            style={custom ? { borderColor: "#FFD166", color: "#FFD166" } : {}}>
            Custom
          </button>
        </div>
        {custom && (
          <input type="number" min={1} max={365} value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            className="or-input mb-2" placeholder="Days (1-365)"
            data-testid="close-account-custom-days" />
        )}
        {custom && customDays && !daysValid && (
          <div className="text-xs mb-2" style={{ color: "#FF8080" }}>Recovery window must be between 1 and 365 days.</div>
        )}

        <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>Current password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="or-input mb-2" placeholder="Password" data-testid="close-account-password" />

        <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>
          Type your username <code>@{user?.username}</code> to confirm
        </label>
        <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
          className="or-input mb-2" placeholder={user?.username} data-testid="close-account-username" />

        <input value={reason} onChange={(e) => setReason(e.target.value)}
          className="or-input mb-3" placeholder="Reason (optional)" maxLength={400}
          data-testid="close-account-reason" />

        {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }} data-testid="close-account-error">{err}</div>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="or-chip" data-testid="close-account-cancel">Cancel</button>
          <button type="button" onClick={submit} disabled={!ready || busy} className="or-btn"
            style={{ background: "#B8860B", color: "#fff" }} data-testid="close-account-submit">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
            &nbsp;Close My Account
          </button>
        </div>
      </div>
    </div>
  );
}
