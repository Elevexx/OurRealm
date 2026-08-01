import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Cpu, BookMarked, BarChart3, ScrollText, ServerCog, BrainCircuit,
  Zap, Library, Plus, Trash2, Save, Check, X, Loader2, Gauge, RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const SECTIONS = [
  { id: "readiness", label: "Readiness", Icon: Gauge },
  { id: "config", label: "AI Settings", Icon: Cpu },
  { id: "prompts", label: "Prompt Library", Icon: BookMarked },
  { id: "analytics", label: "Usage Analytics", Icon: BarChart3 },
  { id: "audit", label: "AI Audit Log", Icon: ScrollText },
  { id: "providers", label: "Provider Health", Icon: ServerCog },
  { id: "memory", label: "Memory Manager", Icon: BrainCircuit },
  { id: "automations", label: "Automations", Icon: Zap },
  { id: "templates", label: "Templates", Icon: Library },
];
const VOICES = ["nova", "atlas", "aurora", "ember", "luna", "orion", "echo", "titan"];
const READY_COLORS = { ok: "#10E670", warn: "#F4A73B", error: "#FF6B6B" };

function Readiness() {
  const [d, setD] = useState(null);
  const load = useCallback(() => {
    setD(null);
    apiClient.get("/admin/orai/readiness").then((r) => setD(r.data)).catch(() => toast.error("Could not run readiness checks"));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="rcx-loader" />;
  const color = d.score >= 90 ? "#10E670" : d.score >= 75 ? "#2EA0FF" : d.score >= 50 ? "#F4A73B" : "#FF6B6B";
  return (
    <div className="space-y-3" data-testid="orai-admin-readiness">
      <div className="or-surface p-4 flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
          <svg viewBox="0 0 120 120" width="96" height="96">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${(d.score / 100) * 326} 326`} transform="rotate(-90 60 60)" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xl font-extrabold" data-testid="readiness-score">{d.score}</div>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-base font-bold" style={{ color, fontFamily: "var(--font-display)" }} data-testid="readiness-label">{d.label}</div>
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Checked {d.checked_at?.slice(0, 16).replace("T", " ")} UTC</div>
        </div>
        <button className="or-btn or-btn-ghost text-xs" onClick={load} aria-label="Re-run readiness checks" data-testid="readiness-refresh">
          <RefreshCcw size={12} /> Re-check
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {d.checks.map((c) => (
          <div key={c.key} className="or-surface p-3 flex items-center gap-2.5" data-testid={`readiness-check-${c.key}`}>
            <span className="rounded-full inline-block shrink-0" style={{ width: 9, height: 9, background: READY_COLORS[c.status], boxShadow: `0 0 8px ${READY_COLORS[c.status]}` }} />
            <div className="min-w-0">
              <div className="text-[12px] font-bold">{c.label}</div>
              <div className="text-[9px] truncate" style={{ color: "var(--text-muted)" }}>{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Config() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { apiClient.get("/admin/orai/config").then((r) => setCfg(r.data)).catch(() => {}); }, []);
  if (!cfg) return <div className="rcx-loader" />;
  const save = async () => {
    setSaving(true);
    try { const r = await apiClient.put("/admin/orai/config", cfg); setCfg(r.data); toast.success("AI settings saved"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-3" data-testid="orai-admin-config">
      <div className="or-surface p-4 space-y-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#2EA0FF" }}>Model routing</div>
          <input className="or-input w-full text-xs mb-1.5" placeholder="Default model override (blank = platform default)"
            value={cfg.default_model} onChange={(e) => setCfg({ ...cfg, default_model: e.target.value })} data-testid="orai-cfg-model" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {["economy", "standard", "enhanced", "high"].map((p) => (
              <input key={p} className="or-input text-[10px]" placeholder={`${p} model`}
                value={cfg.power_routing?.[p] || ""} data-testid={`orai-cfg-routing-${p}`}
                onChange={(e) => setCfg({ ...cfg, power_routing: { ...cfg.power_routing, [p]: e.target.value } })} />
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#10E670" }}>Course generator</div>
          <div className="flex gap-2">
            <label className="text-[10px] flex items-center gap-1.5">Max lessons
              <input className="or-input text-xs w-20" type="number" min={3} max={40} value={cfg.course_generator?.max_lessons}
                onChange={(e) => setCfg({ ...cfg, course_generator: { ...cfg.course_generator, max_lessons: Number(e.target.value) } })}
                data-testid="orai-cfg-maxlessons" />
            </label>
            <label className="text-[10px] flex items-center gap-1.5">Creativity
              <input className="or-input text-xs w-20" type="number" step={0.1} min={0} max={1.5} value={cfg.course_generator?.temperature}
                onChange={(e) => setCfg({ ...cfg, course_generator: { ...cfg.course_generator, temperature: Number(e.target.value) } })}
                data-testid="orai-cfg-temperature" />
            </label>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#FF6B6B" }}>Safety rules (appended to every ORAi prompt)</div>
          <textarea className="or-input w-full text-xs" rows={3} value={cfg.safety_rules}
            onChange={(e) => setCfg({ ...cfg, safety_rules: e.target.value })} data-testid="orai-cfg-safety" />
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#F4A73B" }}>Moderation rules</div>
          <textarea className="or-input w-full text-xs" rows={2} value={cfg.moderation_rules}
            onChange={(e) => setCfg({ ...cfg, moderation_rules: e.target.value })} data-testid="orai-cfg-moderation" />
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#C26BFF" }}>Voice manager</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {VOICES.map((v) => {
              const off = cfg.voices_disabled?.includes(v);
              return (
                <button key={v} className="text-[10px] px-2 py-1 rounded-full capitalize"
                  style={off ? { background: "rgba(255,107,107,0.12)", color: "#FF6B6B", border: "1px solid rgba(255,107,107,0.4)" }
                    : { background: "rgba(16,230,112,0.1)", color: "#10E670", border: "1px solid rgba(16,230,112,0.35)" }}
                  onClick={() => setCfg({ ...cfg, voices_disabled: off ? cfg.voices_disabled.filter((x) => x !== v) : [...(cfg.voices_disabled || []), v] })}
                  data-testid={`orai-cfg-voice-${v}`}>
                  {v} {off ? "✕" : "✓"}
                </button>
              );
            })}
          </div>
          <label className="text-[10px] flex items-center gap-1.5">Default voice
            <select className="or-input text-xs capitalize" value={cfg.default_voice}
              onChange={(e) => setCfg({ ...cfg, default_voice: e.target.value })} data-testid="orai-cfg-defaultvoice">
              {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={!!cfg.memory_enabled_global}
            onChange={(e) => setCfg({ ...cfg, memory_enabled_global: e.target.checked })} data-testid="orai-cfg-memory" />
          Center Memory enabled platform-wide
        </label>
        <button className="or-btn text-xs" onClick={save} disabled={saving} data-testid="orai-cfg-save">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save settings
        </button>
      </div>
    </div>
  );
}

function Prompts() {
  const [rows, setRows] = useState(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const load = useCallback(() => apiClient.get("/admin/orai/prompts").then((r) => setRows(r.data.prompts)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <div className="rcx-loader" />;
  return (
    <div className="space-y-2" data-testid="orai-admin-prompts">
      <div className="or-surface p-3 flex gap-2 flex-wrap">
        <input className="or-input text-xs w-44" placeholder="Prompt title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="orai-prompt-title" />
        <input className="or-input flex-1 min-w-[160px] text-xs" placeholder="Prompt text…" value={body} onChange={(e) => setBody(e.target.value)} data-testid="orai-prompt-body" />
        <button className="or-btn text-xs" disabled={!title || !body} data-testid="orai-prompt-add"
          onClick={() => apiClient.post("/admin/orai/prompts", { title, body }).then(() => { setTitle(""); setBody(""); load(); toast.success("Prompt saved"); })}>
          <Plus size={12} /> Add
        </button>
      </div>
      {rows.map((p) => (
        <div key={p.id} className="or-surface p-3 flex items-start gap-2" data-testid={`orai-prompt-${p.id}`}>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold">{p.title}</div>
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{p.body.slice(0, 180)}</div>
          </div>
          <button onClick={() => apiClient.delete(`/admin/orai/prompts/${p.id}`).then(load)} aria-label="Delete prompt" data-testid={`orai-prompt-del-${p.id}`}>
            <Trash2 size={13} style={{ color: "var(--text-muted)" }} />
          </button>
        </div>
      ))}
      {!rows.length && <div className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>No saved prompts yet.</div>}
    </div>
  );
}

function Analytics() {
  const [d, setD] = useState(null);
  useEffect(() => { apiClient.get("/admin/orai/analytics").then((r) => setD(r.data)).catch(() => {}); }, []);
  if (!d) return <div className="rcx-loader" />;
  const cards = [["ORAi sessions · 7d", d.orai_sessions_7d], ["Messages · 7d", d.orai_messages_7d],
    ["Voice TTS · 7d", d.voice_tts_7d], ["Voice STT · 7d", d.voice_stt_7d],
    ["Courses · 30d", d.courses_generated_30d], ["Drafts · 30d", d.drafts_30d],
    ["Automation runs · 30d", d.automation_runs_30d], ["Tutor msgs · 7d", d.tutor_messages_7d],
    ["Memories", d.memories_total], ["Templates", d.templates_total]];
  return (
    <div data-testid="orai-admin-analytics">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
        {cards.map(([l, v]) => (
          <div key={l} className="or-surface p-3"><div className="text-lg font-extrabold">{v}</div>
            <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{l}</div></div>
        ))}
      </div>
      <div className="or-surface p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#2EA0FF" }}>Top Centers · 30d</div>
        {d.top_centers.map((c) => (
          <div key={c.center_id} className="flex justify-between text-[11px] py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span>{c.name}</span><b>{c.sessions_30d} sessions</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Audit() {
  const [d, setD] = useState(null);
  useEffect(() => { apiClient.get("/admin/orai/audit").then((r) => setD(r.data)).catch(() => {}); }, []);
  if (!d) return <div className="rcx-loader" />;
  return (
    <div className="or-surface p-3" data-testid="orai-admin-audit">
      {d.activity.map((a, i) => (
        <div key={i} className="text-[11px] py-1.5 flex gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
          data-testid={`orai-audit-row-${i}`}>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0 h-fit" style={{ background: "rgba(194,107,255,0.14)", color: "#C26BFF" }}>{a.action}</span>
          <span className="flex-1">{a.detail}</span>
          <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>{a.created_at?.slice(0, 16).replace("T", " ")}</span>
        </div>
      ))}
      {!d.activity.length && <div className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>No AI activity yet.</div>}
    </div>
  );
}

function Providers() {
  const [d, setD] = useState(null);
  useEffect(() => { apiClient.get("/admin/orai/providers").then((r) => setD(r.data)).catch(() => {}); }, []);
  if (!d) return <div className="rcx-loader" />;
  return (
    <div className="space-y-2" data-testid="orai-admin-providers">
      {d.providers.map((p) => (
        <div key={p.id} className="or-surface p-3 flex items-center gap-3" data-testid={`orai-provider-${p.id}`}>
          <span className="rounded-full inline-block" style={{ width: 10, height: 10, background: p.configured ? "#10E670" : "#FF6B6B", boxShadow: `0 0 8px ${p.configured ? "#10E670" : "#FF6B6B"}` }} />
          <div className="flex-1">
            <div className="text-[12px] font-bold">{p.label}</div>
            <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
              {p.configured ? "Primary key configured" : "No primary key"} · {p.fallback_configured ? "fallback ready" : "no fallback"}
            </div>
          </div>
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{p.activity_24h} calls · 24h</div>
        </div>
      ))}
    </div>
  );
}

function MemoryManager() {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => apiClient.get("/admin/orai/memory").then((r) => setRows(r.data.memories)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <div className="rcx-loader" />;
  return (
    <div className="space-y-2" data-testid="orai-admin-memory">
      {rows.map((m) => (
        <div key={m.id} className="or-surface p-3 flex gap-2 items-start">
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "rgba(194,107,255,0.14)", color: "#C26BFF" }}>{m.category}</span>
          <div className="text-[11px] flex-1">{m.content}</div>
          <button onClick={() => apiClient.delete(`/admin/orai/memory/${m.id}`).then(() => { toast.success("Deleted"); load(); })}
            aria-label="Delete memory" data-testid={`orai-admin-memory-del-${m.id}`}><Trash2 size={13} style={{ color: "var(--text-muted)" }} /></button>
        </div>
      ))}
      {!rows.length && <div className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>No memories platform-wide.</div>}
    </div>
  );
}

function AutomationManager() {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => apiClient.get("/admin/orai/automations").then((r) => setRows(r.data.automations)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <div className="rcx-loader" />;
  return (
    <div className="space-y-2" data-testid="orai-admin-automations">
      {rows.map((a) => (
        <div key={a.id} className="or-surface p-3 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold truncate">{a.name}</div>
            <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{a.center_name} · {a.run_count} runs</div>
          </div>
          <button className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={a.enabled ? { background: "rgba(16,230,112,0.15)", color: "#10E670" } : { background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
            onClick={() => apiClient.patch(`/admin/orai/automations/${a.id}`, { enabled: !a.enabled }).then(load)}
            data-testid={`orai-admin-auto-toggle-${a.id}`}>
            {a.enabled ? "On" : "Off"}
          </button>
        </div>
      ))}
      {!rows.length && <div className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>No automations platform-wide.</div>}
    </div>
  );
}

function TemplateManager() {
  const [rows, setRows] = useState(null);
  useEffect(() => { apiClient.get("/admin/orai/templates").then((r) => setRows(r.data.templates)).catch(() => setRows([])); }, []);
  if (!rows) return <div className="rcx-loader" />;
  return (
    <div className="space-y-2" data-testid="orai-admin-templates">
      {rows.map((t) => (
        <div key={t.id} className="or-surface p-3 flex items-center gap-2">
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(46,160,255,0.15)", color: "#2EA0FF" }}>{t.kind}</span>
          <div className="text-[12px] font-bold flex-1 truncate">{t.name}</div>
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>@{t.owner_username} · v{t.version} · {t.status}</span>
        </div>
      ))}
      {!rows.length && <div className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>No templates platform-wide.</div>}
    </div>
  );
}

// Admin AI Command Center — founder ORAi controls, no code edits needed.
export default function AdminOraiControl() {
  const navigate = useNavigate();
  const [section, setSection] = useState("readiness");
  return (
    <div className="max-w-4xl mx-auto rcx-scope rcx-page-enter pb-10" data-testid="admin-orai-page">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate("/admin/orion")} data-testid="admin-orai-back">
          <ArrowLeft size={13} /> Command Center
        </button>
        <h1 className="text-lg sm:text-xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
          <Cpu size={20} style={{ color: "#4DD6C1" }} /> AI Command Center
        </h1>
      </div>
      <div className="flex gap-1 mb-4 overflow-x-auto no-scrollbar" data-testid="admin-orai-tabs">
        {SECTIONS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setSection(id)}
            className="shrink-0 flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors"
            style={section === id
              ? { background: "rgba(77,214,193,0.16)", border: "1px solid rgba(77,214,193,0.5)", color: "#4DD6C1" }
              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid={`admin-orai-tab-${id}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      {section === "readiness" && <Readiness />}
      {section === "config" && <Config />}
      {section === "prompts" && <Prompts />}
      {section === "analytics" && <Analytics />}
      {section === "audit" && <Audit />}
      {section === "providers" && <Providers />}
      {section === "memory" && <MemoryManager />}
      {section === "automations" && <AutomationManager />}
      {section === "templates" && <TemplateManager />}
    </div>
  );
}
