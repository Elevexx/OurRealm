/**
 * ProfileWidgetBodies — shared renderers for the 15 profile widgets.
 *
 * Used by both `/profile` (owner-edit view, Profile.jsx) and
 * `/profile/:username` (public/founder view, FounderProfile.jsx) so
 * the same DOM + data flow is guaranteed across surfaces. Spec rule:
 * public profile must render the same widget content as edit profile.
 *
 * Editing affordances are gated by the `editing && isOwner` prop pair —
 * public viewers never see textareas, upload tiles, vote-as-owner UI, etc.
 *
 * Persistence model: all widget config (notes.text, blog.text,
 * music.sound_ids, podcasts.sound_ids, videos.items, polls.question +
 * polls.options) lives INLINE on `users.widgets[i]` and is saved via
 * the standard `PATCH /api/profile/me` flow. Vote tallies for polls
 * live in `db.profile_poll_votes` and go through /api/profile-poll.
 */
import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { resolveMediaUrl as mediaUrl } from "@/lib/mediaUrl";

const DEFAULT_NOTES_TEXT = '"Discover should feel inevitable, not optional."\n— shipping log';
const DEFAULT_BLOG_TEXT = "Write your first blog post here…";

/**
 * Extract the first frame of a local video File, upload it as a JPEG
 * thumbnail, and return the resulting image URL. Returns null if
 * extraction fails (no support, file too large, browser denied). All
 * work happens client-side via a hidden <video> + <canvas>. Server
 * never needs ffmpeg.
 */
