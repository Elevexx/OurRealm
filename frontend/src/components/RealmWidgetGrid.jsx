/**
 * RealmWidgetGrid — admin-aware grid with explicit per-widget size
 * controls.
 *
 * Edit-mode contract:
 *   • When `editMode` is FALSE, NO size controls or drag handles are
 *     visible — the grid renders read-only.
 *   • When `editMode` is TRUE (admin only), each tile gets a row of
 *     four size buttons [S | M | L | XL] and a drag handle for
 *     re-ordering. The currently-active size is highlighted via
 *     `data-active="true"`. Tapping a size button immediately PATCHes
 *     the new value and the grid reflows.
 *
 * Layout invariants (mobile-first, no horizontal overflow):
 *   • Every widget always occupies exactly ONE column. Sizes only
 *     change the VERTICAL row span so widgets never extend past the
 *     viewport width on 320–430px screens.
 *   • Grid uses `repeat(auto-fit, minmax(min(280px, 100%), 1fr))` so
 *     a single widget can shrink below 280px on tiny viewports
 *     without spilling out.
 *   • Saved size preferences (including legacy "wide" / "tall" values)
 *     are preserved and rendered as their nearest modern equivalent.
 *
 * Reorder uses native HTML5 drag/drop on the drag handle. Final order
 * is persisted via POST /api/communities/realm/:id/widgets/reorder.
 */
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Settings, Trash2, Loader2 } from "lucide-react";
import apiClient from "@/api/client";
import RealmWidgetSettingsModal from "@/components/RealmWidgetSettingsModal";

// Only these four sizes are user-selectable.
const SIZES = ["small", "medium", "large", "xl"];

// All sizes pin to 1 column → vertical-only growth.
const SIZE_SPAN = {
  small:  { col: "span 1", row: "span 1" },
  medium: { col: "span 1", row: "span 2" },
  large:  { col: "span 1", row: "span 3" },
  xl:     { col: "span 1", row: "span 4" },
  // Legacy back-compat (read-only mappings, never re-saved):
  wide:   { col: "span 1", row: "span 3" },
  tall:   { col: "span 1", row: "span 4" },
};

const SIZE_LABEL = { small: "S", medium: "M", large: "L", xl: "XL" };

// Returns the current size normalised into the modern S/M/L/XL set,
// so legacy "wide" / "tall" widgets highlight a sensible button.
const normalised = (s) => {
  if (SIZES.includes(s)) return s;
  if (s === "wide") return "large";
  if (s === "tall") return "xl";
  return "medium";
};

