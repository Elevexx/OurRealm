/**
 * /admin/level-builder — Founder-only Level Builder.
 * Tabs: Levels (level + task + reward editing), Analytics, Jobs & Repair,
 * Logs, Flags. Every mutation is backend-authorized + audited.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown, ArrowUp, Archive, BarChart3, CheckCircle2, ChevronLeft, Copy,
  Flag, Image as ImageIcon, ListChecks, Loader2, PauseCircle, Play, Plus,
  RefreshCw, ScrollText, Search, Trash2, Trophy, Wrench, X,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import ImageUploadPicker from "@/components/ImageUploadPicker";
import { toast } from "sonner";

const STATUS_COLORS = { draft: "#9aa4b2", published: "#10E670", paused: "#F4C84A", archived: "#ff8080" };

function StatusChip({ status }) {
  return (
    <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
      style={{ border: `1px solid ${STATUS_COLORS[status] || "#888"}`, color: STATUS_COLORS[status] || "#888" }}>
      {status}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-xs mb-2">
      <span className="block mb-1" style={{ color: "var(--text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}

/* ── Level editor (fields + graphics + rewards) ─────────────────────── */
function LevelEditor({ level, onSaved, taskTypes, rewardTypes }) {
  const [form, setForm] = useState(level);
  const [saving, setSaving] = useState(false);
  const [pickerFor, setPickerFor] = useState(null); // graphics key
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setSettings = (k, v) => set("progress_settings", { ...(form.progress_settings || {}), [k]: v });
  const setGraphics = (k, v) => set("graphics", { ...(form.graphics || {}), [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const body = {};
      ["name", "internal_name", "level_number", "display_order", "short_description",
       "long_description", "is_starting_level", "claim_mode", "repeatable",
       "mode_availability", "active_from", "expires_at", "graphics",
       "progress_settings", "rewards"].forEach((k) => { body[k] = form[k]; });
      const r = await apiClient.patch(`/admin/progression/levels/${level.id}`, body);
      toast.success(r.data.functional_change
        ? "Saved — functional change; publish a new version to apply to users."
        : "Level saved.");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const addReward = () => set("rewards", [...(form.rewards || []),
    { id: crypto.randomUUID().replace(/-/g, ""), type: "reputation", name: "New Reward", amount: 25, version: 1, permanent: true }]);
  const patchReward = (i, patch) =>
    set("rewards", form.rewards.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const rmReward = (i) => set("rewards", form.rewards.filter((_, x) => x !== i));

  return (
    <div className="space-y-4" data-testid="level-editor">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Public level name"><input className="or-input" value={form.name || ""} onChange={(e) => set("name", e.target.value)} data-testid="level-edit-name" /></Field>
        <Field label="Internal name (optional)"><input className="or-input" value={form.internal_name || ""} onChange={(e) => set("internal_name", e.target.value)} /></Field>
        <Field label="Level number"><input type="number" className="or-input" value={form.level_number ?? 0} onChange={(e) => set("level_number", parseInt(e.target.value || "0", 10))} data-testid="level-edit-number" /></Field>
        <Field label="Display order"><input type="number" className="or-input" value={form.display_order ?? 0} onChange={(e) => set("display_order", parseInt(e.target.value || "0", 10))} /></Field>
      </div>
      <Field label="Short description"><input className="or-input" value={form.short_description || ""} onChange={(e) => set("short_description", e.target.value)} /></Field>
      <Field label="Long description"><textarea className="or-input" rows={2} value={form.long_description || ""} onChange={(e) => set("long_description", e.target.value)} /></Field>
      <div className="flex flex-wrap gap-4 text-xs items-center">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.is_starting_level} onChange={(e) => set("is_starting_level", e.target.checked)} /> Starting level</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.repeatable} onChange={(e) => set("repeatable", e.target.checked)} /> Repeatable</label>
        <label className="flex items-center gap-2">
          Upgrade:
          <select className="or-input" style={{ width: 130 }} value={form.claim_mode || "manual"} onChange={(e) => set("claim_mode", e.target.value)} data-testid="level-edit-claim-mode">
            <option value="manual">Manual claim</option>
            <option value="auto">Automatic</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Modes:
          <input className="or-input" style={{ width: 200 }} placeholder="all (or: neon,stealth)"
            value={(form.mode_availability || []).join(",")}
            onChange={(e) => set("mode_availability", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Active from (ISO, optional)"><input className="or-input" value={form.active_from || ""} onChange={(e) => set("active_from", e.target.value || null)} /></Field>
        <Field label="Expires at (ISO, optional)"><input className="or-input" value={form.expires_at || ""} onChange={(e) => set("expires_at", e.target.value || null)} /></Field>
      </div>

      <div className="or-surface p-3">
        <div className="text-xs font-semibold mb-2 flex items-center gap-2"><ImageIcon size={13} /> Graphics (uploads use the durable media pipeline)</div>
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          {["icon_url", "badge_url", "card_background_url", "celebration_url"].map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-32 shrink-0" style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}</span>
              {(form.graphics || {})[k]
                ? <img src={form.graphics[k]} alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: "cover" }} />
                : <span style={{ color: "var(--text-muted)" }}>—</span>}
              <button className="or-chip" onClick={() => setPickerFor(k)} data-testid={`level-graphic-${k}`}>Upload</button>
              {(form.graphics || {})[k] && (
                <button className="or-chip" onClick={() => setGraphics(k, null)}>Clear</button>
              )}
            </div>
          ))}
          <label className="flex items-center gap-2">Accent color
            <input type="color" value={(form.graphics || {}).accent_color || "#2EA0FF"}
              onChange={(e) => setGraphics("accent_color", e.target.value)} style={{ width: 36, height: 26 }} />
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!(form.graphics || {}).glow} onChange={(e) => setGraphics("glow", e.target.checked)} /> Glow effect</label>
          <Field label="Alt text"><input className="or-input" value={(form.graphics || {}).alt_text || ""} onChange={(e) => setGraphics("alt_text", e.target.value)} /></Field>
        </div>
      </div>

      <div className="or-surface p-3">
        <div className="text-xs font-semibold mb-2">Progress settings</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label="Required task count (blank = all required tasks)">
            <input type="number" className="or-input" value={(form.progress_settings || {}).required_task_count ?? ""} onChange={(e) => setSettings("required_task_count", e.target.value ? parseInt(e.target.value, 10) : null)} />
          </Field>
          <Field label="Progress bar label"><input className="or-input" value={(form.progress_settings || {}).progress_bar_label || ""} onChange={(e) => setSettings("progress_bar_label", e.target.value)} /></Field>
          <Field label="Claim button text"><input className="or-input" value={(form.progress_settings || {}).claim_button_text || ""} onChange={(e) => setSettings("claim_button_text", e.target.value)} /></Field>
          <Field label="Completion message"><input className="or-input" value={(form.progress_settings || {}).completion_message || ""} onChange={(e) => setSettings("completion_message", e.target.value)} /></Field>
          <Field label="Celebration message"><input className="or-input" value={(form.progress_settings || {}).celebration_message || ""} onChange={(e) => setSettings("celebration_message", e.target.value)} /></Field>
          <Field label="No-next-level message"><input className="or-input" value={(form.progress_settings || {}).no_next_level_message || ""} onChange={(e) => setSettings("no_next_level_message", e.target.value)} /></Field>
          <Field label="Paused message"><input className="or-input" value={(form.progress_settings || {}).paused_message || ""} onChange={(e) => setSettings("paused_message", e.target.value)} /></Field>
        </div>
      </div>

      <div className="or-surface p-3" data-testid="level-rewards-editor">
        <div className="text-xs font-semibold mb-2 flex items-center justify-between">
          <span><Trophy size={13} className="inline mr-1" /> Rewards</span>
          <button className="or-chip" onClick={addReward} data-testid="level-reward-add"><Plus size={12} /> Add reward</button>
        </div>
        {(form.rewards || []).length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No rewards configured.</div>}
        {(form.rewards || []).map((r, i) => (
          <div key={r.id || i} className="flex flex-wrap items-center gap-2 py-2 text-xs" style={{ borderTop: i ? "1px solid var(--border-col)" : "none" }}>
            <select className="or-input" style={{ width: 170 }} value={r.type} onChange={(e) => patchReward(i, { type: e.target.value })} data-testid={`level-reward-type-${i}`}>
              {rewardTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="or-input flex-1 min-w-[120px]" value={r.name || ""} placeholder="Reward name" onChange={(e) => patchReward(i, { name: e.target.value })} />
            {r.type === "reputation" && (
              <input type="number" className="or-input" style={{ width: 90 }} value={r.amount ?? 0} onChange={(e) => patchReward(i, { amount: parseInt(e.target.value || "0", 10) })} />
            )}
            {(r.type === "completion_badge" || r.type === "registry_badge") && (
              <input className="or-input" style={{ width: 160 }} value={r.badge_key || ""} placeholder="badge_key" onChange={(e) => patchReward(i, { badge_key: e.target.value })} />
            )}
            {["feature_access", "realm_access", "widget_access", "mode_access"].includes(r.type) && (
              <input className="or-input" style={{ width: 160 }} value={r.unlock_key || ""} placeholder="unlock key" onChange={(e) => patchReward(i, { unlock_key: e.target.value })} />
            )}
            <label className="flex items-center gap-1"><input type="checkbox" checked={r.permanent !== false} onChange={(e) => patchReward(i, { permanent: e.target.checked })} /> permanent</label>
            <button className="starbar-icon" style={{ width: 26, height: 26 }} onClick={() => rmReward(i)} aria-label="Remove reward"><Trash2 size={12} /></button>
          </div>
        ))}
        <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
          Removing a reward here never revokes rewards users already earned. Revocation is a separate audited action in Jobs &amp; Repair.
        </div>
      </div>

      <button className="or-btn" onClick={save} disabled={saving} data-testid="level-editor-save">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save level
      </button>

      <ImageUploadPicker
        open={!!pickerFor}
        onClose={() => setPickerFor(null)}
        onPicked={({ url }) => { setGraphics(pickerFor, url); }}
        title="Upload level graphic"
        testid="level-graphic-picker"
      />
    </div>
  );
}

