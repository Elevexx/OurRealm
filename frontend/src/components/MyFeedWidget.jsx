import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, MoreHorizontal, Heart, MessageCircle } from "lucide-react";
import apiClient from "@/api/client";
import { openPostPopup } from "@/lib/postPopupController";
import { usePostState } from "@/lib/postStore";

/**
 * MyFeedWidget — renders the owner's posts newest-first.
 * Reused on Profile.jsx and FounderProfile.jsx widget grids.
 * `username` is required so it can fetch the right user's posts.
 */
function timeAgo(iso) {
  try {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  } catch { return ""; }
}

export default function MyFeedWidget({ username, isOwner = false, dense = false }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await apiClient.get(`/posts/feed/by-user/${username}`);
        if (!cancelled) setPosts(data.posts || []);
      } catch { if (!cancelled) setPosts([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [username]);

  return (
    <div className="flex flex-col h-full or-min0" data-testid="myfeed-widget">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles size={14} style={{ color: "var(--primary)" }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--primary)" }}>
          My Feed
        </span>
        <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>{posts.length} posts</span>
      </div>

      {loading ? (
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Loading…</div>
      ) : posts.length === 0 ? (
        <div className="text-[11px] flex-1 flex flex-col items-center justify-center text-center gap-2" style={{ color: "var(--text-muted)" }}>
          <span>No posts yet</span>
          {isOwner && (
            <button
              onClick={(e) => { e.stopPropagation(); navigate("/feed"); }}
              className="or-chip"
              data-testid="myfeed-create-cta"
            >
              + Share your first post
            </button>
          )}
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto space-y-2 no-scrollbar" data-testid="myfeed-list">
          {posts.map((p) => (
            <MyFeedRow key={p.id} p={p} dense={dense} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MyFeedRow({ p, dense }) {
  const live = usePostState(p.id, { likes: p.likes || 0, comments: p.comments || 0, liked: !!p.viewer_liked });
  return (
    <li
      className="or-surface p-2 cursor-pointer"
      style={{ background: "var(--surface-2)" }}
      data-testid={`myfeed-post-${p.id}`}
      onClick={() => openPostPopup(p)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPostPopup(p); } }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] leading-snug or-wrap" style={{ color: "var(--text-main)" }}>
            {p.content}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
            <span>{p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}</span>
            <span>·</span>
            <span className="uppercase">{p.media_type}</span>
            {p.audience?.visibility && p.audience.visibility !== "public" && (
              <span className="px-1 rounded" style={{ background: "var(--border-col)", color: "var(--text-muted)" }}>
                {p.audience.visibility}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Heart size={10} fill={live.liked ? "#FF3F5A" : "none"} style={{ color: live.liked ? "#FF3F5A" : undefined }} /> {live.likes}
              <MessageCircle size={10} /> {live.comments}
            </span>
          </div>
        </div>
        {!dense && <MoreHorizontal size={12} style={{ color: "var(--text-muted)" }} />}
      </div>
    </li>
  );
}
