import React, { useCallback, useEffect, useState } from "react";
import { ArrowUp, ArrowDown, X, Plus, RotateCcw, Pencil, ChevronDown, ChevronRight, Lock, Unlock, Users, CopyPlus } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

// Bundle G — ONE combined-endpoint widget board. Accessible non-drag controls.
export const RcWidgetBoard = ({ centerId }) => {
  const [board, setBoard] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => {
    apiClient.get(`/responsibility-center/${centerId}/dashboard-widgets`)
      .then((r) => setBoard(r.data)).catch(() => {});
  }, [centerId]);
  useEffect(() => { load(); }, [load]);
  if (!board) return null;

  const save = async (layout, scope = "user") => {
    try {
      await apiClient.put(`/responsibility-center/${centerId}/widget-layout`,
        { scope, layout, expected_version: scope === "user" && board.scope === "user" ? board.version : undefined });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save your layout");
      load();
    }
  };
  const layout = board.widgets.map((w) => ({ widget_key: w.widget_key, collapsed: w.collapsed,
    instance_id: w.instance_id, title: w.title !== w.name ? w.title : undefined,
    locked: w.locked, roles: w.roles }));
  const canManage = !!board.can_set_center_default;
  const move = (i, dir) => {
    const next = [...layout];
    const [it] = next.splice(i, 1);
    next.splice(i + dir, 0, it);
    save(next);
  };
  const remove = (i) => save(layout.filter((_, x) => x !== i));
  const add = (key) => save([...layout, { widget_key: key }]);
  const collapse = (i) => save(layout.map((s, x) => (x === i ? { ...s, collapsed: !s.collapsed } : s)));
  const rename = (i) => {
    const t = window.prompt("Widget name:", board.widgets[i].title || board.widgets[i].name);
    if (t !== null) save(layout.map((s, x) => (x === i ? { ...s, title: t.trim() || undefined } : s)));
  };
  const duplicate = (i) => save([...layout.slice(0, i + 1), { ...layout[i], instance_id: undefined,
    title: (board.widgets[i].title || board.widgets[i].name) + " copy" }, ...layout.slice(i + 1)]);
  const toggleLock = (i) => save(layout.map((s, x) => (x === i ? { ...s, locked: !s.locked } : s)));
  const cycleRoles = (i) => {
    const opts = [[], ["owner", "admin"], ["owner", "admin", "manager"], ["member"]];
    const cur = JSON.stringify(layout[i].roles || []);
    const idx = opts.findIndex((o) => JSON.stringify(o) === cur);
    save(layout.map((s, x) => (x === i ? { ...s, roles: opts[(idx + 1) % opts.length] } : s)));
  };
  const reset = async () => {
    await apiClient.delete(`/responsibility-center/${centerId}/widget-layout?scope=user`);
    toast.success("Layout reset to the Center default");
    load();
  };
  const setCenterDefault = () => save(layout, "center_default").then(() => toast.success("Saved as the Center default layout"));
  const inUse = new Set(layout.map((s) => s.widget_key));

  const Body = ({ w }) => {
    const d = w.data || {};
    if (d.error) return <div className="text-xs" style={{ color: "var(--text-muted)" }}>Couldn't load right now.</div>;
    if (w.widget_key === "center_status") return <div className="text-sm">Status <b className="uppercase">{d.status}</b> · {d.members} members · {d.open_items} open items</div>;
    if (w.widget_key === "my_work") return <div className="text-sm">{d.open} open · {d.completed_7d} completed this week</div>;
    if (w.widget_key === "pending_approvals") return <div className="text-sm">{d.count} awaiting your review</div>;
    if (w.widget_key === "unit_summary") return <div className="text-sm">{d.active_units} active groups · you're in {d.my_units}</div>;
    if (w.widget_key === "vault_balance") return (
      <div className="text-sm">{(d.vault_balance ?? 0).toLocaleString()} 🔥 stored{d.frozen ? " · FROZEN" : ""}
        <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Long-term storage for engagement resources — never money.</div>
      </div>);
    if (w.widget_key === "member_summary") return <div className="text-sm">{Object.entries(d).map(([k, v]) => `${v} ${k}`).join(" · ") || "No members"}</div>;
    if (w.widget_key === "attendance_summary") return (
      <div className="text-sm">{d.present_30d}/{d.events_marked_30d} attended (30d) · streak {d.current_streak}
        <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{d.note}</div>
      </div>);
    if (w.widget_key === "recent_activity") return (
      <div>{(d.entries || []).map((e, i) => <div key={i} className="text-xs py-0.5 truncate" style={{ color: "var(--text-muted)" }}>{e.detail || e.action}</div>)
        }{!(d.entries || []).length && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No recent activity.</div>}</div>);
    if (d.items) return (
      <div>{d.items.map((it) => <div key={it.id} className="text-xs py-0.5 truncate">{it.title} · {fmt(it.due_at)}</div>)
        }{!d.items.length && <div className="text-xs" style={{ color: "var(--text-muted)" }}>Nothing here — you're clear.</div>}</div>);
    if (d.events) return (
      <div>{d.events.map((e) => <div key={e.id} className="text-xs py-0.5 truncate">{e.title} · {fmt(e.start_at)}</div>)
        }{!d.events.length && <div className="text-xs" style={{ color: "var(--text-muted)" }}>Nothing scheduled.</div>}</div>);
    return null;
  };

  return (
    <div className="mb-4" data-testid="rc-widget-board">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Dashboard</span>
        <div className="flex items-center gap-1.5">
          {editing && <button className="or-btn or-btn-ghost text-xs" onClick={reset} data-testid="rc-widgets-reset"><RotateCcw size={11} /> Reset</button>}
          {editing && board.can_set_center_default && (
            <button className="or-btn or-btn-ghost text-xs" onClick={setCenterDefault} data-testid="rc-widgets-set-default">Set Center default</button>
          )}
          <button className="or-chip" data-active={editing} onClick={() => setEditing((v) => !v)} data-testid="rc-widgets-edit"><Pencil size={11} /> {editing ? "Done" : "Customize"}</button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {board.widgets.map((w, i) => (
          <div key={w.instance_id || `${w.widget_key}-${i}`} className="or-surface p-3" data-testid={`rc-widget-${w.widget_key}`}>
            <div className="flex items-center justify-between mb-1">
              <button className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1"
                onClick={() => collapse(i)} data-testid={`rc-widget-collapse-${w.widget_key}`}>
                {w.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}{w.title || w.name}
                {w.locked && <Lock size={9} style={{ color: "var(--text-muted)" }} />}
                {(w.roles || []).length > 0 && <span className="text-[8px] px-1 rounded" style={{ background: "rgba(194,107,255,0.15)", color: "#C26BFF" }}>{w.roles.join("/")}</span>}
              </button>
              {editing && (
                <span className="flex items-center gap-0.5">
                  {(!w.locked || canManage) && (<>
                    <button className="p-0.5" onClick={() => rename(i)} aria-label="Rename" title="Rename" data-testid={`rc-widget-rename-${w.widget_key}`}><Pencil size={11} /></button>
                    <button className="p-0.5" onClick={() => duplicate(i)} aria-label="Duplicate" title="Duplicate" data-testid={`rc-widget-duplicate-${w.widget_key}`}><CopyPlus size={11} /></button>
                    <button className="p-0.5" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" data-testid={`rc-widget-up-${w.widget_key}`}><ArrowUp size={12} /></button>
                    <button className="p-0.5" onClick={() => move(i, 1)} disabled={i === board.widgets.length - 1} aria-label="Move down" data-testid={`rc-widget-down-${w.widget_key}`}><ArrowDown size={12} /></button>
                    <button className="p-0.5" onClick={() => remove(i)} aria-label="Remove" data-testid={`rc-widget-remove-${w.widget_key}`}><X size={12} /></button>
                  </>)}
                  {canManage && (<>
                    <button className="p-0.5" onClick={() => toggleLock(i)} aria-label="Lock" title={w.locked ? "Unlock" : "Lock"} data-testid={`rc-widget-lock-${w.widget_key}`}>
                      {w.locked ? <Unlock size={11} /> : <Lock size={11} />}</button>
                    <button className="p-0.5" onClick={() => cycleRoles(i)} aria-label="Role visibility" title="Cycle role visibility (everyone → owners/admins → managers+ → members)" data-testid={`rc-widget-roles-${w.widget_key}`}><Users size={11} /></button>
                  </>)}
                </span>
              )}
            </div>
            {!w.collapsed && <Body w={w} />}
          </div>
        ))}
      </div>
      {editing && (
        <div className="flex flex-wrap gap-1.5 mt-2" data-testid="rc-widget-add-row">
          {board.available_widgets.filter((a) => !inUse.has(a.widget_key)).map((a) => (
            <button key={a.widget_key} className="or-chip" onClick={() => add(a.widget_key)} data-testid={`rc-widget-add-${a.widget_key}`}>
              <Plus size={11} /> {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
