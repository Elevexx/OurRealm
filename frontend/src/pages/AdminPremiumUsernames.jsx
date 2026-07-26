/**
 * /admin/premium-usernames — Premium Username control center.
 * Config (threshold/tiers/flags), per-name rules, grants, lean stats.
 */
import React, { useEffect, useState } from "react";
import { Flame, Search, Save, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const fmt = (n) => Number(n || 0).toLocaleString();

export default function AdminPremiumUsernames() {
  const [cfg, setCfg] = useState(null);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lookupQ, setLookupQ] = useState("");
  const [lookup, setLookup] = useState(null);
  const [rule, setRule] = useState({ status: "", custom_cost: "", note: "", reason: "" });
  const [grant, setGrant] = useState({ user_id: "", reason: "" });

  const load = async () => {
    try {
      const [{ data: c }, { data: s }] = await Promise.all([
        apiClient.get("/premium-usernames/admin/config"),
        apiClient.get("/premium-usernames/admin/stats"),
      ]);
      setCfg(c.config); setStats(s);
    } catch (e) { toast.error(e?.response?.data?.detail || "Load failed"); }
  };
  useEffect(() => { load(); }, []);

  const saveCfg = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.put("/premium-usernames/admin/config", {
        enabled: cfg.enabled,
        max_premium_len: Number(cfg.max_premium_len),
        tier_costs: cfg.tier_costs,
        tier_enabled: cfg.tier_enabled,
        min_account_age_days: Number(cfg.min_account_age_days || 0),
        require_verification: cfg.require_verification,
        change_cooldown_days: Number(cfg.change_cooldown_days || 0),
        maintenance_lock: cfg.maintenance_lock,
      });
      setCfg(data.config);
      toast.success("Config saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  const doLookup = async () => {
    if (!lookupQ.trim()) return;
    try {
      const { data } = await apiClient.get(`/premium-usernames/admin/lookup?u=${encodeURIComponent(lookupQ.trim())}`);
      setLookup(data);
      setRule({ status: data.rule?.status || "", custom_cost: data.rule?.custom_cost ?? "", note: data.rule?.note || "", reason: "" });
    } catch (e) { toast.error(e?.response?.data?.detail || "Lookup failed"); }
  };

  const saveRule = async (release = false) => {
    if (!rule.reason.trim()) { toast.error("A reason is required."); return; }
    try {
      await apiClient.post("/premium-usernames/admin/rule", {
        username: lookup.username, release,
        status: release ? null : (rule.status || null),
        custom_cost: release || rule.custom_cost === "" ? null : Number(rule.custom_cost),
        note: rule.note || null, reason: rule.reason,
      });
      toast.success(release ? "Rule released" : "Rule saved");
      doLookup(); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Rule save failed"); }
  };

  const doGrant = async () => {
    if (!grant.user_id.trim() || !grant.reason.trim()) { toast.error("User ID and reason required."); return; }
    if (!window.confirm(`Assign @${lookup.username} to user ${grant.user_id}? This changes their username.`)) return;
    try {
      await apiClient.post("/premium-usernames/admin/grant", {
        username: lookup.username, user_id: grant.user_id.trim(), reason: grant.reason,
      });
      toast.success("Username granted");
      doLookup();
    } catch (e) { toast.error(e?.response?.data?.detail || "Grant failed"); }
  };

  if (!cfg) return <div className="p-8 text-center"><Loader2 size={20} className="animate-spin inline" /></div>;

  const lengths = Array.from({ length: Number(cfg.max_premium_len) || 6 }, (_, i) => String(i + 1));

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4" data-testid="admin-premium-usernames">
      <h1 className="text-2xl font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
        <Flame size={20} style={{ color: "#FF7A00" }} /> Premium Usernames
      </h1>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="premium-admin-stats">
          {[["Unlocks", stats.total_unlocks], ["Fire burned", fmt(stats.total_fire_burned)],
            ["Grandfathered", fmt(stats.grandfathered_users)], ["Reserved", stats.reserved_names],
            ["Retired", stats.retired_names], ["Next NPC #", stats.next_npc_number]].map(([k, v]) => (
            <div key={k} className="or-surface p-2 text-center">
              <div className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>{k}</div>
              <div className="text-sm font-bold">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="or-surface p-4 space-y-3">
        <h2 className="text-sm font-bold flex items-center gap-2"><Shield size={14} /> Length & Pricing</h2>
        <div className="flex flex-wrap gap-3 text-xs items-center">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!cfg.enabled}
              onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
              data-testid="premium-cfg-enabled" /> Feature enabled
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!cfg.maintenance_lock}
              onChange={(e) => setCfg({ ...cfg, maintenance_lock: e.target.checked })}
              data-testid="premium-cfg-maintenance" /> Maintenance lock
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!cfg.require_verification}
              onChange={(e) => setCfg({ ...cfg, require_verification: e.target.checked })}
              data-testid="premium-cfg-verification" /> Require verification
          </label>
          <label className="flex items-center gap-1.5">
            Max premium length
            <input type="number" min={1} max={12} className="or-input w-16 text-xs"
              value={cfg.max_premium_len}
              onChange={(e) => setCfg({ ...cfg, max_premium_len: e.target.value })}
              data-testid="premium-cfg-maxlen" />
          </label>
          <label className="flex items-center gap-1.5">
            Min account age (days)
            <input type="number" min={0} className="or-input w-16 text-xs"
              value={cfg.min_account_age_days}
              onChange={(e) => setCfg({ ...cfg, min_account_age_days: e.target.value })}
              data-testid="premium-cfg-minage" />
          </label>
          <label className="flex items-center gap-1.5">
            Change cooldown (days)
            <input type="number" min={0} className="or-input w-16 text-xs"
              value={cfg.change_cooldown_days}
              onChange={(e) => setCfg({ ...cfg, change_cooldown_days: e.target.value })}
              data-testid="premium-cfg-cooldown" />
          </label>
        </div>
        <div className="space-y-1.5">
          {lengths.map((L) => (
            <div key={L} className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 w-28">
                <input type="checkbox" checked={!!cfg.tier_enabled?.[L]}
                  onChange={(e) => setCfg({ ...cfg, tier_enabled: { ...cfg.tier_enabled, [L]: e.target.checked } })}
                  data-testid={`premium-tier-enabled-${L}`} />
                {L} character{L === "1" ? "" : "s"}
              </label>
              <input type="number" min={0} className="or-input w-36 text-xs"
                value={cfg.tier_costs?.[L] ?? ""}
                onChange={(e) => setCfg({ ...cfg, tier_costs: { ...cfg.tier_costs, [L]: Number(e.target.value) } })}
                data-testid={`premium-tier-cost-${L}`} />
              <span style={{ color: "var(--text-muted)" }}>Fire Power</span>
            </div>
          ))}
        </div>
        <button className="or-btn text-xs" disabled={busy} onClick={saveCfg} data-testid="premium-cfg-save">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save config
        </button>
      </div>

      <BulkAddSection onApplied={() => { load(); }} />

      <div className="or-surface p-4 space-y-3">
        <h2 className="text-sm font-bold flex items-center gap-2"><Search size={14} /> Username Management</h2>
        <div className="flex gap-2">
          <input className="or-input flex-1 text-sm" placeholder="Search a username…" value={lookupQ}
            onChange={(e) => setLookupQ(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && doLookup()} data-testid="premium-lookup-input" />
          <button className="or-btn text-xs" onClick={doLookup} data-testid="premium-lookup-btn">Lookup</button>
        </div>
        {lookup && (
          <div className="space-y-2 text-xs" data-testid="premium-lookup-result">
            <div className="p-2 rounded" style={{ background: "var(--surface-2)" }}>
              <b>@{lookup.username}</b> · status: {lookup.evaluation?.status}
              {lookup.evaluation?.cost != null && ` · cost ${fmt(lookup.evaluation.cost)} 🔥`}
              {lookup.owner && (
                <div style={{ color: "var(--text-muted)" }}>
                  Owner: {lookup.owner.name} (id {lookup.owner.id})
                  {lookup.owner.username_grandfathered ? " · grandfathered" : ""}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select className="or-input text-xs" value={rule.status}
                onChange={(e) => setRule({ ...rule, status: e.target.value })}
                data-testid="premium-rule-status">
                <option value="">— standard length price —</option>
                <option value="reserved">Reserved</option>
                <option value="prohibited">Prohibited</option>
                <option value="verification_required">Verification required</option>
                <option value="admin_only">Admin-only</option>
                <option value="free">Free</option>
                <option value="retired">Permanently retired</option>
              </select>
              <input type="number" min={0} className="or-input w-32 text-xs" placeholder="Custom Fire cost"
                value={rule.custom_cost}
                onChange={(e) => setRule({ ...rule, custom_cost: e.target.value })}
                data-testid="premium-rule-cost" />
              <input className="or-input flex-1 text-xs" placeholder="Internal note…"
                value={rule.note} onChange={(e) => setRule({ ...rule, note: e.target.value })}
                data-testid="premium-rule-note" />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <input className="or-input flex-1 text-xs" placeholder="Reason (required)…"
                value={rule.reason} onChange={(e) => setRule({ ...rule, reason: e.target.value })}
                data-testid="premium-rule-reason" />
              <button className="or-btn text-xs" onClick={() => saveRule(false)}
                data-testid="premium-rule-save">Save rule</button>
              {lookup.rule && (
                <button className="or-chip text-xs" onClick={() => saveRule(true)}
                  data-testid="premium-rule-release">Release</button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center pt-1"
              style={{ borderTop: "1px solid var(--border-col)" }}>
              <input className="or-input w-64 text-xs" placeholder="Grant to user ID…"
                value={grant.user_id} onChange={(e) => setGrant({ ...grant, user_id: e.target.value })}
                data-testid="premium-grant-user" />
              <input className="or-input flex-1 text-xs" placeholder="Grant reason…"
                value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })}
                data-testid="premium-grant-reason" />
              <button className="or-chip text-xs" onClick={doGrant} data-testid="premium-grant-btn">Grant</button>
            </div>
            {lookup.history?.length > 0 && (
              <div>
                <div className="font-bold mb-1">History</div>
                {lookup.history.map((h) => (
                  <div key={h.id} style={{ color: "var(--text-muted)" }}>
                    {h.at?.slice(0, 10)} · @{h.old_username} → @{h.new_username} · {h.method}
                    {h.fire_cost ? ` · ${fmt(h.fire_cost)} 🔥` : ""}
                  </div>
                ))}
              </div>
            )}
            {lookup.transactions?.length > 0 && (
              <div>
                <div className="font-bold mb-1">Burn transactions</div>
                {lookup.transactions.map((t) => (
                  <div key={t.id} style={{ color: "var(--text-muted)" }}>
                    {t.created_at?.slice(0, 10)} · @{t.new_username} · {fmt(Math.abs(t.amount))} 🔥 burned
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <RulesTable onPick={(u) => { setLookupQ(u); }} />
      </div>
    </div>
  );
}

const BULK_ACTIONS = [
  ["premium_custom_cost", "Lock as Premium — custom Fire Power cost"],
  ["premium_standard_price", "Lock as Premium — standard character-length price"],
  ["verification_required", "Require verification"],
  ["verification_and_fire", "Require verification + Fire Power"],
  ["reserved", "Reserve username"],
  ["admin_only", "Admin-only"],
  ["prohibited", "Prohibit username"],
  ["retired", "Permanently retire username"],
  ["free_grant_only", "Free admin grant only"],
];
const NEEDS_COST = new Set(["premium_custom_cost", "verification_and_fire"]);

function BulkAddSection({ onApplied }) {
  const [text, setText] = useState("");
  const [action, setAction] = useState("premium_custom_cost");
  const [cost, setCost] = useState("");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);

  const run = async (apply) => {
    setBusy(true);
    try {
      const { data } = await apiClient.post("/premium-usernames/admin/bulk", {
        text, action, override_owned: override, apply,
        custom_cost: cost === "" ? null : Number(cost),
        reason: apply ? reason : null,
      });
      setPreview(data.rows);
      if (apply) {
        const s = data.summary;
        setSummary(`${s.updated} updated · ${s.already_matched} already matched · `
          + `${s.invalid} invalid · ${s.skipped_owned} skipped (owned) · ${s.duplicates} duplicates`);
        toast.success("Bulk rules applied");
        onApplied?.();
      } else setSummary(null);
    } catch (e) { toast.error(e?.response?.data?.detail || "Bulk operation failed"); }
    finally { setBusy(false); }
  };

  const applicable = (preview || []).filter((r) => ["will_update", "updated"].includes(r.result)).length;

  return (
    <div className="or-surface p-4 space-y-3" data-testid="premium-bulk-section">
      <h2 className="text-sm font-bold">Add Premium Usernames</h2>
      <textarea className="or-input w-full text-sm" rows={4}
        placeholder={"One per line or comma-separated…\nJohn, Sally, Susy"}
        value={text} onChange={(e) => setText(e.target.value)}
        data-testid="premium-bulk-input" />
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <select className="or-input text-xs" value={action}
          onChange={(e) => setAction(e.target.value)} data-testid="premium-bulk-action">
          {BULK_ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {(NEEDS_COST.has(action) || action === "free_grant_only") && (
          <label className="flex items-center gap-1.5">
            Fire Power Burn Cost
            <input type="number" min={action === "free_grant_only" ? 0 : 1}
              className="or-input w-32 text-xs" value={cost}
              onChange={(e) => setCost(e.target.value)} data-testid="premium-bulk-cost" />
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)}
            data-testid="premium-bulk-override" /> Override currently-owned names (rule only — never renames)
        </label>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button className="or-chip text-xs" disabled={busy || !text.trim()} onClick={() => run(false)}
          data-testid="premium-bulk-preview">{busy ? <Loader2 size={11} className="animate-spin" /> : "Preview"}</button>
        {preview && applicable > 0 && (
          <>
            <input className="or-input flex-1 text-xs" placeholder="Reason (required)…" value={reason}
              onChange={(e) => setReason(e.target.value)} data-testid="premium-bulk-reason" />
            <button className="or-btn text-xs" disabled={busy || !reason.trim()} onClick={() => run(true)}
              data-testid="premium-bulk-apply">Apply to {applicable} Username{applicable === 1 ? "" : "s"}</button>
          </>
        )}
      </div>
      {summary && <div className="text-xs font-semibold" data-testid="premium-bulk-summary">{summary}</div>}
      {preview && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]" data-testid="premium-bulk-table">
            <thead>
              <tr style={{ color: "var(--text-muted)" }} className="text-left">
                <th className="pr-2 py-1">Username</th><th className="pr-2">Len</th>
                <th className="pr-2">Current</th><th className="pr-2">Owner</th>
                <th className="pr-2">New rule</th><th className="pr-2">New cost</th>
                <th className="pr-2">Result</th><th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={`${r.username}-${i}`} style={{ borderTop: "1px solid var(--border-col)" }}
                  data-testid={`premium-bulk-row-${r.username}`}>
                  <td className="pr-2 py-1 font-semibold">@{r.username}</td>
                  <td className="pr-2">{r.length}</td>
                  <td className="pr-2">{r.current_status || "—"}</td>
                  <td className="pr-2">{r.owner ? r.owner.name : "—"}</td>
                  <td className="pr-2">{r.new_rule}</td>
                  <td className="pr-2">{r.new_cost != null ? fmt(r.new_cost) : "—"}</td>
                  <td className="pr-2 font-semibold"
                    style={{ color: ["updated", "will_update"].includes(r.result) ? "var(--brand-green, #00FF66)" : "#ffb84d" }}>
                    {r.result}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{(r.warnings || []).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RulesTable({ onPick }) {
  const [rules, setRules] = useState(null);
  useEffect(() => {
    apiClient.get("/premium-usernames/admin/rules?limit=100")
      .then((r) => setRules(r.data.rules || [])).catch(() => setRules([]));
  }, []);
  if (!rules?.length) return null;
  return (
    <div className="pt-2" style={{ borderTop: "1px solid var(--border-col)" }}>
      <div className="text-xs font-bold mb-1">Configured usernames ({rules.length})</div>
      <div className="overflow-x-auto" style={{ maxHeight: 240, overflowY: "auto" }}>
        <table className="w-full text-[11px]" data-testid="premium-rules-table">
          <thead>
            <tr style={{ color: "var(--text-muted)" }} className="text-left">
              <th className="pr-2 py-1">Username</th><th className="pr-2">Status</th>
              <th className="pr-2">Premium</th><th className="pr-2">Custom cost</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.username} style={{ borderTop: "1px solid var(--border-col)", cursor: "pointer" }}
                onClick={() => onPick?.(r.username)} data-testid={`premium-rule-row-${r.username}`}>
                <td className="pr-2 py-1 font-semibold">@{r.username}</td>
                <td className="pr-2">{r.status || "—"}</td>
                <td className="pr-2">{r.force_premium ? "locked" : "—"}</td>
                <td className="pr-2">{r.custom_cost != null ? fmt(r.custom_cost) : "—"}</td>
                <td style={{ color: "var(--text-muted)" }}>{r.note || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
