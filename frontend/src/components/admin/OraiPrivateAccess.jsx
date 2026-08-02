import React, { useCallback, useEffect, useState } from "react";
import { Lock, Loader2, UserPlus, Trash2, Download, Crown } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

// Founder-only manager for the private floating ORAi assistant.
const CAP_KEYS = [["chat_enabled", "Chat"], ["voice_enabled", "Voice"], ["generation_enabled", "AI Gen"]];

export const OraiPrivateAccess = () => {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState([]);
  const [addUser, setAddUser] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addExpiry, setAddExpiry] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiClient.get("/admin/orai/private-access", { params: { q, status } })
      .then((r) => { setRows(r.data.users); setSelected([]); })
      .catch((e) => toast.error(e?.response?.data?.detail || "Could not load"));
  }, [q, status]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!addUser.trim()) return;
    setBusy(true);
    try {
      await apiClient.post("/admin/orai/private-access", {
        username: addUser.trim(), note: addNote.trim(),
        expires_at: addExpiry ? `${addExpiry}T23:59:59+00:00` : null,
      });
      toast.success(`@${addUser.trim().replace(/^@/, "")} granted private ORAi access`);
      setAddUser(""); setAddNote(""); setAddExpiry("");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not add"); }
    finally { setBusy(false); }
  };

  const remove = async (r) => {
    if (!window.confirm(`Revoke ORAi access for @${r.username} immediately?`)) return;
    try { await apiClient.delete(`/admin/orai/private-access/${r.user_id}`); toast.success("Access revoked"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const bulkRemove = async () => {
    if (!selected.length || !window.confirm(`Revoke access for ${selected.length} user(s)?`)) return;
    try {
      const r = await apiClient.post("/admin/orai/private-access/bulk-remove", { user_ids: selected });
      toast.success(`Revoked ${r.data.removed} grant(s)`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const toggleCap = async (r, key) => {
    try {
      const res = await apiClient.patch(`/admin/orai/private-access/${r.user_id}`, { [key]: !r[key] });
      setRows((prev) => prev.map((x) => (x.user_id === r.user_id ? { ...x, ...res.data.user } : x)));
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const exportList = async () => {
    try {
      const r = await apiClient.get("/admin/orai/private-access/export");
      const blob = new Blob([r.data.csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "orai-private-access.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast.error(e?.response?.data?.detail || "Export failed"); }
  };

  return (
    <div className="orion-section" data-testid="orai-private-access-section">
      <div className="flex items-center gap-2 mb-3">
        <Lock size={18} style={{ color: "#F4A73B" }} />
        <div>
          <div className="text-base font-bold" style={{ fontFamily: "var(--font-display)" }}>Private ORAi Access</div>
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            The floating ORAi assistant is invisible to everyone except @stealth and the users below. Enforced server-side; revocation is instant.
          </div>
        </div>
      </div>

      <div className="or-surface p-3 mb-3" data-testid="orai-access-add-card">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input className="or-input text-xs" placeholder="@username" value={addUser}
            onChange={(e) => setAddUser(e.target.value)} data-testid="orai-access-add-username" />
          <input className="or-input text-xs" placeholder="Note (optional)" value={addNote}
            onChange={(e) => setAddNote(e.target.value)} data-testid="orai-access-add-note" />
          <input className="or-input text-xs" type="date" title="Expiration (optional)" value={addExpiry}
            onChange={(e) => setAddExpiry(e.target.value)} data-testid="orai-access-add-expiry" />
          <button className="or-btn text-xs font-bold" onClick={add} disabled={busy || !addUser.trim()} data-testid="orai-access-add-btn">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Grant Access
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <input className="or-input text-xs flex-1 min-w-[140px]" placeholder="Search username…" value={q}
          onChange={(e) => setQ(e.target.value)} data-testid="orai-access-search" />
        <select className="or-input text-xs" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="orai-access-filter">
          <option value="">All</option><option value="active">Active</option><option value="expired">Expired</option>
        </select>
        <button className="or-btn or-btn-ghost text-[10px]" onClick={exportList} data-testid="orai-access-export">
          <Download size={11} /> Export
        </button>
        {selected.length > 0 && (
          <button className="or-btn text-[10px]" style={{ background: "rgba(255,107,107,0.15)", color: "#FF6B6B" }}
            onClick={bulkRemove} data-testid="orai-access-bulk-remove">
            <Trash2 size={11} /> Revoke {selected.length}
          </button>
        )}
      </div>

      <div className="or-surface p-3" data-testid="orai-access-list">
        <div className="flex items-center gap-2 py-2 text-[11px]" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <Crown size={12} style={{ color: "#F4A73B" }} />
          <b>@stealth</b>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(244,167,59,0.15)", color: "#F4A73B" }}>Founder — permanent</span>
          <span className="ml-auto" style={{ color: "var(--text-muted)" }}>Cannot be removed</span>
        </div>
        {!rows ? <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>
          : rows.length === 0 ? <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>No one else has private ORAi access.</div>
            : rows.map((r) => (
              <div key={r.user_id} className="py-2 text-[11px]" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                data-testid={`orai-access-row-${r.username}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="checkbox" className="accent-[#F4A73B]" checked={selected.includes(r.user_id)}
                    onChange={(e) => setSelected((s) => e.target.checked ? [...s, r.user_id] : s.filter((x) => x !== r.user_id))}
                    data-testid={`orai-access-select-${r.username}`} />
                  <b>@{r.username}</b>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                    style={{ background: r.active ? "rgba(16,230,112,0.15)" : "rgba(255,138,90,0.15)", color: r.active ? "#10E670" : "#FF8A5A" }}>
                    {r.active ? "Active" : "Expired"}
                  </span>
                  {CAP_KEYS.map(([k, label]) => (
                    <button key={k} className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ background: r[k] ? "rgba(46,160,255,0.15)" : "rgba(255,255,255,0.05)",
                               color: r[k] ? "#2EA0FF" : "var(--text-muted)",
                               border: `1px solid ${r[k] ? "rgba(46,160,255,0.4)" : "rgba(255,255,255,0.1)"}` }}
                      onClick={() => toggleCap(r, k)} data-testid={`orai-access-cap-${r.username}-${k}`}>
                      {label} {r[k] ? "✓" : "✕"}
                    </button>
                  ))}
                  <button className="or-btn or-btn-ghost text-[9px] ml-auto" style={{ color: "#FF6B6B" }}
                    onClick={() => remove(r)} data-testid={`orai-access-revoke-${r.username}`}>
                    <Trash2 size={10} /> Revoke
                  </button>
                </div>
                <div className="text-[9.5px] mt-0.5 pl-5" style={{ color: "var(--text-muted)" }}>
                  Granted {r.granted_at?.slice(0, 10)} by @{r.granted_by_username}
                  {r.expires_at ? ` · expires ${r.expires_at.slice(0, 10)}` : " · no expiration"}
                  {r.last_used_at ? ` · last used ${r.last_used_at.slice(0, 16).replace("T", " ")}` : " · never used"}
                  {r.note ? ` · "${r.note}"` : ""}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
};

export default OraiPrivateAccess;
