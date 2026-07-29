/**
 * ReasonModal — confirmation modal for moderation actions.
 * Supports required/optional reason input + destructive styling.
 */
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, X } from "lucide-react";

export default function ReasonModal({
  title, message, confirmLabel = "Confirm", requireReason = false,
  destructive = false, onConfirm, onClose,
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (requireReason && !reason.trim()) {
      setErr("A reason is required for this action.");
      return;
    }
    setBusy(true); setErr("");
    try {
      await onConfirm(reason.trim() || null);
      onClose?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Action failed");
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 10060 }}
      onClick={onClose}
      data-testid="reason-modal-overlay"
    >
      <div className="or-surface w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} data-testid="reason-modal">
        <div className="flex items-center gap-2 mb-2">
          {destructive && <AlertTriangle size={16} style={{ color: "#FF8080" }} />}
          <h3 className="text-base flex-1" style={{ fontFamily: "var(--font-display)" }}>{title}</h3>
          <button onClick={onClose} className="starbar-icon" style={{ width: 28, height: 28 }} data-testid="reason-modal-close">
            <X size={13} />
          </button>
        </div>
        {message && <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>{message}</p>}
        <textarea
          className="w-full text-sm px-3 py-2 mb-2"
          style={{ background: "transparent", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)", minHeight: 64 }}
          placeholder={requireReason ? "Internal reason (required)" : "Internal reason (optional)"}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="reason-modal-input"
        />
        {err && <div className="text-xs mb-2" style={{ color: "#FF8080" }} data-testid="reason-modal-error">{err}</div>}
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="or-btn w-full"
          style={destructive ? { background: "color-mix(in srgb, #FF3F5A 22%, transparent)", color: "#FF8080", border: "1px solid rgba(255,80,80,0.5)" } : undefined}
          data-testid="reason-modal-confirm"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
