/**
 * FoundingVipCard — claim card shown at the top of the Fire Wallet area on
 * the user's own profile. All content is founder-editable via config.
 * The 1,000🔥 is deposited ONLY when the user presses Claim.
 */
import React, { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";

export default function FoundingVipCard({ onClaimed }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let on = true;
    apiClient.get("/founding-vip/me")
      .then((r) => { if (on) setData(r.data); })
      .catch(() => { if (on) setData({ eligible: false }); });
    return () => { on = false; };
  }, []);

  if (!data?.eligible) return null;
  const cfg = data.config || {};

  if (result || data.status === "claimed") {
    if (!result) return null; // previously claimed — card no longer shows
    return (
      <div className="or-surface p-5 mb-5 relative overflow-hidden founding-vip-card" data-testid="founding-vip-claimed">
        <div className="founding-vip-confetti" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, i) => <span key={i} style={{ "--i": i }} />)}
        </div>
        <div className="text-lg font-bold mb-1" style={{ color: cfg.card_accent_color || "#F4C84A" }}>
          Reward Claimed!
        </div>
        <div className="text-sm mb-3" style={{ color: "var(--text-main)" }} data-testid="founding-vip-claimed-msg">
          {cfg.claimed_message}
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          Vault: {result.previous_vault_balance?.toLocaleString()} → <b style={{ color: "#FF7A1A" }}>{result.new_vault_balance?.toLocaleString()} 🔥</b>
          {" · "}VIP: {result.vip_awarded_through_claim === "awarded" ? "awarded ⭐" : "confirmed ⭐"}
          {" · "}Member #{result.member_number}
        </div>
      </div>
    );
  }

  if (data.status !== "eligible") return null;

  const claim = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await apiClient.post("/founding-vip/claim");
      setResult(r.data);
      toast.success("Founding VIP reward claimed! 🔥");
      onClaimed?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Claim failed — please try again");
    } finally { setBusy(false); }
  };

  return (
    <div className="or-surface p-5 mb-5 relative overflow-hidden" data-testid="founding-vip-card"
      style={{ border: `1px solid ${cfg.card_accent_color || "#F4C84A"}55`,
               backgroundImage: cfg.card_background_url ? `url(${cfg.card_background_url})` : undefined,
               backgroundSize: "cover" }}>
      <div className="flex items-start gap-3">
        <div className="text-3xl" aria-hidden="true">{cfg.card_icon || "🏆"}</div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold" style={{ color: cfg.card_accent_color || "#F4C84A", fontFamily: "var(--font-display)" }}
            data-testid="founding-vip-title">{cfg.card_title}</div>
          <div className="text-sm mt-0.5" style={{ color: "var(--text-main)" }}>{cfg.card_description}</div>
          <div className="text-[11px] font-bold uppercase tracking-widest mt-3 mb-1.5" style={{ color: "var(--text-muted)" }}>
            Your Rewards
          </div>
          <div className="space-y-1 mb-3" data-testid="founding-vip-rewards">
            {(cfg.card_rewards || []).map((r) => (
              <div key={r} className="text-sm flex items-center gap-2" style={{ color: "var(--text-main)" }}>
                <Star size={12} style={{ color: cfg.card_accent_color || "#F4C84A" }} /> {r}
              </div>
            ))}
          </div>
          <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>{cfg.card_details}</div>
          <button className="or-btn" onClick={claim} disabled={busy}
            style={{ background: cfg.card_button_color || "#FF7A1A", color: "#1A0D02" }}
            data-testid="founding-vip-claim-btn">
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} {cfg.card_button_text || "Claim Reward"}
          </button>
          {cfg.card_terms && (
            <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>{cfg.card_terms}</div>
          )}
        </div>
        {cfg.card_image_url && (
          <img src={cfg.card_image_url} alt="" className="w-16 h-16 object-contain flex-shrink-0" draggable="false" />
        )}
      </div>
    </div>
  );
}
