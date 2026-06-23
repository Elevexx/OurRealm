/**
 * MessageActionMenu — owner-only Edit / Delete / Cancel popup for DM
 * messages. Mirrors `PostManagementMenu`:
 *   • Portal-mounted to document.body so it never gets clipped by the
 *     chat scroll container or a fixed overlay.
 *   • Mobile (<640px): centered bottom sheet above the iOS home indicator.
 *   • Desktop (≥640px): popover anchored just below the message bubble.
 *   • Backdrop + Esc + window-resize all close the menu.
 *
 * Triggered by tap OR long-press on an owned message bubble (the parent
 * handles the gesture and calls `onOpen`).
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Edit3, Trash2, X, Loader2, Pin, PinOff, AlertTriangle } from "lucide-react";

export default function MessageActionMenu({
  open,
  anchorRect,         // DOMRect of the message bubble (for desktop popover)
  busy,
  onEdit,
  onDelete,
  onPin,              // optional — when provided, Pin/Unpin button is shown
  isPinned = false,
  onClose,
  testid,
  editTestid,
  deleteTestid,
  cancelTestid,
}) {
  // Two-step delete: first the menu, then a typed-confirm dialog.
  // Per spec, the user MUST type the word `delete` (case-insensitive,
  // trimmed) before the destructive action becomes enabled.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Close on Esc / window resize. Effect always runs; gate is `open`.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (confirmOpen) { setConfirmOpen(false); setConfirmText(""); }
        else onClose();
      }
    };
    const onResize = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose, confirmOpen]);

  // Reset the typed confirm whenever the menu re-opens for a new message.
  useEffect(() => {
    if (!open) { setConfirmOpen(false); setConfirmText(""); }
  }, [open]);

  if (!open) return null;

  const tid = testid || "dm-actions";
  const editTid = editTestid || `${tid}-edit`;
  const deleteTid = deleteTestid || `${tid}-delete`;
  const cancelTid = cancelTestid || `${tid}-cancel`;

  // Desktop anchor: pin just below the bubble, right-aligned. Falls back
  // to centred-near-top if no rect is available.
  const desktopStyle = anchorRect
    ? {
        position: "fixed",
        top: Math.min(anchorRect.bottom + 6, window.innerHeight - 220),
        right: Math.max(12, window.innerWidth - anchorRect.right),
      }
    : { position: "fixed", top: 80, right: 24 };

  const renderMenu = (idScope) => (
    <>
      <div
        className="text-[10px] uppercase tracking-widest mb-2"
        style={{ color: "var(--text-muted)" }}
        data-testid={`${idScope}-title`}
      >
        Message actions
      </div>

      {onEdit && (
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="w-full text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-3 py-2.5 mb-2"
          style={{
            borderRadius: 6,
            background: "color-mix(in srgb, var(--primary) 18%, transparent)",
            color: "var(--primary)",
            border: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)",
            opacity: busy ? 0.6 : 1,
          }}
          data-testid={idScope === tid ? editTid : `${idScope}-edit`}
        >
          <Edit3 size={11} /> Edit
        </button>
      )}

      {onPin && (
        <button
          type="button"
          disabled={busy}
          onClick={onPin}
          className="w-full text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-3 py-2.5 mb-2"
          style={{
            borderRadius: 6,
            background: "color-mix(in srgb, var(--brand-green) 16%, transparent)",
            color: "var(--brand-green)",
            border: "1px solid color-mix(in srgb, var(--brand-green) 35%, transparent)",
            opacity: busy ? 0.6 : 1,
          }}
          data-testid={`${idScope}-pin`}
        >
          {isPinned ? <PinOff size={11} /> : <Pin size={11} />} {isPinned ? "Unpin" : "Pin"}
        </button>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          // Individual message delete — instant. The previous "type delete"
          // confirmation flow was misapplied to single messages and has been
          // removed per the Feb 2026 UX correction. The type-delete pattern
          // remains in use for WHOLE-conversation deletion on the Messages
          // list (a much more destructive action).
          if (busy) return;
          onDelete();
          onClose?.();
        }}
        className="w-full text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-3 py-2.5"
        style={{
          borderRadius: 6,
          background: "color-mix(in srgb, #FF3F5A 16%, transparent)",
          color: "#FF8080",
          border: "1px solid color-mix(in srgb, #FF3F5A 35%, transparent)",
          opacity: busy ? 0.6 : 1,
        }}
        data-testid={idScope === tid ? deleteTid : `${idScope}-delete`}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete
      </button>

      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-col)" }}>
        <button
          type="button"
          onClick={onClose}
          className="w-full text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-3 py-2.5"
          style={{
            borderRadius: 6,
            background: "transparent",
            color: "var(--text-main)",
            border: "1px solid var(--border-col)",
          }}
          data-testid={idScope === tid ? cancelTid : `${idScope}-cancel`}
        >
          Cancel
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute -top-2 -right-2 rounded-full"
        style={{
          width: 22, height: 22, background: "var(--surface-2)",
          border: "1px solid var(--border-col)", color: "var(--text-muted)",
        }}
        aria-label="Close menu"
        data-testid={`${idScope}-close`}
      >
        <X size={12} style={{ margin: "0 auto" }} />
      </button>
    </>
  );

  const deleteEnabled = confirmText.trim().toLowerCase() === "delete";

  const renderConfirm = () => (
    <div
      className="or-surface"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 10000,
        width: "min(420px, calc(100vw - 32px))",
        padding: 18,
        background: "var(--surface)",
        border: "1px solid color-mix(in srgb, #FF3F5A 45%, var(--border-col))",
        boxShadow: "0 22px 50px rgba(0,0,0,0.6)",
      }}
      data-testid={`${tid}-delete-confirm`}
    >
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle size={18} style={{ color: "#FF8080", flexShrink: 0, marginTop: 2 }} />
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--text-main)" }}>
            Delete this message?
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            This is permanent. The message is removed from this conversation and cannot be restored. To confirm, type <b style={{ color: "#FF8080" }}>delete</b> below.
          </div>
        </div>
      </div>
      <input
        className="or-input w-full mt-2 text-sm"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder='Type "delete" to confirm'
        autoFocus
        data-testid={`${tid}-delete-confirm-input`}
      />
      <div className="flex justify-end gap-2 mt-3">
        <button
          type="button"
          className="or-chip"
          onClick={() => { setConfirmOpen(false); setConfirmText(""); }}
          data-testid={`${tid}-delete-confirm-cancel`}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!deleteEnabled || busy}
          onClick={() => {
            if (!deleteEnabled) return;
            setConfirmOpen(false);
            setConfirmText("");
            onDelete();
          }}
          className="or-btn"
          style={{
            background: deleteEnabled ? "#FF3F5A" : "color-mix(in srgb, #FF3F5A 30%, transparent)",
            color: "#fff",
            cursor: deleteEnabled ? "pointer" : "not-allowed",
            opacity: deleteEnabled ? 1 : 0.5,
            padding: "0.45rem 0.9rem",
          }}
          data-testid={`${tid}-delete-confirm-go`}
        >
          {busy ? <Loader2 size={12} className="inline animate-spin" /> : <Trash2 size={12} />} Delete
        </button>
      </div>
    </div>
  );

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", zIndex: 9998 }}
        onClick={onClose}
        data-testid={`${tid}-backdrop`}
      />

      {/* Mobile bottom sheet (<640px) */}
      <div
        className="or-surface sm:hidden"
        style={{
          position: "fixed",
          left: 16,
          right: 16,
          bottom: "calc(88px + env(safe-area-inset-bottom))",
          width: "auto",
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "70vh",
          overflowY: "auto",
          overflowX: "hidden",
          boxSizing: "border-box",
          zIndex: 9999,
          padding: 14,
          background: "var(--surface)",
          border: "1px solid var(--border-col)",
          boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid={tid}
      >
        {renderMenu(tid)}
      </div>

      {/* Desktop popover (≥640px) */}
      <div
        className="or-surface hidden sm:block"
        style={{
          ...desktopStyle,
          width: 220,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "70vh",
          overflowY: "auto",
          overflowX: "hidden",
          boxSizing: "border-box",
          zIndex: 9999,
          padding: 12,
          background: "var(--surface)",
          border: "1px solid var(--border-col)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid={`${tid}-desktop`}
      >
        {renderMenu(`${tid}-desktop`)}
      </div>

      {/* Typed-confirm dialog was removed for individual-message delete
          (instant delete is the correct UX). The component is kept as a
          shared utility for the Messages list whole-conversation delete
          — wired up there directly, not through this menu. */}
    </>,
    document.body,
  );
}