async function uploadVideoThumbnail(file) {
  if (!file || !file.type?.startsWith("video/")) return null;
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // Wait for metadata so we know dimensions.
    await new Promise((res, rej) => {
      let settled = false;
      const onMeta = () => { if (!settled) { settled = true; res(); } };
      const onErr = () => { if (!settled) { settled = true; rej(new Error("video metadata load failed")); } };
      video.addEventListener("loadedmetadata", onMeta, { once: true });
      video.addEventListener("error", onErr, { once: true });
      setTimeout(() => { if (!settled) { settled = true; rej(new Error("video metadata timeout")); } }, 8000);
    });
    // Seek to 0.1 s so we don't capture a black "before first key-frame" frame.
    await new Promise((res, rej) => {
      let settled = false;
      const onSeek = () => { if (!settled) { settled = true; res(); } };
      const onErr = () => { if (!settled) { settled = true; rej(new Error("seek failed")); } };
      video.addEventListener("seeked", onSeek, { once: true });
      video.addEventListener("error", onErr, { once: true });
      try { video.currentTime = Math.min(0.1, Math.max(0, (video.duration || 0) * 0.05)); }
      catch { onErr(); return; }
      setTimeout(() => { if (!settled) { settled = true; rej(new Error("seek timeout")); } }, 5000);
    });
    const canvas = document.createElement("canvas");
    const maxW = 800;
    const ratio = Math.min(1, maxW / (video.videoWidth || maxW));
    canvas.width  = Math.max(1, Math.round((video.videoWidth || maxW) * ratio));
    canvas.height = Math.max(1, Math.round((video.videoHeight || maxW * 9 / 16) * ratio));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.78));
    if (!blob) return null;
    const fd = new FormData();
    fd.append("file", new File([blob], `thumb_${Date.now()}.jpg`, { type: "image/jpeg" }));
    const { data } = await apiClient.post("/images/upload", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data?.url || data?.image_url || null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Character limits — mirror backend `core/widget_types.py`.
const NOTES_LIMITS = { standard: 300, vip: 500, stealth: Infinity };
const BLOG_LIMITS = { standard: 100, vip: 2000, stealth: Infinity };

function limitFor(map, viewer) {
  if ((viewer?.username || "").toLowerCase() === "stealth") return map.stealth;
  return viewer?.is_vip ? map.vip : map.standard;
}

// How many sound rows to show based on the widget's `size`.
function visibleSoundCount(size) {
  if (size === "small") return 3;
  if (size === "medium") return 5;
  return 10; // large / full / xl
}

// ─────────────────────────────────────────────────────────────────────
// NOTES — editable inline by owner, plain italic block elsewhere.
// ─────────────────────────────────────────────────────────────────────
export function NotesBody({ w, editing, isOwner, viewer, onUpdate }) {
  const limit = limitFor(NOTES_LIMITS, viewer);
  const text = w.text ?? "";
  const display = text.trim() ? text : DEFAULT_NOTES_TEXT;
  const remaining = limit === Infinity ? null : Math.max(0, limit - text.length);

  if (!(editing && isOwner)) {
    return (
      <div
        className="text-xs leading-relaxed italic whitespace-pre-line"
        style={{ color: "var(--text-main)" }}
        data-testid={`notes-body-${w.id}`}
      >
        {display}
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col gap-1">
      <textarea
        className="or-input text-xs leading-relaxed italic w-full flex-1 resize-none"
        style={{ color: "var(--text-main)", minHeight: 60 }}
        value={text}
        maxLength={limit === Infinity ? undefined : limit}
        placeholder={DEFAULT_NOTES_TEXT}
        onChange={(e) => onUpdate?.(w.id, { text: e.target.value })}
        data-testid={`notes-edit-${w.id}`}
        aria-label="Edit notes"
      />
      {remaining !== null && (
        <div className="text-[10px] text-right" style={{ color: "var(--text-muted)" }}>
          {remaining} chars left
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BLOG — same shape as Notes but with a different limit and placeholder.
// Renders read-only on public profiles, inline textarea for the owner.
// ─────────────────────────────────────────────────────────────────────
export function BlogBody({ w, editing, isOwner, viewer, onUpdate }) {
  const limit = limitFor(BLOG_LIMITS, viewer);
  const text = w.text ?? "";
  const remaining = limit === Infinity ? null : Math.max(0, limit - text.length);

  if (!(editing && isOwner)) {
    return (
      <div
        className="text-xs leading-relaxed whitespace-pre-line"
        style={{ color: "var(--text-main)" }}
        data-testid={`blog-body-${w.id}`}
      >
        {text.trim() ? text : DEFAULT_BLOG_TEXT}
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col gap-1">
      <textarea
        className="or-input text-xs leading-relaxed w-full flex-1 resize-none"
        style={{ color: "var(--text-main)", minHeight: 80 }}
        value={text}
        maxLength={limit === Infinity ? undefined : limit}
        placeholder={DEFAULT_BLOG_TEXT}
        onChange={(e) => onUpdate?.(w.id, { text: e.target.value })}
        data-testid={`blog-edit-${w.id}`}
        aria-label="Edit blog"
      />
      {remaining !== null && (
        <div className="text-[10px] text-right" style={{ color: "var(--text-muted)" }}>
          {remaining} chars left
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// VIDEOS — up to 4 entries. Each entry is either:
//   { kind: "upload", url, video_id, thumbnail? }   from /api/videos/upload
//   { kind: "post",   post_id, url, thumbnail? }    pinned existing video post
// Owner sees an Upload tile + a "Pin existing" picker until items.length===4.
// Public viewers see a click-to-play grid (full controls once a tile is
// activated). The PREVIOUS implementation overlaid a non-clickable
// PlayCircle icon on a poster-less <video preload="metadata"> which made
// playback unreachable on mobile Safari — fixed by lazily mounting a
// <video controls autoPlay> only after the user taps the tile.
// ─────────────────────────────────────────────────────────────────────
export function VideosBody({ w, editing, isOwner, ownerUsername, onUpdate }) {
  const items = Array.isArray(w.items) ? w.items.slice(0, 4) : [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(null);   // which tile is playing
  const fileInputRef = React.useRef(null);

  const removeAt = (idx) => {
    const next = items.slice();
    next.splice(idx, 1);
    onUpdate?.(w.id, { items: next });
    if (activeIdx === idx) setActiveIdx(null);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || items.length >= 4) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await apiClient.post("/videos/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const url = data?.url || data?.video?.url;
      const video_id = data?.video?.id;
      if (!url) return;
      // Best-effort first-frame extraction → upload as a thumbnail image
      // so the tile shows a real preview instead of just a play badge.
      // Mobile Safari ignores `preload=metadata` for ranged streams, so a
      // baked thumbnail is the only reliable cross-device preview.
      let thumbnail = null;
      try {
        thumbnail = await uploadVideoThumbnail(file);
      } catch (err) {
        console.warn("video thumbnail extraction failed", err);
      }
      onUpdate?.(w.id, {
        items: [...items, { kind: "upload", url, video_id, thumbnail }],
      });
    } catch (err) { console.error("video upload failed", err); }
    finally { setUploading(false); }
  };

  // Empty + read-only → friendly empty state.
  if (items.length === 0 && !(editing && isOwner)) {
    return (
      <div
        className="h-full flex items-center justify-center text-xs italic"
        style={{ color: "var(--text-muted)" }}
        data-testid={`videos-empty-${w.id}`}
      >
        No videos yet
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 h-full" data-testid={`videos-body-${w.id}`}>
      {items.map((it, idx) => (
        <VideoTile
          key={`${it.video_id || it.post_id || idx}`}
          item={it}
          idx={idx}
          widgetId={w.id}
          active={activeIdx === idx}
          onActivate={() => setActiveIdx(idx)}
          editing={editing}
          isOwner={isOwner}
          onRemove={() => removeAt(idx)}
        />
      ))}
      {editing && isOwner && items.length < 4 && (
        <>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 border-2 border-dashed"
            style={{
              borderColor: "var(--border-col)", borderRadius: 8,
              minHeight: 80, background: "var(--surface-2)",
              color: "var(--text-muted)",
            }}
            disabled={uploading}
            data-testid={`videos-upload-${w.id}`}
          >
            {uploading ? (
              <Icons.Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                <Icons.Upload size={18} />
                <span className="text-[10px] font-semibold">Upload</span>
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleUpload}
          />
          {items.length < 3 && (
            <button
              onClick={() => setPickerOpen(true)}
              className="flex flex-col items-center justify-center gap-1 border-2 border-dashed"
              style={{
                borderColor: "var(--border-col)", borderRadius: 8,
                minHeight: 80, background: "var(--surface-2)",
                color: "var(--text-muted)",
              }}
              data-testid={`videos-pin-${w.id}`}
            >
              <Icons.Pin size={18} />
              <span className="text-[10px] font-semibold">Pin existing</span>
            </button>
          )}
        </>
      )}
      {pickerOpen && (
        <PinVideoPicker
          ownerUsername={ownerUsername}
          existingIds={items.map((it) => it.post_id).filter(Boolean)}
          onPick={(post) => {
            const next = [...items, {
              kind: "post",
              post_id: post.id,
              url: post.video_url || post.media_url,
              thumbnail: post.image_url,
            }];
            onUpdate?.(w.id, { items: next });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * One video cell. While inactive we render either the pinned-post
 * thumbnail OR a <video preload="metadata"> for a first-frame preview.
 * On tap/click we swap to <video src controls autoPlay playsInline>
 * so the browser owns playback (including mobile Safari).
 */
function VideoTile({ item, idx, widgetId, active, onActivate, editing, isOwner, onRemove }) {
  const src = mediaUrl(item.url);
  const poster = item.thumbnail ? mediaUrl(item.thumbnail) : undefined;
  return (
    <div
      className="relative overflow-hidden"
      style={{ borderRadius: 8, background: "var(--surface-2)", minHeight: 80 }}
      data-testid={`videos-item-${widgetId}-${idx}`}
    >
      {active ? (
        <video
          src={src}
          poster={poster}
          className="w-full h-full object-cover"
          controls
          autoPlay
          playsInline
          data-testid={`videos-player-${widgetId}-${idx}`}
        />
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onActivate(); }}
          className="block w-full h-full text-left"
          data-testid={`videos-thumb-${widgetId}-${idx}`}
          aria-label="Play video"
        >
          {poster ? (
            <img src={poster} alt="" className="w-full h-full object-cover" />
          ) : (
            <video
              src={src}
              className="w-full h-full object-cover pointer-events-none"
              muted
              playsInline
              preload="metadata"
            />
          )}
          <span
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.45))" }}
          >
            <Icons.PlayCircle size={32} style={{ color: "#fff", opacity: 0.95 }} />
          </span>
        </button>
      )}
      {editing && isOwner && (
        <button
          className="absolute top-1 right-1 rounded-full p-1 z-10"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          data-testid={`videos-delete-${widgetId}-${idx}`}
          aria-label="Remove video"
        >
          <Icons.X size={12} style={{ color: "#fff" }} />
        </button>
      )}
    </div>
  );
}

function PinVideoPicker({ ownerUsername, existingIds, onPick, onClose }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The user's own video posts. /api/posts supports ?username & ?media_type filters.
        const { data } = await apiClient.get(`/posts?username=${ownerUsername}&media_type=video&limit=30`);
        if (!cancelled) setPosts((data?.posts || []).filter(p => p.video_url || p.media_url));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [ownerUsername]);
  const existing = new Set(existingIds);
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="pin-video-picker"
    >
      <div className="or-surface w-full max-w-xl p-5 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Pin a video post</h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>
        {loading && <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading your videos…</div>}
        {!loading && posts.length === 0 && (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>You haven't posted any videos yet.</div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {posts.map((p) => (
            <button
              key={p.id}
              disabled={existing.has(p.id)}
              onClick={() => onPick(p)}
              className="relative overflow-hidden disabled:opacity-40"
              style={{ borderRadius: 8, background: "var(--surface-2)", aspectRatio: "1/1" }}
              data-testid={`pin-video-pick-${p.id}`}
            >
              {p.image_url ? (
                <img src={mediaUrl(p.image_url)} alt="" className="w-full h-full object-cover" />
              ) : (
                <Icons.Video size={22} className="absolute inset-0 m-auto" style={{ color: "var(--text-muted)" }} />
              )}
              <Icons.PlayCircle size={26} className="absolute inset-0 m-auto" style={{ color: "#fff" }} />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// MUSIC / PODCASTS — array of sound IDs (max 10). Resolves IDs to track
// rows via /api/sounds/by-ids on first paint, then renders a list whose
// length depends on the widget's size. Owner gets a picker.
// ─────────────────────────────────────────────────────────────────────
function SoundsBody({ w, category, editing, isOwner, ownerUsername, onUpdate, testidPrefix }) {
  const ids = Array.isArray(w.sound_ids) ? w.sound_ids.slice(0, 10) : [];
  const visibleN = visibleSoundCount(w.size);
  const [tracks, setTracks] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Pull just the tracks pinned to this widget. We page through the owner's
  // sounds and filter by id (cheap — caps at 10 anyway). For empty widget,
  // skip the request entirely.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (ids.length === 0) { setTracks([]); return; }
      try {
        const { data } = await apiClient.get(
          `/sounds/by-user/${ownerUsername}?category=${category}&limit=50`
        );
        if (cancelled) return;
        const byId = new Map((data?.tracks || []).map((t) => [t.id, t]));
        setTracks(ids.map((id) => byId.get(id)).filter(Boolean));
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [JSON.stringify(ids), ownerUsername, category]);

  const remove = (id) => {
    onUpdate?.(w.id, { sound_ids: ids.filter((x) => x !== id) });
  };

  return (
    <div className="h-full overflow-y-auto" data-testid={`${testidPrefix}-body-${w.id}`}>
      {tracks.length === 0 && !(editing && isOwner) && (
        <div
          className="h-full flex items-center justify-center text-xs italic"
          style={{ color: "var(--text-muted)" }}
          data-testid={`${testidPrefix}-empty-${w.id}`}
        >
          {category === "Music" ? "No music yet" : "No podcast episodes yet"}
        </div>
      )}
      {tracks.slice(0, visibleN).map((t) => (
        <div key={t.id} className="flex items-center gap-2 py-1.5">
          <div className="w-9 h-9 shrink-0 rounded-md overflow-hidden" style={{ background: "var(--surface-2)" }}>
            {t.cover ? <img src={mediaUrl(t.cover)} alt="" className="w-full h-full object-cover" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>{t.title}</div>
            <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{t.artist || t.username}</div>
          </div>
          {editing && isOwner && (
            <button
              className="starbar-icon shrink-0"
              style={{ width: 26, height: 26 }}
              onClick={() => remove(t.id)}
              data-testid={`${testidPrefix}-remove-${w.id}-${t.id}`}
              aria-label="Remove sound"
            >
              <Icons.X size={12} />
            </button>
          )}
        </div>
      ))}
      {editing && isOwner && ids.length < 10 && (
        <button
          className="or-chip w-full justify-center mt-2"
          onClick={() => setPickerOpen(true)}
          data-testid={`${testidPrefix}-add-${w.id}`}
        >
          <Icons.Plus size={14} /> Add {category === "Music" ? "music" : "podcast"} sound
        </button>
      )}
      {pickerOpen && (
        <SoundPicker
          category={category}
          ownerUsername={ownerUsername}
          existing={ids}
          onPick={(t) => {
            if (ids.includes(t.id) || ids.length >= 10) return;
            onUpdate?.(w.id, { sound_ids: [...ids, t.id] });
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

export function MusicBody(props) {
  return <SoundsBody {...props} category="Music" testidPrefix="music" />;
}
export function PodcastsBody(props) {
  return <SoundsBody {...props} category="Podcasts" testidPrefix="podcasts" />;
}

function SoundPicker({ category, ownerUsername, existing, onPick, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(
          `/sounds/by-user/${ownerUsername}?category=${category}&limit=100`
        );
        if (!cancelled) setItems(data?.tracks || []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [category, ownerUsername]);
  const have = new Set(existing);
  // Render via portal at document.body so the `position: fixed`
  // backdrop escapes the transformed SortableWidget ancestor. Without
  // this, dnd-kit's `transform` on the parent forces `fixed` to be
  // relative to the widget — the backdrop then covers only the widget
  // card and looks like a "black overlay" bug.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid={`sound-picker-${category}`}
    >
      <div className="or-surface w-full max-w-lg p-5 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
            Add {category === "Music" ? "music" : "podcast"} sound
          </h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>
        {loading && <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="text-xs p-3 rounded" style={{ color: "var(--text-muted)", background: "var(--surface-2)" }}>
            You don't have any {category.toLowerCase()} sounds yet.
            {" "}Upload one from the <a href="/sounds" className="underline" style={{ color: "var(--primary)" }}>Sounds page</a>{" "}
            (set category to <b>{category}</b> on upload) and it'll appear here.
          </div>
        )}
        <div className="space-y-1">
          {items.map((t) => (
            <button
              key={t.id}
              disabled={have.has(t.id)}
              onClick={() => onPick(t)}
              className="w-full flex items-center gap-2 p-2 text-left disabled:opacity-40"
              style={{ background: "var(--surface-2)", borderRadius: 8 }}
              data-testid={`sound-pick-${t.id}`}
            >
              <div className="w-8 h-8 rounded-md overflow-hidden shrink-0" style={{ background: "var(--surface)" }}>
                {t.cover ? <img src={mediaUrl(t.cover)} alt="" className="w-full h-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>{t.title}</div>
                <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{category}</div>
              </div>
              {have.has(t.id) && <Icons.Check size={14} style={{ color: "var(--primary)" }} />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// PHOTOS — up to 12 entries. Each entry is `{kind:'upload', url}` from
// /api/images/upload OR `{kind:'post', post_id, url}` pinned from an
// existing image post. Owner can upload, pin, remove, and drag-reorder.
// Grid responds to widget size — small=2 cols, otherwise 3.
// ─────────────────────────────────────────────────────────────────────
export function PhotosBody({ w, editing, isOwner, ownerUsername, onUpdate }) {
  const items = Array.isArray(w.items) ? w.items.slice(0, 12) : [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef(null);
  const cols = w.size === "small" ? 2 : 3;

  const removeAt = (idx) => {
    const next = items.slice();
    next.splice(idx, 1);
    onUpdate?.(w.id, { items: next });
  };
  // Simple "move left" reorder — better UX than nothing for now.
  // (Full drag reorder would clash with the widget-level dnd-kit Sortable.)
  const moveLeft = (idx) => {
    if (idx === 0) return;
    const next = items.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onUpdate?.(w.id, { items: next });
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || items.length >= 12) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await apiClient.post("/images/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const url = data?.url || data?.image?.original_url;
      if (url) {
        onUpdate?.(w.id, {
          items: [...items, {
            kind: "upload", url,
            thumbnail_url: data?.thumbnail_url || null,
          }],
        });
      }
    } catch (err) { console.error("image upload failed", err); }
    finally { setUploading(false); }
  };

  if (items.length === 0 && !(editing && isOwner)) {
    return (
      <div
        className="h-full flex items-center justify-center text-xs italic"
        style={{ color: "var(--text-muted)" }}
        data-testid={`photos-empty-${w.id}`}
      >
        No photos yet
      </div>
    );
  }

  return (
    <div
      className="grid gap-1.5 h-full"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      data-testid={`photos-body-${w.id}`}
    >
      {items.map((it, idx) => {
        const src = mediaUrl(it.thumbnail_url || it.url);
        return (
          <div
            key={`${it.post_id || it.url}-${idx}`}
            className="relative overflow-hidden"
            style={{ borderRadius: 6, background: "var(--surface-2)", aspectRatio: "1/1" }}
            data-testid={`photos-item-${w.id}-${idx}`}
          >
            {src ? (
              <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <Icons.Image size={20} className="absolute inset-0 m-auto" style={{ color: "var(--text-muted)" }} />
            )}
            {editing && isOwner && (
              <>
                <button
                  className="absolute top-1 right-1 rounded-full p-0.5 z-10"
                  style={{ background: "rgba(0,0,0,0.7)" }}
                  onClick={(e) => { e.stopPropagation(); removeAt(idx); }}
                  data-testid={`photos-delete-${w.id}-${idx}`}
                  aria-label="Remove photo"
                >
                  <Icons.X size={10} style={{ color: "#fff" }} />
                </button>
                {idx > 0 && (
                  <button
                    className="absolute bottom-1 left-1 rounded-full p-0.5 z-10"
                    style={{ background: "rgba(0,0,0,0.7)" }}
                    onClick={(e) => { e.stopPropagation(); moveLeft(idx); }}
                    data-testid={`photos-move-left-${w.id}-${idx}`}
                    aria-label="Move left"
                  >
                    <Icons.ChevronLeft size={10} style={{ color: "#fff" }} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      {editing && isOwner && items.length < 12 && (
        <>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center border-2 border-dashed"
            style={{
              borderColor: "var(--border-col)", borderRadius: 6,
              aspectRatio: "1/1", background: "var(--surface-2)",
              color: "var(--text-muted)",
            }}
            disabled={uploading}
            data-testid={`photos-upload-${w.id}`}
          >
            {uploading ? (
              <Icons.Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <Icons.Upload size={14} />
                <span className="text-[9px] font-semibold mt-0.5">Upload</span>
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            onClick={() => setPickerOpen(true)}
            className="flex flex-col items-center justify-center border-2 border-dashed"
            style={{
              borderColor: "var(--border-col)", borderRadius: 6,
              aspectRatio: "1/1", background: "var(--surface-2)",
              color: "var(--text-muted)",
            }}
            data-testid={`photos-pin-${w.id}`}
          >
            <Icons.Pin size={14} />
            <span className="text-[9px] font-semibold mt-0.5">Pin</span>
          </button>
        </>
      )}
      {pickerOpen && (
        <PinPhotoPicker
          ownerUsername={ownerUsername}
          existingPostIds={items.map((it) => it.post_id).filter(Boolean)}
          onPick={(post) => {
            const next = [...items, {
              kind: "post", post_id: post.id,
              url: post.image_url || post.media_url,
            }];
            onUpdate?.(w.id, { items: next });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function PinPhotoPicker({ ownerUsername, existingPostIds, onPick, onClose }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(
          `/posts?username=${ownerUsername}&media_type=image&limit=60`
        );
        if (!cancelled) {
          setPosts((data?.posts || []).filter((p) => p.image_url || p.media_url));
        }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [ownerUsername]);
  const existing = new Set(existingPostIds);
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="pin-photo-picker"
    >
      <div className="or-surface w-full max-w-xl p-5 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Pin a photo</h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>
        {loading && <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading your photos…</div>}
        {!loading && posts.length === 0 && (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>You haven't posted any photos yet.</div>
        )}
        <div className="grid grid-cols-4 gap-2">
          {posts.map((p) => (
            <button
              key={p.id}
              disabled={existing.has(p.id)}
              onClick={() => onPick(p)}
              className="relative overflow-hidden disabled:opacity-40"
              style={{ borderRadius: 8, background: "var(--surface-2)", aspectRatio: "1/1" }}
              data-testid={`pin-photo-pick-${p.id}`}
            >
              <img
                src={mediaUrl(p.image_url || p.media_url)}
                alt="" className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// POLLS — single poll per widget (matches widget data shape).
// Owner edits question + options inline. Visitors vote via the public
// endpoint /api/profile-poll/{username}/{widget_id}/vote.
// ─────────────────────────────────────────────────────────────────────
export function PollsBody({ w, editing, isOwner, ownerUsername, viewer, onUpdate }) {
  const question = w.question || "";
  const options = Array.isArray(w.options) ? w.options : [];
  const [state, setState] = useState(null);

  const loadState = useCallback(async () => {
    if (!ownerUsername || options.length === 0 || editing) return;
    try {
      const { data } = await apiClient.get(`/profile-poll/${ownerUsername}/${w.id}`);
      setState(data);
    } catch { /* */ }
  }, [ownerUsername, w.id, options.length, editing]);

  useEffect(() => { loadState(); }, [loadState]);

  // ── OWNER EDIT VIEW: question + add/remove options inline ──
  if (editing && isOwner) {
    const updateOpt = (idx, text) => {
      const next = options.slice();
      next[idx] = { ...(next[idx] || {}), text };
      onUpdate?.(w.id, { options: next });
    };
    const addOpt = () => {
      if (options.length >= 6) return;
      onUpdate?.(w.id, {
        options: [...options, { id: `opt-${Date.now()}-${options.length}`, text: "" }],
      });
    };
    const removeOpt = (idx) => {
      const next = options.slice(); next.splice(idx, 1);
      onUpdate?.(w.id, { options: next });
    };
    return (
      <div className="space-y-2 h-full overflow-y-auto" data-testid={`polls-edit-${w.id}`}>
        <input
          className="or-input text-xs w-full"
          placeholder="Ask a question…"
          value={question}
          maxLength={200}
          onChange={(e) => onUpdate?.(w.id, { question: e.target.value })}
          data-testid={`polls-question-${w.id}`}
        />
        {options.map((opt, idx) => (
          <div key={opt.id || idx} className="flex items-center gap-1">
            <input
              className="or-input text-xs flex-1"
              placeholder={`Option ${idx + 1}`}
              value={opt.text || ""}
              maxLength={100}
              onChange={(e) => updateOpt(idx, e.target.value)}
              data-testid={`polls-option-${w.id}-${idx}`}
            />
            {options.length > 2 && (
              <button
                className="starbar-icon"
                style={{ width: 26, height: 26 }}
                onClick={() => removeOpt(idx)}
                aria-label="Remove option"
              >
                <Icons.X size={12} />
              </button>
            )}
          </div>
        ))}
        {options.length < 6 && (
          <button
            className="or-chip w-full justify-center"
            onClick={addOpt}
            data-testid={`polls-add-option-${w.id}`}
          >
            <Icons.Plus size={12} /> Add option
          </button>
        )}
      </div>
    );
  }

  // ── PUBLIC VIEW: vote-or-results UI ──
  if (!question || options.length < 2) {
    return (
      <div className="text-xs italic" style={{ color: "var(--text-muted)" }} data-testid={`polls-empty-${w.id}`}>
        No poll yet.
      </div>
    );
  }
  const total = state?.total_votes || 0;
  const handleVote = async (option_id) => {
    if (!viewer) return; // guests can't vote
    try {
      const { data } = await apiClient.post(
        `/profile-poll/${ownerUsername}/${w.id}/vote`,
        { option_id }
      );
      setState(data);
    } catch { /* */ }
  };
  return (
    <div className="space-y-2 h-full overflow-y-auto" data-testid={`polls-body-${w.id}`}>
      <div className="text-xs font-semibold" style={{ color: "var(--text-main)" }}>{question}</div>
      {(state?.options || options).map((opt) => {
        const votes = opt.votes ?? 0;
        const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
        return (
          <button
            key={opt.id}
            onClick={() => handleVote(opt.id)}
            disabled={!viewer}
            className="w-full text-left relative overflow-hidden"
            style={{ background: "var(--surface-2)", borderRadius: 6, padding: "6px 8px" }}
            data-testid={`polls-vote-${w.id}-${opt.id}`}
          >
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${pct}%`, background: "color-mix(in srgb, var(--primary) 22%, transparent)" }}
            />
            <div className="relative flex justify-between text-xs" style={{ color: "var(--text-main)" }}>
              <span className="truncate">{opt.text}</span>
              {total > 0 && <span>{pct}%</span>}
            </div>
          </button>
        );
      })}
      {total > 0 && (
        <div className="text-[10px] text-right" style={{ color: "var(--text-muted)" }}>
          {total} vote{total === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// RADAR — purely cosmetic. The keyframe animation lives in index.css.
// ─────────────────────────────────────────────────────────────────────
export function RadarBody({ w }) {
  return (
    <div className="flex items-center justify-center h-full" data-testid={`radar-body-${w.id}`}>
      <div style={{ width: "85%" }}><div className="radar-disc" /></div>
    </div>
  );
}
