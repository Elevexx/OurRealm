/**
 * ReactionBar — the inline summary chips shown under a message/comment.
 *
 *   • One chip per distinct emoji used on this target.
 *   • The chip shows `<emoji> <count>`; count hides when 1 and the
 *     viewer is the only reactor (clean look for solo reactions).
 *   • Clicking a chip toggles the viewer's reaction (same UX as the
 *     picker — tap your own emoji to remove, tap a different one to
 *     replace).
 *   • If `summary` is empty the component renders nothing, so callers
 *     can drop it unconditionally next to message bodies.
 */
import React from "react";

export default function ReactionBar({
  summary,
  myReaction,
  onToggle,
  size = "sm",      // 'xs' | 'sm' | 'md'
  align = "start",  // 'start' | 'end' | 'center'
  testIdPrefix = "reaction-bar",
}) {
  const list = Array.isArray(summary) ? summary : [];
  if (list.length === 0) return null;

  const dims = {
    xs: { font: 11, pad: "1px 6px", radius: 999, height: 20, gap: 3 },
    sm: { font: 12, pad: "2px 8px", radius: 999, height: 24, gap: 4 },
    md: { font: 13, pad: "3px 10px", radius: 999, height: 28, gap: 6 },
  }[size] || { font: 12, pad: "2px 8px", radius: 999, height: 24, gap: 4 };

  const justify = align === "end" ? "flex-end" : align === "center" ? "center" : "flex-start";

  return (
    <div
      className="flex flex-wrap items-center"
      style={{ gap: dims.gap, justifyContent: justify }}
      data-testid={`${testIdPrefix}-row`}
      onClick={(e) => e.stopPropagation()}
    >
      {list.map(({ emoji, count }) => {
        const mine = myReaction === emoji;
        const showCount = count > 1 || !mine;
        return (
          <button
            key={emoji}
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle?.(emoji); }}
            data-testid={`${testIdPrefix}-chip-${emoji}`}
            aria-pressed={mine}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: dims.font,
              lineHeight: 1,
              padding: dims.pad,
              height: dims.height,
              borderRadius: dims.radius,
              background: mine ? "rgba(0,255,140,0.16)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${mine ? "rgba(0,255,140,0.55)" : "var(--border-col)"}`,
              color: mine ? "rgb(140,255,200)" : "var(--text-main)",
              cursor: "pointer",
              userSelect: "none",
              transition: "background 120ms ease, border-color 120ms ease",
            }}
            title={mine ? "Tap to remove your reaction" : `React with ${emoji}`}
          >
            <span style={{ fontSize: dims.font + 2, lineHeight: 1 }}>{emoji}</span>
            {showCount && <span style={{ fontWeight: 600 }}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
