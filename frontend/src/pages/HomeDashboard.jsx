/** OurRealm Home Dashboard (Phase 5).
 *
 * Widget-based, user-customizable. Layout persists via /api/dashboard/layout.
 * Widgets are intentionally lightweight — they each fetch their own data
 * from existing endpoints (no new aggregation services). Add/remove/reorder
 * is implemented; resize is left as a future polish via a `size` field that's
 * already persisted.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus, X, ChevronUp, ChevronDown, Layout, Cloud, Radio, Users as UsersIcon,
  Newspaper, Sparkles, Music as MusicIcon, Bell, Bookmark, Eye, Globe2, Calendar,
  Heart, MessageSquare, Lock,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase";
import { listGroups, listRealms } from "@/lib/messaging";

const WIDGET_CATALOG = [
  { type: "for_you_feed",         label: "For You Feed",          Icon: Sparkles },
  { type: "weather",              label: "Weather",               Icon: Cloud },
  { type: "realms",               label: "Realms",                Icon: Radio },
  { type: "groups",               label: "Group Chats",           Icon: UsersIcon },
  { type: "top_news",             label: "Top News",              Icon: Newspaper },
  { type: "friend_activity",      label: "Friend Activity",       Icon: UsersIcon },
  { type: "notifications_summary",label: "Notifications",         Icon: Bell },
  { type: "trending_sounds",      label: "Trending Sounds",       Icon: MusicIcon },
  { type: "trending_posts",       label: "Trending Posts",        Icon: Heart },
  { type: "suggested_friends",    label: "Suggested Friends",     Icon: UsersIcon },
  { type: "recently_viewed",      label: "Recently Viewed",       Icon: Eye },
  { type: "bookmarks",            label: "Bookmarks",             Icon: Bookmark },
  { type: "events",               label: "Events",                Icon: Calendar },
  { type: "top_communities",      label: "Top Communities",       Icon: Globe2 },
];
const CATALOG_BY_TYPE = Object.fromEntries(WIDGET_CATALOG.map((w) => [w.type, w]));
const VIS_OPTIONS = [
  { id: "public",  label: "Public",  Icon: Globe2 },
  { id: "friends", label: "Friends", Icon: UsersIcon },
  { id: "private", label: "Private", Icon: Lock },
];

export default function HomeDashboard() {
  const { user } = useAuth();
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/dashboard/layout");
      setWidgets(data.widgets || []);
    } catch { setWidgets([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (next) => {
    setWidgets(next);
    try { await apiClient.put("/dashboard/layout", { widgets: next }); } catch { /* ignore */ }
  }, []);

  const add = (type) => {
    const id = `${type}-${Date.now().toString(36)}`;
    save([...widgets, { id, type, visibility: "private", size: "md", config: {} }]);
    setShowLibrary(false);
  };
  const remove = (id) => save(widgets.filter((w) => w.id !== id));
  const move = (idx, delta) => {
    const next = [...widgets];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    save(next);
  };
  const setVis = (id, vis) =>
    save(widgets.map((w) => (w.id === id ? { ...w, visibility: vis } : w)));

  if (!user) {
    return <div className="max-w-5xl mx-auto or-surface p-6 text-center" style={{ color: "var(--text-muted)" }} data-testid="home-dashboard-signin">Sign in to view your Home dashboard.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto" data-testid="home-dashboard">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Your Realm</div>
          <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
            <Layout size={24} style={{ color: "var(--primary)" }} /> Home
          </h1>
        </div>
        <button
          onClick={() => setEdit((e) => !e)}
          className="or-btn or-btn-ghost"
          data-testid="home-dashboard-edit-toggle"
        >
          {edit ? "Done" : "Customize"}
        </button>
      </header>

      {loading ? (
        <div className="or-surface p-10 text-center" style={{ color: "var(--text-muted)" }}>Loading your dashboard…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {widgets.map((w, i) => (
            <WidgetTile
              key={w.id}
              widget={w}
              edit={edit}
              user={user}
              onRemove={() => remove(w.id)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, +1)}
              onVisChange={(vis) => setVis(w.id, vis)}
            />
          ))}
          {/* Add Widgets tile */}
          <button
            onClick={() => setShowLibrary(true)}
            className="or-surface text-center flex flex-col items-center justify-center gap-2 p-6 transition-transform active:scale-[0.99]"
            style={{
              borderStyle: "dashed",
              minHeight: 220,
              background: "transparent",
              color: "var(--text-muted)",
              border: "2px dashed var(--border-col)",
            }}
            data-testid="home-add-widget"
          >
            <Plus size={28} style={{ color: "var(--primary)" }} />
            <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>Add Home Widgets</div>
            <div className="text-xs">Pick from the widget library</div>
          </button>
        </div>
      )}

      {showLibrary && (
        <WidgetLibrary
          existing={widgets}
          onAdd={add}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
}

// ───────── Widget Tile ─────────
function WidgetTile({ widget, edit, user, onRemove, onMoveUp, onMoveDown, onVisChange }) {
  const meta = CATALOG_BY_TYPE[widget.type] || { label: widget.type, Icon: Layout };
  const Body = WIDGETS[widget.type] || PlaceholderWidget;
  return (
    <div
      className="or-surface overflow-hidden flex flex-col"
      style={{ minHeight: 220 }}
      data-testid={`widget-${widget.type}-${widget.id}`}
    >
      <header className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-col)" }}>
        <meta.Icon size={14} style={{ color: "var(--primary)" }} />
        <div className="text-sm font-semibold flex-1" style={{ color: "var(--text-main)" }}>{meta.label}</div>
        {edit ? (
          <div className="flex items-center gap-1">
            <button className="starbar-icon" style={{ width: 24, height: 24 }} onClick={onMoveUp} aria-label="Move up" data-testid={`widget-${widget.id}-up`}><ChevronUp size={12} /></button>
            <button className="starbar-icon" style={{ width: 24, height: 24 }} onClick={onMoveDown} aria-label="Move down" data-testid={`widget-${widget.id}-down`}><ChevronDown size={12} /></button>
            <button className="starbar-icon" style={{ width: 24, height: 24 }} onClick={onRemove} aria-label="Remove" data-testid={`widget-${widget.id}-remove`}><X size={12} /></button>
          </div>
        ) : null}
      </header>
      {edit && (
        <div className="flex items-center gap-1 px-3 py-1.5" style={{ borderBottom: "1px solid var(--border-col)", background: "var(--surface-2)" }}>
          {VIS_OPTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => onVisChange(id)}
              className="text-[10px] uppercase tracking-widest px-2 py-1 flex items-center gap-1"
              style={{
                borderRadius: 6,
                background: widget.visibility === id ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "transparent",
                color: widget.visibility === id ? "var(--primary)" : "var(--text-muted)",
              }}
              data-testid={`widget-${widget.id}-vis-${id}`}
            >
              <Icon size={10} /> {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <Body widget={widget} user={user} />
      </div>
    </div>
  );
}

// ───────── Individual widgets ─────────
function ForYouFeedWidget() {
  const [posts, setPosts] = useState([]);
  useEffect(() => {
    apiClient.get("/posts", { params: { limit: 5 } }).then((r) => setPosts(r.data.posts || [])).catch(() => {});
  }, []);
  return (
    <div className="p-3 space-y-2">
      {posts.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>Nothing in your feed yet.</div>}
      {posts.slice(0, 4).map((p) => (
        <Link key={p.id} to="/feed" className="block text-sm" style={{ color: "var(--text-main)" }}>
          <span className="font-semibold">@{p.author_username || "user"}</span>{" "}
          <span style={{ color: "var(--text-muted)" }}>· {String(p.content || "").slice(0, 80)}</span>
        </Link>
      ))}
      <Link to="/feed" className="text-xs underline" style={{ color: "var(--primary)" }}>Open feed →</Link>
    </div>
  );
}

function WeatherWidget({ user }) {
  // Real API not wired this phase — clean placeholder with the user's ZIP
  // wired through so it's "data-ready" the moment we plug it in.
  const z = user?.zip_code;
  return (
    <div className="p-4 flex flex-col gap-2">
      <div className="text-2xl font-bold" style={{ color: "var(--text-main)" }}>
        {z ? `Local · ${z}` : "Set your ZIP"}
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {z ? "Radar + 7-day forecast unlock when we wire the weather API." : "Add a ZIP in Settings to unlock local weather."}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
          <div key={d} className="or-surface p-1.5" style={{ background: "var(--surface-2)" }}>{d}<br/><span style={{ color: "var(--text-main)" }}>—</span></div>
        ))}
      </div>
    </div>
  );
}

