/**
 * AdminUserControlWidget — search users + suspend/unsuspend/delete +
 * mute/unmute. Mounted at the top of /support, hidden unless the
 * viewer is an admin (`isAdmin(user)`).
 *
 * Server enforces every gate — this UI is purely a convenience. The
 * widget reuses the existing `or-surface` / `or-btn` / `or-input` /
 * `or-chip` design tokens so it visually slots into the support
 * dashboard without touching shared design files.
 */
import React, { useState } from "react";
import {
  ShieldAlert, Search, Loader2, X, Pause, Play, Trash2,
  MicOff, Check, Clock, ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";

const PRESETS = [1, 3, 7, 14, 30];
const MUTE_TYPES = ["thoughts", "sounds", "videos", "links", "images", "comments", "messages"];

export default function AdminUserControlWidget() {
  const { user } = useAuth();
  const canDelete = !!user && (
    (user.username || "").toLowerCase() === "stealth" ||
    (user.admin_role || "") === "support_admin"
  );

  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);

  // Hooks above — visibility gate below so hook order stays stable.
  if (!isAdmin(user)) return null;

  const search = async (e) => {
    e?.preventDefault?.();
    const term = q.trim();
    if (!term) return;
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.get("/admin/users/search", { params: { q: term, limit: 10 } });
      setResults(data.users || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Search failed");
    } finally { setBusy(false); }
  };

  return (
    <section className="or-surface p-4 mb-5" data-testid="admin-user-control-widget">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 mb-2" data-testid="admin-user-control-toggle">
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        <ShieldAlert size={16} style={{ color: "#FF8080" }} />
        <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "#FF8080" }}>User Account Control</h3>
        <span className="ml-auto text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: "rgba(255,128,128,0.15)", color: "#FF8080" }}>Admin</span>
      </button>
      {open && (
        <>
          <form onSubmit={search} className="flex items-center gap-2 mb-3">
            <div className="flex-1 relative">
              <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--text-muted)" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by username, name, email, or ID…"
                className="or-input"
                style={{ paddingLeft: 30 }}
                data-testid="admin-user-search-input"
              />
            </div>
            <button type="submit" className="or-btn" disabled={busy || !q.trim()} data-testid="admin-user-search-submit">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search
            </button>
          </form>
          {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }} data-testid="admin-user-control-error">{err}</div>}
          {results.length === 0 ? (
            <div className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }} data-testid="admin-user-search-empty">
              No results yet — type a query above.
            </div>
          ) : (
            <ul className="space-y-3" data-testid="admin-user-search-results">
              {results.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  canDelete={canDelete}
                  onChanged={(updated) =>
                    setResults((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}


// ─── User row ────────────────────────────────────────────────────────
function UserRow({ user, canDelete, onChanged }) {
  const [section, setSection] = useState(null); // 'suspend' | 'mute' | 'delete' | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const isSuspended = !!user.suspended_until;
  const activeMutes = (user.mutes || []).filter((m) => m.active);

  const refresh = async () => {
    try {
      const { data } = await apiClient.get("/admin/users/search", { params: { q: user.id } });
      const u = (data.users || []).find((x) => x.id === user.id);
      if (u) onChanged(u);
    } catch { /* */ }
  };

  const unsuspend = async () => {
    if (!window.confirm(`Lift suspension on @${user.username}?`)) return;
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post(`/admin/users/${user.id}/unsuspend`);
      onChanged(data.user);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const clearAllMutes = async () => {
    if (!window.confirm(`Clear ALL mutes on @${user.username}?`)) return;
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post(`/admin/users/${user.id}/unmute`, { clear_all: true });
      onChanged(data.user);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const removeMute = async (muteId) => {
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post(`/admin/users/${user.id}/unmute`, { mute_id: muteId });
      onChanged(data.user);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  return (
    <li className="p-3 rounded-md" style={{ background: "color-mix(in srgb, var(--primary) 4%, transparent)", border: "1px solid var(--border-col)" }} data-testid={`admin-user-row-${user.id}`}>
      <div className="flex items-start gap-3">
        <img src={user.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full shrink-0" style={{ width: 38, height: 38 }} />
        <div className="flex-1 min-w-0">
          <div className="font-bold flex items-center gap-2 flex-wrap" style={{ color: "var(--text-main)" }}>
            <span className="truncate">{user.display_name || user.username}</span>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>@{user.username}</span>
            {user.is_system && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: "rgba(244,200,74,0.2)", color: "#F4C84A" }}>System</span>}
            {user.is_protected && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,128,128,0.2)", color: "#FF8080" }}>Protected</span>}
            {user.admin_role && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: "rgba(110,213,255,0.2)", color: "#6BD3FF" }}>{user.admin_role}</span>}
            {isSuspended && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,128,128,0.2)", color: "#FF8080" }}>Suspended</span>}
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {user.email && <span>{user.email} · </span>}
            <span>id {user.id?.slice(0, 8)}</span>
          </div>
          {isSuspended && (
            <div className="text-[11px] mt-1" style={{ color: "#FF8080" }} data-testid={`admin-user-suspended-${user.id}`}>
              <Clock size={10} className="inline" /> Suspended until {new Date(user.suspended_until).toLocaleString()}
              {user.suspension_reason ? ` — ${user.suspension_reason}` : ""}
            </div>
          )}
          {activeMutes.length > 0 && (
            <div className="text-[11px] mt-1" data-testid={`admin-user-mutes-${user.id}`}>
              <span style={{ color: "#F4C84A" }}><MicOff size={10} className="inline" /> Muted:</span>
              {activeMutes.map((m) => (
                <span key={m.id} className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: "rgba(244,200,74,0.16)", color: "#F4C84A" }}>
                  {m.permanent ? "PERM" : new Date(m.until).toLocaleDateString()} · {m.types.join(",")}
                  <button onClick={() => removeMute(m.id)} className="opacity-70 hover:opacity-100" data-testid={`admin-user-mute-remove-${m.id}`}><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {!isSuspended ? (
          <button onClick={() => setSection(section === "suspend" ? null : "suspend")} className="or-chip" data-testid={`admin-user-suspend-btn-${user.id}`}><Pause size={12} /> Suspend</button>
        ) : (
          <button onClick={unsuspend} disabled={busy} className="or-chip" data-testid={`admin-user-unsuspend-btn-${user.id}`}><Play size={12} /> Unsuspend</button>
        )}
        <button onClick={() => setSection(section === "mute" ? null : "mute")} className="or-chip" data-testid={`admin-user-mute-btn-${user.id}`}><MicOff size={12} /> Mute</button>
        {activeMutes.length > 0 && (
          <button onClick={clearAllMutes} disabled={busy} className="or-chip" data-testid={`admin-user-clear-mutes-${user.id}`}><X size={12} /> Clear mutes</button>
        )}
        {canDelete && (
          <button onClick={() => setSection(section === "delete" ? null : "delete")} className="or-chip" style={{ color: "#FF8080", borderColor: "rgba(255,128,128,0.4)" }} data-testid={`admin-user-delete-btn-${user.id}`}><Trash2 size={12} /> Delete</button>
        )}
      </div>

      {err && <div className="text-sm mt-2" style={{ color: "#FF8080" }}>{err}</div>}

      {section === "suspend" && (
        <SuspendForm user={user} onDone={(u) => { onChanged(u); setSection(null); }} setBusy={setBusy} setErr={setErr} />
      )}
      {section === "mute" && (
        <MuteForm user={user} onDone={(u) => { onChanged(u); setSection(null); }} setBusy={setBusy} setErr={setErr} />
      )}
      {section === "delete" && canDelete && (
        <DeleteForm user={user} onDone={() => { setSection(null); refresh(); }} setBusy={setBusy} setErr={setErr} />
      )}
    </li>
  );
}


// ─── Sub-forms ──────────────────────────────────────────────────────
function SuspendForm({ user, onDone, setBusy, setErr }) {
  const [preset, setPreset] = useState(7);
  const [customDays, setCustomDays] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    const days = preset === "custom" ? parseInt(customDays || "0", 10) : preset;
    if (!days || days < 1) { setErr("Days must be ≥ 1"); return; }
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post(`/admin/users/${user.id}/suspend`, { days, reason, notes });
      onDone(data.user);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to suspend");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 p-3 rounded" style={{ background: "var(--surface-2)" }} data-testid={`admin-user-suspend-form-${user.id}`}>
      <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Duration</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => setPreset(p)} data-active={preset === p} className="or-chip" data-testid={`admin-user-suspend-preset-${p}`}>{p}d</button>
        ))}
        <button onClick={() => setPreset("custom")} data-active={preset === "custom"} className="or-chip" data-testid="admin-user-suspend-preset-custom">Custom</button>
        {preset === "custom" && (
          <input
            type="number"
            min="1"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            placeholder="days"
            className="or-input"
            style={{ width: 80 }}
            data-testid={`admin-user-suspend-days-${user.id}`}
          />
        )}
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={400}
        placeholder="Public reason (shown to user, optional)"
        className="or-input mb-2 text-sm"
        data-testid={`admin-user-suspend-reason-${user.id}`}
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        placeholder="Private admin notes (never shown to user)"
        rows={2}
        className="or-input mb-2 text-sm"
        data-testid={`admin-user-suspend-notes-${user.id}`}
      />
      <button onClick={submit} className="or-btn" data-testid={`admin-user-suspend-submit-${user.id}`}><Pause size={14} /> Confirm Suspend</button>
    </div>
  );
}

function MuteForm({ user, onDone, setBusy, setErr }) {
  const [types, setTypes] = useState([]);
  const [all, setAll] = useState(false);
  const [preset, setPreset] = useState(7);
  const [customDays, setCustomDays] = useState("");
  const [permanent, setPermanent] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const toggle = (t) => setTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const submit = async () => {
    const useTypes = all ? ["all"] : types;
    if (!useTypes.length) { setErr("Pick at least one content type"); return; }
    const days = preset === "custom" ? parseInt(customDays || "0", 10) : preset;
    if (!permanent && (!days || days < 1)) { setErr("Days must be ≥ 1 or pick Permanent"); return; }
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post(`/admin/users/${user.id}/mute`, {
        types: useTypes,
        days: permanent ? undefined : days,
        permanent,
        reason,
        notes,
      });
      onDone(data.user);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to mute");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 p-3 rounded" style={{ background: "var(--surface-2)" }} data-testid={`admin-user-mute-form-${user.id}`}>
      <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Content types</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <label className="or-chip cursor-pointer">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid={`admin-user-mute-type-all-${user.id}`} /> All
        </label>
        {!all && MUTE_TYPES.map((t) => (
          <label key={t} className="or-chip cursor-pointer">
            <input type="checkbox" checked={types.includes(t)} onChange={() => toggle(t)} data-testid={`admin-user-mute-type-${t}-${user.id}`} /> {t}
          </label>
        ))}
      </div>
      <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Duration</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => { setPermanent(false); setPreset(p); }} data-active={!permanent && preset === p} className="or-chip" data-testid={`admin-user-mute-preset-${p}`}>{p}d</button>
        ))}
        <button onClick={() => { setPermanent(false); setPreset("custom"); }} data-active={!permanent && preset === "custom"} className="or-chip" data-testid="admin-user-mute-preset-custom">Custom</button>
        {!permanent && preset === "custom" && (
          <input type="number" min="1" value={customDays} onChange={(e) => setCustomDays(e.target.value)} placeholder="days" className="or-input" style={{ width: 80 }} data-testid={`admin-user-mute-days-${user.id}`} />
        )}
        <button onClick={() => setPermanent(true)} data-active={permanent} className="or-chip" style={{ color: "#FF8080", borderColor: "rgba(255,128,128,0.4)" }} data-testid="admin-user-mute-preset-permanent">Permanent</button>
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} placeholder="Reason (optional)" className="or-input mb-2 text-sm" data-testid={`admin-user-mute-reason-${user.id}`} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Private admin notes (never shown to user)" rows={2} className="or-input mb-2 text-sm" data-testid={`admin-user-mute-notes-${user.id}`} />
      <button onClick={submit} className="or-btn" data-testid={`admin-user-mute-submit-${user.id}`}><MicOff size={14} /> Confirm Mute</button>
    </div>
  );
}

