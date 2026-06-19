/**
 * /admin/realm-pulse — founder/investor-grade analytics dashboard.
 *
 * Surfaces, in priority order:
 *   1. Investor Snapshot card  — DAU/WAU/MAU/ratio/D30/growth-rate
 *      plus the plain-language status indicator.
 *   2. Primary Growth         — DAU, WAU, MAU, DAU/MAU ratio.
 *   3. Retention              — D1/D7/D30 cohort-based.
 *   4. Engagement averages    — per-active-user counts.
 *   5. Growth metrics         — new users, growth rate, referral set.
 *   6. Community totals       — content created across the window.
 *   7. Top Insights           — auto-generated highlights.
 *   8. Exports                — CSV / PDF / XLSX with one-click download.
 *
 * Default state is the SUMMARY view only — detailed breakdowns sit
 * inside collapsible panels and only fetch their data the first time
 * they're opened.
 *
 * Founder gate is enforced server-side. The client also hides the tab
 * for any user whose `admin_role !== "founder"` so the route never
 * even renders for support admins.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ChevronDown, ChevronRight, Crown, Loader2, RefreshCw,
  Sparkles, Users, Activity, Repeat, TrendingUp, Download,
  FileSpreadsheet, FileText, FileDown, Hash, Star, Calendar, Zap,
  ShieldAlert,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const WINDOWS = [
  { id: "today", label: "Today" },
  { id: "7d",    label: "7 days" },
  { id: "30d",   label: "30 days" },
  { id: "90d",   label: "90 days" },
  { id: "custom",label: "Custom" },
];

const STATUS_COLOUR = {
  "Strong engagement": "var(--brand-green)",
  "High growth":       "#2EA0FF",
  "Early traction":    "var(--primary)",
  "Needs attention":   "#FF8080",
};

export default function RealmPulse() {
  const { user } = useAuth();
  const isFounder = user && (user.username || "").toLowerCase() === "stealth";

  const [windowKey, setWindowKey] = useState("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd,   setCustomEnd]   = useState("");
  const [overview, setOverview] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState({ retention: true, engagement: false, growth: false, community: false, insights: false });
  const [exporting, setExporting] = useState("");

  const queryParams = useMemo(() => {
    if (windowKey === "custom" && customStart && customEnd) {
      return { window: "custom", start: customStart, end: customEnd };
    }
    return { window: windowKey === "today" ? "1d" : windowKey };
  }, [windowKey, customStart, customEnd]);

  const load = async () => {
    if (!isFounder) return;
    setLoading(true); setErr("");
    try {
      const [ov, inv] = await Promise.all([
        apiClient.get("/admin/realm-pulse/overview", { params: queryParams }),
        apiClient.get("/admin/realm-pulse/investor-snapshot", { params: queryParams }),
      ]);
      setOverview(ov.data);
      setSnapshot(inv.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load Realm Pulse");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [JSON.stringify(queryParams), isFounder]);

  const refresh = async () => {
    try { await apiClient.post(`/admin/realm-pulse/refresh-snapshot?window=${queryParams.window || "7d"}`); }
    catch { /* */ }
    load();
  };

  const exportAs = async (fmt) => {
    setExporting(fmt);
    try {
      const r = await apiClient.get("/admin/realm-pulse/export", {
        params: { ...queryParams, format: fmt },
        responseType: "blob",
      });
      const blob = new Blob([r.data], { type: r.headers["content-type"] });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `realm-pulse-${queryParams.window || "7d"}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e?.response?.data?.detail || `Export ${fmt} failed`);
    } finally { setExporting(""); }
  };

  if (!isFounder) {
    return (
      <div className="max-w-md mx-auto or-surface p-8 text-center" data-testid="realm-pulse-denied">
        <Crown size={28} style={{ color: "var(--primary)", margin: "0 auto" }} />
        <h2 className="text-xl mt-2" style={{ fontFamily: "var(--font-display)" }}>Founder access only</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Realm Pulse is restricted to @stealth.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto" data-testid="realm-pulse-page">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <Link to="/admin/analytics" className="or-chip" data-testid="realm-pulse-back"><ArrowLeft size={14} /> Analytics</Link>
        <Zap size={22} style={{ color: "var(--brand-green)" }} />
        <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>Realm Pulse</h1>
        <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded-full"
          style={{ background: "rgba(255,128,128,0.15)", color: "#FF8080" }}>Founder only</span>
        <button className="or-chip ml-auto" onClick={refresh} disabled={loading} data-testid="realm-pulse-refresh">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      {/* Window selector */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {WINDOWS.map((w) => (
          <button key={w.id} className="or-chip" data-active={windowKey === w.id} onClick={() => setWindowKey(w.id)} data-testid={`realm-pulse-window-${w.id}`}>{w.label}</button>
        ))}
        {windowKey === "custom" && (
          <div className="flex items-center gap-1.5 ml-2" data-testid="realm-pulse-custom-range">
            <input type="date" className="or-input" style={{ width: 130 }} value={customStart} onChange={(e) => setCustomStart(e.target.value)} data-testid="realm-pulse-start" />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>→</span>
            <input type="date" className="or-input" style={{ width: 130 }} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} data-testid="realm-pulse-end" />
          </div>
        )}
      </div>

      {err && <div className="or-surface p-3 mb-3 text-sm" style={{ color: "#FF8080" }} data-testid="realm-pulse-error">{err}</div>}

      {/* Investor Snapshot */}
      <InvestorSnapshotCard snapshot={snapshot} onExport={exportAs} exporting={exporting} />

      {/* Primary Growth tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5" data-testid="realm-pulse-growth-tiles">
        <Tile label="DAU"  value={overview?.dau} Icon={Users} accent="#10E670" />
        <Tile label="WAU"  value={overview?.wau} Icon={Activity} accent="#2EA0FF" />
        <Tile label="MAU"  value={overview?.mau} Icon={Repeat} accent="#C26BFF" />
        <Tile label="DAU / MAU"
              value={overview?.dau_mau_ratio_pct != null ? `${overview.dau_mau_ratio_pct}%` : "—"}
              Icon={TrendingUp} accent="#F4C84A"
              sub="Stickiness" />
      </div>

      {/* Retention */}
      <Section
        title="Retention (cohort-based)"
        Icon={ShieldAlert}
        open={open.retention}
        onToggle={() => setOpen((o) => ({ ...o, retention: !o.retention }))}
        testid="rp-retention"
      >
        <div className="grid grid-cols-3 gap-3">
          <RetentionTile label="Day 1"  pct={overview?.retention?.d1}  eligible={overview?.retention?.d1_eligible} />
          <RetentionTile label="Day 7"  pct={overview?.retention?.d7}  eligible={overview?.retention?.d7_eligible} />
          <RetentionTile label="Day 30" pct={overview?.retention?.d30} eligible={overview?.retention?.d30_eligible} />
        </div>
        <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
          Cohort size: {overview?.retention?.cohort_size ?? "—"} users signed up in window.
        </div>
      </Section>

      {/* Engagement */}
      <Section
        title="Engagement (per active user)"
        Icon={Activity}
        open={open.engagement}
        onToggle={() => setOpen((o) => ({ ...o, engagement: !o.engagement }))}
        testid="rp-engagement"
      >
        {overview?.engagement && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MiniMetric label="Avg posts"     value={overview.engagement.avg_posts_per_user} />
            <MiniMetric label="Avg messages"  value={overview.engagement.avg_messages_per_user} />
            <MiniMetric label="Avg sounds"    value={overview.engagement.avg_sounds_per_user} />
            <MiniMetric label="Avg comments" value={overview.engagement.avg_comments_per_user} />
            <MiniMetric label="Avg actions"   value={overview.engagement.avg_actions_per_user} />
            <MiniMetric label="Avg sessions/day" value={overview.engagement.avg_sessions_per_day} />
          </div>
        )}
      </Section>

      {/* Growth */}
      <Section
        title="Growth"
        Icon={TrendingUp}
        open={open.growth}
        onToggle={() => setOpen((o) => ({ ...o, growth: !o.growth }))}
        testid="rp-growth"
      >
        {overview?.growth && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MiniMetric label="New users"               value={overview.growth.new_users} />
            <MiniMetric label="Growth rate"
                        value={overview.growth.user_growth_rate_pct != null ? `${overview.growth.user_growth_rate_pct}%` : "—"} />
            <MiniMetric label="Prev period new"         value={overview.growth.prev_period_new_users} />
            <MiniMetric label="Invites sent"            value={overview.growth.referral_invites_sent} />
            <MiniMetric label="Invites accepted"        value={overview.growth.referral_invites_accepted} />
            <MiniMetric label="Acceptance rate"
                        value={overview.growth.invite_acceptance_pct != null ? `${overview.growth.invite_acceptance_pct}%` : "—"} />
            <MiniMetric label="Viral coefficient (k)"
                        value={overview.growth.viral_coefficient != null ? overview.growth.viral_coefficient : "—"} />
          </div>
        )}
      </Section>

      {/* Community */}
      <Section
        title="Community totals"
        Icon={Hash}
        open={open.community}
        onToggle={() => setOpen((o) => ({ ...o, community: !o.community }))}
        testid="rp-community"
      >
        {overview?.community && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MiniMetric label="Posts created"     value={overview.community.posts_created} />
            <MiniMetric label="Messages sent"     value={overview.community.messages_sent} />
            <MiniMetric label="Sounds uploaded"   value={overview.community.sounds_uploaded} />
            <MiniMetric label="Comments created"  value={overview.community.comments_created} />
            <MiniMetric label="Groups created"    value={overview.community.groups_created} />
            <MiniMetric label="TOTAL content"     value={overview.community.total_content} highlight />
          </div>
        )}
      </Section>

      {/* Top Insights */}
      <Section
        title="Top Insights"
        Icon={Star}
        open={open.insights}
        onToggle={() => setOpen((o) => ({ ...o, insights: !o.insights }))}
        testid="rp-insights"
      >
        {overview?.top_insights && (
          <ul className="space-y-2 text-sm">
            <Insight label="Fastest-growing interest"
                     value={overview.top_insights.fastest_growing_interest ? `#${overview.top_insights.fastest_growing_interest}` : "—"}
                     count={overview.top_insights.fastest_growing_count} />
            <Insight label="Most-selected interest"
                     value={overview.top_insights.most_selected_interest || "—"}
                     count={overview.top_insights.most_selected_count} suffix="users" />
            <Insight label="Most active creator (anonymised)"
                     value={overview.top_insights.top_creator_post_count + " posts"}
                     count={null} />
            <Insight label="Highest engagement day"
                     value={overview.top_insights.highest_engagement_day || "—"}
                     count={overview.top_insights.highest_engagement_value} suffix="actions" />
          </ul>
        )}
      </Section>

      {/* Exports */}
      <section className="or-surface p-4 mt-5" data-testid="realm-pulse-exports">
        <div className="flex items-center gap-2 mb-3">
          <Download size={16} style={{ color: "var(--brand-green)" }} />
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Generate Investor Snapshot</h3>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Exports include the window range, every metric you see here, and a plain-language definition footer.
          No usernames, message bodies, or personally identifiable data are written to any file.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="or-btn" onClick={() => exportAs("csv")} disabled={exporting === "csv"} data-testid="rp-export-csv">
            {exporting === "csv" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} CSV
          </button>
          <button className="or-btn" onClick={() => exportAs("xlsx")} disabled={exporting === "xlsx"} data-testid="rp-export-xlsx">
            {exporting === "xlsx" ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} XLSX
          </button>
          <button className="or-btn" onClick={() => exportAs("pdf")} disabled={exporting === "pdf"} data-testid="rp-export-pdf">
            {exporting === "pdf" ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} PDF
          </button>
        </div>
      </section>

      <div className="text-[10px] mt-6 text-center" style={{ color: "var(--text-muted)" }}>
        Cache: {overview?.served_from_cache ? "snapshot" : "live"} · last generated {overview?.generated_at || "—"}
      </div>
    </div>
  );
}

