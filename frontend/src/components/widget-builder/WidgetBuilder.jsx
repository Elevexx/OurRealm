/**
 * WidgetBuilder — the founder-only custom widget editor.
 *
 * Two-pane modal:
 *   • LEFT   — Basic info, layout picker, dynamic field editor, data
 *              editor (per-field value editor), placements, access groups.
 *   • RIGHT  — Live preview rendered with the same CustomWidgetRenderer
 *              used on Profile / Home / Realm. True fidelity.
 *
 * Save flow:
 *   • New widgets POST /admin/widgets (status=draft).
 *   • Existing widgets PATCH /admin/widgets/{id}; the backend
 *     snapshots the prior editor_config into versions[] automatically.
 *   • "Launch" button posts to /admin/widgets/{id}/launch and flips
 *     the row to status=live.
 *
 * Permissions: backend gates create/edit to @stealth; this component
 * is only mounted from AdminWidgets.jsx when the viewer IS stealth.
 */
import React, { useEffect, useMemo, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import CustomWidgetRenderer from "@/components/widgets/CustomWidgetRenderer";
import ApiSourceTab from "@/components/widget-builder/ApiSourceTab";
import SoundsLibraryPicker from "@/components/SoundsLibraryPicker";
import {
  FIELD_TYPES, CATEGORY_GROUPS, PLACEMENTS, ACCESS_GROUPS, SIZES,
  ICON_CHOICES, blankEditorConfig, slugifyKey,
} from "@/lib/widgetBuilder";

const SIZE_PX = { small: 240, medium: 320, large: 420, xl: 520 };

const SECTIONS = [
  { id: "basic",      label: "Basic" },
  { id: "layout",     label: "Layout" },
  { id: "fields",     label: "Fields" },
  { id: "data",       label: "Data" },
  { id: "api",        label: "API Source" },
  { id: "chat",       label: "Chat AI" },
  { id: "placement",  label: "Placement & Access" },
];

const newField = () => ({
  key: `field_${Math.random().toString(36).slice(2, 7)}`,
  type: "text",
  label: "New Field",
  required: false,
  placeholder: "",
  max_length: 120,
});

const newItem = () => ({ id: `i_${Math.random().toString(36).slice(2, 7)}`, label: "" });

// Default `data` values for each field type so the preview never
// blanks out when a new field is added.
function defaultValueFor(field) {
  switch (field.type) {
    case "toggle":    return !!field.default;
    case "number":    return field.default ?? "";
    case "option_list":
    case "rich_item": return [];
    default:          return field.default ?? "";
  }
}

export default function WidgetBuilder({ open, initial, onClose, onSaved, layouts }) {
  const isNew = !initial;
  const [form, setForm] = useState(null);
  const [section, setSection] = useState("basic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Reset state any time the modal opens or `initial` changes.
  useEffect(() => {
    if (!open) return;
    setSection("basic");
    setError(null);
    setForm(seedForm(initial));
  }, [open, initial]);

  if (!open || !form) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="widget-builder"
    >
      <div
        className="or-surface w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <Header form={form} isNew={isNew} onClose={onClose} />

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_minmax(320px,440px)] overflow-hidden">
          {/* LEFT — config */}
          <div className="overflow-y-auto p-5 border-r" style={{ borderColor: "var(--border-col)" }}>
            <SectionTabs section={section} onChange={setSection} />
            {section === "basic" && (
              <BasicSection form={form} setForm={setForm} isNew={isNew} />
            )}
            {section === "layout" && (
              <LayoutSection form={form} setForm={setForm} layouts={layouts} />
            )}
            {section === "fields" && (
              <FieldsSection form={form} setForm={setForm} />
            )}
            {section === "data" && (
              <DataSection form={form} setForm={setForm} />
            )}
            {section === "api" && (
              <ApiSourceTab form={form} setForm={setForm} />
            )}
            {section === "chat" && (
              <ChatSection form={form} setForm={setForm} />
            )}
            {section === "placement" && (
              <PlacementSection form={form} setForm={setForm} />
            )}
          </div>

          {/* RIGHT — live preview */}
          <div className="bg-[var(--surface-2)] p-5 overflow-y-auto" data-testid="widget-builder-preview">
            <PreviewPane form={form} />
          </div>
        </div>

        <Footer
          form={form}
          isNew={isNew}
          busy={busy}
          error={error}
          onClose={onClose}
          onSave={async (launch) => {
            setBusy(true); setError(null);
            try {
              const payload = serialise(form);
              let saved;
              if (isNew) {
                const { data } = await apiClient.post("/admin/widgets", payload);
                saved = data?.widget;
              } else {
                const { data } = await apiClient.patch(`/admin/widgets/${initial.id}`, payload);
                saved = data?.widget;
              }
              if (launch && saved?.id) {
                await apiClient.post(`/admin/widgets/${saved.id}/launch`);
              }
              onSaved(saved);
            } catch (e) {
              setError(e?.response?.data?.detail || "Save failed");
            } finally { setBusy(false); }
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-sections
// ─────────────────────────────────────────────────────────────────────

function Header({ form, isNew, onClose }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-col)" }}>
      <div>
        <h2 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>
          {isNew ? "Create Custom Widget" : `Edit · ${form.name || form.key}`}
        </h2>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Founder-only · Draft by default · Real preview on the right
        </div>
      </div>
      <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose} data-testid="widget-builder-close">
        <Icons.X size={14} />
      </button>
    </div>
  );
}

function SectionTabs({ section, onChange }) {
  return (
    <div className="flex gap-1 mb-4 border-b" style={{ borderColor: "var(--border-col)" }}>
      {SECTIONS.map((s) => {
        const active = s.id === section;
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            className="px-3 py-2 text-xs uppercase tracking-widest font-bold transition-colors"
            style={{
              borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
              color: active ? "var(--primary)" : "var(--text-muted)",
            }}
            data-testid={`widget-builder-tab-${s.id}`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function BasicSection({ form, setForm, isNew }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Widget Name">
        <input
          className="or-input w-full"
          value={form.name}
          onChange={(e) => {
            const name = e.target.value;
            setForm((f) => ({
              ...f,
              name,
              // Auto-derive key on first character (only when new + key empty/auto)
              key: isNew && (!f._keyDirty) ? slugifyKey(name) : f.key,
            }));
          }}
          data-testid="widget-builder-name"
        />
      </Field>
      <Field label="Unique Key">
        <input
          className="or-input w-full"
          value={form.key}
          disabled={!isNew}
          onChange={(e) => setForm((f) => ({
            ...f,
            key: slugifyKey(e.target.value),
            _keyDirty: true,
          }))}
          placeholder="snake_case"
          data-testid="widget-builder-key"
        />
      </Field>
      <Field label="Category Group">
        <select
          className="or-input w-full"
          value={form.category_group}
          onChange={(e) => setForm((f) => ({ ...f, category_group: e.target.value }))}
          data-testid="widget-builder-category-group"
        >
          {CATEGORY_GROUPS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Icon">
        <select
          className="or-input w-full"
          value={form.icon}
          onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
          data-testid="widget-builder-icon"
        >
          {ICON_CHOICES.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </Field>
      <Field label="Default Size">
        <select
          className="or-input w-full"
          value={form.default_size}
          onChange={(e) => setForm((f) => ({ ...f, default_size: e.target.value }))}
          data-testid="widget-builder-default-size"
        >
          {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Sort Order">
        <input
          type="number"
          className="or-input w-full"
          value={form.sort_order}
          onChange={(e) => setForm((f) => ({ ...f, sort_order: parseInt(e.target.value, 10) || 0 }))}
          data-testid="widget-builder-sort"
        />
      </Field>
      <Field label="Description" full>
        <textarea
          rows={2}
          className="or-input w-full"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          data-testid="widget-builder-description"
        />
      </Field>
    </div>
  );
}

function LayoutSection({ form, setForm, layouts }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {(layouts || []).map((l) => {
        const Icon = Icons[l.icon] || Icons.Square;
        const active = form.editor_config.layout === l.key;
        return (
          <button
            key={l.key}
            onClick={() => setForm((f) => ({
              ...f,
              editor_config: { ...f.editor_config, layout: l.key },
            }))}
            className="or-surface p-4 text-left transition-transform hover:-translate-y-0.5"
            style={{ background: "var(--surface-2)", outline: active ? "2px solid var(--primary)" : "none" }}
            data-testid={`widget-builder-layout-${l.key}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon size={18} style={{ color: active ? "var(--primary)" : "var(--text-main)" }} />
              <span className="font-semibold text-sm" style={{ color: "var(--text-main)" }}>{l.name}</span>
              {active && <Icons.Check size={12} className="ml-auto" style={{ color: "var(--primary)" }} />}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{l.description}</div>
          </button>
        );
      })}
    </div>
  );
}

function FieldsSection({ form, setForm }) {
  const fields = form.editor_config.fields || [];
  const updateField = (idx, patch) =>
    setForm((f) => ({
      ...f,
      editor_config: {
        ...f.editor_config,
        fields: f.editor_config.fields.map((x, i) => (i === idx ? { ...x, ...patch } : x)),
      },
    }));
  const removeField = (idx) =>
    setForm((f) => ({
      ...f,
      editor_config: {
        ...f.editor_config,
        fields: f.editor_config.fields.filter((_, i) => i !== idx),
      },
    }));
  const moveField = (idx, delta) =>
    setForm((f) => {
      const arr = [...f.editor_config.fields];
      const target = idx + delta;
      if (target < 0 || target >= arr.length) return f;
      const [item] = arr.splice(idx, 1);
      arr.splice(target, 0, item);
      return { ...f, editor_config: { ...f.editor_config, fields: arr } };
    });
  const addField = () =>
    setForm((f) => ({
      ...f,
      editor_config: { ...f.editor_config, fields: [...f.editor_config.fields, newField()] },
    }));

  return (
    <div>
      {fields.length === 0 ? (
        <div className="text-center p-6 or-surface" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
          No fields yet. Add a field to start building the widget.
        </div>
      ) : (
        <div className="space-y-2" data-testid="widget-builder-fields-list">
          {fields.map((field, idx) => (
            <FieldEditor
              key={`${field.key}-${idx}`}
              field={field}
              onChange={(patch) => updateField(idx, patch)}
              onRemove={() => removeField(idx)}
              onMoveUp={idx > 0 ? () => moveField(idx, -1) : null}
              onMoveDown={idx < fields.length - 1 ? () => moveField(idx, +1) : null}
            />
          ))}
        </div>
      )}
      <button
        className="or-btn or-btn-primary mt-3 text-sm"
        onClick={addField}
        data-testid="widget-builder-add-field"
      >
        <Icons.Plus size={14} /> Add Field
      </button>
    </div>
  );
}

function FieldEditor({ field, onChange, onRemove, onMoveUp, onMoveDown }) {
  const typeDef = FIELD_TYPES.find((t) => t.key === field.type);
  const supports = (k) => (typeDef?.supports || []).includes(k);
  return (
    <div className="or-surface p-3" style={{ background: "var(--surface-2)" }} data-testid={`widget-builder-field-${field.key}`}>
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
        <div className="sm:col-span-4">
          <Label>Label</Label>
          <input className="or-input w-full text-xs" value={field.label || ""} onChange={(e) => onChange({ label: e.target.value })} />
        </div>
        <div className="sm:col-span-3">
          <Label>Key</Label>
          <input
            className="or-input w-full text-xs"
            value={field.key}
            onChange={(e) => onChange({ key: slugifyKey(e.target.value) })}
          />
        </div>
        <div className="sm:col-span-3">
          <Label>Type</Label>
          <select className="or-input w-full text-xs" value={field.type} onChange={(e) => onChange({ type: e.target.value })}>
            {FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex items-end gap-1 justify-end">
          {onMoveUp && <button className="starbar-icon" style={{ width: 28, height: 28 }} onClick={onMoveUp}><Icons.ChevronUp size={12} /></button>}
          {onMoveDown && <button className="starbar-icon" style={{ width: 28, height: 28 }} onClick={onMoveDown}><Icons.ChevronDown size={12} /></button>}
          <button className="starbar-icon" style={{ width: 28, height: 28, color: "#FF5A6B" }} onClick={onRemove}><Icons.Trash2 size={12} /></button>
        </div>
        {supports("placeholder") && (
          <div className="sm:col-span-6">
            <Label>Placeholder</Label>
            <input className="or-input w-full text-xs" value={field.placeholder || ""} onChange={(e) => onChange({ placeholder: e.target.value })} />
          </div>
        )}
        {supports("max_length") && (
          <div className="sm:col-span-3">
            <Label>Max Length</Label>
            <input type="number" className="or-input w-full text-xs" value={field.max_length || ""} onChange={(e) => onChange({ max_length: parseInt(e.target.value, 10) || null })} />
          </div>
        )}
        {supports("max_count") && (
          <div className="sm:col-span-3">
            <Label>Max Count</Label>
            <input type="number" className="or-input w-full text-xs" value={field.max_count || ""} onChange={(e) => onChange({ max_count: parseInt(e.target.value, 10) || null })} />
          </div>
        )}
        {supports("min_count") && (
          <div className="sm:col-span-3">
            <Label>Min Count</Label>
            <input type="number" className="or-input w-full text-xs" value={field.min_count || ""} onChange={(e) => onChange({ min_count: parseInt(e.target.value, 10) || null })} />
          </div>
        )}
        {supports("required") && (
          <div className="sm:col-span-3 flex items-end">
            <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={!!field.required} onChange={(e) => onChange({ required: e.target.checked })} />
              Required
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function DataSection({ form, setForm }) {
  const fields = form.editor_config.fields || [];
  const data = form.editor_config.data || {};
  const updateData = (k, v) =>
    setForm((f) => ({
      ...f,
      editor_config: { ...f.editor_config, data: { ...f.editor_config.data, [k]: v } },
    }));

  if (fields.length === 0) {
    return (
      <div className="text-center p-6 or-surface" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
        Add a field on the Fields tab before entering data.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <DataInput
          key={f.key}
          field={f}
          value={data[f.key] ?? defaultValueFor(f)}
          onChange={(v) => updateData(f.key, v)}
        />
      ))}
    </div>
  );
}

function DataInput({ field, value, onChange }) {
  const label = field.label || field.key;
  switch (field.type) {
    case "long_text":
      return (
        <FieldFull label={label}>
          <textarea
            className="or-input w-full text-sm"
            rows={3}
            value={value || ""}
            maxLength={field.max_length || undefined}
            placeholder={field.placeholder || ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </FieldFull>
      );
    case "number":
      return (
        <FieldFull label={label}>
          <input type="number" className="or-input w-full text-sm" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        </FieldFull>
      );
    case "toggle":
      return (
        <FieldFull label={label}>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
            <span style={{ color: "var(--text-main)" }}>{value ? "On" : "Off"}</span>
          </label>
        </FieldFull>
      );
    case "date":
      return (
        <FieldFull label={label}>
          <input type="date" className="or-input w-full text-sm" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </FieldFull>
      );
    case "datetime":
      return (
        <FieldFull label={label}>
          <input type="datetime-local" className="or-input w-full text-sm" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </FieldFull>
      );
    case "color":
      return (
        <FieldFull label={label}>
          <input type="color" className="or-input text-sm" value={value || "#00FF66"} onChange={(e) => onChange(e.target.value)} />
        </FieldFull>
      );
    case "url":
    case "embed":
      return (
        <FieldFull label={label}>
          <input className="or-input w-full text-sm" value={value || ""} placeholder={field.placeholder || "https://"} onChange={(e) => onChange(e.target.value)} />
        </FieldFull>
      );
    case "image":
    case "video":
    case "sound":
      return (
        <MediaListInput field={field} value={value} onChange={onChange} />
      );
    case "option_list":
      return (
        <RepeaterInput
          field={field} value={value} onChange={onChange}
          shape={() => ({ id: `o_${Math.random().toString(36).slice(2, 7)}`, label: "", votes: 0 })}
          cols={[{ key: "label", placeholder: "Option label" }]}
        />
      );
    case "rich_item":
      return (
        <RepeaterInput
          field={field} value={value} onChange={onChange}
          shape={() => ({ id: `i_${Math.random().toString(36).slice(2, 7)}`, label: "", body: "", value: "", url: "", icon: "", image: "" })}
          cols={[
            { key: "label", placeholder: "Label" },
            { key: "body",  placeholder: "Body / subtitle" },
            { key: "value", placeholder: "Right-side value (optional)" },
            { key: "url",   placeholder: "https:// link (optional)" },
            { key: "icon",  placeholder: "Lucide icon (optional)" },
          ]}
        />
      );
    default:
      return (
        <FieldFull label={label}>
          <input
            className="or-input w-full text-sm"
            value={value || ""}
            maxLength={field.max_length || undefined}
            placeholder={field.placeholder || ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </FieldFull>
      );
  }
}

function MediaListInput({ field, value, onChange }) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const max = field.max_count || 12;
  const single = max === 1;
  const isSound = field.type === "sound";
  const [pickerOpen, setPickerOpen] = useState(false);
  const updateRow = (i, v) => onChange(single ? v : list.map((x, idx) => (idx === i ? v : x)));
  const addRow = () => onChange(single ? "" : [...list, ""]);
  const removeRow = (i) => onChange(single ? "" : list.filter((_, idx) => idx !== i));

  // Phase 3.3 — when the picker returns sound IDs replace the entire
  // list (multi) or the single value, deduping with any existing
  // entries (legacy URLs are preserved unless explicitly replaced).
  const onPicked = (picked) => {
    setPickerOpen(false);
    if (picked === null || picked === undefined) return;
    if (single) {
      onChange(picked || "");
      return;
    }
    if (!Array.isArray(picked)) return;
    // Multi-mode — keep existing legacy URLs (non-UUID-shaped entries)
    // and append the new sound IDs (deduped).
    const keepLegacy = list.filter((v) => v && !looksLikeId(v));
    const next = [...keepLegacy];
    for (const id of picked) {
      if (id && !next.includes(id)) next.push(id);
    }
    onChange(next.slice(0, max));
  };

  const initialSelected = single
    ? (looksLikeId(list[0]) ? [list[0]] : [])
    : list.filter(looksLikeId);

  return (
    <FieldFull label={`${field.label || field.key} · ${field.type}`}>
      <div className="space-y-1.5">
        {(single ? [list[0] || ""] : list).map((row, i) => (
          <div key={i} className="flex gap-1">
            <input
              className="or-input flex-1 text-xs"
              value={row || ""}
              placeholder={isSound
                ? `Paste sound URL OR pick from library`
                : `Paste ${field.type} URL or /api/media/...`}
              onChange={(e) => updateRow(i, e.target.value)}
            />
            {looksLikeId(row) && (
              <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0 self-center"
                style={{ background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary)" }}>
                Native ID
              </span>
            )}
            {!single && (
              <button className="starbar-icon" style={{ width: 28, height: 28, color: "#FF5A6B" }} onClick={() => removeRow(i)}>
                <Icons.X size={12} />
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-1 flex-wrap">
          {!single && list.length < max && (
            <button className="or-btn or-btn-ghost text-xs" onClick={addRow}>
              <Icons.Plus size={11} /> Add {field.type}
            </button>
          )}
          {isSound && (
            <button
              className="or-btn or-btn-primary text-xs"
              onClick={() => setPickerOpen(true)}
              data-testid={`media-list-select-library-${field.key}`}
            >
              <Icons.Music size={11} /> Select from Sounds Library
            </button>
          )}
        </div>
      </div>
      {isSound && (
        <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
          Pick from your /sounds library to save by ID (renames + cover updates auto-propagate). Pasted URLs still work for legacy widgets.
        </div>
      )}
      {!isSound && (
        <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
          Note: media upload UI ships next. For now paste an existing media URL or proxy path.
        </div>
      )}
      {pickerOpen && (
        <SoundsLibraryPicker
          open
          onClose={() => setPickerOpen(false)}
          onPick={onPicked}
          multi={!single}
          initialSelected={initialSelected}
        />
      )}
    </FieldFull>
  );
}

// Quick heuristic — UUIDs (with or without dashes, 32 hex chars) are
// our sound IDs. URLs always contain a slash; legacy values that
// happen to be 32-hex-char strings without dashes are unlikely in
// practice, and the resolver will gracefully drop unresolvable IDs.
function looksLikeId(v) {
  if (!v || typeof v !== "string") return false;
  if (v.includes("/")) return false;
  const stripped = v.replace(/-/g, "").toLowerCase();
  return stripped.length === 32 && /^[0-9a-f]+$/.test(stripped);
}

function RepeaterInput({ field, value, onChange, shape, cols }) {
  const list = Array.isArray(value) ? value : [];
  const max = field.max_count || 20;
  const min = field.min_count || 0;
  const update = (i, patch) => onChange(list.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const add = () => onChange([...list, shape()]);
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));

  return (
    <FieldFull label={`${field.label || field.key} (${list.length})`}>
      <div className="space-y-2">
        {list.map((row, i) => (
          <div key={row.id || i} className="or-surface p-2 space-y-1" style={{ background: "var(--surface-2)" }}>
            {cols.map((c) => (
              <input
                key={c.key}
                className="or-input w-full text-xs"
                placeholder={c.placeholder}
                value={row[c.key] || ""}
                onChange={(e) => update(i, { [c.key]: e.target.value })}
              />
            ))}
            <div className="text-right">
              <button
                className="starbar-icon"
                style={{ width: 24, height: 24, color: "#FF5A6B" }}
                onClick={() => remove(i)}
                disabled={list.length <= min}
                title={list.length <= min ? `Minimum ${min} required` : "Remove"}
              >
                <Icons.Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
        {list.length < max && (
          <button className="or-btn or-btn-ghost text-xs" onClick={add}>
            <Icons.Plus size={11} /> Add item
          </button>
        )}
      </div>
    </FieldFull>
  );
}

function PlacementSection({ form, setForm }) {
  const toggle = (k, v) =>
    setForm((f) => ({
      ...f,
      [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v],
    }));
  return (
    <div className="space-y-4">
      <Field label="Placements" full>
        <CheckboxGroup
          options={PLACEMENTS}
          selected={form.placements}
          onToggle={(v) => toggle("placements", v)}
          testidPrefix="widget-builder-placement"
        />
        <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
          Choose where this widget can be added: profile picker, /home, and/or realms.
        </div>
      </Field>
      <Field label="Access Groups" full>
        <CheckboxGroup
          options={ACCESS_GROUPS}
          selected={form.access_groups}
          onToggle={(v) => toggle("access_groups", v)}
          testidPrefix="widget-builder-access"
        />
        <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
          Who can see and add this widget. <b>all_users</b> includes everyone (default).
        </div>
      </Field>
      <Field label="Allowed Sizes" full>
        <CheckboxGroup
          options={SIZES.map((s) => ({ id: s, label: s }))}
          selected={form.allowed_sizes}
          onToggle={(v) => toggle("allowed_sizes", v)}
          testidPrefix="widget-builder-size"
        />
      </Field>
    </div>
  );
}

function PreviewPane({ form }) {
  const widget = useMemo(() => ({
    type: form.key || "preview",
    key: form.key || "preview",
    name: form.name,
    // Preview widget needs an id to allow ChatLayout to call /chat/* endpoints
    // when previewing a SAVED chat widget. New widgets without an id show
    // the "Save first" hint via ChatLayout.
    id: form._initial_id || undefined,
    editor_config: form.editor_config,
  }), [form]);
  const size = form.default_size || "medium";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
        Live Preview ({size})
      </div>
      <div
        className="or-surface p-4 mx-auto"
        style={{ width: "100%", maxWidth: SIZE_PX[size] || 320, minHeight: 180 }}
        data-testid="widget-builder-preview-card"
      >
        <CustomWidgetRenderer w={widget} />
      </div>
      <div className="mt-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
        This is rendered with the same CustomWidgetRenderer that profiles, home, and realms use. WYSIWYG.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ChatSection — Phase 3.5 conversational AI configuration tab.
// ─────────────────────────────────────────────────────────────────────

function ChatSection({ form, setForm }) {
  const isChat = form.editor_config.layout === "chat";
  const cfg = form.editor_config.chat || {};
  const update = (patch) => setForm((f) => ({
    ...f,
    editor_config: { ...f.editor_config, chat: { ...(f.editor_config.chat || {}), ...patch } },
  }));

  return (
    <div className="space-y-5" data-testid="widget-builder-chat-section">
      {!isChat && (
        <div className="text-[11px] px-3 py-2 rounded" style={{ background: "rgba(244,200,74,0.12)", color: "#F4C84A" }}>
          <Icons.Info size={11} className="inline mr-1" />
          Set layout to <b>Chat</b> on the Layout tab for these options to take effect at runtime. (You can still configure them here.)
        </div>
      )}

      <FieldFull label="System Prompt">
        <textarea
          rows={5}
          value={cfg.system_prompt || ""}
          onChange={(e) => update({ system_prompt: e.target.value })}
          placeholder={"You are Stealth AI, the private assistant for the founder of OurRealm.\n\nReply concisely and helpfully."}
          className="w-full text-xs px-2 py-1.5 rounded outline-none"
          style={{ background: "var(--surface-2)", color: "var(--text-main)" }}
          data-testid="chat-cfg-system-prompt"
        />
        <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
          Supports variables: <code>{"{{user_message}}"}</code> <code>{"{{username}}"}</code> <code>{"{{display_name}}"}</code> <code>{"{{profile_id}}"}</code> <code>{"{{widget_id}}"}</code> <code>{"{{realm_id}}"}</code>
        </div>
      </FieldFull>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Model">
          <select
            value={cfg.model || "gpt-5.4-mini"}
            onChange={(e) => update({ model: e.target.value })}
            className="w-full text-xs px-2 py-1.5 rounded outline-none"
            style={{ background: "var(--surface-2)", color: "var(--text-main)" }}
            data-testid="chat-cfg-model"
          >
            <option value="gpt-5.4-mini">gpt-5.4-mini (fast, default)</option>
            <option value="gpt-5.4-nano">gpt-5.4-nano (cheapest)</option>
            <option value="gpt-5.6-terra">gpt-5.6-terra (deep reasoning)</option>
            <option value="gpt-4-turbo">gpt-4-turbo</option>
          </select>
        </Field>
        <Field label="Temperature">
          <input
            type="number" min="0" max="2" step="0.1"
            value={cfg.temperature ?? 0.7}
            onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
            className="w-full text-xs px-2 py-1.5 rounded outline-none"
            style={{ background: "var(--surface-2)", color: "var(--text-main)" }}
            data-testid="chat-cfg-temperature"
          />
        </Field>
        <Field label="Max Tokens">
          <input
            type="number" min="16" max="4000" step="16"
            value={cfg.max_tokens ?? 600}
            onChange={(e) => update({ max_tokens: parseInt(e.target.value || "0", 10) })}
            className="w-full text-xs px-2 py-1.5 rounded outline-none"
            style={{ background: "var(--surface-2)", color: "var(--text-main)" }}
            data-testid="chat-cfg-max-tokens"
          />
        </Field>
        <Field label="Memory">
          <select
            value={cfg.memory_mode || "persistent"}
            onChange={(e) => update({ memory_mode: e.target.value })}
            className="w-full text-xs px-2 py-1.5 rounded outline-none"
            style={{ background: "var(--surface-2)", color: "var(--text-main)" }}
            data-testid="chat-cfg-memory-mode"
          >
            <option value="off">Off (stateless)</option>
            <option value="session">Session Only</option>
            <option value="persistent">Persistent (per user)</option>
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <ToggleChip
          on={!!cfg.founder_only}
          onChange={(v) => update({ founder_only: v })}
          label="Founder Only"
          testid="chat-cfg-founder-only"
        />
        <ToggleChip
          on={!!cfg.enable_streaming}
          onChange={(v) => update({ enable_streaming: v })}
          label="Enable Streaming"
          testid="chat-cfg-streaming"
        />
      </div>

      <FieldFull label="Quick Actions (one per line)">
        <textarea
          rows={4}
          value={(cfg.quick_actions || []).join("\n")}
          onChange={(e) => update({ quick_actions: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          placeholder={"Summarize\nBrainstorm ideas\nGenerate a post"}
          className="w-full text-xs px-2 py-1.5 rounded outline-none"
          style={{ background: "var(--surface-2)", color: "var(--text-main)" }}
          data-testid="chat-cfg-quick-actions"
        />
      </FieldFull>
    </div>
  );
}

function ToggleChip({ on, onChange, label, testid }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="px-3 py-1.5 text-xs rounded-full transition-colors flex items-center gap-1.5"
      style={{
        background: on ? "var(--primary)" : "var(--surface-2)",
        color: on ? "#000" : "var(--text-muted)",
        fontWeight: on ? 700 : 500,
      }}
      data-testid={testid}
    >
      {on ? <Icons.Check size={11} /> : <Icons.Circle size={11} />}
      {label}
    </button>
  );
}

function Footer({ form, isNew, busy, error, onClose, onSave }) {
  const disabled = busy || !form.key || !form.name || !form.editor_config.layout;
  return (
    <div className="border-t px-5 py-3 flex items-center justify-between flex-wrap gap-2" style={{ borderColor: "var(--border-col)" }}>
      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {error ? (
          <span style={{ color: "#FF5A6B" }} data-testid="widget-builder-error">{error}</span>
        ) : (
          <span>Status: <b style={{ color: "var(--primary)" }}>{form.status}</b> · {form.editor_config.fields.length} field{form.editor_config.fields.length === 1 ? "" : "s"}</span>
        )}
      </div>
      <div className="flex gap-2">
        <button className="or-btn or-btn-ghost text-sm" onClick={onClose}>Cancel</button>
        <button
          className="or-btn or-btn-ghost text-sm"
          onClick={() => onSave(false)}
          disabled={disabled}
          data-testid="widget-builder-save-draft"
        >
          {busy ? <Icons.Loader2 size={14} className="animate-spin" /> : <Icons.Save size={14} />} Save Draft
        </button>
        <button
          className="or-btn or-btn-primary text-sm"
          onClick={() => onSave(true)}
          disabled={disabled}
          data-testid="widget-builder-launch"
        >
          {busy ? <Icons.Loader2 size={14} className="animate-spin" /> : <Icons.Rocket size={14} />} {isNew ? "Save & Launch" : "Save & Re-launch"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Form helpers
// ─────────────────────────────────────────────────────────────────────

function seedForm(initial) {
  const base = initial || {};
  const ec = base.editor_config || blankEditorConfig("card");
  return {
    key: base.key || "",
    name: base.name || "",
    widget_type: base.widget_type || "profile",
    category: base.category || "custom",
    category_group: base.category_group || "custom",
    icon: base.icon || "Sparkles",
    description: base.description || "",
    status: base.status || "draft",
    access_groups: base.access_groups || ["all_users"],
    placements: base.placements || ["profile"],
    default_size: base.default_size || "medium",
    allowed_sizes: base.allowed_sizes || ["small", "medium", "large", "xl"],
    sort_order: base.sort_order ?? 200,
    editor_config: {
      schema_version: ec.schema_version || 1,
      layout: ec.layout || "card",
      fields: ec.fields || [],
      data: ec.data || {},
      data_source: ec.data_source || { kind: "static", api: null, refresh_seconds: 0 },
      chat: ec.chat || {
        mode: "conversational",
        system_prompt: "",
        model: "gpt-5.4-mini",
        temperature: 0.7,
        max_tokens: 600,
        memory_mode: "persistent",
        founder_only: false,
        enable_streaming: false,
        quick_actions: [],
      },
      theme: ec.theme || {},
      limits: ec.limits || {},
    },
    _keyDirty: !!base.key,
    _initial_id: base.id || null,
  };
}

function serialise(form) {
  const out = { ...form };
  delete out._keyDirty;
  delete out._initial_id;
  return out;
}

function Field({ label, full, children }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      {children}
    </label>
  );
}
function FieldFull({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      {children}
    </label>
  );
}
function Label({ children }) {
  return <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>{children}</div>;
}
function CheckboxGroup({ options, selected, onToggle, testidPrefix }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onToggle(o.id)}
            className="px-3 py-1 text-xs rounded-full transition-colors"
            style={{
              background: on ? "var(--primary)" : "var(--surface-2)",
              color: on ? "#000" : "var(--text-muted)",
              fontWeight: on ? 700 : 500,
            }}
            data-testid={`${testidPrefix}-${o.id}`}
          >
            {on && <Icons.Check size={11} className="inline mr-1" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
