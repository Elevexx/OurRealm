import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, CheckSquare, MessageSquare, Paperclip, History, Repeat, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { recurrenceLabel } from "./RcRecurrenceEditor";
import { RcConvertModal } from "./RcConvertModal";

const fmt = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};

export const STATUS_META = {
  draft: ["Draft", "#9AA7BD"], assigned: ["Assigned", "#5AB2FF"],
  accepted: ["Accepted", "#5AB2FF"], declined: ["Declined", "#FF6B6B"],
  in_progress: ["In Progress", "#F4C84A"], waiting: ["Waiting", "#9AA7BD"],
  blocked: ["Blocked", "#FF6B6B"], submitted: ["Submitted", "#C26BFF"],
  pending_approval: ["Pending Approval", "#C26BFF"],
  changes_requested: ["Changes Requested", "#FF8A5A"],
  approved: ["Approved", "#7BD88F"], completed: ["Completed", "#7BD88F"],
  canceled: ["Canceled", "#9AA7BD"], archived: ["Archived", "#9AA7BD"],
};
export const PRIORITY_META = {
  low: ["Low", "#9AA7BD"], normal: ["Normal", "#5AB2FF"],
  high: ["High", "#FF8A5A"], urgent: ["Urgent", "#FF6B6B"],
};

const ACTION_LABELS = {
  accept: "Accept", decline: "Decline", start: "Start", wait: "Put on hold",
  block: "Mark blocked", unblock: "Unblock", submit: "Submit",
  complete: "Complete", cancel: "Cancel item", archive: "Archive", reopen: "Reopen",
};
const DESTRUCTIVE = new Set(["cancel", "archive", "decline"]);

