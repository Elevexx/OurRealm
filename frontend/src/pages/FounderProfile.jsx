import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const SIZE_TO_CLASS = {
  small:  "col-span-2 sm:col-span-1 row-span-1",
  medium: "col-span-2 row-span-1",
  large:  "col-span-2 row-span-2",
  full:   "col-span-2 sm:col-span-4 row-span-1",
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

function WidgetBody({ w }) {
  switch (w.type) {
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
          <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>4,182 followers will be notified</div>
        </div>
      );
    case "merch":
      return (
        <div className="grid grid-cols-3 gap-2 h-full">
          {MERCH.map((m) => <MerchItem key={m.name} m={m} />)}
        </div>
      );
    case "music":
      return (
        <div className="space-y-1.5">
          {TRACKS.map((t, i) => (
            <div key={t.title} className="flex items-center gap-2 p-1.5 rounded" style={{ background: "var(--surface-2)" }}>
              <button className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                <Icons.Play size={12} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>{t.title}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t.duration} · {t.plays.toLocaleString()} plays</div>
              </div>
              <button className="text-[10px]" style={{ color: "var(--text-muted)" }}><Icons.Heart size={12} /> {(t.likes/1000).toFixed(1)}k</button>
              <button className="text-[10px]" style={{ color: "var(--text-muted)" }}><Icons.Bookmark size={12} /></button>
            </div>
          ))}
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
    case "polls": // Fan Wall
      return (
        <div className="space-y-2">
          {FANS.map((f) => (
            <div key={f.handle} className="flex gap-2 items-start text-xs">
              <img src={`https://api.dicebear.com/7.x/initials/svg?seed=${f.handle}`} alt="" className="rounded-full" style={{ width: 24, height: 24 }} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{f.handle}</div>
                <div style={{ color: "var(--text-muted)" }}>{f.text}</div>
              </div>
            </div>
          ))}
        </div>
      );
    case "custom": // Social
      return (
        <div className="flex flex-col gap-2 h-full justify-center">
          <a href="https://tiktok.com/@stealth.hq" target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2 rounded transition-transform hover:translate-x-1" style={{ background: "var(--surface-2)" }} data-testid="social-tiktok">
            <Icons.Video size={16} style={{ color: "var(--primary)" }} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>TikTok</div>
              <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>@stealth.hq</div>
            </div>
          </a>
          <a href="https://instagram.com/djstealthx" target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2 rounded transition-transform hover:translate-x-1" style={{ background: "var(--surface-2)" }} data-testid="social-instagram">
            <Icons.Camera size={16} style={{ color: "#FF8AC2" }} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Instagram</div>
              <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>@djstealthx</div>
            </div>
          </a>
        </div>
      );
    default:
      return <div className="text-xs" style={{ color: "var(--text-muted)" }}>{w.title || w.type}</div>;
  }
}

