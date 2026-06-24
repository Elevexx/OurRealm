import React, { useEffect, useState } from "react";
import useHeartbeat from "@/hooks/useHeartbeat";
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
  DEFAULT_WIDGETS, WIDGET_TYPES, ALLOWED_WIDGET_TYPES, TRENDING_TRACKS, CHARACTERS, WALLET, MARKETPLACE_ADS, MODE_PREVIEW_IMG,
} from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import MyFeedWidget from "@/components/MyFeedWidget";
import TopEightWidget from "@/components/TopEightWidget";
import Top8Editor from "@/components/Top8Editor";
import UserAvatar from "@/components/UserAvatar";
import VipBadge from "@/components/VipBadge";
import ProfileBadges from "@/components/ProfileBadges";
import apiClient from "@/api/client";
import AvatarPicker from "@/components/AvatarPicker";
import BannerEditor, { BannerView } from "@/components/BannerEditor";
import {
  NotesBody, BlogBody, VideosBody, MusicBody, PodcastsBody, PhotosBody, PollsBody, RadarBody,
} from "@/components/ProfileWidgetBodies";
import CustomWidgetRenderer from "@/components/widgets/CustomWidgetRenderer";

const SIZE_TO_CLASS = {
  small:  "col-span-2 sm:col-span-1 row-span-1",
  medium: "col-span-2 row-span-1",
  large:  "col-span-2 row-span-2",
  full:   "col-span-2 sm:col-span-4 row-span-1",
};

/* -------------------------- widget renderers -------------------------- */
// Spec (Feb 24, 2026): only 15 widget types exist. The renderer
// delegates the dynamic/editable bodies (Notes, Blog, Videos,
// Music, Podcasts, Polls, Radar) to the shared ProfileWidgetBodies
// module so /profile (owner edit) and /profile/:username (public)
// render identical DOM and data flow.

// Convert a registry key (e.g. "stealth_ai_5a6") into a human label
// ("Stealth Ai") for fallback display when no hydrated name is on hand.
const prettifyKey = (raw) => String(raw || "")
  .replace(/_/g, " ")
  .replace(/\b\w/g, (c) => c.toUpperCase())
  .slice(0, 40);

function WidgetBody({ w, mode, ownerUsername, isOwner, editing, onUpdate, viewer }) {
  switch (w.type) {
    case "myfeed":
      return <MyFeedWidget username={ownerUsername} isOwner={isOwner} />;
    case "top8":
      return <TopEightWidget username={ownerUsername} />;
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
      return <VideosBody w={w} editing={editing} isOwner={isOwner} ownerUsername={ownerUsername} onUpdate={onUpdate} />;
    case "music":
      return <MusicBody w={w} editing={editing} isOwner={isOwner} ownerUsername={ownerUsername} onUpdate={onUpdate} />;
    case "podcasts":
      return <PodcastsBody w={w} editing={editing} isOwner={isOwner} ownerUsername={ownerUsername} onUpdate={onUpdate} />;
    case "photos":
      return <PhotosBody w={w} editing={editing} isOwner={isOwner} ownerUsername={ownerUsername} onUpdate={onUpdate} />;
    case "events":
      return (
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "var(--primary)" }}>Next event</div>
          <div className="text-sm font-semibold mt-1" style={{ color: "var(--text-main)" }}>Realm Festival</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Sat · 9 PM · Sky Park</div>
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
        <div>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--primary)" }}>Today</div>
          <div className="space-y-1 text-xs">
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
          <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>14h 32m</div>
        </div>
      );
    case "notes":
      return <NotesBody w={w} editing={editing} isOwner={isOwner} viewer={viewer} onUpdate={onUpdate} />;
    case "blog":
      return <BlogBody w={w} editing={editing} isOwner={isOwner} viewer={viewer} onUpdate={onUpdate} />;
    case "polls":
      return <PollsBody w={w} editing={editing} isOwner={isOwner} ownerUsername={ownerUsername} viewer={viewer} onUpdate={onUpdate} />;
    case "survey":
      return (
        <div className="text-xs" style={{ color: "var(--text-main)" }}>
          <div className="font-semibold mb-1">Quick survey</div>
          <div style={{ color: "var(--text-muted)" }}>Open in app to participate.</div>
        </div>
      );
    case "radar":
      return <RadarBody w={w} />;
    default:
      // Custom widgets (created via the Widget Builder) carry an
      // `editor_config` payload — render via the universal renderer.
      if (w.editor_config) {
        return <CustomWidgetRenderer w={w} />;
      }
      // Defense in depth — any widget whose type is not in the allow-list
      // never reaches here because the API filters them, but if a stale
      // payload sneaks through we render an empty cell rather than crash.
      return null;
  }
}


