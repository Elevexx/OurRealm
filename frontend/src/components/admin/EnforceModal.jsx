/**
 * EnforceModal — account enforcement (warn / limit / suspend / lifts).
 * Reason always required; limit adds capability checkboxes + duration.
 */
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, X } from "lucide-react";
import apiClient from "@/api/client";

const CAPS = [
  ["posting", "Posting"], ["commenting", "Commenting"], ["messaging", "Messaging"],
  ["uploading", "Uploading"], ["realm_creation", "Realm creation"],
  ["recommendations", "Recommendations"],
];
const TITLES = {
  warn: "Send formal warning",
  limit: "Limit account",
  unlimit: "Lift account limits",
  suspend: "Suspend account",
  unsuspend: "Lift suspension",
};

export default function EnforceModal({ userId, username, action, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(action === "suspend" ? 7 : 3);
  const [caps, setCaps] = useState(["posting", "commenting"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const destructive = ["limit", "suspend"].includes(action);

  const submit = async () => {
    if (reason.trim().length < 2) { setErr("A reason is required."); return; }
    if (action === "limit" && caps.length === 0) { setErr("Select at least one capability."); return; }
    setBusy(true); setErr("");
    try {
      await apiClient.post(`/admin/moderation/users/${userId}/enforce`, {
        action, reason: reason.trim(),
        days: ["limit", "suspend"].includes(action) ? Number(days) : null,
        capabilities: action === "limit" ? caps : null,
        source: "user_profile",
      });
      onDone?.(action);
      onClose?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Enforcement failed");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 10060 }}
      onClick={onClose} data-testid="enforce-modal-overlay">
      <div className="or-surface w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} data-testid="enforce-modal">
        <div className="flex items-center gap-2 mb-2">
          {destructive && <AlertTriangle size={16} style={{ color: "#FF8080" }} />}
          <h3 className="text-base flex-1" style={{ fontFamily: "var(--font-display)" }}>
            {TITLES[action]} · @{username}
          </h3>
          <button onClick={onClose} className="starbar-icon" style={{ width: 28, height: 28 }} data-testid="enforce-modal-close">
            <X size={13} />
          </button>
        </div>
        {action === "limit" && (
          <div className="grid grid-cols-2 gap-1.5 mb-2" data-testid="enforce-caps">
            {CAPS.map(([id, label]) => (
              <label key={id} className="or-chip text-[11px] cursor-pointer justify-start" style={{ minHeight: 34 }}>
                <input type="checkbox" checked={caps.includes(id)}
                  onChange={(e) => setCaps((c) => e.target.checked ? [...c, id] : c.filter((x) => x !== id))}
                  data-testid={`enforce-cap-${id}`} /> {label}
              </label>
            ))}
          </div>
        )}
        {["limit", "suspend"].includes(action) && (
          <label className="flex items-center gap-2 text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            Duration (days)
            <input type="number" min={1} max={action === "suspend" ? 365 : 90} value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-20 px-2 py-1.5 text-sm"
              style={{ background: "transparent", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)" }}
              data-testid="enforce-days" />
          </label>
        )}
        <textarea
          className="w-full text-sm px-3 py-2 mb-2"
          style={{ background: "transparent", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)", minHeight: 60 }}
          placeholder="Internal reason (required)"
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="enforce-reason"
        />
        {err && <div className="text-xs mb-2" style={{ color: "#FF8080" }} data-testid="enforce-error">{err}</div>}
        <button type="button" disabled={busy} onClick={submit} className="or-btn w-full"
          style={destructive ? { background: "color-mix(in srgb, #FF3F5A 22%, transparent)", color: "#FF8080", border: "1px solid rgba(255,80,80,0.5)" } : undefined}
          data-testid="enforce-confirm">
          {busy ? <Loader2 size={14} className="animate-spin" /> : TITLES[action]}
        </button>
      </div>
    </div>,
    document.body,
  );
}
