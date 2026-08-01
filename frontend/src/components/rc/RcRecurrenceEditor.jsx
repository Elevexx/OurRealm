import React from "react";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const DEFAULT_RECURRENCE = { pattern: "one_time" };

// Plain-language recurrence editor. Emits a recurrence object matching
// the backend contract (services/rc_recurrence.validate_recurrence).
export const RcRecurrenceEditor = ({ value, onChange, timezone }) => {
  const rec = value || DEFAULT_RECURRENCE;
  const set = (patch) => onChange({ ...rec, ...patch });
  const pattern = rec.pattern || "one_time";

  return (
    <div className="space-y-2" data-testid="rc-recurrence-editor">
      <select className="or-input w-full" value={pattern}
        onChange={(e) => onChange({ pattern: e.target.value, timezone: rec.timezone })}
        data-testid="rc-recurrence-pattern">
        <option value="one_time">One time (no repeat)</option>
        <option value="daily">Daily</option>
        <option value="weekdays">Weekdays only (Mon–Fri)</option>
        <option value="weekly">Weekly</option>
        <option value="biweekly">Every 2 weeks</option>
        <option value="monthly">Monthly</option>
        <option value="custom">Custom interval…</option>
      </select>

      {(pattern === "weekly" || pattern === "biweekly") && (
        <div>
          <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Repeat on:</div>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d, i) => {
              const on = (rec.weekdays || []).includes(i);
              return (
                <button key={d} type="button" className="or-chip" data-active={on}
                  onClick={() => set({ weekdays: on ? (rec.weekdays || []).filter((x) => x !== i) : [...(rec.weekdays || []), i] })}
                  data-testid={`rc-recur-weekday-${d.toLowerCase()}`}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {pattern === "monthly" && (
        <div className="space-y-2">
          <select className="or-input w-full" value={rec.monthly_mode || "day_of_month"}
            onChange={(e) => set({ monthly_mode: e.target.value })} data-testid="rc-recur-monthly-mode">
            <option value="day_of_month">Same day of the month</option>
            <option value="first_weekday">First weekday of the month</option>
            <option value="last_weekday">Last weekday of the month</option>
            <option value="nth_weekday">A chosen week + weekday</option>
          </select>
          {(rec.monthly_mode || "day_of_month") === "day_of_month" && (
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: "var(--text-muted)" }}>Day of month:</span>
              <input className="or-input w-20" type="number" min="1" max="31"
                value={rec.month_day ?? ""} placeholder="e.g. 31"
                onChange={(e) => set({ month_day: parseInt(e.target.value, 10) || undefined })}
                data-testid="rc-recur-month-day" />
              <span style={{ color: "var(--text-muted)" }}>(shorter months use their last day)</span>
            </div>
          )}
          {rec.monthly_mode === "nth_weekday" && (
            <div className="flex gap-2">
              <select className="or-input flex-1" value={rec.nth_week || 1}
                onChange={(e) => set({ nth_week: parseInt(e.target.value, 10) })} data-testid="rc-recur-nth-week">
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{["First", "Second", "Third", "Fourth"][n - 1]}</option>)}
              </select>
              <select className="or-input flex-1" value={rec.weekday ?? 0}
                onChange={(e) => set({ weekday: parseInt(e.target.value, 10) })} data-testid="rc-recur-nth-weekday">
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {pattern === "custom" && (
        <div className="flex items-center gap-2 text-sm">
          <span style={{ color: "var(--text-muted)" }}>Every</span>
          <input className="or-input w-20" type="number" min="1" max="365" value={rec.interval || 1}
            onChange={(e) => set({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            data-testid="rc-recur-interval" />
          <select className="or-input flex-1" value={rec.unit || "days"}
            onChange={(e) => set({ unit: e.target.value })} data-testid="rc-recur-unit">
            <option value="days">day(s)</option>
            <option value="weeks">week(s)</option>
            <option value="months">month(s)</option>
          </select>
        </div>
      )}

      {pattern !== "one_time" && (
        <div className="space-y-2">
          <select className="or-input w-full"
            value={rec.end_date ? "end_date" : rec.max_occurrences ? "count" : "never"}
            onChange={(e) => {
              const v = e.target.value;
              set({ end_date: v === "end_date" ? rec.end_date || "" : null,
                    max_occurrences: v === "count" ? rec.max_occurrences || 10 : null });
            }} data-testid="rc-recur-end-mode">
            <option value="never">Repeats until stopped</option>
            <option value="end_date">Ends on a date</option>
            <option value="count">Ends after a number of times</option>
          </select>
          {typeof rec.end_date === "string" && (
            <input className="or-input w-full" type="date" value={(rec.end_date || "").slice(0, 10)}
              onChange={(e) => set({ end_date: e.target.value })} data-testid="rc-recur-end-date" />
          )}
          {!!rec.max_occurrences && (
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: "var(--text-muted)" }}>Stop after</span>
              <input className="or-input w-20" type="number" min="1" max="1000" value={rec.max_occurrences}
                onChange={(e) => set({ max_occurrences: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                data-testid="rc-recur-max-count" />
              <span style={{ color: "var(--text-muted)" }}>time(s)</span>
            </div>
          )}
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Times follow the Center timezone ({timezone || "UTC"}). Upcoming occurrences are created automatically.
          </div>
        </div>
      )}
    </div>
  );
};

export const recurrenceLabel = (rec) => {
  if (!rec || rec.pattern === "one_time") return "One time";
  const W = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const base = {
    daily: "Daily",
    weekdays: "Weekdays (Mon–Fri)",
    weekly: `Weekly on ${(rec.weekdays || []).map((i) => W[i]).join(", ")}`,
    biweekly: `Every 2 weeks on ${(rec.weekdays || []).map((i) => W[i]).join(", ")}`,
    monthly: rec.monthly_mode === "first_weekday" ? "Monthly — first weekday"
      : rec.monthly_mode === "last_weekday" ? "Monthly — last weekday"
      : rec.monthly_mode === "nth_weekday" ? `Monthly — ${["1st", "2nd", "3rd", "4th"][(rec.nth_week || 1) - 1]} ${W[rec.weekday || 0]}`
      : `Monthly on day ${rec.month_day || "?"}`,
    custom: `Every ${rec.interval || 1} ${rec.unit || "days"}`,
  }[rec.pattern] || rec.pattern;
  if (rec.end_date) return `${base} · until ${rec.end_date.slice(0, 10)}`;
  if (rec.max_occurrences) return `${base} · ${rec.max_occurrences}×`;
  return base;
};
