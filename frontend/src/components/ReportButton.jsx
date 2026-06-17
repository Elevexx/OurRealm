/**
 * ReportButton — thin wrapper around <ReportModal/>.
 *
 * Backward-compatible with the original (contentType + contentId) API.
 * New callers can also pass `targetType` / `targetId`. Both names map to
 * the same value.
 *
 * Visual:
 *   • Default — renders as `or-chip` matching the original look.
 *   • `variant="icon"` — small flag icon only (used on comment / reply
 *     rows and on message bubbles where a labelled chip would be busy).
 */
import React, { useState } from "react";
import { Flag } from "lucide-react";
import ReportModal from "@/components/ReportModal";

export default function ReportButton({
  contentType,    // legacy prop name
  contentId,      // legacy prop name
  targetType,     // new prop name
  targetId,       // new prop name
  variant = "chip",
  label = "Report",
  testid,
  className,
  style,
  title = "Report",
}) {
  const tType = targetType || contentType;
  const tId = targetId || contentId;
  const [open, setOpen] = useState(false);

  const tid = testid || `report-${tType}-${tId}`;

  const triggerProps = {
    type: "button",
    onClick: (e) => { e.stopPropagation(); setOpen(true); },
    "data-testid": `${tid}-trigger`,
    title,
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          {...triggerProps}
          className={className || "starbar-icon"}
          style={{ width: 26, height: 26, ...style }}
          aria-label={title}
        >
          <Flag size={12} />
        </button>
      ) : (
        <button {...triggerProps} className={className || "or-chip"} style={style}>
          <Flag size={12} /> {label}
        </button>
      )}

      <ReportModal
        open={open}
        targetType={tType}
        targetId={tId}
        onClose={() => setOpen(false)}
        testid={tid}
      />
    </>
  );
}
