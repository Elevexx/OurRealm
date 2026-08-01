import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { RcRecurrenceEditor, DEFAULT_RECURRENCE } from "./RcRecurrenceEditor";

const uuid = () =>
  (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Adaptive create form: full options for managers, restricted
// "Personal task inside this Center" for plain members.
export const RcItemCreateModal = ({ centerId, canCreate, members, timezone, onClose, onCreated }) => {
  const managerMode = !!canCreate;
  const [form, setForm] = useState({
    title: "", description: "", item_type: "task", priority: "normal",
    visibility: managerMode ? "center" : "assigned", assignee_ids: [],
    approver_id: "", reviewer_id: "", approval_required: false,
    due_at: "", start_at: "", category: "",
  });
  const [checklist, setChecklist] = useState([]);
  const [checkInput, setCheckInput] = useState("");
  const [recurrence, setRecurrence] = useState(DEFAULT_RECURRENCE);
  const [busy, setBusy] = useState(false);
  const clientToken = useMemo(() => uuid(), []);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const activeMembers = (members || []).filter((m) => m.status === "active");
  const approverPool = activeMembers.filter((m) => ["owner", "admin", "manager"].includes(m.role));
  const recurring = recurrence.pattern && recurrence.pattern !== "one_time";

  const submit = async () => {
    if (!form.title.trim()) { toast.error("A title is required"); return; }
    if (recurring && !form.due_at) { toast.error("A recurring item needs a first due date"); return; }
    setBusy(true);
    try {
      const body = {
        title: form.title.trim(), description: form.description.trim(),
        item_type: managerMode ? form.item_type : "task",
        priority: form.priority,
        visibility: form.visibility,
        assignee_ids: managerMode ? form.assignee_ids : [],
        approver_id: managerMode ? (form.approver_id || null) : null,
        reviewer_id: managerMode ? (form.reviewer_id || null) : null,
        approval_required: managerMode ? form.approval_required : false,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        start_at: form.start_at ? new Date(form.start_at).toISOString() : null,
        category: form.category.trim() || null,
        checklist,
        recurrence: recurring ? { ...recurrence, timezone: recurrence.timezone || timezone } : null,
        client_token: clientToken,
      };
      const r = await apiClient.post(`/responsibility-center/${centerId}/items`, body);
      toast.success(recurring ? "Recurring series created" : "Item created");
      onCreated(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create the item");
    } finally { setBusy(false); }
  };

  const toggleAssignee = (uid) =>
    set({ assignee_ids: form.assignee_ids.includes(uid)
      ? form.assignee_ids.filter((x) => x !== uid)
      : [...form.assignee_ids, uid] });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose} data-testid="rc-create-modal">
      <div className="or-surface w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
            {managerMode ? "New Item" : "New Personal Task"}
          </h3>
          <button className="or-btn or-btn-ghost p-1.5" onClick={onClose} aria-label="Close" data-testid="rc-create-close">
            <X size={16} />
          </button>
        </div>
        {!managerMode && (
          <div className="text-xs mb-3 p-2 rounded" data-testid="rc-create-self-note"
            style={{ background: "rgba(90,178,255,0.1)", border: "1px solid rgba(90,178,255,0.3)", color: "#5AB2FF" }}>
            Personal task inside this Center — assigned to you only.
          </div>
        )}

        <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Title</label>
        <input className="or-input w-full mt-1 mb-3" maxLength={140} value={form.title}
          onChange={(e) => set({ title: e.target.value })} data-testid="rc-create-title" autoFocus />

        <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Description (optional)</label>
        <textarea className="or-input w-full mt-1 mb-3" rows={2} maxLength={3000} value={form.description}
          onChange={(e) => set({ description: e.target.value })} data-testid="rc-create-desc" />

        <div className="grid grid-cols-2 gap-3 mb-3">
          {managerMode && (
            <div>
              <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Type</label>
              <select className="or-input w-full mt-1" value={form.item_type}
                onChange={(e) => set({ item_type: e.target.value })} data-testid="rc-create-type">
                <option value="task">Task</option>
                <option value="responsibility">Responsibility</option>
                <option value="goal">Goal</option>
                <option value="milestone">Milestone</option>
              </select>
            </div>
          )}
          <div>
            <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Priority</label>
            <select className="or-input w-full mt-1" value={form.priority}
              onChange={(e) => set({ priority: e.target.value })} data-testid="rc-create-priority">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          {managerMode && (
            <div>
              <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Visibility</label>
              <select className="or-input w-full mt-1" value={form.visibility}
                onChange={(e) => set({ visibility: e.target.value })} data-testid="rc-create-visibility">
                <option value="center">Whole Center</option>
                <option value="assigned">Assigned people only</option>
                <option value="managers">Managers only</option>
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Start (optional)</label>
            <input className="or-input w-full mt-1" type="datetime-local" value={form.start_at}
              onChange={(e) => set({ start_at: e.target.value })} data-testid="rc-create-start" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Due {recurring ? "(first occurrence)" : "(optional)"}
            </label>
            <input className="or-input w-full mt-1" type="datetime-local" value={form.due_at}
              onChange={(e) => set({ due_at: e.target.value })} data-testid="rc-create-due" />
          </div>
        </div>

        {managerMode && (
          <div className="mb-3">
            <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Assignees</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {activeMembers.map((m) => (
                <button key={m.user_id} type="button" className="or-chip"
                  data-active={form.assignee_ids.includes(m.user_id)}
                  onClick={() => toggleAssignee(m.user_id)}
                  data-testid={`rc-create-assignee-${m.username}`}>
                  @{m.username}
                </button>
              ))}
            </div>
            <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
              Leave empty to keep it on yourself.
            </div>
          </div>
        )}

        {managerMode && (
          <div className="mb-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.approval_required}
                onChange={(e) => set({ approval_required: e.target.checked })}
                data-testid="rc-create-approval-required" />
              Requires approval when submitted
            </label>
            {form.approval_required && (
              <select className="or-input w-full" value={form.approver_id}
                onChange={(e) => set({ approver_id: e.target.value })} data-testid="rc-create-approver">
                <option value="">Any manager can approve</option>
                {approverPool.map((m) => (
                  <option key={m.user_id} value={m.user_id}>@{m.username} ({m.role})</option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="mb-3">
          <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Checklist (optional)</label>
          {checklist.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-sm mt-1">
              <span className="flex-1 truncate">• {c}</span>
              <button type="button" className="text-xs" style={{ color: "#FF6B6B" }}
                onClick={() => setChecklist(checklist.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
          <div className="flex gap-2 mt-1">
            <input className="or-input flex-1" maxLength={60} placeholder="Add a step…" value={checkInput}
              onChange={(e) => setCheckInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && checkInput.trim()) { setChecklist([...checklist, checkInput.trim()]); setCheckInput(""); e.preventDefault(); } }}
              data-testid="rc-create-check-input" />
            <button type="button" className="or-btn or-btn-ghost text-xs" disabled={!checkInput.trim()}
              onClick={() => { setChecklist([...checklist, checkInput.trim()]); setCheckInput(""); }}
              data-testid="rc-create-check-add">Add</button>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Repeat</label>
          <div className="mt-1">
            <RcRecurrenceEditor value={recurrence} onChange={setRecurrence} timezone={timezone} />
          </div>
        </div>

        <button className="or-btn w-full" disabled={busy || !form.title.trim()} onClick={submit}
          data-testid="rc-create-submit">
          {busy ? "Creating…" : recurring ? "Create Recurring Series" : "Create"}
        </button>
      </div>
    </div>
  );
};
