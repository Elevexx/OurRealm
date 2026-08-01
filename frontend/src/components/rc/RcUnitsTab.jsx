import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ChevronRight, ChevronDown, Users, Archive, ArchiveRestore, Pencil, ArrowUp, ArrowDown, Search, FolderTree, List } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const uuid = () =>
  (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const UNIT_TYPES = [
  ["group", "Group"], ["department", "Department"], ["division", "Division"],
  ["class", "Class"], ["grade", "Grade"], ["team", "Team"], ["committee", "Committee"],
  ["ministry", "Ministry"], ["household", "Household"], ["project", "Project Group"],
  ["club", "Club"], ["shift", "Shift"], ["volunteer", "Volunteer Group"], ["custom", "Custom"],
];
const TYPE_LABEL = Object.fromEntries(UNIT_TYPES);

// Groups tab — universal unit hierarchy (tree + list), create/edit,
// member management, archive/restore. No drag-and-drop required.
export const RcUnitsTab = ({ centerId, data }) => {
  const [payload, setPayload] = useState(null);
  const [view, setView] = useState("tree");
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [modal, setModal] = useState(null); // {mode:'create'|'edit', unit?}
  const [membersFor, setMembersFor] = useState(null); // unit

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/units`,
        { params: { include_archived: showArchived } });
      setPayload(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load groups");
    }
  }, [centerId, showArchived]);
  useEffect(() => { load(); }, [load]);

  const units = useMemo(() => payload?.units || [], [payload]);
  const byParent = useMemo(() => {
    const m = {};
    units.forEach((u) => { (m[u.parent_id || ""] = m[u.parent_id || ""] || []).push(u); });
    Object.values(m).forEach((arr) => arr.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)));
    return m;
  }, [units]);

  const filtered = q
    ? units.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())
      || (TYPE_LABEL[u.unit_type] || "").toLowerCase().includes(q.toLowerCase()))
    : null;

  const move = async (unit, dir) => {
    const siblings = byParent[unit.parent_id || ""] || [];
    const idx = siblings.findIndex((s) => s.id === unit.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    try {
      await apiClient.patch(`/responsibility-center/${centerId}/units/${unit.id}`, { sort_order: idx + dir });
      await apiClient.patch(`/responsibility-center/${centerId}/units/${swap.id}`, { sort_order: idx });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not reorder"); }
  };

  const setStatus = async (unit, status) => {
    const verb = status === "archived" ? "Archive" : "Restore";
    if (status === "archived" && !window.confirm(`${verb} "${unit.name}"? New activity stops; history is preserved.`)) return;
    try {
      await apiClient.patch(`/responsibility-center/${centerId}/units/${unit.id}`, { status });
      toast.success(`${verb}d`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || `${verb} failed`); }
  };

  const canManage = payload?.can_manage;

  const flatTree = useMemo(() => {
    const out = [];
    const stack = [...(byParent[""] || [])].reverse().map((u) => ({ u, depth: 0 }));
    while (stack.length) {
      const { u, depth } = stack.pop();
      out.push({ u, depth });
      if (!collapsed[u.id]) {
        [...(byParent[u.id] || [])].reverse().forEach((k) => stack.push({ u: k, depth: depth + 1 }));
      }
    }
    return out;
  }, [byParent, collapsed]);

  const Row = ({ u, depth = 0 }) => {
    const kids = byParent[u.id] || [];
    const isCollapsed = collapsed[u.id];
    return (
      <div>
        <div className="flex items-center gap-2 py-2 flex-wrap" data-testid={`rc-unit-row-${u.id}`}
          style={{ paddingLeft: depth * 18, borderBottom: "1px solid rgba(255,255,255,0.06)", opacity: u.status === "archived" ? 0.55 : 1 }}>
          <button className="p-0.5 shrink-0" onClick={() => setCollapsed((c) => ({ ...c, [u.id]: !c[u.id] }))}
            style={{ visibility: kids.length ? "visible" : "hidden" }} aria-label="Toggle children" data-testid={`rc-unit-toggle-${u.id}`}>
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold truncate">{u.name}</span>
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ background: "rgba(90,178,255,0.12)", color: "#5AB2FF" }}>{TYPE_LABEL[u.unit_type] || u.unit_type}</span>
              {u.status === "archived" && <span className="text-[10px] uppercase" style={{ color: "#FF8A5A" }}>Archived</span>}
              {u.is_mine && <span className="text-[10px] uppercase" style={{ color: "#7BD88F" }}>Mine</span>}
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {u.leader_username ? <>Leader @{u.leader_username} · </> : null}
              {u.member_count} member{u.member_count === 1 ? "" : "s"} · {u.open_items} open item{u.open_items === 1 ? "" : "s"}
              {kids.length ? <> · {kids.length} sub-unit{kids.length === 1 ? "" : "s"}</> : null}
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-1 shrink-0">
              <button className="or-btn or-btn-ghost p-1.5" title="Move up" onClick={() => move(u, -1)} data-testid={`rc-unit-up-${u.id}`}><ArrowUp size={13} /></button>
              <button className="or-btn or-btn-ghost p-1.5" title="Move down" onClick={() => move(u, 1)} data-testid={`rc-unit-down-${u.id}`}><ArrowDown size={13} /></button>
              <button className="or-btn or-btn-ghost p-1.5" title="Members" onClick={() => setMembersFor(u)} data-testid={`rc-unit-members-${u.id}`}><Users size={13} /></button>
              <button className="or-btn or-btn-ghost p-1.5" title="Edit" onClick={() => setModal({ mode: "edit", unit: u })} data-testid={`rc-unit-edit-${u.id}`}><Pencil size={13} /></button>
              {u.status === "active"
                ? <button className="or-btn or-btn-ghost p-1.5" title="Archive" onClick={() => setStatus(u, "archived")} data-testid={`rc-unit-archive-${u.id}`}><Archive size={13} /></button>
                : <button className="or-btn or-btn-ghost p-1.5" title="Restore" onClick={() => setStatus(u, "active")} data-testid={`rc-unit-restore-${u.id}`}><ArchiveRestore size={13} /></button>}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="rc-tab-groups">
      <div className="or-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide">{payload?.unit_label || "Groups"} ({units.length})</h3>
          <div className="flex items-center gap-2">
            <button className="or-chip" data-active={view === "tree"} onClick={() => setView("tree")} data-testid="rc-units-view-tree"><FolderTree size={12} /> Tree</button>
            <button className="or-chip" data-active={view === "list"} onClick={() => setView("list")} data-testid="rc-units-view-list"><List size={12} /> List</button>
            <button className="or-chip" data-active={showArchived} onClick={() => setShowArchived((v) => !v)} data-testid="rc-units-show-archived">Archived</button>
            {canManage && (
              <button className="or-btn or-btn-primary" onClick={() => setModal({ mode: "create" })} data-testid="rc-unit-create-btn">
                <Plus size={14} /> Create
              </button>
            )}
          </div>
        </div>
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <input className="or-input w-full pl-8" placeholder="Search groups…" value={q}
            onChange={(e) => setQ(e.target.value)} data-testid="rc-units-search" />
        </div>
        {!payload && <div className="text-sm py-4" style={{ color: "var(--text-muted)" }}>Loading…</div>}
        {payload && units.length === 0 && (
          <div className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }} data-testid="rc-units-empty">
            No groups yet.{canManage ? " Create the first department, class, or team." : ""}
          </div>
        )}
        {filtered
          ? filtered.map((u) => <Row key={u.id} u={u} />)
          : view === "tree"
            ? flatTree.map(({ u, depth }) => <Row key={u.id} u={u} depth={depth} />)
            : units.map((u) => <Row key={u.id} u={u} />)}
      </div>

      {modal && (
        <UnitModal centerId={centerId} units={units} members={data?.members || []}
          unit={modal.unit} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
      {membersFor && (
        <UnitMembersModal centerId={centerId} unit={membersFor} centerMembers={data?.members || []}
          onClose={() => { setMembersFor(null); load(); }} />
      )}
    </div>
  );
};

function UnitModal({ centerId, units, members, unit, onClose, onSaved }) {
  const isEdit = !!unit;
  const [form, setForm] = useState({
    name: unit?.name || "", unit_type: unit?.unit_type || "group",
    description: unit?.description || "", parent_id: unit?.parent_id || "",
    leader_id: unit?.leader_id || "", visibility: unit?.visibility || "center",
    member_ids: [],
  });
  const [token] = useState(uuid());
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) { toast.error("A name is required"); return; }
    setBusy(true);
    try {
      if (isEdit) {
        await apiClient.patch(`/responsibility-center/${centerId}/units/${unit.id}`, {
          name: form.name, unit_type: form.unit_type, description: form.description,
          parent_id: form.parent_id || null, leader_id: form.leader_id || null,
          visibility: form.visibility,
        });
      } else {
        await apiClient.post(`/responsibility-center/${centerId}/units`, {
          ...form, parent_id: form.parent_id || null, leader_id: form.leader_id || null,
          client_token: token,
        });
      }
      toast.success(isEdit ? "Group updated" : "Group created");
      onSaved();
    } catch (e) {
      toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Save failed");
    } finally { setBusy(false); }
  };
  const parentOptions = units.filter((u) => u.status === "active" && u.id !== unit?.id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose} data-testid="rc-unit-modal">
      <div className="or-surface w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-3">{isEdit ? "Edit group" : "Create a group"}</h3>
        <label className="text-xs block mb-2">Name
          <input className="or-input w-full mt-1" value={form.name} maxLength={80}
            onChange={(e) => set("name", e.target.value)} data-testid="rc-unit-name-input" />
        </label>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-xs">Type
            <select className="or-input w-full mt-1" value={form.unit_type} onChange={(e) => set("unit_type", e.target.value)} data-testid="rc-unit-type-select">
              {UNIT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs">Visibility
            <select className="or-input w-full mt-1" value={form.visibility} onChange={(e) => set("visibility", e.target.value)} data-testid="rc-unit-visibility-select">
              <option value="center">Whole Center</option>
              <option value="unit">Unit members only</option>
              <option value="leaders">Leaders & managers only</option>
            </select>
          </label>
        </div>
        <label className="text-xs block mb-2">Parent unit (max 5 levels)
          <select className="or-input w-full mt-1" value={form.parent_id} onChange={(e) => set("parent_id", e.target.value)} data-testid="rc-unit-parent-select">
            <option value="">None (top level)</option>
            {parentOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="text-xs block mb-2">Leader
          <select className="or-input w-full mt-1" value={form.leader_id} onChange={(e) => set("leader_id", e.target.value)} data-testid="rc-unit-leader-select">
            <option value="">No leader</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>@{m.username}</option>)}
          </select>
        </label>
        <label className="text-xs block mb-3">Description
          <textarea className="or-input w-full mt-1" rows={2} value={form.description} maxLength={1000}
            onChange={(e) => set("description", e.target.value)} data-testid="rc-unit-desc-input" />
        </label>
        {!isEdit && (
          <div className="mb-3">
            <div className="text-xs mb-1">Add members now (optional)</div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <button key={m.user_id} className="or-chip" data-active={form.member_ids.includes(m.user_id)}
                  onClick={() => set("member_ids", form.member_ids.includes(m.user_id)
                    ? form.member_ids.filter((x) => x !== m.user_id) : [...form.member_ids, m.user_id])}
                  data-testid={`rc-unit-member-chip-${m.username}`}>@{m.username}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="or-btn or-btn-ghost" onClick={onClose} data-testid="rc-unit-modal-cancel">Cancel</button>
          <button className="or-btn or-btn-primary" disabled={busy} onClick={save} data-testid="rc-unit-modal-save">
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnitMembersModal({ centerId, unit, centerMembers, onClose }) {
  const [detail, setDetail] = useState(null);
  const [addId, setAddId] = useState("");
  const [addRole, setAddRole] = useState("member");
  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/units/${unit.id}`);
      setDetail(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not load members"); }
  }, [centerId, unit.id]);
  useEffect(() => { load(); }, [load]);
  const inUnit = new Set((detail?.members || []).map((m) => m.user_id));
  const addable = centerMembers.filter((m) => !inUnit.has(m.user_id));
  const add = async () => {
    if (!addId) return;
    try {
      await apiClient.post(`/responsibility-center/${centerId}/units/${unit.id}/members`,
        { user_id: addId, unit_role: addRole });
      setAddId(""); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not add member"); }
  };
  const remove = async (uid) => {
    try {
      await apiClient.delete(`/responsibility-center/${centerId}/units/${unit.id}/members/${uid}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not remove member"); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose} data-testid="rc-unit-members-modal">
      <div className="or-surface w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-1">{unit.name} — members</h3>
        <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Only active Center members can join a unit.</div>
        {(detail?.members || []).map((m) => (
          <div key={m.user_id} className="flex items-center justify-between gap-2 py-1.5 text-sm"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid={`rc-unit-member-row-${m.username}`}>
            <span>@{m.username} <span className="text-[10px] uppercase ml-1" style={{ color: m.unit_role === "leader" ? "#F4C84A" : "var(--text-muted)" }}>{m.unit_role}</span></span>
            <button className="or-btn or-btn-ghost text-xs" onClick={() => remove(m.user_id)} data-testid={`rc-unit-member-remove-${m.username}`}>Remove</button>
          </div>
        ))}
        {(detail?.members || []).length === 0 && detail && <div className="text-sm py-2" style={{ color: "var(--text-muted)" }}>No members yet.</div>}
        {detail?.me?.can_manage && addable.length > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <select className="or-input flex-1" value={addId} onChange={(e) => setAddId(e.target.value)} data-testid="rc-unit-member-add-select">
              <option value="">Add a member…</option>
              {addable.map((m) => <option key={m.user_id} value={m.user_id}>@{m.username}</option>)}
            </select>
            <select className="or-input" value={addRole} onChange={(e) => setAddRole(e.target.value)} data-testid="rc-unit-member-role-select">
              <option value="member">Member</option>
              <option value="assistant">Assistant</option>
              <option value="leader">Leader</option>
              <option value="viewer">Viewer</option>
            </select>
            <button className="or-btn or-btn-primary" onClick={add} data-testid="rc-unit-member-add-btn">Add</button>
          </div>
        )}
        <div className="flex justify-end mt-3">
          <button className="or-btn or-btn-ghost" onClick={onClose} data-testid="rc-unit-members-close">Close</button>
        </div>
      </div>
    </div>
  );
}
