import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { BannerView } from "@/components/BannerEditor";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import MyFeedWidget from "@/components/MyFeedWidget";
import TopEightWidget from "@/components/TopEightWidget";
import VipBadge from "@/components/VipBadge";
import ReportButton from "@/components/ReportButton";
import ProfileBadges from "@/components/ProfileBadges";
import LevelBadge from "@/components/progression/LevelBadge";
import ProgressCard from "@/components/progression/ProgressCard";
import ProgressionBadges from "@/components/progression/ProgressionBadges";
import PublicFireStats from "@/components/fire/PublicFireStats";
import {
  NotesBody, BlogBody, VideosBody, MusicBody, PodcastsBody, PhotosBody, PollsBody, RadarBody,
} from "@/components/ProfileWidgetBodies";
import CustomWidgetRenderer from "@/components/widgets/CustomWidgetRenderer";
import { ALLOWED_WIDGET_TYPES } from "@/data/mockData";

const SIZE_TO_CLASS = {
  small:  "col-span-2 sm:col-span-1 row-span-1",
  medium: "col-span-2 row-span-1",
  large:  "col-span-2 row-span-2",
  full:   "col-span-2 sm:col-span-4 row-span-1",
};

// Mirror of Profile.jsx — caps tall/expandable widgets (chat, notes,
// blog) so they scroll internally instead of stretching the page.
const SIZE_MAX_HEIGHT_PX = {
  small:  220,
  medium: 220,
  large:  460,
  full:   320,
};

const MERCH = [
  { name: "OurRealm Neon Hat",     price: 29, color: "#10E670", icon: "Crown" },
  { name: "OurRealm Founder Shirt",price: 39, color: "#2EA0FF", icon: "Shirt" },
  { name: "Stealth Hoodie",        price: 59, color: "#00FF66", icon: "Shirt" },
];
const TRACKS = [
  { title: "Stealth Mode", duration: "4:12", likes: 18420, plays: 124000 },
  { title: "Neon Drift",   duration: "5:08", likes: 12340, plays:  98000 },
  { title: "Founder's Cut",duration: "6:32", likes: 22180, plays: 154000 },
  { title: "Realm Anthem", duration: "3:54", likes:  9820, plays:  74000 },
];
const EVENTS = [
  { name: "OurRealm Launch Stream",   when: "Sat · 9 PM",  city: "Live" },
  { name: "Stealth DJ Set",           when: "Mar 22",      city: "LA" },
  { name: "Creator Mode Showcase",    when: "Apr 06",      city: "Berlin" },
];
const FANS = [
  { handle: "LunaX",   text: "Set was unreal 🔥" },
  { handle: "Jaxon",   text: "Founder's Cut on repeat" },
  { handle: "Nova",    text: "Realm Anthem hits different" },
  { handle: "Striker", text: "GOAT" },
];

function MerchItem({ m }) {
  const Icon = Icons[m.icon] || Icons.ShoppingBag;
  return (
    <div className="or-surface overflow-hidden" style={{ background: "var(--surface-2)" }}>
      <div className="aspect-square flex items-center justify-center relative" style={{ background: `radial-gradient(circle at center, ${m.color}33, transparent 70%)` }}>
        <Icon size={48} style={{ color: m.color, filter: `drop-shadow(0 0 12px ${m.color})` }} />
        <span className="absolute bottom-2 left-2 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.6)", color: m.color }}>OurRealm</span>
      </div>
      <div className="p-2.5">
        <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>{m.name}</div>
        <div className="text-xs mt-1" style={{ color: m.color }}>${m.price}</div>
      </div>
    </div>
  );
}

