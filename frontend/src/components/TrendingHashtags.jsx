/**
 * Trending Hashtags carousel — appears at the top of the For-You feed.
 * Pulls from the public `/api/hashtags/trending` endpoint (no auth).
 * Each chip routes to the existing `/hashtag/:tag` feed page.
 *
 * Renders nothing when there are zero trending tags, so the feed never
 * looks empty or padded.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Hash, ChevronRight } from "lucide-react";
import apiClient from "@/api/client";

export default function TrendingHashtags() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/hashtags/trending", { params: { window: "7d", limit: 8 } });
        if (!cancelled) setItems(data?.hashtags || []);
      } catch { /* silent — carousel just hides */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loaded || items.length === 0) return null;

  return (
    <div className="or-surface p-3 mb-3" data-testid="trending-hashtags">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Flame size={14} style={{ color: "var(--primary)" }} />
          <span className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Trending hashtags
          </span>
        </div>
        <Link
          to="/hashtag/trending"
          onClick={(e) => {
            // No dedicated "trending feed" route yet — first chip handles
            // navigation; this link is hidden when items is empty so it's
            // safe to leave inert here.
            e.preventDefault();
          }}
          className="text-[11px] flex items-center gap-0.5"
          style={{ color: "var(--text-muted)" }}
          tabIndex={-1}
          aria-hidden="true"
        >
          <span className="hidden sm:inline">last 7d</span>
        </Link>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" data-testid="trending-hashtags-rail">
        {items.map((h) => (
          <Link
            key={h.tag}
            to={`/hashtag/${h.tag}`}
            className="or-chip shrink-0"
            data-testid={`trending-hashtag-${h.tag}`}
            title={`${h.usage_count} uses · last used ${h.last_used_at?.slice(0, 10) || ""}`}
          >
            <Hash size={12} /> {h.tag}
            <span className="ml-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
              {h.usage_count}
            </span>
            <ChevronRight size={11} style={{ color: "var(--text-muted)" }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