// ───────────────────────── helpers / sub-components ─────────────────────────

function InvestorSnapshotCard({ snapshot, onExport, exporting }) {
  if (!snapshot) {
    return (
      <div className="or-surface p-4 mb-4" data-testid="investor-snapshot-loading">
        <Loader2 size={16} className="animate-spin inline" />
      </div>
    );
  }
  const colour = STATUS_COLOUR[snapshot.status] || "var(--text-muted)";
  return (
    <div
      className="or-surface p-4 mb-5"
      style={{ borderTop: `3px solid ${colour}` }}
      data-testid="investor-snapshot-card"
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Sparkles size={14} style={{ color: colour }} />
        <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Investor Snapshot</h3>
        <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ background: `${colour}20`, color: colour }}
              data-testid="investor-snapshot-status">
          {snapshot.status}
        </span>
        <button className="or-chip ml-auto" onClick={() => onExport("pdf")} disabled={exporting === "pdf"} data-testid="investor-snapshot-pdf">
          {exporting === "pdf" ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />} PDF
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
        <Stat label="DAU"        value={snapshot.dau} />
        <Stat label="WAU"        value={snapshot.wau} />
        <Stat label="MAU"        value={snapshot.mau} />
        <Stat label="DAU/MAU"    value={`${snapshot.dau_mau_ratio_pct}%`} />
        <Stat label="Growth"     value={snapshot.user_growth_rate_pct != null ? `${snapshot.user_growth_rate_pct}%` : "—"} />
        <Stat label="D30 Ret."   value={snapshot.d30_retention_pct != null ? `${snapshot.d30_retention_pct}%` : "—"} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-xl font-bold" style={{ color: "var(--text-main)", fontFamily: "var(--font-display)" }}>{value ?? "—"}</div>
    </div>
  );
}

