import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CalendarClock, Plus, Trash2, Check, X, Loader2, Clock, ShieldCheck,
  Sun, Moon, BookOpen, Users, Sparkles, HandHelping, ListTodo, PencilLine, Pause, Play,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const FEATURE_LABELS = {
  courses: "Courses & Lessons", orai: "ORAi Assistant", sounds: "Sounds", realms: "Realms",
  messenger: "Messenger", creation: "Creating & Posting", feed: "Feed Browsing", entertainment: "Entertainment",
};
const KIND_ICONS = { learning: BookOpen, homework: ListTodo, creative: PencilLine, family: Users, social: Users, entertainment: Sun, quiet: Moon, sleep: Moon, custom: CalendarClock };
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TABS = ["Today", "Windows", "Requests", "Journal", "Report"];

function WindowForm({ cid, existing, onDone }) {
  const [w, setW] = useState(existing || { name: "", kind: "learning", start: "16:00", end: "18:00", days: [...DAYS.slice(0, 5)], features_available: [], features_unavailable: [], member_note: "", require_responsibilities: false });
  const [busy, setBusy] = useState(false);
  const toggle = (key, v) => setW((x) => ({ ...x, [key]: x[key].includes(v) ? x[key].filter((y) => y !== v) : [...x[key], v] }));
  const save = async () => {
    setBusy(true);
    try {
      if (existing) await apiClient.patch(`/responsibility-center/${cid}/routines/windows/${existing.id}`, w);
      else await apiClient.post(`/responsibility-center/${cid}/routines/windows`, w);
      toast.success("Activity window saved");
      onDone(true);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
    finally { setBusy(false); }
  };
  return (
    <div className="or-surface p-4 space-y-2" data-testid="window-form">
      <div className="flex gap-2 flex-wrap">
        <input className="or-input flex-1 min-w-[150px] text-xs" placeholder="Window name" value={w.name}
          onChange={(e) => setW({ ...w, name: e.target.value })} data-testid="window-name" />
        <select className="or-input text-xs" value={w.kind} onChange={(e) => setW({ ...w, kind: e.target.value })} data-testid="window-kind">
          {Object.keys(KIND_ICONS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input className="or-input text-xs w-24" type="time" value={w.start} onChange={(e) => setW({ ...w, start: e.target.value })} data-testid="window-start" />
        <input className="or-input text-xs w-24" type="time" value={w.end} onChange={(e) => setW({ ...w, end: e.target.value })} data-testid="window-end" />
      </div>
      <div className="flex gap-1 flex-wrap">
        {DAYS.map((d) => (
          <button key={d} onClick={() => toggle("days", d)} className="text-[10px] px-2 py-1 rounded-full uppercase"
            style={w.days.includes(d) ? { background: "rgba(46,160,255,0.16)", color: "#2EA0FF", border: "1px solid rgba(46,160,255,0.5)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid={`window-day-${d}`}>{d}</button>
        ))}
      </div>
      <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#10E670" }}>Available during this window</div>
      <div className="flex gap-1 flex-wrap">
        {Object.entries(FEATURE_LABELS).map(([f, label]) => (
          <button key={f} onClick={() => toggle("features_available", f)} className="text-[10px] px-2 py-1 rounded-full"
            style={w.features_available.includes(f) ? { background: "rgba(16,230,112,0.14)", color: "#10E670", border: "1px solid rgba(16,230,112,0.5)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid={`window-avail-${f}`}>{label}</button>
        ))}
      </div>
      <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#FF8A5A" }}>Paused during this window</div>
      <div className="flex gap-1 flex-wrap">
        {Object.entries(FEATURE_LABELS).map(([f, label]) => (
          <button key={f} onClick={() => toggle("features_unavailable", f)} className="text-[10px] px-2 py-1 rounded-full"
            style={w.features_unavailable.includes(f) ? { background: "rgba(255,138,90,0.14)", color: "#FF8A5A", border: "1px solid rgba(255,138,90,0.5)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid={`window-unavail-${f}`}>{label}</button>
        ))}
      </div>
      <input className="or-input w-full text-xs" placeholder="Note the member will see (why this window exists)"
        value={w.member_note} onChange={(e) => setW({ ...w, member_note: e.target.value })} data-testid="window-note" />
      <div className="flex gap-2">
        <button className="or-btn text-xs" onClick={save} disabled={busy || !w.name} data-testid="window-save">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save window
        </button>
        <button className="or-btn or-btn-ghost text-xs" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </div>
  );
}

export default function RcRoutines() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState("Today");
  const [ov, setOv] = useState(null);
  const [memberId, setMemberId] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | window
  const [templates, setTemplates] = useState([]);
  const [requests, setRequests] = useState([]);
  const [journal, setJournal] = useState(null);
  const [report, setReport] = useState(null);
  const [reqForm, setReqForm] = useState({ feature: "any", reason: "", duration_minutes: 30 });

  const load = useCallback(() => {
    apiClient.get(`/responsibility-center/${id}/routines/overview${memberId ? `?member_id=${memberId}` : ""}`)
      .then((r) => setOv(r.data)).catch((e) => toast.error(e?.response?.data?.detail || "Could not load routines"));
  }, [id, memberId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab === "Windows") apiClient.get(`/responsibility-center/${id}/routines/templates`).then((r) => setTemplates(r.data.templates)).catch(() => {});
    if (tab === "Requests") apiClient.get(`/responsibility-center/${id}/routines/requests`).then((r) => setRequests(r.data.requests)).catch(() => {});
    if (tab === "Journal") apiClient.get(`/responsibility-center/${id}/routines/external${memberId ? `?member_id=${memberId}` : ""}`).then((r) => setJournal(r.data)).catch(() => {});
    if (tab === "Report") apiClient.get(`/responsibility-center/${id}/routines/report${memberId ? `?member_id=${memberId}` : ""}`).then((r) => setReport(r.data)).catch(() => {});
  }, [tab, id, memberId]);

  if (!ov) return <div className="max-w-4xl mx-auto or-surface p-8 text-center rcx-scope"><div className="rcx-loader" /></div>;
  const { access, can_manage } = ov;
  const decide = (rid, decision, note = "") =>
    apiClient.post(`/responsibility-center/${id}/routines/requests/${rid}/decide`, { decision, note })
      .then(() => { toast.success(decision.replace("_", " ")); apiClient.get(`/responsibility-center/${id}/routines/requests`).then((r) => setRequests(r.data.requests)); load(); })
      .catch((e) => toast.error(e?.response?.data?.detail || "Failed"));

  return (
    <div className="max-w-4xl mx-auto rcx-scope rcx-page-enter pb-10" data-testid="rc-routines-page">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${id}`)} data-testid="routines-back">
          <ArrowLeft size={13} /> Center
        </button>
        <h1 className="text-lg sm:text-xl flex items-center gap-2 flex-1" style={{ fontFamily: "var(--font-display)" }}>
          <CalendarClock size={20} style={{ color: "#2EA0FF" }} /> Digital Routines & Access
        </h1>
        {can_manage && ov.members.length > 0 && (
          <select className="or-input text-xs" value={memberId} onChange={(e) => setMemberId(e.target.value)} data-testid="routines-member-select">
            <option value="">Me ({access.plan?.age_band || "guardian"})</option>
            {ov.members.map((m) => <option key={m.user_id} value={m.user_id}>@{m.username} · {m.role}</option>)}
          </select>
        )}
      </div>
      <div className="text-[10px] mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(46,160,255,0.06)", border: "1px solid rgba(46,160,255,0.25)", color: "var(--text-muted)" }} data-testid="routines-honesty-note">
        {ov.honesty_note}
      </div>
      <div className="flex gap-1 mb-4 overflow-x-auto no-scrollbar" data-testid="routines-tabs">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors"
            style={tab === t ? { background: "rgba(46,160,255,0.16)", border: "1px solid rgba(46,160,255,0.5)", color: "#2EA0FF" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid={`routines-tab-${t.toLowerCase()}`}>{t}</button>
        ))}
      </div>

      {tab === "Today" && (
        <div className="space-y-3 rcx-stagger" data-testid="routines-today">
          {access.open_responsibilities.length > 0 && (
            <div className="or-surface p-3" style={{ borderLeft: "3px solid #F4A73B" }} data-testid="routines-resp-first">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5" style={{ color: "#F4A73B" }}>
                <ListTodo size={12} /> Responsibilities first
              </div>
              {access.open_responsibilities.map((r) => (
                <div key={r.id} className="text-[11px] py-0.5">• {r.title}</div>
              ))}
            </div>
          )}
          <div className="or-surface p-3" data-testid="routines-features">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#2EA0FF" }}>
              Right now · {access.local_time} ({access.timezone})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {Object.entries(access.features).map(([f, st]) => (
                <div key={f} className="rounded-lg px-2.5 py-2 flex items-start gap-2"
                  style={{ background: st.available ? "rgba(16,230,112,0.05)" : "rgba(255,138,90,0.05)", border: `1px solid ${st.available ? "rgba(16,230,112,0.3)" : "rgba(255,138,90,0.35)"}` }}
                  data-testid={`routines-feature-${f}`}>
                  <span className="rounded-full inline-block shrink-0 mt-1" style={{ width: 7, height: 7, background: st.available ? "#10E670" : "#FF8A5A" }} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold">{FEATURE_LABELS[f]}</div>
                    <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                      {st.available ? (st.via === "approved exception" ? `Available via approved exception` : "Available") :
                        `${st.reason} · back ${st.until}${st.set_by ? ` · set by ${st.set_by}` : ""}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {access.active_windows.length > 0 && (
            <div className="or-surface p-3" data-testid="routines-active-windows">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#C26BFF" }}>Active windows</div>
              {access.active_windows.map((w) => <div key={w.id} className="text-[11px] py-0.5">{w.name} · {w.start}–{w.end}</div>)}
            </div>
          )}
          <div className="or-surface p-3" data-testid="routines-request-card">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: "#10E670" }}>
              <HandHelping size={12} /> Ask for an exception or schedule review
            </div>
            <div className="flex gap-2 flex-wrap">
              <select className="or-input text-xs" value={reqForm.feature} onChange={(e) => setReqForm({ ...reqForm, feature: e.target.value })} data-testid="request-feature">
                <option value="any">Any activity</option>
                {Object.entries(FEATURE_LABELS).map(([f, l]) => <option key={f} value={f}>{l}</option>)}
              </select>
              <input className="or-input flex-1 min-w-[160px] text-xs" placeholder="Why? (your guardian will see this)"
                value={reqForm.reason} onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })} data-testid="request-reason" />
              <input className="or-input text-xs w-20" type="number" min={5} max={480} value={reqForm.duration_minutes}
                onChange={(e) => setReqForm({ ...reqForm, duration_minutes: Number(e.target.value) })} title="Minutes" data-testid="request-minutes" />
              <button className="or-btn text-xs" disabled={!reqForm.reason.trim()} data-testid="request-submit"
                onClick={() => apiClient.post(`/responsibility-center/${id}/routines/requests`, { kind: "exception", ...reqForm })
                  .then(() => { toast.success("Request sent to your guardians"); setReqForm({ ...reqForm, reason: "" }); })
                  .catch((e) => toast.error(e?.response?.data?.detail || "Could not send"))}>
                Send request
              </button>
            </div>
          </div>
          {!!ov.recent_changes.length && (
            <div className="or-surface p-3" data-testid="routines-recent-changes">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Recent changes (visible to everyone)</div>
              {ov.recent_changes.map((c, i) => <div key={i} className="text-[10px] py-0.5" style={{ color: "var(--text-muted)" }}>{c.detail} · {c.created_at?.slice(0, 10)}</div>)}
            </div>
          )}
        </div>
      )}

      {tab === "Windows" && (
        <div className="space-y-3" data-testid="routines-windows">
          {can_manage && (
            <div className="flex gap-2 flex-wrap items-center">
              <button className="or-btn text-xs" onClick={() => setEditing("new")} data-testid="window-new"><Plus size={12} /> New window</button>
              <select className="or-input text-xs" defaultValue="" data-testid="template-select"
                onChange={(e) => e.target.value && apiClient.post(`/responsibility-center/${id}/routines/templates/${e.target.value}/install`, {})
                  .then(() => { toast.success("Template installed — every window stays editable"); load(); e.target.value = ""; })
                  .catch((err) => toast.error(err?.response?.data?.detail || "Failed"))}>
                <option value="">Install a template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {editing === "new" && <WindowForm cid={id} onDone={(ok) => { setEditing(null); ok && load(); }} />}
          {ov.windows.map((w) => {
            const Icon = KIND_ICONS[w.kind] || CalendarClock;
            return editing?.id === w.id ? (
              <WindowForm key={w.id} cid={id} existing={w} onDone={(ok) => { setEditing(null); ok && load(); }} />
            ) : (
              <div key={w.id} className="or-surface p-3 flex items-start gap-2.5" data-testid={`window-card-${w.id}`}>
                <Icon size={16} className="shrink-0 mt-0.5" style={{ color: "#2EA0FF" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold">{w.name} {w.status === "paused" && <span className="text-[9px]" style={{ color: "#F4A73B" }}>(paused)</span>}</div>
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {w.start}–{w.end} · {(w.days || []).join(", ")}
                    {w.features_unavailable?.length ? ` · pauses: ${w.features_unavailable.map((f) => FEATURE_LABELS[f]).join(", ")}` : ""}
                  </div>
                  {w.member_note && <div className="text-[10px] mt-0.5" style={{ color: "#4DD6C1" }}>"{w.member_note}"</div>}
                  <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>set by @{w.created_by_username} · updated {w.updated_at?.slice(0, 10)}</div>
                </div>
                {can_manage && (
                  <>
                    <button onClick={() => apiClient.patch(`/responsibility-center/${id}/routines/windows/${w.id}`, { status: w.status === "paused" ? "active" : "paused" }).then(load)}
                      aria-label={w.status === "paused" ? "Resume window" : "Pause window"} data-testid={`window-pause-${w.id}`}>
                      {w.status === "paused" ? <Play size={13} style={{ color: "#10E670" }} /> : <Pause size={13} style={{ color: "var(--text-muted)" }} />}
                    </button>
                    <button onClick={() => setEditing(w)} aria-label="Edit window" data-testid={`window-edit-${w.id}`}><PencilLine size={13} style={{ color: "var(--text-muted)" }} /></button>
                    <button onClick={() => window.confirm("Remove this window?") && apiClient.delete(`/responsibility-center/${id}/routines/windows/${w.id}`).then(() => { toast.success("Removed"); load(); })}
                      aria-label="Delete window" data-testid={`window-delete-${w.id}`}><Trash2 size={13} style={{ color: "var(--text-muted)" }} /></button>
                  </>
                )}
              </div>
            );
          })}
          {!ov.windows.length && editing !== "new" && (
            <div className="or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No activity windows yet{can_manage ? " — create one or install a template above." : "."}
            </div>
          )}
        </div>
      )}

      {tab === "Requests" && (
        <div className="space-y-2" data-testid="routines-requests">
          {requests.map((r) => (
            <div key={r.id} className="or-surface p-3" data-testid={`request-card-${r.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(46,160,255,0.14)", color: "#2EA0FF" }}>{r.kind}</span>
                <div className="text-[12px] font-semibold flex-1">@{r.member_username} · {FEATURE_LABELS[r.feature] || "Any activity"} · {r.duration_minutes} min</div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{
                  background: r.status === "approved" ? "rgba(16,230,112,0.14)" : r.status === "pending" ? "rgba(244,167,59,0.14)" : "rgba(255,255,255,0.06)",
                  color: r.status === "approved" ? "#10E670" : r.status === "pending" ? "#F4A73B" : "var(--text-muted)" }}>{r.status}</span>
              </div>
              <div className="text-[11px] mt-1">"{r.reason}"</div>
              <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {r.responsibilities_open} responsibilit{r.responsibilities_open === 1 ? "y" : "ies"} open when requested
                {r.guardian_note ? ` · guardian: "${r.guardian_note}"` : ""}
              </div>
              {can_manage && r.status === "pending" && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <button className="or-btn text-[10px] py-1" onClick={() => decide(r.id, "approve_once")} data-testid={`req-approve-once-${r.id}`}><Check size={11} /> Once</button>
                  <button className="or-btn text-[10px] py-1" onClick={() => decide(r.id, "approve_today")} data-testid={`req-approve-today-${r.id}`}>Today</button>
                  <button className="or-btn text-[10px] py-1" onClick={() => decide(r.id, "approve_recurring")} data-testid={`req-approve-recurring-${r.id}`}>Recurring</button>
                  <button className="or-btn or-btn-ghost text-[10px] py-1" onClick={() => decide(r.id, "decline", window.prompt("Optional explanation for the member:") || "")} data-testid={`req-decline-${r.id}`}><X size={11} /> Decline</button>
                </div>
              )}
              {can_manage && r.status === "approved" && (
                <button className="or-btn or-btn-ghost text-[10px] py-1 mt-2" onClick={() => decide(r.id, "revoke")} data-testid={`req-revoke-${r.id}`}>Revoke exception</button>
              )}
            </div>
          ))}
          {!requests.length && <div className="or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No access requests yet.</div>}
        </div>
      )}

      {tab === "Journal" && journal && (
        <div className="space-y-2" data-testid="routines-journal">
          <div className="text-[10px] px-3 py-2 rounded-lg" style={{ background: "rgba(244,167,59,0.06)", border: "1px solid rgba(244,167,59,0.3)", color: "var(--text-muted)" }}>{journal.disclaimer}</div>
          <div className="or-surface p-3 flex gap-2 flex-wrap">
            <input className="or-input flex-1 min-w-[160px] text-xs" placeholder="Activity outside OurRealm (e.g. soccer, console game)" id="ext-activity" data-testid="journal-activity" />
            <input className="or-input text-xs w-20" type="number" min={1} defaultValue={30} id="ext-minutes" data-testid="journal-minutes" />
            <button className="or-btn text-xs" data-testid="journal-add"
              onClick={() => {
                const a = document.getElementById("ext-activity").value;
                const m = Number(document.getElementById("ext-minutes").value) || 30;
                if (!a.trim()) return;
                apiClient.post(`/responsibility-center/${id}/routines/external`, { activity: a, minutes: m, member_id: memberId || undefined })
                  .then(() => { toast.success("Recorded (guidance only)"); document.getElementById("ext-activity").value = ""; setTab("Today"); setTimeout(() => setTab("Journal"), 0); })
                  .catch((e) => toast.error(e?.response?.data?.detail || "Failed"));
              }}>
              <Plus size={12} /> Record
            </button>
          </div>
          {journal.entries.map((e) => (
            <div key={e.id} className="or-surface p-2.5 flex items-center gap-2 text-[11px]" data-testid={`journal-entry-${e.id}`}>
              <Clock size={12} style={{ color: "var(--text-muted)" }} />
              <span className="flex-1">{e.activity} · {e.minutes} min</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(244,167,59,0.12)", color: "#F4A73B" }}>{e.source.replace("_", " ")}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "Report" && report && (
        <div className="space-y-3" data-testid="routines-report">
          <div className="or-surface p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#10E670" }}>{report.system_recorded.label}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[["Responsibilities", report.system_recorded.responsibilities_completed], ["Lessons", report.system_recorded.lessons_completed],
                ["Requests", report.system_recorded.access_requests], ["Exceptions", report.system_recorded.approved_exceptions]].map(([l, v]) => (
                <div key={l}><div className="text-lg font-extrabold">{v}</div><div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{l} · 7d</div></div>
              ))}
            </div>
          </div>
          <div className="or-surface p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#F4A73B" }}>{report.user_entered.label}</div>
            <div className="text-sm">{report.user_entered.external_minutes} recorded minutes across {report.user_entered.entries} entries</div>
          </div>
          <div className="text-[10px] px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", color: "var(--text-muted)" }} data-testid="report-disclaimer">
            {report.disclaimer} {report.missing_data}
          </div>
        </div>
      )}
    </div>
  );
}
