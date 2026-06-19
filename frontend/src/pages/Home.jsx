import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { INTERESTS, CHARACTERS } from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";
import MediaTypeBar from "@/components/MediaTypeBar";
import { Sparkles, Edit3 } from "lucide-react";
import apiClient from "@/api/client";

const STORAGE_KEY = "ourrealm.interests";
const MEDIA_STORAGE = "ourrealm.homeMedia";
const FEED_FILTER_KEY = "ourrealm.feedMedia";

function InterestCard({ interest, active, onClick, featured }) {
  const Icon = Icons[interest.icon] || Icons.Sparkles;
  return (
    <button
      onClick={onClick}
      data-active={active}
      data-featured={featured || undefined}
      data-testid={`interest-${interest.id}`}
      className="or-surface p-3 sm:p-4 text-left transition-all duration-200 relative overflow-hidden"
      style={{
        outline: active ? `2px solid ${interest.glow}` : "none",
        boxShadow: active ? `0 0 28px ${interest.glow}55, inset 0 0 0 1px ${interest.glow}` : undefined,
        background: active ? `linear-gradient(135deg, ${interest.glow}28, var(--surface))` : "var(--surface)",
        minHeight: 132,
      }}
    >
      {featured && (
        <div
          className="absolute top-2 left-2 text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded-full"
          style={{ background: "color-mix(in srgb, var(--primary) 25%, transparent)", color: "var(--primary)" }}
          data-testid={`interest-${interest.id}-featured-badge`}
        >★ Featured</div>
      )}
      {active && (
        <div
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ background: "#10E670", color: "#fff" }}
        >✓</div>
      )}
      <div className="flex items-center justify-center mb-2">
        <div
          className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center"
          style={{ border: `2px solid ${interest.glow}`, boxShadow: `0 0 14px ${interest.glow}55`, background: "color-mix(in srgb, var(--surface-2) 85%, transparent)" }}
        >
          <Icon size={22} style={{ color: interest.glow }} />
        </div>
      </div>
      <div className="text-center text-sm font-bold mb-0.5 leading-tight" style={{ color: interest.glow }}>{interest.label}</div>
      <div className="text-[10px] text-center leading-snug" style={{ color: "var(--text-muted)" }}>{interest.desc}</div>
      <div className="flex items-center justify-center gap-0.5 mt-1.5">
        {CHARACTERS.slice(0, 3).map((c) => (
          <img key={c.id} src={c.avatar} alt="" className="rounded-full" style={{ width: 14, height: 14, marginLeft: -3, border: "1px solid var(--bgc)" }} />
        ))}
        <span className="text-[9px] ml-1" style={{ color: "var(--text-muted)" }}>+{40 + interest.label.length * 6}</span>
      </div>
    </button>
  );
}

