import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as Icons from "lucide-react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_WIDGETS, WIDGET_TYPES, TRENDING_TRACKS, CHARACTERS, WALLET, MARKETPLACE_ADS, MODE_PREVIEW_IMG,
} from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

const SIZE_TO_CLASS = {
  small:  "col-span-2 sm:col-span-1 row-span-1",
  medium: "col-span-2 row-span-1",
  large:  "col-span-2 row-span-2",
  full:   "col-span-2 sm:col-span-4 row-span-1",
};

/* -------------------------- widget renderers -------------------------- */
function WidgetBody({ w, mode }) {
  switch (w.type) {
    case "live":
      return (
        <div className="relative h-full overflow-hidden" style={{ borderRadius: "calc(var(--radius) - 4px)" }}>
          <img src={MODE_PREVIEW_IMG.neon} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.7))" }} />
          <div className="absolute top-3 left-3 px-2 py-1 text-[10px] tracking-widest uppercase font-bold"
            style={{ background: "#FF3344", color: "#fff", borderRadius: 4 }}>
            ● Live · 482 watching
          </div>
          <div className="absolute bottom-3 left-3 right-3 text-sm font-semibold" style={{ color: "#fff" }}>
            Studio session — building the next set
          </div>
        </div>
      );
    case "videos":
      return (
        <div className="grid grid-cols-2 gap-2 h-full">
          {[0,1,2,3].map((i) => (
            <div key={i} className="relative overflow-hidden" style={{ borderRadius: 8, background: "var(--surface-2)" }}>
              <img src={`https://picsum.photos/200/200?random=${i + 40}`} alt="" className="w-full h-full object-cover" />
              <Icons.PlayCircle size={22} className="absolute inset-0 m-auto" style={{ color: "#fff", opacity: 0.95 }} />
            </div>
          ))}
        </div>
      );
    case "music":
      return (
        <div className="grid grid-cols-2 gap-2 h-full">
          {TRENDING_TRACKS.slice(0, 4).map((t) => (
            <div key={t.id} className="overflow-hidden" style={{ borderRadius: "calc(var(--radius) - 4px)", background: "var(--surface-2)" }}>
              <img src={t.cover} alt="" className="w-full h-16 object-cover" />
              <div className="p-2">
                <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>{t.title}</div>
                <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{t.artist}</div>
              </div>
            </div>
          ))}
        </div>
      );
    case "podcasts":
      return (
        <div className="space-y-2">
          {TRENDING_TRACKS.slice(0, 3).map((t, i) => (
            <div key={t.id} className="flex items-center gap-2">
              <div className="w-9 h-9 shrink-0 rounded-md overflow-hidden"><img src={t.cover} alt="" className="w-full h-full object-cover" /></div>
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>EP{40 + i} · {t.title}</div>
                <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{t.artist} · 42 min</div>
              </div>
            </div>
          ))}
        </div>
      );
    case "photos":
      return (
        <div className="grid grid-cols-3 gap-1.5 h-full">
          {[0,1,2,3,4,5].map((i) => (
            <img key={i} src={`https://picsum.photos/200/200?random=${i + 12}`} alt="" className="w-full h-full object-cover" style={{ borderRadius: 8 }} />
          ))}
        </div>
      );
    case "merch":
      return (
        <div className="grid grid-cols-4 gap-2 h-full">
          {[0,1,2,3].map((i) => (
            <div key={i} className="relative overflow-hidden" style={{ borderRadius: "calc(var(--radius) - 4px)" }}>
              <img src={`https://picsum.photos/200/200?random=${i + 30}`} alt="" className="w-full h-full object-cover" />
              <div className="absolute bottom-1 left-1 text-[10px] font-bold px-1 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>
                ${(20 + i * 5).toFixed(0)}
              </div>
            </div>
          ))}
        </div>
      );
    case "events":
      return (
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "var(--primary)" }}>Next event</div>
          <div className="text-sm font-semibold mt-1" style={{ color: "var(--text-main)" }}>Realm Festival</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Sat · 9 PM · Sky Park</div>
        </div>
      );
    case "tour":
      return (
        <div className="space-y-2 text-xs" style={{ color: "var(--text-main)" }}>
          {[["NYC","Mar 14"],["LA","Mar 22"],["Berlin","Apr 06"],["Tokyo","May 02"]].map(([city, date]) => (
            <div key={city} className="flex justify-between">
              <span>{city}</span><span style={{ color: "var(--text-muted)" }}>{date}</span>
            </div>
          ))}
        </div>
      );
    case "friends":
      return (
        <div className="space-y-2">
          {CHARACTERS.slice(0, 3).map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <img src={f.avatar} alt="" className="rounded-full" style={{ width: 24, height: 24, border: `1px solid ${f.ringColor}` }} />
              <div className="text-xs truncate" style={{ color: "var(--text-main)" }}>@{f.name}</div>
              <span className="ml-auto text-[10px]" style={{ color: f.ringColor }}>{f.label}</span>
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
    case "news":
      return (
        <div className="space-y-2 text-xs">
          {["Crypto rallies on chain activity", "Indie label drops new compilation", "OurRealm hits 1M creators"].map((t, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="w-1 h-3 mt-1" style={{ background: "var(--primary)" }} />
              <div style={{ color: "var(--text-main)" }} className="line-clamp-2">{t}</div>
            </div>
          ))}
        </div>
      );
    case "crypto":
      return (
        <div className="space-y-1.5 text-xs">
          {[["BTC","$68,420","+2.4%"],["ETH","$3,580","+1.2%"],["SOL","$148.20","+5.8%"]].map(([s,p,c]) => (
            <div key={s} className="flex justify-between">
              <span className="font-bold" style={{ color: "var(--text-main)" }}>{s}</span>
              <span style={{ color: "var(--text-main)" }}>{p}</span>
              <span style={{ color: "#10E670" }}>{c}</span>
            </div>
          ))}
        </div>
      );
    case "stocks":
      return (
        <div className="space-y-1.5 text-xs">
          {[["AAPL","$224","+0.4%"],["NVDA","$880","+3.1%"],["TSLA","$254","-0.8%"]].map(([s,p,c]) => (
            <div key={s} className="flex justify-between">
              <span className="font-bold" style={{ color: "var(--text-main)" }}>{s}</span>
              <span style={{ color: "var(--text-main)" }}>{p}</span>
              <span style={{ color: c.startsWith("-") ? "#FF3F5A" : "#10E670" }}>{c}</span>
            </div>
          ))}
        </div>
      );
    case "calendar":
      return (
        <div>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--primary)" }}>Today</div>
          <div className="space-y-1 text-xs">
            <div><b>10:00</b> Studio block</div>
            <div><b>14:30</b> Brand sync</div>
            <div><b>19:00</b> Live set</div>
          </div>
        </div>
      );
    case "notes":
      return (
        <div className="text-xs leading-relaxed italic" style={{ color: "var(--text-main)" }}>
          "Discover should feel inevitable, not optional."<br />— shipping log
        </div>
      );
    case "polls":
      return (
        <div className="text-xs space-y-1.5">
          <div className="font-semibold mb-1" style={{ color: "var(--text-main)" }}>Drop the EP on…</div>
          {[["Fri 8 PM",64],["Sat noon",24],["Sun 6 PM",12]].map(([o,p]) => (
            <div key={o}>
              <div className="flex justify-between"><span>{o}</span><span style={{ color: "var(--primary)" }}>{p}%</span></div>
              <div className="h-1.5 rounded" style={{ background: "var(--border-col)" }}>
                <div className="h-full rounded" style={{ background: "var(--primary)", width: `${p}%` }} />
              </div>
            </div>
          ))}
        </div>
      );
    case "wallet":
      return (
        <div>
          <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Balance</div>
          <div className="text-2xl mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
            ${WALLET.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[11px] mt-1" style={{ color: "var(--brand-green)" }}>+{WALLET.monthly_change_pct}% this month</div>
        </div>
      );
    case "ads":
      return (
        <div className="flex items-center gap-3">
          <img src={MARKETPLACE_ADS[0].cover} alt="" className="w-12 h-12 object-cover" style={{ borderRadius: 8 }} />
          <div className="text-xs">
            <div className="font-semibold" style={{ color: "var(--text-main)" }}>{MARKETPLACE_ADS[0].brand}</div>
            <div style={{ color: "var(--text-muted)" }}>{MARKETPLACE_ADS[0].payout}</div>
          </div>
        </div>
      );
    case "radar":
      return (
        <div className="flex items-center justify-center h-full">
          <div style={{ width: "85%" }}><div className="radar-disc" /></div>
        </div>
      );
    case "custom":
    default:
      return (
        <div className="flex flex-col items-center justify-center h-full text-center" style={{ color: "var(--text-muted)" }}>
          {mode === "stealth" ? (<span className="terminal-cursor text-xs">CUSTOM</span>) : (
            <>
              <Icons.Sparkles size={20} style={{ color: "var(--primary)" }} />
              <div className="text-xs mt-1.5">{WIDGET_TYPES.find((x) => x.id === w.type)?.label || "Widget"}</div>
            </>
          )}
        </div>
      );
  }
}

