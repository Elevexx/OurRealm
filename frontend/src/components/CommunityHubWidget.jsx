/**
 * CommunityHubWidget — realm-scoped activity feed (Phase 2 missed item).
 *
 * Members can post:
 *   • photo    — file picker → POST /api/images/upload → uses returned url
 *   • video    — file picker → POST /api/videos/upload → uses returned url
 *   • sound    — file picker → POST /api/sounds/upload → uses returned url
 *   • thought  — text-only
 *   • event    — title (text) + optional date (event_at)
 *
 * Storage / wiring routes through the dedicated hub endpoints under
 * /api/communities/realm/:id/widgets/:wid/hub/posts. Existing
 * upload/moderation pipelines are reused — this widget itself only
 * persists the resulting URL + text + kind.
 *
 * Admins and the post's own author can delete. Default view shows the
 * 12 most recent posts; scroll-tab if more arrive (no pagination in
 * this iteration).
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon, Video, Music2, MessageSquare, Calendar,
  Loader2, Send, X, Trash2, Plus, Sparkles,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const KINDS = [
  { id: "thought", label: "Thought", Icon: MessageSquare, needsMedia: false },
  { id: "photo",   label: "Photo",   Icon: ImageIcon,     needsMedia: true,  uploadPath: "/images/upload",  accept: "image/*" },
  { id: "video",   label: "Video",   Icon: Video,         needsMedia: true,  uploadPath: "/videos/upload",  accept: "video/*" },
  { id: "sound",   label: "Sound",   Icon: Music2,        needsMedia: true,  uploadPath: "/sounds/upload",  accept: "audio/*" },
  { id: "event",   label: "Event",   Icon: Calendar,      needsMedia: false, hasDate: true },
];

const KIND_META = Object.fromEntries(KINDS.map((k) => [k.id, k]));

export default function CommunityHubWidget({ realmId, widget, isAdmin, onDelete }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("thought");
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [eventAt, setEventAt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const meta = KIND_META[kind];

  // Load hub posts on mount / widget change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await apiClient.get(
          `/communities/realm/${realmId}/widgets/${widget.id}/hub/posts?limit=12`,
        );
        if (!cancelled) setPosts(data?.posts || []);
      } catch { /* */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [realmId, widget.id]);

  const resetComposer = () => { setText(""); setMediaUrl(""); setEventAt(""); setErr(""); };

  const onPickFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";  // allow re-picking the same file
    if (!f || !meta?.uploadPath) return;
    setUploading(true); setErr("");
    try {
      const form = new FormData();
      form.append("file", f);
      const { data } = await apiClient.post(meta.uploadPath, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      // Each upload route returns { url } (image/video) or { url, ... } (sound).
      const url = data?.url || data?.image_url || data?.video_url || data?.sound_url || "";
      if (!url) throw new Error("No URL returned");
      setMediaUrl(url);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); }
  };

  const submit = async () => {
    if (sending) return;
    setErr("");
    if (meta.needsMedia && !mediaUrl) { setErr(`Please attach a ${kind}`); return; }
    if (!meta.needsMedia && !text.trim()) { setErr(meta.hasDate ? "Event needs a title" : "Add a thought"); return; }
    setSending(true);
    try {
      const payload = { kind, text: text.trim(), media_url: mediaUrl || undefined };
      if (meta.hasDate && eventAt) payload.event_at = new Date(eventAt).toISOString();
      const { data } = await apiClient.post(
        `/communities/realm/${realmId}/widgets/${widget.id}/hub/posts`,
        payload,
      );
      setPosts((prev) => [data, ...prev]);
      resetComposer();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to post");
    } finally { setSending(false); }
  };

  const removePost = async (postId) => {
    try {
      await apiClient.delete(
        `/communities/realm/${realmId}/widgets/${widget.id}/hub/posts/${postId}`,
      );
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch { /* */ }
  };

  return (
    <section className="or-surface p-4 h-full flex flex-col" data-testid={`realm-hub-widget-${widget.id}`}>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} style={{ color: "var(--primary)" }} />
        <h3 className="text-base font-bold flex-1 truncate" style={{ fontFamily: "var(--font-display)" }} data-testid="realm-hub-title">
          {widget?.config?.title || "Community Hub"}
        </h3>
        {isAdmin && onDelete && (
          <button onClick={() => { if (window.confirm("Delete this Community Hub widget?")) onDelete(widget.id); }} className="or-chip" data-testid={`realm-hub-delete-${widget.id}`} style={{ color: "#FF8080" }} title="Delete widget">
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="mb-3 p-3" style={{ background: "var(--surface-2)", borderRadius: "var(--radius)", border: "1px solid var(--border-col)" }} data-testid="realm-hub-composer">
        <div className="flex gap-1.5 flex-wrap mb-2" role="tablist" aria-label="Post type">
          {KINDS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => { setKind(id); setMediaUrl(""); setEventAt(""); setErr(""); }}
              className="or-chip"
              data-active={kind === id}
              data-testid={`realm-hub-kind-${id}`}
              role="tab"
              aria-selected={kind === id}
              type="button"
            >
              <Icon size={11} /> {label}
            </button>
          ))}
        </div>

        {meta.needsMedia && (
          <div className="mb-2">
            <input ref={fileRef} type="file" accept={meta.accept} onChange={onPickFile} style={{ display: "none" }} data-testid="realm-hub-file-input" />
            {mediaUrl ? (
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }} data-testid="realm-hub-media-preview">
                {kind === "photo" && <img src={mediaUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}
                {kind === "video" && <Video size={20} style={{ color: "var(--primary)" }} />}
                {kind === "sound" && <Music2 size={20} style={{ color: "var(--primary)" }} />}
                <span className="flex-1 truncate">{mediaUrl.split("/").pop()}</span>
                <button onClick={() => setMediaUrl("")} className="or-chip" data-testid="realm-hub-media-clear" type="button" title="Remove media"><X size={11} /></button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="or-chip"
                data-testid="realm-hub-upload-btn"
                type="button"
              >
                {uploading ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Attach {kind}
              </button>
            )}
          </div>
        )}

        {meta.hasDate && (
          <input
            type="datetime-local"
            value={eventAt}
            onChange={(e) => setEventAt(e.target.value)}
            className="or-input mb-2 text-sm"
            data-testid="realm-hub-event-date"
          />
        )}

        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            kind === "thought" ? "Share a thought with the realm…" :
            kind === "event"   ? "Event title (e.g. Friday DJ Set)" :
                                 "Say something about this (optional)"
          }
          maxLength={1200}
          className="or-input w-full resize-none text-sm"
          data-testid="realm-hub-text"
        />

        {err && <div className="text-xs mt-1.5" style={{ color: "#FF8080" }} data-testid="realm-hub-error">{err}</div>}

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{text.length}/1200</span>
          <button
            onClick={submit}
            disabled={sending || uploading}
            className="or-btn"
            data-testid="realm-hub-submit"
            type="button"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Post to realm
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1" data-testid="realm-hub-feed" style={{ maxHeight: 360 }}>
        {loading ? (
          <div className="text-center py-6" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="inline animate-spin" /></div>
        ) : posts.length === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: "var(--text-muted)" }}>
            <Sparkles size={18} className="inline mb-1" /><br />
            Be the first to share something with the realm.
          </div>
        ) : posts.map((p) => (
          <HubPost
            key={p.id}
            post={p}
            canDelete={isAdmin || p.author_id === user?.id}
            onDelete={() => removePost(p.id)}
          />
        ))}
      </div>
    </section>
  );
}

