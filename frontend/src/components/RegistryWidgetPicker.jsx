/**
 * RegistryWidgetPicker — shared multi-select picker for ALL surfaces
 * (profile / home / realm). Pulls /api/widgets/available?placement=X
 * (live + access_group filtered), shows the admin-only disabled
 * banner if any widget is hidden, and calls onPickMany(items) with
 * the chosen registry rows. Two independent AbortController effects
 * so `viewer` hydration can't race the fetches (the race that broke
 * iter 44).
 */
import React, { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { WIDGET_TYPES } from "@/data/mockData";

export default function RegistryWidgetPicker({ open, onClose, onPickMany, viewer, placement = "profile" }) {
  const [selected, setSelected] = useState(new Set());
  const [available, setAvailable] = useState(null);
  const [disabledKeys, setDisabledKeys] = useState(new Set());

  useEffect(() => { if (!open) setSelected(new Set()); }, [open]);

  // Effect #1 — live registry for this placement.
  useEffect(() => {
    if (!open) return undefined;
    const ctrl = new AbortController();
    (async () => {
      try {
        const { data } = await apiClient.get(
          `/widgets/available?placement=${placement}`,
          { signal: ctrl.signal },
        );
        const reg = (data?.widgets || []).map((w) => ({
          id: w.key, label: w.name, icon: w.icon, default_size: w.default_size,
        }));
        setAvailable(reg.length ? reg : (placement === "profile" ? WIDGET_TYPES : []));
      } catch (e) {
        if (e?.name !== "CanceledError" && e?.name !== "AbortError") {
          setAvailable(placement === "profile" ? WIDGET_TYPES : []);
        }
      }
    })();
    return () => ctrl.abort();
  }, [open, placement]);

  // Effect #2 — admin-only disabled-keys banner.
  useEffect(() => {
    if (!open || !viewer) return undefined;
    const role = viewer?.role || "";
    const isAdmin = role === "admin" || role === "founder"
      || viewer?.is_admin || viewer?.username === "stealth";
    if (!isAdmin) return undefined;
    const ctrl = new AbortController();
    (async () => {
      try {
        const { data } = await apiClient.get("/widgets/disabled", { signal: ctrl.signal });
        setDisabledKeys(new Set((data?.keys || []).map((k) => k.key)));
      } catch { /* */ }
    })();
    return () => ctrl.abort();
  }, [open, viewer]);

  if (!open) return null;
  const types = available || [];

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const save = () => {
    const items = types.filter((w) => selected.has(w.id));
    if (items.length) onPickMany(items);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid={`registry-picker-${placement}`}
    >
      <div className="or-surface w-full max-w-3xl p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Widget Library</h3>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              Placement: <b style={{ color: "var(--primary)" }}>{placement}</b> · tap to select multiple, then Save.
            </div>
          </div>
          <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={onClose}>
            <Icons.X size={16} />
          </button>
        </div>
        {disabledKeys.size > 0 && (
          <div
            className="text-[11px] mb-3 px-3 py-2 rounded"
            style={{ background: "rgba(255,90,107,0.14)", color: "#FF8080" }}
            data-testid={`registry-picker-${placement}-disabled-banner`}
          >
            {disabledKeys.size} widget{disabledKeys.size === 1 ? "" : "s"} currently disabled by an admin and hidden from this picker. Manage at /admin/widgets.
          </div>
        )}
        {types.length === 0 ? (
          <div className="or-surface p-6 text-center text-sm" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
            No widgets are available for the <b>{placement}</b> placement yet. Ask an admin to enable some at /admin/widgets.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {types.map((w) => {
              const Icon = Icons[w.icon] || Icons.Sparkles;
              const isSelected = selected.has(w.id);
              return (
                <button
                  key={w.id}
                  data-testid={`registry-picker-${placement}-tile-${w.id}`}
                  data-selected={isSelected ? "true" : "false"}
                  aria-pressed={isSelected}
                  onClick={() => toggle(w.id)}
                  className="or-surface p-4 text-left transition-transform hover:-translate-y-0.5 relative"
                  style={{ background: "var(--surface-2)", outline: isSelected ? "2px solid var(--primary)" : "none" }}
                >
                  {isSelected && <Icons.Check size={14} className="absolute top-2 right-2" style={{ color: "var(--primary)" }} />}
                  <Icon size={20} style={{ color: "var(--primary)" }} />
                  <div className="mt-2 font-semibold text-sm" style={{ color: "var(--text-main)" }}>{w.label}</div>
                  <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-muted)" }}>{w.default_size}</div>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button className="or-btn or-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="or-btn or-btn-primary"
            onClick={save}
            disabled={selected.size === 0}
            data-testid={`registry-picker-${placement}-save`}
            style={{ opacity: selected.size === 0 ? 0.5 : 1 }}
          >
            <Icons.Plus size={14} /> Add {selected.size > 0 ? `${selected.size} widget${selected.size === 1 ? "" : "s"}` : "selected"}
          </button>
        </div>
      </div>
    </div>
  );
}
