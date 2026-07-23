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
  Plus, X, GripVertical, Layout, Cloud, Radio, Users as UsersIcon,
  Newspaper, Sparkles, Music as MusicIcon, Bell, Bookmark, Eye, Globe2, Calendar,
  Heart, MessageSquare, Lock, UserPlus, Maximize2,
} from "lucide-react";
import {
  DndContext, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove,
  rectSortingStrategy, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import FireWalletCard from "@/components/fire/FireWalletCard";
import ProgressCard from "@/components/progression/ProgressCard";
import ProgressionBadges from "@/components/progression/ProgressionBadges";
import { isSupabaseConfigured } from "@/lib/supabase";
import { listGroups, listRealms } from "@/lib/messaging";
import FriendMultiPicker from "@/components/FriendMultiPicker";

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
  { id: "custom",  label: "Custom",  Icon: UserPlus },
];

// Phase 5 — widget size → grid span / min-height. Keeps the existing
// `size` enum the dashboard layout already persists ("sm" | "md" | "lg" | "xl").
const SIZE_DIM = {
  sm: { col: 1, minH: 180 },
  md: { col: 1, minH: 240 },
  lg: { col: 2, minH: 300 },
  xl: { col: 2, minH: 420 },
};
const SIZE_ORDER = ["sm", "md", "lg", "xl"];
const RESIZE_STEP_PX = 70;  // px of pointer delta required to advance one size

