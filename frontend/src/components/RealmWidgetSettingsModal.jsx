/**
 * RealmWidgetSettingsModal — portal-mounted settings editor for a
 * single realm widget instance. PATCHes the widget's `config` map on
 * Save and propagates the fresh server doc back to the caller via
 * `onSaved(updated)`.
 *
 * The form is registry-driven: each widget `type` maps to a small
 * `fields` array describing input shape. Unknown / future types fall
 * back to the universal `title` + `subtitle` pair, so any new widget
 * launched through the registry automatically gains a basic settings
 * editor without renderer changes.
 *
 * Mounted to `document.body` via `createPortal` so the modal escapes
 * realm-tab overflow / CSS-transformed parents (matches the pattern
 * used by `MessageActionMenu`).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Save, Loader2 } from "lucide-react";
import apiClient from "@/api/client";

// Per-type field definitions. Keep these conservative — admins can
// always reach back into the realm WidgetCreate POST for advanced
// edits. Future types automatically use DEFAULT_FIELDS.
const TYPE_FIELDS = {
  poll: [
    { key: "question", label: "Question", type: "text", placeholder: "Ask the realm…" },
    { key: "options",  label: "Options",  type: "string-list", itemPlaceholder: "Option text" },
  ],
  countdown: [
    { key: "title",       label: "Title",       type: "text" },
    { key: "target_date", label: "Target date", type: "datetime" },
  ],
  notes: [
    { key: "title", label: "Title", type: "text" },
    { key: "body",  label: "Notes", type: "textarea", rows: 6 },
  ],
  blog: [
    { key: "title", label: "Title",   type: "text" },
    { key: "body",  label: "Content", type: "textarea", rows: 10 },
  ],
  calendar: [
    { key: "title",        label: "Title",        type: "text" },
    { key: "default_view", label: "Default view", type: "select", options: ["month", "week", "day"] },
  ],
  weather: [
    { key: "title",    label: "Title",    type: "text" },
    { key: "location", label: "Location", type: "text", placeholder: "City, country" },
  ],
};

const DEFAULT_FIELDS = [
  { key: "title",    label: "Title",    type: "text" },
  { key: "subtitle", label: "Subtitle", type: "text" },
];

function fieldsFor(widget) {
  if (!widget) return DEFAULT_FIELDS;
  return TYPE_FIELDS[widget.type] || DEFAULT_FIELDS;
}

// Pull a sensible initial value from the current widget config. Polls
// store options as `[{id,text,votes}]`; we surface only the text strings
// in the editor and restitch ids/votes on Save so we never lose vote
// history when admins rename options.
function initialFor(widget, field) {
  const cfg = widget?.config || {};
  if (field.type === "string-list") {
    return (cfg[field.key] || []).map((o) => (typeof o === "string" ? o : (o?.text || "")));
  }
  return cfg[field.key] ?? "";
}

export default function RealmWidgetSettingsModal({ realmId, widget, onClose, onSaved }) {
  const fields = useMemo(() => fieldsFor(widget), [widget]);
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of fields) v[f.key] = initialFor(widget, f);
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const firstFocusRef = useRef(null);

  // Restore body scroll lock + close-on-escape
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    firstFocusRef.current?.focus?.();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const setField = (k, v) => setValues((prev) => ({ ...prev, [k]: v }));

  const buildPatchConfig = () => {
    // Start from the existing config so we don't blow away keys we
    // didn't expose in the editor (e.g. poll option ids/votes).
    const next = { ...(widget?.config || {}) };
    for (const f of fields) {
      if (f.type === "string-list") {
        const existing = (widget?.config?.[f.key] || []).filter(Boolean);
        const newTexts = (values[f.key] || []).map((s) => String(s || "").trim()).filter(Boolean);
        // Preserve ids+votes by index when possible; create new ids for
        // appended rows so the poll renderer can track votes properly.
        next[f.key] = newTexts.map((text, i) => {
          const prev = existing[i] || {};
          return {
            id:    prev.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : `o${Date.now()}${i}`),
            text,
            votes: typeof prev.votes === "number" ? prev.votes : 0,
          };
        });
      } else if (f.type === "datetime") {
        next[f.key] = values[f.key] || null;
      } else {
        next[f.key] = values[f.key] ?? "";
      }
    }
    return next;
  };

  const save = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const config = buildPatchConfig();
      const { data } = await apiClient.patch(
        `/communities/realm/${realmId}/widgets/${widget.id}`,
        { config },
      );
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Save failed");
      setBusy(false);
    }
  };

  const widgetLabel = (widget?.config?.title || widget?.type || "widget");

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      data-testid={`realm-widget-settings-modal-${widget?.id}`}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={onClose}
        data-testid={`realm-widget-settings-backdrop-${widget?.id}`}
      />
      <div
        className="relative or-surface w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden"
        style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        role="dialog"
        aria-modal="true"
      >
        <header
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-col)" }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              Edit widget · {widget?.type}
            </div>
            <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>
              {widgetLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="starbar-icon"
            style={{ width: 34, height: 34 }}
            aria-label="Close"
            data-testid={`realm-widget-settings-close-${widget?.id}`}
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-4 overflow-auto flex-1 space-y-3" style={{ minHeight: 80 }}>
          {fields.map((f, idx) => (
            <FieldRow
              key={f.key}
              field={f}
              value={values[f.key]}
              onChange={(v) => setField(f.key, v)}
              autoFocus={idx === 0}
              refEl={idx === 0 ? firstFocusRef : null}
              testid={`realm-widget-settings-field-${widget?.id}-${f.key}`}
            />
          ))}
          {err && (
            <div
              className="text-sm"
              style={{ color: "var(--danger)" }}
              data-testid={`realm-widget-settings-error-${widget?.id}`}
            >
              {err}
            </div>
          )}
        </div>

        <footer
          className="flex items-center justify-end gap-2 px-4 py-3 shrink-0"
          style={{ borderTop: "1px solid var(--border-col)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="or-btn-ghost"
            disabled={busy}
            data-testid={`realm-widget-settings-cancel-${widget?.id}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="or-btn"
            disabled={busy}
            data-testid={`realm-widget-settings-save-${widget?.id}`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            <span className="ml-1">Save</span>
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function FieldRow({ field, value, onChange, autoFocus, refEl, testid }) {
  const label = (
    <label
      className="block text-[10px] uppercase tracking-widest mb-1"
      style={{ color: "var(--text-muted)" }}
    >
      {field.label}
    </label>
  );
  if (field.type === "textarea") {
    return (
      <div>
        {label}
        <textarea
          ref={refEl}
          autoFocus={autoFocus}
          className="or-input w-full"
          rows={field.rows || 4}
          value={value || ""}
          placeholder={field.placeholder || ""}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testid}
        />
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div>
        {label}
        <select
          ref={refEl}
          autoFocus={autoFocus}
          className="or-input w-full"
          value={value || (field.options?.[0] ?? "")}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testid}
        >
          {(field.options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }
  if (field.type === "datetime") {
    return (
      <div>
        {label}
        <input
          ref={refEl}
          autoFocus={autoFocus}
          type="datetime-local"
          className="or-input w-full"
          value={toDatetimeLocal(value)}
          onChange={(e) => onChange(fromDatetimeLocal(e.target.value))}
          data-testid={testid}
        />
      </div>
    );
  }
  if (field.type === "string-list") {
    const items = Array.isArray(value) ? value : [];
    return (
      <div>
        {label}
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                ref={i === 0 ? refEl : null}
                autoFocus={i === 0 && autoFocus}
                className="or-input flex-1"
                value={it}
                placeholder={field.itemPlaceholder || ""}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                data-testid={`${testid}-${i}`}
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="or-chip"
                aria-label="Remove option"
                data-testid={`${testid}-remove-${i}`}
                disabled={items.length <= 2}
                title={items.length <= 2 ? "At least 2 options required" : "Remove option"}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...items, ""])}
            className="or-chip"
            data-testid={`${testid}-add`}
          >
            + Add option
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      {label}
      <input
        ref={refEl}
        autoFocus={autoFocus}
        type="text"
        className="or-input w-full"
        value={value || ""}
        placeholder={field.placeholder || ""}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
      />
    </div>
  );
}

// datetime-local <input> wants "YYYY-MM-DDTHH:MM". Stored value may be
// a full ISO string. Round-trip helpers below normalise both sides.
function toDatetimeLocal(v) {
  if (!v) return "";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}
function fromDatetimeLocal(v) {
  if (!v) return "";
  try { return new Date(v).toISOString(); } catch { return v; }
}