// Full item detail — right drawer on desktop, full-screen sheet on mobile.
export const RcItemDrawer = ({ centerId, itemId, onClose, onChanged }) => {
  const [data, setData] = useState(null);
  const [comment, setComment] = useState("");
  const [checkInput, setCheckInput] = useState("");
  const [progressDraft, setProgressDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const fileRef = useRef(null);
  const progressTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/items/${itemId}`);
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load the item");
      onClose();
    }
  }, [centerId, itemId, onClose]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refresh = () => { load(); onChanged?.(); };
  const api = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); refresh(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };

  if (!data) {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.5)" }} data-testid="rc-drawer-loading" />
    );
  }
  const { item, comments, approvals, activity, subtasks, dependencies, series, me } = data;
  const [statusLabel, statusColor] = STATUS_META[item.status] || [item.status, "#9AA7BD"];
  const [prioLabel, prioColor] = PRIORITY_META[item.priority] || [item.priority, "#9AA7BD"];

  const availableActions = () => {
    const acts = [];
    const s = item.status;
    const canManage = me.can_assign || me.can_edit;
    if (me.is_assignee) {
      if (s === "assigned") acts.push("accept", "decline");
      if (["assigned", "accepted", "changes_requested", "waiting", "blocked"].includes(s)) acts.push("start");
      if (["in_progress", "accepted", "assigned", "changes_requested"].includes(s)) acts.push("submit");
      if (s === "in_progress") acts.push("wait");
      if (["in_progress", "accepted", "assigned"].includes(s)) acts.push("block");
      if (s === "blocked") acts.push("unblock");
    }
    if ((me.is_assignee || canManage) && !item.approval_required
        && ["in_progress", "accepted", "assigned", "submitted"].includes(s)) acts.push("complete");
    if ((me.is_assignee || canManage) && item.approval_required && s === "approved") acts.push("complete");
    if (canManage || (item.is_self_task && me.can_edit)) {
      if (!["completed", "approved", "canceled", "archived"].includes(s)) acts.push("cancel");
      if (["completed", "canceled", "declined"].includes(s)) acts.push("reopen");
      acts.push("archive");
    }
    return [...new Set(acts)].filter((a) => a !== "start" || s !== "in_progress");
  };

  const doAction = (action) => {
    if (DESTRUCTIVE.has(action) && !window.confirm(`${ACTION_LABELS[action]} — are you sure?`)) return;
    api(() => apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/actions/${action}`, { note: "" }),
      `${ACTION_LABELS[action]} — done`);
  };

  const decide = (decision) => {
    let note = "";
    if (decision !== "approve") {
      note = window.prompt(decision === "reject" ? "Why is this rejected? (required)" : "What changes are needed? (required)") || "";
      if (note.trim().length < 3) { toast.error("A note is required"); return; }
    }
    api(() => apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/approval`, { decision, note }),
      "Decision recorded");
  };

  const uploadFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: up } = await apiClient.post("/images/upload", fd,
        { headers: { "Content-Type": "multipart/form-data" } });
      if (!up?.url) throw new Error("Upload failed");
      await apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/attachments`,
        { url: up.url, name: file.name, attachment_type: "file" });
      toast.success("Attachment added");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Upload failed");
    } finally { setBusy(false); }
  };

  const addLink = () => {
    const url = window.prompt("Paste a link (https://…)");
    if (!url) return;
    api(() => apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/attachments`,
      { url, name: url.slice(0, 60), attachment_type: "link" }), "Link attached");
  };

  const progressValue = progressDraft ?? item.progress;
  const canTouch = me.is_assignee || me.can_edit;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose} data-testid="rc-item-drawer">
      <div className="or-surface w-full sm:max-w-md h-full overflow-y-auto p-5"
        style={{ borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                style={{ background: `${statusColor}22`, color: statusColor }} data-testid="rc-drawer-status">{statusLabel}</span>
              <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: prioColor }}>{prioLabel}</span>
              <span className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>{item.item_type}</span>
              {item.is_self_task && <span className="text-[10px] uppercase" style={{ color: "#5AB2FF" }}>Personal</span>}
              {item.overdue && <span className="text-[10px] uppercase font-semibold" style={{ color: "#FF6B6B" }} data-testid="rc-drawer-overdue">Overdue</span>}
            </div>
            <h3 className="text-lg leading-snug" style={{ fontFamily: "var(--font-display)" }} data-testid="rc-drawer-title">{item.title}</h3>
          </div>
          <button className="or-btn or-btn-ghost p-1.5 shrink-0" onClick={onClose} aria-label="Close" data-testid="rc-drawer-close">
            <X size={16} />
          </button>
        </div>

        {item.description && <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>{item.description}</p>}

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          <div>Created by <b style={{ color: "var(--text-main)" }}>@{item.created_by_username}</b></div>
          <div>Assignees: <b style={{ color: "var(--text-main)" }}>{(item.assignees || []).map((a) => `@${a.username}`).join(", ") || "—"}</b></div>
          {item.start_at && <div>Starts: {fmt(item.start_at)}</div>}
          <div data-testid="rc-drawer-due">Due: <b style={{ color: item.overdue ? "#FF6B6B" : "var(--text-main)" }}>{fmt(item.due_at)}</b></div>
          {item.approver_username && <div>Approver: @{item.approver_username}</div>}
          {item.reviewer_username && <div>Reviewer: @{item.reviewer_username}</div>}
          {series && <div className="col-span-2"><Repeat size={11} className="inline mr-1" />{recurrenceLabel(series.recurrence)} · series {series.series_status}</div>}
          {item.category && <div>Category: {item.category}</div>}
          <div>Visibility: {item.visibility}</div>
        </div>

        {/* Education conversion — self-task → official assignment */}
        {item.converted_to?.length > 0 && (
          <div className="rounded p-2 mb-3 text-xs" style={{ background: "rgba(123,216,143,0.1)", color: "#7BD88F" }} data-testid="rc-drawer-converted-banner">
            This personal task was converted to an official assignment.
          </div>
        )}
        {item.source_item_id && (
          <div className="rounded p-2 mb-3 text-xs" style={{ background: "rgba(90,178,255,0.1)", color: "#5AB2FF" }} data-testid="rc-drawer-source-banner">
            Official assignment — created from @{item.source_created_by_username}'s personal task suggestion.
          </div>
        )}
        {me.can_convert && (
          <button className="or-btn text-xs mb-3" style={{ borderColor: "#7BD88F", color: "#7BD88F" }}
            onClick={() => setShowConvert(true)} data-testid="rc-drawer-convert-btn">
            Convert to official assignment
          </button>
        )}
        {showConvert && (
          <RcConvertModal centerId={centerId} item={item}
            onClose={() => setShowConvert(false)}
            onConverted={() => { setShowConvert(false); refresh(); }} />
        )}

        {/* Progress */}
        <div className="mb-4" data-testid="rc-drawer-progress">
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: "var(--text-muted)" }}>Progress ({item.progress_method})</span>
            <b>{progressValue}%</b>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${progressValue}%`, background: statusColor }} />
          </div>
          {item.progress_method === "manual" && canTouch && !["completed", "approved", "canceled", "archived"].includes(item.status) && (
            <input type="range" min="0" max="100" className="w-full mt-1" value={progressValue}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setProgressDraft(v);
                clearTimeout(progressTimer.current);
                progressTimer.current = setTimeout(() => {
                  apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/progress`, { percent: v })
                    .then(() => { setProgressDraft(null); refresh(); })
                    .catch((err) => toast.error(err?.response?.data?.detail || "Could not update progress"));
                }, 600);
              }}
              data-testid="rc-drawer-progress-slider" />
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mb-4" data-testid="rc-drawer-actions">
          {availableActions().map((a) => (
            <button key={a} className={`or-btn text-xs ${DESTRUCTIVE.has(a) ? "or-btn-ghost" : ""}`}
              style={DESTRUCTIVE.has(a) ? { borderColor: "rgba(255,107,107,0.4)", color: "#FF6B6B" } : undefined}
              disabled={busy} onClick={() => doAction(a)} data-testid={`rc-action-${a}`}>
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>

        {/* Approval panel */}
        {item.status === "pending_approval" && me.is_approver && (
          <div className="p-3 rounded mb-4" data-testid="rc-drawer-approval-panel"
            style={{ background: "rgba(194,107,255,0.08)", border: "1px solid rgba(194,107,255,0.3)" }}>
            <div className="text-sm font-semibold mb-2" style={{ color: "#C26BFF" }}>Awaiting your approval</div>
            <div className="flex flex-wrap gap-2">
              <button className="or-btn text-xs" disabled={busy} onClick={() => decide("approve")} data-testid="rc-approve-btn">Approve</button>
              <button className="or-btn or-btn-ghost text-xs" disabled={busy} onClick={() => decide("request_changes")} data-testid="rc-request-changes-btn">Request changes</button>
              <button className="or-btn or-btn-ghost text-xs" style={{ borderColor: "rgba(255,107,107,0.4)", color: "#FF6B6B" }}
                disabled={busy} onClick={() => decide("reject")} data-testid="rc-reject-btn">Reject</button>
            </div>
          </div>
        )}

        {/* Checklist */}
        <Section icon={CheckSquare} title={`Checklist (${(item.checklist || []).filter((c) => c.completed).length}/${(item.checklist || []).length})`}>
          {(item.checklist || []).map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer" data-testid={`rc-check-${c.id}`}>
              <input type="checkbox" checked={c.completed} disabled={!canTouch || busy}
                onChange={() => api(() => apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/checklist`,
                  { op: "set", entry_id: c.id, completed: !c.completed }))} />
              <span className={c.completed ? "line-through" : ""} style={c.completed ? { color: "var(--text-muted)" } : undefined}>{c.title}</span>
            </label>
          ))}
          {canTouch && (
            <div className="flex gap-2 mt-1">
              <input className="or-input flex-1 text-sm" maxLength={60} placeholder="Add a step…" value={checkInput}
                onChange={(e) => setCheckInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && checkInput.trim()) { api(() => apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/checklist`, { op: "add", title: checkInput.trim() })); setCheckInput(""); } }}
                data-testid="rc-drawer-check-input" />
            </div>
          )}
        </Section>

        {/* Subtasks */}
        {(subtasks || []).length > 0 && (
          <Section icon={CheckSquare} title={`Subtasks (${subtasks.length})`}>
            {subtasks.map((s) => (
              <div key={s.id} className="flex justify-between text-sm py-1">
                <span className="truncate">{s.title}</span>
                <span className="text-xs" style={{ color: (STATUS_META[s.status] || [])[1] }}>{(STATUS_META[s.status] || [s.status])[0]}</span>
              </div>
            ))}
          </Section>
        )}

        {/* Dependencies */}
        {(dependencies || []).length > 0 && (
          <Section icon={History} title="Depends on">
            {dependencies.map((d) => (
              <div key={d.id} className="flex justify-between text-sm py-1">
                <span className="truncate">{d.title}</span>
                <span className="text-xs" style={{ color: (STATUS_META[d.status] || [])[1] }}>{(STATUS_META[d.status] || [d.status])[0]}</span>
              </div>
            ))}
          </Section>
        )}

        {/* Attachments */}
        <Section icon={Paperclip} title={`Attachments (${(item.attachments || []).length})`}>
          {(item.attachments || []).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-sm py-1" data-testid={`rc-attachment-${a.id}`}>
              <a href={a.url} target="_blank" rel="noreferrer" className="truncate underline" style={{ color: "#5AB2FF" }}>
                {a.name || a.url}
              </a>
              {canTouch && (
                <button className="p-0.5" title="Remove" disabled={busy}
                  onClick={() => window.confirm("Remove this attachment?")
                    && api(() => apiClient.delete(`/responsibility-center/${centerId}/items/${itemId}/attachments/${a.id}`), "Attachment removed")}
                  data-testid={`rc-attachment-remove-${a.id}`}>
                  <Trash2 size={13} style={{ color: "#FF6B6B" }} />
                </button>
              )}
            </div>
          ))}
          {canTouch && (
            <div className="flex gap-2 mt-1">
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => uploadFile(e.target.files?.[0])} data-testid="rc-drawer-file-input" />
              <button className="or-btn or-btn-ghost text-xs" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="rc-drawer-upload-btn">
                <Upload size={12} /> Upload image
              </button>
              <button className="or-btn or-btn-ghost text-xs" disabled={busy} onClick={addLink} data-testid="rc-drawer-link-btn">
                <Paperclip size={12} /> Attach link
              </button>
            </div>
          )}
        </Section>

        {/* Approval history */}
        {(approvals || []).length > 0 && (
          <Section icon={History} title="Approval history">
            {approvals.map((a) => (
              <div key={a.id} className="text-xs py-1" data-testid={`rc-approval-row-${a.id}`}>
                Cycle {a.cycle}: {a.decision
                  ? <><b style={{ color: a.decision === "approve" ? "#7BD88F" : "#FF8A5A" }}>{a.decision.replace("_", " ")}</b> by @{a.decided_by_username} · {fmt(a.decided_at)}{a.note ? ` — "${a.note}"` : ""}</>
                  : <span style={{ color: "#C26BFF" }}>awaiting decision (requested {fmt(a.requested_at)})</span>}
              </div>
            ))}
          </Section>
        )}

        {/* Comments */}
        <Section icon={MessageSquare} title={`Comments (${(comments || []).length})`}>
          {(comments || []).map((c) => (
            <div key={c.id} className="py-1.5 text-sm" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              data-testid={`rc-comment-${c.id}`}>
              <div className="flex justify-between gap-2">
                <b className="text-xs">@{c.author_username}</b>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{fmt(c.created_at)}</span>
              </div>
              <div className="mt-0.5">{c.body}</div>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <input className="or-input flex-1 text-sm" maxLength={2000} placeholder="Write a comment… use @name to mention"
              value={comment} onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && comment.trim()) { api(() => apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/comments`, { body: comment.trim() })); setComment(""); } }}
              data-testid="rc-drawer-comment-input" />
            <button className="or-btn text-xs" disabled={busy || !comment.trim()}
              onClick={() => { api(() => apiClient.post(`/responsibility-center/${centerId}/items/${itemId}/comments`, { body: comment.trim() })); setComment(""); }}
              data-testid="rc-drawer-comment-send">Send</button>
          </div>
        </Section>

        {/* Activity */}
        <Section icon={History} title="Activity">
          {(activity || []).map((a) => (
            <div key={a.id} className="text-[11px] py-0.5" style={{ color: "var(--text-muted)" }}>
              @{a.actor_username} · {a.action.replace(/_/g, " ")} · {fmt(a.created_at)}
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
};

const Section = ({ icon: Icon, title, children }) => (
  <div className="mb-4">
    <div className="text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5"
      style={{ color: "var(--text-muted)" }}>
      <Icon size={12} /> {title}
    </div>
    {children}
  </div>
);
