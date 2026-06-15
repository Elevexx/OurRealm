import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ShieldCheck, Lock, BellRing, UserCog, KeyRound, AtSign, Trash2, MailCheck } from "lucide-react";
import VipBadge from "@/components/VipBadge";

/**
 * Account Settings page (linked from the gear icon on the user's own profile
 * in edit mode). Prepared for future account features — currently lists each
 * planned section with a "Coming Soon" pill so the IA is in place without
 * shipping half-baked functionality.
 */
const SECTIONS = [
  { key: "profile",       label: "Profile information",     desc: "Display name, bio, avatar, links.",        Icon: UserCog,       ready: false },
  { key: "username",      label: "Change username",         desc: "Rename safely — friend graph unaffected.", Icon: AtSign,        ready: false },
  { key: "password",      label: "Password & sign-in",      desc: "Change password and review sessions.",    Icon: KeyRound,      ready: false },
  { key: "email",         label: "Email & verification",    desc: "Manage primary email and verification.",   Icon: MailCheck,     ready: false },
  { key: "privacy",       label: "Privacy defaults",        desc: "Default audience for new posts.",          Icon: Lock,          ready: false },
  { key: "notifications", label: "Notifications",           desc: "Push, email, and in-app preferences.",     Icon: BellRing,      ready: false },
  { key: "blocked",       label: "Blocked & muted",         desc: "Manage who can't reach you.",              Icon: ShieldCheck,   ready: false },
  { key: "delete",        label: "Delete account",          desc: "Permanently remove your OurRealm account.",Icon: Trash2,        ready: false, danger: true },
];

export default function AccountSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="max-w-3xl mx-auto" data-testid="account-settings-page">
      <div className="mb-5 flex items-center gap-3">
        <button
          className="starbar-icon"
          style={{ width: 38, height: 38 }}
          onClick={() => navigate(-1)}
          data-testid="account-settings-back"
          aria-label="Back"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Your account</div>
          <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>Account Settings</h1>
        </div>
      </div>

      {user && (
        <div className="or-surface p-5 mb-4" data-testid="account-settings-summary">
          <div className="flex items-center gap-3">
            <img
              src={user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name || user.username || "U")}`}
              alt=""
              className="rounded-full object-cover"
              style={{ width: 56, height: 56, border: "2px solid var(--border-col)" }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold flex items-center gap-2 flex-wrap" style={{ color: "var(--text-main)" }}>
                <span className="truncate">{user.name}</span>
                {user.is_vip && <VipBadge joinedAt={user.vip_joined_at} testid="settings-vip-badge" />}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>@{user.username} · {user.email}</div>
            </div>
          </div>
        </div>
      )}

      <div className="or-surface divide-y" style={{ borderColor: "var(--border-col)" }}>
        {SECTIONS.map(({ key, label, desc, Icon, ready, danger }) => (
          <button
            key={key}
            className="w-full p-4 flex items-center gap-3 text-left transition-colors"
            data-testid={`account-section-${key}`}
            onClick={() => {/* future: open dedicated subpage */}}
            disabled={!ready}
            style={{
              opacity: ready ? 1 : 0.85,
              cursor: ready ? "pointer" : "default",
              background: "transparent",
              borderBottom: "1px solid var(--border-col)",
            }}
          >
            <div
              className="rounded-full flex items-center justify-center shrink-0"
              style={{
                width: 38, height: 38,
                background: danger ? "rgba(255,80,80,0.12)" : "var(--surface-2)",
                color: danger ? "#FF8080" : "var(--primary)",
                border: "1px solid var(--border-col)",
              }}
            >
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: danger ? "#FF8080" : "var(--text-main)" }}>{label}</div>
              <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{desc}</div>
            </div>
            {!ready && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded shrink-0" style={{ background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border-col)" }}>
                Coming soon
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4 text-[11px] text-center" style={{ color: "var(--text-muted)" }}>
        Looking for appearance / mode settings? They live in <button className="underline" style={{ color: "var(--primary)" }} onClick={() => navigate("/settings")}>Settings</button>.
      </div>
    </div>
  );
}
