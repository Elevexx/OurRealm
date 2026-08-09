/**
 * FoundingVipPopup — optional one-time login reminder for eligible users
 * with an unclaimed Founding VIP reward. Dismissing never removes the
 * reward; the claim card stays available in the Fire Wallet.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const SESSION_KEY = "ourrealm.fvip.popup.shown";

export default function FoundingVipPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    let on = true;
    apiClient.get("/founding-vip/me").then((r) => {
      if (!on) return;
      const d = r.data;
      if (d?.eligible && d.status === "eligible" && d.config?.popup_enabled && !d.popup_dismissed) {
        setData(d);
        setOpen(true);
        sessionStorage.setItem(SESSION_KEY, "1");
      }
    }).catch(() => {});
    return () => { on = false; };
  }, [user?.id]);

  if (!open || !data) return null;
  const cfg = data.config || {};

  const dismiss = async () => {
    setOpen(false);
    try { await apiClient.post("/founding-vip/dismiss-popup"); } catch { /* non-critical */ }
  };
  const claimNow = async () => {
    setBusy(true);
    try {
      await apiClient.post("/founding-vip/claim");
      toast.success("Founding VIP reward claimed! 1,000🔥 added to your Vault");
      setOpen(false);
      navigate("/profile");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Claim failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[340] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
      data-testid="founding-vip-popup" role="dialog" aria-modal="true">
      <div className="w-full sm:w-[380px] rounded-t-2xl sm:rounded-2xl p-5"
        style={{ background: "var(--surface)", border: "1px solid #F4C84A55" }}>
        <div className="text-2xl mb-2" aria-hidden="true">{cfg.card_icon || "🏆"}</div>
        <div className="text-base font-bold mb-1" style={{ color: "#F4C84A" }} data-testid="founding-vip-popup-title">
          {cfg.popup_title}
        </div>
        <div className="text-sm mb-4" style={{ color: "var(--text-main)" }}>{cfg.popup_message}</div>
        <div className="flex flex-wrap gap-2">
          <button className="or-btn" onClick={claimNow} disabled={busy}
            style={{ background: "#FF7A1A", color: "#1A0D02" }} data-testid="founding-vip-popup-claim">
            {busy ? <Loader2 size={13} className="animate-spin" /> : null} Claim Now
          </button>
          <button className="or-chip" onClick={() => { setOpen(false); navigate("/profile"); }}
            data-testid="founding-vip-popup-wallet">View Fire Vault</button>
          <button className="or-chip ml-auto" onClick={dismiss} data-testid="founding-vip-popup-dismiss">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
