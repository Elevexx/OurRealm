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
import { X, Heart, MessageCircle, Send, Loader2, Link2, Video as VideoIcon, Reply, Flag } from "lucide-react";
import apiClient from "@/api/client";
import { registerPopupSetter } from "@/lib/postPopupController";
import { setPost, getPost, usePostState } from "@/lib/postStore";
import { useAuth } from "@/contexts/AuthContext";
import UsernameLink from "@/components/UsernameLink";
import { absoluteImageUrl } from "@/components/ImageUploadPicker";
import AutoplayVideo from "@/components/AutoplayVideo";
import ReportButton from "@/components/ReportButton";

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

/**
 * Single comment row + nested replies + (lazy) reply composer.
 * Replies are themselves likeable + reportable but use `target_type='reply'`
 * so admin tooling can distinguish them from top-level comments.
 */
function CommentRow({
  comment, me,
  onLike, onLikeReply,
  isReplying, onToggleReply,
  replyDraft, setReplyDraft, onSubmitReply, posting,
}) {
  const isOwn = me?.id && comment.author_id === me.id;
  const replyRemaining = 178 - replyDraft.length;
  return (
    <div data-testid={`post-popup-comment-${comment.id}`}>
      <CommentBody c={comment} isOwn={isOwn} onLike={onLike} onToggleReply={onToggleReply} targetType="comment" />

      {/* Replies (one level only) */}
      {(comment.replies || []).length > 0 && (
        <div className="mt-2 ml-9 space-y-2.5" data-testid={`post-popup-replies-${comment.id}`}>
          {comment.replies.map((r) => (
            <div key={r.id} data-testid={`post-popup-reply-${r.id}`}>
              <CommentBody
                c={r}
                isOwn={me?.id && r.author_id === me.id}
                onLike={() => onLikeReply(r.id)}
                targetType="reply"
                compact
              />
            </div>
          ))}
        </div>
      )}

      {isReplying && (
        <form
          onSubmit={onSubmitReply}
          className="mt-2 ml-9 flex items-center gap-2"
          data-testid={`post-popup-reply-form-${comment.id}`}
        >
          <input
            type="text"
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value.slice(0, 178))}
            placeholder={`Reply to @${comment.author_username || "user"}…`}
            maxLength={178}
            className="or-input flex-1"
            autoFocus
            data-testid={`post-popup-reply-input-${comment.id}`}
          />
          <span
            className="text-[11px] tabular-nums"
            style={{ color: replyRemaining < 20 ? "#FF3F5A" : "var(--text-muted)" }}
          >{replyRemaining}</span>
          <button
            type="submit"
            disabled={!replyDraft.trim() || posting}
            className="or-btn"
            style={{ padding: "0.4rem 0.6rem" }}
            data-testid={`post-popup-reply-submit-${comment.id}`}
          >
            <Send size={12} />
          </button>
        </form>
      )}
    </div>
  );
}

