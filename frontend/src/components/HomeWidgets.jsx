/**
 * HomeWidgets — placement="home" section rendered on /home for the
 * logged-in user. Owner-only (no public Home shareable yet). Pulls
 * the user's home_widgets via /api/home/widgets, lets them add new
 * ones from the registry picker, and removes existing ones inline.
 *
 * The widget *bodies* reuse the same shared renderers from
 * ProfileWidgetBodies so animations + editable affordances behave
 * identically to /profile. Top 8 + MyFeed are not editable here —
 * they're owner display only on Home.
 */
import React, { useCallback, useEffect, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import RegistryWidgetPicker from "@/components/RegistryWidgetPicker";
import MyFeedWidget from "@/components/MyFeedWidget";
import TopEightWidget from "@/components/TopEightWidget";
import {
  NotesBody, BlogBody, VideosBody, MusicBody, PodcastsBody, PhotosBody, PollsBody, RadarBody,
} from "@/components/ProfileWidgetBodies";

function HomeWidgetBody({ w, viewer, ownerUsername, editing, onUpdate }) {
  switch (w.type) {
    case "myfeed":   return <MyFeedWidget username={ownerUsername} isOwner />;
    case "top8":     return <TopEightWidget username={ownerUsername} />;
    case "notes":    return <NotesBody w={w} editing={editing} isOwner viewer={viewer} onUpdate={onUpdate} />;
    case "blog":     return <BlogBody  w={w} editing={editing} isOwner viewer={viewer} onUpdate={onUpdate} />;
    case "videos":   return <VideosBody   w={w} editing={editing} isOwner ownerUsername={ownerUsername} onUpdate={onUpdate} />;
    case "music":    return <MusicBody    w={w} editing={editing} isOwner ownerUsername={ownerUsername} onUpdate={onUpdate} />;
    case "podcasts": return <PodcastsBody w={w} editing={editing} isOwner ownerUsername={ownerUsername} onUpdate={onUpdate} />;
    case "photos":   return <PhotosBody   w={w} editing={editing} isOwner ownerUsername={ownerUsername} onUpdate={onUpdate} />;
    case "polls":    return <PollsBody    w={w} editing={editing} isOwner ownerUsername={ownerUsername} viewer={viewer} onUpdate={onUpdate} />;
    case "radar":    return <RadarBody w={w} />;
    default:
      return (
        <div className="text-xs italic" style={{ color: "var(--text-muted)" }}>
          {w.type} (preview)
        </div>
      );
  }
}

export default function HomeWidgets() {
  const { user } = useAuth();
  const [widgets, setWidgets] = useState([]);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await apiClient.get("/home/widgets");
      setWidgets(data?.widgets || []);
    } catch { /* */ }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.patch("/home/widgets", { widgets });
      setEditing(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const addMany = (items) => {
    let stamp = Date.now();
    setWidgets((arr) => [
      ...arr,
      ...items.map((w) => {
        stamp += 1;
        return { id: `hw-${stamp}`, type: w.id, size: w.default_size || "medium" };
      }),
    ]);
  };
  const remove = (id) => setWidgets((arr) => arr.filter((w) => w.id !== id));
  const updateWidget = (id, patch) =>
    setWidgets((arr) => arr.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  if (!user) return null;

  return (
    <section className="mt-6" data-testid="home-widgets-section">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>
          <Icons.LayoutGrid size={18} className="inline mr-2" style={{ color: "var(--primary)" }} />
          Home Widgets
        </h2>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                className="or-btn or-btn-ghost"
                onClick={() => { setEditing(false); load(); }}
                data-testid="home-widgets-cancel"
              >Cancel</button>
              <button
                className="or-btn or-btn-primary"
                onClick={save}
                disabled={saving}
                data-testid="home-widgets-save"
              >
                {saving ? <Icons.Loader2 size={14} className="animate-spin" /> : <Icons.Save size={14} />} Save
              </button>
            </>
          ) : (
            <button
              className="or-btn or-btn-ghost"
              onClick={() => setEditing(true)}
              data-testid="home-widgets-edit"
            >
              <Icons.LayoutGrid size={14} /> Manage Widgets
            </button>
          )}
        </div>
      </div>

      {widgets.length === 0 && !editing ? (
        <div className="or-surface p-6 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="home-widgets-empty">
          No home widgets yet. Click <b>Manage Widgets</b> to add your first one.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="home-widgets-grid">
          {widgets.map((w) => (
            <div
              key={w.id}
              className="or-surface p-3 relative"
              style={{ minHeight: 170 }}
              data-testid={`home-widget-${w.id}`}
            >
              {editing && (
                <button
                  className="absolute top-1.5 right-1.5 starbar-icon z-10"
                  style={{ width: 26, height: 26, color: "#FF5A6B" }}
                  onClick={() => remove(w.id)}
                  data-testid={`home-widget-remove-${w.id}`}
                  aria-label="Remove"
                >
                  <Icons.X size={12} />
                </button>
              )}
              <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
                {w.type}
              </div>
              <div className="h-[calc(100%-1.25rem)]">
                <HomeWidgetBody w={w} viewer={user} ownerUsername={user.username} editing={editing} onUpdate={updateWidget} />
              </div>
            </div>
          ))}
          {editing && (
            <button
              onClick={() => setPickerOpen(true)}
              className="or-surface p-3 flex flex-col items-center justify-center border-2 border-dashed"
              style={{ borderColor: "var(--border-col)", minHeight: 170, color: "var(--text-muted)" }}
              data-testid="home-widget-add-tile"
            >
              <Icons.Plus size={20} />
              <span className="text-xs font-semibold mt-1">Add Widget</span>
            </button>
          )}
        </div>
      )}

      <RegistryWidgetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPickMany={(items) => { addMany(items); setPickerOpen(false); }}
        viewer={user}
        placement="home"
      />
    </section>
  );
}
