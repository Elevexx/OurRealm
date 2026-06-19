/**
 * RestoreAccountPrompt — full-screen interstitial shown when a user
 * who is in the 30-day pending-deletion window signs back in.
 *
 *   - Restore Account → POST /api/profile/self-restore, clears the
 *     lifecycle fields, returns the user to the normal app.
 *   - Continue Deletion → logs the user out so they can't keep using
 *     the app on a "deleted" account.
 */
import React, { useState } from "react";
import { Loader2, RotateCcw, LogOut, AlertTriangle } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso.slice(0, 10); }
}

export default function RestoreAccountPrompt() {
  const { pendingDeletion, refreshMe, logout, setPendingDeletion, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const purgeAfter = pendingDeletion?.purge_after;

  const onRestore = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      await apiClient.post("/profile/self-restore");
      setPendingDeletion(null);
      await refreshMe();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not restore");
      setBusy(false);
    }
  };

  const onContinue = async () => {
    if (busy) return;
    setBusy(true);
    await logout();
    // logout() clears the pending state; AuthContext flips back to
    // unauthenticated → router sends user to landing/sign-in.
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      data-testid="restore-account-page"
      style={{ background: "var(--bgc)" }}
    >
      <div className="or-surface w-full max-w-md p-6" style={{ border: "1px solid var(--border-col)" }}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={18} style={{ color: "#FF8080" }} />
          <h1 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Account scheduled for deletion</h1>
        </div>
        <p className="text-sm mb-3" style={{ color: "var(--text-main)" }}>
          Hi @{user?.username || "there"}. Your account is scheduled for
          deletion{purgeAfter ? <> on <strong>{fmtDate(purgeAfter)}</strong></> : null}. Do you want to restore it?
        </p>
        <p className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>
          Restoring brings everything back exactly as it was. Continuing
          will keep your account deactivated and sign you out.
        </p>

        {err && <div className="text-sm mb-3" style={{ color: "#FF8080" }} data-testid="restore-account-error">{err}</div>}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onRestore}
            disabled={busy}
            className="or-btn justify-center"
            data-testid="restore-account-restore"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            &nbsp;Restore Account
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="or-chip justify-center"
            data-testid="restore-account-continue"
          >
            <LogOut size={12} /> Continue Deletion
          </button>
        </div>
      </div>
    </div>
  );
}