function CommentBody({ c, isOwn, onLike, onToggleReply, targetType, compact = false }) {
  return (
    <div className="flex items-start gap-2.5">
      <img
        src={c.author_avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.author_name || c.author_username || "u")}`}
        alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: compact ? 24 : 30, height: compact ? 24 : 30 }}
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
        <div className="flex items-center gap-3 mt-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <button
            type="button"
            onClick={onLike}
            className="flex items-center gap-1"
            style={{ background: "transparent", padding: 0, color: c.liked ? "#FF3F5A" : "var(--text-muted)" }}
            data-testid={`post-popup-${targetType}-like-${c.id}`}
            aria-pressed={!!c.liked}
            title={c.liked ? "Unlike" : "Like"}
          >
            <Heart size={12} fill={c.liked ? "#FF3F5A" : "none"} />
            <span data-testid={`post-popup-${targetType}-like-count-${c.id}`}>{c.likes || 0}</span>
          </button>
          {onToggleReply && (
            <button
              type="button"
              onClick={onToggleReply}
              className="flex items-center gap-1"
              style={{ background: "transparent", padding: 0, color: "var(--text-muted)" }}
              data-testid={`post-popup-comment-reply-${c.id}`}
              title="Reply"
            >
              <Reply size={12} /> Reply
            </button>
          )}
          {!isOwn && (
            <ReportButton
              targetType={targetType}
              targetId={c.id}
              variant="icon"
              testid={`post-popup-${targetType}-report-${c.id}`}
              className="flex items-center"
              style={{ background: "transparent", padding: 0, color: "var(--text-muted)", width: "auto", height: "auto" }}
              title={`Report ${targetType}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function PostPopup() {
  const [state, setState] = useState(null); // { post, postId }
  const [post, setPostData] = useState(null);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({}); // {parentId: text}
  const [replyingTo, setReplyingTo] = useState(null); // parentId | null
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const { user } = useAuth();
  const viewerLiked = !!(user?.id && Array.isArray(post?.liked_by) && post.liked_by.includes(user.id));
  const live = usePostState(post?.id, {
    liked: viewerLiked,
    likes: post?.likes,
    comments: post?.comments,
  });

  useEffect(() => registerPopupSetter(setState), []);

  // When the server post arrives (after open) and the store hasn't been
  // touched by the user yet, sync `liked` from liked_by[]. This keeps the
  // popup heart honest after a full reload without clobbering an in-flight
  // optimistic toggle.
  useEffect(() => {
    if (!post?.id || !user?.id) return;
    const cur = getPost(post.id);
    if (cur && cur.liked === undefined) {
      setPost(post.id, { liked: viewerLiked });
    }
  }, [post?.id, user?.id, viewerLiked]);

  // Fetch fresh data whenever popup opens. We ALWAYS hit the server so the
  // post popup is the canonical source of truth — this prevents a stale
  // `state.post` snapshot (taken at feed-render time) from overwriting the
  // optimistic counts already in the postStore.
  useEffect(() => {
    let cancelled = false;
    if (!state?.postId) { setPostData(null); setComments([]); return; }
    // Optimistic local render from whatever caller passed (if any).
    if (state.post && !post) setPostData(state.post);
    setLoading(true);
    (async () => {
      try {
        const viewerQ = user?.username ? `?viewer=${encodeURIComponent(user.username)}` : "";
        const [p, c] = await Promise.all([
          apiClient.get(`/posts/${state.postId}`),
          apiClient.get(`/posts/${state.postId}/comments${viewerQ}`),
        ]);
        if (cancelled) return;
        const pd = p.data.post;
        setPostData(pd);
        setComments(c.data.comments || []);
        // Hydrate store from authoritative server response. setPost merges
        // so callers that already optimistically toggled `liked` keep their
        // per-viewer flag while the absolute counters are corrected.
        setPost(pd.id, {
          likes: pd.likes ?? 0,
          comments: pd.comments ?? (c.data.comments?.length || 0),
        });
      } catch (e) {
        // Network blip — keep the optimistic state.post snapshot.
        if (state.post && !cancelled) setPostData(state.post);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [state?.postId, user?.username]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  const onSubmitComment = async (e, parentId = null) => {
    e?.preventDefault?.();
    const text = (parentId ? (replyDrafts[parentId] || "") : draft).trim();
    if (!text || !post?.id) return;
    if (text.length > 178) return;
    setPosting(true);
    try {
      const { data } = await apiClient.post(`/posts/${post.id}/comment`, {
        text,
        ...(parentId ? { parent_id: parentId } : {}),
      });
      // The list endpoint groups replies under their parents — apply
      // the same shape client-side so the new row renders in place.
      setComments((arr) => {
        if (!parentId) return [...arr, { ...data.comment, replies: [] }];
        return arr.map((c) => c.id === parentId
          ? { ...c, replies: [...(c.replies || []), data.comment] }
          : c);
      });
      setPost(post.id, { comments: data.comments ?? (live.comments + 1) });
      if (parentId) {
        setReplyDrafts((d) => ({ ...d, [parentId]: "" }));
        setReplyingTo(null);
      } else {
        setDraft("");
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || "Could not post comment";
      alert(msg);
    } finally {
      setPosting(false);
    }
  };

  // Toggle like on a comment OR reply. Optimistic, with rollback on error.
  const onLikeComment = async (commentId, parentId = null) => {
    if (!post?.id || !commentId) return;
    const apply = (mutator) => setComments((arr) => arr.map((c) => {
      if (!parentId) {
        return c.id === commentId ? mutator(c) : c;
      }
      if (c.id !== parentId) return c;
      return { ...c, replies: (c.replies || []).map((r) => r.id === commentId ? mutator(r) : r) };
    }));
    const before = (() => {
      for (const c of comments) {
        if (c.id === commentId) return { liked: !!c.liked, likes: c.likes ?? 0 };
        for (const r of (c.replies || [])) {
          if (r.id === commentId) return { liked: !!r.liked, likes: r.likes ?? 0 };
        }
      }
      return { liked: false, likes: 0 };
    })();
    const willLike = !before.liked;
    apply((c) => ({ ...c, liked: willLike, likes: Math.max(0, (c.likes ?? 0) + (willLike ? 1 : -1)) }));
    try {
      const { data } = await apiClient.post(`/posts/${post.id}/comments/${commentId}/like`);
      apply((c) => ({ ...c, liked: !!data.liked, likes: data.likes ?? 0 }));
    } catch {
      apply((c) => ({ ...c, liked: before.liked, likes: before.likes }));
    }
  };

  if (!state) return null;

  const mediaImg = post?.image_url || (post?.media_type === "image" ? post?.media_url : null);
  const mediaVidRaw = post?.video_url || (post?.media_type === "video" ? post?.media_url : null);
  const mediaVid = mediaVidRaw ? absoluteImageUrl(mediaVidRaw) : null;
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
            <img src={absoluteImageUrl(post.author_avatar)} alt="" className="rounded-full object-cover" style={{ width: 36, height: 36 }} />
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
                <img src={absoluteImageUrl(mediaImg)} alt="" loading="lazy" decoding="async" className="rounded w-full object-cover" style={{ maxHeight: 480, border: "1px solid var(--border-col)" }} data-testid="post-popup-image" />
              )}
              {mediaVid && (
                isVideoUrl(mediaVid) ? (
                  <AutoplayVideo src={mediaVid} className="rounded w-full" style={{ maxHeight: 480, border: "1px solid var(--border-col)" }} testid="post-popup-video" />
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
                  <CommentRow
                    key={c.id}
                    comment={c}
                    me={user}
                    onLike={() => onLikeComment(c.id, null)}
                    onLikeReply={(rid) => onLikeComment(rid, c.id)}
                    isReplying={replyingTo === c.id}
                    onToggleReply={() => setReplyingTo(replyingTo === c.id ? null : c.id)}
                    replyDraft={replyDrafts[c.id] || ""}
                    setReplyDraft={(t) => setReplyDrafts((d) => ({ ...d, [c.id]: t }))}
                    onSubmitReply={(e) => onSubmitComment(e, c.id)}
                    posting={posting}
                  />
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
