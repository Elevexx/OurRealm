/**
 * DeleteAccountModal — destructive confirmation modal launched from
 * Settings > Account. Shows the exact warning copy mandated by the
 * Feb 19 spec and gates the destructive button behind a typed
 * acknowledgement. Calls POST /api/profile/self-delete and then
 * fully logs the user out.
 */
import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

export default function DeleteAccountModal({ open, onClose }) {
  const { logout } = useAuth();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) { setConfirm(""); setErr(""); setBusy(false); }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const ready = confirm.trim().toUpperCase() === "DELETE";

  const doDelete = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      await apiClient.post("/profile/self-delete", { confirm: "DELETE" });
      // Fully log out so the user lands on the sign-in page. If they
      // sign back in within 30 days they'll see the restore prompt.
      await logout();
      // logout() doesn't redirect — let the app router send them to
      // /signin via the unauthenticated gate. We close the modal for
      // cleanliness.
      onClose?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not delete account");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={onClose}
      data-testid="delete-account-backdrop"
    >
      <div
        className="or-surface w-full max-w-md p-5 my-8"
        style={{ border: "1px solid #FF808055" }}
        onClick={(e) => e.stopPropagation()}
        data-testid="delete-account-modal"
        role="dialog"
        aria-labelledby="delete-account-title"
      >
        <div className="flex items-center mb-3">
          <AlertTriangle size={18} style={{ color: "#FF8080", flexShrink: 0 }} />
          <h3 id="delete-account-title" className="flex-1 text-lg ml-2" style={{ fontFamily: "var(--font-display)" }}>Delete Account?</h3>
          <button type="button" onClick={onClose} className="or-chip" data-testid="delete-account-close" aria-label="Close">
            <X size={12} />
          </button>
        </div>

        <p className="text-sm mb-3" style={{ color: "var(--text-main)" }} data-testid="delete-account-warning">
          Deleting your account will deactivate your profile for 30 days.
          During this time, your profile will not appear in search and other
          users will see <strong>User Not Found</strong> if they visit your
          username. Your username cannot be claimed by anyone else during
          this 30-day period. If you sign back in within 30 days, you can
          restore your account exactly as it was. After 30 days, your account
          may be permanently deleted according to our Terms, Privacy Policy,
          and retention rules.
        </p>

        <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>
          Type <code>DELETE</code> to confirm
        </label>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="or-input mb-3"
          placeholder="DELETE"
          autoFocus
          data-testid="delete-account-confirm-input"
        />

        {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }} data-testid="delete-account-error">{err}</div>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="or-chip" data-testid="delete-account-cancel">
            Cancel
          </button>
          <button
            type="button"
            onClick={doDelete}
            disabled={!ready || busy}
            className="or-btn"
            style={{ background: "#FF4444", color: "#fff" }}
            data-testid="delete-account-confirm"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            &nbsp;Delete My Account
          </button>
        </div>
      </div>
    </div>
  );
}