function DeleteForm({ user, onDone, setBusy, setErr }) {
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const match = confirm.trim().toLowerCase() === (user.username || "").toLowerCase();

  const submit = async () => {
    if (!match) { setErr("Username confirmation does not match"); return; }
    if (!window.confirm(`This will hard-disable @${user.username}. This action cannot be undone. Continue?`)) return;
    setBusy(true); setErr("");
    try {
      await apiClient.post(`/admin/users/${user.id}/delete`, { confirm_username: confirm, reason });
      onDone();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to delete");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 p-3 rounded" style={{ background: "color-mix(in srgb, #FF8080 8%, transparent)", border: "1px solid rgba(255,128,128,0.4)" }} data-testid={`admin-user-delete-form-${user.id}`}>
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle size={14} style={{ color: "#FF8080" }} />
        <p className="text-xs" style={{ color: "#FF8080" }}>
          This action <b>cannot be undone</b>. The account will be hard-disabled, scrubbed from public surfaces, and all active sessions invalidated. Audit logs are preserved.
        </p>
      </div>
      <label className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Type the username to confirm: <b style={{ color: "#FF8080" }}>{user.username}</b></label>
      <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={user.username} className="or-input mb-2 text-sm" data-testid={`admin-user-delete-confirm-${user.id}`} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="or-input mb-2 text-sm" data-testid={`admin-user-delete-reason-${user.id}`} />
      <button onClick={submit} disabled={!match} className="or-btn" style={{ background: match ? "#FF8080" : undefined, color: match ? "#fff" : undefined }} data-testid={`admin-user-delete-submit-${user.id}`}>
        <Trash2 size={14} /> {match ? "Delete account" : "Type username to confirm"}
      </button>
    </div>
  );
}
