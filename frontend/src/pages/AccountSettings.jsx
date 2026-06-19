import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ShieldCheck, Lock, UserCog, KeyRound, AtSign, MailCheck, Globe2, Users as UsersIcon, Wallet, DollarSign, BadgeCheck, Camera, MapPin, Radar, Trash2 } from "lucide-react";
import apiClient from "@/api/client";
import VipBadge from "@/components/VipBadge";
import ImageUploadPicker, { absoluteImageUrl } from "@/components/ImageUploadPicker";
import { usePresence } from "@/contexts/PresenceContext";
import { isAdmin } from "@/lib/isAdmin";
import DeleteAccountModal from "@/components/DeleteAccountModal";
import AdminSettingsTab from "@/components/AdminSettingsTab";

/**
 * Account Settings — Phase C. Implements:
 *  - Account: username change (7-day cooldown), email display, password reset
 *  - Privacy: profile visibility public/friends/private
 *  - Wallet: CashApp, PayPal, Venmo, Bank link placeholders (stored only)
 *  - Ads Manager: link out to existing /marketplace
 *  - Admin (founder + support only): user-management tools
 */
// Wallet & Ads Manager tabs are intentionally hidden from the user-facing
// settings until wallet/payments are legally ready. The underlying state
// (`wallet`, `saveWallet`, the wallet tab body) is kept in this file so
// the feature can be re-enabled in one diff once payment integrations
// ship. Routes/backend remain untouched.
const TABS_BASE = [
  { id: "account",  label: "Account",     Icon: UserCog },
  { id: "privacy",  label: "Privacy",     Icon: ShieldCheck },
];

