/**
 * TrendingHashtagsPage — dedicated `/hashtags` screen.
 *
 * Shows the top-20 hashtags as a ranked, neon-styled list. Each row
 * navigates to the existing hashtag feed page. Backed by the public
 * `/api/hashtags/top` endpoint (filters out tags whose post_count
 * has drifted to zero so we never link to an empty feed).
 */
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Flame, Hash, TrendingUp, Loader2 } from "lucide-react";
import apiClient from "@/api/client";

function compactCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000) {
    const k = v / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(v);
}

export default function TrendingHashtagsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/hashtags/top", {
          params: { window: "30d", limit: 20 },
        });
        if (!cancelled) setItems(data?.hashtags || []);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.detail || "Failed to load trending hashtags");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-3xl mx-auto" data-testid="trending-hashtags-page">
      {/* Header — back arrow + flame + title + subtitle + status pill */}
      <div className="flex items-center gap-3 mb-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="or-chip"
          aria-label="Back"
          data-testid="trending-hashtags-page-back"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-2">
          <Flame size={22} style={{ color: "var(--primary)" }} />
          <h1
            className="text-2xl sm:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
            data-testid="trending-hashtags-page-title"
          >
            Trending Hashtags
          </h1>
        </div>
      </div>
      <p
        className="text-sm mb-3"
        style={{ color: "var(--text-muted)" }}
        data-testid="trending-hashtags-page-subtitle"
      >
        Top hashtags right now in OurRealm
      </p>
      <div
        className="or-chip inline-flex items-center gap-1.5 mb-5"
        data-testid="trending-hashtags-page-status"
        style={{
          borderColor: "color-mix(in srgb, var(--brand-green) 60%, transparent)",
          color: "var(--brand-green)",
        }}
      >
        <TrendingUp size={12} />
        <span className="text-[11px] uppercase tracking-widest">
          Real-time rankings · Updates constantly
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-10" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={20} className="inline animate-spin" />
        </div>
      ) : err ? (
        <div className="or-surface p-6 text-center" data-testid="trending-hashtags-page-error">
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>{err}</div>
        </div>
      ) : items.length === 0 ? (
        <div className="or-surface p-8 text-center" data-testid="trending-hashtags-page-empty">
          <div className="text-base" style={{ color: "var(--text-main)" }}>No trending hashtags yet</div>
          <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Drop a post with a #tag — yours could be the first.
          </div>
        </div>
      ) : (
        <div className="space-y-2" data-testid="trending-hashtags-page-list">
          {items.map((h, idx) => (
            <Link
              key={h.tag}
              to={`/hashtags/${h.tag}`}
              className="or-surface p-3 flex items-center gap-3"
              data-testid={`trending-hashtags-page-row-${h.tag}`}
              title={`${h.usage_count} uses · last used ${h.last_used_at?.slice(0, 10) || ""}`}
            >
              <div
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: 36, height: 36,
                  borderRadius: 12,
                  background: "color-mix(in srgb, var(--primary) 14%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--primary) 45%, transparent)",
                  color: "var(--primary)",
                  fontWeight: 800,
                  fontFamily: "var(--font-display)",
                }}
              >
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-1">
                <Hash size={14} style={{ color: "var(--primary)" }} />
                <span
                  className="font-bold truncate"
                  style={{ color: "var(--text-main)" }}
                >
                  {h.tag}
                </span>
              </div>
              <div
                className="flex items-center gap-1.5 shrink-0"
                style={{ color: "var(--text-muted)" }}
              >
                {idx < 3 && (
                  <TrendingUp
                    size={14}
                    style={{ color: "var(--brand-green)" }}
                    aria-hidden="true"
                  />
                )}
                <span className="text-sm" data-testid={`trending-hashtags-page-row-${h.tag}-count`}>
                  {compactCount(h.usage_count)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
