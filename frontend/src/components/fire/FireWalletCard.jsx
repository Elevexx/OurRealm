/**
 * FireWalletCard — premium Fire economy interface (Phase 0.6).
 * Full card on own Profile; `compact` summary on Home. Flag-gated by
 * fire_wallet_enabled; sections additionally gated by pending /
 * collectable / collection / history flags from the backend.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Clock, ChevronRight, ChevronDown, Sparkles, Lock } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { CollapsibleHeader, useAccordionState } from "@/components/progression/CollapsibleHeader";

const FIRE = "#FF7A1A";
const GOLD = "#F4C84A";

function timeLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "moments";
  const t = Math.ceil(ms / 60000);
  const h = Math.floor(t / 60);
  return h > 0 ? `${h}h ${t % 60}m` : `${t % 60}m`;
}
const fmt = (n) => (n ?? 0).toLocaleString();

const FUTURE = ["Marketplace", "Portal Unlocks", "Staking", "Crafting", "Realm Upgrades", "Creator Rewards"];
const HISTORY_FILTERS = ["all", "pending", "collectable", "collected", "given", "received", "reversed"];

function StatTile({ label, value, accent, testid, sub }) {
  return (
    <div className="p-3 rounded-xl" style={{
      border: `1px solid ${accent ? `color-mix(in srgb, ${accent} 40%, transparent)` : "var(--border-col)"}`,
      background: accent ? `color-mix(in srgb, ${accent} 7%, transparent)` : "transparent",
    }}>
      <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-xl font-bold" style={{ color: accent || "var(--text-main)" }} data-testid={testid}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

export default function FireWalletCard({ compact = false, collapsible = false }) {
  const [data, setData] = useState(null);
  // Profile accordion — same behavior as Creator Progress / Progression
  // Badges: always collapsed on open, never persisted across visits.
  const [expanded, setExpanded] = useAccordionState("fire-wallet", false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = () => apiClient.get("/fire/wallet")
    .then((r) => setData(r.data))
    .catch(() => setData({ enabled: false }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!historyOpen || !data?.features?.history) return;
    apiClient.get("/fire/wallet/history", { params: { filter, limit: 30 } })
      .then((r) => setHistory(r.data.history)).catch(() => setHistory([]));
  }, [historyOpen, filter, data?.features?.history]);

  if (!data?.enabled) return null;
  const { wallet, pool, config, features = {} } = data;

  if (compact) {
    return (
      <div className="or-surface p-3 mb-4 flex items-center gap-3 flex-wrap" data-testid="fire-wallet-compact">
        <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: FIRE }}>
          <Flame size={15} fill={FIRE} /> Fire Wallet
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="fire-wallet-compact-pool">
          Pool: <b style={{ color: "var(--text-main)" }}>{fmt(pool?.available)}/{fmt(pool?.pool_max)}</b>
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="fire-wallet-compact-vault">
          Vault: <b style={{ color: FIRE }}>{fmt(wallet?.vault_balance)} 🔥</b>
        </span>
        {features.pending && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="fire-wallet-compact-pending">
            Pending: <b style={{ color: GOLD }}>{fmt(wallet?.pending_balance)} 🔥</b>
          </span>
        )}
        {features.collectable && (wallet?.collectable_balance || 0) > 0 && (
          <span className="text-xs font-bold" style={{ color: "#10E670" }} data-testid="fire-wallet-compact-collectable">
            {fmt(wallet.collectable_balance)} 🔥 ready
          </span>
        )}
        <Link to="/profile" className="or-chip ml-auto" data-testid="fire-wallet-compact-link">
          View wallet <ChevronRight size={11} />
        </Link>
      </div>
    );
  }

  const collectAll = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post("/fire/wallet/collect", { collect_all: true });
      toast.success(`${fmt(r.data.collected)} 🔥 Collected!`);
      setData((d) => ({ ...d, wallet: r.data.wallet }));
    } catch (e) { toast.error(e?.response?.data?.detail || "Collection failed"); }
    finally { setBusy(false); setConfirming(false); }
  };

  const poolPct = pool?.pool_max > 0 ? Math.min(100, (pool.available / pool.pool_max) * 100) : 0;
  const collectable = wallet?.collectable_balance || 0;

  return (
    <div className="or-surface p-4 sm:p-6 mb-5 overflow-hidden relative" data-testid="fire-wallet-card">
      {/* Section 1 — title (collapsible on profiles, static elsewhere) */}
      {collapsible ? (
        <CollapsibleHeader
          icon={<Flame size={16} style={{ color: FIRE }} fill={FIRE} aria-hidden="true" />}
          title="Fire Power"
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          testid="fire-wallet-header"
          titleTestid="fire-wallet-title"
          arrowTestid="fire-wallet-toggle"
        />
      ) : (
        <div className="mb-5">
          <h2 className="flex items-center gap-2.5 text-xl sm:text-2xl font-bold tracking-tight" style={{ color: FIRE, fontFamily: "var(--font-display)" }}>
            <Flame size={24} fill={FIRE} /> FIRE WALLET
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Earn Fire from the community by creating great content.
          </p>
        </div>
      )}

      {(!collapsible || expanded) && (
      <div className={collapsible ? "mt-2.5" : ""}>
      {/* Section 2 — Daily Fire Pool */}
      <div className="p-4 rounded-2xl mb-4" style={{ border: "1px solid var(--border-col)" }} data-testid="fire-wallet-pool-section">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Daily Fire Pool</span>
          <span className="text-sm font-bold" data-testid="fire-wallet-pool">
            {fmt(pool?.available)} <span style={{ color: "var(--text-muted)" }}>/ {fmt(pool?.pool_max)} available</span>
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: "color-mix(in srgb, var(--text-muted) 16%, transparent)" }}>
          <div className="h-full rounded-full" style={{ width: `${poolPct}%`, background: FIRE, transition: "width 500ms" }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span>Boosted used: <b style={{ color: "var(--text-main)" }}>{fmt(pool?.spent)}</b></span>
          <span>Max reaction: <b style={{ color: FIRE }}>{config?.max_fire_per_reaction}× 🔥</b></span>
          {config?.level_name && <span>Level {config.level_number} · {config.level_name}</span>}
          {pool?.next_recovery_at && (
            <span className="flex items-center gap-1" data-testid="fire-wallet-recovery">
              <Clock size={10} /> +{pool.next_recovery_amount} in {timeLeft(pool.next_recovery_at)}
            </span>
          )}
        </div>
        <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
          Boosts recover exactly 24h after each spend · Standard 1× Fire is always unlimited.
        </div>
      </div>

      {/* Section 3 — Permanent Fire Vault */}
      <div className="p-5 rounded-2xl mb-4 text-center" data-testid="fire-wallet-vault-section" style={{
        border: `1px solid color-mix(in srgb, ${FIRE} 45%, transparent)`,
        background: `linear-gradient(160deg, color-mix(in srgb, ${FIRE} 12%, transparent), transparent 70%)`,
      }}>
        <div className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: FIRE }}>Permanent Fire Vault</div>
        <div className="text-3xl sm:text-4xl font-bold" style={{ color: FIRE }} data-testid="fire-wallet-vault">
          {fmt(wallet?.vault_balance)} 🔥
        </div>
        <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
          Permanent Fire you have collected. It never expires.<br />
          Future OurRealm phases will unlock additional Fire utility.
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        {/* Section 4 — Pending */}
        {features.pending && (
          <div data-testid="fire-wallet-pending-section">
            <StatTile label="Pending Fire" accent={GOLD} testid="fire-wallet-pending"
              value={`${fmt(wallet?.pending_balance)} 🔥`}
              sub={wallet?.next_finalization_at
                ? `Next Fire finalizes in ${timeLeft(wallet.next_finalization_at)} · ${wallet.pending_count} pending`
                : "Fire you receive appears here while senders can still edit."} />
          </div>
        )}
        {/* Section 5 — Collectable */}
        {features.collectable && (
          <div data-testid="fire-wallet-collectable-section">
            <StatTile label="Collectable Fire" accent="#10E670" testid="fire-wallet-collectable"
              value={`${fmt(collectable)} 🔥`}
              sub={collectable > 0 ? "Ready to Collect" : "Finalized Fire waits here — it never expires."} />
          </div>
        )}
      </div>

      {features.collection && collectable > 0 && (
        <div className="mb-4" data-testid="fire-wallet-collect-controls">
          {confirming ? (
            <div className="p-3 rounded-xl flex items-center gap-2 flex-wrap" style={{ border: "1px solid #10E670" }}>
              <span className="text-xs" style={{ color: "var(--text-main)" }}>
                Collect {fmt(collectable)} 🔥 into your Permanent Fire Vault?
              </span>
              <button className="or-btn" onClick={collectAll} disabled={busy} data-testid="fire-collect-confirm">
                Collect Fire
              </button>
              <button className="or-chip" onClick={() => setConfirming(false)} data-testid="fire-collect-cancel">Cancel</button>
            </div>
          ) : (
            <button className="or-btn w-full" onClick={() => setConfirming(true)} disabled={busy}
              style={{ background: "#10E670", color: "#08130B" }} data-testid="fire-collect-all-btn">
              <Flame size={14} /> COLLECT ALL FIRE ({fmt(collectable)} 🔥)
            </button>
          )}
        </div>
      )}

      {/* Section 6 — Lifetime */}
      <div className="grid grid-cols-3 gap-3 mb-4" data-testid="fire-wallet-lifetime-section">
        <StatTile label="Received" value={`${fmt(wallet?.lifetime_fire_received)} 🔥`} testid="fire-wallet-lifetime" />
        <StatTile label="Given" value={`${fmt(data.fire_given)} 🔥`} testid="fire-wallet-given" />
        <StatTile label="Collected" value={`${fmt(wallet?.lifetime_fire_collected)} 🔥`} testid="fire-wallet-collected" />
      </div>

      {/* Section 7 — future utilities */}
      <div className="mb-2" data-testid="fire-wallet-future-section">
        <div className="text-[11px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <Sparkles size={11} /> Future Utilities
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FUTURE.map((f) => (
            <span key={f} className="text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1"
              style={{ border: "1px solid var(--border-col)", color: "var(--text-muted)" }}>
              <Lock size={8} /> {f} · Coming Later
            </span>
          ))}
        </div>
      </div>

      {/* Wallet history (flag-gated) */}
      {features.history && (
        <div className="mt-4" data-testid="fire-wallet-history-section">
          <button className="or-chip" onClick={() => setHistoryOpen((o) => !o)} data-testid="fire-wallet-history-toggle">
            <ChevronDown size={11} style={{ transform: historyOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
            Wallet History
          </button>
          {historyOpen && (
            <div className="mt-2">
              <div className="flex flex-wrap gap-1 mb-2">
                {HISTORY_FILTERS.map((f) => (
                  <button key={f} className="or-chip" onClick={() => setFilter(f)}
                    style={filter === f ? { color: FIRE, borderColor: FIRE } : undefined}
                    data-testid={`fire-history-filter-${f}`}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="max-h-56 overflow-y-auto text-[11px]" data-testid="fire-wallet-history-list">
                {history === null ? <span style={{ color: "var(--text-muted)" }}>Loading…</span>
                  : history.length === 0 ? <span style={{ color: "var(--text-muted)" }}>No transactions.</span>
                  : history.map((t, i) => (
                    <div key={i} className="py-1.5 flex items-center gap-2 flex-wrap"
                      style={{ borderTop: "1px solid var(--border-col)", color: "var(--text-muted)" }}>
                      <b style={{ color: t.amount >= 0 ? FIRE : "#ff8080" }}>{t.amount >= 0 ? "+" : ""}{t.amount} 🔥</b>
                      <span>{t.direction === "given" ? `to @${t.receiver_username || "member"}` : `from @${t.sender_username || "member"}`}</span>
                      <span className="px-1.5 rounded-full text-[9px] uppercase font-bold" style={{
                        color: { pending: GOLD, collectable: "#10E670", collected: FIRE, settled: FIRE, reversed: "#ff8080" }[t.status] || "var(--text-muted)",
                        border: "1px solid var(--border-col)",
                      }}>{t.status}</span>
                      <span className="ml-auto">{(t.created_at || "").slice(0, 10)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
}
