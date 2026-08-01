import React, { useCallback, useEffect, useState } from "react";
import { Plus, Repeat, ChevronRight, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { RcItemCreateModal } from "./RcItemCreateModal";
import { RcItemDrawer, STATUS_META, PRIORITY_META } from "./RcItemDrawer";
import { recurrenceLabel } from "./RcRecurrenceEditor";

const fmtDue = (iso) => {
  if (!iso) return "No due date";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};

const SCOPES = [
  ["", "All"], ["mine", "Assigned to Me"], ["created", "Created by Me"],
  ["due_today", "Due Today"], ["overdue", "Overdue"],
  ["my_approvals", "Pending My Approval"], ["submitted_by_me", "Submitted by Me"],
  ["recently_completed", "Recently Completed"], ["series", "Recurring Series"],
];

// Work tab — summary cards, filterable list, create + detail drawer.
export const RcWorkTab = ({ centerId, data, initialItemId, onItemOpenChange }) => {
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState(null);
  const [scope, setScope] = useState("");
  const [filters, setFilters] = useState({ q: "", item_type: "", status: "", priority: "", recurring: "", sort: "due" });
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [openItem, setOpenItem] = useState(initialItemId || null);

  const openDrawer = (iid) => { setOpenItem(iid); onItemOpenChange?.(iid); };

  useEffect(() => {
    if (initialItemId && initialItemId !== openItem) setOpenItem(initialItemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItemId]);

  const loadSummary = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/items-summary`);
      setSummary(r.data);
    } catch { /* summary optional */ }
  }, [centerId]);

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ scope, page: String(page), limit: "25", ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
      const r = await apiClient.get(`/responsibility-center/${centerId}/items?${params}`);
      setList(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load items");
    }
  }, [centerId, scope, page, filters]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadList(); }, [loadList]);
  const reloadAll = () => { loadSummary(); loadList(); };

  const canCreate = list?.can_create;
  const canCreateSelf = list?.can_create_self;
  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const seriesAction = async (id, action) => {
    try {
      await apiClient.post(`/responsibility-center/${centerId}/items/${id}/series/${action}`);
      toast.success(`Series ${action}d`);
      reloadAll();
    } catch (e) { toast.error(e?.response?.data?.detail || "Series action failed"); }
  };

  return (
    <div className="space-y-4" data-testid="rc-tab-work">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="rc-work-summary">
          {[["Due Today", summary.due_today, "#F4C84A", "due_today"],
            ["Overdue", summary.overdue, summary.overdue ? "#FF6B6B" : undefined, "overdue"],
            ["Assigned to Me", summary.assigned_to_me, "#5AB2FF", "mine"],
            ["Pending My Approval", summary.my_pending_approvals, summary.my_pending_approvals ? "#C26BFF" : undefined, "my_approvals"],
            ["In Progress", summary.in_progress, undefined, ""],
            ["Blocked", summary.blocked, summary.blocked ? "#FF6B6B" : undefined, ""],
            ["Responsibilities", summary.active_responsibilities, undefined, ""],
            ["Completed", summary.completed_total, "#7BD88F", "recently_completed"]].map(([l, v, col, sc]) => (
            <button key={l} className="or-surface p-3 text-left"
              onClick={() => { setScope(sc); setPage(1); }}
              data-testid={`rc-work-stat-${l.toLowerCase().replace(/ /g, "-")}`}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{l}</div>
              <div className="text-lg font-semibold" style={col ? { color: col } : undefined}>{v}</div>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="or-surface p-3 space-y-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {SCOPES.map(([sc, label]) => (
            <button key={sc || "all"} className="or-chip shrink-0" data-active={scope === sc}
              onClick={() => { setScope(sc); setPage(1); }} data-testid={`rc-work-scope-${sc || "all"}`}>
              {sc === "series" && <Repeat size={11} />} {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="or-input flex-1 min-w-[120px] text-sm" placeholder="Search…" value={filters.q}
            onChange={(e) => setF({ q: e.target.value })} data-testid="rc-work-search" />
          <select className="or-input text-sm" value={filters.item_type} onChange={(e) => setF({ item_type: e.target.value })} data-testid="rc-work-filter-type">
            <option value="">All types</option>
            <option value="task">Task</option><option value="responsibility">Responsibility</option>
            <option value="goal">Goal</option><option value="milestone">Milestone</option>
          </select>
          {scope !== "series" && (
            <select className="or-input text-sm" value={filters.status} onChange={(e) => setF({ status: e.target.value })} data-testid="rc-work-filter-status">
              <option value="">Open items</option>
              <option value="active">Active</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="pending_approval">Pending approval</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          )}
          <select className="or-input text-sm" value={filters.priority} onChange={(e) => setF({ priority: e.target.value })} data-testid="rc-work-filter-priority">
            <option value="">Any priority</option>
            <option value="urgent">Urgent</option><option value="high">High</option>
            <option value="normal">Normal</option><option value="low">Low</option>
          </select>
          {scope !== "series" && (
            <select className="or-input text-sm" value={filters.recurring} onChange={(e) => setF({ recurring: e.target.value })} data-testid="rc-work-filter-recurring">
              <option value="">Recurring + one-time</option>
              <option value="yes">Recurring only</option>
              <option value="no">One-time only</option>
            </select>
          )}
          <select className="or-input text-sm" value={filters.sort} onChange={(e) => setF({ sort: e.target.value })} data-testid="rc-work-sort">
            <option value="due">Sort: due date</option>
            <option value="priority">Sort: priority</option>
            <option value="updated">Sort: recently updated</option>
            <option value="created">Sort: recently created</option>
            <option value="progress">Sort: progress</option>
            <option value="status">Sort: status</option>
            <option value="title">Sort: A–Z</option>
          </select>
          {(canCreate || canCreateSelf) && (
            <button className="or-btn text-sm ml-auto" onClick={() => setShowCreate(true)} data-testid="rc-work-create-btn">
              <Plus size={13} /> {canCreate ? "New Item" : "New Personal Task"}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="or-surface p-3" data-testid="rc-work-list">
        {!list ? (
          <div className="text-sm p-4 text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>
        ) : list.items.length === 0 ? (
          <div className="text-sm p-6 text-center" style={{ color: "var(--text-muted)" }} data-testid="rc-work-empty">
            Nothing here yet.{(canCreate || canCreateSelf) ? " Create the first item to get organized." : ""}
          </div>
        ) : (
          <div className="space-y-1">
            {list.items.map((it) => {
              const [sl, sc] = STATUS_META[it.status] || [it.status, "#9AA7BD"];
              const [, pc] = PRIORITY_META[it.priority] || [];
              if (scope === "series") {
                return (
                  <div key={it.id} className="flex flex-wrap items-center gap-2 py-2 px-1"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid={`rc-series-row-${it.id}`}>
                    <Repeat size={13} style={{ color: "#5AB2FF" }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{it.title}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {recurrenceLabel(it.recurrence)} · next {fmtDue(it.next_due_at)} · {it.occurrences_generated || 0} created
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-semibold"
                      style={{ color: it.series_status === "active" ? "#7BD88F" : "#F4C84A" }}>{it.series_status}</span>
                    {it.series_status === "active" && (
                      <button className="or-btn or-btn-ghost text-xs p-1.5" title="Pause series"
                        onClick={() => seriesAction(it.id, "pause")} data-testid={`rc-series-pause-${it.id}`}><Pause size={12} /></button>
                    )}
                    {it.series_status === "paused" && (
                      <button className="or-btn or-btn-ghost text-xs p-1.5" title="Resume series"
                        onClick={() => seriesAction(it.id, "resume")} data-testid={`rc-series-resume-${it.id}`}><Play size={12} /></button>
                    )}
                    {["active", "paused"].includes(it.series_status) && (
                      <button className="or-btn or-btn-ghost text-xs p-1.5" title="End series"
                        onClick={() => window.confirm("End this recurring series? Existing items stay.") && seriesAction(it.id, "end")}
                        data-testid={`rc-series-end-${it.id}`}><Square size={12} /></button>
                    )}
                  </div>
                );
              }
              return (
                <button key={it.id} className="w-full flex flex-wrap items-center gap-2 py-2 px-1 text-left hover:bg-white/5 rounded"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                  onClick={() => openDrawer(it.id)} data-testid={`rc-item-row-${it.id}`}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: pc || "#9AA7BD" }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">
                      {it.series_id && <Repeat size={11} className="inline mr-1" style={{ color: "#5AB2FF" }} />}
                      {it.title}
                      {it.is_self_task && <span className="text-[10px] ml-1.5 uppercase" style={{ color: "#5AB2FF" }}>Personal</span>}
                    </div>
                    <div className="text-[11px]" style={{ color: it.overdue ? "#FF6B6B" : "var(--text-muted)" }}>
                      {fmtDue(it.due_at)}{it.overdue ? " · OVERDUE" : ""} · {(it.assignees || []).map((a) => `@${a.username}`).join(", ") || "unassigned"}
                    </div>
                  </div>
                  {it.progress > 0 && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{it.progress}%</span>}
                  <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: `${sc}22`, color: sc }}>{sl}</span>
                  <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
                </button>
              );
            })}
          </div>
        )}
        {list && list.total > list.limit && (
          <div className="flex items-center justify-between mt-3 text-xs">
            <button className="or-btn or-btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="rc-work-prev">Previous</button>
            <span style={{ color: "var(--text-muted)" }}>Page {page} of {Math.ceil(list.total / list.limit)}</span>
            <button className="or-btn or-btn-ghost text-xs" disabled={page >= Math.ceil(list.total / list.limit)} onClick={() => setPage(page + 1)} data-testid="rc-work-next">Next</button>
          </div>
        )}
      </div>

      {showCreate && (
        <RcItemCreateModal centerId={centerId} canCreate={canCreate}
          members={data?.members || []} timezone={data?.center?.timezone || "UTC"}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); reloadAll(); }} />
      )}
      {openItem && (
        <RcItemDrawer centerId={centerId} itemId={openItem}
          onClose={() => openDrawer(null)} onChanged={reloadAll} />
      )}
    </div>
  );
};
