import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, X, MapPin, Video, Repeat, AlertTriangle, Flag } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { RcRecurrenceEditor, DEFAULT_RECURRENCE, recurrenceLabel } from "./RcRecurrenceEditor";
import ReportModal from "@/components/ReportModal";

const uuid = () =>
  (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const EVENT_TYPES = [
  ["event", "Event", "#5AB2FF"], ["meeting", "Meeting", "#C26BFF"], ["class", "Class", "#7BD88F"],
  ["practice", "Practice", "#F4C84A"], ["shift", "Shift", "#FF8A5A"], ["appointment", "Appointment", "#5AB2FF"],
  ["deadline", "Deadline", "#FF6B6B"], ["birthday", "Birthday", "#FF7AC2"],
  ["important_date", "Important Date", "#F4C84A"], ["announcement", "Announcement", "#9AA7BD"], ["custom", "Custom", "#9AA7BD"],
];
const TYPE_META = Object.fromEntries(EVENT_TYPES.map(([v, l, c]) => [v, { label: l, color: c }]));
const ATTENDANCE_OPTS = ["present", "absent", "late", "excused", "remote", "not_required", "unknown"];

const dayKey = (d) => d.toISOString().slice(0, 10);
const localDayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; };

// Calendar tab — Month / Week / Agenda views + events + task due dates.
export const RcCalendarTab = ({ centerId, data, initialEventId, onOpenItem, onEventOpenChange }) => {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const [view, setView] = useState(isMobile ? "agenda" : "month");
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [feed, setFeed] = useState(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [units, setUnits] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [openEvent, setOpenEvent] = useState(initialEventId || null);

  const range = useMemo(() => {
    if (view === "month") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const from = startOfWeek(first);
      const to = new Date(from); to.setDate(to.getDate() + 42);
      return { from, to };
    }
    if (view === "week") {
      const from = startOfWeek(cursor);
      const to = new Date(from); to.setDate(to.getDate() + 7);
      return { from, to };
    }
    const from = new Date(cursor);
    const to = new Date(cursor); to.setDate(to.getDate() + 14);
    return { from, to };
  }, [view, cursor]);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/calendar`, {
        params: {
          date_from: range.from.toISOString(), date_to: range.to.toISOString(),
          event_type: typeFilter, unit_id: unitFilter, scope: mineOnly ? "mine" : "",
        },
      });
      setFeed(r.data);
    } catch (e) {
      toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Could not load the calendar");
    }
  }, [centerId, range, typeFilter, unitFilter, mineOnly]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiClient.get(`/responsibility-center/${centerId}/units`).then((r) => setUnits(r.data.units || [])).catch(() => {});
  }, [centerId]);
  useEffect(() => { if (initialEventId) setOpenEvent(initialEventId); }, [initialEventId]);

  const entries = useMemo(() => feed?.entries || [], [feed]);
  const byDay = useMemo(() => {
    const m = {};
    entries.forEach((e) => { (m[localDayKey(e.start_at)] = m[localDayKey(e.start_at)] || []).push(e); });
    return m;
  }, [entries]);

  const nav = (dir) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + 14 * dir);
    setCursor(d);
  };

  const openEntry = (e) => {
    if (e.kind === "item") onOpenItem?.(e.id);
    else { setOpenEvent(e.id); onEventOpenChange?.(e.id); }
  };

  const Pill = ({ e, compact }) => {
    const meta = TYPE_META[e.event_type] || TYPE_META.event;
    const done = e.completed || e.status === "completed";
    return (
      <button className="block w-full text-left rounded px-1.5 py-0.5 mb-0.5 truncate"
        style={{ background: `${meta.color}1d`, color: meta.color, fontSize: compact ? 10 : 12,
          textDecoration: done ? "line-through" : "none", opacity: done ? 0.6 : 1 }}
        onClick={() => openEntry(e)} title={e.title} data-testid={`rc-cal-entry-${e.id}`}>
        {!e.all_day && <b>{fmtTime(e.start_at)}</b>} {e.title}
      </button>
    );
  };

  const headerLabel = view === "month"
    ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : `${range.from.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(range.to - 1).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  const dayKeys = [];
  for (let d = new Date(range.from); d < range.to; d.setDate(d.getDate() + 1)) dayKeys.push(dayKey(new Date(d)));
  const todayKey = localDayKey(new Date().toISOString());

  return (
    <div className="space-y-4" data-testid="rc-tab-calendar">
      <div className="or-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1">
            <button className="or-btn or-btn-ghost p-1.5" onClick={() => nav(-1)} aria-label="Previous" data-testid="rc-cal-prev"><ChevronLeft size={15} /></button>
            <button className="or-btn or-btn-ghost text-xs" onClick={() => setCursor(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })} data-testid="rc-cal-today">Today</button>
            <button className="or-btn or-btn-ghost p-1.5" onClick={() => nav(1)} aria-label="Next" data-testid="rc-cal-next"><ChevronRight size={15} /></button>
            <span className="text-sm font-semibold ml-2" data-testid="rc-cal-header">{headerLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {["month", "week", "agenda"].map((v) => (
              <button key={v} className="or-chip" data-active={view === v} onClick={() => setView(v)} data-testid={`rc-cal-view-${v}`}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
            {feed?.can_create && (
              <button className="or-btn or-btn-primary" onClick={() => setShowCreate(true)} data-testid="rc-cal-create-btn">
                <Plus size={14} /> Event
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <select className="or-input text-xs" style={{ width: "auto" }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} data-testid="rc-cal-type-filter">
            <option value="">All types</option>
            {EVENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="or-input text-xs" style={{ width: "auto" }} value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} data-testid="rc-cal-unit-filter">
            <option value="">All groups</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="or-chip" data-active={mineOnly} onClick={() => setMineOnly((v) => !v)} data-testid="rc-cal-mine-filter">Mine only</button>
        </div>

        {!feed && <div className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>}

        {feed && view === "month" && (
          <div data-testid="rc-cal-month-grid">
            <div className="grid grid-cols-7 text-center text-[10px] uppercase mb-1" style={{ color: "var(--text-muted)" }}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
              {dayKeys.map((k) => {
                const inMonth = new Date(`${k}T12:00:00`).getMonth() === cursor.getMonth();
                const dayEntries = byDay[k] || [];
                return (
                  <div key={k} className="min-h-[76px] p-1" data-testid={`rc-cal-day-${k}`}
                    style={{ background: "var(--surface-1, rgba(10,14,22,0.9))", opacity: inMonth ? 1 : 0.45,
                      outline: k === todayKey ? "1px solid #7BD88F" : "none" }}>
                    <div className="text-[10px] mb-0.5" style={{ color: k === todayKey ? "#7BD88F" : "var(--text-muted)" }}>
                      {parseInt(k.slice(8), 10)}
                    </div>
                    {dayEntries.slice(0, 3).map((e) => <Pill key={`${e.kind}-${e.id}`} e={e} compact />)}
                    {dayEntries.length > 3 && (
                      <button className="text-[10px]" style={{ color: "var(--text-muted)" }}
                        onClick={() => { setView("agenda"); setCursor(new Date(`${k}T00:00:00`)); }}>+{dayEntries.length - 3} more</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {feed && view === "week" && (
          <div className="grid grid-cols-1 sm:grid-cols-7 gap-2" data-testid="rc-cal-week-grid">
            {dayKeys.map((k) => (
              <div key={k} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.03)", outline: k === todayKey ? "1px solid #7BD88F" : "none" }} data-testid={`rc-cal-week-day-${k}`}>
                <div className="text-[10px] uppercase mb-1" style={{ color: k === todayKey ? "#7BD88F" : "var(--text-muted)" }}>{fmtDay(k)}</div>
                {(byDay[k] || []).map((e) => <Pill key={`${e.kind}-${e.id}`} e={e} />)}
                {!(byDay[k] || []).length && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>—</div>}
              </div>
            ))}
          </div>
        )}

        {feed && view === "agenda" && (
          <div data-testid="rc-cal-agenda">
            {dayKeys.filter((k) => (byDay[k] || []).length).map((k) => (
              <div key={k} className="mb-3">
                <div className="text-xs font-semibold uppercase tracking-wide mb-1"
                  style={{ color: k === todayKey ? "#7BD88F" : "var(--text-muted)" }}>{fmtDay(k)}{k === todayKey ? " · Today" : ""}</div>
                {(byDay[k] || []).map((e) => {
                  const meta = TYPE_META[e.event_type] || TYPE_META.event;
                  return (
                    <button key={`${e.kind}-${e.id}`} className="w-full flex items-center gap-3 py-2 text-left"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                      onClick={() => openEntry(e)} data-testid={`rc-cal-agenda-entry-${e.id}`}>
                      <span className="w-1.5 h-8 rounded-full shrink-0" style={{ background: meta.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate" style={{ textDecoration: e.completed ? "line-through" : "none" }}>{e.title}</div>
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {meta.label} · {e.all_day ? "All day" : `${fmtTime(e.start_at)}${e.end_at !== e.start_at ? ` – ${fmtTime(e.end_at)}` : ""}`}
                          {e.location ? ` · ${e.location}` : ""}{e.my_response ? ` · RSVP: ${e.my_response}` : ""}
                        </div>
                      </div>
                      {e.series_id && <Repeat size={12} style={{ color: "var(--text-muted)" }} />}
                    </button>
                  );
                })}
              </div>
            ))}
            {!entries.length && <div className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }} data-testid="rc-cal-empty">Nothing scheduled in this range.</div>}
          </div>
        )}
      </div>

      {showCreate && (
        <EventCreateModal centerId={centerId} members={data?.members || []} units={units}
          timezone={feed?.timezone} onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }} />
      )}
      {openEvent && (
        <EventDrawer centerId={centerId} eventId={openEvent} members={data?.members || []}
          onClose={() => { setOpenEvent(null); onEventOpenChange?.(null); load(); }} />
      )}
    </div>
  );
};

function EventCreateModal({ centerId, members, units, timezone, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: "", event_type: "event", description: "", start_at: "", end_at: "",
    all_day: false, location: "", virtual_link: "", unit_id: "", visibility: "center",
    attendee_ids: [], attendance_enabled: false, recurrence: DEFAULT_RECURRENCE,
  });
  const [conflicts, setConflicts] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [token] = useState(uuid());
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (override = false) => {
    if (!form.title.trim() || !form.start_at) { toast.error("A title and start time are required"); return; }
    setBusy(true);
    try {
      await apiClient.post(`/responsibility-center/${centerId}/events`, {
        ...form,
        start_at: new Date(form.start_at).toISOString(),
        end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
        unit_id: form.unit_id || null, virtual_link: form.virtual_link || null,
        recurrence: form.recurrence?.pattern === "one_time" ? null : form.recurrence,
        override_conflicts: override, override_reason: overrideReason,
        client_token: token,
      });
      toast.success("Event scheduled");
      onCreated();
    } catch (e) {
      const det = e?.response?.data?.detail;
      if (e?.response?.status === 409 && det?.conflicts) { setConflicts(det.conflicts); }
      else toast.error(typeof det === "string" ? det : "Could not create the event");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose} data-testid="rc-event-create-modal">
      <div className="or-surface w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-3">Schedule an event</h3>
        <label className="text-xs block mb-2">Title
          <input className="or-input w-full mt-1" value={form.title} maxLength={140}
            onChange={(e) => set("title", e.target.value)} data-testid="rc-event-title-input" />
        </label>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-xs">Type
            <select className="or-input w-full mt-1" value={form.event_type} onChange={(e) => set("event_type", e.target.value)} data-testid="rc-event-type-select">
              {EVENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs">Visibility
            <select className="or-input w-full mt-1" value={form.visibility} onChange={(e) => set("visibility", e.target.value)} data-testid="rc-event-visibility-select">
              <option value="center">Whole Center</option>
              <option value="unit">Unit members only</option>
              <option value="attendees">Attendees only</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-xs">Starts
            <input type="datetime-local" className="or-input w-full mt-1" value={form.start_at}
              onChange={(e) => set("start_at", e.target.value)} data-testid="rc-event-start-input" />
          </label>
          <label className="text-xs">Ends
            <input type="datetime-local" className="or-input w-full mt-1" value={form.end_at}
              onChange={(e) => set("end_at", e.target.value)} data-testid="rc-event-end-input" />
          </label>
        </div>
        <div className="flex items-center gap-3 mb-2 text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.all_day} onChange={(e) => set("all_day", e.target.checked)} data-testid="rc-event-allday-check" /> All day</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.attendance_enabled} onChange={(e) => set("attendance_enabled", e.target.checked)} data-testid="rc-event-attendance-check" /> Track attendance</label>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-xs">Location
            <input className="or-input w-full mt-1" value={form.location} maxLength={200}
              onChange={(e) => set("location", e.target.value)} data-testid="rc-event-location-input" />
          </label>
          <label className="text-xs">Meeting link
            <input className="or-input w-full mt-1" placeholder="https://…" value={form.virtual_link}
              onChange={(e) => set("virtual_link", e.target.value)} data-testid="rc-event-link-input" />
          </label>
        </div>
        <label className="text-xs block mb-2">Group / unit
          <select className="or-input w-full mt-1" value={form.unit_id} onChange={(e) => set("unit_id", e.target.value)} data-testid="rc-event-unit-select">
            <option value="">None</option>
            {units.filter((u) => u.status === "active").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <div className="mb-2">
          <div className="text-xs mb-1">Attendees</div>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button key={m.user_id} className="or-chip" data-active={form.attendee_ids.includes(m.user_id)}
                onClick={() => set("attendee_ids", form.attendee_ids.includes(m.user_id)
                  ? form.attendee_ids.filter((x) => x !== m.user_id) : [...form.attendee_ids, m.user_id])}
                data-testid={`rc-event-attendee-chip-${m.username}`}>@{m.username}</button>
            ))}
          </div>
        </div>
        <label className="text-xs block mb-2">Notes
          <textarea className="or-input w-full mt-1" rows={2} value={form.description} maxLength={2000}
            onChange={(e) => set("description", e.target.value)} data-testid="rc-event-desc-input" />
        </label>
        <div className="mb-3">
          <div className="text-xs mb-1 flex items-center gap-1"><Repeat size={11} /> Repeats</div>
          <RcRecurrenceEditor value={form.recurrence} onChange={(r) => set("recurrence", r)} timezone={timezone} />
        </div>

        {conflicts && (
          <div className="rounded p-3 mb-3" style={{ background: "rgba(244,200,74,0.1)", border: "1px solid rgba(244,200,74,0.4)" }} data-testid="rc-event-conflict-warning">
            <div className="flex items-center gap-1.5 text-sm font-semibold mb-1" style={{ color: "#F4C84A" }}>
              <AlertTriangle size={14} /> Schedule conflict detected
            </div>
            {conflicts.map((c) => (
              <div key={c.event_id} className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                "{c.title}" · {fmtTime(c.start_at)} – {fmtTime(c.end_at)}
                {c.overlapping_members?.length ? ` · ${c.overlapping_members.length} member(s) affected` : ""}
                {c.unit_conflict ? " · same group" : ""}
              </div>
            ))}
            <input className="or-input w-full mt-1 mb-2 text-xs" placeholder="Override reason (optional unless required)"
              value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} data-testid="rc-event-override-reason" />
            <button className="or-btn text-xs" style={{ borderColor: "#F4C84A", color: "#F4C84A" }}
              disabled={busy} onClick={() => submit(true)} data-testid="rc-event-override-btn">Schedule anyway</button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="or-btn or-btn-ghost" onClick={onClose} data-testid="rc-event-modal-cancel">Cancel</button>
          <button className="or-btn or-btn-primary" disabled={busy} onClick={() => submit(false)} data-testid="rc-event-modal-save">
            {busy ? "Saving…" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventDrawer({ centerId, eventId, onClose }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [marks, setMarks] = useState({});
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({});
  const [reportOpen, setReportOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/events/${eventId}`);
      setData(r.data);
    } catch (e) {
      toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Could not load the event");
      onClose();
    }
  }, [centerId, eventId, onClose]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.5)" }} data-testid="rc-event-drawer-loading" />;
  const { event: ev, me } = data;
  const meta = TYPE_META[ev.event_type] || TYPE_META.event;
  const isSeriesOcc = !!ev.series_id;

  const doRsvp = async (response) => {
    setBusy(true);
    try {
      await apiClient.post(`/responsibility-center/${centerId}/events/${eventId}/rsvp`, { response });
      toast.success("RSVP saved");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "RSVP failed"); }
    finally { setBusy(false); }
  };

  const doCancel = async () => {
    let scope = "occurrence";
    if (isSeriesOcc) {
      const choice = window.prompt('Cancel scope — type "one" (this event only), "future" (this and future), or "all" (entire series):', "one");
      if (choice === null) return;
      scope = { one: "occurrence", future: "future", all: "series" }[choice.trim().toLowerCase()] || "occurrence";
    } else if (!window.confirm(`Cancel "${ev.title}"?`)) return;
    setBusy(true);
    try {
      await apiClient.post(`/responsibility-center/${centerId}/events/${eventId}/cancel`, { scope });
      toast.success("Event canceled");
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Cancel failed"); }
    finally { setBusy(false); }
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const body = { ...edit, expected_version: ev.version };
      if (edit.start_at) body.start_at = new Date(edit.start_at).toISOString();
      if (edit.end_at) body.end_at = new Date(edit.end_at).toISOString();
      await apiClient.patch(`/responsibility-center/${centerId}/events/${eventId}`, body);
      toast.success("Event updated");
      setEditing(false); setEdit({});
      load();
    } catch (e) {
      const det = e?.response?.data?.detail;
      if (e?.response?.status === 409 && det?.conflicts) {
        if (window.confirm("Schedule conflict detected. Save anyway?")) {
          await apiClient.patch(`/responsibility-center/${centerId}/events/${eventId}`,
            { ...edit, expected_version: ev.version, override_conflicts: true,
              start_at: edit.start_at ? new Date(edit.start_at).toISOString() : undefined,
              end_at: edit.end_at ? new Date(edit.end_at).toISOString() : undefined })
            .then(() => { toast.success("Event updated"); setEditing(false); setEdit({}); load(); })
            .catch((err) => toast.error(err?.response?.data?.detail || "Save failed"));
        }
      } else toast.error(typeof det === "string" ? det : "Save failed");
    } finally { setBusy(false); }
  };

  const saveAttendance = async () => {
    const list = Object.entries(marks).map(([user_id, v]) => ({ user_id, attendance: v.attendance, note: v.note || "" }));
    if (!list.length) return;
    setBusy(true);
    try {
      await apiClient.post(`/responsibility-center/${centerId}/events/${eventId}/attendance`, { marks: list });
      toast.success("Attendance saved");
      setMarks({});
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save attendance"); }
    finally { setBusy(false); }
  };

  const allPresent = () => {
    const next = {};
    (ev.attendees || []).forEach((a) => { next[a.user_id] = { attendance: "present" }; });
    setMarks(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose} data-testid="rc-event-drawer">
      <div className="or-surface w-full sm:max-w-md h-full overflow-y-auto p-5" style={{ borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                style={{ background: `${meta.color}22`, color: meta.color }} data-testid="rc-event-drawer-type">{meta.label}</span>
              {ev.status === "canceled" && <span className="text-[10px] uppercase font-semibold" style={{ color: "#FF6B6B" }}>Canceled</span>}
              {isSeriesOcc && <span className="text-[10px] uppercase flex items-center gap-1" style={{ color: "var(--text-muted)" }}><Repeat size={10} /> Recurring</span>}
            </div>
            <h3 className="text-lg leading-snug" style={{ fontFamily: "var(--font-display)" }} data-testid="rc-event-drawer-title">{ev.title}</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="or-btn or-btn-ghost p-1.5" onClick={() => setReportOpen(true)}
              title="Report this event" aria-label="Report this event" data-testid="rc-event-drawer-report">
              <Flag size={14} />
            </button>
            <button className="or-btn or-btn-ghost p-1.5" onClick={onClose} aria-label="Close" data-testid="rc-event-drawer-close"><X size={16} /></button>
          </div>
        </div>
        <ReportModal open={reportOpen} targetType="rc_event" targetId={ev.series_id || ev.id}
          onClose={() => setReportOpen(false)} testid="rc-event-report-modal" />

        <div className="text-sm mb-1" data-testid="rc-event-drawer-time">
          {new Date(ev.start_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {!ev.all_day && <> – {fmtTime(ev.end_at)}</>}{ev.all_day && " · All day"}
        </div>
        {ev.location && <div className="text-xs flex items-center gap-1 mb-1" style={{ color: "var(--text-muted)" }}><MapPin size={11} /> {ev.location}</div>}
        {ev.virtual_link && <a className="text-xs flex items-center gap-1 mb-1" style={{ color: "#5AB2FF" }} href={ev.virtual_link} target="_blank" rel="noreferrer"><Video size={11} /> Join link</a>}
        {ev.description && <p className="text-sm my-2" style={{ color: "var(--text-muted)" }}>{ev.description}</p>}
        {ev.recurrence && <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}><Repeat size={10} className="inline mr-1" />{recurrenceLabel(ev.recurrence)}</div>}

        {me.is_attendee && ev.status === "scheduled" && (
          <div className="mb-3" data-testid="rc-event-rsvp-panel">
            <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Your RSVP</div>
            <div className="flex gap-1.5">
              {["accepted", "maybe", "declined"].map((r) => (
                <button key={r} className="or-chip" disabled={busy} data-active={me.my_response === r}
                  onClick={() => doRsvp(r)} data-testid={`rc-event-rsvp-${r}`}>
                  {r === "accepted" ? "Going" : r === "maybe" ? "Maybe" : "Can't go"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3" data-testid="rc-event-attendee-list">
          <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Attendees ({(ev.attendees || []).length})</div>
          {(ev.attendees || []).map((a) => (
            <div key={a.user_id} className="flex items-center justify-between gap-2 py-1 text-sm"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }} data-testid={`rc-event-attendee-${a.username}`}>
              <span>@{a.username || a.user_id}</span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] uppercase" style={{ color: a.response === "accepted" ? "#7BD88F" : a.response === "declined" ? "#FF6B6B" : "var(--text-muted)" }}>{a.response}</span>
                {ev.attendance_enabled && me.can_mark_attendance ? (
                  <select className="or-input text-[11px] py-0.5" value={marks[a.user_id]?.attendance || a.attendance}
                    onChange={(e) => setMarks((m) => ({ ...m, [a.user_id]: { ...m[a.user_id], attendance: e.target.value } }))}
                    data-testid={`rc-event-attendance-select-${a.username}`}>
                    {ATTENDANCE_OPTS.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                  </select>
                ) : ev.attendance_enabled && a.attendance !== "unknown" ? (
                  <span className="text-[10px] uppercase" style={{ color: "#5AB2FF" }}>{a.attendance.replace("_", " ")}</span>
                ) : null}
              </span>
            </div>
          ))}
          {ev.attendance_enabled && me.can_mark_attendance && (
            <div className="flex gap-2 mt-2">
              <button className="or-btn or-btn-ghost text-xs" onClick={allPresent} data-testid="rc-event-attendance-all-present">All present</button>
              <button className="or-btn or-btn-primary text-xs" disabled={busy || !Object.keys(marks).length}
                onClick={saveAttendance} data-testid="rc-event-attendance-save">Save attendance</button>
            </div>
          )}
        </div>

        {editing && (
          <div className="mb-3 rounded p-3" style={{ background: "rgba(255,255,255,0.04)" }} data-testid="rc-event-edit-panel">
            <label className="text-xs block mb-2">Title
              <input className="or-input w-full mt-1" defaultValue={ev.title}
                onChange={(e) => setEdit((x) => ({ ...x, title: e.target.value }))} data-testid="rc-event-edit-title" />
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <label className="text-xs">Starts
                <input type="datetime-local" className="or-input w-full mt-1"
                  onChange={(e) => setEdit((x) => ({ ...x, start_at: e.target.value }))} data-testid="rc-event-edit-start" />
              </label>
              <label className="text-xs">Ends
                <input type="datetime-local" className="or-input w-full mt-1"
                  onChange={(e) => setEdit((x) => ({ ...x, end_at: e.target.value }))} data-testid="rc-event-edit-end" />
              </label>
            </div>
            <label className="text-xs block mb-2">Location
              <input className="or-input w-full mt-1" defaultValue={ev.location}
                onChange={(e) => setEdit((x) => ({ ...x, location: e.target.value }))} data-testid="rc-event-edit-location" />
            </label>
            {isSeriesOcc && (
              <label className="text-xs block mb-2">Apply to
                <select className="or-input w-full mt-1" defaultValue="occurrence"
                  onChange={(e) => setEdit((x) => ({ ...x, scope: e.target.value }))} data-testid="rc-event-edit-scope">
                  <option value="occurrence">This event only</option>
                  <option value="future">This and future events</option>
                  <option value="series">Entire series</option>
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button className="or-btn or-btn-ghost text-xs" onClick={() => { setEditing(false); setEdit({}); }} data-testid="rc-event-edit-cancel">Discard</button>
              <button className="or-btn or-btn-primary text-xs" disabled={busy} onClick={saveEdit} data-testid="rc-event-edit-save">Save</button>
            </div>
          </div>
        )}

        {ev.status === "scheduled" && (
          <div className="flex flex-wrap gap-2">
            {me.can_edit && !editing && (
              <button className="or-btn or-btn-ghost text-xs" onClick={() => setEditing(true)} data-testid="rc-event-edit-btn">Edit</button>
            )}
            {me.can_cancel && (
              <button className="or-btn text-xs" style={{ borderColor: "#FF6B6B", color: "#FF6B6B" }}
                disabled={busy} onClick={doCancel} data-testid="rc-event-cancel-btn">Cancel event</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
