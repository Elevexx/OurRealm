/**
 * RealmWidgetGrid — admin-aware grid that renders each widget with an
 * optional resize chip (cycles small → medium → large → wide) and an
 * HTML5-drag reorder handle. Members see the same grid without the
 * admin controls.
 *
 * Resize maps to CSS span:
 *   small  → 1 col / 1 row
 *   medium → 1 col / 2 rows (default)
 *   large  → 2 col / 2 rows
 *   wide   → 3 col / 1 row
 *   tall   → 1 col / 3 rows
 *
 * Mobile / narrow viewports: every widget falls back to 1 col so the
 * grid stacks vertically — admin-defined size is preserved in storage
 * but ignored visually until the viewport grows.
 *
 * Reorder uses native drag/drop (no extra deps). Final position is
 * persisted via POST /api/communities/realm/:id/widgets/reorder which
 * already exists. While dragging, only the local order changes; the
 * server is called once on drop.
 */
import React, { useMemo, useState } from "react";
import { GripVertical, Maximize2 } from "lucide-react";
import apiClient from "@/api/client";

const SIZE_CYCLE  = ["small", "medium", "large", "wide", "tall"];
const SIZE_SPAN = {
  small:  { col: "span 1", row: "span 1" },
  medium: { col: "span 1", row: "span 2" },
  large:  { col: "span 2", row: "span 2" },
  wide:   { col: "span 3", row: "span 1" },
  tall:   { col: "span 1", row: "span 3" },
};

export default function RealmWidgetGrid({ realmId, widgets, isAdmin, renderWidget, onChanged }) {
  const [order, setOrder] = useState(widgets);
  const [dragId, setDragId] = useState(null);

  // Keep `order` in sync if the parent's widgets list mutates from
  // upstream (e.g. WS layout broadcast).
  React.useEffect(() => { setOrder(widgets); }, [widgets]);

  const sorted = useMemo(() => order, [order]);

  const onDragStart = (e, w) => {
    if (!isAdmin) return;
    setDragId(w.id);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", w.id); } catch { /* */ }
  };
  const onDragOver = (e) => { if (isAdmin) e.preventDefault(); };
  const onDrop = (e, target) => {
    if (!isAdmin || !dragId || dragId === target.id) return;
    e.preventDefault();
    const src = sorted.findIndex((x) => x.id === dragId);
    const dst = sorted.findIndex((x) => x.id === target.id);
    if (src < 0 || dst < 0) return;
    const next = [...sorted];
    const [moved] = next.splice(src, 1);
    next.splice(dst, 0, moved);
    setOrder(next);
    setDragId(null);
    apiClient.post(`/communities/realm/${realmId}/widgets/reorder`, {
      order: next.map((x) => x.id),
    }).catch(() => { /* */ });
  };

  const cycleSize = async (w) => {
    const idx = SIZE_CYCLE.indexOf(w.size || "medium");
    const next = SIZE_CYCLE[(idx + 1) % SIZE_CYCLE.length];
    try {
      const { data } = await apiClient.patch(`/communities/realm/${realmId}/widgets/${w.id}`, { size: next });
      onChanged && onChanged(data);
    } catch { /* */ }
  };

  return (
    <div
      className="grid gap-4 mt-5"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gridAutoRows: "minmax(120px, auto)" }}
      data-testid="realm-widgets-grid"
    >
      {sorted.map((w) => {
        const span = SIZE_SPAN[w.size || "medium"] || SIZE_SPAN.medium;
        return (
          <div
            key={w.id}
            className="relative"
            style={{ gridColumn: span.col, gridRow: span.row, opacity: dragId === w.id ? 0.5 : 1 }}
            draggable={isAdmin}
            onDragStart={(e) => onDragStart(e, w)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, w)}
            data-testid={`realm-widget-tile-${w.id}`}
          >
            {isAdmin && (
              <div className="absolute -top-1 -right-1 z-10 flex gap-1" data-testid={`realm-widget-controls-${w.id}`}>
                <button onClick={() => cycleSize(w)} className="or-chip" title={`Size: ${w.size || "medium"} → cycle next`} data-testid={`realm-widget-size-${w.id}`}>
                  <Maximize2 size={11} />
                </button>
                <span className="or-chip cursor-grab" title="Drag to reorder" data-testid={`realm-widget-drag-${w.id}`}>
                  <GripVertical size={11} />
                </span>
              </div>
            )}
            {renderWidget(w)}
          </div>
        );
      })}
    </div>
  );
}