/* -------------------------- sortable widget item -------------------------- */
function SortableWidget({ w, mode, editing, onCycleSize, onRemove, onUpdate, ownerUsername, isOwner, viewer }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  const def = WIDGET_TYPES.find((x) => x.id === w.type);
  // For registry-launched widgets, use the hydrated name + icon as
  // header chrome. Falls back to the prettified type string so we
  // never show a raw widget key like `stealth_ai_5a6`.
  const headerLabel = def?.label || w.name || prettifyKey(w.type);
  const headerIconKey = def?.icon || w.icon || "Sparkles";
  const Icon = Icons[headerIconKey] || Icons.Sparkles;
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
          <span className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{headerLabel}</span>
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
              {(w.size || "medium")[0].toUpperCase()}
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
      <div className="h-[calc(100%-2rem)]"><WidgetBody w={w} mode={mode} ownerUsername={ownerUsername} isOwner={isOwner} editing={editing} onUpdate={onUpdate} viewer={viewer} /></div>
    </div>
  );
}

/* -------------------------- add widget picker -------------------------- */
/**
 * Multi-select widget library (Feb 24, 2026 spec). Owner ticks every
 * widget they want to add, then hits a single Save button — all
 * selections are appended to the widgets array in one shot. Closes
 * via the X button or by clicking the backdrop.
 */