function RealmsWidget() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    listRealms(user.id).then(setItems).catch(() => {});
  }, [user]);
  if (!isSupabaseConfigured) return <Stub>Messenger isn't configured.</Stub>;
  if (items.length === 0) return <Stub>No active realms.</Stub>;
  return (
    <div className="p-3 space-y-1.5">
      {items.slice(0, 5).map((r) => (
        <Link key={r.id} to="/messages?tab=realms" className="flex items-center justify-between text-sm" style={{ color: "var(--text-main)" }}>
          <span className="truncate">{r.name}</span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{r.members?.length || 0} members</span>
        </Link>
      ))}
    </div>
  );
}

function GroupsWidget() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    listGroups(user.id).then(setItems).catch(() => {});
  }, [user]);
  if (!isSupabaseConfigured) return <Stub>Messenger isn't configured.</Stub>;
  if (items.length === 0) return <Stub>No active groups.</Stub>;
  return (
    <div className="p-3 max-h-60 overflow-y-auto space-y-1.5">
      {items.map((g) => (
        <Link key={g.id} to="/messages?tab=groups" className="flex items-center justify-between text-sm" style={{ color: "var(--text-main)" }}>
          <span className="truncate">{g.name}</span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{g.members?.length || 0}</span>
        </Link>
      ))}
    </div>
  );
}

