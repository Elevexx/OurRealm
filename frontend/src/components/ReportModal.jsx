/**
 * ReportModal — universal report flow (Phase 4).
 *
 * Used to flag a profile, post, comment, reply, or message. Submits to
 * POST /api/reports which (a) records the report, (b) opens a support
 * ticket and routes it into /admin/support, and (c) auto-DMs the
 * reporter from @support confirming the ticket number.
 *
 * Privacy notes:
 *   • For target_type='message' we send ONLY the conversation id and
 *     message id as metadata — never the message text. Admins see the
 *     uploaded screenshots and the reporter's description.
 *   • Screenshots are explicit uploads by the reporter (max 8). Nothing
 *     is auto-captured.
 *
 * Public API:
 *   <ReportModal open targetType targetId targetMeta? onClose onSubmitted? />
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Flag, Loader2, Plus, Trash2, Image as ImageIcon } from "lucide-react";
import apiClient from "@/api/client";
import ImageUploadPicker, { absoluteImageUrl } from "@/components/ImageUploadPicker";

// IDs MUST match backend USER_REPORT_REASONS in routers/moderation.py.
const REASONS = [
  { id: "spam",            label: "Spam" },
  { id: "harassment",      label: "Harassment" },
  { id: "hate_speech",     label: "Hate speech" },
  { id: "sexual_content",  label: "Sexual content" },
  { id: "self_harm",       label: "Self-harm" },
  { id: "violence",        label: "Violence" },
  { id: "misinformation",  label: "Misinformation" },
  { id: "scam_fraud",      label: "Scam / Fraud" },
  { id: "impersonation",   label: "Impersonation" },
  { id: "privacy_concern", label: "Privacy concern" },
  { id: "other",           label: "Other" },
];

const TARGET_LABELS = {
  profile: "this profile",
  post:    "this post",
  comment: "this comment",
  reply:   "this reply",
  message: "this message",
};

const MAX_SHOTS = 8;

export default function ReportModal({
  open,
  targetType,
  targetId,
  targetMeta,        // optional: passed through to backend as `detail` prefix
  onClose,
  onSubmitted,
  testid = "report-modal",
}) {
  const [reason, setReason] = useState(null);
  const [description, setDescription] = useState("");
  const [shots, setShots] = useState([]); // [{id, url, thumbnailUrl}]
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset every time the modal opens.
    setReason(null); setDescription(""); setShots([]); setBusy(false);
    setMsg(""); setDone(false); setPickerOpen(false);
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!reason) { setMsg("Pick a reason first."); return; }
    setBusy(true); setMsg("");
    try {
      const payload = {
        content_type: targetType,
        content_id:   targetId,
        reason,
        detail:       description.trim() ? description.trim().slice(0, 500) : undefined,
        screenshots:  shots.map((s) => s.id).filter(Boolean).slice(0, MAX_SHOTS),
      };
      const { data } = await apiClient.post("/reports", payload);
      if (data?.duplicate) {
        setMsg(`You've already reported this. Ticket #${data?.ticket?.ticket_number ?? "—"} is open.`);
      } else {
        setMsg(`Thanks — support ticket #${data?.ticket?.ticket_number} opened.`);
      }
      setDone(true);
      onSubmitted?.(data);
      setTimeout(() => onClose?.(), 1400);
    } catch (e) {
      setMsg(e?.response?.data?.detail || "Could not submit report.");
    } finally {
      setBusy(false);
    }
  };

  const removeShot = (id) => setShots((arr) => arr.filter((s) => s.id !== id));

  const addShot = (picked) => {
    const img = picked?.image || {};
    if (!img.id || !img.original_url) return;
    setShots((arr) => [...arr, {
      id:           img.id,
      url:          absoluteImageUrl(img.original_url),
      thumbnailUrl: absoluteImageUrl(img.thumbnail_url || img.original_url),
    }].slice(0, MAX_SHOTS));
  };

  return createPortal(
    <>
      <div
        className="or-modal-shell z-[210]"
        style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
        onClick={() => !busy && onClose?.()}
        data-testid={`${testid}-overlay`}
      >
        <div
          className="or-surface or-modal-card"
          onClick={(e) => e.stopPropagation()}
          data-testid={testid}
          role="dialog"
          aria-modal="true"
        >
          <div className="or-modal-header flex items-center justify-between p-4" style={{ borderBottom: "1px solid var(--border-col)" }}>
            <div className="flex items-center gap-2">
              <Flag size={16} style={{ color: "#FF6B6B" }} />
              <h3 className="text-base" style={{ fontFamily: "var(--font-display)" }}>
                Report {TARGET_LABELS[targetType] || "this"}
              </h3>
            </div>
            <button onClick={onClose} className="starbar-icon" style={{ width: 32, height: 32 }} data-testid={`${testid}-close`} aria-label="Close"><X size={14} /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 or-modal-body">
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
                Reason <span style={{ color: "#FF6B6B" }}>*</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
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
                    data-testid={`${testid}-reason-${r.id}`}
                    aria-pressed={reason === r.id}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
                Description (optional)
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Add helpful context (max 500 chars)…"
                className="or-input w-full"
                style={{ minHeight: 70 }}
                data-testid={`${testid}-description`}
              />
              <div className="text-[10px] text-right mt-1" style={{ color: "var(--text-muted)" }}>
                {description.length}/500
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  Screenshots ({shots.length}/{MAX_SHOTS})
                </div>
                <button
                  type="button"
                  className="or-chip"
                  onClick={() => setPickerOpen(true)}
                  disabled={shots.length >= MAX_SHOTS || busy}
                  data-testid={`${testid}-add-screenshot`}
                >
                  <Plus size={12} /> Add image
                </button>
              </div>
              {shots.length === 0 ? (
                <div
                  className="or-surface p-3 text-xs flex items-center gap-2"
                  style={{ color: "var(--text-muted)" }}
                  data-testid={`${testid}-no-screenshots`}
                >
                  <ImageIcon size={14} /> Optional. Add up to {MAX_SHOTS} images as evidence.
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2" data-testid={`${testid}-screenshot-grid`}>
                  {shots.map((s) => (
                    <div key={s.id} className="relative" data-testid={`${testid}-screenshot-${s.id}`}>
                      <img
                        src={s.thumbnailUrl || s.url}
                        alt=""
                        className="w-full h-20 object-cover rounded"
                        style={{ border: "1px solid var(--border-col)" }}
                      />
                      <button
                        type="button"
                        onClick={() => removeShot(s.id)}
                        className="absolute -top-1.5 -right-1.5 rounded-full"
                        style={{
                          width: 22, height: 22,
                          background: "var(--surface-2)",
                          border: "1px solid var(--border-col)",
                          color: "#FF8080",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                        data-testid={`${testid}-remove-${s.id}`}
                        aria-label="Remove screenshot"
                      ><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {targetType === "message" && (
              <div
                className="text-[11px] p-2.5 rounded"
                style={{
                  background: "color-mix(in srgb, var(--primary) 10%, transparent)",
                  color: "var(--text-muted)",
                  border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)",
                }}
                data-testid={`${testid}-privacy-notice`}
              >
                Your private conversation is never shared with admins. Only the screenshots you attach here and the description you write are visible to the support team.
              </div>
            )}
          </div>

          <div className="p-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border-col)" }}>
            {msg && (
              <div className="text-xs flex-1 truncate" style={{ color: done ? "var(--primary)" : "var(--text-muted)" }} data-testid={`${testid}-msg`}>
                {msg}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="or-btn or-btn-ghost"
              data-testid={`${testid}-cancel`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !reason || done}
              className="or-btn"
              data-testid={`${testid}-submit`}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Flag size={13} />} Submit report
            </button>
          </div>
        </div>
      </div>

      <ImageUploadPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPicked={addShot}
        title="Attach screenshot"
        testid={`${testid}-img-picker`}
      />
    </>,
    document.body,
  );
}
