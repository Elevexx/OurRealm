import React, { useMemo } from "react";
import { Flame, Sparkles, Heart, Star, PlayCircle } from "lucide-react";
import { makeMockPosts, CHARACTERS } from "@/data/mockData";
import { useNavigate } from "react-router-dom";

export default function Featured() {
  const navigate = useNavigate();
  const posts = useMemo(() => makeMockPosts(20), []);
  const hero = posts[0];

  return (
    <div className="max-w-7xl mx-auto" data-testid="featured-page">
      <div className="mb-5 flex items-center gap-3">
        <Star size={28} style={{ color: "#F4C84A", filter: "drop-shadow(0 0 12px rgba(244,200,74,0.6))" }} />
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Hand-picked by OurRealm</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Featured</h1>
        </div>
      </div>

      {/* Hero */}
      <div className="or-surface overflow-hidden mb-5 grain" data-testid="featured-hero">
        <div className="relative h-64 sm:h-80">
          <img src={hero.media_url} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.85))" }} />
          <span className="absolute top-4 left-4 px-2 py-1 text-[10px] font-bold uppercase tracking-widest" style={{ background: "#F4C84A", color: "#000", borderRadius: 4 }}>
            <Star size={12} className="inline mr-1" /> Featured
          </span>
          <div className="absolute bottom-4 left-4 right-4">
            <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--brand-green)" }}>Live now · 4,182 watching</div>
            <h2 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)", color: "#fff" }}>{hero.content}</h2>
            <div className="mt-2 flex items-center gap-2 text-sm" style={{ color: "#cfd9e5" }}>
              <img src={hero.author_avatar} alt="" className="rounded-full" style={{ width: 28, height: 28 }} />
              @{hero.author_name}
            </div>
          </div>
        </div>
      </div>

      {/* Trending creators */}
      <div className="mb-7">
        <h3 className="text-xl mb-3 flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          <Flame size={18} /> Trending creators
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {CHARACTERS.map((c) => (
            <div key={c.id} className="or-surface p-4 text-center" data-testid={`featured-creator-${c.id}`}>
              <div className="rounded-full p-[3px] mx-auto" style={{ background: c.ringColor, width: 88, height: 88 }}>
                <img src={c.avatar} alt="" className="w-full h-full rounded-full object-cover" />
              </div>
              <div className="mt-3 font-semibold" style={{ color: "var(--text-main)" }}>@{c.name}</div>
              <div className="text-[10px] mt-1 uppercase tracking-widest" style={{ color: c.ringColor }}>{c.label}</div>
              <button className="or-btn w-full mt-3" style={{ padding: "0.4rem", fontSize: "0.78rem" }} onClick={() => navigate("/messages")}>
                <Heart size={12} /> Follow
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Featured stream cards */}
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="text-xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          <Sparkles size={18} /> Editor's picks
        </h3>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {posts.slice(1, 10).map((p) => (
          <div key={p.id} className="or-surface overflow-hidden" data-testid={`featured-card-${p.id}`}>
            <div className="relative h-44 overflow-hidden">
              <img src={p.media_url} alt="" className="w-full h-full object-cover" />
              <span className="absolute top-3 left-3 px-2 py-0.5 text-[10px] tracking-widest uppercase font-bold" style={{ background: "var(--primary)", color: "var(--primary-fg)", borderRadius: 4 }}>
                {p.media_type}
              </span>
              <PlayCircle size={32} className="absolute bottom-3 right-3" style={{ color: "#fff", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }} />
            </div>
            <div className="p-3">
              <div className="text-sm font-semibold line-clamp-2" style={{ color: "var(--text-main)" }}>{p.content}</div>
              <div className="text-xs mt-1 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                <img src={p.author_avatar} alt="" className="rounded-full" style={{ width: 18, height: 18 }} />
                @{p.author_name} · ♥ {p.likes.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
