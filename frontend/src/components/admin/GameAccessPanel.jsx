import React, { useCallback, useEffect, useState } from "react";
import { Shield, Copy, RefreshCcw, History, UserCheck, Ghost, Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const chip = (on, color = "#2EE6FF") => ({
  background: on ? `${color}22` : "rgba(255,255,255,0.04)",
  border: `1px solid ${on ? color + "88" : "rgba(255,255,255,0.14)"}`,
  color: on ? color : "var(--text-muted)",
});

export default function GameAccessPanel({ gameId }) {
  const [open, setOpen] = useState(false);
  const [reg, setReg] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [summary, setSummary] = useState("");
  const [usernames, setUsernames] = useState("");
  const [suggest, setSuggest] = useState([]);
  const [simName, setSimName] = useState("");
  const [simRes, setSimRes] = useState(null);
  const [audit, setAudit] = useState(null);
  const [previewLink, setPreviewLink] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      apiClient.get("/admin/games/access/registry"),
      apiClient.get(`/admin/games/${gameId}/access`)]);
    setReg(r1.data);
    setCfg(r2.data.access);
    setSummary(r2.data.summary);
    setPreviewLink(r2.data.preview_link);
    setUsernames((r2.data.access.users || []).map((u) => "@" + u.username).join(", "));
  }, [gameId]);
  useEffect(() => { if (open && !reg) load().catch(() => toast.error("Failed to load access config")); }, [open, reg, load]);

  const up = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const upFlag = (k, v) => setCfg((c) => ({ ...c, flags: { ...c.flags, [k]: v } }));
  const upFilter = (k, v) => setCfg((c) => ({ ...c, filters: { ...(c.filters || {}), [k]: v } }));

  const searchUsers = async (txt) => {
    setUsernames(txt);
    const last = txt.split(",").pop().trim().replace(/^@/, "");
    if (last.length >= 2) {
      try { const r = await apiClient.get("/admin/games/access/user-search", { params: { q: last } }); setSuggest(r.data.users); }
      catch { setSuggest([]); }
    } else setSuggest([]);
  };
  const pickSuggest = (u) => {
    const parts = usernames.split(",");
    parts[parts.length - 1] = " @" + u.username;
    setUsernames(parts.join(",").replace(/^ /, ""));
    setSuggest([]);
  };

  const save = async () => {
    const reason = window.prompt("Reason for this access change (recorded in audit):") || "";
    setBusy(true);
    try {
      const r = await apiClient.put(`/admin/games/${gameId}/access`, {
        config: { ...cfg, usernames }, reason });
      setCfg(r.data.access);
      setSummary(r.data.summary);
      setUsernames((r.data.access.users || []).map((u) => "@" + u.username).join(", "));
      toast.success("Access configuration saved");
      if (audit) loadAudit();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(d?.invalid_users ? `Unknown users: ${d.invalid_users.join(", ")}` : (d?.message || d || "Save failed"));
    } finally { setBusy(false); }
  };

  const simulate = async (guest) => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/games/${gameId}/access/simulate`,
        guest ? { guest: true } : { username: simName });
      setSimRes(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Simulation failed"); }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/games/${gameId}/access/preview-link`);
      setPreviewLink(r.data.link);
      const url = `${window.location.origin}${r.data.path}`;
      try { await navigator.clipboard.writeText(url); toast.success("Public Preview link copied: " + url); }
      catch { window.prompt("Copy the Public Preview link:", url); }
    } catch { toast.error("Could not create link"); }
    finally { setBusy(false); }
  };
  const revokeLink = async () => {
    await apiClient.delete(`/admin/games/${gameId}/access/preview-link`);
    setPreviewLink(null);
    toast.success("Public Preview link revoked");
  };

  const loadAudit = async () => {
    const r = await apiClient.get(`/admin/games/${gameId}/access/audit`);
    setAudit(r.data.audit);
  };
  const rollback = async (id) => {
    if (!window.confirm("Roll access back to the configuration BEFORE this change?")) return;
    try {
      const r = await apiClient.post(`/admin/games/${gameId}/access/rollback`, { audit_id: id });
      setCfg(r.data.access); setSummary(r.data.summary);
      setUsernames((r.data.access.users || []).map((u) => "@" + u.username).join(", "));
      toast.success("Rolled back"); loadAudit();
    } catch (e) { toast.error(e?.response?.data?.detail || "Rollback failed"); }
  };

  const badgesSel = new Set(cfg?.badges || []);
  const levelsSel = new Set(cfg?.levels || []);
  const showBadges = cfg?.mode === "badge_access";
  const showLevels = cfg?.mode === "progression_access";
  const showUsers = cfg?.mode === "custom_users";
  const showToggles = ["preview", "published", "custom_users", "badge_access", "progression_access"].includes(cfg?.mode);
  const showFilters = showToggles;

  return (
    <div className="mt-3 rounded-xl p-3" style={{ border: "1px solid rgba(46,230,255,0.3)", background: "rgba(46,230,255,0.04)" }}
      data-testid="game-access-panel">
      <button className="w-full text-left flex items-center gap-2" onClick={() => setOpen(!open)} data-testid="access-panel-toggle">
        <Shield size={13} style={{ color: "#2EE6FF" }} />
        <b className="text-[11px] uppercase tracking-widest flex-1" style={{ color: "#2EE6FF" }}>Access &amp; Visibility</b>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && !cfg && <div className="text-[11px] mt-2"><Loader2 size={12} className="inline animate-spin" /> Loading…</div>}
      {open && cfg && reg && (
        <div className="mt-3 space-y-3 text-[11px]">
          <div>
            <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>Primary access mode</label>
            <select className="or-input text-xs w-full sm:w-72" value={cfg.mode}
              onChange={(e) => up({ mode: e.target.value })} data-testid="access-mode-select">
              {reg.modes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>

          {showUsers && (
            <div className="relative">
              <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
                Allowed users (comma separated, @ optional)</label>
              <input className="or-input text-xs w-full" value={usernames} placeholder="@stealth, LunaQueen, DragonX"
                onChange={(e) => searchUsers(e.target.value)} data-testid="access-users-input" />
              {suggest.length > 0 && (
                <div className="absolute z-20 mt-1 rounded-lg overflow-hidden" style={{ background: "#0b1626", border: "1px solid rgba(46,230,255,0.4)" }}>
                  {suggest.map((u) => (
                    <button key={u.id} className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-70"
                      onClick={() => pickSuggest(u)} data-testid={`access-user-suggest-${u.username}`}>@{u.username}</button>))}
                </div>)}
            </div>
          )}

          {showBadges && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-[9px] uppercase tracking-wider flex-1" style={{ color: "var(--text-muted)" }}>Required badges</label>
                <button className="or-btn or-btn-ghost text-[9px]" onClick={() => up({ badges: reg.badges.map((b) => b.key) })} data-testid="access-badges-select-all">Select All</button>
                <button className="or-btn or-btn-ghost text-[9px]" onClick={() => up({ badges: [] })} data-testid="access-badges-clear-all">Clear All</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {reg.badges.map((b) => (
                  <button key={b.key} className="px-2 py-1 rounded-full text-[10px]" style={chip(badgesSel.has(b.key))}
                    onClick={() => up({ badges: badgesSel.has(b.key) ? cfg.badges.filter((x) => x !== b.key) : [...cfg.badges, b.key] })}
                    data-testid={`access-badge-${b.key}`}>{b.name}</button>))}
              </div>
              <div className="flex gap-1.5 mt-1.5 items-center">
                <span style={{ color: "var(--text-muted)" }}>Match:</span>
                {["any", "all"].map((m) => (
                  <button key={m} className="px-2 py-0.5 rounded-full text-[10px] uppercase" style={chip(cfg.badge_match === m, "#C26BFF")}
                    onClick={() => up({ badge_match: m })} data-testid={`access-badge-match-${m}`}>{m}</button>))}
              </div>
            </div>
          )}

          {showLevels && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-[9px] uppercase tracking-wider flex-1" style={{ color: "var(--text-muted)" }}>Progression levels (exact)</label>
                <button className="or-btn or-btn-ghost text-[9px]" onClick={() => up({ levels: reg.levels.map((l) => l.level_number) })} data-testid="access-levels-select-all">Select All</button>
                <button className="or-btn or-btn-ghost text-[9px]" onClick={() => up({ levels: [] })} data-testid="access-levels-clear-all">Clear All</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {reg.levels.map((l) => (
                  <button key={l.id} className="px-2 py-1 rounded-full text-[10px]" style={chip(levelsSel.has(l.level_number), "#10E670")}
                    onClick={() => up({ levels: levelsSel.has(l.level_number) ? cfg.levels.filter((x) => x !== l.level_number) : [...cfg.levels, l.level_number] })}
                    data-testid={`access-level-${l.level_number}`}>{l.level_number}. {l.name}</button>))}
              </div>
              <div className="flex gap-2 mt-1.5 items-center flex-wrap">
                <span style={{ color: "var(--text-muted)" }}>or Min level</span>
                <input type="number" className="or-input text-xs w-16" value={cfg.min_level ?? ""}
                  onChange={(e) => up({ min_level: e.target.value === "" ? null : Number(e.target.value) })} data-testid="access-minlevel" />
                <span style={{ color: "var(--text-muted)" }}>Max level</span>
                <input type="number" className="or-input text-xs w-16" value={cfg.max_level ?? ""}
                  onChange={(e) => up({ max_level: e.target.value === "" ? null : Number(e.target.value) })} data-testid="access-maxlevel" />
              </div>
            </div>
          )}

          {cfg.mode === "maintenance" && (
            <div className="space-y-1.5">
              <input className="or-input text-xs w-full" value={cfg.maintenance_message || ""} placeholder="Maintenance message shown to players"
                onChange={(e) => up({ maintenance_message: e.target.value })} data-testid="access-maintenance-message" />
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!cfg.visible_when_blocked} onChange={(e) => up({ visible_when_blocked: e.target.checked })}
                  data-testid="access-visible-when-blocked" /> Keep game visible in the hub while blocked
              </label>
            </div>
          )}

          {cfg.mode === "public_preview" && (
            <div className="rounded-lg p-2" style={{ background: "rgba(244,167,59,0.08)", border: "1px solid rgba(244,167,59,0.4)" }}
              data-testid="access-public-preview-message">
              <b style={{ color: "#F4A73B" }}>Shown to every guest:</b>
              <div className="mt-0.5">{reg.public_preview_message}</div>
              <div className="flex gap-2 mt-2 items-center flex-wrap">
                <button className="or-btn text-[10px]" disabled={busy} onClick={copyLink} data-testid="access-copy-preview-link">
                  <Copy size={11} /> {previewLink ? "Regenerate + Copy Link" : "Create + Copy Public Link"}</button>
                {previewLink && (
                  <>
                    <code className="text-[9.5px] px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.35)" }}
                      data-testid="access-preview-link-token">/preview/game/{previewLink.token}</code>
                    <button className="or-btn or-btn-ghost text-[10px]" style={{ color: "#FF6B6B" }} onClick={revokeLink}
                      data-testid="access-revoke-preview-link">Revoke</button>
                  </>)}
              </div>
            </div>
          )}
          {cfg.mode === "view_only" && (
            <div className="rounded-lg p-2" style={{ background: "rgba(255,138,90,0.08)", border: "1px solid rgba(255,138,90,0.4)" }}>
              {reg.view_only_message}
            </div>
          )}

          {showToggles && (
            <div>
              <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
                Reward &amp; feature toggles {cfg.mode === "preview" && "(rewards default OFF in Preview)"}</label>
              <div className="flex flex-wrap gap-1.5">
                {[["fire", "Fire Power rewards"], ["keys", "Key rewards"], ["saves", "Saves / progress"],
                  ["leaderboard", "Leaderboard"], ["reports", "Reports / feedback"]].map(([k, label]) => (
                  <button key={k} className="px-2 py-1 rounded-full text-[10px]" style={chip(!!cfg.flags?.[k], "#FF8A5A")}
                    onClick={() => upFlag(k, !cfg.flags?.[k])} data-testid={`access-flag-${k}`}>
                    {label}: {cfg.flags?.[k] ? "ON" : "OFF"}</button>))}
              </div>
            </div>
          )}

          {showFilters && (
            <details data-testid="access-filters">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider" style={{ color: "#C26BFF" }}>
                Optional eligibility filters</summary>
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span style={{ color: "var(--text-muted)" }}>Badge filter:</span>
                  {reg.badges.map((b) => {
                    const on = (cfg.filters?.badges || []).includes(b.key);
                    return <button key={b.key} className="px-2 py-0.5 rounded-full text-[10px]" style={chip(on, "#C26BFF")}
                      onClick={() => upFilter("badges", on ? cfg.filters.badges.filter((x) => x !== b.key) : [...(cfg.filters?.badges || []), b.key])}
                      data-testid={`access-filter-badge-${b.key}`}>{b.name}</button>;
                  })}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <span style={{ color: "var(--text-muted)" }}>Min level</span>
                  <input type="number" className="or-input text-xs w-16" value={cfg.filters?.min_level ?? ""}
                    onChange={(e) => upFilter("min_level", e.target.value === "" ? null : Number(e.target.value))} data-testid="access-filter-minlevel" />
                  <span style={{ color: "var(--text-muted)" }}>Min Fire Power</span>
                  <input type="number" className="or-input text-xs w-20" value={cfg.filters?.min_fire ?? ""}
                    onChange={(e) => upFilter("min_fire", e.target.value === "" ? null : Number(e.target.value))} data-testid="access-filter-minfire" />
                  <span style={{ color: "var(--text-muted)" }}>Account age ≥ days</span>
                  <input type="number" className="or-input text-xs w-16" value={cfg.filters?.min_account_age_days ?? ""}
                    onChange={(e) => upFilter("min_account_age_days", e.target.value === "" ? null : Number(e.target.value))} data-testid="access-filter-accountage" />
                  <span style={{ color: "var(--text-muted)" }}>Audience</span>
                  <select className="or-input text-xs" value={cfg.filters?.audience || "all"}
                    onChange={(e) => upFilter("audience", e.target.value)} data-testid="access-filter-audience">
                    {reg.audiences.map((a) => <option key={a} value={a}>{a.replace("_", " ")}</option>)}
                  </select>
                </div>
              </div>
            </details>
          )}

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cfg.founder_bypass !== false} onChange={(e) => up({ founder_bypass: e.target.checked })}
              data-testid="access-founder-bypass" /> Founder / Admin bypass (private testing always allowed)
          </label>

          <div className="rounded-lg p-2" style={{ background: "rgba(16,230,112,0.06)", border: "1px solid rgba(16,230,112,0.3)" }}
            data-testid="access-summary">
            <b style={{ color: "#10E670" }}>Effective access:</b> {summary}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="or-btn text-xs font-bold" style={{ background: "#10E670", color: "#0a0a0a" }} disabled={busy}
              onClick={save} data-testid="access-save">Save Changes</button>
            <button className="or-btn or-btn-ghost text-xs" disabled={busy}
              onClick={() => load().then(() => toast.success("Reset to saved config"))} data-testid="access-reset">
              <RefreshCcw size={11} /> Reset</button>
            <button className="or-btn or-btn-ghost text-xs" onClick={() => (audit ? setAudit(null) : loadAudit())}
              data-testid="access-audit-toggle"><History size={11} /> Audit History</button>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <input className="or-input text-xs w-40" value={simName} placeholder="Test as @username"
              onChange={(e) => setSimName(e.target.value)} data-testid="access-test-user-input" />
            <button className="or-btn text-[10px]" disabled={busy || !simName.trim()} onClick={() => simulate(false)}
              data-testid="access-test-user-btn"><UserCheck size={11} /> Test as User</button>
            <button className="or-btn text-[10px]" disabled={busy} onClick={() => simulate(true)}
              data-testid="access-test-guest-btn"><Ghost size={11} /> Test as Guest</button>
          </div>
          {simRes && (
            <div className="rounded-lg p-2" data-testid="access-sim-result"
              style={{ background: simRes.allowed ? "rgba(16,230,112,0.08)" : "rgba(255,61,90,0.08)",
                       border: `1px solid ${simRes.allowed ? "rgba(16,230,112,0.4)" : "rgba(255,61,90,0.4)"}` }}>
              <b style={{ color: simRes.allowed ? "#10E670" : "#FF6B6B" }}>
                {simRes.as}: {simRes.allowed ? "ALLOWED" : "DENIED"}</b> — reason: <code>{simRes.reason}</code>
              {simRes.view_only && " · VIEW ONLY"}
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                fire {simRes.flags?.fire ? "ON" : "OFF"} · keys {simRes.flags?.keys ? "ON" : "OFF"} ·
                saves {simRes.flags?.saves ? "ON" : "OFF"} · leaderboard {simRes.flags?.leaderboard ? "ON" : "OFF"}
              </div>
              {(simRes.trace || []).length > 0 && (
                <div className="text-[9.5px] mt-0.5" style={{ color: "var(--text-muted)" }}>{simRes.trace.join(" → ")}</div>)}
            </div>
          )}

          {audit && (
            <div className="space-y-1.5 max-h-56 overflow-y-auto" data-testid="access-audit-list">
              {audit.length === 0 && <div style={{ color: "var(--text-muted)" }}>No access changes recorded yet.</div>}
              {audit.map((a) => (
                <div key={a.id} className="rounded-lg p-2 flex items-start gap-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div className="flex-1 min-w-0">
                    <b>{a.action}</b> → <code>{a.mode}</code> by @{a.changed_by}
                    <div className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{a.at} · {a.reason}</div>
                  </div>
                  {a.prev && a.prev.mode && (
                    <button className="or-btn or-btn-ghost text-[9px]" onClick={() => rollback(a.id)}
                      data-testid={`access-audit-rollback-${a.id}`}>Rollback</button>)}
                </div>))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
