/**
 * UsernameOnboardingModal — one-time prompt for accounts CREATED via
 * Google sign-in: keep the auto-generated username or claim a custom one.
 * Reuses THE premium-username service: live /check evaluation (rules,
 * reserved names, moderation filters, premium Fire Power pricing) and
 * /unlock for the actual change (free or Vault burn). Never forced —
 * "Keep this username for now" dismisses permanently.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Sparkles, Loader2, Check, Flame } from "lucide-react";
import apiClient, { formatApiErrorDetail } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

export default function UsernameOnboardingModal() {
  const { user, refreshMe } = useAuth();
  const [value, setValue] = useState("");
  const [check, setCheck] = useState(null); // result of /premium-usernames/check
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const timer = useRef(null);

  const runCheck = (v) => {
    clearTimeout(timer.current);
    setCheck(null);
    const u = v.trim().toLowerCase();
    if (!u || u === (user?.username || "").toLowerCase()) return;
    setChecking(true);
    timer.current = setTimeout(async () => {
      try {
        const { data } = await apiClient.get(`/premium-usernames/check?u=${encodeURIComponent(u)}`);
        setCheck(data);
      } catch (e) {
        setCheck({ status: "invalid", message: formatApiErrorDetail(e?.response?.data?.detail) || "Could not check this name." });
      } finally { setChecking(false); }
    }, 450);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!user || closed) return null;

  const dismiss = async () => {
    setClosed(true);
    try { await apiClient.post("/auth/username-onboarding/dismiss"); } catch { /* */ }
    refreshMe();
  };

  const claim = async () => {
    const u = value.trim().toLowerCase();
    if (!u || check?.status !== "available") return;
    setBusy(true);
    try {
      await apiClient.post("/premium-usernames/unlock", {
        username: u,
        idempotency_key: `onboarding-${user.id}-${u}`,
      });
      try { await apiClient.post("/auth/username-onboarding/dismiss"); } catch { /* */ }
      toast.success(`You are now @${u}`);
      setClosed(true);
      refreshMe();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Could not change username.");
      setBusy(false);
    }
  };

  const available = check?.status === "available";
  const premium = !!check?.premium;
  const cost = check?.cost || 0;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center px-3 py-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", zIndex: 10030 }}
      data-testid="username-onboarding-overlay"
    >
      <div className="or-surface w-full max-w-md p-5 sm:p-6" data-testid="username-onboarding-modal">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={18} style={{ color: "var(--primary)" }} />
          <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Welcome to OurRealm!</h3>
        </div>
        <p className="text-sm mb-1" style={{ color: "var(--text-main)" }}>
          We created your username automatically from your Google account:
          <span className="font-semibold" style={{ color: "var(--primary)" }}> @{user.username}</span>
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          You can keep it, or pick a custom one now. Standard names are free;
          short premium names require Fire Power from your Fire Vault. You can
          also change it later in Edit Profile.
        </p>

        <input
          className="w-full text-sm px-3 py-2.5 mb-2"
          style={{ background: "transparent", border: "1px solid var(--border-col)", borderRadius: 8, color: "var(--text-main)" }}
          placeholder="Pick a new username (optional)"
          maxLength={24}
          value={value}
          onChange={(e) => { setValue(e.target.value); runCheck(e.target.value); }}
          data-testid="username-onboarding-input"
        />

        <div className="min-h-[38px] mb-3 text-xs" data-testid="username-onboarding-status">
          {checking && <span style={{ color: "var(--text-muted)" }}><Loader2 size={11} className="animate-spin inline mr-1" />Checking availability…</span>}
          {!checking && check && (
            available ? (
              <div style={{ color: "#57D98A" }}>
                <Check size={11} className="inline mr-1" />@{value.trim().toLowerCase()} is available
                {premium && cost > 0 && (
                  <div className="mt-1 px-2 py-1.5 rounded" style={{ background: "color-mix(in srgb, #FFA94D 12%, transparent)", color: "#FFA94D", border: "1px solid color-mix(in srgb, #FFA94D 35%, transparent)" }} data-testid="username-onboarding-premium">
                    <Flame size={11} className="inline mr-1" />
                    Premium username — costs <b>{cost.toLocaleString()} Fire Power</b> from your Fire Vault
                    (you have {Number(check.vault_balance || 0).toLocaleString()}).
                  </div>
                )}
              </div>
            ) : (
              <span style={{ color: "#FF8080" }}>{check.message || "This username is not available."}</span>
            )
          )}
        </div>

        <button
          type="button"
          disabled={busy || !available}
          onClick={claim}
          className="or-btn w-full mb-2"
          style={{ opacity: available ? 1 : 0.5, minHeight: 44 }}
          data-testid="username-onboarding-claim"
        >
          {busy ? <Loader2 size={14} className="animate-spin" />
            : premium && cost > 0 ? `Claim for ${cost.toLocaleString()} Fire Power`
            : "Claim username"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={dismiss}
          className="or-btn or-btn-ghost w-full"
          style={{ minHeight: 44 }}
          data-testid="username-onboarding-keep"
        >
          Keep @{user.username} for now
        </button>
      </div>
    </div>,
    document.body,
  );
}
