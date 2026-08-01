import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, LayoutTemplate, Plus, Eye, Pencil, Copy, Trash2, History, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_COLORS = {
  published: "#7BD88F", draft: "#5AB2FF", review: "#F4C84A",
  disabled: "#FF8A5A", archived: "#9AA7BD",
};
const CENTER_TYPES = ["personal", "family", "education", "business", "organization",
  "church", "sports", "community", "volunteer", "team", "other"];
const UNIT_TYPES = ["group", "department", "division", "team", "committee", "ministry",
  "class", "grade", "household", "project", "volunteer"];
const WIDGET_KEYS = ["center_status", "my_work", "due_today", "overdue", "pending_approvals",
  "upcoming_calendar", "unit_summary", "member_summary", "vault_balance", "recent_activity",
  "attendance_summary", "birthdays_upcoming"];
const fmt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

const StatusBadge = ({ status }) => (
  <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
    style={{ background: `${STATUS_COLORS[status] || "#9AA7BD"}22`, color: STATUS_COLORS[status] || "#9AA7BD" }}
    data-testid={`rc-tpl-status-${status}`}>{status}</span>
);

// Bundle G — Admin Template Manager. System templates are code-managed
// (status + duplicate only); admin templates are fully editable drafts.
export default function AdminRcTemplates({ mode = "list" }) {
  const navigate = useNavigate();
  const { templateId } = useParams();
  const base = "/admin/responsibility-center/templates";
  return (
    <div className="max-w-5xl mx-auto" data-testid="rc-admin-templates-page">
      <button className="or-btn or-btn-ghost mb-4" onClick={() => navigate(mode === "list" ? "/admin/responsibility-center" : base)}
        data-testid="rc-tpl-back">
        <ChevronLeft size={14} /> {mode === "list" ? "Responsibility Center Admin" : "All templates"}
      </button>
      {mode === "list" && <TemplateList navigate={navigate} base={base} />}
      {mode === "create" && <TemplateForm navigate={navigate} base={base} />}
      {mode === "edit" && <TemplateForm navigate={navigate} base={base} templateKey={templateId} />}
      {mode === "detail" && <TemplateDetail navigate={navigate} base={base} templateKey={templateId} />}
      {mode === "preview" && <TemplatePreview navigate={navigate} base={base} templateKey={templateId} />}
    </div>
  );
}

