import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const HOURS = Array.from({ length: 24 }, (_, h) => {
  const label = h === 0 ? "12:00 AM" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`;
  return [h, label];
});
const INCLUDES = [
  ["include_due_today", "Due Today"],
  ["include_due_soon", "Due Soon"],
  ["include_overdue", "Overdue"],
  ["include_approvals", "Pending My Approval"],
  ["include_changes_requested", "Changes Requested"],
  ["include_recently_assigned", "Recently Assigned"],
  ["include_events", "Calendar Events (meetings, classes, practices, shifts)"],
];

// Daily Work Digest settings — one in-app morning summary, off by default.
export const RcWorkDigestCard = () => {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    apiClient.get("/responsibility-center/digest-settings")
      .then((r) => setPrefs(r.data)).catch(() => {});
  }, []);
  const patch = async (updates) => {
    const prev = prefs;
    setPrefs((p) => ({ ...p, ...updates }));
    try {
      const r = await apiClient.patch("/responsibility-center/digest-settings", updates);
      setPrefs(r.data);
    } catch (e) {
      setPrefs(prev);
      toast.error(e?.response?.data?.detail || "Could not save digest settings");
    }
  };
  const enable = () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    patch({ digest_enabled: !prefs.digest_enabled, digest_timezone: tz });
  };
  if (!prefs) return null;
  return (
    <div data-testid="rc-digest-settings">
      <div className="flex items-center justify-between gap-3 py-2">
        <div>
          <div className="text-sm">Daily Work Digest</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            One in-app morning summary of your work and events across all Centers. Never replaces critical alerts. Max one per day.
          </div>
        </div>
        <button className="or-chip shrink-0" data-active={prefs.digest_enabled} onClick={enable}
          data-testid="rc-digest-toggle">{prefs.digest_enabled ? "ON" : "OFF"}</button>
      </div>
      {prefs.digest_enabled && (
        <div className="pl-1">
          <div className="flex items-center gap-2 py-2 text-sm">
            <span>Deliver at</span>
            <select className="or-input text-xs" value={prefs.digest_hour}
              onChange={(e) => patch({ digest_hour: parseInt(e.target.value, 10) })} data-testid="rc-digest-hour-select">
              {HOURS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
            </select>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>({prefs.digest_timezone})</span>
          </div>
          {INCLUDES.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-1.5"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="text-xs">{label}</span>
              <button className="or-chip shrink-0" data-active={prefs[k]} onClick={() => patch({ [k]: !prefs[k] })}
                data-testid={`rc-digest-${k}`}>{prefs[k] ? "ON" : "OFF"}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
