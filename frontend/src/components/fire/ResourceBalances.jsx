import React, { useEffect, useState } from "react";
import apiClient from "@/api/client";

/* Shared engagement resource balances (Stars, Keys, Coins, Gems, …) —
   one canonical account balance across all games. Fire Power keeps its
   own Pending → Collectable → Vault card above. */
export const ResourceBalances = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get("/resources/me").then((r) => setData(r.data)).catch(() => {});
  }, []);
  if (!data) return null;
  const rows = (data.balances || []).filter((b) => b.key !== "fire");
  if (!rows.length) return null;
  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-col)" }} data-testid="resource-balances">
      <div className="text-[9.5px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
        Resources — shared across all OurRealm games</div>
      <div className="flex gap-2 flex-wrap">
        {rows.map((b) => (
          <div key={b.key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
            style={{ background: `color-mix(in srgb, ${b.color} 12%, transparent)`, border: `1px solid ${b.color}55` }}
            data-testid={`resource-balance-${b.key}`} title={b.description}>
            <span className="text-sm">{b.icon}</span>
            <b className="text-xs" style={{ color: b.color }}>{Number(b.balance || 0).toLocaleString()}</b>
            <span className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{b.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
