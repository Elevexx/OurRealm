import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Home, Search, Sparkles, Plus, Wallet, Users, User, Radio, Video, Image as ImageIcon, MessageSquare, Link as LinkIcon, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import GuestPrompt from "@/components/GuestPrompt";

const ITEMS_LEFT = [
  { to: "/home",     label: "Home",     Icon: Home,     testid: "bottom-home" },
  { to: "/discover", label: "Discover", Icon: Search,   testid: "bottom-discover" },
  { to: "/feed",     label: "For You",  Icon: Sparkles, testid: "bottom-foryou" },
];
const ITEMS_RIGHT = [
  { to: "/wallet",  label: "Wallet",  Icon: Wallet, testid: "bottom-wallet" },
  { to: "/friends", label: "Friends", Icon: Users,  testid: "bottom-friends" },
  { to: "/profile", label: "Profile", Icon: User,   testid: "bottom-profile" },
];

const CREATE_OPTIONS = [
  { id: "live",    label: "Go Live", Icon: Radio,         color: "#FF3344" },
  { id: "video",   label: "Video",   Icon: Video,         color: "var(--brand-blue)" },
  { id: "image",   label: "Image",   Icon: ImageIcon,     color: "var(--brand-green)" },
  { id: "sound",   label: "Sound",   Icon: () => <span style={{fontSize:22}}>♪</span>, color: "#C26BFF" },
  { id: "thought", label: "Thought", Icon: MessageSquare, color: "#F4C84A" },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [guestPrompt, setGuestPrompt] = useState(null);

  const onCreateClick = () => {
    if (!user) { setGuestPrompt("create content"); return; }
    setShowCreate(true);
  };

  return (
    <>
      <nav
        className="fixed left-0 right-0 bottom-0 z-40"
        style={{
          background: "color-mix(in srgb, var(--bgc) 90%, transparent)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid var(--border-col)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        data-testid="bottom-nav"
      >
        <div className="max-w-5xl mx-auto flex items-end px-2 sm:px-4 py-1.5">
          {ITEMS_LEFT.map(({ to, label, Icon, testid }) => {
            const active = location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <button key={to} className="bottomnav-btn" data-active={active} data-testid={testid} onClick={() => navigate(to)}>
                <Icon size={22} />
                <span>{label}</span>
              </button>
            );
          })}

          {/* Center + */}
          <div className="flex-[0_0_72px] flex justify-center -translate-y-3">
            <button
              data-testid="bottom-create"
              onClick={onCreateClick}
              className="flex items-center justify-center"
              style={{
                width: 58, height: 58, borderRadius: 999,
                background: "linear-gradient(135deg, var(--primary), var(--secondary))",
                color: "var(--primary-fg)",
                border: "3px solid var(--bgc)",
                boxShadow: "0 0 24px color-mix(in srgb, var(--primary) 65%, transparent)",
              }}
              aria-label="Create"
            >
              <Plus size={26} />
            </button>
          </div>

          {ITEMS_RIGHT.map(({ to, label, Icon, testid }) => {
            const active = location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <button key={to} className="bottomnav-btn" data-active={active} data-testid={testid} onClick={() => navigate(to)}>
                <Icon size={22} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Create radial menu */}
      {showCreate && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-24 sm:pb-0"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowCreate(false)}
          data-testid="create-overlay"
        >
          <div className="or-surface p-6 sm:p-8 w-full max-w-lg grain" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>What are you creating?</h3>
              <button className="starbar-icon" onClick={() => setShowCreate(false)} style={{ width: 36, height: 36 }}>
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {CREATE_OPTIONS.map(({ id, label, Icon, color }) => (
                <button
                  key={id}
                  data-testid={`create-${id}`}
                  onClick={() => { setShowCreate(false); navigate(`/feed?compose=${id}`); }}
                  className="or-surface p-4 flex flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
                  style={{ background: "var(--surface-2)" }}
                >
                  <span style={{ color }}>
                    {typeof Icon === "function" ? <Icon /> : <Icon size={26} />}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <GuestPrompt open={!!guestPrompt} onClose={() => setGuestPrompt(null)} action={guestPrompt || "do this"} />
    </>
  );
}
