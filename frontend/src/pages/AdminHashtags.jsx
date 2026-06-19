/**
 * /admin/hashtags — founder/support-only catalogue of every hashtag used
 * across OurRealm.
 *
 * Surfaces:
 *   • search by prefix
 *   • sort by usage count or last-used
 *   • analytics summary (totals + fastest-growing) over 1d/7d/30d/all
 *   • inline category badge for tags that map to a "Pick Your Interests"
 *     card (so future promotions are obvious at a glance)
 *   • "Featured Interest Cards" row — promote hashtag → interest card,
 *     reorder, remove featured, view per-card analytics
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Hash, Search, Loader2, TrendingUp, BarChart3, Crown, ArrowLeft, RefreshCw,
  Star, ArrowUp, ArrowDown, Trash2, Check, Users, MessageCircle, Heart, Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const WINDOWS = [
  { id: "1d",  label: "Today" },
  { id: "7d",  label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

const SORTS = [
  { id: "usage",   label: "Top use" },
  { id: "recent",  label: "Recent" },
];

export default function AdminHashtags() {
  const { user } = useAuth();
  const allowed = user && ["stealth", "support"].includes((user.username || "").toLowerCase());

  const [q, setQ] = useState("");
  const [sort, setSort] = useState("usage");
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [windowKey, setWindowKey] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Featured Interest Cards (promoted hashtags).
  const [cards, setCards] = useState([]);
  const [cardAnalytics, setCardAnalytics] = useState({}); // label → metrics
  const [cardsLoading, setCardsLoading] = useState(false);
  const [busyTag, setBusyTag] = useState(""); // disables button while promoting

  const categorySet = useMemo(
    () => new Set((categories || []).map((c) => c.slug)),
    [categories],
  );
  const promotedSet = useMemo(
    () => new Set((cards || []).map((c) => c.label)),
    [cards],
  );

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const params = { sort, limit: 100 };
      if (q.trim()) params.q = q.trim();
      const [list, summary] = await Promise.all([
        apiClient.get("/hashtags", { params }),
        apiClient.get(`/hashtags/analytics/summary?window=${windowKey}`),
      ]);
      setItems(list.data.hashtags || []);
      setCategories(list.data.categories || []);
      setAnalytics(summary.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load hashtags");
    } finally { setLoading(false); }
  };

  const loadCards = async () => {
    setCardsLoading(true);
    try {
      const [pub, an] = await Promise.all([
        apiClient.get("/hashtags/interest-cards"),
        apiClient.get(`/hashtags/interest-cards/analytics?window=${windowKey}`),
      ]);
      setCards(pub.data.cards || []);
      const idx = {};
      (an.data.cards || []).forEach((c) => { idx[c.label] = c.metrics; });
      setCardAnalytics(idx);
    } catch (e) {
      // analytics is admin-only; keep cards if available
    } finally { setCardsLoading(false); }
  };

  useEffect(() => {
    if (!allowed) return;
    load();
    loadCards();
  }, [sort, windowKey, allowed]);

  const promote = async (tag) => {
    setBusyTag(tag); setErr("");
    try {
      await apiClient.post(`/hashtags/${encodeURIComponent(tag)}/promote-to-interest`);
      await loadCards();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to promote");
    } finally { setBusyTag(""); }
  };

  const move = async (label, dir) => {
    const i = cards.findIndex((c) => c.label === label);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cards.length) return;
    const reordered = [...cards];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    // Optimistic: update sort_order locally so the UI feels instant.
    setCards(reordered.map((c, idx) => ({ ...c, sort_order: idx })));
    try {
      await apiClient.patch("/hashtags/interest-cards/reorder", {
        order: reordered.map((c) => c.label),
      });
      await loadCards();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to reorder");
      await loadCards();
    }
  };

  const remove = async (label) => {
    if (!window.confirm(`Remove "${label}" from Featured Interest Cards?`)) return;
    try {
      await apiClient.delete(`/hashtags/interest-cards/${encodeURIComponent(label)}`);
      await loadCards();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to remove");
    }
  };

  if (!allowed) {
    return (
      <div className="max-w-md mx-auto or-surface p-8 text-center" data-testid="admin-hashtags-denied">
        <Crown size={28} style={{ color: "var(--primary)", margin: "0 auto" }} />
        <h2 className="text-xl mt-2" style={{ fontFamily: "var(--font-display)" }}>Founder access only</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Hashtag analytics are limited to @stealth and @support.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto" data-testid="admin-hashtags-page">
      <div className="mb-5 flex items-center gap-3">
        <Link to="/admin" className="or-chip" data-testid="admin-hashtags-back"><ArrowLeft size={14} /> Admin</Link>
        <Hash size={22} style={{ color: "var(--primary)" }} />
        <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>Hashtags</h1>
        <button className="or-chip ml-auto" onClick={() => { load(); loadCards(); }} disabled={loading} data-testid="admin-hashtags-refresh">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      {/* Analytics summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5" data-testid="admin-hashtags-summary">
        <SummaryTile label="Unique tags" value={analytics?.unique_hashtags ?? "—"} Icon={Hash} />
        <SummaryTile label="Total uses" value={analytics?.total_uses ?? "—"} Icon={BarChart3} />
        <SummaryTile label="Most-used" value={analytics?.most_used?.[0]?.tag ? `#${analytics.most_used[0].tag}` : "—"} sub={analytics?.most_used?.[0]?.usage_count} Icon={Crown} />
        <SummaryTile label="Fastest-growing" value={analytics?.fastest_growing?.[0]?.tag ? `#${analytics.fastest_growing[0].tag}` : "—"} sub={analytics?.fastest_growing?.[0]?.usage_count} Icon={TrendingUp} />
      </div>

      {/* Featured Interest Cards (promoted hashtags) */}
      <section className="or-surface p-4 mb-5" data-testid="featured-interest-cards">
        <div className="flex items-center gap-2 mb-3">
          <Star size={16} style={{ color: "var(--primary)" }} />
          <h2 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Featured Interest Cards</h2>
          {cardsLoading && <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-muted)" }} />}
          <span className="ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
            Promoted hashtags surface at the top of the onboarding picker.
          </span>
        </div>
        {cards.length === 0 ? (
          <div className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
            No promoted interest cards yet. Use the <span style={{ color: "var(--primary)" }}>Promote</span> button on any hashtag below.
          </div>
        ) : (
          <ul className="space-y-1.5" data-testid="featured-interest-list">
            {cards.map((c, idx) => {
              const m = cardAnalytics[c.label] || {};
              return (
                <li
                  key={c.label}
                  className="flex items-center gap-2 px-3 py-2 rounded-md"
                  style={{ background: "color-mix(in srgb, var(--primary) 6%, transparent)", border: "1px solid var(--border-col)" }}
                  data-testid={`featured-card-${c.label}`}
                >
                  <Sparkles size={14} style={{ color: "var(--primary)" }} />
                  <span className="font-bold text-sm" style={{ color: "var(--text-main)" }}>#{c.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--primary) 20%, transparent)", color: "var(--primary)" }}>FEATURED</span>
                  <div className="flex items-center gap-3 ml-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <span title="Users selected"><Users size={10} className="inline" /> {m.users_selecting ?? "—"}</span>
                    <span title="Posts"><Hash size={10} className="inline" /> {m.post_count ?? "—"}</span>
                    <span title="Likes"><Heart size={10} className="inline" /> {m.engagement?.likes ?? "—"}</span>
                    <span title="Comments"><MessageCircle size={10} className="inline" /> {m.engagement?.comments ?? "—"}</span>
                    <span title={`New posts in ${windowKey}`}><TrendingUp size={10} className="inline" /> {m.growth_posts ?? "—"}</span>
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => move(c.label, -1)}
                      disabled={idx === 0}
                      className="or-chip"
                      style={{ opacity: idx === 0 ? 0.4 : 1 }}
                      data-testid={`featured-up-${c.label}`}
                      title="Move up"
                    ><ArrowUp size={12} /></button>
                    <button
                      onClick={() => move(c.label, +1)}
                      disabled={idx === cards.length - 1}
                      className="or-chip"
                      style={{ opacity: idx === cards.length - 1 ? 0.4 : 1 }}
                      data-testid={`featured-down-${c.label}`}
                      title="Move down"
                    ><ArrowDown size={12} /></button>
                    <button
                      onClick={() => remove(c.label)}
                      className="or-chip"
                      style={{ color: "#ff8080", borderColor: "rgba(255,128,128,0.4)" }}
                      data-testid={`featured-remove-${c.label}`}
                      title="Remove from featured"
                    ><Trash2 size={12} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }} />
          <input
            className="or-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder="Search hashtags…"
            style={{ paddingLeft: 30 }}
            data-testid="admin-hashtags-search"
          />
        </div>
        <div className="flex gap-1.5">
          {SORTS.map((s) => (
            <button key={s.id} className="or-chip" data-active={sort === s.id} onClick={() => setSort(s.id)} data-testid={`admin-hashtags-sort-${s.id}`}>{s.label}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {WINDOWS.map((w) => (
            <button key={w.id} className="or-chip" data-active={windowKey === w.id} onClick={() => setWindowKey(w.id)} data-testid={`admin-hashtags-window-${w.id}`}>{w.label}</button>
          ))}
        </div>
      </div>

      {err && (
        <div className="or-surface p-3 mb-3 text-sm" style={{ color: "#FF8080" }} data-testid="admin-hashtags-error">{err}</div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="text-center py-10" style={{ color: "var(--text-muted)" }}><Loader2 size={20} className="inline animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="or-surface p-10 text-center" data-testid="admin-hashtags-empty" style={{ color: "var(--text-muted)" }}>
          No hashtags{q ? ` matching "${q}"` : ""} yet.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5" data-testid="admin-hashtags-grid">
          {items.map((h) => {
            const isPromoted = promotedSet.has(h.tag);
            return (
              <div
                key={h.tag}
                className="or-surface p-3 flex items-center gap-3"
                data-testid={`admin-hashtags-row-${h.tag}`}
              >
                <Link to={`/hashtag/${h.tag}`} className="flex items-center gap-3 flex-1 min-w-0">
                  <div
                    className="shrink-0 rounded-full flex items-center justify-center"
                    style={{ width: 36, height: 36, background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary)" }}
                  >
                    <Hash size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate flex items-center gap-1.5" style={{ color: "var(--text-main)" }}>
                      #{h.tag}
                      {categorySet.has(h.tag) && (
                        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--brand-green)" }}>Category</span>
                      )}
                      {isPromoted && (
                        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--primary)" }}>Featured</span>
                      )}
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Last used {fmt(h.last_used_at)}
                    </div>
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="font-bold" style={{ color: "var(--primary)" }}>{h.usage_count}</div>
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>uses</div>
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!isPromoted) promote(h.tag); }}
                  disabled={isPromoted || busyTag === h.tag}
                  className="or-chip shrink-0"
                  style={{
                    color: isPromoted ? "var(--brand-green)" : "var(--primary)",
                    borderColor: isPromoted ? "rgba(16,230,112,0.4)" : "var(--primary)",
                    opacity: busyTag === h.tag ? 0.5 : 1,
                  }}
                  data-testid={`admin-hashtags-promote-${h.tag}`}
                  title={isPromoted ? "Already featured" : "Promote to Interest Card"}
                >
                  {busyTag === h.tag ? <Loader2 size={12} className="animate-spin" /> : isPromoted ? <Check size={12} /> : <Star size={12} />}
                  {isPromoted ? "Featured" : "Promote"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, sub, Icon }) {
  return (
    <div className="or-surface p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        <Icon size={12} /> {label}
      </div>
      <div className="text-xl mt-1 font-bold" style={{ color: "var(--text-main)", fontFamily: "var(--font-display)" }}>
        {value}
      </div>
      {sub !== undefined && sub !== null && (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{sub} uses</div>
      )}
    </div>
  );
}

function fmt(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