function TemplateList({ navigate, base }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    apiClient.get("/admin/responsibility-center/templates/manage")
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load templates"));
  }, []);
  if (err) return <div className="or-surface p-6 text-sm" style={{ color: "#FF6B6B" }} data-testid="rc-tpl-list-error">{err}</div>;
  if (!data) return <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}>Loading templates…</div>;
  return (
    <div data-testid="rc-tpl-list">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
          <LayoutTemplate size={22} className="inline mr-2" style={{ color: "var(--primary)" }} /> Center Templates
        </h1>
        <button className="or-btn" onClick={() => navigate(`${base}/create`)} data-testid="rc-tpl-create-btn">
          <Plus size={14} /> New template
        </button>
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        Publishing a new version never changes existing Centers — they keep the version they applied.
      </div>
      <div className="space-y-2">
        {(data.templates || []).map((t) => (
          <button key={t.template_key} className="or-surface p-4 w-full text-left flex flex-wrap items-center gap-3"
            onClick={() => navigate(`${base}/${t.template_key}`)} data-testid={`rc-tpl-row-${t.template_key}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{t.name}</span>
                <StatusBadge status={t.status} />
                <span className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>{t.source} · v{t.version}</span>
              </div>
              <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{t.short_description}</div>
            </div>
            <div className="text-xs shrink-0" style={{ color: "var(--text-muted)" }} data-testid={`rc-tpl-usage-${t.template_key}`}>
              {t.centers_using} Center{t.centers_using === 1 ? "" : "s"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TemplateDetail({ navigate, base, templateKey }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    apiClient.get(`/admin/responsibility-center/templates/manage/${templateKey}`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load this template"));
  }, [templateKey]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="or-surface p-6 text-sm" style={{ color: "#FF6B6B" }} data-testid="rc-tpl-detail-error">{err}</div>;
  if (!data) return <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  const { template: t, source, status, versions, audit, centers_using } = data;

  const act = async (action, promptText, isPublish = false) => {
    const reason = window.prompt(promptText);
    if (!reason || !reason.trim()) { if (reason !== null) toast.error("A reason is required"); return; }
    if (isPublish && !window.confirm(`Publish "${t.name}"? Existing Centers keep their current version — only new setups get this one.`)) return;
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/responsibility-center/templates/manage/${templateKey}/status`,
        { action, reason: reason.trim(), change_summary: reason.trim() });
      toast.success(`Template ${r.data.status}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/responsibility-center/templates/manage/${templateKey}/duplicate`);
      toast.success("Duplicated as a new draft");
      navigate(`${base}/${r.data.template_key}/edit`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Duplicate failed"); }
    finally { setBusy(false); }
  };

  const canEdit = source === "admin" && (status === "draft" || status === "review");
  return (
    <div className="space-y-4" data-testid="rc-tpl-detail">
      <div className="or-surface p-5">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h1 className="text-2xl" style={{ fontFamily: "var(--font-display)" }} data-testid="rc-tpl-detail-name">{t.name}</h1>
          <StatusBadge status={status} />
          <span className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>{source} · v{t.version || 0}</span>
        </div>
        <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>{t.short_description}</p>
        <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }} data-testid="rc-tpl-detail-usage">
          Used by <b style={{ color: "var(--text-main)" }}>{centers_using}</b> Center{centers_using === 1 ? "" : "s"} ·
          Audience: {t.recommended_audience || "—"} · Type: {t.center_type}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`${base}/${templateKey}/preview`)} data-testid="rc-tpl-preview-btn">
            <Eye size={12} /> Preview
          </button>
          {canEdit && (
            <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`${base}/${templateKey}/edit`)} data-testid="rc-tpl-edit-btn">
              <Pencil size={12} /> Edit
            </button>
          )}
          <button className="or-btn or-btn-ghost text-xs" disabled={busy} onClick={duplicate} data-testid="rc-tpl-duplicate-btn">
            <Copy size={12} /> Duplicate
          </button>
          {source === "admin" && status === "draft" && (
            <button className="or-btn or-btn-ghost text-xs" disabled={busy}
              onClick={() => act("review", "Note for the review step:")} data-testid="rc-tpl-review-btn">Move to Review</button>
          )}
          {status !== "published" && (
            <button className="or-btn text-xs" disabled={busy}
              onClick={() => act("publish", "Change summary for this version (required):", true)} data-testid="rc-tpl-publish-btn">
              <CheckCircle2 size={12} /> Publish
            </button>
          )}
          {status === "published" && (
            <button className="or-btn or-btn-ghost text-xs" disabled={busy}
              onClick={() => act("disable", "Why is this template being disabled? (required)")} data-testid="rc-tpl-disable-btn">Disable</button>
          )}
          {status !== "archived" && (
            <button className="or-btn or-btn-ghost text-xs" disabled={busy}
              onClick={() => act("archive", "Why is this template being archived? (required)")} data-testid="rc-tpl-archive-btn">
              <Trash2 size={12} /> Archive
            </button>
          )}
        </div>
        {(status === "disabled" || status === "archived") && (
          <div className="text-[11px] mt-2" style={{ color: "#FF8A5A" }} data-testid="rc-tpl-disabled-note">
            Hidden from new Center setups. Centers already using it keep working normally.
          </div>
        )}
        {source === "system" && (
          <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
            System templates are code-managed. Duplicate one to create an editable copy.
          </div>
        )}
      </div>

      <div className="or-surface p-4 grid sm:grid-cols-2 gap-3 text-xs" data-testid="rc-tpl-detail-content">
        <div>
          <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Starter {t.unit_label || "Groups"}</div>
          {(t.units || []).length ? (t.units || []).map((u) => <div key={u.name}>• {u.name} ({u.unit_type})</div>)
            : <div style={{ color: "var(--text-muted)" }}>None</div>}
        </div>
        <div>
          <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Starter items</div>
          {(t.starter_items || []).length ? (t.starter_items || []).map((it) => <div key={it.title}>• {it.title} ({it.item_type})</div>)
            : <div style={{ color: "var(--text-muted)" }}>None</div>}
        </div>
        <div>
          <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Categories</div>
          <div>{(t.categories || []).join(", ") || "—"}</div>
        </div>
        <div>
          <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Dashboard widgets</div>
          <div>{(t.default_widgets || []).join(", ") || "—"}</div>
        </div>
      </div>

      {!!(versions || []).length && (
        <div className="or-surface p-4" data-testid="rc-tpl-versions">
          <div className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1"><History size={12} /> Version history</div>
          {versions.slice().reverse().map((v) => (
            <div key={v.version} className="text-xs py-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <b>v{v.version}</b> — {v.change_summary} <span style={{ color: "var(--text-muted)" }}>· @{v.published_by} · {fmt(v.published_at)}</span>
            </div>
          ))}
        </div>
      )}

      {!!(audit || []).length && (
        <div className="or-surface p-4" data-testid="rc-tpl-audit">
          <div className="text-xs font-semibold uppercase tracking-wide mb-2">Change history</div>
          {audit.map((a) => (
            <div key={a.id} className="text-xs py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <b className="uppercase">{a.action}</b>{a.version ? ` v${a.version}` : ""} — {a.detail || "—"}
              <span style={{ color: "var(--text-muted)" }}> · @{a.actor_username} · {fmt(a.at)}</span>
            </div>
          ))}
        </div>
      )}

      {user?.admin_role === "founder" && (
        <details className="or-surface p-4" data-testid="rc-tpl-advanced-json">
          <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer">Advanced — raw definition (read-only, founder only)</summary>
          <pre className="text-[10px] mt-2 overflow-x-auto" style={{ color: "var(--text-muted)" }}>{JSON.stringify(t, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function TemplateForm({ navigate, base, templateKey }) {
  const editing = !!templateKey;
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!editing) {
      setF({ name: "", center_type: "other", short_description: "", recommended_audience: "",
        unit_label: "Groups", categories: [], units: [], starter_items: [],
        default_widgets: ["center_status", "my_work", "recent_activity"],
        default_settings: { allow_member_self_tasks: null, attendance_default: false } });
      return;
    }
    apiClient.get(`/admin/responsibility-center/templates/manage/${templateKey}`)
      .then((r) => setF({ ...r.data.template }))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load this template"));
  }, [editing, templateKey]);
  if (err) return <div className="or-surface p-6 text-sm" style={{ color: "#FF6B6B" }}>{err}</div>;
  if (!f) return <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>;

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, center_type: f.center_type, short_description: f.short_description,
        recommended_audience: f.recommended_audience, unit_label: f.unit_label,
        categories: f.categories, units: f.units, starter_items: f.starter_items,
        default_widgets: f.default_widgets, default_settings: f.default_settings };
      if (editing) {
        await apiClient.patch(`/admin/responsibility-center/templates/manage/${templateKey}`, body);
        toast.success("Template saved");
        navigate(`${base}/${templateKey}`);
      } else {
        const r = await apiClient.post("/admin/responsibility-center/templates/manage", body);
        toast.success("Draft created");
        navigate(`${base}/${r.data.template_key}`);
      }
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="or-surface p-5 space-y-4" data-testid="rc-tpl-form">
      <h1 className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>{editing ? `Edit "${f.name}"` : "New template draft"}</h1>
      <div className="grid sm:grid-cols-2 gap-3 text-xs">
        <label className="block">
          <span style={{ color: "var(--text-muted)" }}>Name *</span>
          <input className="or-input w-full mt-0.5" maxLength={60} value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="rc-tpl-form-name" />
        </label>
        <label className="block">
          <span style={{ color: "var(--text-muted)" }}>Center type</span>
          <select className="or-input w-full mt-0.5" value={f.center_type} onChange={(e) => set("center_type", e.target.value)} data-testid="rc-tpl-form-type">
            {CENTER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span style={{ color: "var(--text-muted)" }}>Short description</span>
          <input className="or-input w-full mt-0.5" maxLength={200} value={f.short_description} onChange={(e) => set("short_description", e.target.value)} data-testid="rc-tpl-form-desc" />
        </label>
        <label className="block">
          <span style={{ color: "var(--text-muted)" }}>Recommended audience</span>
          <input className="or-input w-full mt-0.5" maxLength={100} value={f.recommended_audience} onChange={(e) => set("recommended_audience", e.target.value)} data-testid="rc-tpl-form-audience" />
        </label>
        <label className="block">
          <span style={{ color: "var(--text-muted)" }}>Groups label (e.g. Classes, Ministries)</span>
          <input className="or-input w-full mt-0.5" maxLength={30} value={f.unit_label} onChange={(e) => set("unit_label", e.target.value)} data-testid="rc-tpl-form-unit-label" />
        </label>
        <label className="block sm:col-span-2">
          <span style={{ color: "var(--text-muted)" }}>Categories (comma-separated)</span>
          <input className="or-input w-full mt-0.5" value={(f.categories || []).join(", ")}
            onChange={(e) => set("categories", e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20))}
            data-testid="rc-tpl-form-categories" />
        </label>
      </div>

      <div data-testid="rc-tpl-form-units">
        <div className="text-xs font-semibold uppercase tracking-wide mb-1">Starter groups</div>
        {(f.units || []).map((u, i) => (
          <div key={i} className="flex gap-2 items-center mb-1">
            <input className="or-input flex-1 text-xs" maxLength={80} value={u.name} placeholder="Group name"
              onChange={(e) => set("units", f.units.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
              data-testid={`rc-tpl-unit-name-${i}`} />
            <select className="or-input text-xs" style={{ width: "auto" }} value={u.unit_type}
              onChange={(e) => set("units", f.units.map((x, j) => j === i ? { ...x, unit_type: e.target.value } : x))}
              data-testid={`rc-tpl-unit-type-${i}`}>
              {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="or-btn or-btn-ghost p-1.5" aria-label="Remove group"
              onClick={() => set("units", f.units.filter((_, j) => j !== i))} data-testid={`rc-tpl-unit-remove-${i}`}><Trash2 size={12} /></button>
          </div>
        ))}
        <button className="or-chip text-[11px]" onClick={() => set("units", [...(f.units || []), { name: "", unit_type: "group" }])}
          data-testid="rc-tpl-add-unit"><Plus size={11} /> Add group</button>
      </div>

      <div data-testid="rc-tpl-form-items">
        <div className="text-xs font-semibold uppercase tracking-wide mb-1">Starter work items</div>
        {(f.starter_items || []).map((it, i) => (
          <div key={i} className="flex gap-2 items-center mb-1 flex-wrap">
            <input className="or-input flex-1 text-xs" maxLength={120} value={it.title} placeholder="Item title"
              onChange={(e) => set("starter_items", f.starter_items.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
              data-testid={`rc-tpl-item-title-${i}`} />
            <select className="or-input text-xs" style={{ width: "auto" }} value={it.item_type || "task"}
              onChange={(e) => set("starter_items", f.starter_items.map((x, j) => j === i ? { ...x, item_type: e.target.value } : x))}
              data-testid={`rc-tpl-item-type-${i}`}>
              <option value="task">task</option>
              <option value="responsibility">responsibility</option>
            </select>
            <input className="or-input text-xs" style={{ width: 120 }} maxLength={40} value={it.category || ""} placeholder="Category"
              onChange={(e) => set("starter_items", f.starter_items.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}
              data-testid={`rc-tpl-item-category-${i}`} />
            <button className="or-btn or-btn-ghost p-1.5" aria-label="Remove item"
              onClick={() => set("starter_items", f.starter_items.filter((_, j) => j !== i))} data-testid={`rc-tpl-item-remove-${i}`}><Trash2 size={12} /></button>
          </div>
        ))}
        <button className="or-chip text-[11px]" onClick={() => set("starter_items", [...(f.starter_items || []), { title: "", item_type: "task", category: "" }])}
          data-testid="rc-tpl-add-item"><Plus size={11} /> Add item</button>
      </div>

      <div data-testid="rc-tpl-form-widgets">
        <div className="text-xs font-semibold uppercase tracking-wide mb-1">Default dashboard widgets</div>
        <div className="flex flex-wrap gap-1.5">
          {WIDGET_KEYS.map((w) => (
            <button key={w} className="or-chip text-[11px]" data-active={(f.default_widgets || []).includes(w)}
              onClick={() => set("default_widgets", (f.default_widgets || []).includes(w)
                ? f.default_widgets.filter((x) => x !== w) : [...(f.default_widgets || []), w])}
              data-testid={`rc-tpl-widget-${w}`}>{w.replace(/_/g, " ")}</button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-xs" data-testid="rc-tpl-form-defaults">
        <label className="block">
          <span style={{ color: "var(--text-muted)" }}>Member self-tasks default</span>
          <select className="or-input w-full mt-0.5"
            value={f.default_settings?.allow_member_self_tasks === true ? "on" : f.default_settings?.allow_member_self_tasks === false ? "off" : "unset"}
            onChange={(e) => set("default_settings", { ...f.default_settings, allow_member_self_tasks: e.target.value === "unset" ? null : e.target.value === "on" })}
            data-testid="rc-tpl-form-selftasks">
            <option value="unset">Owner decides</option>
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
        </label>
        <label className="block">
          <span style={{ color: "var(--text-muted)" }}>Attendance default on events</span>
          <select className="or-input w-full mt-0.5" value={f.default_settings?.attendance_default ? "on" : "off"}
            onChange={(e) => set("default_settings", { ...f.default_settings, attendance_default: e.target.value === "on" })}
            data-testid="rc-tpl-form-attendance">
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button className="or-btn or-btn-ghost" onClick={() => navigate(editing ? `${base}/${templateKey}` : base)} data-testid="rc-tpl-form-cancel">Cancel</button>
        <button className="or-btn" disabled={busy || !f.name.trim()} onClick={save} data-testid="rc-tpl-form-save">
          {busy ? "Saving…" : editing ? "Save changes" : "Create draft"}
        </button>
      </div>
    </div>
  );
}

function TemplatePreview({ navigate, base, templateKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    apiClient.get(`/admin/responsibility-center/templates/manage/${templateKey}`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load this template"));
  }, [templateKey]);
  if (err) return <div className="or-surface p-6 text-sm" style={{ color: "#FF6B6B" }}>{err}</div>;
  if (!data) return <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}>Loading preview…</div>;
  const t = data.template;
  return (
    <div className="space-y-3" data-testid="rc-tpl-preview-page">
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        This is exactly what a member sees when choosing this template. Previews never touch real Centers.
      </div>
      <div className="or-surface p-5">
        <div className="flex items-center gap-2 mb-1">
          <LayoutTemplate size={16} style={{ color: "var(--primary)" }} />
          <h3 className="text-base font-semibold">{t.name} template
            <span className="text-[10px] uppercase ml-2 px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>v{t.version || 0}</span>
          </h3>
          <StatusBadge status={data.status} />
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>{t.short_description}</p>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div>
            <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Starter {t.unit_label || "Groups"}</div>
            {(t.units || []).length ? (t.units || []).map((u) => <div key={u.name}>• {u.name}</div>) : <div style={{ color: "var(--text-muted)" }}>None</div>}
          </div>
          <div>
            <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Starter work items</div>
            {(t.starter_items || []).length ? (t.starter_items || []).map((it) => <div key={it.title}>• {it.title} ({it.item_type})</div>) : <div style={{ color: "var(--text-muted)" }}>None</div>}
          </div>
          <div>
            <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Dashboard modules</div>
            <div>{(t.default_widgets || []).map((w) => w.replace(/_/g, " ")).join(", ") || "—"}</div>
          </div>
          <div>
            <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Defaults</div>
            <div>Member self-tasks: {t.default_settings?.allow_member_self_tasks === true ? "Enabled" : t.default_settings?.allow_member_self_tasks === false ? "Disabled" : "Owner decides"}</div>
            <div>Attendance on events: {t.default_settings?.attendance_default ? "On" : "Off"}</div>
            <div>Privacy: visible to Center members only</div>
          </div>
        </div>
      </div>
      <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`${base}/${templateKey}`)} data-testid="rc-tpl-preview-back">
        Back to template
      </button>
    </div>
  );
}
