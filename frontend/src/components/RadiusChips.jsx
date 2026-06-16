/**
 * Small chip group for Phase-2 radius surfacing on Discover & Friends
 * search. Exactly one chip can be active; tapping the active chip again
 * deselects (resulting "Any" state — no radius). Selection state is
 * persisted via the `storageKey` prop so it survives in-app navigation.
 *
 * The component is purely UI — it owns its persistence and emits the
 * current value via `onChange`. Wire the value into the search API call
 * at the parent.
 */
import React, { useEffect, useState } from "react";

export const DISCOVERY_RADII = ["5", "10", "25", "50"];

export default function RadiusChips({
  value,
  onChange,
  storageKey,
  testidPrefix = "radius",
  options = DISCOVERY_RADII,
  className = "",
}) {
  const [current, setCurrent] = useState(() => {
    if (value !== undefined) return value;
    if (storageKey) {
      try { return localStorage.getItem(storageKey) || ""; } catch { /* ignore */ }
    }
    return "";
  });
  // Keep parent-controlled mode in sync if `value` becomes controlled.
  useEffect(() => { if (value !== undefined) setCurrent(value); }, [value]);
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, current || ""); } catch { /* ignore */ }
  }, [current, storageKey]);

  const set = (next) => {
    setCurrent(next);
    onChange?.(next);
  };
  const toggle = (id) => set(current === id ? "" : id);

  return (
    <div className={`flex items-center gap-2 overflow-x-auto no-scrollbar ${className}`} data-testid={`${testidPrefix}-bar`}>
      <span className="text-[11px] uppercase tracking-wider shrink-0" style={{ color: "var(--text-muted)" }}>Radius</span>
      {options.map((id) => (
        <button
          key={id}
          type="button"
          className="or-chip shrink-0"
          data-active={current === id}
          aria-pressed={current === id}
          onClick={() => toggle(id)}
          data-testid={`${testidPrefix}-${id}`}
        >
          {id} mi
        </button>
      ))}
    </div>
  );
}
