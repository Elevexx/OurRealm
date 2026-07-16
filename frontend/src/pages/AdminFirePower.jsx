/**
 * /admin/fire-power — Founder-only Fire Power console.
 * Flags (default OFF), per-level Fire configuration, and the safe
 * Like → Fire migration workflow (Dry Run → Execute → Reconcile,
 * with Rollback). Legacy likes are NEVER deleted by any action here.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, Flame, Loader2, RefreshCw, Search, ShieldAlert,
  Undo2, Wand2, CheckCircle2, Scale,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const FLAG_LABELS = {
  fire_reactions: "Fire reactions on public posts (master switch)",
  boosted_fire: "Boosted Fire (2x+ consumes the 24h pool)",
  fire_ranked_feed: "Fire-ranked For You feed (time windows)",
  fire_notifications: "Fire notifications to post authors",
  fire_wallet_enabled: "Fire Wallet UI (Vault earnings ALWAYS accrue; this only reveals the wallet)",
};

function ReportBlock({ title, report, testid }) {
  if (!report) return null;
  return (
    <div className="or-surface p-3 mt-2 text-xs" data-testid={testid}>
      <div className="font-semibold mb-1">{title}</div>
      {Object.entries(report).map(([k, v]) => (
        k === "samples" || k === "mismatch_samples" ? (
          <div key={k} className="mt-1">
            <span style={{ color: "var(--text-muted)" }}>{k}:</span>
            {(v || []).map((s, i) => (
              <div key={i} style={{ color: "var(--text-muted)" }}>· {JSON.stringify(s)}</div>
            ))}
          </div>
        ) : (
          <div key={k}><span style={{ color: "var(--text-muted)" }}>{k}:</span> <b>{String(v)}</b></div>
        )
      ))}
    </div>
  );
}

function LevelFireRow({ level, onSaved }) {
  const fs = level.fire_settings || level.fire_defaults || { max_fire_per_reaction: 1, daily_fire_pool: 0, fire_enabled: true };
  const [form, setForm] = useState({ max_fire_per_reaction: fs.max_fire_per_reaction, daily_fire_pool: fs.daily_fire_pool, fire_enabled: fs.fire_enabled !== false });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await apiClient.patch(`/fire/admin/levels/${level.id}`, form);
      toast.success(`Fire config saved for ${level.name}`);
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 text-xs" style={{ borderTop: "1px solid var(--border-col)" }} data-testid={`fire-level-row-${level.id}`}>
      <span className="w-32 shrink-0 font-semibold" style={{ color: "var(--text-main)" }}>
        #{level.level_number} {level.name}
        {!level.fire_settings && <span className="ml-1 text-[9px] uppercase" style={{ color: "#F4C84A" }}>default</span>}
      </span>
      <label className="flex items-center gap-1">Max
        <input type="number" min={1} className="or-input" style={{ width: 70 }} value={form.max_fire_per_reaction}
          onChange={(e) => setForm({ ...form, max_fire_per_reaction: parseInt(e.target.value || "1", 10) })}
          data-testid={`fire-level-max-${level.id}`} />×
      </label>
      <label className="flex items-center gap-1">Pool
        <input type="number" min={0} className="or-input" style={{ width: 80 }} value={form.daily_fire_pool}
          onChange={(e) => setForm({ ...form, daily_fire_pool: parseInt(e.target.value || "0", 10) })}
          data-testid={`fire-level-pool-${level.id}`} />
      </label>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={form.fire_enabled}
          onChange={(e) => setForm({ ...form, fire_enabled: e.target.checked })}
          data-testid={`fire-level-enabled-${level.id}`} /> boosted enabled
      </label>
      <button className="or-chip" onClick={save} disabled={saving} data-testid={`fire-level-save-${level.id}`}>
        {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Save
      </button>
    </div>
  );
}

function WalletAdminSection() {
  const [ov, setOv] = useState(null);
  const [hours, setHours] = useState("");
  const [txns, setTxns] = useState(null);
  const [txnUser, setTxnUser] = useState("");
  const [recalcUser, setRecalcUser] = useState("");
  const [busy, setBusy] = useState(null);
  const [recalcReport, setRecalcReport] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get("/fire/admin/wallets/overview");
      setOv(r.data);
      setHours(String(r.data.config.settlement_hours));
    } catch (e) { toast.error(e?.response?.data?.detail || "Wallets load failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(null); }
  };

  const loadTxns = () => run("txns", async () => {
    const r = await apiClient.get("/fire/admin/wallets/transactions", {
      params: { limit: 25, ...(txnUser.trim() ? { username: txnUser.trim() } : {}) },
    });
    setTxns(r.data.transactions);
  });

  if (!ov) return <div className="or-surface p-4"><Loader2 size={16} className="animate-spin" /></div>;

  const who = (row) => row ? `@${row.username || row.user_id?.slice(0, 8)} — ${row.value.toLocaleString()} 🔥` : "—";

  return (
    <div className="or-surface p-4" data-testid="fire-admin-wallets">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Flame size={14} style={{ color: "#FF7A1A" }} /> Fire Vault &amp; Wallets (Phase 0.5)
      </div>
      <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
        Vault = permanent earned fire (not spendable yet). Earnings accrue even while the wallet UI flag is OFF.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-3" data-testid="fire-wallets-stats">
        {[["Total Vault Fire", ov.total_vault_fire], ["Total Pending Fire", ov.total_pending_fire],
          ["Wallets", ov.wallet_count], ["Pending txns", ov.pending_transactions]].map(([k, v]) => (
          <div key={k} className="p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
            <div className="text-lg font-bold" style={{ color: "#FF7A1A" }}>{(v ?? 0).toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{k}</div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-xs mb-3">
        <div className="p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
          <div className="font-semibold mb-1">Largest wallet</div>
          <div style={{ color: "var(--text-muted)" }} data-testid="fire-wallets-largest">{who(ov.largest_wallet)}</div>
          <div className="font-semibold mb-1 mt-2">Largest pending</div>
          <div style={{ color: "var(--text-muted)" }} data-testid="fire-wallets-largest-pending">{who(ov.largest_pending_wallet)}</div>
        </div>
        <div className="p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
          <div className="font-semibold mb-1">Top earners</div>
          {(ov.top_earners || []).length === 0 ? <div style={{ color: "var(--text-muted)" }}>None yet</div>
            : ov.top_earners.map((r, i) => <div key={i} style={{ color: "var(--text-muted)" }}>· {who(r)}</div>)}
          <div className="font-semibold mb-1 mt-2">Top senders</div>
          {(ov.top_senders || []).length === 0 ? <div style={{ color: "var(--text-muted)" }}>None yet</div>
            : ov.top_senders.map((r, i) => <div key={i} style={{ color: "var(--text-muted)" }}>· {who(r)} ({r.events} events)</div>)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <label className="flex items-center gap-1">Settlement delay (h)
          <input type="number" min={0} max={720} className="or-input" style={{ width: 80 }}
            value={hours} onChange={(e) => setHours(e.target.value)} data-testid="fire-wallets-settlement-input" />
        </label>
        <button className="or-chip" data-testid="fire-wallets-settlement-save"
          onClick={() => run("cfg", async () => {
            const r = await apiClient.patch("/fire/admin/wallets/config", { settlement_hours: parseInt(hours || "24", 10) });
            toast.success(`Settlement delay set to ${r.data.config.settlement_hours}h`);
            await load();
          })}>
          {busy === "cfg" ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Save
        </button>
        <button className="or-chip" data-testid="fire-wallets-settle-now"
          onClick={() => run("settle", async () => {
            const r = await apiClient.post("/fire/admin/wallets/settle-now");
            toast.success(`Settled ${r.data.settled} pending transaction(s)`);
            await load();
          })}>
          {busy === "settle" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Settle due now
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
        <input className="or-input" style={{ width: 160 }} placeholder="username (blank = all)"
          value={recalcUser} onChange={(e) => setRecalcUser(e.target.value)} data-testid="fire-wallets-recalc-user" />
        <button className="or-chip" data-testid="fire-wallets-recalculate"
          onClick={() => run("recalc", async () => {
            const r = await apiClient.post("/fire/admin/wallets/recalculate",
              recalcUser.trim() ? { username: recalcUser.trim() } : {});
            setRecalcReport(r.data);
            toast.success("Wallet recalculation complete");
            await load();
          })}>
          {busy === "recalc" ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Recalculate / Repair wallets
        </button>
      </div>
      {recalcReport && (
        <div className="text-[11px] mb-3 p-2 rounded-lg" style={{ border: "1px solid var(--border-col)", color: "var(--text-muted)" }} data-testid="fire-wallets-recalc-report">
          {recalcReport.wallets_checked !== undefined
            ? `Checked ${recalcReport.wallets_checked} wallet(s), repaired ${recalcReport.wallets_changed}.`
            : `@${recalcUser}: vault ${recalcReport.before?.vault_balance ?? 0} → ${recalcReport.after?.vault_balance ?? 0}, pending ${recalcReport.before?.pending_balance ?? 0} → ${recalcReport.after?.pending_balance ?? 0}`}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
        <input className="or-input" style={{ width: 160 }} placeholder="filter by username"
          value={txnUser} onChange={(e) => setTxnUser(e.target.value)} data-testid="fire-wallets-txn-user" />
        <button className="or-chip" onClick={loadTxns} data-testid="fire-wallets-audit">
          {busy === "txns" ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} Audit vault transactions
        </button>
      </div>
      {txns !== null && (
        <div className="text-[11px] max-h-56 overflow-y-auto" data-testid="fire-wallets-txn-list">
          {txns.length === 0 ? <div style={{ color: "var(--text-muted)" }}>No transactions found.</div>
            : txns.map((t) => (
              <div key={t.id} className="py-1" style={{ borderTop: "1px solid var(--border-col)", color: "var(--text-muted)" }}>
                <b style={{ color: t.status === "settled" ? "#10E670" : "#F4C84A" }}>{t.status}</b>
                {" "}+{t.amount} 🔥 to @{t.receiver_username || t.user_id?.slice(0, 8)}
                {" "}from @{t.sender_username || t.sender_id?.slice(0, 8)} · {t.created_at?.slice(0, 19)}
                {t.status === "pending" && ` · settles ${t.settle_after?.slice(0, 19)}`}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function DashboardSection() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await apiClient.get("/fire/admin/dashboard");
      setD(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Dashboard load failed"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="or-surface p-4" data-testid="fire-admin-dashboard"><Loader2 size={16} className="animate-spin" /></div>;

  const stats = [
    ["Finalization queue", d.finalization_queue],
    ["Collectable txns", d.collectable_transactions],
    ["Reversed txns", d.reversed_transactions],
    ["Fire sent (24h)", d.fire_sent_today],
    ["Collections today", d.collections_today],
    ["Collections (7d)", d.collections_this_week],
    ["Collections (30d)", d.collections_this_month],
    ["Lifetime received", d.lifetime_fire_received_total],
    ["Lifetime collected", d.lifetime_fire_collected_total],
    ["Users w/ pool usage", d.users_with_pool_usage],
    ["Active reservations", d.active_pool_reservations],
    ["Total Vault Fire", d.total_vault_fire],
  ];

  return (
    <div className="or-surface p-4" data-testid="fire-admin-dashboard">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Flame size={14} style={{ color: "#FF7A1A" }} /> Fire Command Center — Live Dashboard (Phase 0.6)
        </div>
        <button className="or-chip" onClick={load} data-testid="fire-dashboard-refresh">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center mb-3" data-testid="fire-dashboard-stats">
        {stats.map(([k, v]) => (
          <div key={k} className="p-2.5 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
            <div className="text-lg font-bold" style={{ color: "#FF7A1A" }}>{(v ?? 0).toLocaleString()}</div>
            <div className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{k}</div>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-xs">
        <div className="p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
          <div className="font-semibold mb-1">Largest collectable balance</div>
          <div style={{ color: "var(--text-muted)" }} data-testid="fire-dashboard-largest-collectable">
            {d.largest_collectable ? `@${d.largest_collectable.username || "?"} — ${d.largest_collectable.value.toLocaleString()} 🔥` : "—"}
          </div>
        </div>
        <div className="p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
          <div className="font-semibold mb-1">Top Fire post</div>
          <div style={{ color: "var(--text-muted)" }} data-testid="fire-dashboard-top-post">
            {d.top_fire_post
              ? `${d.top_fire_post.fire_total.toLocaleString()} 🔥 — @${d.top_fire_post.author_username}: "${(d.top_fire_post.content || "").slice(0, 60)}"`
              : "No fire posts yet"}
          </div>
        </div>
      </div>
    </div>
  );
}

function InspectorSection() {
  const [uName, setUName] = useState("");
  const [uData, setUData] = useState(null);
  const [pId, setPId] = useState("");
  const [pData, setPData] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(null);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(null); }
  };

  const inspectUser = () => run("iu", async () => {
    const r = await apiClient.get(`/fire/admin/inspect/user/${uName.trim()}`);
    setUData(r.data);
  });
  const inspectPost = () => run("ip", async () => {
    const r = await apiClient.get(`/fire/admin/inspect/post/${pId.trim()}`);
    setPData(r.data);
  });
  const userAction = (key, path, label) => run(key, async () => {
    const r = await apiClient.post(`/fire/admin/users/${uName.trim()}/${path}`, { reason: reason.trim() || "admin action" });
    toast.success(`${label} done${r.data.finalized !== undefined ? ` (${r.data.finalized} finalized)` : ""}${r.data.collected !== undefined ? ` (${r.data.collected} collected)` : ""}`);
    await inspectUser();
  });
  const reverseReaction = (rid) => run(`rev-${rid}`, async () => {
    if (!reason.trim()) { toast.error("Enter a reason first (required for reversal)"); return; }
    const r = await apiClient.post(`/fire/admin/reactions/${rid}/reverse`, { reason: reason.trim() });
    toast.success(`Reaction reversed (${r.data.fire_value ?? ""} 🔥)`);
    if (uData) await inspectUser();
    if (pData) await inspectPost();
  });

  const st = (s) => ({ collectable: "#10E670", pending: "#F4C84A", collected: "#5ec8ff", reversed: "#ff8080" }[s] || "var(--text-muted)");

  return (
    <div className="or-surface p-4" data-testid="fire-admin-inspector">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Search size={14} style={{ color: "#FF7A1A" }} /> Fire Inspector &amp; Controls (Phase 0.6)
      </div>
      <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
        Inspect any user's fire state or any post's fire ledger. Pause abusers, force-finalize, collect on
        behalf, or reverse a specific reaction (reason required, fully audited).
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
        <input className="or-input" style={{ width: 160 }} placeholder="username"
          value={uName} onChange={(e) => setUName(e.target.value)} data-testid="fire-inspect-user-input" />
        <button className="or-chip" onClick={inspectUser} data-testid="fire-inspect-user-btn">
          {busy === "iu" ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} Inspect user
        </button>
        <input className="or-input" style={{ width: 220 }} placeholder="reason (for actions below)"
          value={reason} onChange={(e) => setReason(e.target.value)} data-testid="fire-inspect-reason-input" />
      </div>

      {uData && (
        <div className="text-xs mb-3 p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }} data-testid="fire-inspect-user-result">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <b>@{uData.user.username}</b>
            {uData.user.fire_paused && <span className="or-chip" style={{ color: "#ff8080" }}>FIRE PAUSED</span>}
            <span style={{ color: "var(--text-muted)" }}>
              Pool {uData.pool.available}/{uData.pool.pool} · Vault {uData.wallet.vault_balance} 🔥 ·
              Pending {uData.wallet.pending_balance} 🔥 · Collectable {uData.wallet.collectable_balance ?? 0} 🔥 ·
              Given {uData.fire_given} 🔥
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {!uData.user.fire_paused ? (
              <button className="or-chip" style={{ color: "#ff8080" }} data-testid="fire-inspect-pause"
                onClick={() => userAction("pause", "pause-fire", "Fire paused")}>
                {busy === "pause" ? <Loader2 size={11} className="animate-spin" /> : <ShieldAlert size={11} />} Pause fire
              </button>
            ) : (
              <button className="or-chip" style={{ color: "#10E670" }} data-testid="fire-inspect-restore"
                onClick={() => userAction("restore", "restore-fire", "Fire restored")}>
                {busy === "restore" ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Restore fire
              </button>
            )}
            <button className="or-chip" data-testid="fire-inspect-finalize"
              onClick={() => userAction("fin", "finalize-pending", "Force-finalize")}>
              {busy === "fin" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Force-finalize pending
            </button>
            <button className="or-chip" data-testid="fire-inspect-collect"
              onClick={() => userAction("col", "collect", "Collect on behalf")}>
              {busy === "col" ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />} Collect on behalf
            </button>
          </div>
          <div className="font-semibold mb-1">Active reactions (latest 15)</div>
          <div className="max-h-40 overflow-y-auto" data-testid="fire-inspect-user-reactions">
            {(uData.active_reactions || []).length === 0 ? <div style={{ color: "var(--text-muted)" }}>None</div>
              : uData.active_reactions.map((r) => (
                <div key={r.id} className="py-1 flex flex-wrap items-center gap-2" style={{ borderTop: "1px solid var(--border-col)", color: "var(--text-muted)" }}>
                  {r.fire_value}× 🔥 on post {r.post_id?.slice(0, 8)}… · {r.active ? "active" : "removed"}
                  {r.finalized_at ? " · finalized" : ""}
                  <button className="or-chip" style={{ color: "#ff8080" }} data-testid={`fire-reverse-${r.id}`}
                    onClick={() => reverseReaction(r.id)}>
                    {busy === `rev-${r.id}` ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />} Reverse
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
        <input className="or-input" style={{ width: 280 }} placeholder="post id"
          value={pId} onChange={(e) => setPId(e.target.value)} data-testid="fire-inspect-post-input" />
        <button className="or-chip" onClick={inspectPost} data-testid="fire-inspect-post-btn">
          {busy === "ip" ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} Inspect post
        </button>
      </div>

      {pData && (
        <div className="text-xs p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }} data-testid="fire-inspect-post-result">
          <div className="mb-1">
            <b>@{pData.post.author_username}</b> — {pData.post.fire_total ?? 0} 🔥 total ·
            {" "}{pData.supporter_count} supporters · largest {pData.largest_fire}× ·
            {" "}{pData.standard_fire} standard / {pData.boosted_fire} boosted
          </div>
          <div style={{ color: "var(--text-muted)" }} className="mb-2">"{(pData.post.content || "").slice(0, 100)}"</div>
          <div className="font-semibold mb-1">Wallet credits by status</div>
          <div className="flex flex-wrap gap-2 mb-2">
            {Object.entries(pData.wallet_credits_by_status || {}).map(([s, v]) => (
              <span key={s} className="or-chip" style={{ color: st(s) }}>{s}: {v.total} 🔥 ({v.count})</span>
            ))}
          </div>
          <div className="max-h-40 overflow-y-auto" data-testid="fire-inspect-post-reactions">
            {(pData.reactions || []).map((r) => (
              <div key={r.id} className="py-1 flex flex-wrap items-center gap-2" style={{ borderTop: "1px solid var(--border-col)", color: "var(--text-muted)" }}>
                @{r.username || r.user_id?.slice(0, 8)} — {r.fire_value}× 🔥 · {r.active ? "active" : "removed"}
                <button className="or-chip" style={{ color: "#ff8080" }} data-testid={`fire-post-reverse-${r.id}`}
                  onClick={() => reverseReaction(r.id)}>
                  {busy === `rev-${r.id}` ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />} Reverse
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminFirePower() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [execReport, setExecReport] = useState(null);
  const [reconcile, setReconcile] = useState(null);
  const [rollback, setRollback] = useState(null);
  const [phrase, setPhrase] = useState("");
  const [rollbackPhrase, setRollbackPhrase] = useState("");
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get("/fire/admin/overview");
      setData(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Load failed"); }
  }, []);
  useEffect(() => { if (user?.role === "founder") load(); }, [user, load]);

  if (user && user.role !== "founder") {
    return <div className="or-surface p-8 text-center max-w-md mx-auto" data-testid="fire-admin-guard">Founder access only.</div>;
  }

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(null); }
  };

  return (
    <div className="max-w-4xl mx-auto" data-testid="fire-admin-page">
      <button className="or-chip mb-3" onClick={() => navigate("/admin")}><ChevronLeft size={12} /> Admin Hub</button>
      <h1 className="text-2xl sm:text-3xl mb-1 flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
        <Flame size={26} style={{ color: "#FF7A1A" }} /> Fire Power
      </h1>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Progression-based Fire reactions for public posts. Everything here is founder-flag gated and
        defaults OFF. Legacy likes are never deleted. Private-message emoji reactions are untouched.
      </p>

      {!data ? <Loader2 className="animate-spin" /> : (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center" data-testid="fire-admin-stats">
            {[["Active fire reactions", data.stats.fire_reactions_total],
              ["From migration", data.stats.fire_reactions_migrated],
              ["Active boosts (24h)", data.stats.active_boost_transactions],
              ["Public posts w/ likes", data.stats.legacy_public_likes_posts]].map(([k, v]) => (
              <div key={k} className="or-surface p-3">
                <div className="text-xl font-bold" style={{ color: "#FF7A1A" }}>{v}</div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{k}</div>
              </div>
            ))}
          </div>

          {/* Flags */}
          <div className="or-surface p-4" data-testid="fire-admin-flags">
            <div className="text-sm font-semibold mb-2">Feature flags (all default OFF)</div>
            {Object.entries(data.flags).map(([k, v]) => (
              <label key={k} className="flex items-center gap-3 py-1.5 text-sm" data-testid={`fire-flag-${k}`}>
                <input type="checkbox" checked={!!v}
                  onChange={(e) => apiClient.patch("/fire/admin/flags", { key: k, value: e.target.checked })
                    .then((r) => setData((d) => ({ ...d, flags: r.data.flags })))
                    .catch((err) => toast.error(err?.response?.data?.detail || "failed"))}
                  data-testid={`fire-flag-${k}-toggle`} />
                <span className="font-mono">{k}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{FLAG_LABELS[k]}</span>
              </label>
            ))}
            <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
              Rollback = turn flags OFF. All Fire data is preserved; the UI instantly falls back to Likes.
            </div>
          </div>

          {/* Level config */}
          <div className="or-surface p-4" data-testid="fire-admin-levels">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold">Level Fire limits (Max × per reaction · 24h boost pool)</div>
              <button className="or-chip" data-testid="fire-seed-defaults"
                onClick={() => run("seed", async () => {
                  const r = await apiClient.post("/fire/admin/seed-defaults");
                  toast.success(`Defaults written to ${r.data.updated.length} level(s)`);
                  await load();
                })}>
                {busy === "seed" ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Seed defaults
              </button>
            </div>
            <div className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>
              1× Fire is always unlimited for everyone. Only boosts (2×+) consume the pool: cost = fire − 1.
            </div>
            {data.levels.map((l) => <LevelFireRow key={l.id} level={l} onSaved={load} />)}
          </div>

          {/* Fire Vault / Wallets (Phase 0.5) */}
          <WalletAdminSection />

          {/* Phase 0.6 — command center */}
          <DashboardSection />
          <InspectorSection />

          {/* Migration */}
          <div className="or-surface p-4" data-testid="fire-admin-migration">
            <div className="text-sm font-semibold mb-1 flex items-center gap-2">
              <ShieldAlert size={14} style={{ color: "#F4C84A" }} /> Like → Fire migration (safe workflow)
            </div>
            <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
              Converts historical PUBLIC post likes into 1× Fire. Consumes zero Fire Pools, deletes zero
              likes, and never touches DM / group / community reactions. Idempotent — safe to re-run.
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button className="or-btn" data-testid="fire-migration-dry-run"
                onClick={() => run("dry", async () => { const r = await apiClient.post("/fire/admin/migration/dry-run"); setDryRun(r.data); })}>
                {busy === "dry" ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Dry Run (read-only)
              </button>
              <button className="or-chip" data-testid="fire-migration-reconcile"
                onClick={() => run("rec", async () => { const r = await apiClient.post("/fire/admin/migration/reconcile", { fix: false }); setReconcile(r.data); })}>
                <Scale size={11} /> Reconcile (audit)
              </button>
              <button className="or-chip" data-testid="fire-migration-reconcile-fix"
                onClick={() => run("recfix", async () => { const r = await apiClient.post("/fire/admin/migration/reconcile", { fix: true }); setReconcile(r.data); toast.success("Counters reconciled"); })}>
                <RefreshCw size={11} /> Reconcile + fix counters
              </button>
            </div>
            <ReportBlock title="Dry Run result" report={dryRun} testid="fire-dry-run-report" />
            <ReportBlock title="Reconciliation report" report={reconcile} testid="fire-reconcile-report" />

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input className="or-input" style={{ width: 230 }} placeholder='Type "MIGRATE LIKES TO FIRE"'
                value={phrase} onChange={(e) => setPhrase(e.target.value)} data-testid="fire-migration-phrase" />
              <button className="or-btn" data-testid="fire-migration-execute"
                onClick={() => run("exec", async () => {
                  const r = await apiClient.post("/fire/admin/migration/execute", { confirmation_phrase: phrase });
                  setExecReport(r.data); setPhrase("");
                  toast.success(`Migration complete — ${r.data.reactions_created} fire reactions created`);
                  await load();
                })}>
                {busy === "exec" ? <Loader2 size={13} className="animate-spin" /> : <Flame size={13} />} Execute migration
              </button>
            </div>
            <ReportBlock title="Execution report" report={execReport} testid="fire-execute-report" />

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input className="or-input" style={{ width: 260 }} placeholder='Type "ROLLBACK FIRE MIGRATION"'
                value={rollbackPhrase} onChange={(e) => setRollbackPhrase(e.target.value)} data-testid="fire-rollback-phrase" />
              <button className="or-chip" style={{ color: "#ff8080" }} data-testid="fire-migration-rollback"
                onClick={() => run("roll", async () => {
                  const r = await apiClient.post("/fire/admin/migration/rollback", { confirmation_phrase: rollbackPhrase });
                  setRollback(r.data); setRollbackPhrase("");
                  toast.success(`Rollback complete — ${r.data.reactions_removed} migrated reactions removed`);
                  await load();
                })}>
                {busy === "roll" ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />} Roll back migration
              </button>
            </div>
            <ReportBlock title="Rollback report" report={rollback} testid="fire-rollback-report" />

            {(data.migration_log || []).length > 0 && (
              <div className="mt-3 text-xs" data-testid="fire-migration-log">
                <div className="font-semibold mb-1">Migration history</div>
                {data.migration_log.map((l) => (
                  <div key={l.id} style={{ color: "var(--text-muted)" }}>
                    · {l.executed_at} — {l.action} by @{l.executed_by}
                    {l.action === "execute" && ` (${l.reactions_created} created)`}
                    {l.action === "rollback" && ` (${l.reactions_removed} removed)`}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
