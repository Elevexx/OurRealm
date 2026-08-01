import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Star, Globe, Bell, MessageSquare, ShieldCheck } from "lucide-react";
import Logo from "@/components/Logo";
import { RcImg } from "@/lib/rcAssets";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import apiClient from "@/api/client";

// Top-right Star Bar — exactly 4 icons (Feb 26, 2026 spec):
// 1. ⭐ Featured · 2. 🌎 Discover · 3. 🔔 Notifications · 4. ✉️ Messages
// Profile access remains via: bottom-nav avatar, user avatars across the
// app, profile links, mentions, friends, realm members, etc.
const ITEMS = [
  { to: "/featured",      label: "Featured",      Icon: Star,         testid: "star-featured",      color: "#F4C84A" },
  { to: "/responsibility-center", label: "Responsibility Center", Icon: ShieldCheck, rcLogo: true,
    testid: "star-responsibility-center", color: "var(--brand-green, #10E670)", matchPrefix: true,
    tooltip: "Responsibility Center — Manage responsibilities, tasks, teams, families, schools, businesses and organizations." },
  { to: "/discover",      label: "Discover",      Icon: Globe,        testid: "star-discover",      color: "var(--brand-blue)" },
  { to: "/notifications", label: "Notifications", Icon: Bell,         testid: "star-notifications", color: "#FF8AC2", isNotif: true },
  { to: "/messages",      label: "Messages",      Icon: MessageSquare,testid: "star-messages",      color: "var(--brand-blue)" },
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

  // ── Notifications badge: ONLY unread count, refreshed on route change.
  // Mark-as-seen happens when the user opens /notifications.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!user) { setUnread(0); return; }
    (async () => {
      try {
        const { data } = await apiClient.get("/notifications/unread-count");
        if (!cancelled) setUnread(Number(data?.count || 0));
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [user, location.pathname]);

  return (
    <header
      className="sticky top-0 z-40 px-2.5 sm:px-5 py-2"
      style={{
        background: "color-mix(in srgb, var(--bgc) 82%, transparent)",
        backdropFilter: "blur(18px)",
        borderBottom: "1px solid var(--border-col)",
        paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))",
        paddingLeft: "max(0.625rem, env(safe-area-inset-left, 0px))",
        paddingRight: "max(0.625rem, env(safe-area-inset-right, 0px))",
        maxWidth: "100vw",
      }}
      data-testid="topstar-bar"
    >
      <div className="flex items-center gap-2 sm:gap-3 max-w-full">
        {/* Logo — clicking the logo routes to /signin. When logged in,
            SignIn surfaces "Continue as @x" and "Sign Out" CTAs. */}
        <button
          className="flex items-center shrink-0"
          onClick={() => navigate("/signin")}
          data-testid="header-logo"
          aria-label="OurRealm sign in"
          style={{ background: "transparent", padding: 0 }}
        >
          <Logo size={44} />
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
          {ITEMS.map(({ to, label, Icon, testid, color, isNotif, matchPrefix, tooltip, rcLogo }) => {
            const pathOnly = to.split("?")[0];
            const active = matchPrefix ? location.pathname.startsWith(pathOnly) : location.pathname === pathOnly;
            const badgeText = isNotif && unread > 0 ? (unread > 99 ? "99+" : String(unread)) : null;
            return (
              <button
                key={to}
                data-testid={testid}
                data-active={active}
                onClick={() => navigate(to)}
                className="starbar-icon shrink-0"
                aria-label={label}
                title={tooltip || label}
                style={{ color: active ? "var(--primary)" : color, scrollSnapAlign: "end" }}
              >
                {rcLogo ? (
                  <RcImg assetKey="responsibility_center.navigation_icon" eager
                    width={22} height={22} style={{ borderRadius: 6 }}
                    fallback={<Icon size={20} />} testid="star-rc-logo" />
                ) : (
                  <Icon size={20} />
                )}
                {badgeText && <span className="starbar-badge" data-testid={`${testid}-badge`}>{badgeText}</span>}
                <span className="sr-only">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
