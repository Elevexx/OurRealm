import React, { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { DEFAULT_WIDGETS, WIDGET_TYPES, MODE_PREVIEW_IMG, TRENDING_TRACKS, FRIENDS } from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";

const SIZE_TO_CLASS = {
  small: "col-span-2 sm:col-span-1 row-span-1",
  medium: "col-span-2 row-span-1",
  large: "col-span-2 row-span-2",
  full: "col-span-2 sm:col-span-4 row-span-1",
};

function WidgetBody({ w }) {
  switch (w.type) {
    case "live":
      return (
        <div className="relative h-full overflow-hidden" style={{ borderRadius: "var(--radius)" }}>
          <img src={MODE_PREVIEW_IMG.neon} alt="live" className="w-full h-full object-cover" />
          <div className="absolute top-3 left-3 px-2 py-1 text-[10px] tracking-widest uppercase font-bold"
            style={{ background: "#FF3344", color: "#fff", borderRadius: 4 }}>● Live · 482 watching</div>
          <div className="absolute bottom-3 left-3 right-3 text-sm font-semibold" style={{ color: "#fff", textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>
            Studio Session — building the next set
          </div>
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
    case "photos":
      return (
        <div className="grid grid-cols-3 gap-1.5 h-full">
          {[0,1,2,3,4,5].map((i) => (
            <img key={i} src={`https://picsum.photos/200/200?random=${i + 12}`} alt="" className="w-full h-full object-cover" style={{ borderRadius: 8 }} />
          ))}
        </div>
      );
    case "friends":
      return (
        <div className="space-y-2">
          {FRIENDS.slice(0, 3).map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <img src={f.avatar} alt="" className="rounded-full" style={{ width: 28, height: 28 }} />
              <div className="text-xs truncate" style={{ color: "var(--text-main)" }}>@{f.handle}</div>
            </div>
          ))}
        </div>
      );
    case "weather":
      return (
        <div className="text-center">
          <Icons.Cloud size={32} style={{ color: "var(--primary)" }} className="mx-auto" />
          <div className="text-2xl mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>72°</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>Clear · LA</div>
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
          {[["NYC","Mar 14"],["LA","Mar 22"],["Berlin","Apr 06"]].map(([city, date]) => (
            <div key={city} className="flex justify-between">
              <span>{city}</span><span style={{ color: "var(--text-muted)" }}>{date}</span>
            </div>
          ))}
        </div>
      );
    case "merch":
      return (
        <div className="grid grid-cols-4 gap-2 h-full">
          {[0,1,2,3].map((i) => (
            <div key={i} className="overflow-hidden" style={{ borderRadius: "calc(var(--radius) - 4px)" }}>
              <img src={`https://picsum.photos/200/200?random=${i + 30}`} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      );
    default:
      return (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {WIDGET_TYPES.find((x) => x.id === w.type)?.label || "Widget"}
        </div>
      );
  }
}

export default function Profile() {
  const { user, isGuest, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [form, setForm] = useState({ name: "", bio: "" });
  const [widgets, setWidgets] = useState(user?.widgets?.length ? user.widgets : DEFAULT_WIDGETS);

  useEffect(() => {
    if (searchParams.get("edit") === "1") setEditing(true);
  }, [searchParams]);

  useEffect(() => {
    if (user) setForm({ name: user.name || "", bio: user.bio || "" });
    if (user?.widgets?.length) setWidgets(user.widgets);
  }, [user]);

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

  const removeWidget = (id) => setWidgets((arr) => arr.filter((x) => x.id !== id));
  const cycleSize = (id) => {
    const sizes = ["small", "medium", "large", "full"];
    setWidgets((arr) => arr.map((x) => x.id === id ? { ...x, size: sizes[(sizes.indexOf(x.size) + 1) % sizes.length] } : x));
  };
  const move = (id, dir) => {
    setWidgets((arr) => {
      const i = arr.findIndex((x) => x.id === id);
      if (i === -1) return arr;
      const j = dir < 0 ? Math.max(0, i - 1) : Math.min(arr.length - 1, i + 1);
      const copy = [...arr]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
    });
  };

  const saveLayout = async () => {
    if (user) await updateProfile({ widgets, name: form.name, bio: form.bio });
    setEditing(false);
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="profile-page">
      {/* Banner / header */}
      <div className="or-surface overflow-hidden mb-5">
        <div className="h-32 sm:h-48" style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 40%, transparent), color-mix(in srgb, var(--secondary) 40%, transparent))",
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
                  {user?.bio || (isGuest ? "Browsing as guest. Sign up to claim your handle." : "Tap edit to add a bio.")}
                </div>
                <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  <span><b style={{ color: "var(--text-main)" }}>1.2k</b> followers</span>
                  <span><b style={{ color: "var(--text-main)" }}>318</b> following</span>
                  <span><b style={{ color: "var(--text-main)" }}>{widgets.length}</b> widgets</span>
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {!isGuest && user && (
              editing ? (
                <button className="or-btn" onClick={saveLayout} data-testid="profile-save">Save</button>
              ) : (
                <button className="or-btn or-btn-ghost" onClick={() => setEditing(true)} data-testid="profile-edit">Edit profile</button>
              )
            )}
            <button className="or-btn or-btn-ghost" onClick={() => navigate("/widgets")} data-testid="profile-add-widget">+ Add widget</button>
          </div>
        </div>
      </div>

      {/* Widgets bento */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-4"
        style={{ gridAutoRows: "minmax(150px, auto)" }}
        data-testid="profile-widget-grid"
      >
        {widgets.map((w) => {
          const def = WIDGET_TYPES.find((x) => x.id === w.type);
          const Icon = Icons[def?.icon || "Sparkles"] || Icons.Sparkles;
          return (
            <div
              key={w.id}
              className={`or-surface p-4 relative overflow-hidden ${SIZE_TO_CLASS[w.size] || SIZE_TO_CLASS.small}`}
              data-testid={`profile-widget-${w.id}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon size={16} style={{ color: "var(--primary)" }} />
                  <span className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{def?.label || w.type}</span>
                </div>
                {!isGuest && user && (
                  <div className="flex gap-1">
                    <button className="or-chip" style={{ padding: "0.2rem 0.5rem", fontSize: 11 }} onClick={() => move(w.id, -1)} data-testid={`widget-${w.id}-up`}>↑</button>
                    <button className="or-chip" style={{ padding: "0.2rem 0.5rem", fontSize: 11 }} onClick={() => move(w.id, 1)} data-testid={`widget-${w.id}-down`}>↓</button>
                    <button className="or-chip" style={{ padding: "0.2rem 0.5rem", fontSize: 11 }} onClick={() => cycleSize(w.id)} data-testid={`widget-${w.id}-resize`}>
                      {w.size[0].toUpperCase()}
                    </button>
                    <button className="or-chip" style={{ padding: "0.2rem 0.5rem", fontSize: 11 }} onClick={() => removeWidget(w.id)} data-testid={`widget-${w.id}-remove`}>×</button>
                  </div>
                )}
              </div>
              <div className="h-[calc(100%-2rem)]">
                <WidgetBody w={w} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
