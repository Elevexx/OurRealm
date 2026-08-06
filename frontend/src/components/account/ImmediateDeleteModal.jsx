/**
 * ImmediateDeleteModal — permanent, no-recovery deletion.
 * Step 1: password reauth + exact username confirmation.
 * Step 2: a single-use confirmation link (30-minute expiry) is sent to
 * the account email (or delivered as an in-app notification when email
 * delivery isn't configured). Opening it lands on /confirm-deletion.
 */
import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2, MailCheck, Trash2, X } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

export default function ImmediateDeleteModal({ open, onClose, dataMap }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [delivery, setDelivery] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    if (!open) {
      setStep(1); setPassword(""); setConfirmName(""); setErr("");
      setBusy(false); setDelivery(""); setExpiresAt("");
    }
  }, [open]);

  if (!open) return null;

  const ready = password.length > 0 &&
    confirmName.trim().toLowerCase() === (user?.username || "").toLowerCase();

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post("/account/deletion/immediate/request", {
        password, username_confirm: confirmName.trim(),
      });
      setDelivery(data.delivery);
      setExpiresAt(data.expires_at);
      setStep(2);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not start deletion");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}
      data-testid="immediate-delete-backdrop">
      <div className="or-surface w-full max-w-md p-5 my-8"
        style={{ border: "1px solid #FF808055" }}
        onClick={(e) => e.stopPropagation()} data-testid="immediate-delete-modal" role="dialog">
        <div className="flex items-center mb-3">
          <AlertTriangle size={18} style={{ color: "#FF8080", flexShrink: 0 }} />
          <h3 className="flex-1 text-lg ml-2" style={{ fontFamily: "var(--font-display)" }}>Permanently Delete Account</h3>
          <button type="button" onClick={onClose} className="or-chip" data-testid="immediate-delete-close" aria-label="Close"><X size={12} /></button>
        </div>

        {step === 1 && (
          <>
            <p className="text-sm mb-3" style={{ color: "var(--text-main)" }} data-testid="immediate-delete-warning">
              <strong>This permanently deletes your account and cannot be undone.</strong>{" "}
              There is no recovery period. Public access is removed immediately,
              all sessions are revoked, and permanent erasure of your data begins
              right away. Consider downloading your data first.
            </p>
            {dataMap && (
              <div className="text-[11px] p-2 rounded mb-3" style={{ border: "1px solid #FF808055", color: "var(--text-muted)" }} data-testid="immediate-delete-preview">
                This will permanently remove:{" "}
                {dataMap.filter((c) => c.count > 0).map((c) => `${c.count} ${c.label.toLowerCase()}`).join(" · ")}
              </div>
            )}
            <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>Current password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="or-input mb-2" placeholder="Password" data-testid="immediate-delete-password" />
            <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>
              Type your username <code>@{user?.username}</code> to confirm
            </label>
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
              className="or-input mb-3" placeholder={user?.username} data-testid="immediate-delete-username" />
            {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }} data-testid="immediate-delete-error">{err}</div>}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="or-chip" data-testid="immediate-delete-cancel">Cancel</button>
              <button type="button" onClick={submit} disabled={!ready || busy} className="or-btn"
                style={{ background: "#FF4444", color: "#fff" }} data-testid="immediate-delete-submit">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                &nbsp;Send Confirmation Link
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <div data-testid="immediate-delete-step2">
            <div className="flex items-center gap-2 mb-2">
              <MailCheck size={16} style={{ color: "#00FF66" }} />
              <span className="text-sm font-semibold">Confirmation link sent</span>
            </div>
            <p className="text-sm mb-3" style={{ color: "var(--text-main)" }}>
              {delivery === "email"
                ? "We emailed a confirmation link to your account email."
                : "A confirmation link was delivered to your in-app Notifications (email delivery is not configured)."}{" "}
              Open it within <strong>30 minutes</strong> to complete permanent
              deletion. If you do nothing, your account stays untouched.
            </p>
            {expiresAt && (
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                Link expires at {new Date(expiresAt).toLocaleTimeString()}.
              </p>
            )}
            <div className="flex items-center justify-end">
              <button type="button" onClick={onClose} className="or-btn" data-testid="immediate-delete-done">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
