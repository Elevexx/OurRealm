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
 */
import React, { useEffect, useMemo, useState } from "react";
import { Hash, Search, Loader2, TrendingUp, BarChart3, Crown, ArrowLeft, RefreshCw } from "lucide-react";
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

  const categorySet = useMemo(
    () => new Set((categories || []).map((c) => c.slug)),
    [categories],
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

  useEffect(() => { if (allowed) load(); /* eslint-disable-next-line */ }, [sort, windowKey, allowed]);

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
        <button className="or-chip ml-auto" onClick={load} disabled={loading} data-testid="admin-hashtags-refresh">
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
          {items.map((h) => (
            <Link
              key={h.tag}
              to={`/hashtag/${h.tag}`}
              className="or-surface p-3 flex items-center gap-3"
              data-testid={`admin-hashtags-row-${h.tag}`}
            >
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
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--brand-green)" }}>
                      Category
                    </span>
                  )}
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Last used {fmt(h.last_used_at)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold" style={{ color: "var(--primary)" }}>{h.usage_count}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>uses</div>
              </div>
            </Link>
          ))}
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