function HubPost({ post, canDelete, onDelete }) {
  const KindIcon = (KIND_META[post.kind] || {}).Icon || MessageSquare;
  const created = post.created_at ? new Date(post.created_at) : null;
  return (
    <article
      className="p-2.5 flex gap-2.5"
      style={{ background: "var(--surface-2)", borderRadius: "calc(var(--radius) - 4px)", border: "1px solid var(--border-col)" }}
      data-testid={`realm-hub-post-${post.id}`}
    >
      <img
        src={post.author?.avatar_url || "/avatar-placeholder.svg"}
        alt=""
        style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-bold" style={{ color: "var(--text-main)" }}>@{post.author?.username || "unknown"}</span>
          <span className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: "var(--primary)" }}>
            <KindIcon size={10} /> {post.kind}
          </span>
          {created && (
            <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
              {created.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="or-chip"
              data-testid={`realm-hub-post-delete-${post.id}`}
              style={{ padding: "2px 5px", color: "#FF8080" }}
              type="button"
              title="Delete post"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>

        {post.kind === "photo" && post.media_url && (
          <img
            src={post.media_url}
            alt=""
            className="mt-1 max-h-48 w-full object-cover"
            style={{ borderRadius: 6 }}
            loading="lazy"
          />
        )}
        {post.kind === "video" && post.media_url && (
          <video controls preload="metadata" src={post.media_url} className="mt-1 max-h-48 w-full" style={{ borderRadius: 6 }} />
        )}
        {post.kind === "sound" && post.media_url && (
          <audio controls preload="metadata" src={post.media_url} className="mt-1 w-full" />
        )}
        {post.kind === "event" && post.event_at && (
          <div className="mt-1 text-xs flex items-center gap-1.5" style={{ color: "var(--primary)" }}>
            <Calendar size={11} /> {new Date(post.event_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
        {post.text && (
          <p className="text-sm whitespace-pre-wrap mt-1 or-wrap" style={{ color: "var(--text-main)" }}>{post.text}</p>
        )}
      </div>
    </article>
  );
}
