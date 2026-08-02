import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, UserPlus, Plus, Trash2, Copy, Lock, Unlock, Clock, ScrollText,
  ChevronRight, Loader2, CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import apiClient, { formatApiErrorDetail } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const nice = (s) => (s || "").replace(/_/g, " ");
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function TeenCard({ t, selected, onSelect, onOpen }) {
  return (
    <div className="or-surface p-4" data-testid={`parent-teen-card-${t.username}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={() => onSelect(t.teen_id)}
          className="mt-1" aria-label={`Select ${t.username}`} data-testid={`teen-select-${t.username}`} />
        <div className="w-11 h-11 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
          style={{ background: "rgba(46,160,255,0.15)" }}>
          {t.avatar_url ? <img src={t.avatar_url} alt="" className="w-full h-full object-cover" />
            : <span className="font-bold text-sm" style={{ color: "var(--brand-blue)" }}>{(t.username || "?")[0].toUpperCase()}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <b className="text-sm">@{t.username}</b>
            {t.age != null && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>age {t.age}</span>}
            <span className="w-2 h-2 rounded-full" title={t.online ? "Online" : "Offline"}
              style={{ background: t.online ? "var(--brand-green, #10E670)" : "rgba(255,255,255,0.25)" }} />
            {t.locked && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,63,90,0.15)", color: "#FF3F5A" }}>LOCKED</span>}
            {t.currently_blocked && !t.locked && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(244,167,59,0.15)", color: "#F4A73B" }}>BLOCKED NOW</span>}
          </div>
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {t.online ? "Online now" : t.last_active ? `Last active ${new Date(t.last_active).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Never active"}
            {t.routine_name ? ` · Routine: ${t.routine_name}` : " · No routine"}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {t.daily_limit_minutes != null
              ? `${t.time_used_minutes} min used · ${t.time_remaining_minutes} min left of ${t.daily_limit_minutes}`
              : `${t.time_used_minutes} min today · no limit`}
            {` · ${t.disabled_feature_count} features off · ${nice(t.content_filter)} filter`}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            Rule: {nice(t.controlling_rule)} · Centers: {(t.allowed_centers || []).slice(0, 4).map(nice).join(", ")}{(t.allowed_centers || []).length > 4 ? "…" : ""}
          </div>
        </div>
        <button className="or-btn or-btn-ghost p-1.5 shrink-0" onClick={() => onOpen(t.teen_id)}
          aria-label={`Manage ${t.username}`} data-testid={`teen-manage-${t.username}`}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function LinkSection({ reload }) {
  const [username, setUsername] = useState("");
  const [preset, setPreset] = useState("strict");
  const [outgoing, setOutgoing] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [ct, setCt] = useState({ username: "", name: "", email: "", temp_password: "", birth_date: "" });
  useEffect(() => {
    apiClient.get("/guardian/link-requests").then((r) => setOutgoing(r.data.outgoing || [])).catch(() => {});
  }, []);
  const send = async () => {
    try {
      await apiClient.post("/guardian/link-requests", { teen_username: username, preset });
      toast.success("Link request sent — the teen must accept it");
      setUsername("");
      const r = await apiClient.get("/guardian/link-requests"); setOutgoing(r.data.outgoing || []);
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };
  const createTeen = async () => {
    try {
      await apiClient.post("/guardian/create-teen", { ...ct, preset });
      toast.success("Teen account created — they must set their own password at first login");
      setShowCreate(false); setCt({ username: "", name: "", email: "", temp_password: "", birth_date: "" });
      reload();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };
  return (
    <div className="or-surface p-4" data-testid="parent-link-section">
      <div className="font-bold text-sm mb-2 flex items-center gap-2"><UserPlus size={15} style={{ color: "var(--brand-blue)" }} /> Add a teen</div>
      <div className="grid sm:grid-cols-3 gap-2 mb-2">
        <input className="or-input text-xs" placeholder="teen's username" value={username}
          onChange={(e) => setUsername(e.target.value)} data-testid="link-username-input" />
        <select className="or-input text-xs" value={preset} onChange={(e) => setPreset(e.target.value)}
          aria-label="Starting preset" data-testid="link-preset-select">
          <option value="strict">Strict (default)</option>
          <option value="balanced">Balanced</option>
          <option value="open">Open</option>
        </select>
        <div className="flex gap-2">
          <button className="or-btn text-xs font-bold flex-1" style={{ background: "var(--brand-blue)", color: "#fff" }}
            disabled={!username} onClick={send} data-testid="link-send-btn">Send request</button>
          <button className="or-btn or-btn-ghost text-xs" onClick={() => setShowCreate(!showCreate)} data-testid="create-teen-toggle">
            <Plus size={13} /> Create account
          </button>
        </div>
      </div>
      {outgoing.length > 0 && (
        <div className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }} data-testid="outgoing-requests">
          Pending: {outgoing.map((o) => `@${o.teen_username}`).join(", ")} (waiting for teen to accept)
        </div>
      )}
      {showCreate && (
        <div className="grid sm:grid-cols-2 gap-2 mt-2 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }} data-testid="create-teen-form">
          <input className="or-input text-xs" placeholder="username" value={ct.username} onChange={(e) => setCt({ ...ct, username: e.target.value })} data-testid="ct-username" />
          <input className="or-input text-xs" placeholder="Full name" value={ct.name} onChange={(e) => setCt({ ...ct, name: e.target.value })} data-testid="ct-name" />
          <input className="or-input text-xs" placeholder="email" value={ct.email} onChange={(e) => setCt({ ...ct, email: e.target.value })} data-testid="ct-email" />
          <input className="or-input text-xs" type="password" placeholder="Temporary password" value={ct.temp_password} onChange={(e) => setCt({ ...ct, temp_password: e.target.value })} data-testid="ct-password" />
          <label className="text-[10px]" style={{ color: "var(--text-muted)" }}>Date of birth (13–17)
            <input className="or-input text-xs w-full" type="date" value={ct.birth_date} onChange={(e) => setCt({ ...ct, birth_date: e.target.value })} data-testid="ct-birthdate" />
          </label>
          <div className="flex items-end">
            <button className="or-btn text-xs font-bold w-full" style={{ background: "var(--brand-green, #10E670)", color: "#0a0a0a" }}
              onClick={createTeen} data-testid="ct-create-btn">Create teen account</button>
          </div>
          <p className="sm:col-span-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
            The teen must create their own password at first login. Their password is never shown to you afterward.
          </p>
        </div>
      )}
    </div>
  );
}

function RoutinesSection({ routines, reload, selectedIds }) {
  const [editing, setEditing] = useState(null); // routine draft or null
  const blank = { name: "", enabled: true, features: {}, centers: {}, media_types: {},
    screen_time: { daily_minutes: null }, bedtime: { enabled: false, start: "21:30", end: "07:00" },
    schedule: { enabled: false, days: DAYS.slice(0, 5), windows: [{ start: "16:00", end: "19:00" }] } };
  const FEATURE_TOGGLES = ["create_posts", "view_posts", "direct_messages", "group_messages",
    "sounds", "videos", "realms", "communities", "orai_chat", "ai_voice",
    "ai_image_generation", "ai_course_builder", "ai_assistant_tools", "search_users"];
  const CENTER_TOGGLES = ["family", "education", "personal", "household", "business", "team", "community", "sports", "church"];
  const MEDIA_TOGGLES = ["images", "gifs", "videos", "audio", "music", "documents", "external_links"];
  const save = async () => {
    try {
      if (editing.id) await apiClient.patch(`/guardian/routines/${editing.id}`, editing);
      else await apiClient.post("/guardian/routines", editing);
      toast.success("Routine saved"); setEditing(null); reload();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };
  const tri = (obj, k, set) => {
    const v = obj[k];
    return (
      <button key={k} className="or-chip text-[10px]"
        style={{ opacity: v === undefined ? 0.5 : 1,
                 color: v === true ? "var(--brand-green, #10E670)" : v === false ? "#FF6B6B" : "var(--text-muted)" }}
        onClick={() => set(v === undefined ? true : v === true ? false : undefined)}
        title="Click to cycle: unset → allow → block" data-testid={`routine-toggle-${k}`}>
        {nice(k)}{v === true ? " ✓" : v === false ? " ✕" : ""}
      </button>
    );
  };
  const setIn = (section, k) => (v) => setEditing((ed) => {
    const s = { ...(ed[section] || {}) };
    if (v === undefined) delete s[k]; else s[k] = v;
    return { ...ed, [section]: s };
  });
  return (
    <div className="or-surface p-4" data-testid="parent-routines-section">
      <div className="flex items-center justify-between mb-2">
        <div className="font-bold text-sm flex items-center gap-2"><CalendarClock size={15} style={{ color: "#F4A73B" }} /> Routines</div>
        <button className="or-btn or-btn-ghost text-xs" onClick={() => setEditing(blank)} data-testid="routine-new-btn"><Plus size={13} /> New routine</button>
      </div>
      <div className="space-y-1.5">
        {routines.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No routines yet — create Homework, Weekend, Summer…</div>}
        {routines.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }} data-testid={`routine-row-${r.id}`}>
            <b className="flex-1 min-w-0 truncate">{r.name}{r.enabled === false ? " (disabled)" : ""}</b>
            <button className="or-btn or-btn-ghost text-[10px]" disabled={!selectedIds.length}
              onClick={async () => { await apiClient.post("/guardian/routines/assign", { teen_ids: selectedIds, routine_id: r.id }); toast.success(`Assigned to ${selectedIds.length} teen(s)`); reload(); }}
              data-testid={`routine-assign-${r.id}`}>Assign to selected</button>
            <button className="or-btn or-btn-ghost p-1" onClick={() => setEditing(r)} aria-label="Edit" data-testid={`routine-edit-${r.id}`}>✎</button>
            <button className="or-btn or-btn-ghost p-1" onClick={async () => { await apiClient.post(`/guardian/routines/${r.id}/duplicate`); reload(); }} aria-label="Duplicate" data-testid={`routine-dup-${r.id}`}><Copy size={12} /></button>
            <button className="or-btn or-btn-ghost p-1" onClick={async () => { if (window.confirm(`Delete routine "${r.name}"?`)) { await apiClient.delete(`/guardian/routines/${r.id}`); reload(); } }} aria-label="Delete" data-testid={`routine-del-${r.id}`}><Trash2 size={12} style={{ color: "#FF6B6B" }} /></button>
          </div>
        ))}
        {selectedIds.length > 0 && (
          <button className="or-btn or-btn-ghost text-[10px]" onClick={async () => { await apiClient.post("/guardian/routines/assign", { teen_ids: selectedIds, routine_id: null }); toast.success("Routine cleared"); reload(); }} data-testid="routine-clear-btn">
            Clear routine on selected
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-3 p-3 rounded-xl space-y-2" style={{ background: "rgba(255,255,255,0.04)" }} data-testid="routine-editor">
          <div className="flex gap-2">
            <input className="or-input text-xs flex-1" placeholder="Routine name (Homework, Weekend…)" value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="routine-name-input" />
            <label className="text-[10px] flex items-center gap-1"><input type="checkbox" checked={editing.enabled !== false}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} data-testid="routine-enabled" /> Enabled</label>
          </div>
          <div className="text-[10px] font-bold">Features (cycle: unset → allow ✓ → block ✕; blocks combine most-restrictively)</div>
          <div className="flex flex-wrap gap-1">{FEATURE_TOGGLES.map((k) => tri(editing.features || {}, k, setIn("features", k)))}</div>
          <div className="text-[10px] font-bold">Centers</div>
          <div className="flex flex-wrap gap-1">{CENTER_TOGGLES.map((k) => tri(editing.centers || {}, k, setIn("centers", k)))}</div>
          <div className="text-[10px] font-bold">Media</div>
          <div className="flex flex-wrap gap-1">{MEDIA_TOGGLES.map((k) => tri(editing.media_types || {}, k, setIn("media_types", k)))}</div>
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="text-[10px]" style={{ color: "var(--text-muted)" }}>Daily limit (min, empty = none)
              <input className="or-input text-xs w-full" type="number" min="0" value={editing.screen_time?.daily_minutes ?? ""}
                onChange={(e) => setEditing({ ...editing, screen_time: { daily_minutes: e.target.value === "" ? null : Number(e.target.value) } })}
                data-testid="routine-daily-limit" />
            </label>
            <label className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={!!editing.bedtime?.enabled}
                onChange={(e) => setEditing({ ...editing, bedtime: { ...(editing.bedtime || { start: "21:30", end: "07:00" }), enabled: e.target.checked } })}
                data-testid="routine-bedtime-enabled" /> Bedtime
              <span className="flex gap-1 mt-1">
                <input className="or-input text-xs" type="time" value={editing.bedtime?.start || "21:30"} onChange={(e) => setEditing({ ...editing, bedtime: { ...editing.bedtime, start: e.target.value, enabled: true } })} aria-label="Bedtime start" />
                <input className="or-input text-xs" type="time" value={editing.bedtime?.end || "07:00"} onChange={(e) => setEditing({ ...editing, bedtime: { ...editing.bedtime, end: e.target.value, enabled: true } })} aria-label="Bedtime end" />
              </span>
            </label>
            <label className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={!!editing.schedule?.enabled}
                onChange={(e) => setEditing({ ...editing, schedule: { ...(editing.schedule || { days: DAYS, windows: [{ start: "16:00", end: "19:00" }] }), enabled: e.target.checked } })}
                data-testid="routine-schedule-enabled" /> Allowed hours
              <span className="flex gap-1 mt-1">
                <input className="or-input text-xs" type="time" value={editing.schedule?.windows?.[0]?.start || "16:00"}
                  onChange={(e) => setEditing({ ...editing, schedule: { ...editing.schedule, enabled: true, windows: [{ ...(editing.schedule?.windows?.[0] || {}), start: e.target.value, end: editing.schedule?.windows?.[0]?.end || "19:00" }] } })} aria-label="Window start" />
                <input className="or-input text-xs" type="time" value={editing.schedule?.windows?.[0]?.end || "19:00"}
                  onChange={(e) => setEditing({ ...editing, schedule: { ...editing.schedule, enabled: true, windows: [{ start: editing.schedule?.windows?.[0]?.start || "16:00", end: e.target.value }] } })} aria-label="Window end" />
              </span>
            </label>
          </div>
          {editing.schedule?.enabled && (
            <div className="flex flex-wrap gap-1">
              {DAYS.map((day) => (
                <button key={day} className="or-chip text-[10px] uppercase"
                  style={{ color: (editing.schedule.days || []).includes(day) ? "var(--brand-green, #10E670)" : "var(--text-muted)" }}
                  onClick={() => setEditing({ ...editing, schedule: { ...editing.schedule, days: (editing.schedule.days || []).includes(day) ? editing.schedule.days.filter((x) => x !== day) : [...(editing.schedule.days || []), day] } })}
                  data-testid={`routine-day-${day}`}>{day}</button>
              ))}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button className="or-btn or-btn-ghost text-xs" onClick={() => setEditing(null)} data-testid="routine-cancel">Cancel</button>
            <button className="or-btn text-xs font-bold" style={{ background: "var(--brand-green, #10E670)", color: "#0a0a0a" }}
              disabled={!editing.name.trim()} onClick={save} data-testid="routine-save">Save routine</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ParentDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [teens, setTeens] = useState(null);
  const [routines, setRoutines] = useState([]);
  const [audit, setAudit] = useState([]);
  const [selected, setSelected] = useState([]);

  const load = useCallback(() => {
    apiClient.get("/guardian/teens").then((r) => setTeens(r.data.teens || [])).catch((e) => {
      setTeens([]);
      if (e?.response?.status === 403) toast.error("Parent Controls are for adult accounts.");
    });
    apiClient.get("/guardian/routines").then((r) => setRoutines(r.data.routines || [])).catch(() => {});
    apiClient.get("/guardian/audit?limit=25").then((r) => setAudit(r.data.rows || [])).catch(() => {});
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return null;
  if (teens === null) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" size={22} /></div>;

  const toggleSelect = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const bulk = async (action) => {
    const reason = action === "lock" ? (window.prompt("Reason for locking (shared in audit log):") ?? null) : "";
    if (reason === null) return;
    try {
      await apiClient.post("/guardian/bulk", { teen_ids: selected, action, reason });
      toast.success(`${nice(action)} applied to ${selected.length} teen(s)`);
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-5 py-4 space-y-3" data-testid="parent-dashboard-page">
      <div className="flex items-center gap-2.5">
        <ShieldCheck size={22} style={{ color: "var(--brand-green, #10E670)" }} />
        <div className="flex-1">
          <h1 className="text-lg font-extrabold" style={{ fontFamily: "var(--font-display)" }}>Parent Controls</h1>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Every setting is enforced server-side. Teens always see their limits transparently.
          </p>
        </div>
      </div>

      <LinkSection reload={load} />

      {selected.length > 0 && (
        <div className="or-surface p-3 flex flex-wrap items-center gap-2 sticky top-0 z-20" data-testid="bulk-bar">
          <b className="text-xs">{selected.length} selected</b>
          <button className="or-btn or-btn-ghost text-xs" onClick={() => bulk("lock")} data-testid="bulk-lock"><Lock size={12} /> Lock</button>
          <button className="or-btn or-btn-ghost text-xs" onClick={() => bulk("unlock")} data-testid="bulk-unlock"><Unlock size={12} /> Unlock</button>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Assign a routine from the Routines list below</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3" data-testid="parent-teen-grid">
        {teens.length === 0 && (
          <div className="or-surface p-6 text-center sm:col-span-2 text-xs" style={{ color: "var(--text-muted)" }} data-testid="parent-no-teens">
            No linked teens yet. Send a link request or create a teen account above.
          </div>
        )}
        {teens.map((t) => (
          <TeenCard key={t.teen_id} t={t} selected={selected.includes(t.teen_id)}
            onSelect={toggleSelect} onOpen={(id) => navigate(`/parent/teens/${id}`)} />
        ))}
      </div>

      <RoutinesSection routines={routines} reload={load} selectedIds={selected} />

      <div className="or-surface p-4" data-testid="parent-audit-section">
        <div className="font-bold text-sm mb-2 flex items-center gap-2"><ScrollText size={15} style={{ color: "var(--brand-blue)" }} /> Recent changes</div>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {audit.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No changes yet.</div>}
          {audit.map((a) => (
            <div key={a.id} className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              <b style={{ color: "var(--text-main)" }}>{nice(a.action)}</b>
              {a.reason ? ` — "${a.reason}"` : ""} · {a.at?.slice(0, 16).replace("T", " ")} UTC
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