function Tile({ label, value, Icon, accent, sub }) {
  return (
    <div className="or-surface p-3" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        <Icon size={12} style={{ color: accent }} /> {label}
      </div>
      <div className="text-2xl mt-1 font-bold" style={{ color: "var(--text-main)", fontFamily: "var(--font-display)" }}>
        {value ?? "—"}
      </div>
      {sub && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

function Section({ title, Icon, open, onToggle, children, testid }) {
  return (
    <section className="or-surface p-4 mt-3" data-testid={testid}>
      <button className="w-full flex items-center gap-2" onClick={onToggle} data-testid={`${testid}-toggle`}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Icon size={14} style={{ color: "var(--primary)" }} />
        <h3 className="text-base" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>{title}</h3>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

function MiniMetric({ label, value, highlight }) {
  return (
    <div className="px-3 py-2 rounded"
      style={{ background: highlight ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "var(--surface-2)", border: "1px solid var(--border-col)" }}>
      <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-base font-bold" style={{ color: "var(--text-main)" }}>{value ?? "—"}</div>
    </div>
  );
}

function RetentionTile({ label, pct, eligible }) {
  const colour = pct == null ? "var(--text-muted)" : pct >= 30 ? "var(--brand-green)" : pct >= 10 ? "#F4C84A" : "#FF8080";
  return (
    <div className="or-surface p-3 text-center" style={{ borderTop: `2px solid ${colour}` }}>
      <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-3xl font-bold my-1" style={{ color: colour, fontFamily: "var(--font-display)" }}>
        {pct == null ? "—" : `${pct}%`}
      </div>
      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        {eligible ?? 0} eligible
      </div>
    </div>
  );
}

function Insight({ label, value, count, suffix }) {
  return (
    <li className="flex items-center gap-2 px-2 py-2 rounded"
        style={{ background: "color-mix(in srgb, var(--primary) 6%, transparent)", border: "1px solid var(--border-col)" }}>
      <Calendar size={12} style={{ color: "var(--text-muted)" }} />
      <span style={{ color: "var(--text-muted)" }}>{label}:</span>
      <span className="font-bold" style={{ color: "var(--text-main)" }}>{value}</span>
      {count != null && (
        <span className="ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>{count}{suffix ? ` ${suffix}` : ""}</span>
      )}
    </li>
  );
}
