import React, { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { GoldCoin } from "@/components/resources/GoldCoin";

/* Cross-game resource requirement panel. Two truthful modes:
   balance = "Required to Hold" (nothing burned), burn = "Confirm Burn". */
export const GameGate = ({ gameId, status, onUnlocked }) => {
  const [busy, setBusy] = useState(false);
  const [reqId] = useState(() => crypto.randomUUID());
  const g = status.gate;
  const icon = g.icon_url
    ? (g.resource_key === "coins"
      ? <GoldCoin src={g.icon_url} size={22} alt={g.resource_name} />
      : <img src={g.icon_url} alt={g.resource_name} className="w-5 h-5 inline" />)
    : <span>{g.resource_icon}</span>;
  const confirmBurn = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/resources/gates/${gameId}/unlock`, { request_id: reqId });
      if (data.unlocked) { toast.success(`Burn confirmed — ${g.resource_name} unlocked this game!`); onUnlocked(); }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Burn Cancelled — your resource was returned");
    } finally { setBusy(false); }
  };
  return (
    <div className="or-surface p-6 rounded-2xl text-center" data-testid="game-gate-panel">
      <Lock size={26} className="mx-auto mb-2" style={{ color: "#F4A73B" }} aria-hidden="true" />
      <b className="block text-sm mb-1" data-testid="game-gate-title">Resource Required</b>
      {g.gate_type === "balance" ? (
        <>
          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }} data-testid="game-gate-hold-line">
            Required to Hold: <b style={{ color: "var(--text-main)" }}>{g.amount} {icon} {g.resource_name}</b>
            {" "}— nothing is burned.
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="game-gate-balance">
            You hold {status.balance} {g.resource_name}. Collect more by playing other OurRealm games.
          </p>
        </>
      ) : (
        <>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }} data-testid="game-gate-burn-line">
            Required to Burn: <b style={{ color: "#FF7A1A" }}>{g.amount} {icon} {g.resource_name}</b>
            {" "}· You hold {status.balance}. The exact amount shown is burned only when you confirm —
            engagement resources have no monetary value.
          </p>
          <button className="or-btn text-xs" disabled={busy || status.balance < g.amount}
            onClick={confirmBurn} data-testid="game-gate-confirm-burn">
            {busy ? <Loader2 size={13} className="animate-spin" /> : `Confirm Burn — ${g.amount} ${g.resource_name}`}
          </button>
          {status.balance < g.amount && (
            <p className="text-[10.5px] mt-2" style={{ color: "#F4A73B" }} data-testid="game-gate-insufficient">
              Not enough {g.resource_name} yet — earn more in other OurRealm games.
            </p>)}
        </>
      )}
    </div>
  );
};
