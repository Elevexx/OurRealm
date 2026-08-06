/**
 * /confirm-deletion?token=… — final step of immediate permanent
 * deletion. The user arrives from the emailed / in-app confirmation
 * link, sees a last warning and must press the destructive button.
 */
import React, { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

export default function ConfirmDeletion() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const token = params.get("token") || "";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      await apiClient.post("/account/deletion/immediate/confirm", { token });
      setDone(true);
      setTimeout(() => { logout().catch(() => {}); }, 2500);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Confirmation failed");
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto or-surface p-5 mt-8 text-sm" data-testid="confirm-deletion-signin">
        Sign in to your account to confirm deletion.
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto or-surface p-5 mt-8"
      style={{ border: "1px solid #FF808055" }} data-testid="confirm-deletion-page">
      {done ? (
        <div className="text-center py-4" data-testid="confirm-deletion-done">
          <CheckCircle2 size={32} className="mx-auto mb-3" style={{ color: "#00FF66" }} />
          <h2 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>Deletion started</h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Your account is being permanently deleted. You are being signed out.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={20} style={{ color: "#FF8080" }} />
            <h2 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Confirm Permanent Deletion</h2>
          </div>
          <p className="text-sm mb-4" data-testid="confirm-deletion-warning">
            You're signed in as <strong>@{user.username}</strong>.{" "}
            <strong>This permanently deletes your account and cannot be undone.</strong>{" "}
            Public access is removed immediately, every session is revoked, and
            permanent erasure of your data begins right away.
          </p>
          {!token && (
            <div className="text-sm mb-3" style={{ color: "#FF8080" }} data-testid="confirm-deletion-no-token">
              No confirmation token found. Use the link from your email or notification.
            </div>
          )}
          {err && <div className="text-sm mb-3" style={{ color: "#FF8080" }} data-testid="confirm-deletion-error">{err}</div>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="or-chip" onClick={() => navigate("/settings/account")}
              data-testid="confirm-deletion-cancel">Keep My Account</button>
            <button type="button" onClick={confirm} disabled={!token || busy} className="or-btn"
              style={{ background: "#FF4444", color: "#fff" }} data-testid="confirm-deletion-confirm">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              &nbsp;Permanently Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
