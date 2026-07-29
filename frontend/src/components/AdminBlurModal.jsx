/**
 * AdminBlurModal — admin action: blur any content for other users.
 * Category picker + optional internal reason + optional public warning.
 */
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, ShieldAlert, X } from "lucide-react";
import apiClient from "@/api/client";

const CATEGORIES = [
  { id: "graphic", label: "Graphic Content" },
  { id: "nudity_sexual", label: "Nudity / Sexual" },
  { id: "violence", label: "Violence" },
  { id: "medical", label: "Sensitive Medical" },
  { id: "disturbing", label: "Disturbing" },
  { id: "custom", label: "Custom Warning" },
];

export default function AdminBlurModal({ contentType = "post", contentId, onClose, onDone }) {
  const [category, setCategory] = useState("graphic");
  const [internalReason, setInternalReason] = useState("");
  const [publicMessage, setPublicMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const apply = async () => {
    setBusy(true); setErr("");
    try {
      await apiClient.post(`/admin/moderation/${contentType}/${contentId}/blur`, {
        category,
        internal_reason: internalReason || null,
        public_message: publicMessage || null,
      });
      onDone?.(category, publicMessage);
      onClose?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to apply blur");
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 10050 }}
      onClick={onClose}
      data-testid="admin-blur-modal-overlay"
    >
      <div
        className="or-surface w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
        data-testid="admin-blur-modal"
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={18} style={{ color: "var(--primary)" }} />
          <h3 className="text-lg flex-1" style={{ fontFamily: "var(--font-display)" }}>
            Blur for other users
          </h3>
          <button onClick={onClose} className="starbar-icon" style={{ width: 30, height: 30 }} data-testid="admin-blur-close">
            <X size={14} />
          </button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          The uploader keeps seeing their own content normally. Everyone else
          sees a warning overlay. Engagement is preserved.
        </p>
        <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
          Warning category
        </div>
        <div className="grid grid-cols-2 gap-1.5 mb-3" data-testid="admin-blur-categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className="text-[11px] px-2 py-2"
              style={{
                borderRadius: 6,
                background: category === c.id ? "color-mix(in srgb, var(--primary) 22%, transparent)" : "transparent",
                color: category === c.id ? "var(--primary)" : "var(--text-main)",
                border: category === c.id ? "1px solid var(--primary)" : "1px solid var(--border-col)",
              }}
              data-testid={`admin-blur-cat-${c.id}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          className="or-input w-full mb-2 text-sm px-3 py-2"
          style={{ background: "transparent", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)" }}
          placeholder="Public warning message (optional)"
          maxLength={200}
          value={publicMessage}
          onChange={(e) => setPublicMessage(e.target.value)}
          data-testid="admin-blur-public-message"
        />
        <input
          className="or-input w-full mb-3 text-sm px-3 py-2"
          style={{ background: "transparent", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)" }}
          placeholder="Internal reason (optional, admins only)"
          maxLength={300}
          value={internalReason}
          onChange={(e) => setInternalReason(e.target.value)}
          data-testid="admin-blur-internal-reason"
        />
        {err && <div className="text-xs mb-2" style={{ color: "#FF8080" }} data-testid="admin-blur-error">{err}</div>}
        <button
          type="button"
          disabled={busy}
          onClick={apply}
          className="or-btn w-full"
          data-testid="admin-blur-apply"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : "Apply blur"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
