import React, { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import {
  Home, Compass, Music, MessageCircle, Bell, Wallet, Users, Store, LayoutGrid,
  User, Settings, LogOut, Plus, Radio, Video, Image as ImageIcon, MessageSquare, Link as LinkIcon,
  Search, Menu, X,
} from "lucide-react";
import Logo from "@/components/Logo";
import ModeSwitcher from "@/components/ModeSwitcher";
import GuestPrompt from "@/components/GuestPrompt";
import { useAuth } from "@/contexts/AuthContext";

const NAV = [
  { to: "/home", label: "Interests", icon: Home, testid: "nav-home" },
  { to: "/feed", label: "For You", icon: LayoutGrid, testid: "nav-feed" },
  { to: "/discover", label: "Discover", icon: Compass, testid: "nav-discover" },
  { to: "/music", label: "Music", icon: Music, testid: "nav-music" },
  { to: "/friends", label: "Friends", icon: Users, testid: "nav-friends" },
  { to: "/messages", label: "Messages", icon: MessageCircle, testid: "nav-messages" },
  { to: "/notifications", label: "Alerts", icon: Bell, testid: "nav-notifications" },
  { to: "/wallet", label: "Wallet", icon: Wallet, testid: "nav-wallet" },
  { to: "/marketplace", label: "Marketplace", icon: Store, testid: "nav-marketplace" },
  { to: "/widgets", label: "Widgets", icon: LayoutGrid, testid: "nav-widgets" },
  { to: "/profile", label: "Profile", icon: User, testid: "nav-profile" },
];

const UPLOAD_OPTIONS = [
  { id: "live", label: "Live Stream", icon: Radio },
  { id: "video", label: "Video", icon: Video },
  { id: "photo", label: "Photo Album", icon: ImageIcon },
  { id: "thought", label: "Thought", icon: MessageSquare },
  { id: "link", label: "Link", icon: LinkIcon },
];

export default function Layout({ children }) {
  const { user, isGuest, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showUpload, setShowUpload] = useState(false);
  const [showMobile, setShowMobile] = useState(false);
  const [guestPrompt, setGuestPrompt] = useState(null);

  const handleUploadClick = () => {
    if (!user) { setGuestPrompt("upload content"); return; }
    setShowUpload((v) => !v);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ position: "relative" }}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 px-4 sm:px-6 py-3 flex items-center justify-between gap-3"
        style={{
          background: "color-mix(in srgb, var(--bgc) 80%, transparent)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--border-col)",
        }}
        data-testid="app-header"
      >
        <Link to="/feed" className="flex items-center gap-3" data-testid="header-logo">
          <Logo size={36} withWordmark />
        </Link>
        <div className="hidden md:block">
          <ModeSwitcher />
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            className="or-btn-ghost or-btn hidden sm:inline-flex"
            data-testid="header-search"
            onClick={() => navigate("/discover")}
            aria-label="Search"
            style={{ padding: "0.55rem 0.9rem" }}
          >
            <Search size={16} />
          </button>
          <button
            data-testid="header-upload-button"
            onClick={handleUploadClick}
            className="or-btn"
            style={{ padding: "0.55rem 0.9rem", borderRadius: 999 }}
            aria-label="Upload"
          >
            <Plus size={18} />
          </button>
          {user ? (
            <button
              data-testid="header-profile-button"
              onClick={() => navigate("/profile")}
              className="rounded-full overflow-hidden"
              style={{ width: 36, height: 36, border: "1px solid var(--border-col)" }}
            >
              <img
                alt={user.name}
                src={user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name)}`}
                className="w-full h-full object-cover"
              />
            </button>
          ) : (
            <button
              className="or-btn"
              data-testid="header-signin-button"
              onClick={() => navigate("/signin")}
              style={{ padding: "0.5rem 1rem" }}
            >
              Sign in
            </button>
          )}
          <button
            className="md:hidden or-btn or-btn-ghost"
            data-testid="header-mobile-toggle"
            onClick={() => setShowMobile((v) => !v)}
            style={{ padding: "0.5rem" }}
          >
            {showMobile ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {/* Mobile mode switcher */}
      <div className="md:hidden px-4 pt-3"><ModeSwitcher compact /></div>

      {/* Body */}
      <div className="flex-1 flex">
        {/* Side nav */}
        <aside
          className={`${showMobile ? "block" : "hidden"} md:block w-64 shrink-0 px-3 py-4 sticky`}
          style={{ top: 72, height: "calc(100vh - 72px)", overflowY: "auto", borderRight: "1px solid var(--border-col)" }}
          data-testid="side-nav"
        >
          <nav className="flex flex-col gap-1">
            {NAV.map((n) => {
              const Active = location.pathname.startsWith(n.to);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  data-testid={n.testid}
                  onClick={() => setShowMobile(false)}
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors"
                  style={{
                    borderRadius: "var(--radius)",
                    background: Active ? "color-mix(in srgb, var(--primary) 16%, transparent)" : "transparent",
                    color: Active ? "var(--text-main)" : "var(--text-muted)",
                    fontFamily: "var(--font-body)",
                    fontWeight: Active ? 600 : 500,
                    borderLeft: Active ? "3px solid var(--primary)" : "3px solid transparent",
                  }}
                >
                  <Icon size={18} />
                  <span>{n.label}</span>
                </Link>
              );
            })}
            <div className="mt-4 px-3 py-2 text-[10px] tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Account
            </div>
            <Link
              to="/settings"
              data-testid="nav-settings"
              onClick={() => setShowMobile(false)}
              className="flex items-center gap-3 px-3 py-2.5"
              style={{ color: "var(--text-muted)", borderRadius: "var(--radius)" }}
            >
              <Settings size={18} /><span>Settings</span>
            </Link>
            {user && (
              <button
                onClick={() => { logout(); navigate("/"); }}
                data-testid="nav-logout"
                className="flex items-center gap-3 px-3 py-2.5 text-left"
                style={{ color: "var(--text-muted)", borderRadius: "var(--radius)" }}
              >
                <LogOut size={18} /><span>Sign out</span>
              </button>
            )}
            {isGuest && !user && (
              <div className="or-surface mt-3 p-3 text-xs" style={{ color: "var(--text-muted)" }}>
                <div className="mb-2 font-semibold" style={{ color: "var(--text-main)" }}>Browsing as guest</div>
                <button
                  className="or-btn w-full"
                  style={{ padding: "0.45rem 0.6rem", fontSize: "0.75rem" }}
                  data-testid="sidebar-guest-signup"
                  onClick={() => navigate("/signup")}
                >
                  Join OurRealm
                </button>
              </div>
            )}
          </nav>
        </aside>

        {/* Page */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6" data-testid="page-main">
          {children}
        </main>
      </div>

      {/* Upload overlay */}
      {showUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowUpload(false)}
          data-testid="upload-overlay"
        >
          <div className="or-surface p-6 sm:p-8 max-w-lg w-[92%]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Share to your Realm</h3>
              <button onClick={() => setShowUpload(false)} className="or-btn-ghost or-btn" style={{ padding: "0.35rem 0.6rem" }}>
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {UPLOAD_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    data-testid={`upload-option-${opt.id}`}
                    onClick={() => {
                      setShowUpload(false);
                      navigate(`/feed?compose=${opt.id}`);
                    }}
                    className="or-surface p-4 flex flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <Icon size={28} style={{ color: "var(--primary)" }} />
                    <span className="text-sm font-semibold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <GuestPrompt open={!!guestPrompt} onClose={() => setGuestPrompt(null)} action={guestPrompt || "do this"} />
    </div>
  );
}
