/**
 * SharedPostCard — small inline preview rendered for `post_share` DMs.
 *
 * Fetches the live post (single source of truth) and renders a tappable
 * card that, on click, opens the canonical PostPopup. Likes / comments
 * mutate the same post document, so engagement stays consistent
 * everywhere the post appears.
 *
 * If the post has been deleted or the viewer cannot see it, we render a
 * friendly placeholder rather than failing.
 */
import React, { useEffect, useState } from "react";
import { Heart, MessageCircle, Play, Loader2, ImageOff } from "lucide-react";
import apiClient from "@/api/client";
import { openPostPopup } from "@/lib/postPopupController";
import { absoluteImageUrl } from "@/components/ImageUploadPicker";
import { classifyVideoUrl } from "@/components/VideoEmbed";

export default function SharedPostCard({ postId, testid = "shared-post-card" }) {
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    apiClient.get(`/posts/${postId}`)
      .then((r) => { if (!cancelled) setPost(r.data?.post || null); })
      .catch((e) => { if (!cancelled) setError(e?.response?.status === 404 ? "deleted" : "hidden"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [postId]);

  if (loading) {
    return (
      <div
        className="or-surface flex items-center gap-2 p-2.5 mt-1.5 max-w-[18rem]"
        style={{ background: "var(--surface-2)" }}
        data-testid={`${testid}-loading`}
      >
        <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Loading post…</span>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div
        className="or-surface flex items-center gap-2 p-2.5 mt-1.5 max-w-[18rem]"
        style={{ background: "var(--surface-2)" }}
        data-testid={`${testid}-unavailable`}
      >
        <ImageOff size={14} style={{ color: "var(--text-muted)" }} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {error === "deleted" ? "This post is no longer available." : "You can't view this post."}
        </span>
      </div>
    );
  }

  const img = post.image_url || (post.media_type === "image" ? post.media_url : null);
  const vidRaw = post.video_url || (post.media_type === "video" ? post.media_url : null);
  const vidInfo = vidRaw ? classifyVideoUrl(vidRaw) : null;
  const isVideo = vidInfo && vidInfo.kind !== "none";

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openPostPopup(post); }}
      className="or-surface text-left mt-1.5 w-full sm:max-w-sm overflow-hidden"
      style={{
        background: "var(--surface-2)",
        cursor: "pointer",
        border: "1px solid var(--border-col)",
        borderRadius: "var(--radius)",
        padding: 0,
        color: "var(--text-main)",
      }}
      data-testid={`${testid}-${post.id}`}
      aria-label="Open shared post"
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <img
          src={absoluteImageUrl(post.author_avatar) || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(post.author_name || "u")}`}
          alt=""
          className="rounded-full object-cover shrink-0"
          style={{ width: 22, height: 22 }}
        />
        <span className="text-[11px] font-semibold truncate" style={{ color: "var(--text-main)" }}>
          @{post.author_username || post.author_name}
        </span>
        <span className="text-[10px] uppercase tracking-widest ml-auto" style={{ color: "var(--text-muted)" }}>
          {post.media_type || "post"}
        </span>
      </div>

      {post.content && (
        <div
          className="px-3 text-xs whitespace-pre-wrap break-words"
          style={{ color: "var(--text-main)", maxHeight: 60, overflow: "hidden" }}
        >
          {post.content}
        </div>
      )}

      {img && (
        <div className="px-3 pt-2">
          <img
            src={absoluteImageUrl(img)}
            alt=""
            loading="lazy"
            className="w-full object-cover rounded"
            style={{ maxHeight: 160 }}
          />
        </div>
      )}

      {isVideo && !img && (
        <div
          className="mx-3 mt-2 rounded flex items-center justify-center"
          style={{
            position: "relative",
            paddingTop: "56.25%",
            background: "#000",
          }}
        >
          <span
            className="rounded-full flex items-center justify-center"
            style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: 44, height: 44,
              background: "rgba(0,0,0,0.55)", color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            <Play size={18} />
          </span>
        </div>
      )}

      <div
        className="flex items-center gap-3 px-3 py-2 mt-1.5 text-[11px]"
        style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-col)" }}
      >
        <span className="flex items-center gap-1"><Heart size={11} /> {post.likes || 0}</span>
        <span className="flex items-center gap-1"><MessageCircle size={11} /> {post.comments || 0}</span>
        <span className="ml-auto" style={{ color: "var(--primary)" }}>Tap to open →</span>
      </div>
    </button>
  );
}
