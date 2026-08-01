import React, { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus, Pause, Play, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TZS = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"];
const fmt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

const EMPTY = {
  report_key: "", frequency: "weekly", day_of_week: 0, day_of_month: 1,
  send_hour: 8, timezone: "UTC", format: "csv", recipient_ids: [], enabled: false,
};

// Bundle G — scheduled reports. Explicit opt-in only; in-app delivery only.
export const RcScheduledReportsPanel = ({ centerId, catalog, members }) => {
  const [schedules, setSchedules] = useState(null);
  const [form, setForm] = useState(null); // {id?} null = closed
  const [busy, setBusy] = useState(false);
  const reports = (catalog?.categories || []).flatMap((c) => c.reports || []);
  const activeMembers = (members || []).filter((m) => m.status === "active");

  const load = useCallback(() => {
    apiClient.get(`/responsibility-center/${centerId}/scheduled-reports`)
      .then((r) => setSchedules(r.data.schedules || [])).catch(() => setSchedules([]));
  }, [centerId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.report_key) { toast.error("Pick a report first"); return; }
    setBusy(true);
    try {
      const body = { ...form };
      if (form.id) {
        await apiClient.patch(`/responsibility-center/${centerId}/scheduled-reports/${form.id}`, body);
        toast.success("Schedule updated");
      } else {
        await apiClient.post(`/responsibility-center/${centerId}/scheduled-reports`, body);
        toast.success(form.enabled ? "Schedule created and turned on" : "Schedule created — it stays OFF until you turn it on");
      }
      setForm(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save the schedule");
    } finally { setBusy(false); }
  };

  const toggle = async (s) => {
    try {
      await apiClient.patch(`/responsibility-center/${centerId}/scheduled-reports/${s.id}`, { enabled: !s.enabled });
      toast.success(s.enabled ? "Schedule paused" : "Schedule resumed");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Update failed"); }
  };

  const del = async (s) => {
    if (!window.confirm(`Delete the "${s.report_name}" schedule? Its history stays in the activity log.`)) return;
    try {
      await apiClient.patch(`/responsibility-center/${centerId}/scheduled-reports/${s.id}`, { delete: true });
      toast.success("Schedule deleted");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const toggleRecipient = (uid) =>
    setForm((f) => ({ ...f, recipient_ids: f.recipient_ids.includes(uid) ? f.recipient_ids.filter((x) => x !== uid) : [...f.recipient_ids, uid] }));

  if (schedules === null) return null;

  return (
    <div className="or-surface p-4" data-testid="rc-scheduled-reports">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide flex items-center gap-1.5">
          <CalendarClock size={13} /> Scheduled reports
        </h3>
        <button className="or-btn or-btn-ghost text-xs" onClick={() => setForm({ ...EMPTY })} data-testid="rc-sched-new-btn">
          <Plus size={12} /> New schedule
        </button>
      </div>
      <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }} data-testid="rc-sched-optin-note">
        Schedules are always OFF until you explicitly turn them on. Reports are delivered in-app only — never by email.
      </div>

      {form && (
        <div className="p-3 rounded mb-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-col, rgba(255,255,255,0.12))" }}
          data-testid="rc-sched-form">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide">{form.id ? "Edit schedule" : "New schedule"}</div>
            <button className="p-1" onClick={() => setForm(null)} aria-label="Close form" data-testid="rc-sched-form-close"><X size={13} /></button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-xs">
            <label className="block">
              <span style={{ color: "var(--text-muted)" }}>Report</span>
              <select className="or-input w-full mt-0.5" value={form.report_key} disabled={!!form.id}
                onChange={(e) => setForm((f) => ({ ...f, report_key: e.target.value }))} data-testid="rc-sched-report-select">
                <option value="">Choose a report…</option>
                {reports.map((r) => <option key={r.report_key} value={r.report_key}>{r.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span style={{ color: "var(--text-muted)" }}>Frequency</span>
              <select className="or-input w-full mt-0.5" value={form.frequency}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))} data-testid="rc-sched-frequency">
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            {form.frequency === "weekly" ? (
              <label className="block">
                <span style={{ color: "var(--text-muted)" }}>Day of week</span>
                <select className="or-input w-full mt-0.5" value={form.day_of_week ?? 0}
                  onChange={(e) => setForm((f) => ({ ...f, day_of_week: Number(e.target.value) }))} data-testid="rc-sched-day-of-week">
                  {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
            ) : (
              <label className="block">
                <span style={{ color: "var(--text-muted)" }}>Day of month (1–28)</span>
                <input type="number" min="1" max="28" className="or-input w-full mt-0.5" value={form.day_of_month ?? 1}
                  onChange={(e) => setForm((f) => ({ ...f, day_of_month: Number(e.target.value) }))} data-testid="rc-sched-day-of-month" />
              </label>
            )}
            <label className="block">
              <span style={{ color: "var(--text-muted)" }}>Time (hour, 24h)</span>
              <select className="or-input w-full mt-0.5" value={form.send_hour ?? 8}
                onChange={(e) => setForm((f) => ({ ...f, send_hour: Number(e.target.value) }))} data-testid="rc-sched-hour">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </label>
            <label className="block">
              <span style={{ color: "var(--text-muted)" }}>Timezone</span>
              <input className="or-input w-full mt-0.5" list="rc-sched-tz" value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} data-testid="rc-sched-timezone" />
              <datalist id="rc-sched-tz">{TZS.map((z) => <option key={z} value={z} />)}</datalist>
            </label>
            <label className="block">
              <span style={{ color: "var(--text-muted)" }}>Format</span>
              <select className="or-input w-full mt-0.5" value={form.format}
                onChange={(e) => setForm((f) => ({ ...f, format: e.target.value }))} data-testid="rc-sched-format">
                <option value="csv">CSV</option>
                <option value="xlsx">Excel</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
          </div>
          <div className="mt-2 text-xs">
            <span style={{ color: "var(--text-muted)" }}>Notify recipients (in-app only — you're always included):</span>
            <div className="flex flex-wrap gap-1.5 mt-1" data-testid="rc-sched-recipients">
              {activeMembers.map((m) => (
                <button key={m.user_id} className="or-chip text-[11px]" data-active={form.recipient_ids.includes(m.user_id)}
                  onClick={() => toggleRecipient(m.user_id)} data-testid={`rc-sched-recipient-${m.username}`}>
                  @{m.username}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs mt-3" data-testid="rc-sched-enable-row">
            <input type="checkbox" checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} data-testid="rc-sched-enabled-checkbox" />
            <span>Turn this schedule <b>on</b> now (otherwise it stays OFF until you enable it)</span>
          </label>
          <div className="flex justify-end gap-2 mt-3">
            <button className="or-btn or-btn-ghost text-xs" onClick={() => setForm(null)} data-testid="rc-sched-cancel">Cancel</button>
            <button className="or-btn text-xs" disabled={busy || !form.report_key} onClick={save} data-testid="rc-sched-save">
              {busy ? "Saving…" : form.id ? "Save changes" : "Create schedule"}
            </button>
          </div>
        </div>
      )}

      {!schedules.length && !form && (
        <div className="text-sm py-2" style={{ color: "var(--text-muted)" }} data-testid="rc-sched-empty">
          No scheduled reports. Create one and turn it on when you're ready.
        </div>
      )}
      {schedules.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid={`rc-sched-row-${s.id}`}>
          <div className="min-w-0 flex-1">
            <div className="text-sm truncate">
              {s.report_name}
              <span className="text-[10px] uppercase ml-2" style={{ color: "var(--text-muted)" }}>{s.format} · {s.frequency}</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {s.frequency === "weekly" ? DOW[s.day_of_week ?? 0] : `Day ${s.day_of_month ?? 1}`}
              {" · "}{String(s.send_hour ?? 8).padStart(2, "0")}:00 {s.timezone || "UTC"}
              {" · "}{(s.recipient_ids || []).length} recipient{(s.recipient_ids || []).length === 1 ? "" : "s"} · in-app
              {s.enabled && s.next_run_at ? ` · next ${fmt(s.next_run_at)}` : ""}
              {s.last_run_at ? ` · last ${fmt(s.last_run_at)}` : ""}
            </div>
            {!!s.failure_count && (
              <div className="text-[11px]" style={{ color: "#FF8A5A" }} data-testid={`rc-sched-failure-${s.id}`}>
                {s.failure_count} failed run{s.failure_count === 1 ? "" : "s"}{s.last_failure ? ` — ${s.last_failure.slice(0, 80)}` : ""}
                {!s.enabled ? " · paused automatically — fix and resume" : ""}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] uppercase font-semibold" style={{ color: s.enabled ? "#7BD88F" : "#9AA7BD" }}
              data-testid={`rc-sched-status-${s.id}`}>{s.enabled ? "On" : "Off"}</span>
            <button className="or-btn or-btn-ghost p-1.5" title={s.enabled ? "Pause" : "Resume"} onClick={() => toggle(s)}
              data-testid={`rc-sched-toggle-${s.id}`}>{s.enabled ? <Pause size={12} /> : <Play size={12} />}</button>
            <button className="or-btn or-btn-ghost p-1.5" title="Edit"
              onClick={() => setForm({ id: s.id, report_key: s.report_key, frequency: s.frequency,
                day_of_week: s.day_of_week ?? 0, day_of_month: s.day_of_month ?? 1,
                send_hour: s.send_hour ?? 8, timezone: s.timezone || "UTC", format: s.format,
                recipient_ids: s.recipient_ids || [], enabled: !!s.enabled })}
              data-testid={`rc-sched-edit-${s.id}`}><Pencil size={12} /></button>
            <button className="or-btn or-btn-ghost p-1.5" title="Delete" onClick={() => del(s)}
              data-testid={`rc-sched-delete-${s.id}`}><Trash2 size={12} /></button>
          </div>
        </div>
      ))}
    </div>
  );
};
