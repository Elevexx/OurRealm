/**
 * /admin/widgets — Widgets & Badges Manager (Phase 1, Feb 24, 2026).
 *
 * Two tabs (Widgets | Badges) backed by /api/admin/widgets + /api/admin/badges.
 * Founder/admin only — non-admin viewers get bounced to /.
 * Matches the neon admin style of /admin (or-surface, accent stripes,
 * font-display headings, dark backdrop).
 *
 * Notes:
 *   • System widgets (is_system=true) cannot be deleted, only edited.
 *   • Disabled widgets stay in the registry but never reach the public
 *     picker (handled server-side in /api/widgets/available).
 *   • Badge assignment supports comma-separated usernames in the
 *     modal — backend will lower/lstrip @ each.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import WidgetBuilder from "@/components/widget-builder/WidgetBuilder";
import TemplatesGallery from "@/components/widget-builder/TemplatesGallery";
import VersionHistory from "@/components/widget-builder/VersionHistory";
import { slugifyKey } from "@/lib/widgetBuilder";

const ACCESS_GROUPS = [
  { id: "founder",    label: "Founder" },
  { id: "admin",      label: "Admin" },
  { id: "vip",        label: "VIP" },
  { id: "standard",   label: "Standard" },
  { id: "all_users",  label: "All Users" },
];

const PLACEMENTS = [
  { id: "profile", label: "Profile" },
  { id: "home",    label: "Home" },
  { id: "realm",   label: "Realm" },
];

const SIZES = ["small", "medium", "large", "xl"];

const STATUS_COLORS = {
  live:     "#10E670",
  draft:    "#F4C84A",
  disabled: "#FF5A6B",
};

const ICON_CHOICES = [
  "Sparkles", "Users", "Radio", "PlayCircle", "Music", "Mic", "Image",
  "Calendar", "CloudSun", "CalendarDays", "Timer", "StickyNote",
  "BarChart3", "ClipboardList", "BookOpen", "Radar", "Award", "Star",
  "Crown", "ShieldCheck", "Heart", "Flame", "Zap", "Gem",
];

export default function AdminWidgets() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("widgets");

  // Any admin tier may view the page (founder, admin, support_admin,
  // moderator). Custom-widget authoring is gated separately and
  // enforced server-side; this guard just blocks non-admin users.
  useEffect(() => {
    if (authLoading) return;
    const role = (user?.role || "").toLowerCase();
    const isAdminTier =
      role === "admin" || role === "founder" || role === "support_admin" || role === "moderator" ||
      user?.is_admin === true || (user?.username || "").toLowerCase() === "stealth";
    if (!user || !isAdminTier) navigate("/", { replace: true });
  }, [authLoading, user, navigate]);

  if (authLoading) {
    return (
      <div className="max-w-md mx-auto or-surface p-8 text-center" data-testid="admin-widgets-loading">
        <Icons.Loader2 size={28} className="mx-auto animate-spin" style={{ color: "var(--primary)" }} />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6" data-testid="admin-widgets-page">
      <header className="flex items-center gap-3 mb-1">
        <Icons.LayoutGrid size={26} style={{ color: "var(--primary)" }} />
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
          Widgets & Badges Manager
        </h1>
      </header>
      <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
        Create, launch, disable, and assign widgets and badges across the entire app.
        System widgets cannot be deleted; disabled entries stay in the registry but disappear from public surfaces.
      </p>

      <div className="flex gap-1 mb-5" data-testid="admin-widgets-tabs">
        {["widgets", "badges"].map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 text-sm font-bold uppercase tracking-widest transition-colors"
              style={{
                background: active ? "var(--primary)" : "transparent",
                color: active ? "#000" : "var(--text-main)",
                borderBottom: active ? "none" : "1px solid var(--border-col)",
                borderRadius: "8px 8px 0 0",
              }}
              data-testid={`admin-widgets-tab-${t}`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === "widgets" ? <WidgetsTab /> : <BadgesTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// WIDGETS TAB
// ─────────────────────────────────────────────────────────────────────

function WidgetsTab() {
  const { user } = useAuth();
  const isStealth = (user?.username || "").toLowerCase() === "stealth";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);   // legacy editor (system widgets metadata)
  const [builder, setBuilder] = useState(null); // null | "new" | widget object (custom builder)
  const [picker, setPicker] = useState(false);  // templates gallery
  const [history, setHistory] = useState(null); // widget for version history
  const [cloneTarget, setCloneTarget] = useState(null);
  const [layouts, setLayouts] = useState([]);
  const [filters, setFilters] = useState({ status: "", placement: "", access_group: "", q: "" });

  // Hydrate the builder schema once (used by the layout picker).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/admin/widgets/schema");
        if (!cancelled) setLayouts(data?.layouts || []);
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const { data } = await apiClient.get(`/admin/widgets?${params}`);
      setItems(data?.widgets || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { reload(); }, [reload]);

  const launch = async (id) => { await apiClient.post(`/admin/widgets/${id}/launch`); await reload(); };
  const disable = async (id) => { await apiClient.post(`/admin/widgets/${id}/disable`); await reload(); };
  const remove = async (id, name) => {
    if (!window.confirm(`Delete widget "${name}"? This cannot be undone.`)) return;
    try {
      await apiClient.delete(`/admin/widgets/${id}`);
      await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || "Delete failed");
    }
  };

  // Editing: system widgets and non-stealth admins use the simple
  // metadata editor (status/access/placement/sort only); custom
  // widgets edited BY @stealth open the full builder.
  const openEditor = (w) => {
    if (isStealth && !w.is_system) {
      setBuilder(w);
    } else {
      setEditor(w);
    }
  };

  const pickTemplate = async (tpl) => {
    setPicker(false);
    // Generate a unique-ish key suggestion off the template name.
    const stamp = Math.random().toString(36).slice(2, 5);
    const key = `${slugifyKey(tpl.key)}_${stamp}`;
    try {
      const { data } = await apiClient.post(`/admin/widgets/from-template/${tpl.key}`, {
        key, name: tpl.name,
      });
      // Drop straight into the builder with the freshly-created draft.
      setBuilder(data?.widget || null);
      await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || "Create from template failed");
    }
  };

  const startFromScratch = () => { setPicker(false); setBuilder("new"); };

  const cloneWidget = async (w) => {
    const suggested = `${w.key}_copy_${Math.random().toString(36).slice(2, 4)}`;
    const key = window.prompt(`New widget key (snake_case):`, suggested);
    if (!key) return;
    try {
      const { data } = await apiClient.post(`/admin/widgets/${w.id}/clone`, {
        key: slugifyKey(key), name: `${w.name} (Copy)`,
      });
      setBuilder(data?.widget || null);
      await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || "Clone failed");
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4 items-center" data-testid="widgets-filter-bar">
        <input
          className="or-input flex-1 min-w-[180px] text-sm"
          placeholder="Search by name or key…"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          data-testid="widgets-search"
        />
        <FilterSelect
          value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={[["", "All status"], ["live", "Live"], ["draft", "Draft"], ["disabled", "Disabled"]]}
          testid="widgets-filter-status"
        />
        <FilterSelect
          value={filters.placement} onChange={(v) => setFilters((f) => ({ ...f, placement: v }))}
          options={[["", "All placements"], ["profile", "Profile"], ["home", "Home"], ["realm", "Realm"]]}
          testid="widgets-filter-placement"
        />
        <FilterSelect
          value={filters.access_group} onChange={(v) => setFilters((f) => ({ ...f, access_group: v }))}
          options={[["", "All access"], ...ACCESS_GROUPS.map(g => [g.id, g.label])]}
          testid="widgets-filter-access"
        />
        {isStealth && (
          <button
            className="or-btn or-btn-primary"
            onClick={() => setPicker(true)}
            data-testid="widgets-create-custom"
          >
            <Icons.Sparkles size={14} /> Create Custom Widget
          </button>
        )}
      </div>

      {!isStealth && (
        <div
          className="text-[11px] mb-3 px-3 py-2 rounded"
          style={{ background: "color-mix(in srgb, var(--brand-green) 12%, transparent)", color: "var(--brand-green)" }}
          data-testid="widgets-founder-only-note"
        >
          Founder-only: creating custom widgets is restricted to @stealth. You can still launch / disable / assign access on existing widgets.
        </div>
      )}

      {loading ? (
        <div className="text-center p-8"><Icons.Loader2 className="animate-spin inline" /></div>
      ) : items.length === 0 ? (
        <div className="or-surface p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No widgets match these filters.
        </div>
      ) : (
        <div className="space-y-2" data-testid="widgets-list">
          {items.map((w) => (
            <WidgetRow
              key={w.id}
              w={w}
              isStealth={isStealth}
              onEdit={() => openEditor(w)}
              onClone={() => cloneWidget(w)}
              onHistory={() => setHistory(w)}
              onLaunch={() => launch(w.id)}
              onDisable={() => disable(w.id)}
              onDelete={() => remove(w.id, w.name)}
            />
          ))}
        </div>
      )}

      {editor && (
        <WidgetEditor
          initial={editor === "new" ? null : editor}
          isStealth={isStealth}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); reload(); }}
        />
      )}
      {picker && (
        <TemplatesGallery
          open
          onClose={() => setPicker(false)}
          onPick={pickTemplate}
          onScratch={startFromScratch}
        />
      )}
      {builder && (
        <WidgetBuilder
          open
          initial={builder === "new" ? null : builder}
          layouts={layouts}
          onClose={() => setBuilder(null)}
          onSaved={() => { setBuilder(null); reload(); }}
        />
      )}
      {history && (
        <VersionHistory
          widget={history}
          onClose={() => setHistory(null)}
          onRolledBack={() => { setHistory(null); reload(); }}
        />
      )}
    </>
  );
}

function WidgetRow({ w, isStealth, onEdit, onClone, onHistory, onLaunch, onDisable, onDelete }) {
  const Icon = Icons[w.icon] || Icons.Sparkles;
  const hasVersions = (w.versions?.length || 0) > 0;
  return (
    <div
      className="or-surface p-3 flex items-center gap-3"
      style={{ borderLeft: `3px solid ${STATUS_COLORS[w.status] || "var(--border-col)"}` }}
      data-testid={`widget-row-${w.key}`}
    >
      <div
        className="rounded-md p-2 shrink-0"
        style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}
      >
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold" style={{ color: "var(--text-main)" }}>{w.name}</span>
          <code className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
            {w.key}
          </code>
          {w.is_system && (
            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--brand-green) 18%, transparent)", color: "var(--brand-green)" }}>
              System
            </span>
          )}
          {!w.is_system && w.editor_config?.layout && (
            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}>
              {w.editor_config.layout}
            </span>
          )}
          {(w.version || 1) > 1 && (
            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
              v{w.version}
            </span>
          )}
          <StatusPill status={w.status} />
        </div>
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {w.category} · {(w.placements || []).join(", ")} · {(w.access_groups || []).join(", ")}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onEdit} title="Edit" data-testid={`widget-edit-${w.key}`}>
          <Icons.Pencil size={14} />
        </button>
        {isStealth && hasVersions && (
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onHistory} title="Version History" data-testid={`widget-history-${w.key}`}>
            <Icons.History size={14} />
          </button>
        )}
        {isStealth && (
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClone} title="Clone" data-testid={`widget-clone-${w.key}`}>
            <Icons.Copy size={14} />
          </button>
        )}
        {w.status !== "live" && (
          <button className="starbar-icon" style={{ width: 32, height: 32, color: STATUS_COLORS.live }} onClick={onLaunch} title="Launch" data-testid={`widget-launch-${w.key}`}>
            <Icons.Rocket size={14} />
          </button>
        )}
        {w.status !== "disabled" && (
          <button className="starbar-icon" style={{ width: 32, height: 32, color: STATUS_COLORS.disabled }} onClick={onDisable} title="Disable" data-testid={`widget-disable-${w.key}`}>
            <Icons.PowerOff size={14} />
          </button>
        )}
        {!w.is_system && (
          <button className="starbar-icon" style={{ width: 32, height: 32, color: STATUS_COLORS.disabled }} onClick={onDelete} title="Delete" data-testid={`widget-delete-${w.key}`}>
            <Icons.Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function WidgetEditor({ initial, isStealth, onClose, onSaved }) {
  const isNew = !initial;
  // System widgets and non-stealth admins use this lightweight editor.
  // Stealth-only fields are disabled for non-stealth viewers.
  const contentLocked = !isStealth;
  const [form, setForm] = useState(() => ({
    key: initial?.key || "",
    name: initial?.name || "",
    widget_type: initial?.widget_type || "profile",
    category: initial?.category || "custom",
    icon: initial?.icon || "Sparkles",
    description: initial?.description || "",
    status: initial?.status || "draft",
    access_groups: initial?.access_groups || ["all_users"],
    placements: initial?.placements || ["profile"],
    default_size: initial?.default_size || "medium",
    allowed_sizes: initial?.allowed_sizes || ["small", "medium", "large", "xl"],
    sort_order: initial?.sort_order ?? 100,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (key, value) => setForm((f) => ({
    ...f,
    [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
  }));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      // Non-stealth admins can only flip placement/access/status/
      // sort/allowed_sizes — strip content fields so the backend
      // gate doesn't 403 on an accidental include.
      let payload = form;
      if (contentLocked && !isNew) {
        const { placements, access_groups, allowed_sizes, status, sort_order } = form;
        payload = { placements, access_groups, allowed_sizes, status, sort_order };
      }
      if (isNew) {
        await apiClient.post("/admin/widgets", form);
      } else {
        await apiClient.patch(`/admin/widgets/${initial.id}`, payload);
      }
      onSaved();
    } catch (e) {
      setError(e?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="widget-editor"
    >
      <div className="or-surface w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>
            {isNew ? "Create Widget" : `Edit · ${initial.name}`}
          </h2>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose}><Icons.X size={14} /></button>
        </div>
        {initial?.is_system && (
          <div className="text-[11px] mb-3 px-3 py-2 rounded" style={{ background: "color-mix(in srgb, var(--brand-green) 14%, transparent)", color: "var(--brand-green)" }}>
            System widget — key is locked. You can edit display + access + placement freely.
          </div>
        )}
        {contentLocked && !initial?.is_system && (
          <div className="text-[11px] mb-3 px-3 py-2 rounded" style={{ background: "color-mix(in srgb, var(--brand-green) 12%, transparent)", color: "var(--brand-green)" }}>
            Founder-only fields locked. You can still adjust placement, access, sizes, status, and sort order.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Widget Name">
            <input className="or-input w-full" value={form.name} disabled={contentLocked} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="widget-form-name" />
          </Field>
          <Field label="Unique Key">
            <input className="or-input w-full" value={form.key} disabled={!isNew} onChange={(e) => setForm({ ...form, key: e.target.value })} data-testid="widget-form-key" placeholder="snake_case" />
          </Field>
          <Field label="Category">
            <input className="or-input w-full" value={form.category} disabled={contentLocked} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="widget-form-category" />
          </Field>
          <Field label="Icon">
            <select className="or-input w-full" value={form.icon} disabled={contentLocked} onChange={(e) => setForm({ ...form, icon: e.target.value })} data-testid="widget-form-icon">
              {ICON_CHOICES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Default Size">
            <select className="or-input w-full" value={form.default_size} disabled={contentLocked} onChange={(e) => setForm({ ...form, default_size: e.target.value })} data-testid="widget-form-default-size">
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Sort Order">
            <input type="number" className="or-input w-full" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })} data-testid="widget-form-sort" />
          </Field>
          <Field label="Description" full>
            <textarea className="or-input w-full" rows={2} value={form.description} disabled={contentLocked} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="widget-form-description" />
          </Field>
          <Field label="Placements" full>
            <CheckboxGroup options={PLACEMENTS} selected={form.placements} onToggle={(v) => toggle("placements", v)} testidPrefix="widget-form-placement" />
          </Field>
          <Field label="Access Groups" full>
            <CheckboxGroup options={ACCESS_GROUPS} selected={form.access_groups} onToggle={(v) => toggle("access_groups", v)} testidPrefix="widget-form-access" />
          </Field>
          <Field label="Allowed Sizes" full>
            <CheckboxGroup options={SIZES.map((s) => ({ id: s, label: s }))} selected={form.allowed_sizes} onToggle={(v) => toggle("allowed_sizes", v)} testidPrefix="widget-form-size" />
          </Field>
          <Field label="Status" full>
            <div className="flex gap-2">
              {["draft", "live", "disabled"].map((s) => (
                <button key={s} type="button"
                  onClick={() => setForm({ ...form, status: s })}
                  className="px-3 py-1.5 text-xs uppercase tracking-widest font-bold rounded"
                  style={{
                    background: form.status === s ? STATUS_COLORS[s] : "var(--surface-2)",
                    color: form.status === s ? "#000" : "var(--text-muted)",
                  }}
                  data-testid={`widget-form-status-${s}`}
                >{s}</button>
              ))}
            </div>
          </Field>
        </div>
        {error && <div className="text-xs mt-3" style={{ color: STATUS_COLORS.disabled }} data-testid="widget-form-error">{error}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="or-btn or-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="or-btn or-btn-primary" onClick={save} disabled={busy || !form.key || !form.name} data-testid="widget-form-save">
            {busy ? <Icons.Loader2 size={14} className="animate-spin" /> : <Icons.Save size={14} />} Save Widget
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BADGES TAB
// ─────────────────────────────────────────────────────────────────────

function BadgesTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [assigner, setAssigner] = useState(null);
  const [filters, setFilters] = useState({ status: "", access_group: "", q: "" });
  const [reconcileResult, setReconcileResult] = useState(null);
  const [reconciling, setReconciling] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const { data } = await apiClient.get(`/admin/badges?${params}`);
      setItems(data?.badges || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { reload(); }, [reload]);

  const launch = async (id) => { await apiClient.post(`/admin/badges/${id}/launch`); await reload(); };
  const disable = async (id) => { await apiClient.post(`/admin/badges/${id}/disable`); await reload(); };
  const remove = async (id, name) => {
    if (!window.confirm(`Delete badge "${name}"? This removes all assignments.`)) return;
    await apiClient.delete(`/admin/badges/${id}`);
    await reload();
  };

  // Phase 3.2 — Run the full reconciliation engine across every live
  // badge. Optionally prune recipients that no longer qualify.
  const reconcile = async ({ prune } = {}) => {
    const verb = prune ? "Reconcile + prune" : "Reconcile";
    if (!window.confirm(
      `${verb} live badges?\n\n` +
      (prune
        ? "This will ADD missing assignments AND REMOVE assignments whose recipient no longer qualifies (locked badges like FOUNDER are skipped)."
        : "This will ADD missing assignments under each live badge's current rule. No recipients are removed.")
    )) return;
    setReconciling(true);
    try {
      const { data } = await apiClient.post(
        `/admin/badges/reconcile${prune ? "?prune=true" : ""}`
      );
      setReconcileResult(data);
    } catch (e) {
      window.alert(`Reconcile failed: ${e?.response?.data?.detail || e?.message || "unknown"}`);
    } finally {
      setReconciling(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4 items-center" data-testid="badges-filter-bar">
        <input
          className="or-input flex-1 min-w-[180px] text-sm"
          placeholder="Search badges…"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          data-testid="badges-search"
        />
        <FilterSelect
          value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={[["", "All status"], ["live", "Live"], ["draft", "Draft"], ["disabled", "Disabled"]]}
          testid="badges-filter-status"
        />
        <button className="or-btn or-btn-secondary" onClick={() => reconcile({ prune: false })} disabled={reconciling} data-testid="badges-reconcile">
          {reconciling ? <Icons.Loader2 size={14} className="animate-spin" /> : <Icons.RefreshCw size={14} />} Reconcile Live Badges
        </button>
        <button className="or-btn or-btn-primary" onClick={() => setEditor("new")} data-testid="badges-create">
          <Icons.Plus size={14} /> Create Badge
        </button>
      </div>
      {loading ? (
        <div className="text-center p-8"><Icons.Loader2 className="animate-spin inline" /></div>
      ) : items.length === 0 ? (
        <div className="or-surface p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>No badges yet.</div>
      ) : (
        <div className="space-y-2" data-testid="badges-list">
          {items.map((b) => <BadgeRow key={b.id} b={b} onEdit={() => setEditor(b)} onAssign={() => setAssigner(b)} onLaunch={() => launch(b.id)} onDisable={() => disable(b.id)} onDelete={() => remove(b.id, b.name)} />)}
        </div>
      )}
      {editor && <BadgeEditor initial={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); reload(); }} />}
      {assigner && <BadgeAssigner badge={assigner} onClose={() => setAssigner(null)} />}
      {reconcileResult && (
        <ReconcileResultModal
          result={reconcileResult}
          onClose={() => { setReconcileResult(null); reload(); }}
        />
      )}
    </>
  );
}

function ReconcileResultModal({ result, onClose }) {
  // Sort badges by `assigned` desc so the most-impactful changes
  // surface first. Show every badge even if 0 — it's reassuring to
  // confirm the engine ran across the whole catalog.
  const rows = [...(result?.badges || [])].sort((a, b) => (b.assigned || 0) - (a.assigned || 0));
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="badge-reconcile-result"
    >
      <div className="or-surface p-5 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div className="rounded-full p-2" style={{ background: "color-mix(in srgb, var(--brand-green) 18%, transparent)", color: "var(--brand-green)" }}>
            <Icons.CheckCircle size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-base">Live Badges Reconciled</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {result.badges_processed} badges processed · {result.new_assignments} new assignments
              {result.pruned ? ` · ${result.pruned} pruned` : ""}
            </div>
          </div>
        </div>
        <div className="space-y-1 mt-3" data-testid="badge-reconcile-rows">
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center justify-between py-1.5 px-2 rounded text-xs"
              style={{ background: r.error ? "rgba(255,90,107,0.12)" : (r.assigned > 0 ? "color-mix(in srgb, var(--brand-green) 10%, transparent)" : "var(--surface-2)") }}
            >
              <span className="font-bold uppercase tracking-wider truncate">{r.badge || r.key}</span>
              <span style={{ color: r.error ? "#FF5A6B" : (r.assigned > 0 ? "var(--brand-green)" : "var(--text-muted)") }}>
                {r.error
                  ? `ERR · ${r.error}`
                  : (r.pruned > 0
                    ? `+${r.assigned} · −${r.pruned}`
                    : `+${r.assigned}`)}
              </span>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="or-btn or-btn-primary mt-4 w-full justify-center" data-testid="badge-reconcile-close">
          Close
        </button>
      </div>
    </div>
  );
}

function BadgeRow({ b, onEdit, onAssign, onLaunch, onDisable, onDelete }) {
  const Icon = Icons[b.icon] || Icons.Award;
  return (
    <div
      className="or-surface p-3 flex items-center gap-3"
      style={{ borderLeft: `3px solid ${STATUS_COLORS[b.status] || "var(--border-col)"}` }}
      data-testid={`badge-row-${b.key}`}
    >
      <div className="rounded-full p-2 shrink-0" style={{ background: `${b.color}22`, color: b.color }}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold" style={{ color: "var(--text-main)" }}>{b.name}</span>
          <code className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>{b.key}</code>
          <StatusPill status={b.status} />
        </div>
        <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
          {b.assignment_type} · {(b.access_groups || []).join(", ")} {b.selected_usernames?.length ? `· ${b.selected_usernames.length} users` : ""}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onAssign} title="Assign to users" data-testid={`badge-assign-${b.key}`}>
          <Icons.UserPlus size={14} />
        </button>
        <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onEdit} title="Edit" data-testid={`badge-edit-${b.key}`}>
          <Icons.Pencil size={14} />
        </button>
        {b.status !== "live" && (
          <button className="starbar-icon" style={{ width: 32, height: 32, color: STATUS_COLORS.live }} onClick={onLaunch} data-testid={`badge-launch-${b.key}`} title="Launch">
            <Icons.Rocket size={14} />
          </button>
        )}
        {b.status !== "disabled" && (
          <button className="starbar-icon" style={{ width: 32, height: 32, color: STATUS_COLORS.disabled }} onClick={onDisable} data-testid={`badge-disable-${b.key}`} title="Disable">
            <Icons.PowerOff size={14} />
          </button>
        )}
        <button className="starbar-icon" style={{ width: 32, height: 32, color: STATUS_COLORS.disabled }} onClick={onDelete} data-testid={`badge-delete-${b.key}`} title="Delete">
          <Icons.Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function BadgeEditor({ initial, onClose, onSaved }) {
  const isNew = !initial;
  const [form, setForm] = useState(() => ({
    key: initial?.key || "",
    name: initial?.name || "",
    icon: initial?.icon || "Award",
    color: initial?.color || "#00FF66",
    // Phase 3.7 (Feb 28, 2026) — full visual surface for founders.
    // Every styling property is editable for every badge (including
    // locked system badges like FOUNDER / VIP). Empty strings are
    // normalised to null on save so the ProfileBadges renderer
    // fallback chain takes over cleanly.
    bg_color: initial?.bg_color || "",
    gradient: initial?.gradient || "",
    text_color: initial?.text_color || "",
    border_color: initial?.border_color || "",
    glow_color: initial?.glow_color || "",
    description: initial?.description || "",
    status: initial?.status || "draft",
    assignment_type: initial?.assignment_type || "manual",
    access_groups: initial?.access_groups || ["all_users"],
    selected_usernames: initial?.selected_usernames || [],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (key, value) => setForm((f) => ({
    ...f,
    [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
  }));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      // Normalise every visual string field — backend converts "" → null
      // and we want the network payload to reflect that intent
      // explicitly. Sending null lets the ProfileBadges fallback chain
      // (`b.border_color || accent`) restore the legacy single-accent
      // look when a colour is cleared.
      const payload = { ...form };
      for (const k of ["bg_color", "gradient", "text_color", "border_color", "glow_color"]) {
        if (!payload[k]) payload[k] = null;
      }
      if (isNew) await apiClient.post("/admin/badges", payload);
      else await apiClient.patch(`/admin/badges/${initial.id}`, payload);
      onSaved();
    } catch (e) { setError(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="badge-editor"
    >
      <div className="or-surface w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>
            {isNew ? "Create Badge" : `Edit · ${initial.name}`}
          </h2>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Badge Name">
            <input className="or-input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="badge-form-name" />
          </Field>
          <Field label="Unique Key">
            <input className="or-input w-full" value={form.key} disabled={!isNew} onChange={(e) => setForm({ ...form, key: e.target.value })} data-testid="badge-form-key" placeholder="snake_case" />
          </Field>
          <Field label="Icon">
            <select className="or-input w-full" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} data-testid="badge-form-icon">
              {ICON_CHOICES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Color (hex)">
            <ColorPicker
              value={form.color}
              onChange={(v) => setForm((f) => ({ ...f, color: v }))}
              testid="badge-form-color"
              placeholder="#00FF66"
            />
          </Field>
          <Field label="Background color (optional)">
            <ColorPicker
              value={form.bg_color}
              onChange={(v) => setForm((f) => ({ ...f, bg_color: v }))}
              testid="badge-form-bg-color"
              placeholder={form.color || "#00FF66"}
              clearable
            />
          </Field>
          <Field label="Border color (optional)">
            <ColorPicker
              value={form.border_color}
              onChange={(v) => setForm((f) => ({ ...f, border_color: v }))}
              testid="badge-form-border-color"
              placeholder={form.color || "#00FF66"}
              clearable
            />
          </Field>
          <Field label="Text color (optional)">
            <ColorPicker
              value={form.text_color}
              onChange={(v) => setForm((f) => ({ ...f, text_color: v }))}
              testid="badge-form-text-color"
              placeholder="#0a0a0a"
              clearable
            />
          </Field>
          <Field label="Description" full>
            <textarea className="or-input w-full" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="badge-form-description" />
          </Field>
          <Field label="Gradient (optional)" full>
            <GradientPicker
              value={form.gradient}
              onChange={(v) => setForm((f) => ({ ...f, gradient: v }))}
              fallbackColor={form.color}
              testidPrefix="badge-form-gradient"
            />
          </Field>
          <Field label="Glow (optional)">
            <ColorPicker
              value={form.glow_color}
              onChange={(v) => setForm((f) => ({ ...f, glow_color: v }))}
              testid="badge-form-glow"
              placeholder={form.color || "#00FF66"}
              clearable
            />
          </Field>
          <Field label="Preview">
            <BadgePreview form={form} />
          </Field>
          <Field label="Assignment Type">
            <select className="or-input w-full" value={form.assignment_type} onChange={(e) => setForm({ ...form, assignment_type: e.target.value })} data-testid="badge-form-assign-type">
              <option value="manual">Manual</option>
              <option value="founder">Founder only</option>
              <option value="admin">Admin only</option>
              <option value="vip">VIP only</option>
              <option value="standard">Standard users</option>
              <option value="all">All users</option>
              <option value="first_x">First X users</option>
              <option value="specific">Specific usernames</option>
            </select>
          </Field>
          <Field label="Status">
            <div className="flex gap-2">
              {["draft", "live", "disabled"].map((s) => (
                <button key={s} type="button"
                  onClick={() => setForm({ ...form, status: s })}
                  className="px-3 py-1.5 text-xs uppercase tracking-widest font-bold rounded"
                  style={{
                    background: form.status === s ? STATUS_COLORS[s] : "var(--surface-2)",
                    color: form.status === s ? "#000" : "var(--text-muted)",
                  }}
                  data-testid={`badge-form-status-${s}`}
                >{s}</button>
              ))}
            </div>
          </Field>
          <Field label="Access Groups" full>
            <CheckboxGroup options={ACCESS_GROUPS} selected={form.access_groups} onToggle={(v) => toggle("access_groups", v)} testidPrefix="badge-form-access" />
          </Field>
        </div>
        {error && <div className="text-xs mt-3" style={{ color: STATUS_COLORS.disabled }} data-testid="badge-form-error">{error}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="or-btn or-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="or-btn or-btn-primary" onClick={save} disabled={busy || !form.key || !form.name} data-testid="badge-form-save">
            {busy ? <Icons.Loader2 size={14} className="animate-spin" /> : <Icons.Save size={14} />} Save Badge
          </button>
        </div>
      </div>
    </div>
  );
}

function BadgeAssigner({ badge, onClose }) {
  const [raw, setRaw] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [loadingR, setLoadingR] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadRecipients = useCallback(async () => {
    setLoadingR(true);
    try {
      const { data } = await apiClient.get(`/admin/badges/${badge.id}/recipients`);
      setRecipients(data?.recipients || []);
    } catch (e) { console.error(e); }
    finally { setLoadingR(false); }
  }, [badge.id]);
  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  const parseUsernames = () => raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);

  const assign = async () => {
    const usernames = parseUsernames();
    if (!usernames.length) return;
    setBusy(true); setMsg(null);
    try {
      const { data } = await apiClient.post(`/admin/badges/${badge.id}/assign`, { usernames });
      setMsg(`Assigned to ${data.assigned} user(s)`);
      setRaw("");
      await loadRecipients();
    } catch (e) { setMsg(e?.response?.data?.detail || "Assign failed"); }
    finally { setBusy(false); }
  };
  const removeUser = async (uname) => {
    setBusy(true);
    try {
      await apiClient.post(`/admin/badges/${badge.id}/remove`, { usernames: [uname] });
      await loadRecipients();
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="badge-assigner"
    >
      <div className="or-surface w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Assign · {badge.name}</h2>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <Field label="Usernames (comma or space separated)" full>
          <textarea className="or-input w-full" rows={3} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="stealth, tftwo, @tfone" data-testid="badge-assign-usernames" />
        </Field>
        <button className="or-btn or-btn-primary" onClick={assign} disabled={busy || !raw.trim()} data-testid="badge-assign-submit">
          {busy ? <Icons.Loader2 size={14} className="animate-spin" /> : <Icons.UserPlus size={14} />} Assign
        </button>
        {msg && <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{msg}</div>}
        <div className="mt-5">
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
            Current Recipients ({recipients.length})
          </div>
          {loadingR ? (
            <div className="text-center p-4"><Icons.Loader2 className="animate-spin inline" /></div>
          ) : recipients.length === 0 ? (
            <div className="text-xs italic" style={{ color: "var(--text-muted)" }}>No recipients yet.</div>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto" data-testid="badge-recipients-list">
              {recipients.map((r) => (
                <div key={r.username} className="flex items-center gap-2 p-2 rounded" style={{ background: "var(--surface-2)" }}>
                  <Icons.User size={14} style={{ color: "var(--text-muted)" }} />
                  <span className="text-sm flex-1" style={{ color: "var(--text-main)" }}>@{r.username}</span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{r.assigned_at?.slice(0, 10)}</span>
                  <button className="starbar-icon" style={{ width: 26, height: 26, color: STATUS_COLORS.disabled }} onClick={() => removeUser(r.username)} data-testid={`badge-recipient-remove-${r.username}`}>
                    <Icons.X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────

function Field({ label, full, children }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      {children}
    </label>
  );
}

function CheckboxGroup({ options, selected, onToggle, testidPrefix }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} type="button"
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

function FilterSelect({ value, onChange, options, testid }) {
  return (
    <select
      className="or-input text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testid}
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function StatusPill({ status }) {
  return (
    <span
      className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full font-bold"
      style={{ background: `${STATUS_COLORS[status]}22`, color: STATUS_COLORS[status] }}
    >
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Badge visual pickers (Phase X, Feb 28, 2026)
// Pairs an HTML <input type="color"> with a hex text input so admins
// can either pick from the system colour picker or paste a brand hex.
// ─────────────────────────────────────────────────────────────────────
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normaliseHex(v) {
  if (!v) return "";
  const t = v.trim();
  if (!t) return "";
  return t.startsWith("#") ? t : `#${t}`;
}

function ColorPicker({ value, onChange, testid, placeholder, clearable }) {
  // The native <input type=color> requires a valid #rrggbb. We mirror
  // the text value into a swatch input but fall back to a sensible
  // default when the typed value isn't a complete hex yet.
  const safe = HEX_RE.test(value || "") ? normaliseHex(value) : "#00FF66";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="shrink-0 rounded cursor-pointer"
        style={{
          width: 38, height: 38, padding: 0, border: "1px solid var(--border-col)",
          background: "var(--surface-2)",
        }}
        aria-label="Pick colour"
        data-testid={`${testid}-swatch`}
      />
      <input
        type="text"
        className="or-input flex-1"
        value={value || ""}
        placeholder={placeholder || "#RRGGBB"}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
      />
      {clearable && value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="starbar-icon shrink-0"
          style={{ width: 32, height: 32 }}
          title="Clear"
          aria-label="Clear"
          data-testid={`${testid}-clear`}
        >
          <Icons.X size={14} />
        </button>
      ) : null}
    </div>
  );
}

const GRADIENT_PRESETS = [
  { label: "Gold",   css: "linear-gradient(135deg, #F4C84A 0%, #B58B17 100%)" },
  { label: "Green",  css: "linear-gradient(135deg, #00FF66 0%, #10E670 100%)" },
  { label: "Blue",   css: "linear-gradient(135deg, #2EA0FF 0%, #6CC4FF 100%)" },
  { label: "Sunset", css: "linear-gradient(135deg, #FF8A00 0%, #FF3D7F 100%)" },
  { label: "Violet", css: "linear-gradient(135deg, #7A5CFF 0%, #C04CFF 100%)" },
  { label: "Ocean",  css: "linear-gradient(135deg, #0EA5E9 0%, #22D3EE 100%)" },
];

function GradientPicker({ value, onChange, fallbackColor, testidPrefix }) {
  // Builder state: two colour stops + an angle. Whenever the builder
  // changes, we emit a canonical `linear-gradient(...)` CSS string up
  // to the parent form. Admins can also paste a CSS string directly.
  const parsed = parseLinearGradient(value);
  const fromInit = parsed.from || fallbackColor || "#00FF66";
  const toInit   = parsed.to   || fallbackColor || "#10E670";
  const angleInit = parsed.angle ?? 135;

  const [from, setFrom] = useState(fromInit);
  const [to, setTo] = useState(toInit);
  const [angle, setAngle] = useState(angleInit);

  // Keep local builder state in sync with the canonical value.
  useEffect(() => {
    const p = parseLinearGradient(value);
    if (p.from) setFrom(p.from);
    if (p.to) setTo(p.to);
    if (typeof p.angle === "number") setAngle(p.angle);
  }, [value]);

  const emit = (nextFrom, nextTo, nextAngle) => {
    const css = `linear-gradient(${nextAngle}deg, ${normaliseHex(nextFrom)} 0%, ${normaliseHex(nextTo)} 100%)`;
    onChange(css);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>From</div>
          <ColorPicker
            value={from}
            onChange={(v) => { setFrom(v); emit(v, to, angle); }}
            testid={`${testidPrefix}-from`}
          />
        </label>
        <label className="block">
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>To</div>
          <ColorPicker
            value={to}
            onChange={(v) => { setTo(v); emit(from, v, angle); }}
            testid={`${testidPrefix}-to`}
          />
        </label>
        <label className="block">
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Angle ({angle}°)</div>
          <input
            type="range"
            min={0}
            max={360}
            step={5}
            value={angle}
            onChange={(e) => { const a = Number(e.target.value); setAngle(a); emit(from, to, a); }}
            className="w-full"
            data-testid={`${testidPrefix}-angle`}
          />
        </label>
      </div>
      <input
        type="text"
        className="or-input w-full"
        placeholder="linear-gradient(135deg, #00FF66 0%, #10E670 100%)"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`${testidPrefix}-css`}
      />
      <div className="flex flex-wrap gap-1.5">
        {GRADIENT_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.css)}
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded"
            style={{
              background: p.css,
              color: "#0a0a0a",
              border: "1px solid var(--border-col)",
            }}
            title={`Apply ${p.label} gradient`}
            data-testid={`${testidPrefix}-preset-${p.label.toLowerCase()}`}
          >
            {p.label}
          </button>
        ))}
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
            data-testid={`${testidPrefix}-clear`}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function parseLinearGradient(css) {
  if (!css || typeof css !== "string") return {};
  // Match the canonical pattern we emit. Hand-written CSS that doesn't
  // match still round-trips via the raw textarea — the builder simply
  // doesn't pre-fill in that case.
  const m = css.match(/linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#[0-9a-fA-F]{6})[^,]*,\s*(#[0-9a-fA-F]{6})/i);
  if (!m) return {};
  return { angle: Number(m[1]), from: m[2].toUpperCase(), to: m[3].toUpperCase() };
}

function BadgePreview({ form }) {
  // Mirrors ProfileBadges.BadgePill so admins see the exact rendered
  // pill before saving. Background = gradient → bg_color → solid color.
  // Border / glow / text follow the same fallback chain the runtime
  // renderer uses, so the preview is always truthful.
  const Icon = Icons[form.icon] || Icons.Award;
  const accent = form.color || "#00FF66";
  const bg = form.gradient || form.bg_color || accent;
  const fg = form.text_color || "#0a0a0a";
  const border = form.border_color || accent;
  const glow = form.glow_color || accent;
  return (
    <div className="flex items-center" data-testid="badge-form-preview">
      <span
        className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-1 rounded-md whitespace-nowrap"
        style={{
          background: bg,
          color: fg,
          border: `1px solid ${border}`,
          boxShadow: `0 0 12px color-mix(in srgb, ${glow} 35%, transparent)`,
        }}
      >
        <Icon size={11} strokeWidth={2.5} /> {form.name || "Badge name"}
      </span>
    </div>
  );
}
