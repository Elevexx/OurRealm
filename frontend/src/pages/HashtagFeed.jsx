/**
 * Hashtag feed page — `/hashtag/:tag`.
 *
 * Reuses the same look as the For You feed but pulls from
 * `/api/hashtags/:tag/feed`. Falls back to a friendly empty state for
 * unknown tags (still clickable per spec).
 */
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Hash, Loader2, ArrowLeft } from "lucide-react";
import apiClient from "@/api/client";
import HashtagText from "@/components/HashtagText";
import UserAvatar from "@/components/UserAvatar";

function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export default function HashtagFeed() {
  const { tag } = useParams();
  const t = (tag || "").toLowerCase();
  const [data, setData] = useState({ posts: [], total: 0, tag: t });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: d } = await apiClient.get(`/hashtags/${encodeURIComponent(t)}/feed?limit=50`);
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setData({ posts: [], total: 0, tag: t });
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [t]);

  return (
    <div className="max-w-3xl mx-auto" data-testid="hashtag-feed-page">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/feed" className="or-chip" data-testid="hashtag-feed-back"><ArrowLeft size={14} /> Feed</Link>
        <div className="flex items-center gap-2">
          <Hash size={22} style={{ color: "var(--primary)" }} />
          <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }} data-testid="hashtag-feed-title">#{t}</h1>
        </div>
        <div className="ml-auto text-xs" style={{ color: "var(--text-muted)" }} data-testid="hashtag-feed-count">
          {data.total} {data.total === 1 ? "post" : "posts"}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10" style={{ color: "var(--text-muted)" }}><Loader2 size={20} className="inline animate-spin" /></div>
      ) : data.posts.length === 0 ? (
        <div className="or-surface p-8 text-center" data-testid="hashtag-feed-empty">
          <div className="text-base" style={{ color: "var(--text-main)" }}>No posts yet for #{t}</div>
          <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Be the first — use the hashtag in your next post.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {data.posts.map((p) => (
            <article key={p.id} className="or-surface p-4" data-testid={`hashtag-feed-post-${p.id}`}>
              <header className="flex items-center gap-3 mb-2">
                <UserAvatar
                  user={{ id: p.author_id, username: p.author_username, name: p.author_name, avatar_url: p.author_avatar }}
                  size={36}
                />
                <div className="flex-1 min-w-0">
                  <Link to={`/public/${p.author_username}`} className="font-semibold truncate block" style={{ color: "var(--text-main)" }}>
                    @{p.author_username}
                  </Link>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {timeAgo(p.created_at)} · {p.media_type}
                  </div>
                </div>
              </header>
              <div className="text-sm whitespace-pre-wrap break-words" style={{ color: "var(--text-main)" }}>
                <HashtagText text={p.content} testid={`hashtag-feed-post-${p.id}-content`} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
