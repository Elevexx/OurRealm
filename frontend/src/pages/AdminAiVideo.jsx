import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clapperboard, Loader2, RefreshCcw, Save, ShieldAlert, Archive, Trash2, Activity, ListVideo, Settings2, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const TABS = [
  ["settings", "Settings", Settings2],
  ["queue", "Queue", Activity],
  ["library", "Video Library", ListVideo],
  ["analytics", "Analytics", BarChart3],
];
const STATUS_COLORS = {
  queued: "#F4A73B", generating: "#C26BFF", downloading: "#2EA0FF", uploading_r2: "#2EA0FF",
  optimizing: "#4DD6C1", attaching: "#4DD6C1", complete: "#10E670", failed: "#FF6B6B", cancelled: "#FF8A5A",
};

function Toggle({ label, value, onChange, danger, testid }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer" data-testid={testid}>
      <span className="text-xs" style={{ color: danger ? "#FF6B6B" : "var(--text-main)" }}>{label}</span>
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)}
        className="accent-[#2EE6FF] w-4 h-4" />
    </label>
  );
}

function SettingsTab() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    apiClient.get("/admin/ai-video/settings").then((r) => { setData(r.data); setDraft(r.data.settings); })
      .catch((e) => toast.error(e?.response?.data?.detail || "Could not load"));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const reason = window.prompt("Reason for this settings change (audited):");
    if (!reason || reason.trim().length < 5) { toast.error("A short reason is required"); return; }
    setBusy(true);
    try {
      const r = await apiClient.patch("/admin/ai-video/settings", { ...draft, reason });
      setDraft(r.data.settings);
      toast.success("AI video settings saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
    finally { setBusy(false); }
  };

  const checkHealth = async () => {
    setHealth("loading");
    try { const r = await apiClient.get("/admin/ai-video/providers/health"); setHealth(r.data.providers); }
    catch (e) { setHealth(null); toast.error(e?.response?.data?.detail || "Health check failed"); }
  };

  if (!draft) return <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  const genProvider = (data.providers || []).find((p) => p.name === draft.default_provider) || {};
  const num = (k, label, step = 0.5) => (
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <input className="or-input text-xs w-24 text-right" type="number" min={0} step={step} value={draft[k]}
        onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} data-testid={`aiv-set-${k}`} />
    </label>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="or-surface p-4" data-testid="aiv-toggles-card">
        <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#2EE6FF" }}>Generation controls</div>
        <Toggle label="AI video generation enabled" value={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} testid="aiv-toggle-enabled" />
        <Toggle label="EMERGENCY DISABLE (blocks everything)" value={draft.emergency_disabled} danger onChange={(v) => setDraft({ ...draft, emergency_disabled: v })} testid="aiv-toggle-emergency" />
        <Toggle label="Dry-run mode (free test clips, $0 spend)" value={draft.dry_run} onChange={(v) => setDraft({ ...draft, dry_run: v })} testid="aiv-toggle-dryrun" />
        <Toggle label="Expose provider names to course managers" value={draft.expose_provider_names} onChange={(v) => setDraft({ ...draft, expose_provider_names: v })} testid="aiv-toggle-expose" />
        <div className="text-[10px] mt-2 p-2 rounded-lg" style={{ background: "rgba(255,107,107,0.06)", color: "var(--text-muted)" }}>
          <ShieldAlert size={11} className="inline mr-1" style={{ color: "#FF6B6B" }} />
          With dry-run OFF, every generation spends real provider credits. Nothing runs without a course manager's explicit cost approval.
        </div>
      </div>

      <div className="or-surface p-4" data-testid="aiv-defaults-card">
        <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#2EE6FF" }}>Defaults</div>
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Default provider</span>
          <select className="or-input text-xs" value={draft.default_provider}
            onChange={(e) => setDraft({ ...draft, default_provider: e.target.value })} data-testid="aiv-set-provider">
            {(data.providers || []).filter((p) => p.can_generate).map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Default model</span>
          <select className="or-input text-xs" value={draft.default_model}
            onChange={(e) => setDraft({ ...draft, default_model: e.target.value })} data-testid="aiv-set-model">
            {(genProvider.models || [draft.default_model]).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Default resolution</span>
          <select className="or-input text-xs" value={draft.default_size}
            onChange={(e) => setDraft({ ...draft, default_size: e.target.value })} data-testid="aiv-set-size">
            {(genProvider.sizes || [draft.default_size]).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Default duration</span>
          <select className="or-input text-xs" value={draft.default_seconds}
            onChange={(e) => setDraft({ ...draft, default_seconds: Number(e.target.value) })} data-testid="aiv-set-seconds">
            {(genProvider.seconds || [4, 8, 12]).map((s) => <option key={s} value={s}>{s}s</option>)}
          </select>
        </label>
        {num("max_concurrent_jobs", "Max concurrent jobs", 1)}
        {num("auto_video_cap", "Auto videos per course (one-click)", 1)}
        {num("auto_image_cap", "Auto images per course (one-click)", 1)}
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Retry schedule (seconds, comma-sep)</span>
          <input className="or-input text-xs w-44 text-right" defaultValue={(draft.retry_schedule_seconds || []).join(", ")}
            onChange={(e) => setDraft({ ...draft,
              retry_schedule_seconds: e.target.value.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n > 0) })}
            data-testid="aiv-set-retry-schedule" />
        </label>
        <label className="flex items-center justify-between gap-2 py-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>AI Media approval</span>
          <select className="or-input text-xs" value={draft.ai_media_approval}
            onChange={(e) => setDraft({ ...draft, ai_media_approval: e.target.value })} data-testid="aiv-set-approval">
            <option value="none">No approval required (default)</option>
            <option value="founder">Founder approval required</option>
          </select>
        </label>
      </div>

      <div className="or-surface p-4" data-testid="aiv-budget-card">
        <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#F4A73B" }}>Cost controls (USD)</div>
        {num("daily_budget", "Daily budget")}
        {num("monthly_budget", "Monthly budget")}
        {num("max_per_video", "Maximum per video")}
        {num("max_per_course", "Maximum per course")}
        <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
          Spent today: <b style={{ color: "#F4A73B" }}>${data.spend.daily_spent.toFixed(2)}</b> · This month: <b style={{ color: "#F4A73B" }}>${data.spend.monthly_spent.toFixed(2)}</b>
        </div>
      </div>

      <div className="or-surface p-4" data-testid="aiv-health-card">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#10E670" }}>Provider health</div>
          <button className="or-btn or-btn-ghost text-[10px]" onClick={checkHealth} data-testid="aiv-health-check">
            {health === "loading" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />} Check (free)
          </button>
        </div>
        {Array.isArray(health) ? health.map((h) => (
          <div key={h.name} className="flex items-center gap-2 py-1 text-[11px]" data-testid={`aiv-health-${h.name}`}>
            <span className="w-2 h-2 rounded-full" style={{ background: h.ok ? "#10E670" : "#FF6B6B" }} />
            <b className="w-36">{h.label}</b>
            <span style={{ color: "var(--text-muted)" }}>{h.detail}</span>
          </div>
        )) : <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Run a free connectivity + model-access check (no video is generated).</div>}
      </div>

      <div className="md:col-span-2">
        <button className="or-btn text-xs font-bold" onClick={save} disabled={busy} data-testid="aiv-save-settings">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Settings
        </button>
      </div>
    </div>
  );
}

function QueueTab() {
  const [jobs, setJobs] = useState(null);
  const load = useCallback(() => {
    apiClient.get("/admin/ai-video/queue").then((r) => setJobs(r.data.jobs)).catch(() => setJobs([]));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  const cancel = async (id) => {
    try { await apiClient.post(`/admin/ai-video/jobs/${id}/cancel`); toast.success("Cancel requested"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  if (!jobs) return <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  return (
    <div className="or-surface p-4" data-testid="aiv-queue">
      {jobs.length === 0 ? <div className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>No active generation jobs.</div>
        : jobs.map((j) => (
          <div key={j.id} className="flex items-center gap-2 py-2 text-[11px] flex-wrap" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid={`aiv-queue-row-${j.id}`}>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${STATUS_COLORS[j.status]}22`, color: STATUS_COLORS[j.status] }}>{j.stage}</span>
            <span className="flex-1 truncate">{j.prompt}</span>
            <span style={{ color: "var(--text-muted)" }}>@{j.created_by_username} · {j.seconds}s · ${j.estimated_cost?.toFixed(2)}{j.dry_run ? " · DRY RUN" : ""}</span>
            <button className="or-btn or-btn-ghost text-[10px]" onClick={() => cancel(j.id)} data-testid={`aiv-cancel-${j.id}`}>Cancel</button>
          </div>
        ))}
    </div>
  );
}

function LibraryTab() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const load = useCallback(() => {
    apiClient.get("/admin/ai-video/history", { params: { q, status } })
      .then((r) => setRows(r.data.jobs)).catch(() => setRows([]));
  }, [q, status]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); load(); } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); } };
  return (
    <div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <input className="or-input text-xs flex-1 min-w-[160px]" placeholder="Search prompts…" value={q}
          onChange={(e) => setQ(e.target.value)} data-testid="aiv-lib-search" />
        <select className="or-input text-xs" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="aiv-lib-status">
          <option value="">All statuses</option>
          {["complete", "failed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {!rows ? <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>
        : rows.length === 0 ? <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>No AI generated videos yet.</div>
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="aiv-library-grid">
              {rows.map((j) => (
                <div key={j.id} className="or-surface p-3" data-testid={`aiv-lib-card-${j.id}`}>
                  {j.video_url
                    ? <video controls preload="none" poster={j.thumbnail_url || undefined} src={j.video_url} className="w-full rounded-lg mb-2" style={{ maxHeight: 150 }} />
                    : <div className="rounded-lg mb-2 flex items-center justify-center py-8" style={{ background: "rgba(255,255,255,0.04)" }}><Clapperboard size={18} style={{ opacity: 0.4 }} /></div>}
                  <div className="text-[11px] font-semibold truncate mb-0.5">{j.prompt}</div>
                  <div className="text-[9px] mb-1.5" style={{ color: "var(--text-muted)" }}>
                    {j.created_at?.slice(0, 10)} · @{j.created_by_username} · {j.seconds}s · {j.size} · {j.provider}
                    {j.dry_run ? " · DRY RUN" : ` · $${(j.actual_cost ?? j.estimated_cost ?? 0).toFixed(2)}`} · v{j.version}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${STATUS_COLORS[j.status]}22`, color: STATUS_COLORS[j.status] }}>{j.status}</span>
                    <div className="flex-1" />
                    <button className="or-btn or-btn-ghost p-1" title="Archive" data-testid={`aiv-archive-${j.id}`}
                      onClick={() => act(() => apiClient.post(`/admin/ai-video/jobs/${j.id}/archive`, { archived: true }), "Archived")}><Archive size={11} /></button>
                    <button className="or-btn or-btn-ghost p-1" title="Delete record" data-testid={`aiv-delete-${j.id}`}
                      onClick={() => window.confirm("Delete this job record?") && act(() => apiClient.delete(`/admin/ai-video/jobs/${j.id}`), "Deleted")}><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  );
}

function AnalyticsTab() {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get("/admin/ai-video/analytics").then((r) => setData(r.data)).catch(() => setData({}));
  }, []);
  if (!data) return <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="aiv-analytics">
      {[["Total jobs", data.total_jobs ?? 0], ["Spent today", `$${(data.spend?.daily_spent ?? 0).toFixed(2)}`],
        ["Spent this month", `$${(data.spend?.monthly_spent ?? 0).toFixed(2)}`],
        ["Completed", data.by_status?.complete ?? 0]].map(([k, v]) => (
        <div key={k} className="or-surface p-4 text-center">
          <div className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>{v}</div>
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{k}</div>
        </div>
      ))}
      <div className="or-surface p-4 col-span-2 md:col-span-4">
        <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#2EE6FF" }}>By status</div>
        <div className="flex gap-3 flex-wrap text-[11px]">
          {Object.entries(data.by_status || {}).map(([s, n]) => (
            <span key={s}><b style={{ color: STATUS_COLORS[s] || "var(--text-main)" }}>{n}</b> {s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Founder Command Center — AI Video Settings, queue, library, analytics.
export default function AdminAiVideo() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("settings");
  return (
    <div className="max-w-5xl mx-auto rcx-scope pb-10" data-testid="admin-ai-video-page">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate("/admin")} data-testid="aiv-back">
          <ArrowLeft size={13} /> Admin Hub
        </button>
        <h1 className="text-xl sm:text-2xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
          <Clapperboard size={22} style={{ color: "#2EE6FF" }} /> AI Video Settings
        </h1>
      </div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} className="text-[11px] px-3 py-1.5 rounded-full flex items-center gap-1.5"
            style={{ background: tab === k ? "rgba(46,230,255,0.15)" : "rgba(255,255,255,0.05)",
                     border: tab === k ? "1px solid #2EE6FF" : "1px solid rgba(255,255,255,0.1)" }}
            onClick={() => setTab(k)} data-testid={`aiv-tab-${k}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      {tab === "settings" && <SettingsTab />}
      {tab === "queue" && <QueueTab />}
      {tab === "library" && <LibraryTab />}
      {tab === "analytics" && <AnalyticsTab />}
    </div>
  );
}
