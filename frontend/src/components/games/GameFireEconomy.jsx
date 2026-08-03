import React, { useEffect, useState } from "react";
import { Flame, RefreshCcw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const REWARD_FIELDS = [
  ["completion", "Level completion"], ["perfect", "Perfect completion"], ["speed", "Speed bonus"],
  ["speed_time_s", "Speed limit (s)"], ["hidden_objective", "Hidden objective"], ["achievement", "Achievement"],
  ["boss", "Boss bonus"], ["daily", "Daily bonus"], ["weekly", "Weekly bonus"], ["final_completion", "Final completion"],
];

export default function GameFireEconomy({ gameId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiClient.get(`/admin/games/${gameId}/fire-economy`).then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { if (open && !data) load(); }, [open]); // eslint-disable-line
  const econ = data?.economy;

  const patch = async (body) => {
    setBusy(true);
    try {
      const r = await apiClient.patch(`/admin/games/${gameId}/fire-economy`, body);
      setData(r.data);
      toast.success("Fire economy saved — new version created");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="or-surface p-3 mt-3" data-testid="game-fire-economy">
      <button className="w-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "#FF8A5A" }} onClick={() => setOpen(!open)} data-testid="fire-econ-toggle">
        <Flame size={11} /> Fire Power Economy {open ? "▾" : "▸"}
        {econ && <span className="font-normal normal-case tracking-normal" style={{ color: "var(--text-muted)" }}>
          {econ.enabled ? (econ.paused ? "(paused)" : `${econ.pool.toLocaleString()} 🔥 remaining`) : "(disabled)"}
        </span>}
      </button>
      {open && econ && (
        <div className="mt-3">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-2 text-center">
            {[["Pool remaining", econ.pool.toLocaleString(), "#FF8A5A"],
              ["Distributed", (data.analytics.distributed || 0).toLocaleString(), "#F4A73B"],
              ["Claimed", (data.analytics.claimed || 0).toLocaleString(), "#10E670"],
              ["Claimants", data.analytics.unique_claimants, "#2EE6FF"],
              ["Largest", data.analytics.largest_reward, "#C26BFF"]].map(([l, v, c]) => (
              <div key={l} className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="text-sm font-bold" style={{ color: c }}>{v}</div>
                <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{l}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] mb-2 flex gap-3 flex-wrap" style={{ color: "var(--text-muted)" }} data-testid="fire-econ-analytics">
            <span>Avg reward: <b>{data.analytics.avg_reward}</b></span>
            <span>Claims today: <b>{data.analytics.claims_today}</b></span>
            <span>Week: <b>{data.analytics.claims_week}</b></span>
            <span>Month: <b>{data.analytics.claims_month}</b></span>
            <span>Pool: <b style={{ color: "#FF8A5A" }}>{data.preview.pool_pct_remaining}%</b></span>
          </div>
          <div className="flex gap-2 items-center flex-wrap mb-2">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={!!econ.enabled} className="accent-[#FF8A5A]" disabled={busy}
                onChange={(e) => patch({ enabled: e.target.checked })} data-testid="fire-econ-enabled" />
              <b>Rewards enabled</b>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={!!econ.paused} className="accent-[#F4A73B]" disabled={busy}
                onChange={(e) => patch({ paused: e.target.checked })} data-testid="fire-econ-paused" />
              Pause rewards
            </label>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Pool:</span>
            <input type="number" min={0} defaultValue={econ.pool} key={econ.pool} className="or-input w-32 text-xs"
              onBlur={(e) => Number(e.target.value) !== econ.pool && patch({ pool: Number(e.target.value) })}
              data-testid="fire-econ-pool" />
            <button className="or-btn or-btn-ghost text-[10px]" disabled={busy}
              onClick={() => patch({ action: "refill" })} data-testid="fire-econ-refill">
              <RefreshCcw size={10} /> Refill</button>
            <button className="or-btn or-btn-ghost text-[10px]" disabled={busy}
              onClick={() => window.confirm("Reset pool to initial size?") && patch({ action: "reset" })}
              data-testid="fire-econ-reset"><RotateCcw size={10} /> Reset</button>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Daily cap/player:</span>
            <input type="number" min={0} defaultValue={econ.daily_player_cap || 0} key={`cap${econ.daily_player_cap}`}
              className="or-input w-20 text-xs" title="Max Fire a single player can earn from this game per day (0 = unlimited)"
              onBlur={(e) => Number(e.target.value) !== (econ.daily_player_cap || 0) && patch({ daily_player_cap: Number(e.target.value) })}
              data-testid="fire-econ-daily-cap" />
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Cooldown (s):</span>
            <input type="number" min={0} defaultValue={econ.claim_cooldown_s || 0} key={`cd${econ.claim_cooldown_s}`}
              className="or-input w-20 text-xs" title="Minimum seconds between rewards for the same player (0 = off)"
              onBlur={(e) => Number(e.target.value) !== (econ.claim_cooldown_s || 0) && patch({ claim_cooldown_s: Number(e.target.value) })}
              data-testid="fire-econ-cooldown" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2" data-testid="fire-econ-rewards">
            {REWARD_FIELDS.map(([k, l]) => (
              <div key={k}>
                <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{l}</div>
                <input type="number" min={0} defaultValue={econ.rewards[k]} key={`${k}${econ.rewards[k]}`}
                  className="or-input w-full text-xs" disabled={busy}
                  onBlur={(e) => Number(e.target.value) !== econ.rewards[k] && patch({ rewards: { [k]: Number(e.target.value) } })}
                  data-testid={`fire-econ-rw-${k}`} />
              </div>
            ))}
          </div>
          <div className="rounded-lg p-2 text-[10px]" style={{ background: "rgba(255,138,90,0.06)", border: "1px solid rgba(255,138,90,0.25)" }}
            data-testid="fire-econ-preview">
            <b style={{ color: "#FF8A5A" }}>Reward preview:</b>{" "}
            avg player ~<b>{data.preview.avg_per_player}</b> 🔥 · max possible <b>{data.preview.max_per_player}</b> 🔥 ·
            worst-case month <b>{data.preview.worst_case_month_per_player}</b> 🔥 ·
            supports <b>{data.preview.full_completions_supported.toLocaleString()}</b> full completions ·
            <b> {data.preview.pool_pct_remaining}%</b> of pool remaining.
            Rewards are validated, idempotent and land as claimable Fire in each player's Fire Vault.
          </div>
        </div>
      )}
    </div>
  );
}
