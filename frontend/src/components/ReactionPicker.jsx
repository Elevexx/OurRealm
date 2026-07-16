/**
 * ReactionPicker — emoji reaction grid that appears near a tapped
 * message. Click the same emoji you've already picked to remove it;
 * click a different one to replace. Rendered through a body portal with
 * fixed positioning so chat headers / scroll containers never clip it.
 *
 * Fire Power is a separate control and is intentionally NOT in this grid.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REACTION_CATEGORIES } from "@/lib/reactions";

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
  const anchorRef = useRef(null);
  const [pos, setPos] = useState(null);

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

  // Measure the in-place anchor, then clamp inside the viewport so the
  // panel never hides behind sticky bars or the bottom nav.
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const W = Math.min(window.innerWidth * 0.92, 320);
    const H = Math.min(window.innerHeight * 0.5, 320);
    let left = align === "right" ? r.right - W
      : align === "center" ? r.left + r.width / 2 - W / 2
      : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    let top = position === "above" ? r.top - H - 8 : r.bottom + 8;
    top = Math.max(8, Math.min(top, window.innerHeight - H - 76));
    setPos({ left, top, width: W, maxHeight: H });
  }, [open, align, position]);

  const anchor = (
    <span ref={anchorRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true" />
  );
  if (!open) return anchor;

  return (
    <>
      {anchor}
      {pos && createPortal(
        <div
          ref={ref}
          style={{
            position: "fixed",
            zIndex: 400,
            left: pos.left,
            top: pos.top,
            width: pos.width,
            maxHeight: pos.maxHeight,
            background: "var(--or-surface-2, rgba(20,30,40,0.96))",
            border: "1px solid var(--border-col)",
            borderRadius: 16,
            padding: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,255,140,0.08)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            overflowY: "auto",
            overflowX: "hidden",
          }}
          data-testid={`${testIdPrefix}-popover`}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          role="menu"
          aria-label="React with an emoji"
        >
          {REACTION_CATEGORIES.map((cat) => (
            <div key={cat.label} className="mb-1 last:mb-0">
              <div
                style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
                         color: "var(--text-muted)", padding: "2px 4px 1px" }}
                aria-hidden="true"
              >
                {cat.label}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                {cat.emojis.map((emoji) => {
              const isMine = myReaction === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick?.(emoji);
                    onClose?.();
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
                    fontSize: 19,
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
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
