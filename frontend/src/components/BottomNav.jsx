import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Home, Search, Sparkles, Plus, Wallet, Users, User, Radio, Video, Image as ImageIcon, MessageSquare, X, Music2, Send } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import GuestPrompt from "@/components/GuestPrompt";

const ITEMS_LEFT = [
  // The Home button on the bottom navigation opens the For You feed
  // (per the latest spec). The interest-picker page is reached via
  // "Customize Feed" inside /feed itself.
  { to: "/feed",     label: "Home",     Icon: Home,     testid: "bottom-home" },
  { to: "/discover", label: "Discover", Icon: Search,   testid: "bottom-discover" },
  { to: "/feed",     label: "For You",  Icon: Sparkles, testid: "bottom-foryou" },
];
const ITEMS_RIGHT = [
  { to: "/wallet",  label: "Wallet",  Icon: Wallet, testid: "bottom-wallet" },
  { to: "/friends", label: "Friends", Icon: Users,  testid: "bottom-friends" },
  { to: "/profile", label: "Profile", Icon: User,   testid: "bottom-profile" },
];

const CREATE_OPTIONS = [
  { id: "live",    label: "Go Live", Icon: Radio,         color: "#FF3F5A", desc: "Stream to your Realm now" },
  { id: "video",   label: "Video",   Icon: Video,         color: "var(--brand-blue)", desc: "Upload a clip or reel" },
  { id: "image",   label: "Image",   Icon: ImageIcon,     color: "var(--brand-green)", desc: "Share a photo album" },
  { id: "sound",   label: "Sound",   Icon: Music2,        color: "#C26BFF", desc: "Drop a track or audio post" },
  { id: "thought", label: "Thought", Icon: MessageSquare, color: "#F4C84A", desc: "Quick text from your mind" },
];