export default function RealmWidgetGrid({
  realmId,
  widgets,
  isAdmin,
  editMode = false,        // NEW — controls visibility of resize/drag handles
  renderWidget,
  onChanged,
  onDeleted,               // NEW — called with widget id after a successful DELETE
}) {
  const [order, setOrder] = useState(widgets);
  const [dragId, setDragId] = useState(null);
  // Pending portal-mounted modals — settings editor + delete confirm.
  // Both escape the grid's transform/overflow via createPortal.
  const [editingWidget, setEditingWidget] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Keep `order` in sync if the parent's widgets list mutates from
  // upstream (e.g. WS layout broadcast).
  React.useEffect(() => { setOrder(widgets); }, [widgets]);

  const sorted = useMemo(() => order, [order]);
  const showControls = isAdmin && editMode;

  const onDragStart = (e, w) => {
    if (!showControls) return;
    setDragId(w.id);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", w.id); } catch { /* */ }
  };
  const onDragOver = (e) => { if (showControls) e.preventDefault(); };
  const onDrop = (e, target) => {
    if (!showControls || !dragId || dragId === target.id) return;
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

  const setSize = async (w, size) => {
    if (!SIZES.includes(size)) return;
    if (normalised(w.size) === size) return;   // no-op on same size
    try {
      const { data } = await apiClient.patch(
        `/communities/realm/${realmId}/widgets/${w.id}`,
        { size },
      );
      onChanged && onChanged(data);
    } catch { /* */ }
  };

  // ── Delete confirmation flow ─────────────────────────────────────
  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiClient.delete(
        `/communities/realm/${realmId}/widgets/${pendingDelete.id}`,
      );
      onDeleted && onDeleted(pendingDelete.id);
      setOrder((prev) => prev.filter((x) => x.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch { /* keep modal open on failure */ }
    finally { setDeleteBusy(false); }
  };

  return (
    <>
    <div
      className="grid gap-4 mt-5"
      style={{
        // minmax(min(280px, 100%), 1fr) prevents a 280px min-width
        // from forcing a horizontal scroll on viewports < 296px,
        // while still letting desktops grow to multiple columns.
        gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
        gridAutoRows: "minmax(110px, auto)",
        maxWidth: "100%",
      }}
      data-testid="realm-widgets-grid"
    >
      {sorted.map((w) => {
        const activeSize = normalised(w.size);
        const span = SIZE_SPAN[w.size || "medium"] || SIZE_SPAN.medium;
        return (
          <div
            key={w.id}
            className="relative min-w-0"
            style={{ gridColumn: span.col, gridRow: span.row, opacity: dragId === w.id ? 0.5 : 1 }}
            draggable={showControls}
            onDragStart={(e) => onDragStart(e, w)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, w)}
            data-testid={`realm-widget-tile-${w.id}`}
          >
            {showControls && (
              <div
                className="absolute -top-1 -right-1 z-10 flex gap-1 flex-wrap justify-end"
                data-testid={`realm-widget-controls-${w.id}`}
                style={{ maxWidth: "100%" }}
              >
                {SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(w, s)}
                    className="or-chip"
                    data-active={activeSize === s}
                    data-testid={`realm-widget-size-${s}-${w.id}`}
                    title={`Set size: ${SIZE_LABEL[s]}`}
                    aria-pressed={activeSize === s}
                    aria-label={`Set widget size to ${SIZE_LABEL[s]}`}
                    style={{
                      touchAction: "manipulation",
                      minHeight: 28,
                      minWidth: 28,
                      fontWeight: activeSize === s ? 800 : 600,
                    }}
                  >
                    {SIZE_LABEL[s]}
                  </button>
                ))}
                <span
                  className="or-chip cursor-grab"
                  title="Drag to reorder"
                  data-testid={`realm-widget-drag-${w.id}`}
                  style={{ touchAction: "none", minHeight: 28, minWidth: 28 }}
                >
                  <GripVertical size={11} />
                </span>
                <button
                  onClick={() => setEditingWidget(w)}
                  className="or-chip"
                  title="Edit widget settings"
                  aria-label="Edit widget settings"
                  data-testid={`realm-widget-edit-${w.id}`}
                  style={{ touchAction: "manipulation", minHeight: 28, minWidth: 28 }}
                >
                  <Settings size={11} />
                </button>
                <button
                  onClick={() => setPendingDelete(w)}
                  className="or-chip"
                  title="Remove widget from this realm"
                  aria-label="Remove widget from this realm"
                  data-testid={`realm-widget-delete-${w.id}`}
                  style={{
                    touchAction: "manipulation",
                    minHeight: 28,
                    minWidth: 28,
                    color: "var(--danger, #FF8080)",
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}
            {renderWidget(w)}
          </div>
        );
      })}
    </div>

    {/* Settings editor — portal-mounted so it escapes the grid's
        transform / overflow context. Reuses the existing widget
        registry's per-type field definitions and PATCHes `config`. */}
    {editingWidget && (
      <RealmWidgetSettingsModal
        realmId={realmId}
        widget={editingWidget}
        onClose={() => setEditingWidget(null)}
        onSaved={(updated) => onChanged && onChanged(updated)}
      />
    )}

    {/* Delete-confirmation portal modal. Keeps the spec wording
        ("Remove this widget from this Realm?") and never deletes the
        underlying widget_registry definition — DELETE is scoped to
        the `community_widgets` instance via realm_widgets.py. */}
    {pendingDelete && <DeleteConfirmModal
      widget={pendingDelete}
      busy={deleteBusy}
      onCancel={() => setPendingDelete(null)}
      onConfirm={confirmDelete}
    />}
    </>
  );
}

function DeleteConfirmModal({ widget, busy, onCancel, onConfirm }) {
  const label = widget?.config?.title || widget?.type || "widget";
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      data-testid={`realm-widget-delete-modal-${widget?.id}`}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={busy ? undefined : onCancel}
        data-testid={`realm-widget-delete-modal-backdrop-${widget?.id}`}
      />
      <div
        className="relative or-surface w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl shadow-2xl"
        style={{ maxHeight: "85vh" }}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-5">
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
            {widget?.type}
          </div>
          <div className="font-semibold mb-1.5" style={{ color: "var(--text-main)" }}>
            Remove “{label}” from this Realm?
          </div>
          <div className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            The widget will be removed from this Realm only. The widget
            definition stays in the Library and other Realms are
            unaffected.
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="or-btn-ghost"
              disabled={busy}
              data-testid={`realm-widget-delete-cancel-${widget?.id}`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="or-btn"
              disabled={busy}
              style={{ background: "var(--danger, #FF5252)", color: "#fff", borderColor: "transparent" }}
              data-testid={`realm-widget-delete-confirm-${widget?.id}`}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              <span className="ml-1">Remove</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
