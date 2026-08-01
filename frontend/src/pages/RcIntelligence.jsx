import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, BrainCircuit, Sparkles, Lightbulb, Zap, FileEdit, Library, Activity,
  Plus, Trash2, Pin, PinOff, Download, Power, Loader2, Check, X, Volume2,
  ArrowUp, ArrowDown, CheckCircle2, Clock, GripVertical, Copy, Archive, Upload,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { oraiVoice } from "@/lib/oraiVoiceEngine";

const SEV = { high: "#FF6B6B", medium: "#F4A73B", low: "#4DD6C1" };
const HEALTH_COLORS = { Excellent: "#10E670", Good: "#2EA0FF", "Needs Attention": "#F4A73B", "At Risk": "#FF6B6B" };
const TABS = [
  { id: "overview", label: "Overview", Icon: Activity },
  { id: "suggestions", label: "Suggestions", Icon: Lightbulb },
  { id: "memory", label: "Memory", Icon: BrainCircuit },
  { id: "automations", label: "Automations", Icon: Zap },
  { id: "drafts", label: "Drafts", Icon: FileEdit },
  { id: "templates", label: "Templates", Icon: Library },
];
const ACTION_LABELS = {
  notify_member: "Notify member", notify_manager: "Notify manager",
  award_fire_power: "Award Fire Power (approval required)", create_reminder: "Create reminder",
  create_calendar_event: "Create calendar event", generate_report_draft: "Generate report draft",
  unlock_next_lesson: "Unlock next lesson", generate_greeting: "Generate greeting",
  suggest_reassignment: "Suggest reassignment",
};
const TRIGGER_LABELS = {
  lesson_completed: "Lesson Completed", checkpoint_approved: "Checkpoint Approved",
  task_overdue: "Task Overdue", birthday: "Birthday", member_joined: "Member Joined",
};

const speak = (text) => oraiVoice.speak(text).catch(() => toast.error("ORAi voice is unavailable right now"));

