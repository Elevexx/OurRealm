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
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { resolveMediaUrl as mediaUrl } from "@/lib/mediaUrl";

const DEFAULT_NOTES_TEXT = '"Discover should feel inevitable, not optional."\n— shipping log';
const DEFAULT_BLOG_TEXT = "Write your first blog post here…";

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
// ─────────────────────────────────────────────────────────────────────
export function VideosBody({ w, editing, isOwner, ownerUsername, onUpdate }) {
  const items = Array.isArray(w.items) ? w.items.slice(0, 4) : [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef(null);

  const removeAt = (idx) => {
    const next = items.slice();
    next.splice(idx, 1);
    onUpdate?.(w.id, { items: next });
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
      if (url) {
        onUpdate?.(w.id, {
          items: [...items, { kind: "upload", url, video_id }],
        });
      }
    } catch (err) { console.error("video upload failed", err); }
    finally { setUploading(false); }
  };

  return (
    <div className="grid grid-cols-2 gap-2 h-full" data-testid={`videos-body-${w.id}`}>
      {items.map((it, idx) => (
        <div
          key={`${it.video_id || it.post_id || idx}`}
          className="relative overflow-hidden"
          style={{ borderRadius: 8, background: "var(--surface-2)", minHeight: 80 }}
          data-testid={`videos-item-${w.id}-${idx}`}
        >
          <video
            src={mediaUrl(it.url)}
            className="w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
          {!editing && (
            <Icons.PlayCircle
              size={26}
              className="absolute inset-0 m-auto pointer-events-none"
              style={{ color: "#fff", opacity: 0.9 }}
            />
          )}
          {editing && isOwner && (
            <button
              className="absolute top-1 right-1 rounded-full p-1"
              style={{ background: "rgba(0,0,0,0.7)" }}
              onClick={(e) => { e.stopPropagation(); removeAt(idx); }}
              data-testid={`videos-delete-${w.id}-${idx}`}
              aria-label="Remove video"
            >
              <Icons.X size={12} style={{ color: "#fff" }} />
            </button>
          )}
        </div>
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
  return (
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
    </div>
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
  return (
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
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            You don't have any {category.toLowerCase()} sounds yet. Upload one from /sounds first.
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
    </div>
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
