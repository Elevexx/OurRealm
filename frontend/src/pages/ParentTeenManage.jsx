import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Lock, Unlock, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import apiClient, { formatApiErrorDetail } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const nice = (s) => (s || "").replace(/_/g, " ");
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const LIMIT_OPTIONS = [["No limit", null], ["30 min", 30], ["1 hour", 60], ["2 hours", 120], ["3 hours", 180], ["4 hours", 240]];

function Toggle({ label, on, onChange, testid }) {
  return (
    <button className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs w-full"
      style={{ background: "rgba(255,255,255,0.04)" }} onClick={() => onChange(!on)}
      role="switch" aria-checked={on} data-testid={testid}>
      <span className="truncate">{nice(label)}</span>
      <span className="w-8 h-4.5 rounded-full relative shrink-0 transition-colors"
        style={{ background: on ? "var(--brand-green, #10E670)" : "rgba(255,255,255,0.15)", height: 18, width: 32 }}>
        <span className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all"
          style={{ left: on ? 16 : 2 }} />
      </span>
    </button>
  );
}

export default function ParentTeenManage() {
  const { teenId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    apiClient.get(`/guardian/teens/${teenId}`).then((r) => setD(r.data))
      .catch((e) => toast.error(formatApiErrorDetail(e?.response?.data?.detail)));
  }, [teenId]);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return null;
  if (!d) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" size={22} /></div>;

  const { teen, permissions: perms, effective: eff, registry: reg, controlling_rule } = d;

  const patch = async (body, okMsg = "Saved") => {
    try {
      await apiClient.patch(`/guardian/teens/${teenId}/permissions`, body);
      toast.success(okMsg);
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };
  const toggleKey = (section, key, val) => patch({ [section]: { [key]: val } }, `${nice(key)} ${val ? "enabled" : "disabled"}`);
  const setLock = async (locked) => {
    const reason = locked ? (window.prompt("Reason for locking (optional):") ?? null) : "";
    if (reason === null) return;
    await apiClient.post(`/guardian/teens/${teenId}/lock`, { locked, reason });
    toast.success(locked ? "Account locked" : "Account unlocked");
    load();
  };
  const unlink = async () => {
    if (!window.confirm(`Unlink @${teen.username}? Their account stays but is no longer managed by you.`)) return;
    await apiClient.delete(`/guardian/teens/${teenId}`);
    toast.success("Unlinked");
    navigate("/parent");
  };

  const matches = (k) => !q || k.toLowerCase().includes(q.toLowerCase());
  const effOf = (section, k) => (eff[section] || {})[k];
  const baseOf = (section, k) => (perms[section] || {})[k];

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-5 py-4 space-y-3" data-testid="parent-teen-manage-page">
      <div className="flex flex-wrap items-center gap-2.5">
        <button className="or-btn or-btn-ghost p-1.5" onClick={() => navigate("/parent")} aria-label="Back" data-testid="teen-manage-back"><ArrowLeft size={16} /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-extrabold truncate" style={{ fontFamily: "var(--font-display)" }}>@{teen.username}</h1>
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Controlling rule: <b style={{ color: "#F4A73B" }}>{nice(controlling_rule)}</b>
            {d.routine?.name ? ` · Routine: ${d.routine.name}` : ""} · {d.time_used_minutes} min used today
          </div>
        </div>
        {perms.locked ? (
          <button className="or-btn text-xs font-bold" style={{ background: "var(--brand-green, #10E670)", color: "#0a0a0a" }}
            onClick={() => setLock(false)} data-testid="teen-unlock-btn"><Unlock size={13} /> Unlock</button>
        ) : (
          <button className="or-btn text-xs font-bold" style={{ background: "#FF3F5A", color: "#fff" }}
            onClick={() => setLock(true)} data-testid="teen-lock-btn"><Lock size={13} /> Lock now</button>
        )}
        <button className="or-btn or-btn-ghost p-1.5" onClick={unlink} aria-label="Unlink teen" title="Unlink" data-testid="teen-unlink-btn">
          <Trash2 size={14} style={{ color: "#FF6B6B" }} />
        </button>
      </div>

      <div className="or-surface p-4 flex flex-wrap items-center gap-2" data-testid="teen-preset-row">
        <span className="text-xs font-bold">Preset:</span>
        {(reg.presets || []).map((p) => (
          <button key={p} className="or-chip text-xs capitalize" data-active={perms.preset === p}
            onClick={() => window.confirm(`Apply the "${p}" preset? This resets all toggles to the preset values.`) && patch({ preset: p }, `${p} preset applied`)}
            data-testid={`preset-${p}`}>{p}</button>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <Search size={13} style={{ color: "var(--text-muted)" }} />
          <input className="or-input text-xs" placeholder="Search toggles…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="toggle-search" />
        </div>
      </div>

      {Object.entries(reg.feature_groups || {}).map(([group, keys]) => {
        const visible = keys.filter(matches);
        if (!visible.length) return null;
        return (
          <div key={group} className="or-surface p-4" data-testid={`feature-group-${group}`}>
            <div className="font-bold text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>{nice(group)}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {visible.map((k) => (
                <div key={k}>
                  <Toggle label={k} on={!!baseOf("features", k)} onChange={(v) => toggleKey("features", k, v)} testid={`feat-${k}`} />
                  {baseOf("features", k) !== effOf("features", k) && (
                    <div className="text-[9px] px-1" style={{ color: "#F4A73B" }}>restricted by routine</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="or-surface p-4" data-testid="centers-section">
        <div className="font-bold text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Center access</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {(reg.center_types || []).filter(matches).map((k) => (
            <Toggle key={k} label={k} on={!!baseOf("centers", k)} onChange={(v) => toggleKey("centers", k, v)} testid={`center-${k}`} />
          ))}
        </div>
      </div>

      <div className="or-surface p-4" data-testid="media-section">
        <div className="font-bold text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Media types</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-3">
          {(reg.media_types || []).filter(matches).map((k) => (
            <Toggle key={k} label={k} on={!!baseOf("media_types", k)} onChange={(v) => toggleKey("media_types", k, v)} testid={`media-${k}`} />
          ))}
        </div>
        <div className="font-bold text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Uploads & sources</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-3">
          {(reg.media_sources || []).filter(matches).map((k) => (
            <Toggle key={k} label={k} on={!!baseOf("media_sources", k)} onChange={(v) => toggleKey("media_sources", k, v)} testid={`source-${k}`} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">Content filter:</span>
          {(reg.content_filters || []).map((f) => (
            <button key={f} className="or-chip text-xs capitalize" data-active={perms.content_filter === f}
              onClick={() => patch({ content_filter: f }, `Filter: ${f}`)} data-testid={`filter-${f}`}>{nice(f)}</button>
          ))}
        </div>
      </div>

      <div className="or-surface p-4 space-y-3" data-testid="time-section">
        <div className="font-bold text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Screen time & schedule</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs">Daily limit:</span>
          {LIMIT_OPTIONS.map(([label, mins]) => (
            <button key={label} className="or-chip text-xs" data-active={(perms.screen_time?.daily_minutes ?? null) === mins}
              onClick={() => patch({ screen_time: { daily_minutes: mins } }, `Daily limit: ${label}`)}
              data-testid={`limit-${mins ?? "none"}`}>{label}</button>
          ))}
        </div>
        <div>
          <label className="text-xs flex items-center gap-2 mb-1.5">
            <input type="checkbox" checked={!!perms.schedule?.enabled}
              onChange={(e) => patch({ schedule: { ...perms.schedule, enabled: e.target.checked } }, "Schedule updated")}
              data-testid="schedule-enabled" /> Allowed days & hours
          </label>
          {perms.schedule?.enabled && (
            <>
              <div className="flex flex-wrap gap-1 mb-2">
                {DAYS.map((day) => (
                  <button key={day} className="or-chip text-[10px] uppercase"
                    style={{ color: (perms.schedule.days || []).includes(day) ? "var(--brand-green, #10E670)" : "var(--text-muted)" }}
                    onClick={() => patch({ schedule: { ...perms.schedule, days: (perms.schedule.days || []).includes(day) ? perms.schedule.days.filter((x) => x !== day) : [...(perms.schedule.days || []), day] } }, "Days updated")}
                    data-testid={`sched-day-${day}`}>{day}</button>
                ))}
              </div>
              {(perms.schedule.windows || []).map((w, i) => (
                <div key={i} className="flex items-center gap-2 mb-1.5">
                  <input className="or-input text-xs" type="time" value={w.start}
                    onChange={(e) => { const ws = [...perms.schedule.windows]; ws[i] = { ...w, start: e.target.value }; patch({ schedule: { ...perms.schedule, windows: ws } }, "Window updated"); }}
                    aria-label={`Window ${i + 1} start`} data-testid={`window-${i}-start`} />
                  <span className="text-xs">→</span>
                  <input className="or-input text-xs" type="time" value={w.end}
                    onChange={(e) => { const ws = [...perms.schedule.windows]; ws[i] = { ...w, end: e.target.value }; patch({ schedule: { ...perms.schedule, windows: ws } }, "Window updated"); }}
                    aria-label={`Window ${i + 1} end`} data-testid={`window-${i}-end`} />
                  {perms.schedule.windows.length > 1 && (
                    <button className="or-btn or-btn-ghost p-1" onClick={() => patch({ schedule: { ...perms.schedule, windows: perms.schedule.windows.filter((_, x) => x !== i) } }, "Window removed")}
                      aria-label="Remove window" data-testid={`window-${i}-remove`}><Trash2 size={12} /></button>
                  )}
                </div>
              ))}
              <button className="or-btn or-btn-ghost text-[10px]"
                onClick={() => patch({ schedule: { ...perms.schedule, windows: [...(perms.schedule.windows || []), { start: "16:00", end: "19:00" }] } }, "Window added")}
                data-testid="window-add">+ Add time window</button>
            </>
          )}
        </div>
        <div>
          <label className="text-xs flex items-center gap-2">
            <input type="checkbox" checked={!!perms.bedtime?.enabled}
              onChange={(e) => patch({ bedtime: { ...perms.bedtime, enabled: e.target.checked } }, "Bedtime updated")}
              data-testid="bedtime-enabled" /> Bedtime (auto-locks the account)
          </label>
          {perms.bedtime?.enabled && (
            <div className="flex items-center gap-2 mt-1.5">
              <input className="or-input text-xs" type="time" value={perms.bedtime.start}
                onChange={(e) => patch({ bedtime: { ...perms.bedtime, start: e.target.value } }, "Bedtime updated")} aria-label="Bedtime start" data-testid="bedtime-start" />
              <span className="text-xs">→</span>
              <input className="or-input text-xs" type="time" value={perms.bedtime.end}
                onChange={(e) => patch({ bedtime: { ...perms.bedtime, end: e.target.value } }, "Bedtime updated")} aria-label="Bedtime end" data-testid="bedtime-end" />
            </div>
          )}
        </div>
        <label className="text-xs flex items-center gap-2">
          Family timezone:
          <input className="or-input text-xs" defaultValue={perms.timezone || "UTC"}
            onBlur={(e) => e.target.value !== perms.timezone && patch({ timezone: e.target.value }, "Timezone saved")}
            data-testid="teen-timezone-input" />
          <button className="or-btn or-btn-ghost text-[10px]"
            onClick={() => patch({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, "Timezone set to yours")}
            data-testid="teen-timezone-mine">Use mine</button>
        </label>
      </div>

      <div className="or-surface p-4" data-testid="teen-audit-section">
        <div className="font-bold text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Change history</div>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {(d.audit || []).map((a) => (
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
