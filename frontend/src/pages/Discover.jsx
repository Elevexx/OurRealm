import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import MiniWidget from "@/components/MiniWidget";
import RadiusChips from "@/components/RadiusChips";
import ZipRequiredModal from "@/components/ZipRequiredModal";
import { useAuth } from "@/contexts/AuthContext";
import { DISCOVER_ROWS, makeMockPosts, TRENDING_CREATORS, REALMS } from "@/data/mockData";

const FILTERS = [
  { id: "trending",  label: "Trending",  Icon: Icons.Flame,    color: "#FF8AC2" },
  { id: "favorites", label: "Favorites", Icon: Icons.Heart,    color: "#FF3F5A" },
  { id: "new",       label: "New",       Icon: Icons.Sparkles, color: "var(--brand-green)" },
  { id: "rising",    label: "Rising",    Icon: Icons.Rocket,   color: "var(--brand-blue)" },
  { id: "following", label: "Following", Icon: Icons.UserCheck,color: "#C26BFF" },
];

function HRow({ id, title, Icon, children, accent }) {
  const scrollerRef = useRef(null);
  const by = (d) => scrollerRef.current?.scrollBy({ left: d * 360, behavior: "smooth" });
  return (
    <section className="mb-9" data-testid={`discover-row-${id}`}>
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="flex items-center gap-2 text-xl sm:text-2xl" style={{ fontFamily: "var(--font-display)" }}>
          <Icon size={20} style={{ color: accent || "var(--primary)" }} /> {title}
        </h2>
        <div className="flex gap-2">
          <button className="or-chip" onClick={() => by(-1)} data-testid={`discover-${id}-prev`}><Icons.ChevronLeft size={14} /></button>
          <button className="or-chip" onClick={() => by(1)} data-testid={`discover-${id}-next`}><Icons.ChevronRight size={14} /></button>
        </div>
      </div>
      <div ref={scrollerRef} className="flex gap-4 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1 snap-x">{children}</div>
    </section>
  );
}

function CreatorCard({ c, onClick }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      className="or-surface shrink-0 overflow-hidden snap-start text-left p-4 cursor-pointer"
      style={{ width: 230 }}
      data-testid={`discover-creator-${c.id}`}
    >
      <div className="flex flex-col items-center">
        <div className="rounded-full p-[3px] mb-3" style={{ background: c.ringColor, boxShadow: `0 0 14px ${c.ringColor}66`, width: 96, height: 96 }}>
          <img src={c.avatar} alt="" className="w-full h-full rounded-full object-cover" style={{ border: "3px solid var(--bgc)" }} />
        </div>
        {c.isLive && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 -mt-3 mb-2 rounded" style={{ background: "#FF3F5A", color: "#fff" }}>● LIVE</span>
        )}
        <div className="font-bold" style={{ color: "var(--text-main)" }}>@{c.name}</div>
        <div className="text-xs uppercase tracking-widest mt-1" style={{ color: c.ringColor }}>{c.category}</div>
        <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{c.followers.toLocaleString()} followers</div>
        <button className="or-btn w-full mt-3" style={{ padding: "0.4rem", fontSize: "0.78rem" }} onClick={(e) => e.stopPropagation()}>
          <Icons.UserPlus size={12} /> Follow
        </button>
      </div>
    </div>
  );
}

function ContentCard({ p, label, accent }) {
  return (
    <div key={p.id} className="or-surface shrink-0 overflow-hidden snap-start" style={{ width: 280, height: 360 }} data-testid={`discover-card-${p.id}`}>
      <div className="relative h-2/3 overflow-hidden">
        <img src={p.media_url} alt="" className="w-full h-full object-cover transition-transform duration-700 hover:scale-105" />
        <span className="absolute top-3 left-3 px-2 py-0.5 text-[10px] tracking-widest uppercase" style={{ background: accent || "var(--primary)", color: "#fff", borderRadius: 4 }}>
          {label || p.media_type}
        </span>
        {p.media_type === "live" && (
          <span className="absolute bottom-3 left-3 px-2 py-0.5 text-[10px] font-bold tracking-widest" style={{ background: "#FF3F5A", color: "#fff", borderRadius: 4 }}>
            ● {Math.floor(p.likes / 10)} watching
          </span>
        )}
      </div>
      <div className="p-3 h-1/3 flex flex-col justify-between">
        <div className="text-sm font-semibold line-clamp-2" style={{ color: "var(--text-main)" }}>@{p.author_name}</div>
        <div className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>{p.content}</div>
        <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--primary)" }}>
          ♥ {p.likes.toLocaleString()} · {p.comments}c
        </div>
      </div>
    </div>
  );
}