/* ── Task builder ───────────────────────────────────────────────────── */
function TaskBuilder({ level, taskTypes, onChanged }) {
  const [tasks, setTasks] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const r = await apiClient.get(`/admin/progression/levels/${level.id}/tasks`);
    setTasks(r.data.tasks);
  }, [level.id]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      const r = await apiClient.post(`/admin/progression/levels/${level.id}/tasks`,
        { name: "New task", task_type_key: taskTypes[0]?.key || "manual_approval" });
      await load(); setEditing(r.data.task); onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); }
  };
  const save = async (t) => {
    try {
      const body = { name: t.name, description: t.description, task_type_key: t.task_type_key,
        required: t.required, target_value: t.target_value, config: t.config,
        button_label: t.button_label, button_destination: t.button_destination,
        count_historical: t.count_historical, status: t.status };
      const r = await apiClient.patch(`/admin/progression/tasks/${t.id}`, body);
      toast.success(r.data.functional_change ? "Saved (functional — republish level to apply)" : "Task saved");
      setEditing(null); await load(); onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };
  const del = async (t) => {
    try {
      const r = await apiClient.delete(`/admin/progression/tasks/${t.id}`);
      toast.success(r.data.retired ? "Task retired (referenced/published)" : "Draft task deleted");
      await load(); onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };
  const dup = async (t) => {
    await apiClient.post(`/admin/progression/tasks/${t.id}/duplicate`);
    await load(); onChanged();
  };
  const move = async (idx, dir) => {
    const next = [...tasks];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setTasks(next);
    await apiClient.post(`/admin/progression/levels/${level.id}/tasks/reorder`,
      { ordered_ids: next.map((t) => t.id) });
    onChanged();
  };

  if (!tasks) return <Loader2 size={16} className="animate-spin" />;
  return (
    <div data-testid="task-builder">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold flex items-center gap-2"><ListChecks size={13} /> Tasks ({tasks.length})</div>
        <button className="or-chip" onClick={create} data-testid="task-add"><Plus size={12} /> Add task</button>
      </div>
      {tasks.map((t, i) => (
        <div key={t.id} className="or-surface p-2.5 mb-2" data-testid={`task-row-${t.id}`}>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex flex-col">
              <button className="starbar-icon" style={{ width: 20, height: 18 }} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={10} /></button>
              <button className="starbar-icon" style={{ width: 20, height: 18 }} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={10} /></button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold" style={{ color: "var(--text-main)" }}>{t.name}
                {t.status !== "active" && <span className="ml-2 text-[10px] uppercase" style={{ color: "#F4C84A" }}>{t.status}</span>}
              </div>
              <div style={{ color: "var(--text-muted)" }}>{t.task_type_key} · target {t.target_value} · {t.required ? "required" : "optional"}</div>
            </div>
            <button className="or-chip" onClick={() => setEditing(editing?.id === t.id ? null : { ...t })} data-testid={`task-edit-${t.id}`}>Edit</button>
            <button className="starbar-icon" style={{ width: 26, height: 26 }} onClick={() => dup(t)} aria-label="Duplicate"><Copy size={11} /></button>
            <button className="starbar-icon" style={{ width: 26, height: 26 }} onClick={() => del(t)} aria-label="Delete or retire"><Trash2 size={11} /></button>
          </div>
          {editing?.id === t.id && (
            <div className="mt-3 grid sm:grid-cols-2 gap-2 text-xs" data-testid={`task-editor-${t.id}`}>
              <Field label="Name"><input className="or-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Task type">
                <select className="or-input" value={editing.task_type_key} onChange={(e) => setEditing({ ...editing, task_type_key: e.target.value })} data-testid="task-type-select">
                  {taskTypes.map((tt) => <option key={tt.key} value={tt.key}>{tt.category} — {tt.name}</option>)}
                </select>
              </Field>
              <Field label="Description"><input className="or-input" value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
              <Field label="Target value"><input type="number" min={1} className="or-input" value={editing.target_value} onChange={(e) => setEditing({ ...editing, target_value: parseInt(e.target.value || "1", 10) })} /></Field>
              <Field label="Button label"><input className="or-input" value={editing.button_label || ""} onChange={(e) => setEditing({ ...editing, button_label: e.target.value })} /></Field>
              <Field label="Button destination (internal route)"><input className="or-input" value={editing.button_destination || ""} onChange={(e) => setEditing({ ...editing, button_destination: e.target.value })} /></Field>
              <Field label="Config (JSON — allowlisted keys only)">
                <textarea className="or-input font-mono" rows={2} value={JSON.stringify(editing.config || {})}
                  onChange={(e) => { try { setEditing({ ...editing, config: JSON.parse(e.target.value || "{}") }); } catch { /* keep typing */ } }} />
              </Field>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1"><input type="checkbox" checked={editing.required} onChange={(e) => setEditing({ ...editing, required: e.target.checked })} /> required</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={editing.count_historical !== false} onChange={(e) => setEditing({ ...editing, count_historical: e.target.checked })} /> count history</label>
                <select className="or-input" style={{ width: 110 }} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  {["active", "paused", "retired", "archived"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button className="or-btn" onClick={() => save(editing)} data-testid="task-editor-save">Save task</button>
                <button className="or-btn or-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────── */
export default function AdminLevelBuilder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("levels");
  const [levels, setLevels] = useState(null);
  const [selected, setSelected] = useState(null);
  const [meta, setMeta] = useState({ task_types: [], reward_types: [] });
  const [flags, setFlags] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [failedRewards, setFailedRewards] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [logs, setLogs] = useState([]);
  const [inspectName, setInspectName] = useState("");
  const [inspect, setInspect] = useState(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");

  const loadLevels = useCallback(async () => {
    const r = await apiClient.get("/admin/progression/levels");
    setLevels(r.data.levels);
  }, []);

  useEffect(() => {
    if (user?.role !== "founder") return;
    loadLevels();
    apiClient.get("/admin/progression/task-types").then((r) => setMeta(r.data)).catch(() => {});
    apiClient.get("/admin/progression/flags").then((r) => setFlags(r.data.flags)).catch(() => {});
  }, [user, loadLevels]);

  useEffect(() => {
    if (tab === "analytics") apiClient.get("/admin/progression/analytics").then((r) => setAnalytics(r.data)).catch(() => {});
    if (tab === "jobs") {
      apiClient.get("/admin/progression/jobs").then((r) => setJobs(r.data.jobs)).catch(() => {});
      apiClient.get("/admin/progression/rewards/failed").then((r) => setFailedRewards(r.data.grants)).catch(() => {});
      apiClient.get("/admin/progression/manual-approvals").then((r) => setApprovals(r.data.approvals)).catch(() => {});
    }
    if (tab === "logs") apiClient.get("/admin/progression/audit-logs").then((r) => setLogs(r.data.logs)).catch(() => {});
  }, [tab]);

  if (user && user.role !== "founder") {
    return <div className="or-surface p-8 text-center max-w-md mx-auto" data-testid="level-builder-guard">Founder access only.</div>;
  }

  const act = async (fn, okMsg) => {
    try { const r = await fn(); if (okMsg) toast.success(okMsg); await loadLevels(); return r; }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
  };

  const publish = async (l) => {
    try {
      const r = await apiClient.post(`/admin/progression/levels/${l.id}/publish`);
      if (r.data.requires_confirmation) {
        if (window.confirm(`${r.data.message}\n\nProceed with version ${r.data.new_version}?`)) {
          await apiClient.post(`/admin/progression/levels/${l.id}/publish?confirm=true`);
          toast.success(`Published v${r.data.new_version} — ${r.data.affected_users} user(s) migrated.`);
        }
      } else {
        toast.success(`Published v${r.data.version}`);
      }
      await loadLevels();
    } catch (e) { toast.error(e?.response?.data?.detail || "Publish failed"); }
  };

  const reorder = async (idx, dir) => {
    const next = [...levels];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setLevels(next);
    await apiClient.post("/admin/progression/levels/reorder", { ordered_ids: next.map((l) => l.id) });
  };

  const startJob = async (dryRun) => {
    try {
      const body = { dry_run: dryRun };
      if (!dryRun) body.confirmation_phrase = confirmPhrase;
      const r = await apiClient.post("/admin/progression/jobs/start", body);
      toast.success(`${dryRun ? "Dry Run" : "Backfill"} started`);
      setJobs((j) => [r.data.job, ...j]);
    } catch (e) { toast.error(e?.response?.data?.detail || "Job failed to start"); }
  };

  const doInspect = async () => {
    try {
      const r = await apiClient.get(`/admin/progression/inspect/${inspectName.trim()}`);
      setInspect(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "User not found"); }
  };

  return (
    <div className="max-w-5xl mx-auto" data-testid="level-builder-page">
      <button className="or-chip mb-3" onClick={() => navigate("/admin")}><ChevronLeft size={12} /> Admin Hub</button>
      <h1 className="text-2xl sm:text-3xl mb-1" style={{ fontFamily: "var(--font-display)" }}>Level Builder</h1>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Configure progression levels, tasks, and rewards. All changes are versioned and audited.
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[["levels", "Levels", ListChecks], ["analytics", "Analytics", BarChart3],
          ["jobs", "Jobs & Repair", Wrench], ["logs", "Audit Logs", ScrollText],
          ["flags", "Flags", Flag]].map(([k, label, Icon]) => (
          <button key={k} className="or-chip" data-active={tab === k} onClick={() => setTab(k)} data-testid={`lb-tab-${k}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {tab === "levels" && (
        <>
          <div className="flex justify-end mb-3">
            <button className="or-btn" data-testid="level-create"
              onClick={() => act(() => apiClient.post("/admin/progression/levels", { name: "New Level" }), "Draft level created")}>
              <Plus size={14} /> New level
            </button>
          </div>
          {!levels ? <Loader2 className="animate-spin" /> : levels.map((l, i) => (
            <div key={l.id} className="or-surface p-3 mb-3" data-testid={`lb-level-${l.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex flex-col">
                  <button className="starbar-icon" style={{ width: 22, height: 20 }} onClick={() => reorder(i, -1)} aria-label="Move level up"><ArrowUp size={11} /></button>
                  <button className="starbar-icon" style={{ width: 22, height: 20 }} onClick={() => reorder(i, 1)} aria-label="Move level down"><ArrowDown size={11} /></button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold flex items-center gap-2" style={{ color: "var(--text-main)" }}>
                    #{l.level_number} {l.name} <StatusChip status={l.status} />
                    {l.is_starting_level && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>· starting</span>}
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>v{l.config_version}</span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {l.task_count} tasks · {l.users_on_level} users on level · {(l.rewards || []).length} rewards
                  </div>
                </div>
                {l.status === "draft" && <button className="or-chip" onClick={() => publish(l)} data-testid={`level-publish-${l.id}`}><Play size={11} /> Publish</button>}
                {l.status === "published" && (
                  <>
                    <button className="or-chip" onClick={() => publish(l)} title="Republish (new version)"><RefreshCw size={11} /> Republish</button>
                    <button className="or-chip" onClick={() => act(() => apiClient.post(`/admin/progression/levels/${l.id}/pause`), "Paused")} data-testid={`level-pause-${l.id}`}><PauseCircle size={11} /> Pause</button>
                  </>
                )}
                {l.status === "paused" && <button className="or-chip" onClick={() => act(() => apiClient.post(`/admin/progression/levels/${l.id}/unpause`), "Resumed")}><Play size={11} /> Unpause</button>}
                <button className="or-chip" onClick={() => act(() => apiClient.post(`/admin/progression/levels/${l.id}/duplicate`), "Duplicated")}><Copy size={11} /></button>
                {l.status !== "archived" && <button className="or-chip" onClick={() => act(() => apiClient.post(`/admin/progression/levels/${l.id}/archive`), "Archived")} title="Archive" data-testid={`level-archive-${l.id}`}><Archive size={11} /></button>}
                <button className="or-chip" style={{ color: "#ff8080" }} title="Delete (drafts only)"
                  onClick={() => act(() => apiClient.delete(`/admin/progression/levels/${l.id}`), "Draft deleted")} data-testid={`level-delete-${l.id}`}>
                  <Trash2 size={11} />
                </button>
                <button className="or-chip" data-active={selected === l.id} onClick={() => setSelected(selected === l.id ? null : l.id)} data-testid={`level-open-${l.id}`}>
                  {selected === l.id ? "Close" : "Edit"}
                </button>
              </div>
              {selected === l.id && (
                <div className="mt-4 space-y-4">
                  <LevelEditor level={l} onSaved={loadLevels} taskTypes={meta.task_types} rewardTypes={meta.reward_types || []} />
                  <TaskBuilder level={l} taskTypes={meta.task_types} onChanged={loadLevels} />
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {tab === "analytics" && (
        !analytics ? <Loader2 className="animate-spin" /> : (
          <div className="space-y-3" data-testid="lb-analytics">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              {[["Real members", analytics.real_members], ["Tracked users", analytics.tracked_users],
                ["At highest level", analytics.highest_level_users], ["Rewards issued", analytics.rewards_issued],
                ["Rewards failed", analytics.rewards_failed], ["Failed events", analytics.failed_events],
                ["Approvals pending", analytics.manual_approvals_pending]].map(([k, v]) => (
                <div key={k} className="or-surface p-3">
                  <div className="text-xl font-bold" style={{ color: "var(--primary)" }}>{v}</div>
                  <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{k}</div>
                </div>
              ))}
            </div>
            {analytics.levels.map((l) => (
              <div key={l.level_id} className="or-surface p-3">
                <div className="font-semibold text-sm">#{l.level_number} {l.name} — {l.users_on_level} on level · {l.claim_ready} claim-ready · completed {l.times_completed}×</div>
                <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {l.tasks.map((t) => <div key={t.task_id}>· {t.name}: {t.completed_users} users completed</div>)}
                </div>
              </div>
            ))}
            <div className="or-surface p-3 text-xs">
              <div className="font-semibold mb-1">Recent claims</div>
              {analytics.recent_claims.length === 0 ? "None yet" :
                analytics.recent_claims.map((c) => <div key={c.claimed_at + c.user_id} style={{ color: "var(--text-muted)" }}>{c.claimed_at} — {c.status}</div>)}
            </div>
          </div>
        )
      )}

      {tab === "jobs" && (
        <div className="space-y-4" data-testid="lb-jobs">
          <div className="or-surface p-3">
            <div className="text-sm font-semibold mb-2">Dry Run &amp; Backfill</div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="or-btn" onClick={() => startJob(true)} data-testid="job-dry-run"><Search size={13} /> Run Dry Run (read-only)</button>
              <input className="or-input" style={{ width: 200 }} placeholder='Type "RECALCULATE ALL"' value={confirmPhrase} onChange={(e) => setConfirmPhrase(e.target.value)} data-testid="job-confirm-phrase" />
              <button className="or-btn or-btn-ghost" onClick={() => startJob(false)} data-testid="job-backfill">Run full backfill</button>
              <button className="or-chip" onClick={() => apiClient.get("/admin/progression/jobs").then((r) => setJobs(r.data.jobs))}><RefreshCw size={11} /> Refresh</button>
            </div>
            {jobs.map((j) => (
              <div key={j.id} className="mt-2 text-xs or-surface p-2" data-testid={`job-${j.id}`}>
                <div className="font-semibold">{j.type}{j.dry_run ? " (dry run)" : ""} — {j.status}</div>
                <div style={{ color: "var(--text-muted)" }}>
                  scanned {j.totals?.scanned} · changed {j.totals?.changed} · unchanged {j.totals?.unchanged} · claim-ready {j.totals?.claim_ready} · failed {j.totals?.failed}
                </div>
                {(j.samples || []).slice(0, 5).map((s, x) => (
                  <div key={x} style={{ color: "var(--text-muted)" }}>· @{s.username}: {s.level} {s.proposed}{s.claim_ready ? " (claim ready)" : ""}</div>
                ))}
                {j.status === "running" && <button className="or-chip mt-1" onClick={() => apiClient.post(`/admin/progression/jobs/${j.id}/cancel`)}>Cancel</button>}
                {j.status === "interrupted" && <button className="or-chip mt-1" onClick={() => apiClient.post(`/admin/progression/jobs/${j.id}/resume`)}>Resume</button>}
              </div>
            ))}
          </div>

          <div className="or-surface p-3">
            <div className="text-sm font-semibold mb-2">Inspect user progression</div>
            <div className="flex gap-2">
              <input className="or-input" placeholder="username" value={inspectName} onChange={(e) => setInspectName(e.target.value)} data-testid="inspect-username" />
              <button className="or-btn" onClick={doInspect} data-testid="inspect-go">Inspect</button>
            </div>
            {inspect && (
              <div className="mt-2 text-xs" data-testid="inspect-result">
                <div className="font-semibold">@{inspect.user.username} — {inspect.live?.level?.name} ({inspect.live?.summary?.completed_task_count}/{inspect.live?.summary?.required_task_count})</div>
                {(inspect.live?.tasks || []).map((t) => (
                  <div key={t.id} style={{ color: "var(--text-muted)" }}>· {t.name}: {t.current_value}/{t.required_value} {t.completed ? "✓" : ""}</div>
                ))}
                <div className="mt-1" style={{ color: "var(--text-muted)" }}>History: {inspect.history.length} · Claims: {inspect.claims.length} · Rewards: {inspect.rewards.length}</div>
                <button className="or-chip mt-1" onClick={() => apiClient.post("/admin/progression/jobs/start", { dry_run: false, usernames: [inspect.user.username] }).then(() => toast.success("Targeted recalculation started")).catch((e) => toast.error(e?.response?.data?.detail || "failed"))}>
                  Recalculate this user
                </button>
              </div>
            )}
          </div>

          <div className="or-surface p-3">
            <div className="text-sm font-semibold mb-2">Failed rewards ({failedRewards.length})</div>
            {failedRewards.length === 0 ? <div className="text-xs" style={{ color: "var(--text-muted)" }}>No failed rewards.</div>
              : failedRewards.map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-xs py-1">
                  <span className="flex-1">{g.user_id.slice(0, 8)} — {(g.reward_snapshot || {}).name} ({g.status})</span>
                  <button className="or-chip" onClick={() => apiClient.post(`/admin/progression/rewards/${g.id}/retry`).then(() => toast.success("Retried"))}>Retry</button>
                </div>
              ))}
          </div>

          <div className="or-surface p-3">
            <div className="text-sm font-semibold mb-2">Manual approvals pending ({approvals.length})</div>
            {approvals.length === 0 ? <div className="text-xs" style={{ color: "var(--text-muted)" }}>None pending.</div>
              : approvals.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs py-1">
                  <span className="flex-1">{a.user_id.slice(0, 8)} — task {a.task_id.slice(0, 8)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div className="or-surface p-3 text-xs" data-testid="lb-logs">
          {logs.length === 0 ? "No audit records yet." : logs.map((l) => (
            <div key={l.id} className="py-1.5" style={{ borderBottom: "1px solid var(--border-col)" }}>
              <b>{l.action}</b> · {l.target_type}/{String(l.target_id).slice(0, 10)} · by @{l.founder_username} · {l.created_at}
              {l.extra?.note && <div style={{ color: "var(--text-muted)" }}>{l.extra.note}</div>}
            </div>
          ))}
        </div>
      )}

      {tab === "flags" && flags && (
        <div className="or-surface p-4" data-testid="lb-flags">
          <div className="text-sm font-semibold mb-3">Feature flags (backend-controlled rollout &amp; rollback)</div>
          {Object.entries(flags).map(([k, v]) => (
            <label key={k} className="flex items-center gap-3 py-1.5 text-sm" data-testid={`flag-${k}`}>
              <input type="checkbox" checked={!!v}
                onChange={(e) => apiClient.patch("/admin/progression/flags", { key: k, value: e.target.checked })
                  .then((r) => setFlags(r.data.flags)).catch((err) => toast.error(err?.response?.data?.detail || "failed"))}
                data-testid={`flag-${k}-toggle`} />
              <span className="font-mono">{k}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {{ display: "User-facing level display", events: "Live event-driven updates",
                   calculations: "Progress calculation engine", notifications: "Progress notifications",
                   claims: "Level claim button", rewards: "Reward delivery gating",
                   builder: "Level Builder access", analytics: "Progression analytics" }[k]}
              </span>
            </label>
          ))}
          <div className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }}>
            Disabling display or claims never deletes progression data — it only hides the UI and blocks new claims.
          </div>
        </div>
      )}
    </div>
  );
}