function SortableWidget({ w, editing, onCycleSize }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 50 : "auto" }}
      className={`or-surface p-3 sm:p-4 relative overflow-hidden ${SIZE_TO_CLASS[w.size] || SIZE_TO_CLASS.small}`}
      data-testid={`founder-widget-${w.id}`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--primary)" }}>{w.title}</div>
        {editing && (
          <div className="flex gap-1">
            <button {...attributes} {...listeners} className="or-chip cursor-grab active:cursor-grabbing" style={{ padding: "0.15rem 0.4rem", fontSize: 11, touchAction: "none" }} data-testid={`fw-${w.id}-drag`}>
              <Icons.GripVertical size={12} />
            </button>
            <button className="or-chip" style={{ padding: "0.15rem 0.4rem", fontSize: 11 }} onClick={() => onCycleSize(w.id)} data-testid={`fw-${w.id}-resize`}>
              {w.size[0].toUpperCase()}
            </button>
          </div>
        )}
      </div>
      <div className="h-[calc(100%-2rem)]"><WidgetBody w={w} /></div>
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

  useEffect(() => {
    (async () => {
      try {
        const { data } = await apiClient.get(`/profile/by-username/${username}`);
        setProfile(data.user);
        setWidgets(data.user.widgets || []);
      } catch (e) {
        setErr(e.response?.data?.detail || "Profile not found");
      } finally { setLoading(false); }
    })();
  }, [username]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const isOwner = useMemo(() => user && profile && user.email === profile.email, [user, profile]);

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setWidgets((w) => arrayMove(w, w.findIndex((x) => x.id === active.id), w.findIndex((x) => x.id === over.id)));
  };
  const cycleSize = (id) => {
    const sizes = ["small", "medium", "large", "full"];
    setWidgets((arr) => arr.map((x) => x.id === id ? { ...x, size: sizes[(sizes.indexOf(x.size) + 1) % sizes.length] } : x));
  };

  if (loading) return <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>Loading founder profile…</div>;
  if (err)     return <div className="max-w-md mx-auto or-surface p-8 text-center"><p>{err}</p><button className="or-btn mt-4" onClick={() => navigate("/home")}>← Home</button></div>;
  if (!profile) return null;

  return (
    <div className="max-w-7xl mx-auto" data-testid="founder-profile-page">
      <div className="or-surface overflow-hidden mb-5">
        <div className="h-32 sm:h-48 relative" style={{
          background: "linear-gradient(135deg, rgba(0,255,102,0.25), rgba(46,160,255,0.20), rgba(176,38,255,0.20))",
        }}>
          <div className="absolute inset-0" style={{
            backgroundImage: "linear-gradient(rgba(0,255,102,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,102,0.12) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            mask: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
            WebkitMask: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
          }} />
        </div>
        <div className="px-5 sm:px-8 pb-6 -mt-14 sm:-mt-16 flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="relative shrink-0">
            <img
              src={profile.avatar_url}
              alt={profile.name}
              className="rounded-full"
              style={{
                width: 128, height: 128,
                objectFit: "cover", objectPosition: "center",
                border: "4px solid var(--surface)",
                background: "var(--surface)",
                boxShadow: "0 0 30px rgba(0,255,102,0.45)",
              }}
              data-testid="founder-avatar"
            />
            {profile.is_verified && (
              <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #2EA0FF, #10E670)", boxShadow: "0 0 12px rgba(46,160,255,0.6)" }} data-testid="founder-verified-badge">
                <Icons.BadgeCheck size={16} style={{ color: "#fff" }} />
              </span>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }} data-testid="founder-name">{profile.name}</h1>
              <span className="text-xs font-bold uppercase tracking-widest px-2 py-1 rounded" style={{ background: "linear-gradient(135deg, #00FF66, #2EA0FF)", color: "#0a0a0a" }} data-testid="founder-badge">FOUNDER</span>
              <span className="text-xs uppercase tracking-widest px-2 py-1 rounded" style={{ background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary)", border: "1px solid var(--primary)" }}>Verified</span>
              <span className="text-xs uppercase tracking-widest px-2 py-1 rounded" style={{ background: "rgba(244,200,74,0.18)", color: "#F4C84A", border: "1px solid #F4C84A" }}>Featured</span>
            </div>
            <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }} data-testid="founder-username">@{profile.username}</div>
            <div className="text-sm mt-1.5" data-testid="founder-bio">{profile.bio}</div>
            <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
              <span><b style={{ color: "var(--text-main)" }}>42.8k</b> followers</span>
              <span><b style={{ color: "var(--text-main)" }}>128</b> following</span>
              <span><b style={{ color: "var(--text-main)" }}>{widgets.length}</b> widgets</span>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="or-btn" data-testid="founder-follow"><Icons.UserPlus size={14} /> Follow</button>
            <button className="or-btn or-btn-ghost" data-testid="founder-message" onClick={() => navigate("/messages")}><Icons.MessageCircle size={14} /> Message</button>
            {isOwner && (
              <button className="or-btn or-btn-ghost" onClick={() => setEditing(!editing)} data-testid="founder-edit">
                {editing ? "Done" : "Edit layout"}
              </button>
            )}
          </div>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" style={{ gridAutoRows: "minmax(160px, auto)" }} data-testid="founder-widget-grid">
            {widgets.map((w) => <SortableWidget key={w.id} w={w} editing={editing} onCycleSize={cycleSize} />)}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
