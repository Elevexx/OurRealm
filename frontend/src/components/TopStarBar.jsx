import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Star, Music2, Bell, MessageSquare, DollarSign, User } from "lucide-react";
import Logo from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

const ITEMS = [
  { to: "/featured",     label: "Featured",      Icon: Star,         testid: "star-featured",      color: "#F4C84A", badge: null },
  { to: "/sounds",       label: "Sounds",        Icon: Music2,       testid: "star-sounds",        color: "var(--brand-blue)", badge: null },
  { to: "/notifications",label: "Notifications", Icon: Bell,         testid: "star-notifications", color: "#FF8AC2", badge: "99+" },
  { to: "/messages",     label: "Messages",      Icon: MessageSquare,testid: "star-messages",      color: "var(--brand-blue)", badge: "1" },
  { to: "/marketplace",  label: "Ads",           Icon: DollarSign,   testid: "star-ads",           color: "var(--brand-green)", badge: null },
  { to: "/profile?edit=1", label: "Profile (edit)", Icon: User,       testid: "star-profile",       color: "var(--brand-green)", badge: null },
];

const MODE_LABEL = { neon: "NEON", business: "BUSINESS", millennium: "MILLENNIUM", stealth: "STEALTH" };
const MODE_GRADIENT = {
  neon:       "linear-gradient(135deg, #2EA0FF 0%, #10E670 100%)",
  business:   "linear-gradient(135deg, #D5B05A 0%, #8C7A3E 100%)",
  millennium: "linear-gradient(180deg, #6CC4FF 0%, #2E78D6 100%)",
  stealth:    "linear-gradient(135deg, #00FF66 0%, #00B23E 100%)",
};
const MODE_FG = { neon: "#0a0a0a", business: "#fff", millennium: "#fff", stealth: "#0a0a0a" };

export default function TopStarBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { mode } = useTheme();

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
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Logo — no box, clean */}
        <button
          className="flex items-center shrink-0"
          onClick={() => navigate("/home")}
          data-testid="header-logo"
          aria-label="OurRealm home"
          style={{ background: "transparent", padding: 0 }}
        >
          <Logo size={48} />
        </button>

        {/* Mode button — full named button → /modes */}
        <button
          onClick={() => navigate("/modes")}
          data-testid="topbar-mode-button"
          aria-label={`Current mode: ${MODE_LABEL[mode]}. Tap to switch.`}
          className="shrink-0 transition-transform active:scale-95"
          style={{
            background: MODE_GRADIENT[mode],
            color: MODE_FG[mode],
            padding: "0.4rem 0.85rem",
            borderRadius: 999,
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: "0.7rem",
            letterSpacing: "0.18em",
            border: "none",
            boxShadow: `0 0 16px color-mix(in srgb, var(--primary) 55%, transparent)`,
            whiteSpace: "nowrap",
            minHeight: 36,
          }}
        >
          {MODE_LABEL[mode]}
        </button>

        {/* Star Bar — horizontally scrollable on mobile to prevent crowding */}
        <nav
          className="ml-auto flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar min-w-0"
          data-testid="star-bar"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {ITEMS.map(({ to, label, Icon, testid, color, badge }) => {
            const pathOnly = to.split("?")[0];
            const active = location.pathname === pathOnly;
            return (
              <button
                key={to}
                data-testid={testid}
                data-active={active}
                onClick={() => navigate(to)}
                className="starbar-icon shrink-0"
                aria-label={label}
                title={label}
                style={{ color: active ? "var(--primary)" : color, scrollSnapAlign: "end" }}
              >
                <Icon size={20} />
                {badge && <span className="starbar-badge">{badge}</span>}
                <span className="sr-only">{label}</span>
              </button>
            );
          })}

          {/* Profile avatar */}
          <button
            data-testid="star-avatar"
            onClick={() => user ? navigate("/profile") : navigate("/signin")}
            className="rounded-full overflow-hidden ml-1 shrink-0"
            style={{
              width: 44, height: 44,
              border: "2px solid var(--primary)",
              boxShadow: "0 0 12px color-mix(in srgb, var(--primary) 50%, transparent)",
              scrollSnapAlign: "end",
            }}
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
    </header>
  );
}
