/**
 * FireWalletCard — premium Fire Power interface (owner-only).
 * Full interactive card on the owner's own profiles (Edit Profile +
 * public profile when viewing yourself); `compact` summary on Home.
 * Flag-gated by fire_wallet_enabled; sections additionally gated by
 * pending / collectable / collection / history flags from the backend.
 * Supports a one-shot deep link (sessionStorage "ourrealm.fire.deeplink")
 * set by the 🔥-ready notification: expands, scrolls into view and
 * briefly highlights — then the flag is consumed so normal visits
 * always open collapsed.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Flame, Clock, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { CollapsibleHeader, useAccordionState } from "@/components/progression/CollapsibleHeader";

const FIRE = "#FF7A1A";
const GOLD = "#F4C84A";
const GREEN = "#10E670";

function timeLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "moments";
  const t = Math.ceil(ms / 60000);
  const h = Math.floor(t / 60);
  return h > 0 ? `${h}h ${t % 60}m` : `${t % 60}m`;
}
const fmt = (n) => (n ?? 0).toLocaleString();

/** FIRE UP 🔥 — Vault → Daily Pool refill. All amounts are computed
 * server-side; the confirm POST carries only an idempotency key. */
function FireUpSection({ fireUp, onDone }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);
  const keyRef = useRef(null);

  // Cooldown display tick (display only — server is authoritative).
  // When it reaches zero we revalidate via onDone(refresh).
  useEffect(() => {
    if (!fireUp?.next_fire_up_at || fireUp.eligible) return;
    const iv = setInterval(() => {
      if (new Date(fireUp.next_fire_up_at).getTime() <= Date.now()) onDone(null);
      else forceTick((t) => t + 1);
    }, 30000);
    return () => clearInterval(iv);
  }, [fireUp?.next_fire_up_at, fireUp?.eligible, onDone]);

  if (!fireUp) return null;
  const amt = fireUp.calculated_transfer_amount || 0;

  const execute = async () => {
    if (busy) return;
    setBusy(true);
    if (!keyRef.current) keyRef.current = (crypto.randomUUID ? crypto.randomUUID() : `fu-${Date.now()}`);
    try {
      const { data } = await apiClient.post("/fire/fire-up", { idempotency_key: keyRef.current });
      toast.success(`🔥 FIRE UP COMPLETE — ${fmt(data.transferred_amount)} 🔥 moved to your Daily Pool (${fmt(data.daily_available_after)} / ${fmt(data.daily_pool_max)}).`);
      onDone(data);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : (d?.message || "Fire Up could not be completed. Your balances were not changed."));
      onDone(null);
    } finally { setBusy(false); setConfirmOpen(false); keyRef.current = null; }
  };

  if (fireUp.eligible && amt > 0) {
    return (
      <div className="mt-3 pt-3" style={{ borderTop: `1px solid color-mix(in srgb, ${FIRE} 30%, transparent)` }} data-testid="fire-up-section">
        <div className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }} data-testid="fire-up-hint">
          {fireUp.is_partial_refill
            ? `Use your remaining ${fmt(amt)} 🔥 to restore your Daily Pool to ${fmt(fireUp.resulting_daily_available)} / ${fmt(fireUp.daily_pool_max)}.`
            : `Use ${fmt(amt)} 🔥 from your Vault to restore your Daily Pool to ${fmt(fireUp.resulting_daily_available)} / ${fmt(fireUp.daily_pool_max)}.`}
        </div>
        <button className="or-btn w-full font-bold" style={{ background: FIRE, color: "#160A02", minHeight: 46 }}
          onClick={() => setConfirmOpen(true)} disabled={busy} data-testid="fire-up-btn">
          <Flame size={15} fill="#160A02" /> FIRE UP {fmt(amt)} 🔥
        </button>
        {confirmOpen && createPortal(
          <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-0 sm:p-4"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
            onClick={() => !busy && setConfirmOpen(false)} data-testid="fire-up-confirm-overlay">
            <div className="or-surface w-full sm:max-w-sm p-5 rounded-t-2xl sm:rounded-2xl"
              style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
              onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-testid="fire-up-confirm-modal">
              <div className="text-sm font-bold mb-1" style={{ color: FIRE }}>FIRE UP YOUR DAILY POOL?</div>
              <div className="text-xs mb-3" style={{ color: "var(--text-main)" }}>
                {fireUp.is_partial_refill
                  ? <>Your Vault does not contain enough Fire for a complete refill.<br />Use your remaining <b style={{ color: FIRE }}>{fmt(amt)} 🔥</b>?</>
                  : <>Use <b style={{ color: FIRE }}>{fmt(amt)} 🔥</b> from your Fire Vault?</>}
              </div>
              <div className="text-xs space-y-1 mb-3 p-3 rounded-xl" style={{ border: "1px solid var(--border-col)", color: "var(--text-muted)" }} data-testid="fire-up-confirm-preview">
                <div>Daily Pool: <b style={{ color: "var(--text-main)" }}>{fmt(fireUp.current_daily_available)} → {fmt(fireUp.resulting_daily_available)}</b> / {fmt(fireUp.daily_pool_max)}</div>
                <div>Fire Vault: <b style={{ color: FIRE }}>{fmt(fireUp.current_vault_balance)} → {fmt(fireUp.resulting_vault_balance)}</b></div>
                <div className="text-[10px] pt-1">You can Fire Up again 24 hours after this transfer.</div>
              </div>
              <div className="flex gap-2">
                <button className="or-chip flex-1 justify-center" style={{ minHeight: 44 }} disabled={busy}
                  onClick={() => setConfirmOpen(false)} data-testid="fire-up-cancel">CANCEL</button>
                <button className="or-btn flex-1 font-bold" style={{ background: FIRE, color: "#160A02", minHeight: 44 }}
                  onClick={execute} disabled={busy} data-testid="fire-up-confirm">
                  {busy ? "…" : `FIRE UP ${fmt(amt)} 🔥`}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  // Unavailable states — clear reasons, backend authoritative.
  let msg = null;
  if (fireUp.reason === "cooldown" && fireUp.next_fire_up_at) {
    const abs = new Date(fireUp.next_fire_up_at);
    msg = (
      <span data-testid="fire-up-cooldown">
        FIRE UP AVAILABLE IN <b style={{ color: FIRE }}>{timeLeft(fireUp.next_fire_up_at)}</b>
        <span className="block text-[10px] mt-0.5">
          Available again {abs.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
        </span>
      </span>
    );
  } else if (fireUp.reason === "pool_full") msg = <span data-testid="fire-up-pool-full">Your Daily Fire Pool is already full.</span>;
  else if (fireUp.reason === "vault_empty") msg = <span data-testid="fire-up-vault-empty">You need Fire in your Vault before you can Fire Up.</span>;
  else if (fireUp.reason === "wallet_paused") msg = <span data-testid="fire-up-paused">Fire Up is temporarily unavailable for this account.</span>;
  if (!msg) return null;
  return (
    <div className="mt-3 pt-3 text-[11px] uppercase tracking-widest" data-testid="fire-up-section"
      style={{ borderTop: `1px solid color-mix(in srgb, ${FIRE} 30%, transparent)`, color: "var(--text-muted)" }}>
      {msg}
    </div>
  );
}

const HISTORY_FILTERS = ["all", "pending", "collectable", "collected", "given", "received", "reversed"];

function StatTile({ label, value, accent, testid, sub }) {
  return (
    <div className="p-3 rounded-xl min-w-0" style={{
      border: `1px solid ${accent ? `color-mix(in srgb, ${accent} 40%, transparent)` : "var(--border-col)"}`,
      background: accent ? `color-mix(in srgb, ${accent} 7%, transparent)` : "transparent",
    }}>
      <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-lg sm:text-xl font-bold break-words" style={{ color: accent || "var(--text-main)" }} data-testid={testid}>{value}</div>
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
  const [highlight, setHighlight] = useState(false);
  const rootRef = useRef(null);

  const load = () => apiClient.get("/fire/wallet")
    .then((r) => setData(r.data))
    .catch(() => setData({ enabled: false }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One-shot notification deep link: expand + scroll + brief highlight.
  // Consumed immediately so refreshes / normal visits stay collapsed.
  useEffect(() => {
    if (compact || !data?.enabled) return;
    let wanted = false;
    try {
      wanted = sessionStorage.getItem("ourrealm.fire.deeplink") === "1";
      if (wanted) sessionStorage.removeItem("ourrealm.fire.deeplink");
    } catch { /* ignore */ }
    if (!wanted) return;
    setExpanded(true);
    setHighlight(true);
    const t1 = setTimeout(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
    const t2 = setTimeout(() => setHighlight(false), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [compact, data?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <span className="text-xs font-bold" style={{ color: GREEN }} data-testid="fire-wallet-compact-collectable">
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
    if (busy) return; // double-click / multi-tab guard (backend is also idempotent)
    setBusy(true);
    try {
      const r = await apiClient.post("/fire/wallet/collect", { collect_all: true });
      toast.success(`${fmt(r.data.collected)} 🔥 Collected into your Vault!`);
      setData((d) => ({ ...d, wallet: r.data.wallet }));
    } catch (e) { toast.error(e?.response?.data?.detail || "Collection failed"); }
    finally { setBusy(false); setConfirming(false); }
  };

  const poolPct = pool?.pool_max > 0 ? Math.min(100, (pool.available / pool.pool_max) * 100) : 0;
  const collectable = wallet?.collectable_balance || 0;

  // Fire Up completion / countdown-expiry: apply server response
  // instantly, then re-sync the whole wallet (single request).
  const onFireUpDone = (result) => {
    if (result?.success) {
      setData((d) => ({
        ...d,
        wallet: { ...d.wallet, vault_balance: result.vault_balance_after },
        pool: { ...d.pool, available: result.daily_available_after,
                spent: Math.max(0, (result.daily_pool_max ?? d.pool.pool_max) - result.daily_available_after) },
        fire_up: { ...d.fire_up, eligible: false, reason: "cooldown",
                   calculated_transfer_amount: 0,
                   current_vault_balance: result.vault_balance_after,
                   current_daily_available: result.daily_available_after,
                   last_fire_up_at: result.last_fire_up_at,
                   next_fire_up_at: result.next_fire_up_at },
      }));
    }
    load();
  };

  return (
    <div ref={rootRef} className="or-surface p-4 sm:p-6 mb-5 overflow-hidden relative"
      data-testid="fire-wallet-card"
      style={highlight ? {
        outline: `2px solid ${FIRE}`,
        boxShadow: `0 0 28px color-mix(in srgb, ${FIRE} 45%, transparent)`,
        transition: "box-shadow 400ms, outline-color 400ms",
      } : undefined}>
      {/* Title (collapsible on profiles, static elsewhere) */}
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
            <Flame size={24} fill={FIRE} /> FIRE POWER
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Earn Fire from the community by creating great content.
          </p>
        </div>
      )}

      {(!collapsible || expanded) && (
      <div className={collapsible ? "mt-2.5" : ""}>
      {/* 1 — Daily Fire Pool */}
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
          Boosted Fire recovers exactly 24 hours after each spend. Standard 1× Fire is always unlimited.
        </div>
      </div>

      {/* 2 — Fire Vault (centerpiece) + FIRE UP */}
      <div className="p-5 sm:p-6 rounded-2xl mb-4 text-center relative overflow-hidden" data-testid="fire-wallet-vault-section" style={{
        border: `1px solid color-mix(in srgb, ${FIRE} 55%, transparent)`,
        background: `radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, ${FIRE} 18%, transparent), transparent 65%)`,
        boxShadow: `inset 0 0 40px color-mix(in srgb, ${FIRE} 8%, transparent)`,
      }}>
        <img src="/fire-power-icon.png" alt="" aria-hidden="true"
          className="mx-auto mb-1"
          style={{ width: 64, height: 64, objectFit: "contain", filter: `drop-shadow(0 0 14px color-mix(in srgb, ${FIRE} 60%, transparent))` }} />
        <div className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: FIRE }}>🔥 Fire Vault</div>
        <div className="text-4xl sm:text-5xl font-bold" style={{ color: FIRE, textShadow: `0 0 22px color-mix(in srgb, ${FIRE} 45%, transparent)` }} data-testid="fire-wallet-vault">
          {fmt(wallet?.vault_balance)} 🔥
        </div>
        <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
          Collected Fire you have saved. Use it to Fire Up your Daily Pool.
        </div>
        <FireUpSection fireUp={data.fire_up} onDone={onFireUpDone} />
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        {/* 3 — Pending */}
        {features.pending && (
          <div data-testid="fire-wallet-pending-section">
            <StatTile label="Pending Fire" accent={GOLD} testid="fire-wallet-pending"
              value={`${fmt(wallet?.pending_balance)} 🔥`}
              sub={wallet?.next_finalization_at
                ? `Fire appears here temporarily while senders can still edit or remove their Fire. Next finalizes in ${timeLeft(wallet.next_finalization_at)} · ${wallet.pending_count} pending`
                : "Fire appears here temporarily while senders can still edit or remove their Fire."} />
          </div>
        )}
        {/* 4 — Collectable */}
        {features.collectable && (
          <div data-testid="fire-wallet-collectable-section">
            <StatTile label="Collectable Fire" accent={GREEN} testid="fire-wallet-collectable"
              value={`${fmt(collectable)} 🔥`}
              sub={collectable > 0 ? "Ready to collect." : "Finalized Fire waits here — it never expires."} />
          </div>
        )}
      </div>

      {features.collection && collectable > 0 && (
        <div className="mb-4" data-testid="fire-wallet-collect-controls">
          {confirming ? (
            <div className="p-3 rounded-xl flex items-center gap-2 flex-wrap" style={{ border: `1px solid ${GREEN}` }}>
              <span className="text-xs" style={{ color: "var(--text-main)" }}>
                Collect {fmt(collectable)} 🔥 into your Fire Vault?
              </span>
              <button className="or-btn" onClick={collectAll} disabled={busy} data-testid="fire-collect-confirm">
                Collect Fire
              </button>
              <button className="or-chip" onClick={() => setConfirming(false)} data-testid="fire-collect-cancel">Cancel</button>
            </div>
          ) : (
            <button className="or-btn w-full text-sm sm:text-base font-bold" onClick={() => setConfirming(true)} disabled={busy}
              style={{ background: GREEN, color: "#08130B", minHeight: 48 }} data-testid="fire-collect-all-btn">
              <Flame size={16} /> COLLECT ALL FIRE ({fmt(collectable)} 🔥)
            </button>
          )}
        </div>
      )}

      {/* 5 — Statistics */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4" data-testid="fire-wallet-lifetime-section">
        <StatTile label="Fire Received" value={`${fmt(wallet?.lifetime_fire_received)} 🔥`} testid="fire-wallet-lifetime" />
        <StatTile label="Fire Given" value={`${fmt(data.fire_given)} 🔥`} testid="fire-wallet-given" />
        <StatTile label="Fire Collected" value={`${fmt(wallet?.lifetime_fire_collected)} 🔥`} testid="fire-wallet-collected" />
      </div>

      {/* 6 — Wallet history (flag-gated, unchanged behavior) */}
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
                      {t.type === "fire_up" ? (<>
                        <b style={{ color: FIRE }}>-{t.amount} 🔥</b>
                        <span>Fire Up → Daily Pool ({t.daily_available_before} → {t.daily_available_after} / {t.daily_pool_max})</span>
                        <span className="px-1.5 rounded-full text-[9px] uppercase font-bold" style={{ color: FIRE, border: "1px solid var(--border-col)" }}>fire up</span>
                      </>) : (<>
                      <b style={{ color: t.amount >= 0 ? FIRE : "#ff8080" }}>{t.amount >= 0 ? "+" : ""}{t.amount} 🔥</b>
                      <span>{t.direction === "given" ? `to @${t.receiver_username || "member"}` : `from @${t.sender_username || "member"}`}</span>
                      <span className="px-1.5 rounded-full text-[9px] uppercase font-bold" style={{
                        color: { pending: GOLD, collectable: GREEN, collected: FIRE, settled: FIRE, reversed: "#ff8080" }[t.status] || "var(--text-muted)",
                        border: "1px solid var(--border-col)",
                      }}>{t.status}</span>
                      </>)}
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
