/**
 * AdminPasswordResetWidget — founder-only widget on /support.
 *
 * Flow:
 *   1. Search for a user (re-uses /api/admin/users/search).
 *   2. Pick from results.
 *   3. Type new password + confirm. Optional "force change on next login".
 *   4. POST /api/admin/users/:id/reset-password.
 *
 * The backend enforces the founder-only gate, validates password
 * strength, hashes with bcrypt, and bumps `password_changed_at` so
 * every existing access token for the target user instantly becomes
 * invalid (see core/deps.get_current_user).
 *
 * This widget is hidden from anyone whose front-end role is not
 * founder. The backend remains the source of truth.
 */
import React, { useState } from "react";
import {
  KeyRound, Search, Loader2, AlertTriangle, Eye, EyeOff,
  ChevronDown, ChevronUp, Check, X,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

export default function AdminPasswordResetWidget() {
  const { user } = useAuth();
  const isFounder = !!user && (user.username || "").toLowerCase() === "stealth";

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [forceChange, setForceChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  // Hooks above — visibility gate below so hook order stays stable.
  if (!isFounder) return null;

  const search = async (e) => {
    e?.preventDefault?.();
    setErr(""); setDone(false);
    if (!q.trim()) return;
    setBusy(true);
    try {
      const { data } = await apiClient.get("/admin/users/search", { params: { q: q.trim(), limit: 10 } });
      setResults(data.users || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Search failed");
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setErr(""); setDone(false);
    if (!picked) { setErr("Pick a user from the results first."); return; }
    if (pw1.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw1 !== pw2) { setErr("Passwords do not match."); return; }
    if (!window.confirm(`Reset password for @${picked.username}? Existing sessions will be terminated.`)) return;
    setBusy(true);
    try {
      await apiClient.post(`/admin/users/${picked.id}/reset-password`, {
        new_password: pw1,
        confirm_password: pw2,
        force_change_on_next_login: forceChange,
      });
      setDone(true);
      setPw1(""); setPw2("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Reset failed");
    } finally { setBusy(false); }
  };

  return (
    <section className="or-surface p-4 mb-5" data-testid="admin-password-reset-widget">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 mb-2" data-testid="admin-password-reset-toggle">
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        <KeyRound size={16} style={{ color: "#F4C84A" }} />
        <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "#F4C84A" }}>Password Reset</h3>
        <span className="ml-auto text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: "rgba(244,200,74,0.18)", color: "#F4C84A" }}>Founder only</span>
      </button>
      {open && (
        <>
          <div className="flex items-start gap-2 mb-3 p-2 rounded" style={{ background: "rgba(244,200,74,0.08)" }}>
            <AlertTriangle size={14} style={{ color: "#F4C84A" }} />
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Resetting a password immediately invalidates every active session for the target user.
              The new password is hashed with bcrypt; the audit log records the action but never the plaintext.
            </p>
          </div>
          <form onSubmit={search} className="flex items-center gap-2 mb-3">
            <div className="flex-1 relative">
              <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--text-muted)" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find user by username, email, or id…"
                className="or-input"
                style={{ paddingLeft: 30 }}
                data-testid="admin-pwreset-search-input"
              />
            </div>
            <button type="submit" className="or-btn" disabled={busy || !q.trim()} data-testid="admin-pwreset-search-submit">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search
            </button>
          </form>

          {results.length > 0 && !picked && (
            <ul className="space-y-1.5 mb-3" data-testid="admin-pwreset-results">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => setPicked(u)}
                    className="w-full flex items-center gap-3 p-2 rounded text-left"
                    style={{ background: "var(--surface-2)" }}
                    data-testid={`admin-pwreset-pick-${u.id}`}
                  >
                    <img src={u.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full" style={{ width: 28, height: 28 }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: "var(--text-main)" }}>{u.display_name || u.username}</div>
                      <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>@{u.username} · {u.email}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {picked && (
            <div className="p-3 rounded mb-3" style={{ background: "var(--surface-2)" }} data-testid="admin-pwreset-picked">
              <div className="flex items-center gap-3 mb-2">
                <img src={picked.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full" style={{ width: 32, height: 32 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate" style={{ color: "var(--text-main)" }}>{picked.display_name || picked.username}</div>
                  <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>@{picked.username}</div>
                </div>
                <button onClick={() => { setPicked(null); setPw1(""); setPw2(""); setDone(false); }} className="or-chip" data-testid="admin-pwreset-clear-pick"><X size={12} /></button>
              </div>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  placeholder="New password"
                  className="or-input mb-2 text-sm"
                  data-testid="admin-pwreset-new"
                  style={{ paddingRight: 36 }}
                />
                <button onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-2" data-testid="admin-pwreset-show-toggle" style={{ color: "var(--text-muted)" }}>
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <input
                type={showPw ? "text" : "password"}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="Confirm new password"
                className="or-input mb-2 text-sm"
                data-testid="admin-pwreset-confirm"
              />
              <label className="flex items-center gap-2 text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                <input type="checkbox" checked={forceChange} onChange={(e) => setForceChange(e.target.checked)} data-testid="admin-pwreset-force-change" />
                Require user to change password on next login.
              </label>
              <button onClick={submit} className="or-btn" disabled={busy || !pw1 || pw1 !== pw2} data-testid="admin-pwreset-submit">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Update Password
              </button>
            </div>
          )}

          {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }} data-testid="admin-pwreset-error">{err}</div>}
          {done && (
            <div className="text-sm flex items-center gap-2" style={{ color: "var(--brand-green)" }} data-testid="admin-pwreset-success">
              <Check size={14} /> Password updated. Existing sessions invalidated.
            </div>
          )}
        </>
      )}
    </section>
  );
}
