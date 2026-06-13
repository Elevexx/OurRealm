import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { INTERESTS, CHARACTERS, CURRENT_PERSONA } from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";
import MediaTypeBar from "@/components/MediaTypeBar";
import { Sparkles, Edit3, Search, ChevronRight, Sliders } from "lucide-react";

const STORAGE_KEY = "ourrealm.interests";
const MEDIA_STORAGE = "ourrealm.homeMedia";

function InterestCard({ interest, active, onClick }) {
  const Icon = Icons[interest.icon] || Icons.Sparkles;
  return (
    <button
      onClick={onClick}
      data-active={active}
      data-testid={`interest-${interest.id}`}
      className="or-surface p-4 text-left transition-all duration-200 relative overflow-hidden"
      style={{
        outline: active ? `2px solid ${interest.glow}` : "none",
        boxShadow: active ? `0 0 28px ${interest.glow}55, inset 0 0 0 1px ${interest.glow}` : undefined,
        background: active ? `linear-gradient(135deg, ${interest.glow}28, var(--surface))` : "var(--surface)",
        minHeight: 168,
      }}
    >
      {active && (
        <div
          className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: "#10E670", color: "#fff" }}
        >✓</div>
      )}
      <div className="flex items-center justify-center mb-3">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ border: `2px solid ${interest.glow}`, boxShadow: `0 0 18px ${interest.glow}66`, background: "color-mix(in srgb, var(--surface-2) 85%, transparent)" }}
        >
          <Icon size={28} style={{ color: interest.glow }} />
        </div>
      </div>
      <div className="text-center font-bold mb-1" style={{ color: interest.glow }}>{interest.label}</div>
      <div className="text-[11px] text-center leading-snug" style={{ color: "var(--text-muted)" }}>{interest.desc}</div>
      <div className="flex items-center justify-center gap-1 mt-2">
        {CHARACTERS.slice(0, 3).map((c) => (
          <img key={c.id} src={c.avatar} alt="" className="rounded-full" style={{ width: 18, height: 18, marginLeft: -4, border: "1px solid var(--bgc)" }} />
        ))}
        <span className="text-[10px] ml-1" style={{ color: "var(--text-muted)" }}>+{40 + interest.label.length * 6}</span>
      </div>
    </button>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { user, isGuest, updateProfile } = useAuth();
  const [media, setMedia] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MEDIA_STORAGE) || "[]"); } catch { return []; }
  });
  const [selected, setSelected] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); } catch { return new Set(); }
  });
  useEffect(() => {
    if (user?.interests?.length) setSelected(new Set(user.interests));
  }, [user]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  const continueToFeed = async () => {
    const arr = [...selected];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
    if (user && !isGuest) await updateProfile({ interests: arr });
    navigate("/feed");
  };
  const onMediaChange = (next) => {
    setMedia(next);
    try { localStorage.setItem(MEDIA_STORAGE, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const recommended = INTERESTS.slice(0, 4);
  const explore     = INTERESTS.slice(4, 8);
  const deeper      = INTERESTS.slice(8, 12);

  return (
    <div
      className="max-w-7xl mx-auto"
      data-testid="home-page"
      style={{
        /* Reserve space so the bottom-most cards aren't hidden behind the
           fixed Media Selection Bar + Bottom Navigation stack.
           Layout.jsx already reserves ~110px for the nav; we add the
           media bar height (~64px) on top of that. */
        paddingBottom: "calc(64px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-3xl sm:text-4xl flex items-baseline gap-3" style={{ fontFamily: "var(--font-display)" }}>
            Home
            <span className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Pick your interests</span>
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Follow what you love. We'll personalize your experience.
          </p>
        </div>
        <button className="or-chip" data-testid="home-edit-interests"><Edit3 size={14} /> Edit Interests</button>
      </div>

      {/* Quick interest pills */}
      <div className="or-surface px-3 py-3 mb-4 flex items-center gap-3 sm:gap-6 overflow-x-auto no-scrollbar" data-testid="home-pill-row">
        {INTERESTS.slice(0, 7).map((it) => {
          const Icon = Icons[it.icon] || Icons.Sparkles;
          const active = selected.has(it.id);
          return (
            <button
              key={it.id}
              onClick={() => toggle(it.id)}
              data-active={active}
              data-testid={`home-pill-${it.id}`}
              className="flex flex-col items-center gap-1 shrink-0"
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{
                  border: `2px solid ${it.glow}`,
                  background: active ? `${it.glow}22` : "transparent",
                  boxShadow: `0 0 12px ${it.glow}55`,
                }}
              >
                <Icon size={22} style={{ color: it.glow }} />
              </div>
              <div className="text-[11px] font-semibold" style={{ color: it.glow }}>{it.label}</div>
            </button>
          );
        })}
      </div>

      {/* Live users row */}
      <div className="or-surface p-3 mb-4 flex gap-5 overflow-x-auto no-scrollbar" data-testid="home-live-row">
        {CHARACTERS.map((c) => (
          <div key={c.id} className="flex flex-col items-center gap-1 shrink-0" data-testid={`home-user-${c.id}`}>
            <div className="rounded-full p-[3px]" style={{ background: c.ringColor, boxShadow: `0 0 12px ${c.ringColor}55` }}>
              <img src={c.avatar} alt="" className="rounded-full object-cover" style={{ width: 56, height: 56, border: "3px solid var(--bgc)" }} />
            </div>
            <div className="text-xs font-semibold" style={{ color: "var(--text-main)" }}>{c.name}</div>
            <div className="text-[10px]" style={{ color: c.ringColor }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="or-surface p-2.5 mb-5 flex items-center gap-2">
        <Search size={16} style={{ color: "var(--text-muted)" }} />
        <input
          className="bg-transparent flex-1 outline-none text-sm" placeholder="Search for friends, groups, or messages…"
          style={{ color: "var(--text-main)" }} data-testid="home-search"
        />
        <Sliders size={16} style={{ color: "var(--text-muted)" }} />
      </div>

      {/* Sections */}
      <Section title="Recommended for you" testid="recommended" items={recommended} selected={selected} toggle={toggle} />
      <Section title="Explore more"        testid="explore"     items={explore}     selected={selected} toggle={toggle} />
      <Section title="Dive deeper"         testid="deeper"      items={deeper}      selected={selected} toggle={toggle} />

      {/* Floating Media Selection Bar — fixed above the Bottom Navigation.
          Stays visible while scrolling, hovers/glows above the nav,
          and respects iPhone safe-area-inset-bottom. */}
      <div
        className="fixed left-0 right-0 z-30 pointer-events-none"
        style={{
          /* BottomNav height (~76px) + safe-area inset.
             Place the bar directly on top of the nav. */
          bottom: "calc(76px + env(safe-area-inset-bottom, 0px))",
          paddingLeft: "max(0.75rem, env(safe-area-inset-left, 0px))",
          paddingRight: "max(0.75rem, env(safe-area-inset-right, 0px))",
        }}
        data-testid="home-media-bar-fixed"
      >
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <div
            className="or-surface p-2.5"
            style={{
              boxShadow: "0 12px 32px rgba(0,0,0,0.35), 0 0 18px color-mix(in srgb, var(--primary) 35%, transparent)",
              backdropFilter: "blur(14px)",
              background: "color-mix(in srgb, var(--surface) 88%, transparent)",
            }}
          >
            <MediaTypeBar value={media} onChange={onMediaChange} onNext={continueToFeed} embedded />
          </div>
          {selected.size > 0 && (
            <div
              className="text-center mt-1.5 text-[11px]"
              style={{
                color: "var(--text-muted)",
                textShadow: "0 1px 6px rgba(0,0,0,0.5)",
              }}
              data-testid="home-media-bar-summary"
            >
              {selected.size} interests · {media.length === 0 ? "all media" : `${media.length} media type${media.length > 1 ? "s" : ""}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, testid, items, selected, toggle }) {
  return (
    <div className="mb-7" data-testid={`section-${testid}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg sm:text-xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          <Sparkles size={16} /> {title}
        </h3>
        <button className="text-xs flex items-center gap-1" style={{ color: "var(--primary)" }}>View all <ChevronRight size={12} /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {items.map((it) => (
          <InterestCard key={it.id} interest={it} active={selected.has(it.id)} onClick={() => toggle(it.id)} />
        ))}
      </div>
    </div>
  );
}