function TopNewsWidget() {
  // News API not yet wired — clean placeholders ready for /api/news/top
  const items = [
    { id: 1, source: "OurRealm",   title: "Welcome to your Realm — your home, your way." },
    { id: 2, source: "Sounds",     title: "Top 100 chart refreshed. Tune your taste." },
    { id: 3, source: "Discovery",  title: "Local radius now goes up to 500 miles." },
  ];
  return (
    <div className="p-3 max-h-60 overflow-y-auto space-y-2">
      {items.map((n) => (
        <a key={n.id} href="#" onClick={(e) => e.preventDefault()} className="block">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--primary)" }}>{n.source}</div>
          <div className="text-sm" style={{ color: "var(--text-main)" }}>{n.title}</div>
        </a>
      ))}
    </div>
  );
}

function TrendingSoundsWidget() {
  const [tracks, setTracks] = useState([]);
  useEffect(() => {
    apiClient.get("/sounds/charts/top100", { params: { page: 1 } })
      .then((r) => setTracks((r.data.tracks || []).slice(0, 5))).catch(() => {});
  }, []);
  if (tracks.length === 0) return <Stub>No trending sounds yet.</Stub>;
  return (
    <div className="p-3 space-y-1.5">
      {tracks.map((t) => (
        <Link key={t.id} to="/sounds" className="flex items-center gap-2 text-sm" style={{ color: "var(--text-main)" }}>
          <span className="text-[10px] font-bold" style={{ color: "var(--primary)", width: 18 }}>#{t.rank}</span>
          <span className="truncate flex-1">{t.title}</span>
        </Link>
      ))}
    </div>
  );
}

function PlaceholderWidget({ widget }) {
  return (
    <div className="p-4 text-xs" style={{ color: "var(--text-muted)" }} data-testid={`widget-${widget.type}-placeholder`}>
      <strong style={{ color: "var(--text-main)" }}>{CATALOG_BY_TYPE[widget.type]?.label || widget.type}</strong>
      <p className="mt-1">Coming soon — this widget is structurally ready and will light up automatically when the data source is enabled.</p>
    </div>
  );
}

const WIDGETS = {
  for_you_feed:    ForYouFeedWidget,
  weather:         WeatherWidget,
  realms:          RealmsWidget,
  groups:          GroupsWidget,
  top_news:        TopNewsWidget,
  trending_sounds: TrendingSoundsWidget,
};

function Stub({ children }) {
  return <div className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>{children}</div>;
}

// ───────── Widget Library modal ─────────
function WidgetLibrary({ existing, onAdd, onClose }) {
  const existingTypes = useMemo(() => new Set(existing.map((w) => w.type)), [existing]);
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid="widget-library"
    >
      <div className="or-surface w-full max-w-lg p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Widget library</h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose} data-testid="widget-library-close" aria-label="Close"><X size={14} /></button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {WIDGET_CATALOG.map(({ type, label, Icon }) => (
            <button
              key={type}
              onClick={() => onAdd(type)}
              className="or-surface p-3 text-left"
              style={{ background: "var(--surface-2)", opacity: existingTypes.has(type) ? 0.7 : 1 }}
              data-testid={`widget-library-add-${type}`}
            >
              <Icon size={16} style={{ color: "var(--primary)" }} />
              <div className="mt-2 text-sm font-semibold" style={{ color: "var(--text-main)" }}>{label}</div>
              {existingTypes.has(type) && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Already added · adds another</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
