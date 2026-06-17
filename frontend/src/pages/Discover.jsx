import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import MiniWidget from "@/components/MiniWidget";
import PresenceDot from "@/components/PresenceDot";
import RadiusChips from "@/components/RadiusChips";
import ZipRequiredModal from "@/components/ZipRequiredModal";
import { useAuth } from "@/contexts/AuthContext";
import { usePresence } from "@/contexts/PresenceContext";

const FILTERS = [
  { id: "trending",  label: "Trending",  Icon: Icons.Flame,    color: "#FF8AC2" },
  { id: "new",       label: "New",       Icon: Icons.Sparkles, color: "var(--brand-green)" },
  { id: "rising",    label: "Rising",    Icon: Icons.Rocket,   color: "var(--brand-blue)" },
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

function UserCard({ u, status, onClick, accent, testid }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      className="or-surface shrink-0 overflow-hidden snap-start text-left p-4 cursor-pointer"
      style={{ width: 230 }}
      data-testid={testid}
    >
      <div className="flex flex-col items-center">
        <div className="relative">
          <div className="rounded-full p-[3px] mb-3" style={{ background: accent, boxShadow: `0 0 14px ${accent}55`, width: 96, height: 96 }}>
            <img
              src={u.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.name || u.username)}`}
              alt={u.username}
              className="w-full h-full rounded-full object-cover"
              style={{ border: "3px solid var(--bgc)" }}
            />
          </div>
          {status && status !== "offline" && (
            <span style={{ position: "absolute", right: 6, bottom: 18 }}>
              <PresenceDot status={status} size={12} data-testid={`${testid}-status`} />
            </span>
          )}
        </div>
        <div className="font-bold flex items-center gap-1" style={{ color: "var(--text-main)" }}>
          @{u.username}
          {u.is_founder && <Icons.BadgeCheck size={14} style={{ color: "var(--brand-green)" }} />}
        </div>
        <div className="text-xs uppercase tracking-widest mt-1" style={{ color: accent }}>
          {u.follower_count} follower{u.follower_count === 1 ? "" : "s"}
        </div>
        {u.bio ? (
          <div className="text-[11px] mt-2 line-clamp-2 text-center" style={{ color: "var(--text-muted)" }}>{u.bio}</div>
        ) : (
          <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>New on OurRealm</div>
        )}
      </div>
    </div>
  );
}

export default function Discover() {
  const [filter, setFilter] = useState("trending");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { statuses } = usePresence();

  // Real user lists
  const [trending, setTrending] = useState([]);
  const [newest, setNewest] = useState([]);
  const [loadingT, setLoadingT] = useState(true);
  const [loadingN, setLoadingN] = useState(true);
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [tr, nw] = await Promise.all([
          apiClient.get("/users/trending", { params: { limit: 20 } }),
          apiClient.get("/users/newest", { params: { limit: 20 } }),
        ]);
        if (!mounted) return;
        setTrending(tr.data?.users || []);
        setNewest(nw.data?.users || []);
      } catch { /* */ }
      finally {
        if (mounted) { setLoadingT(false); setLoadingN(false); }
      }
    })();
    return () => { mounted = false; };
  }, []);

  // "Rising" = newest with at least 1 follower, sorted by follower_count desc.
  const rising = useMemo(() => {
    return [...newest]
      .filter((u) => (u.follower_count || 0) > 0)
      .sort((a, b) => (b.follower_count || 0) - (a.follower_count || 0));
  }, [newest]);

  return (
    <div className="max-w-7xl mx-auto" data-testid="discover-page">
      <div className="mb-5">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Explore</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Discover</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Endless rows. Real momentum. Find what&apos;s rising before anyone else.
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

      {/* Trending Creators — REAL DATA, sorted by follower_count DESC */}
      <HRow id="creators" title="Trending Creators" Icon={Icons.Users} accent="var(--brand-green)">
        {loadingT ? (
          <Skeleton count={6} />
        ) : trending.length === 0 ? (
          <EmptyState body="No trending creators yet." />
        ) : trending.map((u) => (
          <UserCard
            key={u.id}
            u={u}
            status={statuses[u.id] || u.presence_status}
            onClick={() => navigate(`/public/${u.username}`)}
            accent="var(--brand-green)"
            testid={`discover-creator-${u.username}`}
          />
        ))}
      </HRow>

      {/* Newest — REAL DATA, sorted by created_at DESC */}
      <HRow id="newest" title="Newest on OurRealm" Icon={Icons.Sparkles} accent="var(--brand-blue)">
        {loadingN ? (
          <Skeleton count={6} />
        ) : newest.length === 0 ? (
          <EmptyState body="No newcomers yet." />
        ) : newest.map((u) => (
          <UserCard
            key={u.id}
            u={u}
            status={statuses[u.id] || u.presence_status}
            onClick={() => navigate(`/public/${u.username}`)}
            accent="var(--brand-blue)"
            testid={`discover-new-${u.username}`}
          />
        ))}
      </HRow>

      {/* Rising — newest users that already gained followers */}
      {rising.length > 0 && (
        <HRow id="rising" title="Rising" Icon={Icons.Rocket} accent="#F4C84A">
          {rising.map((u) => (
            <UserCard
              key={u.id}
              u={u}
              status={statuses[u.id] || u.presence_status}
              onClick={() => navigate(`/public/${u.username}`)}
              accent="#F4C84A"
              testid={`discover-rising-${u.username}`}
            />
          ))}
        </HRow>
      )}

      <ZipRequiredModal open={zipRequired} onClose={() => setZipRequired(false)} testid="discover-zip-required" />
    </div>
  );
}

function Skeleton({ count = 5 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} className="or-surface shrink-0 snap-start p-4" style={{ width: 230, height: 220, background: "var(--surface-2)", opacity: 0.5 }} />
  ));
}

function EmptyState({ body }) {
  return (
    <div className="or-surface shrink-0 p-6 text-sm text-center" style={{ width: 280, color: "var(--text-muted)" }}>
      {body}
    </div>
  );
}