export default function HomeDashboard() {
  const { user, isGuest } = useAuth();
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
    try {
      // Use the server-cleaned response so local state stays in sync with
      // anything the server normalized (size enum, visibility enum, etc.).
      // This prevents the "after save the widget isn't customizable" symptom
      // where local + server state silently diverged.
      const { data } = await apiClient.put("/dashboard/layout", { widgets: next });
      if (Array.isArray(data?.widgets)) setWidgets(data.widgets);
    } catch { /* keep optimistic state on transient errors */ }
  }, []);

  const add = (type) => {
    const id = `${type}-${Date.now().toString(36)}`;
    save([...widgets, { id, type, visibility: "private", size: "md", config: {} }]);
    setShowLibrary(false);
  };
  const remove = (id) => save(widgets.filter((w) => w.id !== id));
  const setVis = (id, vis) =>
    save(widgets.map((w) => (w.id === id ? { ...w, visibility: vis } : w)));
  const setCustomIds = (id, ids) =>
    save(widgets.map((w) => (w.id === id ? { ...w, visibility: "custom", custom_user_ids: ids } : w)));
  const setSize = (id, size) =>
    save(widgets.map((w) => (w.id === id ? { ...w, size } : w)));
  // Which widget id (if any) is currently editing its custom friend list.
  const [customEditingId, setCustomEditingId] = useState(null);
  const customEditingWidget = widgets.find((w) => w.id === customEditingId) || null;

  // Drag-and-drop reorder (dnd-kit) — same pattern Top8Editor uses.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = widgets.findIndex((w) => w.id === active.id);
    const to   = widgets.findIndex((w) => w.id === over.id);
    if (from < 0 || to < 0) return;
    save(arrayMove(widgets, from, to));
  };

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

      {/* Personal progression sections — identical shared components to the
          profile page (single source of truth). Hidden for guests. */}
      {user && !isGuest && (
        <>
          <FireWalletCard collapsible />
          <ProgressCard username={user.username} isOwner={true} />
          <ProgressionBadges username={user.username} isOwner={true} />
        </>
      )}

      {loading ? (
        <div className="or-surface p-10 text-center" style={{ color: "var(--text-muted)" }}>Loading your dashboard…</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {widgets.map((w) => (
                <SortableWidgetTile
                  key={w.id}
                  widget={w}
                  edit={edit}
                  user={user}
                  onRemove={() => remove(w.id)}
                  onVisChange={(vis) => {
                    setVis(w.id, vis);
                    if (vis === "custom") setCustomEditingId(w.id);
                  }}
                  onEditCustom={() => setCustomEditingId(w.id)}
                  onResize={(size) => setSize(w.id, size)}
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
          </SortableContext>
        </DndContext>
      )}

      {showLibrary && (
        <WidgetLibrary
          existing={widgets}
          onAdd={add}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* Custom-visibility multi-select picker (Phase 5 polish) */}
      <FriendMultiPicker
        open={!!customEditingWidget}
        onClose={() => setCustomEditingId(null)}
        title={customEditingWidget ? `Share "${(CATALOG_BY_TYPE[customEditingWidget.type]?.label) || customEditingWidget.type}" with…` : "Choose friends"}
        initialSelectedIds={customEditingWidget?.custom_user_ids || []}
        onConfirm={(ids) => {
          if (customEditingId) setCustomIds(customEditingId, ids);
          setCustomEditingId(null);
        }}
      />
    </div>
  );
}

// ───────── Widget Tile ─────────
function SortableWidgetTile(props) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: props.widget.id });
  const dim = SIZE_DIM[props.widget.size] || SIZE_DIM.md;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    boxShadow: isDragging ? "0 14px 40px rgba(46,160,255,0.35)" : undefined,
    zIndex: isDragging ? 5 : "auto",
    gridColumn: dim.col === 2 ? "span 2 / span 2" : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <WidgetTile {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function WidgetTile({ widget, edit, user, onRemove, onVisChange, onEditCustom, onResize, dragHandleProps }) {
  const meta = CATALOG_BY_TYPE[widget.type] || { label: widget.type, Icon: Layout };
  const Body = WIDGETS[widget.type] || PlaceholderWidget;
  const dim = SIZE_DIM[widget.size] || SIZE_DIM.md;

  // ── Phase 5 — pointer-drag resize handle (SE corner).
  // We track cumulative deltaX/deltaY and translate it into a size index
  // along SIZE_ORDER. Final size is committed on pointer-up so we only
  // hit the API once per gesture.
  const [resizing, setResizing] = useState(false);
  const startRef = React.useRef({ x: 0, y: 0, idx: 0 });

  const onResizeDown = (e) => {
    if (!edit) return;
    e.stopPropagation(); e.preventDefault();
    const idx = SIZE_ORDER.indexOf(widget.size || "md");
    startRef.current = { x: e.clientX, y: e.clientY, idx: idx >= 0 ? idx : 1, lastIdx: idx };
    setResizing(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onResizeMove = (e) => {
    if (!resizing) return;
    const { x, y, idx } = startRef.current;
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    // The more the user drags, the larger the widget. Diagonal pulls grow it
    // faster than single-axis pulls (Math.max picks whichever axis moved most).
    const steps = Math.round(Math.max(dx, dy) / RESIZE_STEP_PX);
    const nextIdx = Math.max(0, Math.min(SIZE_ORDER.length - 1, idx + steps));
    if (nextIdx !== startRef.current.lastIdx) {
      startRef.current.lastIdx = nextIdx;
      onResize?.(SIZE_ORDER[nextIdx]);
    }
  };
  const onResizeUp = (e) => {
    if (!resizing) return;
    setResizing(false);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
  };
  return (
    <div
      className="or-surface overflow-hidden flex flex-col relative"
      style={{ minHeight: dim.minH }}
      data-testid={`widget-${widget.type}-${widget.id}`}
      data-size={widget.size || "md"}
    >
      <header className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-col)" }}>
        {edit && (
          <button
            {...dragHandleProps}
            className="starbar-icon cursor-grab active:cursor-grabbing"
            style={{ width: 24, height: 24, color: "var(--text-muted)", touchAction: "none" }}
            aria-label="Drag to reorder"
            data-testid={`widget-${widget.id}-drag`}
            onClick={(e) => e.preventDefault()}
          >
            <GripVertical size={14} />
          </button>
        )}
        <meta.Icon size={14} style={{ color: "var(--primary)" }} />
        <div className="text-sm font-semibold flex-1" style={{ color: "var(--text-main)" }}>{meta.label}</div>
        {edit ? (
          <button className="starbar-icon" style={{ width: 24, height: 24 }} onClick={onRemove} aria-label="Remove" data-testid={`widget-${widget.id}-remove`}><X size={12} /></button>
        ) : null}
      </header>
      {edit && (
        <div className="flex items-center gap-1 px-3 py-1.5 flex-wrap" style={{ borderBottom: "1px solid var(--border-col)", background: "var(--surface-2)" }}>
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
          {widget.visibility === "custom" && (
            <button
              type="button"
              onClick={onEditCustom}
              className="text-[10px] uppercase tracking-widest px-2 py-1 flex items-center gap-1 ml-auto"
              style={{
                borderRadius: 6,
                background: "color-mix(in srgb, var(--primary) 14%, transparent)",
                color: "var(--primary)",
                border: "1px dashed var(--primary)",
              }}
              data-testid={`widget-${widget.id}-pick-friends`}
            >
              <UserPlus size={10} />
              {(widget.custom_user_ids?.length || 0) > 0
                ? `${widget.custom_user_ids.length} chosen`
                : "Pick friends"}
            </button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <Body widget={widget} user={user} />
      </div>
      {/* Phase 5 — drag-to-resize handle (visible in edit mode only) */}
      {edit && (
        <button
          type="button"
          aria-label="Drag to resize widget"
          data-testid={`widget-${widget.id}-resize`}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          className="absolute"
          style={{
            right: 4, bottom: 4,
            width: 22, height: 22,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 6,
            background: resizing
              ? "color-mix(in srgb, var(--primary) 30%, transparent)"
              : "color-mix(in srgb, var(--surface) 70%, transparent)",
            border: "1px solid var(--border-col)",
            color: "var(--text-muted)",
            cursor: "nwse-resize",
            touchAction: "none",
            zIndex: 4,
          }}
        >
          <Maximize2 size={11} style={{ transform: "rotate(90deg)" }} />
        </button>
      )}
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