function WidgetBody({ w, ownerUsername, isOwner, viewer }) {
  // Public profile renders the EXACT same 15 widget bodies as the
  // owner-edit view (Profile.jsx). Editing is always disabled here.
  switch (w.type) {
    case "myfeed":
      return <MyFeedWidget username={ownerUsername} isOwner={isOwner} />;
    case "top8":
      return <TopEightWidget username={ownerUsername} />;
    case "notes":
      return <NotesBody w={w} editing={false} isOwner={false} viewer={viewer} />;
    case "blog":
      return <BlogBody w={w} editing={false} isOwner={false} viewer={viewer} />;
    case "videos":
      return <VideosBody w={w} editing={false} isOwner={false} ownerUsername={ownerUsername} />;
    case "music":
      return <MusicBody w={w} editing={false} isOwner={false} ownerUsername={ownerUsername} />;
    case "podcasts":
      return <PodcastsBody w={w} editing={false} isOwner={false} ownerUsername={ownerUsername} />;
    case "photos":
      return <PhotosBody w={w} editing={false} isOwner={false} ownerUsername={ownerUsername} />;
    case "polls":
      return <PollsBody w={w} editing={false} isOwner={false} ownerUsername={ownerUsername} viewer={viewer} />;
    case "radar":
      return <RadarBody w={w} />;
    case "live":
      return (
        <div className="h-full flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#FF3F5A" }} />
            <span className="text-[10px] font-bold tracking-widest" style={{ color: "#FF3F5A" }}>OFF AIR</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>· Next: Sat 9 PM</span>
          </div>
          <div className="flex-1 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(0,255,102,0.18), rgba(46,160,255,0.18))", border: "1px solid var(--border-col)" }}>
            <button className="or-btn"><Icons.Radio size={14} /> Go Live</button>
          </div>
        </div>
      );
    case "events":
      return (
        <div className="space-y-2">
          {EVENTS.map((e) => (
            <div key={e.name} className="flex items-center gap-2 p-2 rounded" style={{ background: "var(--surface-2)" }}>
              <Icons.Calendar size={16} style={{ color: "var(--primary)" }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>{e.name}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{e.when} · {e.city}</div>
              </div>
              <button className="or-btn" style={{ padding: "0.25rem 0.55rem", fontSize: "0.65rem" }}>RSVP</button>
            </div>
          ))}
        </div>
      );
    case "weather":
      return (
        <div className="text-center">
          <Icons.CloudSun size={32} style={{ color: "var(--primary)" }} className="mx-auto" />
          <div className="text-2xl mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>72°</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>Clear · LA</div>
        </div>
      );
    case "calendar":
      return (
        <div className="text-xs">
          <div className="uppercase tracking-widest mb-1" style={{ color: "var(--primary)" }}>Today</div>
          <div className="space-y-1" style={{ color: "var(--text-main)" }}>
            <div><b>10:00</b> Studio block</div>
            <div><b>14:30</b> Brand sync</div>
            <div><b>19:00</b> Live set</div>
          </div>
        </div>
      );
    case "countdown":
      return (
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Until next drop</div>
          <div className="text-3xl mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>07d</div>
        </div>
      );
    case "survey":
      return (
        <div className="text-xs" style={{ color: "var(--text-main)" }}>Survey · Open in app.</div>
      );
    default:
      // Custom widgets — universal renderer pulls editor_config from
      // the registry by w.type and renders the layout. Any system
      // widget key that fell through above silently renders nothing.
      return <CustomWidgetRenderer w={w} />;
  }
}

function SortableWidget({ w, editing, onCycleSize, ownerUsername, isOwner, viewer }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  // Header label fallback chain — w.title (legacy), w.name (registry-
  // hydrated), prettified type key. Never shows a raw `stealth_ai_5a6`.
  const headerLabel = w.title
    || w.name
    || String(w.type || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
  const scrollInternally = (w.editor_config?.layout === "chat") || ["notes", "blog"].includes(w.type);
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 50 : "auto",
        maxHeight: scrollInternally ? (SIZE_MAX_HEIGHT_PX[w.size] || SIZE_MAX_HEIGHT_PX.medium) : undefined,
      }}
      className={`or-surface p-3 sm:p-4 relative overflow-hidden ${scrollInternally ? "flex flex-col" : ""} ${SIZE_TO_CLASS[w.size] || SIZE_TO_CLASS.small}`}
      data-testid={`founder-widget-${w.id}`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--primary)" }}>{headerLabel}</div>
        {editing && (
          <div className="flex gap-1">
            <button {...attributes} {...listeners} className="or-chip cursor-grab active:cursor-grabbing" style={{ padding: "0.15rem 0.4rem", fontSize: 11, touchAction: "none" }} data-testid={`fw-${w.id}-drag`}>
              <Icons.GripVertical size={12} />
            </button>
            <button className="or-chip" style={{ padding: "0.15rem 0.4rem", fontSize: 11 }} onClick={() => onCycleSize(w.id)} data-testid={`fw-${w.id}-resize`}>
              {(w.size || "medium")[0].toUpperCase()}
            </button>
          </div>
        )}
      </div>
      <div className={scrollInternally ? "flex-1 min-h-0" : "h-[calc(100%-2rem)]"}>
        <WidgetBody w={w} ownerUsername={ownerUsername} isOwner={isOwner} viewer={viewer} />
      </div>
    </div>
  );
}