function CreateWorkflow({ option, onClose, onDone }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [posting, setPosting] = useState(false);
  if (!option) return null;
  const Icon = option.Icon;

  const submit = async () => {
    setPosting(true);
    try {
      const content = option.id === "thought"
        ? text.trim()
        : `${title.trim() || option.label}${text.trim() ? " — " + text.trim() : ""}`;
      if (!content) { setPosting(false); return; }
      await apiClient.post("/posts", {
        content,
        media_type: option.id === "thought" ? "thought" : option.id === "image" ? "image" : option.id === "video" ? "video" : option.id === "live" ? "live" : "sound",
      });
      onDone();
    } finally { setPosting(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid={`create-workflow-${option.id}`}
    >
      <div className="or-surface w-full max-w-lg p-6 grain" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="rounded-full flex items-center justify-center"
            style={{
              width: 48, height: 48,
              background: `color-mix(in srgb, ${option.color} 18%, transparent)`,
              border: `2px solid ${option.color}`,
              boxShadow: `0 0 14px ${option.color}66`,
              color: option.color,
            }}
          >
            <Icon size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>{option.label}</h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{option.desc}</p>
          </div>
          <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={onClose}><X size={16} /></button>
        </div>

        {option.id === "live" && (
          <>
            <div className="or-surface p-4 mb-3" style={{ background: "var(--surface-2)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#FF3F5A" }} />
                <span className="text-xs uppercase tracking-widest font-bold" style={{ color: "#FF3F5A" }}>Pre-Live · Camera + mic check</span>
              </div>
              <input className="or-input mb-2" placeholder="Stream title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="create-live-title" />
              <textarea className="or-input resize-none" rows={2} placeholder="Tell viewers what you're doing…" value={text} onChange={(e) => setText(e.target.value)} data-testid="create-live-desc" />
            </div>
          </>
        )}
        {option.id === "video" && (
          <>
            <button className="or-surface p-6 mb-3 w-full text-center cursor-pointer" style={{ background: "var(--surface-2)", borderStyle: "dashed" }} data-testid="create-video-dropzone">
              <Video size={28} style={{ color: option.color }} className="mx-auto mb-2" />
              <div className="text-sm font-semibold">Drop video file or tap to choose</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>MP4, MOV · up to 10 min</div>
            </button>
            <input className="or-input mb-2" placeholder="Video title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="create-video-title" />
            <textarea className="or-input resize-none" rows={2} placeholder="Description (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        {option.id === "image" && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[0,1,2,3,4,5].map((i) => (
                <button key={i} className="aspect-square or-surface overflow-hidden" style={{ background: "var(--surface-2)", borderStyle: i < 2 ? "solid" : "dashed" }} data-testid={`create-image-slot-${i}`}>
                  {i < 2 ? (
                    <img src={`https://picsum.photos/200/200?random=${i + 80}`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={20} style={{ color: option.color, margin: "0 auto" }} className="mt-6" />
                  )}
                </button>
              ))}
            </div>
            <input className="or-input mb-2" placeholder="Album title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="create-image-title" />
            <textarea className="or-input resize-none" rows={2} placeholder="Caption (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        {option.id === "sound" && (
          <>
            <div className="or-surface p-5 mb-3" style={{ background: "var(--surface-2)" }}>
              <div className="flex items-end gap-1 h-12 mb-2">
                {Array.from({ length: 28 }).map((_, i) => (
                  <div key={i} className="flex-1 rounded-sm" style={{
                    height: `${20 + Math.abs(Math.sin(i * 0.7)) * 80}%`,
                    background: option.color, opacity: 0.7 + (i % 3) * 0.1,
                  }} />
                ))}
              </div>
              <div className="text-xs text-center" style={{ color: "var(--text-muted)" }}>Drop audio file or record</div>
            </div>
            <input className="or-input mb-2" placeholder="Track title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="create-sound-title" />
            <textarea className="or-input resize-none" rows={2} placeholder="Description (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        {option.id === "thought" && (
          <textarea
            className="or-input resize-none"
            rows={5}
            placeholder="What's on your mind right now?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="create-thought-text"
          />
        )}

        <div className="flex gap-2 mt-4">
          <button className="or-btn flex-1" onClick={submit} disabled={posting} data-testid={`create-${option.id}-submit`}>
            {posting ? "Publishing…" : <><Send size={14} /> {option.id === "live" ? "Go live" : "Publish"}</>}
          </button>
          <button className="or-btn or-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState(null);
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
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
          maxWidth: "100vw",
        }}
        data-testid="bottom-nav"
      >
        <div className="max-w-5xl mx-auto flex items-end px-1 sm:px-4 py-1.5 max-w-full">
          {ITEMS_LEFT.map(({ to, label, Icon, testid }) => {
            const active = location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <button key={testid} className="bottomnav-btn" data-active={active} data-testid={testid} onClick={() => navigate(to)}>
                <Icon size={22} />
                <span>{label}</span>
              </button>
            );
          })}

          <div className="flex-[0_0_56px] sm:flex-[0_0_72px] flex justify-center -translate-y-3">
            <button
              data-testid="bottom-create"
              onClick={onCreateClick}
              className="flex items-center justify-center"
              style={{
                width: 52, height: 52, borderRadius: 999,
                background: "linear-gradient(135deg, var(--primary), var(--secondary))",
                color: "var(--primary-fg)",
                border: "3px solid var(--bgc)",
                boxShadow: "0 0 24px color-mix(in srgb, var(--primary) 65%, transparent)",
              }}
              aria-label="Create"
            >
              <Plus size={24} />
            </button>
          </div>

          {ITEMS_RIGHT.map(({ to, label, Icon, testid }) => {
            // The Profile tab opens the *Public* view of the logged-in
            // user's profile (the top-bar profile icon opens the Edit view).
            const target = testid === "bottom-profile" && user?.username
              ? `/public/${user.username}`
              : to;
            const active = location.pathname === target || location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <button key={testid} className="bottomnav-btn" data-active={active} data-testid={testid} onClick={() => navigate(target)}>
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
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
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
              {CREATE_OPTIONS.map((opt) => {
                const Icon = opt.Icon;
                return (
                  <button
                    key={opt.id}
                    data-testid={`create-${opt.id}`}
                    onClick={() => { setShowCreate(false); setActiveWorkflow(opt); }}
                    className="or-surface p-4 flex flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <Icon size={26} style={{ color: opt.color }} />
                    <span className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <CreateWorkflow
        option={activeWorkflow}
        onClose={() => setActiveWorkflow(null)}
        onDone={() => { setActiveWorkflow(null); navigate("/feed"); }}
      />

      <GuestPrompt open={!!guestPrompt} onClose={() => setGuestPrompt(null)} action={guestPrompt || "do this"} />
    </>
  );
}
