/**
 * Trending Hashtags — collapsible widget on the For You feed.
 *
 * Sits between the Radius chips and the composer. Default state is
 * COLLAPSED (single compact row). One tap on the bar reveals the
 * top trending hashtags as a responsive grid of chips, plus a
 * "View all trending hashtags →" link at the bottom. Open/closed
 * preference persists for the current browser tab only via
 * sessionStorage; we do not write to localStorage so cross-tab and
 * cross-session feed surfaces remain untouched.
 *
 * Pulls from the same public `/api/hashtags/trending` endpoint as before.
 * Each chip routes to the existing `/hashtag/:tag` feed page so all
 * existing hashtag analytics / ranking / API surfaces remain unchanged.
 *
 * Layout: NO fixed / absolute / z-index — the expanded block reflows
 * the composer + feed below it naturally.
 */
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Flame, Hash, ChevronDown, TrendingUp } from "lucide-react";
import apiClient from "@/api/client";

const SESSION_KEY = "or.trendingHashtags.open";

function readInitialOpen() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch { return false; }
}

function compactCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000) {
    const k = v / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(v);
}

export default function TrendingHashtags() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(readInitialOpen);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/hashtags/trending", { params: { window: "7d", limit: 8 } });
        if (!cancelled) setItems(data?.hashtags || []);
      } catch { /* silent — widget just stays empty */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist open/closed per tab so collapsing while the user
  // scrolls the feed doesn't pop back open on the next render.
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, open ? "1" : "0"); } catch { /* noop */ }
  }, [open]);

  // Hide entirely when there are no trending tags so the feed
  // never shows an empty placeholder.
  if (!loaded || items.length === 0) return null;

  const topTag = items[0]?.tag;
  const onViewAll = (e) => {
    e.preventDefault();
    if (topTag) navigate(`/hashtag/${topTag}`);
  };

  return (
    <div className="my-4" data-testid="trending-hashtags">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="or-surface w-full px-3 py-2.5 flex items-center justify-between text-left"
        aria-expanded={open}
        aria-controls="trending-hashtags-panel"
        data-testid="trending-hashtags-toggle"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Flame size={14} style={{ color: "var(--primary)" }} />
          <span
            className="text-xs uppercase tracking-widest truncate"
            style={{ color: "var(--text-muted)" }}
          >
            Trending hashtags
          </span>
        </span>
        <ChevronDown
          size={16}
          style={{
            color: "var(--text-muted)",
            transition: "transform 220ms ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          data-testid="trending-hashtags-chevron"
        />
      </button>

      {/* Expanded panel — height + opacity transition; reflows
          everything below naturally (no absolute / fixed). */}
      <div
        id="trending-hashtags-panel"
        aria-hidden={!open}
        data-testid="trending-hashtags-panel"
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transition: "grid-template-rows 240ms ease, opacity 200ms ease",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div className="or-surface mt-2 p-3" style={{ background: "var(--surface-2)" }}>
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
              data-testid="trending-hashtags-grid"
            >
              {items.map((h, idx) => (
                <Link
                  key={h.tag}
                  to={`/hashtag/${h.tag}`}
                  className="or-chip"
                  data-testid={`trending-hashtag-${h.tag}`}
                  title={`${h.usage_count} uses · last used ${h.last_used_at?.slice(0, 10) || ""}`}
                  style={{ justifyContent: "space-between", gap: 6 }}
                  // Make sure tapping a chip doesn't bubble up and
                  // toggle the parent bar closed mid-tap.
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="flex items-center gap-1 min-w-0">
                    <Hash size={12} style={{ color: "var(--primary)" }} />
                    <span className="truncate">{h.tag}</span>
                  </span>
                  <span
                    className="flex items-center gap-1 shrink-0 text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {idx < 3 && <TrendingUp size={10} style={{ color: "var(--brand-green)" }} />}
                    {compactCount(h.usage_count)}
                  </span>
                </Link>
              ))}
            </div>

            <button
              type="button"
              onClick={onViewAll}
              className="or-chip w-full mt-3 justify-center"
              style={{ justifyContent: "center" }}
              data-testid="trending-hashtags-view-all"
            >
              View all trending hashtags →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
