/**
 * ReportButton — small "Report" CTA wired to POST /api/reports.
 * Opens a compact modal with a category picker + optional detail field.
 *
 * Reusable across posts, comments, and profile cards by passing
 * contentType ∈ {"post","comment","profile"} + contentId.
 */
import React, { useState } from "react";
import { Flag, X, Loader2 } from "lucide-react";
import apiClient from "@/api/client";

const REASONS = [
  { id: "spam",       label: "Spam" },
  { id: "harassment", label: "Harassment" },
  { id: "hate",       label: "Hate" },
  { id: "sexual",     label: "Sexual content" },
  { id: "threats",    label: "Threats" },
  { id: "self_harm",  label: "Self-harm" },
  { id: "scam",       label: "Scam" },
  { id: "other",      label: "Other" },
];

export default function ReportButton({ contentType, contentId, label = "Report", testid }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const tid = testid || `report-${contentType}-${contentId}`;
  const submit = async () => {
    setBusy(true); setMsg("");
    try {
      const { data } = await apiClient.post("/reports", {
        content_type: contentType,
        content_id: contentId,
        reason,
        detail: detail.trim() || undefined,
      });
      setMsg(data?.duplicate ? "You already reported this." : "Thanks — our team will review.");
      setTimeout(() => setOpen(false), 1400);
    } catch (e) {
      setMsg(e?.response?.data?.detail || "Could not submit report.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <button
        type="button"
        className="or-chip"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        data-testid={`${tid}-trigger`}
        title="Report"
      >
        <Flag size={12} /> {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", padding: 12 }}
          onClick={() => setOpen(false)}
          data-testid={`${tid}-modal`}
        >
          <div
            className="or-surface p-5"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, calc(100vw - 24px))", maxHeight: "85vh", overflow: "auto" }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Report content</h3>
              <button onClick={() => setOpen(false)} className="starbar-icon" style={{ width: 32, height: 32 }} data-testid={`${tid}-close`} aria-label="Close"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReason(r.id)}
                  className="text-[11px] uppercase tracking-wide px-2 py-2"
                  style={{
                    borderRadius: 6,
                    background: reason === r.id ? "color-mix(in srgb, var(--primary) 22%, transparent)" : "transparent",
                    color: reason === r.id ? "var(--primary)" : "var(--text-main)",
                    border: reason === r.id ? "1px solid var(--primary)" : "1px solid var(--border-col)",
                  }}
                  data-testid={`${tid}-reason-${r.id}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value.slice(0, 500))}
              placeholder="Optional details (max 500 chars)…"
              className="or-input w-full"
              style={{ minHeight: 70 }}
              data-testid={`${tid}-detail`}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setOpen(false)} className="or-btn or-btn-ghost" data-testid={`${tid}-cancel`}>Cancel</button>
              <button onClick={submit} className="or-btn" disabled={busy} data-testid={`${tid}-submit`}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Flag size={13} />} Submit report
              </button>
            </div>
            {msg && (
              <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }} data-testid={`${tid}-msg`}>{msg}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
