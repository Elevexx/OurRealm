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
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Edit3, Trash2, X, Loader2 } from "lucide-react";

export default function MessageActionMenu({
  open,
  anchorRect,         // DOMRect of the message bubble (for desktop popover)
  busy,
  onEdit,
  onDelete,
  onClose,
  testid,
  editTestid,
  deleteTestid,
  cancelTestid,
}) {
  // Close on Esc / window resize. Effect always runs; gate is `open`.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onResize = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose]);

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

      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
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
    </>,
    document.body,
  );
}