export default function AccountSettings() {
  const { user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("account");
  const [avatarPicker, setAvatarPicker] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Founder + support see an extra "Admin" tab. Backend enforces every
  // action — the tab visibility is convenience only.
  const TABS = isAdmin(user)
    ? [...TABS_BASE, { id: "admin", label: "Admin", Icon: ShieldCheck }]
    : TABS_BASE;

  const onAvatarPicked = async ({ url }) => {
    try {
      await apiClient.patch("/profile/me", { avatar_url: url });
      await refreshMe?.();
    } catch (e) {
      // No-op — modal already closed; surface via toast would be nice later.
    }
  };

  const onAvatarRemove = async () => {
    try {
      // Explicit null → server clears the field. Falls back to the
      // dicebear initials placeholder client-side.
      await apiClient.patch("/profile/me", { avatar_url: null });
      await refreshMe?.();
    } catch (e) {
      // No-op
    }
  };

  // Account
  const [newUsername, setNewUsername] = useState("");
  const [unBusy, setUnBusy] = useState(false);
  const [unMsg, setUnMsg] = useState("");
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

  // Privacy
  const [vis, setVis] = useState(user?.profile_visibility || "public");
  const [visBusy, setVisBusy] = useState(false);
  const [visMsg, setVisMsg] = useState("");

  // Wallet
  const [wallet, setWallet] = useState(user?.wallet || {});
  const [walletMsg, setWalletMsg] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);

  // Phase-2 — Profile Settings (ZIP + Presence)
  const [zip, setZip] = useState(user?.zip_code || "");
  const [zipMsg, setZipMsg] = useState("");
  const [zipBusy, setZipBusy] = useState(false);
  const [presence, setPresence] = useState(user?.presence_visible !== false);
  const [presenceBusy, setPresenceBusy] = useState(false);

  if (!user) return <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>Sign in to view settings</div>;

  const changeUsername = async () => {
    setUnBusy(true); setUnMsg("");
    try {
      await apiClient.patch("/profile/username", { username: newUsername.trim() });
      setUnMsg("Username changed."); setNewUsername("");
      if (refreshMe) await refreshMe();
    } catch (e) {
      setUnMsg(e?.response?.data?.detail || "Could not change username");
    } finally { setUnBusy(false); }
  };
  const changePassword = async () => {
    setPwdBusy(true); setPwdMsg("");
    try {
      await apiClient.post("/profile/change-password", { current_password: curPwd, new_password: newPwd });
      setPwdMsg("Password updated.");
      setCurPwd(""); setNewPwd("");
    } catch (e) {
      setPwdMsg(e?.response?.data?.detail || "Could not change password");
    } finally { setPwdBusy(false); }
  };
  const saveVisibility = async (next) => {
    setVis(next); setVisBusy(true); setVisMsg("");
    try {
      await apiClient.patch("/profile/me", { profile_visibility: next });
      setVisMsg("Saved.");
      if (refreshMe) await refreshMe();
    } catch (e) {
      setVisMsg(e?.response?.data?.detail || "Could not save");
    } finally { setVisBusy(false); }
  };
  const saveWallet = async () => {
    setWalletBusy(true); setWalletMsg("");
    try {
      await apiClient.patch("/profile/me", { wallet });
      setWalletMsg("Payment methods saved.");
      if (refreshMe) await refreshMe();
    } catch (e) {
      setWalletMsg(e?.response?.data?.detail || "Could not save");
    } finally { setWalletBusy(false); }
  };

  // Phase-2 — ZIP save + Presence toggle save. Both auto-save with the
  // backend's validation; the toggle is instant (no Save button).
  const saveZip = async () => {
    const trimmed = zip.trim();
    // Pre-flight validation that mirrors the backend regex so the user
    // gets the spec-mandated error before the input mask hides their
    // mistake. Empty string is intentionally allowed — it CLEARS the ZIP.
    if (trimmed && !/^\d{5}(-\d{4})?$/.test(trimmed)) {
      setZipMsg("Please enter a valid 5-digit US ZIP code.");
      return;
    }
    setZipBusy(true); setZipMsg("");
    try {
      await apiClient.patch("/profile/me", { zip_code: trimmed });
      setZipMsg(trimmed ? "ZIP saved." : "ZIP cleared.");
      if (refreshMe) await refreshMe();
    } catch (e) {
      setZipMsg(e?.response?.data?.detail || "Could not save ZIP");
    } finally { setZipBusy(false); }
  };
  const togglePresence = async (next) => {
    setPresence(next); setPresenceBusy(true);
    try {
      await apiClient.patch("/profile/me", { presence_visible: next });
      if (refreshMe) await refreshMe();
    } catch (e) {
      setPresence(!next); // rollback
    } finally { setPresenceBusy(false); }
  };

  return (
    <div className="max-w-3xl mx-auto" data-testid="account-settings-page">
      <div className="mb-5 flex items-center gap-3">
        <button className="starbar-icon" style={{ width: 38, height: 38 }} onClick={() => navigate(-1)} data-testid="account-settings-back" aria-label="Back">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Your account</div>
          <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>Account Settings</h1>
        </div>
      </div>

      <div className="or-surface p-5 mb-4 flex items-center gap-3" data-testid="account-settings-summary">
        <button
          type="button"
          onClick={() => setAvatarPicker(true)}
          className="relative shrink-0"
          style={{ background: "transparent", padding: 0 }}
          data-testid="account-avatar-edit"
          aria-label="Change profile image"
          title="Change profile image"
        >
          <img
            src={absoluteImageUrl(user.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name || user.username || "U")}`}
            alt="" className="rounded-full object-cover" style={{ width: 56, height: 56, border: "2px solid var(--border-col)" }}
          />
          <span
            className="absolute -bottom-1 -right-1 rounded-full flex items-center justify-center"
            style={{ width: 22, height: 22, background: "var(--primary)", color: "var(--bgc)" }}
          >
            <Camera size={12} />
          </span>
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold flex items-center gap-2 flex-wrap" style={{ color: "var(--text-main)" }}>
            <span className="truncate">{user.name}</span>
            {user.is_vip && <VipBadge joinedAt={user.vip_joined_at} testid="settings-vip-badge" />}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>@{user.username} · {user.email}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className="or-chip shrink-0" data-active={tab === id} onClick={() => setTab(id)} data-testid={`account-tab-${id}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* ACCOUNT */}
      {tab === "account" && (
        <div className="space-y-4" data-testid="tab-account">
          <Card title="Username" Icon={AtSign}>
            <div className="text-sm mb-2" style={{ color: "var(--text-muted)" }}>
              Current: <b style={{ color: "var(--text-main)" }}>@{user.username}</b> · You can rename once every 7 days.
            </div>
            <div className="flex gap-2 flex-wrap">
              <input className="or-input flex-1" placeholder="new_username"
                value={newUsername} onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g,""))}
                data-testid="settings-new-username" />
              <button className="or-btn" disabled={unBusy || newUsername.length < 3} onClick={changeUsername} data-testid="settings-save-username">
                {unBusy ? "Saving…" : "Change"}
              </button>
            </div>
            {unMsg && <div className="text-xs mt-2" data-testid="settings-username-msg" style={{ color: unMsg.includes("changed") ? "var(--brand-green)" : "#FF8080" }}>{unMsg}</div>}
          </Card>

          <Card title="Email" Icon={MailCheck}>
            <div className="text-sm" style={{ color: "var(--text-main)" }}>{user.email}</div>
            <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>Connected email. Email change comes in a later release.</div>
          </Card>

          <Card title="Password" Icon={KeyRound}>
            <div className="space-y-2">
              <input className="or-input" type="password" placeholder="Current password"
                value={curPwd} onChange={(e) => setCurPwd(e.target.value)} data-testid="settings-current-password" />
              <input className="or-input" type="password" placeholder="New password (min 6 chars)"
                value={newPwd} onChange={(e) => setNewPwd(e.target.value)} data-testid="settings-new-password" />
              <button className="or-btn" disabled={pwdBusy || !curPwd || newPwd.length < 6} onClick={changePassword} data-testid="settings-change-password">
                {pwdBusy ? "Saving…" : "Update password"}
              </button>
              {pwdMsg && <div className="text-xs" data-testid="settings-password-msg" style={{ color: pwdMsg.includes("updated") ? "var(--brand-green)" : "#FF8080" }}>{pwdMsg}</div>}
            </div>
          </Card>

          <Card title="ZIP Code (Private)" Icon={MapPin}>
            <div className="text-[12px] mb-2" style={{ color: "var(--text-muted)" }}>
              Your 5-digit US ZIP code stays private. It powers the For You and Sounds radius filters and is never shown to other users.
            </div>
            <div className="flex gap-2">
              <input
                className="or-input flex-1"
                inputMode="numeric"
                maxLength={10}
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/[^0-9-]/g, "").slice(0, 10))}
                placeholder="e.g. 10001"
                data-testid="settings-zip-input"
              />
              <button
                className="or-btn"
                disabled={zipBusy}
                onClick={saveZip}
                data-testid="settings-zip-save"
              >
                {zipBusy ? "Saving…" : "Save"}
              </button>
            </div>
            {zipMsg && <div className="text-xs mt-2" data-testid="settings-zip-msg" style={{ color: zipMsg.toLowerCase().includes("saved") || zipMsg.toLowerCase().includes("cleared") ? "var(--brand-green)" : "#FF8080" }}>{zipMsg}</div>}
          </Card>

          <Card title="Presence Indicator" Icon={Radar}>
            <div className="flex items-start justify-between gap-3">
              <div className="text-[12px] flex-1" style={{ color: "var(--text-muted)" }}>
                Show an animated green radar dot under your profile image to indicate active status. Visual only — no functional change.
              </div>
              <button
                type="button"
                onClick={() => togglePresence(!presence)}
                disabled={presenceBusy}
                className="or-chip shrink-0"
                data-active={presence}
                aria-pressed={presence}
                data-testid="settings-presence-toggle"
              >
                <span style={{
                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                  background: presence ? "var(--brand-green)" : "var(--text-muted)",
                  boxShadow: presence ? "0 0 8px var(--brand-green)" : "none",
                }} />
                {presence ? "On" : "Off"}
              </button>
            </div>
          </Card>

          <StatusSelectorCard />

          {/* Danger zone — destructive self-delete. Sits at the very
              bottom of the Account tab per spec. Founder + system
              accounts (@stealth / @support) cannot self-delete; the
              backend rejects with 403 as a defence-in-depth measure. */}
          {(user.username || "").toLowerCase() !== "stealth" && (user.username || "").toLowerCase() !== "support" && (
            <div className="or-surface p-4" style={{ borderColor: "rgba(255,128,128,0.35)" }} data-testid="account-delete-section">
              <div className="flex items-center gap-2 mb-2">
                <Trash2 size={14} style={{ color: "#FF8080" }} />
                <h3 className="text-sm font-semibold" style={{ color: "#FF8080" }}>Delete Account</h3>
              </div>
              <p className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>
                Deactivates your profile for 30 days. You can restore your
                account by signing back in within that window.
              </p>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="or-btn"
                style={{ background: "#FF4444", color: "#fff" }}
                data-testid="account-delete-open"
              >
                <Trash2 size={14} /> Delete Account
              </button>
            </div>
          )}
        </div>
      )}

      {/* ADMIN — founder + support only */}
      {tab === "admin" && <AdminSettingsTab />}

      {/* PRIVACY */}
      {tab === "privacy" && (
        <div className="space-y-2" data-testid="tab-privacy">
          {[
            { id: "public",  label: "Public",        desc: "Anyone can find your profile.",         Icon: Globe2 },
            { id: "friends", label: "Friends only",  desc: "Only friends can see your profile.",    Icon: UsersIcon },
            { id: "private", label: "Private",       desc: "Hidden from everyone else.",            Icon: Lock },
          ].map(({ id, label, desc, Icon }) => (
            <button
              key={id} onClick={() => saveVisibility(id)}
              className="or-surface w-full p-3 text-left flex items-center gap-3"
              data-testid={`privacy-${id}`}
              data-active={vis === id}
              style={{
                background: vis === id ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "var(--surface)",
                outline: vis === id ? "1px solid var(--primary)" : "none",
              }}
            >
              <Icon size={18} style={{ color: vis === id ? "var(--primary)" : "var(--text-muted)" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{label}</div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{desc}</div>
              </div>
              {vis === id && <BadgeCheck size={16} style={{ color: "var(--primary)" }} />}
            </button>
          ))}
          {visMsg && <div className="text-xs mt-1" data-testid="settings-visibility-msg" style={{ color: "var(--text-muted)" }}>{visMsg}{visBusy ? " (saving)" : ""}</div>}
        </div>
      )}

      {/* WALLET */}
      {tab === "wallet" && (
        <div className="space-y-3" data-testid="tab-wallet">
          <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            Link preferred payment methods. Stored securely — no transfers happen yet.
          </div>
          {[
            { k: "cashapp", label: "CashApp",  ph: "$yourtag" },
            { k: "paypal",  label: "PayPal",   ph: "you@example.com" },
            { k: "venmo",   label: "Venmo",    ph: "@yourhandle" },
            { k: "bank_last4", label: "Bank account · last 4", ph: "1234", max: 4 },
          ].map(({ k, label, ph, max }) => (
            <Card key={k} title={label} Icon={Wallet}>
              <input
                className="or-input"
                value={wallet[k] || ""}
                maxLength={max || 64}
                placeholder={ph}
                onChange={(e) => setWallet({ ...wallet, [k]: e.target.value })}
                data-testid={`wallet-${k}`}
              />
            </Card>
          ))}
          <button className="or-btn" disabled={walletBusy} onClick={saveWallet} data-testid="settings-save-wallet">
            {walletBusy ? "Saving…" : "Save payment methods"}
          </button>
          {walletMsg && <div className="text-xs" data-testid="settings-wallet-msg" style={{ color: walletMsg.includes("saved") ? "var(--brand-green)" : "#FF8080" }}>{walletMsg}</div>}
        </div>
      )}

      {/* ADS — passthrough */}
      {tab === "ads" && (
        <div className="or-surface p-5 text-center" data-testid="tab-ads">
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>Manage your campaigns and creator earnings in the Marketplace.</div>
          <button className="or-btn mt-3" onClick={() => navigate("/marketplace")} data-testid="settings-open-ads">
            <DollarSign size={14} /> Open Ads Manager
          </button>
        </div>
      )}

      <ImageUploadPicker
        open={avatarPicker}
        onClose={() => setAvatarPicker(false)}
        onPicked={onAvatarPicked}
        onRemove={user.avatar_url ? onAvatarRemove : undefined}
        removeLabel="Remove photo"
        title="Change profile image"
        testid="account-avatar-picker"
      />
      <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}

function Card({ title, Icon, children }) {
  return (
    <div className="or-surface p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color: "var(--primary)" }} />
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase C — Status Selector. The user picks one of:
//    live | online | invisible
// `messenger` is auto-set client-side when the user is actively in
// /messages. `offline` is implicit (no socket).
// ─────────────────────────────────────────────────────────────────────
function StatusSelectorCard() {
  const { myStatus, setMyStatus } = usePresence();
  // Hide "Live" until live streaming actually ships
  // (ENABLE_LIVE_PRESENCE feature flag in /lib/presence).
  const ALL_OPTIONS = [
    { id: "live",      label: "Live",      desc: "Show others you're live.",        color: "#FF3F5A", flag: "live" },
    { id: "online",    label: "Online",    desc: "Available across the app.",       color: "var(--brand-green)" },
    { id: "invisible", label: "Invisible", desc: "Appear offline to everyone.",     color: "#5A6378" },
  ];
  // eslint-disable-next-line global-require
  const { ENABLE_LIVE_PRESENCE } = require("@/lib/presence");
  const OPTIONS = ALL_OPTIONS.filter((o) => o.flag !== "live" || ENABLE_LIVE_PRESENCE);
  // If the user's stored choice is "live" but the flag is off, snap them
  // to "online" silently so their visible status is correct.
  React.useEffect(() => {
    if (!ENABLE_LIVE_PRESENCE && myStatus === "live") setMyStatus("online");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myStatus]);
  return (
    <div className="or-surface p-4" data-testid="settings-status-card">
      <div className="flex items-center gap-2 mb-2">
        <span style={{ width: 14, height: 14, display: "inline-block", borderRadius: "50%", background: "var(--primary)" }} />
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>Status</h3>
      </div>
      <div className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>
        Choose how you appear to friends across OurRealm. While in Messenger you&apos;ll automatically show as <strong>In Messenger</strong>.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => setMyStatus(o.id)}
            data-active={myStatus === o.id}
            data-testid={`status-option-${o.id}`}
            className="or-surface p-3 text-left flex items-center gap-2"
            style={{
              background: myStatus === o.id ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "var(--surface)",
              outline: myStatus === o.id ? "1px solid var(--primary)" : "none",
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: "50%",
              background: o.color, boxShadow: `0 0 8px ${o.color}`,
              display: "inline-block",
            }} />
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{o.label}</div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{o.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
