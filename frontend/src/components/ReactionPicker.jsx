/**
 * ReactionPicker — the horizontal emoji bar that appears below a
 * tapped message/comment/post. Click the same emoji you've already
 * picked to remove it; click a different one to replace.
 *
 * Tap-outside-to-close and Esc-to-close are handled by the parent via
 * the `open` prop. The picker stops propagation on its own clicks so
 * the outside-click handler doesn't fire when the user is interacting.
 *
 * Styling: rounded surface, brand-aware colours via CSS vars. Works on
 * mobile (44px tap targets) and desktop alike. The bar is absolutely
 * positioned relative to its `Anchor` parent — make sure the parent
 * has `position: relative`.
 */
import React, { useEffect, useRef } from "react";
import { ALLOWED_EMOJIS } from "@/lib/reactions";

export default function ReactionPicker({
  open,
  myReaction,
  onPick,
  onClose,
  align = "left", // 'left' | 'right' | 'center'
  position = "below", // 'below' | 'above'
  testIdPrefix = "reaction-picker",
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const alignStyle =
    align === "right" ? { right: 0 } :
    align === "center" ? { left: "50%", transform: "translateX(-50%)" } :
    { left: 0 };
  const verticalStyle = position === "above"
    ? { bottom: "calc(100% + 6px)" }
    : { top: "calc(100% + 6px)" };

  return (
    <div
      ref={ref}
      className="absolute z-50"
      style={{
        ...alignStyle,
        ...verticalStyle,
        background: "var(--or-surface-2, rgba(20,30,40,0.96))",
        border: "1px solid var(--border-col)",
        borderRadius: 999,
        padding: "6px 8px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,255,140,0.08)",
        display: "flex",
        gap: 4,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        maxWidth: "min(92vw, 360px)",
        flexWrap: "nowrap",
      }}
      data-testid={`${testIdPrefix}-popover`}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      role="menu"
      aria-label="React with an emoji"
    >
      {ALLOWED_EMOJIS.map((emoji) => {
        const isMine = myReaction === emoji;
        return (
          <button
            key={emoji}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPick?.(emoji);
            }}
            data-testid={`${testIdPrefix}-${emoji}`}
            aria-label={`React with ${emoji}`}
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: isMine ? "rgba(0,255,140,0.18)" : "transparent",
              border: isMine ? "1px solid rgba(0,255,140,0.65)" : "1px solid transparent",
              fontSize: 20,
              lineHeight: 1,
              cursor: "pointer",
              transition: "transform 120ms ease, background 120ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.18)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}
