/**
 * PublicFireStats — privacy-filtered fire stats on public profiles.
 * The backend only sends values the viewer may see; hidden stats
 * arrive as {visible:false} and render as "🔒 Private" (no value in
 * JSON, HTML, tooltips or aria labels). Null when the wallet flag is
 * OFF or nothing to show.
 */
import React, { useEffect, useState } from "react";
import { Flame, Lock } from "lucide-react";
import apiClient from "@/api/client";

const LABELS = [
  ["lifetime_fire", "Lifetime Fire"],
  ["fire_received", "Fire Received"],
  ["fire_given", "Fire Given"],
  ["vault_balance", "Vault Balance"],
];

export default function PublicFireStats({ username }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!username) return;
    let on = true;
    apiClient.get(`/fire/wallet/stats/${username}`)
      .then((r) => { if (on) setData(r.data); })
      .catch(() => { if (on) setData({ enabled: false }); });
    return () => { on = false; };
  }, [username]);

  if (!data?.enabled || !data.stats) return null;

  return (
    <div className="or-surface p-4 mb-5" data-testid="public-fire-stats">
      <div className="flex items-center gap-2 mb-3">
        <Flame size={15} style={{ color: "#FF7A1A" }} fill="#FF7A1A" />
        <span className="text-sm font-bold" style={{ color: "#FF7A1A" }}>Fire Stats</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {LABELS.map(([key, label]) => {
          const s = data.stats[key] || { visible: false };
          return (
            <div key={key} className="p-2.5 rounded-xl text-center"
              style={{ border: "1px solid var(--border-col)" }}
              data-testid={`public-fire-stat-${key}`}>
              <div className="text-sm font-bold"
                style={{ color: s.visible ? "var(--text-main)" : "var(--text-muted)" }}
                data-testid={`public-fire-stat-${key}-value`}>
                {s.visible ? `${(s.value ?? 0).toLocaleString()} 🔥` : (
                  <span className="inline-flex items-center gap-1 text-xs" aria-label="Private">
                    <Lock size={10} /> Private
                  </span>
                )}
              </div>
              <div className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-muted)" }}>
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
