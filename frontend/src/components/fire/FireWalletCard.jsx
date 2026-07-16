/**
 * FireWalletCard — private Fire Wallet (Phase 0.5). Rendered ONLY for
 * the signed-in user and ONLY when the founder `fire_wallet_enabled`
 * flag is ON (backend returns {enabled:false} otherwise → renders null).
 * `compact` = Home dashboard summary strip; default = full Profile card.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Lock, Clock, ChevronRight } from "lucide-react";
import apiClient from "@/api/client";

const FIRE_COLOR = "#FF7A1A";

function recoveryLabel(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "moments";
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const fmt = (n) => (n ?? 0).toLocaleString();

export default function FireWalletCard({ compact = false }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let on = true;
    apiClient.get("/fire/wallet")
      .then((r) => { if (on) setData(r.data); })
      .catch(() => { if (on) setData({ enabled: false }); });
    return () => { on = false; };
  }, []);

  if (!data?.enabled) return null;
  const { wallet, pool } = data;

  if (compact) {
    return (
      <div className="or-surface p-3 mb-4 flex items-center gap-3 flex-wrap" data-testid="fire-wallet-compact">
        <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: FIRE_COLOR }}>
          <Flame size={15} fill={FIRE_COLOR} /> Fire Wallet
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="fire-wallet-compact-pool">
          Pool: <b style={{ color: "var(--text-main)" }}>{fmt(pool?.available)}/{fmt(pool?.pool_max)}</b>
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="fire-wallet-compact-vault">
          Vault: <b style={{ color: FIRE_COLOR }}>{fmt(wallet?.vault_balance)} 🔥</b>
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="fire-wallet-compact-pending">
          Pending: <b style={{ color: "#F4C84A" }}>{fmt(wallet?.pending_balance)} 🔥</b>
        </span>
        <Link to="/profile" className="or-chip ml-auto" data-testid="fire-wallet-compact-link">
          View wallet <ChevronRight size={11} />
        </Link>
      </div>
    );
  }

  return (
    <div className="or-surface p-4 sm:p-5 mb-5" data-testid="fire-wallet-card">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="flex items-center gap-2 text-base font-bold" style={{ color: FIRE_COLOR }}>
          <Flame size={18} fill={FIRE_COLOR} /> Fire Wallet
        </span>
        <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ml-auto flex items-center gap-1"
          style={{ border: "1px solid var(--border-col)", color: "var(--text-muted)" }}
          data-testid="fire-wallet-locked-note">
          <Lock size={9} /> Vault not spendable yet
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Daily Fire Pool</div>
          <div className="text-lg font-bold" style={{ color: "var(--text-main)" }} data-testid="fire-wallet-pool">
            {fmt(pool?.available)} <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>/ {fmt(pool?.pool_max)}</span>
          </div>
          {pool?.next_recovery_at && (
            <div className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: "var(--text-muted)" }} data-testid="fire-wallet-recovery">
              <Clock size={9} /> +{pool.next_recovery_amount} in {recoveryLabel(pool.next_recovery_at)}
            </div>
          )}
        </div>
        <div className="p-3 rounded-xl" style={{ border: `1px solid color-mix(in srgb, ${FIRE_COLOR} 40%, transparent)`, background: "color-mix(in srgb, #FF7A1A 6%, transparent)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Vault</div>
          <div className="text-lg font-bold" style={{ color: FIRE_COLOR }} data-testid="fire-wallet-vault">
            {fmt(wallet?.vault_balance)} 🔥
          </div>
        </div>
        <div className="p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Pending</div>
          <div className="text-lg font-bold" style={{ color: "#F4C84A" }} data-testid="fire-wallet-pending">
            {fmt(wallet?.pending_balance)} 🔥
          </div>
        </div>
        <div className="p-3 rounded-xl" style={{ border: "1px solid var(--border-col)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Lifetime Earned</div>
          <div className="text-lg font-bold" style={{ color: "var(--text-main)" }} data-testid="fire-wallet-lifetime">
            {fmt(wallet?.lifetime_fire_earned)} 🔥
          </div>
        </div>
      </div>

      <div className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }}>
        Fire you receive from other Realm members lands as Pending, then settles into your permanent Vault
        after {data.settlement_hours}h. Vault Fire never expires — spending it unlocks in a future phase. 🔥
      </div>

      <div className="flex flex-wrap gap-4 mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
        <span data-testid="fire-wallet-given">
          Fire Given: <b style={{ color: "var(--text-main)" }}>{fmt(data.fire_given)} 🔥</b>
        </span>
        <span data-testid="fire-wallet-received">
          Fire Received: <b style={{ color: "var(--text-main)" }}>{fmt(data.fire_received)} 🔥</b>
        </span>
      </div>

      {(data.recent || []).length > 0 && (
        <div className="mt-3" data-testid="fire-wallet-history">
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
            Recent earnings
          </div>
          {data.recent.map((t, i) => (
            <div key={i} className="text-[11px] py-1 flex items-center gap-2"
              style={{ borderTop: "1px solid var(--border-col)", color: "var(--text-muted)" }}>
              <span style={{ color: FIRE_COLOR }}>+{t.amount} 🔥</span>
              <span>from @{t.sender_username || "member"}</span>
              <span className="ml-auto" style={{ color: t.status === "settled" ? "#10E670" : "#F4C84A" }}>
                {t.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