function RealmCard({ r, onClick }) {
  return (
    <button onClick={onClick} className="or-surface shrink-0 overflow-hidden snap-start text-left" style={{ width: 280, height: 200 }} data-testid={`discover-realm-${r.id}`}>
      <div className="relative h-3/5">
        <img src={r.banner} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 30%, ${r.accent}22 70%, rgba(0,0,0,0.55))` }} />
        <span className="absolute top-3 left-3 text-2xl">{r.emoji}</span>
        <span className="absolute top-3 right-3 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#10E670", color: "#000" }}>● {r.online} online</span>
      </div>
      <div className="p-3">
        <div className="font-bold" style={{ color: "var(--text-main)" }}>{r.name}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{r.members.toLocaleString()} members</div>
      </div>
    </button>
  );
}

export default function Discover() {
  const [filter, setFilter] = useState("trending");
  const navigate = useNavigate();
  const { user } = useAuth();
  const pool = useMemo(() => makeMockPosts(60), []);
  const pickByType = (type, n = 10) => pool.filter((p) => p.media_type === type).slice(0, n);

  // Featured users with their actual saved widgets (live from backend)
  const [featured, setFeatured] = useState([]);
  // Phase-2-Gate — radius chip selection for Discover. Persisted across
  // navigation; defaults to "" (no radius filter applied).
  const [radius, setRadius] = useState(() => {
    try { return localStorage.getItem("ourrealm.discoverRadius") || ""; } catch { return ""; }
  });
  const [zipRequired, setZipRequired] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const params = { limit: 12 };
        if (radius) {
          if (!user?.zip_code) { setRadius(""); setZipRequired(true); }
          else {
            params.radius = radius;
            if (user?.username) params.viewer = user.username;
          }
        }
        const { data } = await apiClient.get("/users/featured", { params });
        setFeatured(data.users || []);
      } catch { /* */ }
    })();
  }, [radius, user?.zip_code, user?.username]);

  // Multi-filter chips — currently informational; expand filtering later
  return (
    <div className="max-w-7xl mx-auto" data-testid="discover-page">
      <div className="mb-5">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Explore</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Discover</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Endless rows. Real momentum. Find what's rising before anyone else.
        </p>
      </div>

      {/* Top filter pills */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto no-scrollbar" data-testid="discover-filter-bar">
        {FILTERS.map(({ id, label, Icon, color }) => (
          <button
            key={id}
            data-testid={`discover-filter-${id}`}
            data-active={filter === id}
            onClick={() => setFilter(id)}
            className="or-chip shrink-0"
            style={filter === id ? undefined : { color }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Phase-2-Gate — radius chips for Discover. Applies to featured-user
          search via the existing /users/featured endpoint. */}
      <RadiusChips
        value={radius}
        onChange={(v) => {
          if (v && !user?.zip_code) { setZipRequired(true); return; }
          setRadius(v);
        }}
        storageKey="ourrealm.discoverRadius"
        testidPrefix="discover-radius"
        className="mb-6"
      />

      {/* Profile Widget Swiper — live, functional widget previews per user */}
      {featured.length > 0 && (
        <HRow id="widget-swiper" title="Profiles & Their Widgets" Icon={Icons.LayoutGrid} accent="var(--primary)">
          {featured.map((u) => {
            const previewWidgets = (u.widgets || []).slice(0, 4);
            return (
              <button
                key={u.username}
                onClick={() => navigate(`/public/${u.username}`)}
                className="or-surface shrink-0 snap-start text-left p-3"
                style={{ width: 280 }}
                data-testid={`discover-profile-widget-${u.username}`}
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <img
                    src={u.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.name || u.username)}`}
                    alt={u.username}
                    className="rounded-full object-cover"
                    style={{ width: 40, height: 40, border: "2px solid var(--primary)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <div className="text-sm font-bold truncate" style={{ color: "var(--text-main)" }}>@{u.username}</div>
                      {u.is_founder && <Icons.BadgeCheck size={12} style={{ color: "var(--brand-green)" }} />}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{u.name}</div>
                  </div>
                  <Icons.ArrowRight size={14} style={{ color: "var(--text-muted)" }} />
                </div>
                {previewWidgets.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {previewWidgets.map((w) => <MiniWidget key={w.id || w.type} w={w} />)}
                  </div>
                ) : (
                  <div className="or-surface p-3 text-center text-[11px]" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                    No widgets yet
                  </div>
                )}
              </button>
            );
          })}
        </HRow>
      )}

      {/* Realms row (community feature) */}
      <HRow id="realms" title="Top Realms" Icon={Icons.Crown} accent="#F4C84A">
        {REALMS.map((r) => (
          <RealmCard key={r.id} r={r} onClick={() => navigate(`/realms/${r.id}`)} />
        ))}
      </HRow>

      {/* Trending creators */}
      <HRow id="creators" title="Trending Creators" Icon={Icons.Users} accent="var(--brand-green)">
        {TRENDING_CREATORS.map((c) => (
          <CreatorCard key={c.id} c={c} onClick={() => navigate("/profile")} />
        ))}
      </HRow>

      {/* Trending videos */}
      <HRow id="videos" title="Trending Videos" Icon={Icons.PlayCircle} accent="var(--brand-blue)">
        {pickByType("video", 10).map((p) => <ContentCard key={p.id} p={p} label="VIDEO" accent="var(--brand-blue)" />)}
      </HRow>

      {/* Trending lives */}
      <HRow id="lives" title="Trending Lives" Icon={Icons.Radio} accent="#FF3F5A">
        {pickByType("live", 10).map((p) => <ContentCard key={p.id} p={p} label="LIVE" accent="#FF3F5A" />)}
      </HRow>

      {/* Trending sounds */}
      <HRow id="sounds" title="Trending Sounds" Icon={Icons.Music} accent="#C26BFF">
        {pickByType("sound", 10).map((p) => <ContentCard key={p.id} p={p} label="SOUND" accent="#C26BFF" />)}
      </HRow>

      {/* Trending photos */}
      <HRow id="photos" title="Trending Photos" Icon={Icons.Image} accent="var(--brand-green)">
        {pickByType("image", 10).map((p) => <ContentCard key={p.id} p={p} label="PHOTO" accent="var(--brand-green)" />)}
      </HRow>

      {/* Trending thoughts */}
      <HRow id="thoughts" title="Trending Thoughts" Icon={Icons.Lightbulb} accent="#F4C84A">
        {pool.filter((p) => p.media_type === "thought").slice(0, 10).map((p) => (
          <div key={p.id} className="or-surface shrink-0 snap-start p-4" style={{ width: 280 }} data-testid={`thought-card-${p.id}`}>
            <div className="flex items-center gap-2 mb-2">
              <img src={p.author_avatar} alt="" className="rounded-full" style={{ width: 28, height: 28 }} />
              <span className="text-sm font-semibold">@{p.author_name}</span>
            </div>
            <p className="text-sm" style={{ color: "var(--text-main)" }}>{p.content}</p>
            <div className="text-[11px] mt-3" style={{ color: "var(--primary)" }}>♥ {p.likes.toLocaleString()} · {p.comments}c</div>
          </div>
        ))}
      </HRow>

      {/* Trending merch */}
      <HRow id="merch" title="Trending Merch" Icon={Icons.ShoppingBag} accent="#10E670">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="or-surface shrink-0 snap-start overflow-hidden" style={{ width: 220 }} data-testid={`merch-card-${i}`}>
            <img src={`https://picsum.photos/300/300?random=${i + 60}`} alt="" className="w-full aspect-square object-cover" />
            <div className="p-3">
              <div className="font-bold" style={{ color: "var(--text-main)" }}>Realm Drop {i + 1}</div>
              <div className="text-xs mt-1" style={{ color: "var(--brand-green)" }}>${(28 + i * 5).toFixed(0)}</div>
            </div>
          </div>
        ))}
      </HRow>

      {/* Trending events */}
      <HRow id="events" title="Trending Events" Icon={Icons.Calendar} accent="#FFB72E">
        {[
          { name: "Realm Festival", date: "Sat · 9 PM", city: "Sky Park", img: "https://images.unsplash.com/photo-1518972559570-7cc1309f3229?w=600" },
          { name: "Stealth Summit",  date: "Mar 14",    city: "Brooklyn", img: "https://images.unsplash.com/photo-1488972685288-c3fd157d7c7a?w=600" },
          { name: "Cypher Block",    date: "Apr 02",    city: "Berlin",   img: "https://images.unsplash.com/photo-1493676304819-0d7a8d026dcf?w=600" },
          { name: "Sound Garden",    date: "Apr 19",    city: "Lisbon",   img: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=600" },
          { name: "Magnitude Open",  date: "May 02",    city: "Tokyo",    img: "https://images.unsplash.com/photo-1483721310020-03333e577078?w=600" },
        ].map((e, i) => (
          <div key={i} className="or-surface shrink-0 snap-start overflow-hidden" style={{ width: 280, height: 200 }} data-testid={`event-card-${i}`}>
            <img src={e.img} alt="" className="w-full h-3/5 object-cover" />
            <div className="p-3">
              <div className="font-bold" style={{ color: "var(--text-main)" }}>{e.name}</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{e.date} · {e.city}</div>
            </div>
          </div>
        ))}
      </HRow>

      {/* Legacy themed rows for completeness */}
      {DISCOVER_ROWS.slice(0, 4).map((row, idx) => (
        <HRow key={row.id} id={row.id} title={row.title} Icon={Icons[row.icon] || Icons.Sparkles}>
          {pool.slice(idx * 3, idx * 3 + 10).map((p) => <ContentCard key={p.id} p={p} />)}
        </HRow>
      ))}
      <ZipRequiredModal open={zipRequired} onClose={() => setZipRequired(false)} testid="discover-zip-required" />
    </div>
  );
}