function Overview({ ov, cid }) {
  const h = ov.health;
  const color = HEALTH_COLORS[h.label] || "#2EA0FF";
  const max = Math.max(1, ...ov.trend.map((t) => t.completions));
  const guide = () => speak(
    `Welcome to the ORAi Intelligence dashboard. Your Center health is ${h.score} out of 100 — ${h.label}. ${h.explanation} ` +
    `You have ${ov.automations.enabled} active automations and ${ov.recommendations.length} suggestions waiting. ` +
    "Use the tabs to review suggestions, manage what ORAi remembers, build automations, approve drafts, and reuse templates.");
  return (
    <div className="space-y-3 rcx-stagger">
      <div className="or-surface p-4 flex flex-col sm:flex-row gap-4 items-center" data-testid="intel-health-card">
        <div className="relative shrink-0" style={{ width: 110, height: 110 }}>
          <svg viewBox="0 0 120 120" width="110" height="110">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${(h.score / 100) * 326} 326`} transform="rotate(-90 60 60)" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-2xl font-extrabold" data-testid="intel-health-score">{h.score}</div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color }}>{h.label}</div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>Center Health</div>
            <button className="or-btn or-btn-ghost p-1.5" onClick={guide} title="ORAi explains this dashboard aloud"
              data-testid="intel-guide-voice"><Volume2 size={13} /></button>
          </div>
          <div className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>{h.explanation}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {h.factors.map((f) => (
              <div key={f.key} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,0.03)" }}
                title={f.detail} data-testid={`intel-factor-${f.key}`}>
                <div className="text-[9px] truncate" style={{ color: "var(--text-muted)" }}>{f.label}</div>
                <div className="flex items-center gap-1.5">
                  <div className="h-1 rounded-full flex-1 overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div className="h-full rounded-full" style={{ width: `${f.score}%`, background: f.score >= 65 ? "#10E670" : f.score >= 45 ? "#F4A73B" : "#FF6B6B" }} />
                  </div>
                  <span className="text-[9px] font-bold">{f.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[["ORAi chats · 7d", ov.stats.orai_sessions_7d], ["Courses generated", ov.stats.courses_generated],
          ["Voice uses · 7d", ov.stats.voice_uses_7d], ["Automations on", `${ov.automations.enabled}/${ov.automations.total}`]]
          .map(([label, v]) => (
            <div key={label} className="or-surface p-3" data-testid={`intel-stat-${label.split(" ")[0].toLowerCase()}`}>
              <div className="text-lg font-extrabold">{v}</div>
              <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{label}</div>
            </div>
          ))}
      </div>

      <div className="or-surface p-4" data-testid="intel-trend-card">
        <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#2EA0FF" }}>Completions · 7 days</div>
        <div className="flex items-end gap-1.5 h-20">
          {ov.trend.map((t) => (
            <div key={t.day} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-t" title={`${t.completions}`}
                style={{ height: `${Math.max(4, (t.completions / max) * 70)}px`, background: "linear-gradient(180deg,#2EA0FF,#10E670)" }} />
              <div className="text-[8px]" style={{ color: "var(--text-muted)" }}>{t.day}</div>
            </div>
          ))}
        </div>
      </div>

      {!!ov.conversations.length && (
        <div className="or-surface p-4" data-testid="intel-convos-card">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#C26BFF" }}>Recent ORAi conversations</div>
          {ov.conversations.map((s) => (
            <div key={s.id} className="text-[11px] py-1 truncate" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {s.title || "Chat"} <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>· {s.updated_at?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Suggestions({ cid }) {
  const [recs, setRecs] = useState(null);
  useEffect(() => {
    apiClient.get(`/responsibility-center/${cid}/orai/recommendations`)
      .then((r) => setRecs(r.data.recommendations)).catch(() => setRecs([]));
  }, [cid]);
  if (!recs) return <div className="or-surface p-6 text-center"><div className="rcx-loader" /></div>;
  return (
    <div className="space-y-2 rcx-stagger" data-testid="intel-suggestions">
      <div className="flex items-center justify-between">
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>ORAi suggests — it never acts on its own.</div>
        {!!recs.length && (
          <button className="or-btn or-btn-ghost text-xs" data-testid="intel-suggestions-read"
            onClick={() => speak("Here are my suggestions. " + recs.map((r) => r.text).join(" "))}>
            <Volume2 size={12} /> Read aloud
          </button>
        )}
      </div>
      {recs.length === 0 && <div className="or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>All clear — no suggestions right now. 🎉</div>}
      {recs.map((r) => (
        <div key={r.id} className="or-surface p-3 flex gap-2.5 items-start" data-testid={`intel-rec-${r.kind}`}>
          <Lightbulb size={15} className="shrink-0 mt-0.5" style={{ color: SEV[r.severity] }} />
          <div className="min-w-0">
            <div className="text-[12px]">{r.text}</div>
            {r.action_hint && <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{r.action_hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Memory({ cid }) {
  const [data, setData] = useState(null);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const load = useCallback(() => {
    apiClient.get(`/responsibility-center/${cid}/orai/memory`)
      .then((r) => setData(r.data)).catch((e) => toast.error(e?.response?.data?.detail || "Managers only"));
  }, [cid]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="or-surface p-6 text-center"><div className="rcx-loader" /></div>;

  const act = async (fn, ok) => { try { await fn(); ok && toast.success(ok); load(); } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); } };
  return (
    <div className="space-y-3" data-testid="intel-memory">
      <div className="or-surface p-3 flex items-center gap-2 flex-wrap">
        <div className="text-[11px] flex-1" style={{ color: "var(--text-muted)" }}>
          ORAi remembers these notes in every conversation for this Center. All actions are audited.
        </div>
        <button className="or-btn or-btn-ghost text-xs" data-testid="intel-memory-toggle"
          onClick={() => act(() => apiClient.put(`/responsibility-center/${cid}/orai/memory/settings`, { enabled: !data.enabled }),
            data.enabled ? "Memory disabled" : "Memory enabled")}>
          <Power size={12} style={{ color: data.enabled ? "#10E670" : "#FF6B6B" }} /> {data.enabled ? "Enabled" : "Disabled"}
        </button>
        <button className="or-btn or-btn-ghost text-xs" data-testid="intel-memory-export"
          onClick={() => act(async () => {
            const r = await apiClient.get(`/responsibility-center/${cid}/orai/memory/export`);
            const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob); a.download = "orai-memory.json"; a.click();
          }, "Memory exported")}>
          <Download size={12} /> Export
        </button>
        <button className="or-btn or-btn-ghost text-xs" data-testid="intel-memory-reset"
          onClick={() => window.confirm("Delete ALL ORAi memory for this Center?") &&
            act(() => apiClient.post(`/responsibility-center/${cid}/orai/memory/reset`), "Memory reset")}>
          <Trash2 size={12} /> Reset
        </button>
      </div>

      <div className="or-surface p-3">
        <div className="flex gap-2 flex-wrap">
          <select className="or-input text-xs" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="intel-memory-category">
            {["general", "preference", "organization", "roles", "learning_style", "teaching", "goals", "routines", "workflows", "prompts"].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="or-input flex-1 min-w-[180px] text-xs" placeholder="Something ORAi should remember…"
            value={content} onChange={(e) => setContent(e.target.value)} data-testid="intel-memory-input" />
          <button className="or-btn text-xs" disabled={!content.trim()} data-testid="intel-memory-add"
            onClick={() => act(async () => {
              await apiClient.post(`/responsibility-center/${cid}/orai/memory`, { content, category });
              setContent("");
            }, "Memory saved")}>
            <Plus size={12} /> Remember
          </button>
        </div>
      </div>

      {data.memories.map((m) => (
        <div key={m.id} className="or-surface p-3 flex gap-2 items-start" data-testid={`intel-memory-item-${m.id}`}>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5"
            style={{ background: "rgba(194,107,255,0.15)", color: "#C26BFF" }}>{m.category}</span>
          <div className="text-[11px] flex-1">{m.content}</div>
          <button onClick={() => act(() => apiClient.patch(`/responsibility-center/${cid}/orai/memory/${m.id}`, { pinned: !m.pinned }))}
            title={m.pinned ? "Unpin" : "Pin"} aria-label={m.pinned ? "Unpin memory" : "Pin memory"} data-testid={`intel-memory-pin-${m.id}`}>
            {m.pinned ? <Pin size={13} style={{ color: "#F4A73B" }} /> : <PinOff size={13} style={{ color: "var(--text-muted)" }} />}
          </button>
          <button onClick={() => act(() => apiClient.delete(`/responsibility-center/${cid}/orai/memory/${m.id}`), "Memory deleted")}
            aria-label="Delete memory" data-testid={`intel-memory-del-${m.id}`}><Trash2 size={13} style={{ color: "var(--text-muted)" }} /></button>
        </div>
      ))}
    </div>
  );
}

function AutomationBuilder({ cid, meta, onSaved, onCancel }) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("lesson_completed");
  const [actions, setActions] = useState([]);
  const [dragIdx, setDragIdx] = useState(null);

  const move = (from, to) => {
    if (to < 0 || to >= actions.length) return;
    const next = [...actions];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setActions(next);
  };
  const save = async () => {
    try {
      await apiClient.post(`/responsibility-center/${cid}/automations`,
        { name: name || undefined, trigger: { type: trigger }, actions });
      toast.success("Automation created");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
  };
  return (
    <div className="or-surface p-4" data-testid="automation-builder">
      <input className="or-input w-full text-sm mb-3" placeholder="Automation name"
        value={name} onChange={(e) => setName(e.target.value)} data-testid="automation-name" />
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#F4A73B" }}>WHEN</div>
      <select className="or-input w-full text-xs mb-3" value={trigger} onChange={(e) => setTrigger(e.target.value)} data-testid="automation-trigger">
        {(meta.triggers || []).map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t] || t}</option>)}
      </select>
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#10E670" }}>THEN</div>
      <div className="space-y-1.5 mb-2">
        {actions.map((a, i) => (
          <div key={i} draggable onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragIdx != null && dragIdx !== i) move(dragIdx, i); setDragIdx(null); }}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-grab"
            style={{ background: "rgba(16,230,112,0.06)", border: "1px solid rgba(16,230,112,0.3)" }}
            data-testid={`automation-action-${i}`}>
            <GripVertical size={12} style={{ color: "var(--text-muted)" }} />
            <span className="text-[11px] flex-1">{ACTION_LABELS[a.type]}</span>
            {a.type === "award_fire_power" && (
              <input className="or-input text-[10px] w-16 py-0.5" type="number" min={1} max={1000} value={a.amount}
                onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))}
                data-testid={`automation-amount-${i}`} />
            )}
            <button onClick={() => move(i, i - 1)} aria-label="Move action up" data-testid={`automation-up-${i}`}><ArrowUp size={11} /></button>
            <button onClick={() => move(i, i + 1)} aria-label="Move action down" data-testid={`automation-down-${i}`}><ArrowDown size={11} /></button>
            <button onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label="Remove action" data-testid={`automation-remove-${i}`}><X size={12} /></button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {(meta.actions || []).filter((a) => !actions.some((x) => x.type === a)).map((a) => (
          <button key={a} className="text-[10px] px-2 py-1 rounded-full transition-colors hover:bg-white/10"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px dashed rgba(255,255,255,0.2)" }}
            onClick={() => setActions([...actions, { type: a, amount: 10 }])} data-testid={`automation-add-${a}`}>
            + {ACTION_LABELS[a] || a}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="or-btn text-xs" onClick={save} disabled={!actions.length} data-testid="automation-save">
          <Check size={12} /> Create automation
        </button>
        <button className="or-btn or-btn-ghost text-xs" onClick={onCancel} data-testid="automation-cancel">Cancel</button>
      </div>
      <div className="text-[9px] mt-2" style={{ color: "var(--text-muted)" }}>
        Safe actions run automatically. Fire Power awards always wait for a manager's approval — nothing destructive runs on its own.
      </div>
    </div>
  );
}

function Automations({ cid }) {
  const [data, setData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [building, setBuilding] = useState(false);
  const load = useCallback(() => {
    apiClient.get(`/responsibility-center/${cid}/automations`).then((r) => setData(r.data)).catch(() => {});
    apiClient.get(`/responsibility-center/${cid}/automations/runs`).then((r) => setRuns(r.data.runs)).catch(() => {});
  }, [cid]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="or-surface p-6 text-center"><div className="rcx-loader" /></div>;

  const act = (fn, ok) => fn().then(() => { ok && toast.success(ok); load(); }).catch((e) => toast.error(e?.response?.data?.detail || "Failed"));
  const pending = runs.filter((r) => r.status === "pending_approval");
  return (
    <div className="space-y-3" data-testid="intel-automations">
      <div className="flex items-center gap-2">
        <div className="text-[11px] flex-1" style={{ color: "var(--text-muted)" }}>WHEN something happens → THEN ORAi acts (safely).</div>
        <button className="or-btn or-btn-ghost text-xs" data-testid="automation-run-check"
          onClick={() => act(() => apiClient.post(`/responsibility-center/${cid}/automations/run-check`), "Checked time-based triggers")}>
          <Zap size={12} /> Run checks now
        </button>
        <button className="or-btn text-xs" onClick={() => setBuilding(true)} data-testid="automation-new"><Plus size={12} /> New automation</button>
      </div>
      {building && <AutomationBuilder cid={cid} meta={data} onSaved={() => { setBuilding(false); load(); }} onCancel={() => setBuilding(false)} />}

      {!!pending.length && (
        <div className="or-surface p-3" style={{ border: "1px solid rgba(244,167,59,0.4)" }} data-testid="automation-pending">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#F4A73B" }}>Waiting for your approval</div>
          {pending.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1.5 flex-wrap" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="text-[11px] flex-1">
                {r.automation_name}: {r.pending_actions.map((p) => `${p.amount} 🔥 → @${p.username}`).join(", ")}
              </span>
              <button className="or-btn text-[10px] py-1" data-testid={`automation-approve-${r.id}`}
                onClick={() => act(() => apiClient.post(`/responsibility-center/${cid}/automations/runs/${r.id}/approve`, { approve: true }), "Approved")}>
                <Check size={11} /> Approve
              </button>
              <button className="or-btn or-btn-ghost text-[10px] py-1" data-testid={`automation-reject-${r.id}`}
                onClick={() => act(() => apiClient.post(`/responsibility-center/${cid}/automations/runs/${r.id}/approve`, { approve: false }), "Rejected")}>
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {data.automations.map((a) => (
        <div key={a.id} className="or-surface p-3" data-testid={`automation-card-${a.id}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12px] font-bold flex-1">{a.name}</div>
            <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{a.run_count} runs</span>
            <button className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={a.enabled ? { background: "rgba(16,230,112,0.15)", color: "#10E670" } : { background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
              onClick={() => act(() => apiClient.patch(`/responsibility-center/${cid}/automations/${a.id}`, { enabled: !a.enabled }))}
              data-testid={`automation-toggle-${a.id}`}>
              {a.enabled ? "On" : "Off"}
            </button>
            <button onClick={() => window.confirm("Delete this automation?") &&
              act(() => apiClient.delete(`/responsibility-center/${cid}/automations/${a.id}`), "Deleted")}
              aria-label="Delete automation" data-testid={`automation-delete-${a.id}`}><Trash2 size={13} style={{ color: "var(--text-muted)" }} /></button>
          </div>
          <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
            <b style={{ color: "#F4A73B" }}>WHEN</b> {TRIGGER_LABELS[a.trigger?.type] || a.trigger?.type} →{" "}
            <b style={{ color: "#10E670" }}>THEN</b> {a.actions.map((x) => ACTION_LABELS[x.type] || x.type).join(" · ")}
          </div>
        </div>
      ))}
      {!data.automations.length && !building && (
        <div className="or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No automations yet — create your first WHEN → THEN flow.
        </div>
      )}
    </div>
  );
}