/* -------------------------- sortable widget item -------------------------- */
function SortableWidget({ w, mode, editing, onCycleSize, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  const def = WIDGET_TYPES.find((x) => x.id === w.type);
  const Icon = Icons[def?.icon || "Sparkles"] || Icons.Sparkles;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 50 : "auto",
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`or-surface p-4 relative overflow-hidden ${SIZE_TO_CLASS[w.size] || SIZE_TO_CLASS.small}`}
      data-testid={`profile-widget-${w.id}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={16} style={{ color: "var(--primary)" }} />
          <span className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{def?.label || w.type}</span>
        </div>
        {editing && (
          <div className="flex gap-1 items-center">
            <button
              {...attributes}
              {...listeners}
              className="or-chip cursor-grab active:cursor-grabbing"
              style={{ padding: "0.2rem 0.45rem", fontSize: 11, touchAction: "none" }}
              data-testid={`widget-${w.id}-drag`}
              aria-label="Drag widget"
              title="Drag to reorder"
            >
              <Icons.GripVertical size={12} />
            </button>
            <button
              className="or-chip"
              style={{ padding: "0.2rem 0.5rem", fontSize: 11 }}
              onClick={() => onCycleSize(w.id)}
              data-testid={`widget-${w.id}-resize`}
              title="Resize"
            >
              {w.size[0].toUpperCase()}
            </button>
            <button
              className="or-chip"
              style={{ padding: "0.2rem 0.5rem", fontSize: 11 }}
              onClick={() => onRemove(w.id)}
              data-testid={`widget-${w.id}-remove`}
              title="Remove"
            >
              <Icons.X size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="h-[calc(100%-2rem)]"><WidgetBody w={w} mode={mode} /></div>
    </div>
  );
}

/* -------------------------- add widget picker -------------------------- */
function AddWidgetPicker({ open, onClose, onPick }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="add-widget-picker"
    >
      <div className="or-surface w-full max-w-3xl p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Widget Library</h3>
          <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {WIDGET_TYPES.map((w) => {
            const Icon = Icons[w.icon] || Icons.Sparkles;
            return (
              <button
                key={w.id}
                data-testid={`add-widget-${w.id}`}
                onClick={() => { onPick(w); onClose(); }}
                className="or-surface p-4 text-left transition-transform hover:-translate-y-0.5"
                style={{ background: "var(--surface-2)" }}
              >
                <Icon size={20} style={{ color: "var(--primary)" }} />
                <div className="mt-2 font-semibold text-sm" style={{ color: "var(--text-main)" }}>{w.label}</div>
                <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-muted)" }}>{w.default_size}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
export default function Profile() {
  const { user, isGuest, updateProfile } = useAuth();
  const { mode } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [editing, setEditing] = useState(searchParams.get("edit") !== "0");
  const [form, setForm] = useState({ name: "", bio: "" });
  const [widgets, setWidgets] = useState(user?.widgets?.length ? user.widgets : DEFAULT_WIDGETS);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => { if (searchParams.get("edit") === "1") setEditing(true); }, [searchParams]);
  useEffect(() => {
    if (user) setForm({ name: user.name || "", bio: user.bio || "" });
    if (user?.widgets?.length) setWidgets(user.widgets);
  }, [user]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWidgets((items) => {
      const oldIndex = items.findIndex((w) => w.id === active.id);
      const newIndex = items.findIndex((w) => w.id === over.id);
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const cycleSize = (id) => {
    const sizes = ["small", "medium", "large", "full"];
    setWidgets((arr) => arr.map((x) => x.id === id ? { ...x, size: sizes[(sizes.indexOf(x.size) + 1) % sizes.length] } : x));
  };
  const removeWidget = (id) => setWidgets((arr) => arr.filter((x) => x.id !== id));
  const addWidget = (w) => setWidgets((arr) => [...arr, { id: `w-${Date.now()}`, type: w.id, size: w.default_size }]);

  const saveLayout = async () => {
    if (user) await updateProfile({ widgets, name: form.name, bio: form.bio });
    setEditing(false);
  };

  if (!user && !isGuest) {
    return (
      <div className="max-w-md mx-auto or-surface p-8 text-center" data-testid="profile-guard">
        <h2 className="text-xl mb-2" style={{ fontFamily: "var(--font-display)" }}>Sign in to view your profile</h2>
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
          Create a free OurRealm account to customize widgets and save your layout.
        </p>
        <button className="or-btn w-full" onClick={() => navigate("/signin")} data-testid="profile-guard-signin">Sign in</button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto" data-testid="profile-page">
      {/* Banner */}
      <div className="or-surface overflow-hidden mb-5">
        <div className="h-32 sm:h-48" style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 50%, transparent), color-mix(in srgb, var(--secondary) 50%, transparent))",
        }} />
        <div className="px-5 sm:px-8 pb-6 -mt-12 sm:-mt-14 flex flex-col sm:flex-row sm:items-end gap-4">
          <img
            src={user?.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.name || "Guest")}`}
            alt="avatar"
            className="rounded-full object-cover"
            style={{ width: 110, height: 110, border: "4px solid var(--surface)", background: "var(--surface)" }}
            data-testid="profile-avatar"
          />
          <div className="flex-1">
            {editing ? (
              <>
                <input className="or-input mb-2 text-xl" data-testid="profile-edit-name"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Display name" />
                <input className="or-input text-sm" data-testid="profile-edit-bio"
                  value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Bio" />
              </>
            ) : (
              <>
                <h2 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }} data-testid="profile-name">
                  {user?.name || "Guest visitor"}
                </h2>
                <div className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }} data-testid="profile-bio">
                  {user?.bio || (isGuest ? "Browsing as guest." : "Tap edit to add a bio.")}
                </div>
                <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  <span><b style={{ color: "var(--text-main)" }}>1.2k</b> followers</span>
                  <span><b style={{ color: "var(--text-main)" }}>318</b> following</span>
                  <span><b style={{ color: "var(--text-main)" }}>{widgets.length}</b> widgets</span>
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {!isGuest && user && (
              editing
                ? <button className="or-btn" onClick={saveLayout} data-testid="profile-save">Save layout</button>
                : <button className="or-btn or-btn-ghost" onClick={() => setEditing(true)} data-testid="profile-edit">Edit profile</button>
            )}
            {!isGuest && user?.username && (
              <button
                className="or-btn or-btn-ghost"
                onClick={() => navigate(`/public/${user.username}`)}
                data-testid="profile-view-public"
                title="See how others see your profile"
              >
                <Icons.Eye size={14} /> View as Public
              </button>
            )}
            <button className="or-btn" onClick={() => setAddOpen(true)} data-testid="profile-add-widget"><Icons.Plus size={14} /> Add widget</button>
            <button className="or-btn or-btn-ghost" onClick={() => navigate("/widgets")} data-testid="profile-open-library"><Icons.LayoutGrid size={14} /> Library</button>
          </div>
        </div>
      </div>

      {/* Widgets bento (drag-and-drop when editing) */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-4"
            style={{ gridAutoRows: "minmax(150px, auto)" }}
            data-testid="profile-widget-grid"
          >
            {widgets.map((w) => (
              <SortableWidget
                key={w.id}
                w={w}
                mode={mode}
                editing={editing}
                onCycleSize={cycleSize}
                onRemove={removeWidget}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <AddWidgetPicker open={addOpen} onClose={() => setAddOpen(false)} onPick={addWidget} />
    </div>
  );
}