function AddWidgetPicker({ open, onClose, onPickMany, viewer }) {
  const [selected, setSelected] = useState(new Set());
  const [available, setAvailable] = useState(null);   // backend registry; null until loaded
  const [disabledKeys, setDisabledKeys] = useState(new Set());
  useEffect(() => { if (!open) setSelected(new Set()); }, [open]);

  // Effect #1 — fetch the live registry. AbortController instead of a
  // `cancelled` flag so racing the unmount can't silently swallow the
  // setState (the prior implementation lost results when `viewer`
  // hydrated mid-fetch).
  useEffect(() => {
    if (!open) return undefined;
    const ctrl = new AbortController();
    (async () => {
      try {
        const { data } = await apiClient.get(
          "/widgets/available?placement=profile",
          { signal: ctrl.signal },
        );
        const reg = (data?.widgets || []).map((w) => ({
          id: w.key,
          label: w.name,
          icon: w.icon,
          default_size: w.default_size || "medium",
          // Carry the editor_config + widget_type forward so the picker
          // can both show a richer preview AND so any future "preview
          // before save" UX has the data on hand. The save path only
          // persists {id, type, size} — hydration on read merges the
          // latest editor_config back in.
          editor_config: w.editor_config || null,
          widget_type: w.type || null,
          is_registry: true,
        }));
        setAvailable(reg.length ? reg : WIDGET_TYPES);
      } catch (e) {
        if (e?.name !== "CanceledError" && e?.name !== "AbortError") {
          setAvailable(WIDGET_TYPES);
        }
      }
    })();
    return () => ctrl.abort();
  }, [open]);

  // Effect #2 — admin-only fetch of disabled keys for the banner.
  // Runs whenever the viewer hydrates so an initial `null` viewer
  // doesn't permanently swallow the result.
  useEffect(() => {
    if (!open || !viewer) return undefined;
    const role = viewer?.role || "";
    const isAdmin = role === "admin" || role === "founder"
      || viewer?.is_admin || viewer?.username === "stealth";
    if (!isAdmin) return undefined;
    const ctrl = new AbortController();
    (async () => {
      try {
        const { data } = await apiClient.get(
          "/widgets/disabled",
          { signal: ctrl.signal },
        );
        setDisabledKeys(new Set((data?.keys || []).map((k) => k.key)));
      } catch { /* */ }
    })();
    return () => ctrl.abort();
  }, [open, viewer]);

  if (!open) return null;
  const types = available || WIDGET_TYPES;
  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const save = () => {
    const items = types.filter((w) => selected.has(w.id));
    if (items.length) onPickMany(items);
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="add-widget-picker"
    >
      <div className="or-surface w-full max-w-3xl p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Widget Library</h3>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              Tap to select multiple, then Save.
            </div>
          </div>
          <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={onClose}>
            <Icons.X size={16} />
          </button>
        </div>
        {disabledKeys.size > 0 && (
          <div
            className="text-[11px] mb-3 px-3 py-2 rounded"
            style={{ background: "rgba(255,90,107,0.14)", color: "#FF8080" }}
            data-testid="picker-disabled-banner"
          >
            {disabledKeys.size} widget{disabledKeys.size === 1 ? "" : "s"} currently disabled by an admin and hidden from this picker. Manage at /admin/widgets.
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {types.map((w) => {
            const Icon = Icons[w.icon] || Icons.Sparkles;
            const isSelected = selected.has(w.id);
            return (
              <button
                key={w.id}
                data-testid={`add-widget-${w.id}`}
                data-selected={isSelected ? "true" : "false"}
                aria-pressed={isSelected}
                onClick={() => toggle(w.id)}
                className="or-surface p-4 text-left transition-transform hover:-translate-y-0.5 relative"
                style={{
                  background: "var(--surface-2)",
                  outline: isSelected ? "2px solid var(--primary)" : "none",
                }}
              >
                {isSelected && (
                  <Icons.Check
                    size={14}
                    className="absolute top-2 right-2"
                    style={{ color: "var(--primary)" }}
                  />
                )}
                <Icon size={20} style={{ color: "var(--primary)" }} />
                <div className="mt-2 font-semibold text-sm" style={{ color: "var(--text-main)" }}>{w.label}</div>
                <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-muted)" }}>{w.default_size}</div>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            className="or-btn or-btn-ghost"
            onClick={onClose}
            data-testid="add-widget-cancel"
          >Cancel</button>
          <button
            className="or-btn or-btn-primary"
            onClick={save}
            disabled={selected.size === 0}
            data-testid="add-widget-save-many"
            style={{ opacity: selected.size === 0 ? 0.5 : 1 }}
          >
            <Icons.Plus size={14} /> Add {selected.size > 0 ? `${selected.size} widget${selected.size === 1 ? "" : "s"}` : "selected"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
export default function Profile() {
  useHeartbeat("profile");
  const { user, isGuest, updateProfile, refreshMe } = useAuth();
  const { mode } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [editing, setEditing] = useState(searchParams.get("edit") !== "0");
  const [form, setForm] = useState({ name: "", bio: "" });
  const [widgets, setWidgets] = useState(user?.widgets?.length ? user.widgets : DEFAULT_WIDGETS);
  const [addOpen, setAddOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);

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
  // Multi-select picker variant — appends an array of selections in one
  // shot, generating unique ids per entry so the React keys never collide.
  // ALWAYS sets a `size` so the SortableWidget header doesn't crash on
  // undefined size[0].
  const addWidgets = (items) => {
    setWidgets((arr) => {
      let stamp = Date.now();
      const next = [...arr];
      items.forEach((w) => {
        stamp += 1;
        next.push({
          id: `w-${stamp}`,
          type: w.id,
          size: w.default_size || "medium",
        });
      });
      return next;
    });
  };
  // Patch a single widget's fields in place. Used by Notes (text edit)
  // and any future widget-specific config UI. Preserves order + sizes.
  const updateWidget = (id, patch) =>
    setWidgets((arr) => arr.map((x) => x.id === id ? { ...x, ...patch } : x));

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
      <div className="or-surface overflow-hidden mb-5 relative">
        {editing && (
          <button
            className="or-btn or-btn-ghost absolute top-3 right-3 z-10"
            style={{ padding: "0.4rem 0.75rem", fontSize: "0.78rem" }}
            onClick={() => navigate("/settings/account")}
            data-testid="profile-settings-gear"
            title="Account settings"
            aria-label="Account settings"
          >
            <Icons.Settings size={14} /> Settings
          </button>
        )}
        <div className="h-24 sm:h-32 relative overflow-hidden" data-testid="profile-banner-area" style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 50%, transparent), color-mix(in srgb, var(--secondary) 50%, transparent))",
        }}>
          {user?.banner_url && (
            <BannerView
              url={user.banner_url}
              offsetY={user.banner_offset_y ?? 50}
              scale={user.banner_scale ?? 1}
              testid="profile-banner-img"
            />
          )}
          {editing && !isGuest && (
            <button
              type="button"
              onClick={() => setBannerEditorOpen(true)}
              className="absolute right-3 bottom-3 or-btn"
              style={{ padding: "0.35rem 0.7rem", fontSize: "0.75rem", zIndex: 2 }}
              data-testid="profile-banner-edit"
              aria-label="Edit banner image"
            >
              <Icons.Image size={12} /> {user?.banner_url ? "Change banner" : "Add banner"}
            </button>
          )}
        </div>
        <div className="px-4 sm:px-6 pb-4 -mt-10 sm:-mt-12 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="relative shrink-0">
            <UserAvatar
              user={user}
              size={96}
              style={{ border: "3px solid var(--surface)", background: "var(--surface)" }}
              testid="profile-avatar"
            />
            {/* Avatar change CTA — visible only while editing the profile.
                Sits on the bottom-right; the presence bubble (also bottom-
                right) is naturally hidden behind it during edit mode, which
                is fine because the change-button is the active control. */}
            {editing && !isGuest && (
              <button
                type="button"
                onClick={() => setAvatarPickerOpen(true)}
                className="absolute -bottom-1 -right-1 flex items-center justify-center"
                style={{
                  width: 34, height: 34, borderRadius: "50%",
                  background: "var(--primary)", color: "var(--primary-fg)",
                  border: "2px solid var(--surface)",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
                  zIndex: 2,
                }}
                aria-label={user?.avatar_url ? "Change profile picture" : "Add profile picture"}
                title={user?.avatar_url ? "Change Profile Pic" : "Add Profile Pic"}
                data-testid="profile-avatar-change"
              >
                {user?.avatar_url
                  ? <Icons.Camera size={16} />
                  : <Icons.Plus size={18} />}
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {/* VIP badge always rendered next to identity, including edit mode */}
            {user?.is_vip && (
              <div className="mb-1" data-testid="profile-vip-row">
                <VipBadge joinedAt={user.vip_joined_at} testid="profile-vip-badge" />
              </div>
            )}
            {editing ? (
              <>
                <input className="or-input mb-2 text-xl" data-testid="profile-edit-name"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Display name" />
                <input className="or-input text-sm" data-testid="profile-edit-bio"
                  value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Bio" />
              </>
            ) : (
              <>
                <h2 className="text-2xl sm:text-3xl flex items-center gap-2 flex-wrap" style={{ fontFamily: "var(--font-display)" }} data-testid="profile-name">
                  {user?.name || "Guest visitor"}
                </h2>
                {user?.username && (
                  <div className="flex items-center gap-2 mt-1" data-testid="profile-username-row">
                    <span className="text-sm" style={{ color: "var(--text-muted)" }}>@{user.username}</span>
                  </div>
                )}
                {user?.username && <ProfileBadges username={user.username} />}
                <div className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }} data-testid="profile-bio">
                  {user?.bio || (isGuest ? "Browsing as guest." : "Tap edit to add a bio.")}
                </div>
                <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--text-muted)" }} data-testid="profile-counts">
                  <span><b style={{ color: "var(--text-main)" }} data-testid="profile-follower-count">{user?.follower_count ?? 0}</b> followers</span>
                  <span><b style={{ color: "var(--text-main)" }} data-testid="profile-following-count">{user?.following_count ?? 0}</b> following</span>
                  <span><b style={{ color: "var(--text-main)" }} data-testid="profile-widgets-count">{user?.widgets_count ?? widgets.length}</b> widgets</span>
                </div>
              </>
            )}
          </div>
          {/* Only "Edit" and "Edit Widgets" remain per Phase A spec.
              "View as Public", "+ Add widget", and "Library" were removed. */}
          <div className="flex gap-2 flex-wrap">
            {!isGuest && user && (
              editing
                ? <button className="or-btn" onClick={saveLayout} data-testid="profile-save">Save</button>
                : <button className="or-btn or-btn-ghost" onClick={() => setEditing(true)} data-testid="profile-edit">
                    <Icons.Edit3 size={14} /> Edit
                  </button>
            )}
            {!isGuest && user && (
              <button
                className="or-btn or-btn-ghost"
                onClick={() => navigate("/profile/support")}
                data-testid="profile-support-link"
                title="OurRealm Support"
              >
                <Icons.LifeBuoy size={14} /> Support
              </button>
            )}
            {!isGuest && user && (
              <button
                className="or-btn or-btn-ghost"
                onClick={() => { setEditing(true); setAddOpen(true); }}
                data-testid="open-widget-picker"
                title="Manage widgets"
              >
                <Icons.LayoutGrid size={14} /> Edit Widgets
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Phase-2: Top 8 management inline in Edit Profile.
          Auto-saves; instant; reflects on the Top-8 widget after refreshMe. */}
      {editing && !isGuest && user && <Top8Editor />}

      {/* Widgets bento (drag-and-drop when editing) */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-4"
            style={{ gridAutoRows: "minmax(150px, auto)" }}
            data-testid="profile-widget-grid"
          >
            {widgets
              // Render widgets that match either a hardcoded type OR have
              // a hydrated editor_config (registry-launched custom widget).
              // The server-side hydrator drops stale/unauthorized refs so
              // anything that reaches us here is safe to render.
              .filter((w) => ALLOWED_WIDGET_TYPES.has(w.type) || !!w.editor_config)
              .map((w) => (
              <SortableWidget
                key={w.id}
                w={w}
                mode={mode}
                editing={editing}
                onCycleSize={cycleSize}
                onRemove={removeWidget}
                onUpdate={updateWidget}
                ownerUsername={user?.username}
                isOwner={true}
                viewer={user}
              />
            ))}
            {/* "+ Add New Widget" tile — always visible on the owner's
                own profile so the spec-mandated 3rd tile renders even
                for users with no saved widgets. Click opens the existing
                AddWidgetPicker. Hidden for guests / non-owners. */}
            {!isGuest && user && (
              <button
                type="button"
                onClick={() => { setEditing(true); setAddOpen(true); }}
                className="or-surface flex flex-col items-center justify-center gap-1.5"
                style={{
                  minHeight: 150,
                  borderStyle: "dashed",
                  borderColor: "color-mix(in srgb, var(--primary) 45%, transparent)",
                  background: "color-mix(in srgb, var(--primary) 6%, transparent)",
                  color: "var(--primary)",
                }}
                data-testid="profile-add-widget-tile"
                aria-label="Add a new widget"
              >
                <Icons.Plus size={28} />
                <span
                  className="text-xs uppercase tracking-widest"
                  style={{ color: "var(--text-muted)" }}
                >
                  Add New Widget
                </span>
              </button>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <AddWidgetPicker open={addOpen} onClose={() => setAddOpen(false)} onPickMany={addWidgets} viewer={user} />
      <AvatarPicker
        open={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        onSaved={() => setAvatarPickerOpen(false)}
      />
      <BannerEditor
        open={bannerEditorOpen}
        onClose={() => setBannerEditorOpen(false)}
        initial={{ banner_url: user?.banner_url, banner_offset_y: user?.banner_offset_y, banner_scale: user?.banner_scale }}
        onSave={async (payload) => {
          await updateProfile(payload);
          await refreshMe?.();
        }}
        onRemove={async () => {
          await updateProfile({ banner_url: null, banner_offset_y: 50, banner_scale: 1 });
          await refreshMe?.();
        }}
        testid="profile-banner-editor"
      />
    </div>
  );
}
