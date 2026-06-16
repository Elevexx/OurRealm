/**
 * Global Post Popup — mounted once at the App root. Listens to
 * postPopupController.registerPopupSetter to know when to open / close.
 *
 * Renders the full post (text + image/video/link previews), the live
 * likes/comments counters from postStore, the comment list, and a
 * composer with the 178-char limit + emoji support. Every action routes
 * through postStore so other surfaces (Feed, My Feed widget) update.
 */
import React, { useEffect, useState, useCallback } from "react";
import { X, Heart, MessageCircle, Send, Loader2, Link2, Video as VideoIcon } from "lucide-react";
import apiClient from "@/api/client";
import { registerPopupSetter } from "@/lib/postPopupController";
import { setPost, seedPost, usePostState } from "@/lib/postStore";
import UsernameLink from "@/components/UsernameLink";

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function isVideoUrl(u) {
  if (!u) return false;
  return /\.(mp4|webm|ogg)$/i.test(u);
}

export default function PostPopup() {
  const [state, setState] = useState(null); // { post, postId }
  const [post, setPostData] = useState(null);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const live = usePostState(post?.id, {
    liked: !!post?.viewer_liked,
    likes: post?.likes,
    comments: post?.comments,
  });

  useEffect(() => registerPopupSetter(setState), []);

  // Fetch fresh data whenever popup opens (and seed/refresh the store).
  useEffect(() => {
    let cancelled = false;
    if (!state?.postId) { setPostData(null); setComments([]); return; }
    setLoading(true);
    (async () => {
      try {
        const fetchPost = state.post
          ? Promise.resolve({ data: { post: state.post } })
          : apiClient.get(`/posts/${state.postId}`);
        const [p, c] = await Promise.all([
          fetchPost,
          apiClient.get(`/posts/${state.postId}/comments`),
        ]);
        if (cancelled) return;
        const pd = p.data.post;
        setPostData(pd);
        setComments(c.data.comments || []);
        seedPost(pd.id, {
          liked: !!pd.viewer_liked,
          likes: pd.likes ?? 0,
          comments: pd.comments ?? (c.data.comments?.length || 0),
        });
      } catch (e) {
        // Still seed from the state.post fallback so the popup can render.
        if (state.post) setPostData(state.post);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [state?.postId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => setState(null), []);

  // Esc to close + scroll lock while open
  useEffect(() => {
    if (!state) return undefined;
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [state, close]);

  const onLike = async () => {
    if (!post?.id) return;
    // Optimistic toggle.
    const willLike = !live.liked;
    setPost(post.id, { liked: willLike, likes: Math.max(0, live.likes + (willLike ? 1 : -1)) });
    try {
      const { data } = await apiClient.post(`/posts/${post.id}/like`);
      setPost(post.id, { liked: !!data.liked, likes: data.likes ?? 0 });
    } catch {
      // Rollback
      setPost(post.id, { liked: !willLike, likes: Math.max(0, live.likes) });
    }
  };

  const onSubmitComment = async (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !post?.id) return;
    if (text.length > 178) return;
    setPosting(true);
    try {
      const { data } = await apiClient.post(`/posts/${post.id}/comment`, { text });
      setComments((arr) => [...arr, data.comment]);
      setPost(post.id, { comments: data.comments ?? (live.comments + 1) });
      setDraft("");
    } catch (err) {
      // Surface very short error; otherwise no-op.
      const msg = err?.response?.data?.detail || "Could not post comment";
      alert(msg);
    } finally {
      setPosting(false);
    }
  };

  if (!state) return null;

  const mediaImg = post?.image_url || (post?.media_type === "image" ? post?.media_url : null);
  const mediaVid = post?.video_url || (post?.media_type === "video" ? post?.media_url : null);
  const mediaLink = post?.link_url || (post?.media_type === "link" ? post?.media_url : null);
  const remaining = 178 - draft.length;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center px-2 sm:px-4 py-4 sm:py-10"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
      onClick={close}
      data-testid="post-popup-overlay"
    >
      <div
        className="or-surface w-full sm:max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="post-popup"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 p-3 sm:p-4" style={{ borderBottom: "1px solid var(--border-col)" }}>
          {post?.author_avatar && (
            <img src={post.author_avatar} alt="" className="rounded-full object-cover" style={{ width: 36, height: 36 }} />
          )}
          <div className="flex-1 min-w-0">
            {post?.author_username ? (
              <UsernameLink
                username={post.author_username}
                className="font-semibold truncate"
                style={{ color: "var(--text-main)" }}
                testid="post-popup-author"
              />
            ) : (
              <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>@{post?.author_name || "user"}</div>
            )}
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {fmtTime(post?.created_at)} · {post?.media_type || "thought"}
            </div>
          </div>
          <button onClick={close} className="starbar-icon" style={{ width: 36, height: 36 }} aria-label="Close" data-testid="post-popup-close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {loading && !post ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {post?.content && (
                <p className="whitespace-pre-wrap text-sm sm:text-base" style={{ color: "var(--text-main)" }} data-testid="post-popup-content">
                  {post.content}
                </p>
              )}
              {mediaImg && (
                <img src={mediaImg} alt="" className="rounded w-full object-cover" style={{ maxHeight: 480, border: "1px solid var(--border-col)" }} data-testid="post-popup-image" />
              )}
              {mediaVid && (
                isVideoUrl(mediaVid) ? (
                  <video src={mediaVid} controls className="rounded w-full" style={{ maxHeight: 480, border: "1px solid var(--border-col)" }} data-testid="post-popup-video" />
                ) : (
                  <a href={mediaVid} target="_blank" rel="noreferrer" className="or-chip text-sm" data-testid="post-popup-video-link">
                    <VideoIcon size={14} /> Watch video
                  </a>
                )
              )}
              {mediaLink && (
                <a href={mediaLink} target="_blank" rel="noreferrer" className="or-chip text-sm break-all" data-testid="post-popup-link">
                  <Link2 size={14} /> {mediaLink}
                </a>
              )}

              <div className="flex items-center gap-4 text-sm pt-1" style={{ color: "var(--text-muted)" }}>
                <button
                  onClick={onLike}
                  className="flex items-center gap-1.5"
                  data-testid="post-popup-like"
                  style={{ background: "transparent", padding: 0, color: live.liked ? "#FF3F5A" : "var(--text-muted)" }}
                  aria-pressed={live.liked}
                >
                  <Heart size={16} fill={live.liked ? "#FF3F5A" : "none"} /> <span data-testid="post-popup-like-count">{live.likes}</span>
                </button>
                <div className="flex items-center gap-1.5" data-testid="post-popup-comment-count">
                  <MessageCircle size={16} /> {live.comments}
                </div>
              </div>

              <div className="pt-3 mt-1 space-y-3" style={{ borderTop: "1px solid var(--border-col)" }} data-testid="post-popup-comments">
                {comments.length === 0 && !loading && (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Be the first to comment.</div>
                )}
                {comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5" data-testid={`post-popup-comment-${c.id}`}>
                    <img
                      src={c.author_avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.author_name || c.author_username || "u")}`}
                      alt=""
                      className="rounded-full object-cover shrink-0"
                      style={{ width: 30, height: 30 }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs">
                        {c.author_username ? (
                          <UsernameLink username={c.author_username} className="font-semibold" style={{ color: "var(--text-main)" }} />
                        ) : (
                          <span className="font-semibold" style={{ color: "var(--text-main)" }}>@{c.author_name}</span>
                        )}
                        <span className="ml-2" style={{ color: "var(--text-muted)" }}>{fmtTime(c.created_at)}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words" style={{ color: "var(--text-main)" }}>{c.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <form onSubmit={onSubmitComment} className="p-3 sm:p-4 flex items-center gap-2" style={{ borderTop: "1px solid var(--border-col)" }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 178))}
            placeholder="Add a comment… emojis welcome 🎉"
            maxLength={178}
            className="or-input flex-1"
            data-testid="post-popup-comment-input"
            autoComplete="off"
          />
          <span
            className="text-[11px] tabular-nums"
            style={{ color: remaining < 20 ? "#FF3F5A" : "var(--text-muted)" }}
            data-testid="post-popup-comment-remaining"
          >
            {remaining}
          </span>
          <button
            type="submit"
            disabled={!draft.trim() || posting}
            className="or-btn"
            style={{ padding: "0.5rem 0.75rem" }}
            data-testid="post-popup-comment-submit"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
