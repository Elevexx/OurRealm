import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Star, Music2, Bell, MessageSquare, DollarSign, User } from "lucide-react";
import Logo from "@/components/Logo";
import ModeSwitcher from "@/components/ModeSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import GuestPrompt from "@/components/GuestPrompt";

const ITEMS = [
  { to: "/featured",     label: "Featured",      Icon: Star,         testid: "star-featured",      color: "#F4C84A", badge: null },
  { to: "/sounds",       label: "Sounds",        Icon: Music2,       testid: "star-sounds",        color: "var(--brand-blue)", badge: null },
  { to: "/notifications",label: "Notifications", Icon: Bell,         testid: "star-notifications", color: "#FF8AC2", badge: "99+" },
  { to: "/messages",     label: "Messages",      Icon: MessageSquare,testid: "star-messages",      color: "var(--brand-blue)", badge: "1" },
  { to: "/marketplace",  label: "Ads",           Icon: DollarSign,   testid: "star-ads",           color: "var(--brand-green)", badge: null },
  { to: "/profile",      label: "Profile",       Icon: User,         testid: "star-profile",       color: "var(--brand-green)", badge: null },
];

const MODE_LABEL = {
  neon: "NEON",
  business: "BUSINESS",
  millennium: "Millennium",
  stealth: "STEALTH",
};

export default function TopStarBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { mode } = useTheme();
  const [showModes, setShowModes] = useState(false);
  const [guestPrompt, setGuestPrompt] = useState(null);

  return (
    <header
      className="sticky top-0 z-40 px-3 sm:px-5 py-2.5"
      style={{
        background: "color-mix(in srgb, var(--bgc) 82%, transparent)",
        backdropFilter: "blur(18px)",
        borderBottom: "1px solid var(--border-col)",
      }}
      data-testid="topstar-bar"
    >
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Logo + wordmark */}
        <button
          className="flex items-center gap-3 shrink-0"
          onClick={() => navigate("/home")}
          data-testid="header-logo"
        >
          <Logo size={52} withWordmark />
        </button>

        <span
          className="hidden sm:inline-flex items-center px-2.5 py-1 text-[10px] tracking-[0.22em] uppercase"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            color: "var(--primary)",
            border: "1px solid var(--primary)",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--primary) 10%, transparent)",
          }}
        >
          {MODE_LABEL[mode] || "Mode"} Mode
        </span>

        <button
          className="hidden md:inline-flex starbar-icon"
          onClick={() => setShowModes((v) => !v)}
          data-testid="topbar-mode-toggle"
          aria-label="Switch mode"
          style={{ width: 36, height: 36 }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>M</span>
        </button>

        {/* Star Bar */}
        <nav className="ml-auto flex items-center gap-1.5 sm:gap-2" data-testid="star-bar">
          {ITEMS.map(({ to, label, Icon, testid, color, badge }) => {
            const active = location.pathname.startsWith(to);
            return (
              <button
                key={to}
                data-testid={testid}
                data-active={active}
                onClick={() => navigate(to)}
                className="starbar-icon"
                aria-label={label}
                title={label}
                style={{ color: active ? "var(--primary)" : color }}
              >
                <Icon size={20} />
                {badge && <span className="starbar-badge">{badge}</span>}
                <span className="sr-only">{label}</span>
              </button>
            );
          })}

          {/* Profile avatar (replaces last icon visually) */}
          <button
            data-testid="star-avatar"
            onClick={() => user ? navigate("/profile") : setGuestPrompt("open your profile")}
            className="rounded-full overflow-hidden ml-1"
            style={{ width: 44, height: 44, border: "2px solid var(--primary)", boxShadow: "0 0 12px color-mix(in srgb, var(--primary) 50%, transparent)" }}
            aria-label="My profile"
          >
            <img
              src={user?.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.name || "Guest")}`}
              alt={user?.name || "Guest"}
              className="w-full h-full object-cover"
            />
          </button>
        </nav>
      </div>

      {showModes && (
        <div
          className="absolute right-3 mt-2 p-2 or-surface"
          style={{ top: "100%", zIndex: 50 }}
          data-testid="mode-popover"
        >
          <ModeSwitcher />
        </div>
      )}

      <GuestPrompt open={!!guestPrompt} onClose={() => setGuestPrompt(null)} action={guestPrompt || "do this"} />
    </header>
  );
}
