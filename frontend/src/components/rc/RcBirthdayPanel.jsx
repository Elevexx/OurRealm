import React, { useCallback, useEffect, useState } from "react";
import { Cake } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

// Birthday auto-events — off by default, explicit per-member opt-in.
export const RcBirthdayPanel = ({ centerId }) => {
  const [s, setS] = useState(null);
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/birthday-settings`);
      setS(r.data);
      setMonth(r.data.my_birth_month || "");
      setDay(r.data.my_birth_day || "");
    } catch (e) { /* not a member with access */ }
  }, [centerId]);
  useEffect(() => { load(); }, [load]);
  if (!s) return null;

  const patch = async (updates) => {
    try {
      const r = await apiClient.patch(`/responsibility-center/${centerId}/birthday-settings`, updates);
      setS((x) => ({ ...x, ...r.data }));
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
  };
  const consent = async (consented) => {
    try {
      await apiClient.post(`/responsibility-center/${centerId}/birthday-consent`,
        { consented, birth_month: month ? parseInt(month, 10) : null, birth_day: day ? parseInt(day, 10) : null });
      toast.success(consented ? "Birthday sharing enabled for this Center" : "Birthday sharing turned off");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not update consent"); }
  };

  return (
    <div className="or-surface p-4 mt-4" data-testid="rc-birthday-panel">
      <h3 className="text-sm font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5"><Cake size={14} /> Birthday auto-events</h3>
      <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        Off by default. Members individually choose whether to share their birthday with this Center — nothing is inferred or exposed without consent.
      </div>
      {s.can_manage && (
        <div className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-sm">Enable birthday auto-events for this Center</span>
          <button className="or-chip shrink-0" data-active={s.birthday_auto_events_enabled}
            onClick={() => patch({ birthday_auto_events_enabled: !s.birthday_auto_events_enabled })}
            data-testid="rc-birthday-center-toggle">{s.birthday_auto_events_enabled ? "ON" : "OFF"}</button>
        </div>
      )}
      <div className="pt-2">
        <div className="text-xs mb-1.5">My birthday sharing in this Center</div>
        {!s.my_consent ? (
          <div className="flex flex-wrap items-center gap-2">
            <select className="or-input text-xs" style={{ width: "auto" }} value={month} onChange={(e) => setMonth(e.target.value)} data-testid="rc-birthday-month">
              <option value="">Month</option>
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select className="or-input text-xs" style={{ width: "auto" }} value={day} onChange={(e) => setDay(e.target.value)} data-testid="rc-birthday-day">
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
            <button className="or-btn or-btn-primary text-xs" disabled={!month || !day} onClick={() => consent(true)} data-testid="rc-birthday-optin">
              Share my birthday here
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm" data-testid="rc-birthday-shared-label">Shared ({s.my_birth_month}/{s.my_birth_day}) — a yearly calendar event is created when the Center enables auto-events.</span>
            <button className="or-btn or-btn-ghost text-xs" onClick={() => consent(false)} data-testid="rc-birthday-optout">Stop sharing</button>
          </div>
        )}
      </div>
    </div>
  );
};