export default function FounderProfile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [widgets, setWidgets] = useState([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [friendStatus, setFriendStatus] = useState("none"); // none|outgoing|incoming|friends|self
  const [statusBusy, setStatusBusy] = useState(false);
  const [chatErr, setChatErr] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setErr("");
      try {
        const { data } = await apiClient.get(`/profile/by-username/${username}`);
        setProfile(data.user);
        setWidgets(data.user.widgets || []);
      } catch (e) {
        setErr(e.response?.data?.detail || "Profile not found");
      } finally { setLoading(false); }
    })();
  }, [username]);

  // Load friend status if logged in & not self
  useEffect(() => {
    (async () => {
      if (!user || !profile) return;
      if (user.username === profile.username) { setFriendStatus("self"); return; }
      try {
        const { data } = await apiClient.get(`/friends/status/${profile.username}`);
        setFriendStatus(data.status || "none");
      } catch { /* */ }
    })();
  }, [user, profile]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const isOwner = useMemo(() => user && profile && user.username === profile.username, [user, profile]);

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setWidgets((w) => arrayMove(w, w.findIndex((x) => x.id === active.id), w.findIndex((x) => x.id === over.id)));
  };
  const cycleSize = (id) => {
    const sizes = ["small", "medium", "large", "full"];
    setWidgets((arr) => arr.map((x) => x.id === id ? { ...x, size: sizes[(sizes.indexOf(x.size) + 1) % sizes.length] } : x));
  };

  const addFriend = async () => {
    if (!user) { navigate("/signin"); return; }
    setStatusBusy(true); setChatErr("");
    try { await apiClient.post("/friends/request", { username: profile.username }); setFriendStatus("outgoing"); }
    catch (e) { setChatErr(e.response?.data?.detail || "Could not send request"); }
    finally { setStatusBusy(false); }
  };
  const acceptFriend = async () => {
    setStatusBusy(true); setChatErr("");
    try { await apiClient.post("/friends/accept", { username: profile.username }); setFriendStatus("friends"); }
    catch (e) { setChatErr(e.response?.data?.detail || "Could not accept request"); }
    finally { setStatusBusy(false); }
  };

  const onMessage = () => {
    setChatErr("");
    if (!user) { navigate("/signin"); return; }
    if (friendStatus === "self") return; // can't message yourself
    if (friendStatus !== "friends") {
      setChatErr("You can only message friends. Send a friend request first.");
      return;
    }
    navigate(`/messages?dm=${profile.username}`);
  };

  if (loading) return <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>Loading profile…</div>;
  if (err)     return <div className="max-w-md mx-auto or-surface p-8 text-center"><p>{err}</p><button className="or-btn mt-4" onClick={() => navigate("/home")}>← Home</button></div>;
  if (!profile) return null;

  return (
    <div className="max-w-7xl mx-auto" data-testid="founder-profile-page">
      <div className="or-surface overflow-hidden mb-5">
        <div className="or-profile-banner relative" style={{
          background: "linear-gradient(135deg, rgba(0,255,102,0.25), rgba(46,160,255,0.20), rgba(176,38,255,0.20))",
        }}>
          <div className="absolute inset-0" style={{
            backgroundImage: "linear-gradient(rgba(0,255,102,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,102,0.12) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            mask: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
            WebkitMask: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
          }} />
          {profile.banner_url && (
            <BannerView
              url={profile.banner_url}
              offsetY={profile.banner_offset_y ?? 50}
              scale={profile.banner_scale ?? 1}
              testid="founder-banner"
            />
          )}
        </div>
        <div className="px-4 sm:px-6 lg:px-10 pb-4 md:pb-6 lg:pb-8 flex flex-col sm:flex-row sm:items-start gap-3 md:gap-5">
          <div className="relative shrink-0 -mt-12 sm:-mt-[50px]">
            <UserAvatar
              user={{ ...profile, avatar_url: profile.avatar_url }}
              size={96}
              style={{
                border: "3px solid var(--surface)",
                background: "var(--surface)",
                boxShadow: "0 0 22px rgba(0,255,102,0.35)",
              }}
              testid="founder-avatar"
            />
            {profile.is_verified && (
              <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #2EA0FF, #10E670)", boxShadow: "0 0 10px rgba(46,160,255,0.55)", zIndex: 2 }} data-testid="founder-verified-badge">
                <Icons.BadgeCheck size={12} style={{ color: "#fff" }} />
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 sm:pt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl" style={{ fontFamily: "var(--font-display)" }} data-testid="founder-name">{profile.name}</h1>
              <LevelBadge username={profile.username} testid="public-level-badge" />
              {/* FOUNDER / VIP / VERIFIED badges are now rendered as
                  rectangular pills via <ProfileBadges/> below. Inline
                  badges removed (Feb 26, 2026) to eliminate duplicate
                  rows. Featured-creator stays inline because it's a
                  flag, not a badge in the registry yet. */}
              {profile.featured_creator && (
                <span className="text-xs uppercase tracking-widest px-2 py-1 rounded" style={{ background: "rgba(244,200,74,0.18)", color: "#F4C84A", border: "1px solid #F4C84A" }}>Featured</span>
              )}
            </div>
            <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }} data-testid="founder-username">@{profile.username}</div>
            <ProfileBadges username={profile.username} />
            <div className="text-sm mt-1.5" data-testid="founder-bio">{profile.bio}</div>
            <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--text-muted)" }} data-testid="founder-counts">
              <span><b style={{ color: "var(--text-main)" }} data-testid="founder-follower-count">{profile?.follower_count ?? 0}</b> followers</span>
              <span><b style={{ color: "var(--text-main)" }} data-testid="founder-following-count">{profile?.following_count ?? 0}</b> following</span>
              <span><b style={{ color: "var(--text-main)" }} data-testid="founder-widgets-count">{profile?.widgets_count ?? widgets.length}</b> widgets</span>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {friendStatus === "friends" ? (
              <span className="or-chip" style={{ color: "var(--brand-green)" }} data-testid="public-status-friends"><Icons.UserCheck size={14} /> Friends</span>
            ) : friendStatus === "outgoing" ? (
              <span className="or-chip" style={{ color: "var(--text-muted)" }} data-testid="public-status-pending"><Icons.Clock size={14} /> Pending</span>
            ) : friendStatus === "incoming" ? (
              <button className="or-btn" disabled={statusBusy} onClick={acceptFriend} data-testid="public-accept-friend">
                <Icons.Check size={14} /> Accept request
              </button>
            ) : friendStatus === "self" ? null : (
              <button className="or-btn" disabled={statusBusy} onClick={addFriend} data-testid="public-add-friend">
                <Icons.UserPlus size={14} /> Add friend
              </button>
            )}
            <button
              className="or-btn or-btn-ghost"
              data-testid="public-message"
              onClick={onMessage}
              disabled={friendStatus !== "friends" && friendStatus !== "self"}
              title={friendStatus !== "friends" && friendStatus !== "self" ? "Add as friend to message" : "Send a message"}
            >
              <Icons.MessageCircle size={14} /> Message
            </button>
            {isOwner && (
              <button className="or-btn" onClick={() => navigate("/profile")} data-testid="public-switch-edit">
                <Icons.Pencil size={14} /> Switch to Edit
              </button>
            )}
            {!isOwner && profile?.id && (
              <ReportButton
                targetType="profile"
                targetId={profile.id}
                label="Report"
                testid={`profile-report-${profile.username}`}
              />
            )}
          </div>
        </div>
        {chatErr && (
          <div className="mx-5 sm:mx-8 mb-5 text-sm px-3 py-2" data-testid="public-chat-err"
            style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}>
            {chatErr}
          </div>
        )}
      </div>

      {/* Public progression summary (visibility enforced by backend) */}
      <PublicFireStats username={profile.username} />
      <ProgressCard username={profile.username} isOwner={isOwner} />
      <ProgressionBadges username={profile.username} isOwner={isOwner} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={widgets.filter((w) => ALLOWED_WIDGET_TYPES.has(w.type) || !!w.editor_config).map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" style={{ gridAutoRows: "minmax(160px, auto)" }} data-testid="founder-widget-grid">
            {widgets.filter((w) => ALLOWED_WIDGET_TYPES.has(w.type) || !!w.editor_config).map((w) => <SortableWidget key={w.id} w={w} editing={editing} onCycleSize={cycleSize} ownerUsername={profile.username} isOwner={isOwner} viewer={user} />)}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