// Build interest-card objects from promoted Featured cards. We re-use
// the static INTERESTS shape so existing rendering / selection logic
// works unchanged. De-dupe rule: a featured card whose canonical id
// already matches a static card is skipped (the static one will pick
// up the "Featured" badge instead).
const FEATURED_GLOW_CYCLE = ["#C26BFF", "#10E670", "#F4C84A", "#2EA0FF", "#FF6BA0", "#6BD3FF"];
function slugifyLabel(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function buildFeaturedCards(featuredApi, staticInterests) {
  const staticIds = new Set(staticInterests.map((i) => i.id));
  return (featuredApi || [])
    .filter((c) => !staticIds.has(slugifyLabel(c.label)))
    .map((c, i) => ({
      id:    slugifyLabel(c.label) || `tag-${i}`,
      label: c.label.charAt(0).toUpperCase() + c.label.slice(1),
      icon:  "Sparkles",
      glow:  FEATURED_GLOW_CYCLE[i % FEATURED_GLOW_CYCLE.length],
      desc:  `Trending hashtag · #${c.label}`,
      _featured: true,
    }));
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
  // Featured interest cards promoted by admins (merged at top, de-duped
  // against the static INTERESTS list).
  const [featured, setFeatured] = useState([]);
  useEffect(() => {
    apiClient.get("/hashtags/interest-cards")
      .then((r) => setFeatured(r.data?.cards || []))
      .catch(() => setFeatured([]));
  }, []);
  // When user data arrives, prefer the server-persisted interests over local
  useEffect(() => {
    if (user?.interests?.length) {
      const set = new Set(user.interests);
      setSelected(set);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch { /* */ }
    }
  }, [user]);

  // Persist to localStorage whenever the selected set changes. Doing this in
  // an effect (not inside the updater) is React-Strict-Mode safe.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...selected])); } catch { /* */ }
  }, [selected]);

  const toggle = (id) => {
    // Compute the next set from the CURRENT closure state, not via a
    // functional updater. React 18 Strict Mode double-invokes updater
    // functions in dev mode, which would toggle-back a Set mutation.
    // Passing a plain value is safe and idempotent.
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const continueToFeed = async () => {
    const arr = [...selected];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      // NOTE: do NOT write `media` here — onMediaChange already persisted it.
      // Re-writing the closure value clobbers a freshly-toggled chip when
      // the user taps Next before React re-renders.
    } catch { /* */ }
    if (user && !isGuest) {
      await updateProfile({ interests: arr });
    }
    navigate("/feed");
  };
  const onMediaChange = (next) => {
    setMedia(next);
    try {
      localStorage.setItem(MEDIA_STORAGE, JSON.stringify(next));
      localStorage.setItem(FEED_FILTER_KEY, JSON.stringify(next));
    } catch { /* */ }
  };

  return (
    <div
      className="max-w-7xl mx-auto"
      data-testid="home-page"
      style={{
        // Reserve space for the floating Media Selection Bar + Bottom Nav
        paddingBottom: "calc(64px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* Header — Customize Feed (P5 rename) */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-3xl sm:text-4xl flex items-baseline gap-3 flex-wrap" style={{ fontFamily: "var(--font-display)" }}>
            Customize Feed
            <span className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Pick your interest</span>
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Follow what you love. We'll personalize your experience.
          </p>
        </div>
        <button className="or-chip" data-testid="home-edit-interests"><Edit3 size={14} /> Edit Interests</button>
      </div>

      {/* Category selection — moved up, responsive grid (3 cols mobile, more on larger screens) */}
      {(() => {
        const featuredNew = buildFeaturedCards(featured, INTERESTS);
        const featuredIds = new Set(featured.map((c) => slugifyLabel(c.label)));
        return (
          <>
            {featuredNew.length > 0 && (
              <Section title="Featured by OurRealm" testid="featured" items={featuredNew} selected={selected} toggle={toggle} featuredIds={featuredIds} />
            )}
            <Section title="Recommended for you" testid="recommended" items={INTERESTS.slice(0, 6)} selected={selected} toggle={toggle} featuredIds={featuredIds} />
            <Section title="Explore more"        testid="explore"     items={INTERESTS.slice(6, 12)} selected={selected} toggle={toggle} featuredIds={featuredIds} />
            {INTERESTS.length > 12 && (
              <Section title="Dive deeper" testid="deeper" items={INTERESTS.slice(12)} selected={selected} toggle={toggle} featuredIds={featuredIds} />
            )}
          </>
        );
      })()}

      {/* Floating Media Selection Bar — unchanged behavior */}
      <div
        className="fixed left-0 right-0 z-30 pointer-events-none"
        style={{
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
              style={{ color: "var(--text-muted)", textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}
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

function Section({ title, testid, items, selected, toggle, featuredIds }) {
  return (
    <div className="mb-6" data-testid={`section-${testid}`}>
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-base sm:text-lg flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          <Sparkles size={14} /> {title}
        </h3>
      </div>
      {/* 3 per row on mobile, more on larger screens */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
        {items.map((it) => (
          <InterestCard
            key={it.id}
            interest={it}
            active={selected.has(it.id)}
            featured={it._featured || (featuredIds && featuredIds.has(it.id))}
            onClick={() => toggle(it.id)}
          />
        ))}
      </div>
    </div>
  );
}
