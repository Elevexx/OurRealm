import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import apiClient from "@/api/client";

// Education conversion — turn a member/student self-task into an official
// assignment. Never silent: original stays, linked, audited.
export const RcConvertModal = ({ centerId, item, onClose, onConverted }) => {
  const [mode, setMode] = useState("personal");
  const [members, setMembers] = useState([]);
  const [units, setUnits] = useState([]);
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [unitId, setUnitId] = useState("");
  const [unitMode, setUnitMode] = useState("individual");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.get(`/responsibility-center/${centerId}/members`)
      .then((r) => setMembers(r.data.members || r.data || [])).catch(() => {});
    apiClient.get(`/responsibility-center/${centerId}/units`)
      .then((r) => setUnits((r.data.units || []).filter((u) => u.status === "active"))).catch(() => {});
  }, [centerId]);

  const convert = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/responsibility-center/${centerId}/items/${item.id}/convert`, {
        mode, assignee_ids: assigneeIds, unit_id: unitId || null, unit_mode: unitMode,
      });
      toast.success("Converted to a Center assignment");
      onConverted();
    } catch (e) {
      toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Conversion failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose} data-testid="rc-convert-modal">
      <div className="or-surface w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-1">Convert to Center assignment</h3>
        <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          "{item.title}" — created by @{item.created_by_username}. The original personal task stays unchanged and is linked to the new assignment.
        </div>
        <div className="space-y-2 mb-3">
          {[["personal", "Approve as a Center personal assignment (same person)"],
            ["selected", "Copy as an assignment for selected members"],
            ["unit", "Convert to a class / unit assignment"]].map(([v, l]) => (
            <label key={v} className="flex items-start gap-2 text-sm cursor-pointer" data-testid={`rc-convert-mode-${v}`}>
              <input type="radio" name="convert-mode" className="mt-0.5" checked={mode === v} onChange={() => setMode(v)} />
              <span>{l}</span>
            </label>
          ))}
        </div>
        {mode === "selected" && (
          <div className="mb-3">
            <div className="text-xs mb-1">Choose members</div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <button key={m.user_id} className="or-chip" data-active={assigneeIds.includes(m.user_id)}
                  onClick={() => setAssigneeIds((a) => a.includes(m.user_id) ? a.filter((x) => x !== m.user_id) : [...a, m.user_id])}
                  data-testid={`rc-convert-member-${m.username}`}>@{m.username}</button>
              ))}
            </div>
          </div>
        )}
        {mode === "unit" && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <label className="text-xs">Class / unit
              <select className="or-input w-full mt-1" value={unitId} onChange={(e) => setUnitId(e.target.value)} data-testid="rc-convert-unit-select">
                <option value="">Choose…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="text-xs">Assignment mode
              <select className="or-input w-full mt-1" value={unitMode} onChange={(e) => setUnitMode(e.target.value)} data-testid="rc-convert-unit-mode">
                <option value="individual">Each member individually</option>
                <option value="shared">Shared unit duty</option>
              </select>
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="or-btn or-btn-ghost" onClick={onClose} data-testid="rc-convert-cancel">Leave unchanged</button>
          <button className="or-btn or-btn-primary" disabled={busy || (mode === "selected" && !assigneeIds.length) || (mode === "unit" && !unitId)}
            onClick={convert} data-testid="rc-convert-confirm">{busy ? "Converting…" : "Convert"}</button>
        </div>
      </div>
    </div>
  );
};