function Drafts({ cid }) {
  const [drafts, setDrafts] = useState(null);
  const [kind, setKind] = useState("task");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    apiClient.get(`/responsibility-center/${cid}/orai/drafts`).then((r) => setDrafts(r.data.drafts)).catch(() => setDrafts([]));
  }, [cid]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!instructions.trim()) return;
    setBusy(true);
    try {
      await apiClient.post(`/responsibility-center/${cid}/orai/drafts/generate`,
        { kind, instructions }, { timeout: 120000 });
      setInstructions("");
      toast.success("Draft ready — review and approve it below");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "ORAi could not draft that"); }
    finally { setBusy(false); }
  };
  const decide = (id, approve) =>
    (approve ? apiClient.post(`/responsibility-center/${cid}/orai/drafts/${id}/approve`, {})
      : apiClient.delete(`/responsibility-center/${cid}/orai/drafts/${id}`))
      .then(() => { toast.success(approve ? "Approved & created" : "Draft discarded"); load(); })
      .catch((e) => toast.error(e?.response?.data?.detail || "Failed"));

  if (!drafts) return <div className="or-surface p-6 text-center"><div className="rcx-loader" /></div>;
  return (
    <div className="space-y-3" data-testid="intel-drafts">
      <div className="or-surface p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#C26BFF" }}>
          <Sparkles size={12} className="inline mr-1" />Ask ORAi to draft — nothing publishes until you approve
        </div>
        <div className="flex gap-2 flex-wrap">
          <select className="or-input text-xs" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="draft-kind">
            {["task", "reminder", "event", "announcement", "lesson", "course_outline", "report"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
          </select>
          <input className="or-input flex-1 min-w-[180px] text-xs" placeholder="e.g. Weekly chores rotation for the kids"
            value={instructions} onChange={(e) => setInstructions(e.target.value)} data-testid="draft-instructions" />
          <button className="or-btn text-xs" onClick={generate} disabled={busy || !instructions.trim()} data-testid="draft-generate">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Draft it
          </button>
        </div>
      </div>
      {drafts.map((d) => (
        <div key={d.id} className="or-surface p-3" data-testid={`draft-card-${d.id}`}>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(194,107,255,0.15)", color: "#C26BFF" }}>{d.kind}</span>
            <div className="text-[12px] font-bold flex-1">{d.content?.title || d.instructions?.slice(0, 60)}</div>
            {d.status === "draft" ? (
              <>
                <button className="or-btn text-[10px] py-1" onClick={() => decide(d.id, true)} data-testid={`draft-approve-${d.id}`}>
                  <Check size={11} /> Approve
                </button>
                <button className="or-btn or-btn-ghost text-[10px] py-1" onClick={() => decide(d.id, false)} data-testid={`draft-reject-${d.id}`}>
                  <X size={11} />
                </button>
              </>
            ) : <span className="text-[9px] font-bold flex items-center gap-1" style={{ color: "#10E670" }}><CheckCircle2 size={11} /> Approved</span>}
          </div>
          <div className="text-[10px] whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>
            {(d.content?.description || d.content?.body || JSON.stringify(d.content, null, 1))?.slice(0, 400)}
          </div>
        </div>
      ))}
      {!drafts.length && <div className="or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No drafts yet.</div>}
    </div>
  );
}

function Templates({ cid }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    apiClient.get(`/responsibility-center/${cid}/templates?include_archived=true`)
      .then((r) => setData(r.data)).catch(() => setData({ templates: [] }));
  }, [cid]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="or-surface p-6 text-center"><div className="rcx-loader" /></div>;
  const act = (fn, ok) => fn().then(() => { ok && toast.success(ok); load(); }).catch((e) => toast.error(e?.response?.data?.detail || "Failed"));
  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json";
    input.onchange = async () => {
      try {
        const parsed = JSON.parse(await input.files[0].text());
        await apiClient.post(`/responsibility-center/${cid}/templates/import`, { template: parsed.template || parsed });
        toast.success("Template imported"); load();
      } catch { toast.error("Invalid template file"); }
    };
    input.click();
  };
  return (
    <div className="space-y-3" data-testid="intel-templates">
      <div className="flex items-center gap-2">
        <div className="text-[11px] flex-1" style={{ color: "var(--text-muted)" }}>
          Save courses, tasks, automations and layouts as reusable templates. Save new ones from the Course Studio or via export/import.
        </div>
        <button className="or-btn or-btn-ghost text-xs" onClick={importFile} data-testid="template-import"><Upload size={12} /> Import</button>
      </div>
      {data.templates.map((t) => (
        <div key={t.id} className="or-surface p-3 flex items-center gap-2 flex-wrap" data-testid={`template-card-${t.id}`}>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(46,160,255,0.15)", color: "#2EA0FF" }}>{t.kind}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold truncate">{t.name} {t.status === "archived" && <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>(archived)</span>}</div>
            <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>v{t.version} · by @{t.owner_username}</div>
          </div>
          <button className="or-btn text-[10px] py-1" data-testid={`template-install-${t.id}`}
            onClick={() => act(() => apiClient.post(`/responsibility-center/${cid}/templates/${t.id}/install`), "Installed into this Center")}>
            Install
          </button>
          <button className="or-btn or-btn-ghost p-1.5" title="Duplicate" data-testid={`template-duplicate-${t.id}`}
            onClick={() => act(() => apiClient.post(`/responsibility-center/${cid}/templates/${t.id}/duplicate`), "Duplicated")}>
            <Copy size={12} />
          </button>
          <button className="or-btn or-btn-ghost p-1.5" title="Export JSON" data-testid={`template-export-${t.id}`}
            onClick={() => act(async () => {
              const r = await apiClient.get(`/responsibility-center/${cid}/templates/${t.id}/export`);
              const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob); a.download = `${t.name}.template.json`; a.click();
            })}>
            <Download size={12} />
          </button>
          <button className="or-btn or-btn-ghost p-1.5" title={t.status === "archived" ? "Restore" : "Archive"} data-testid={`template-archive-${t.id}`}
            onClick={() => act(() => apiClient.patch(`/responsibility-center/${cid}/templates/${t.id}`,
              { status: t.status === "archived" ? "active" : "archived" }))}>
            <Archive size={12} />
          </button>
          <button className="or-btn or-btn-ghost p-1.5" title="Delete" data-testid={`template-delete-${t.id}`}
            onClick={() => window.confirm("Delete this template?") &&
              act(() => apiClient.delete(`/responsibility-center/${cid}/templates/${t.id}`), "Deleted")}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {!data.templates.length && <div className="or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No templates yet — save a course from the Course Studio to get started.</div>}
    </div>
  );
}

// ORAi Intelligence Dashboard — Phase 5 hub for a Center.
export default function RcIntelligence() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ov, setOv] = useState(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    apiClient.get(`/responsibility-center/${id}/intelligence/overview`)
      .then((r) => setOv(r.data))
      .catch((e) => toast.error(e?.response?.data?.detail || "Could not load intelligence"));
  }, [id]);

  return (
    <div className="max-w-4xl mx-auto rcx-scope rcx-page-enter pb-10" data-testid="rc-intelligence-page">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${id}`)} data-testid="intel-back">
          <ArrowLeft size={13} /> Center
        </button>
        <h1 className="text-lg sm:text-xl flex items-center gap-2 flex-1" style={{ fontFamily: "var(--font-display)" }}>
          <BrainCircuit size={20} style={{ color: "#C26BFF" }} /> ORAi Intelligence
        </h1>
      </div>
      <div className="flex gap-1 mb-4 overflow-x-auto no-scrollbar" data-testid="intel-tabs">
        {TABS.filter((t) => t.id === "overview" || t.id === "suggestions" || ov?.can_manage).map(({ id: tid, label, Icon }) => (
          <button key={tid} onClick={() => setTab(tid)}
            className="shrink-0 flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors"
            style={tab === tid
              ? { background: "rgba(194,107,255,0.16)", border: "1px solid rgba(194,107,255,0.5)", color: "#C26BFF" }
              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid={`intel-tab-${tid}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (ov ? <Overview ov={ov} cid={id} /> : <div className="or-surface p-8 text-center"><div className="rcx-loader" /></div>)}
      {tab === "suggestions" && <Suggestions cid={id} />}
      {tab === "memory" && <Memory cid={id} />}
      {tab === "automations" && <Automations cid={id} />}
      {tab === "drafts" && <Drafts cid={id} />}
      {tab === "templates" && <Templates cid={id} />}
    </div>
  );
}
