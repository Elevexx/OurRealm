/**
 * Shared accordion header for ALL progression sections (Progress Card,
 * Progression Badges). One implementation — identical typography, height,
 * padding, arrow, animation, and a11y everywhere.
 */
import React from "react";
import { ChevronDown } from "lucide-react";

// Survives remounts during in-page navigation; cleared on full page load.
const memory = new Map();

export function useAccordionState(key, initial = true) {
  const [open, setOpenState] = React.useState(() =>
    memory.has(key) ? memory.get(key) : initial);
  const setOpen = React.useCallback((v) => {
    setOpenState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      memory.set(key, next);
      return next;
    });
  }, [key]);
  return [open, setOpen];
}

export function CollapsibleHeader({ icon, title, right, expanded, onToggle,
  testid, titleTestid, arrowTestid }) {
  return (
    <button type="button"
      className="w-full flex items-center gap-2 flex-wrap text-left"
      style={{ minHeight: 44 }}
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${title} — ${expanded ? "collapse" : "expand"}`}
      data-testid={testid}>
      {icon}
      <h3 className="font-semibold text-sm flex-1" style={{ color: "var(--text-main)" }}
        data-testid={titleTestid}>{title}</h3>
      {right}
      <span className="starbar-icon" style={{ width: 30, height: 30 }} aria-hidden="true"
        data-testid={arrowTestid}>
        <ChevronDown size={14}
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.25s ease" }} />
      </span>
    </button>
  );
}
