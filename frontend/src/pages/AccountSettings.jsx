import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ShieldCheck, Lock, UserCog, KeyRound, AtSign, MailCheck, Globe2, Users as UsersIcon, Wallet, DollarSign, BadgeCheck } from "lucide-react";
import apiClient from "@/api/client";
import VipBadge from "@/components/VipBadge";

/**
 * Account Settings — Phase C. Implements:
 *  - Account: username change (7-day cooldown), email display, password reset
 *  - Privacy: profile visibility public/friends/private
 *  - Wallet: CashApp, PayPal, Venmo, Bank link placeholders (stored only)
 *  - Ads Manager: link out to existing /marketplace
 */
const TABS = [
  { id: "account",  label: "Account",     Icon: UserCog },
  { id: "privacy",  label: "Privacy",     Icon: ShieldCheck },
  { id: "wallet",   label: "Wallet",      Icon: Wallet },
  { id: "ads",      label: "Ads Manager", Icon: DollarSign },
];

export default function AccountSettings() {
  const { user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("account");

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
        <img
          src={user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name || user.username || "U")}`}
          alt="" className="rounded-full object-cover" style={{ width: 56, height: 56, border: "2px solid var(--border-col)" }}
        />
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
        </div>
      )}

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
