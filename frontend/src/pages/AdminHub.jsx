/**
 * /admin — Admin Hub
 *
 * A card-based navigation page that replaces the old `/admin` alias of
 * the analytics dashboard. Each card represents one admin tool and is
 * gated by the viewer's role. Optional status badges show live counts
 * pulled from existing endpoints so admins land here and see at a
 * glance whether anything needs attention.
 *
 * Routing rule: `/admin` → this page. `/admin/analytics` continues to
 * render the Analytics dashboard exactly as before — no URL changes
 * anywhere else.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3, Zap, Hash, Headphones, HelpCircle, LifeBuoy,
  Crown, ShieldCheck, ChevronRight, Loader2, Sparkles, LayoutGrid, Database,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";

/**
 * Card definitions. `roles` is the set of admin roles allowed to see
 * the card — `founder` is the strictest, `admin` covers everyone with
 * an admin badge (founder + support_admin + support + moderator).
 *
 * `accent` drives the per-card colour without touching shared design
 * tokens so the existing OurRealm look stays intact.
 */
const CARDS = [
  {
    id: "analytics",
    to: "/admin/analytics",
    title: "Analytics Dashboard",
    description: "Live moderation panel, copyright queue, range-aware stats.",
    Icon: BarChart3,
    accent: "#10E670",
    badge: "Support",
    roles: ["founder", "admin"],
    statKey: "openTickets",   // shows open helpdesk tickets as a hint
  },
  {
    id: "realm-pulse",
    to: "/admin/realm-pulse",
    title: "Realm Pulse",
    description: "DAU / MAU, cohort retention, growth, Investor Snapshot, exports.",
    Icon: Zap,
    accent: "#2EA0FF",
    badge: "Founder Only",
    roles: ["founder"],
    statKey: "dauMau",
  },
  {
    id: "hashtags",
    to: "/admin/hashtags",
    title: "Hashtag Manager",
    description: "Catalogue, analytics, and Featured Interest Card promotions.",
    Icon: Hash,
    accent: "#C26BFF",
    badge: null,
    roles: ["founder", "admin"],
    statKey: "totalHashtags",
  },
  {
    id: "support",
    to: "/admin/support",
    title: "Support Center",
    description: "Helpdesk queue, reassign, change status, edit subject.",
    Icon: Headphones,
    accent: "#F4C84A",
    badge: null,
    roles: ["founder", "admin"],
    statKey: "openTickets",
  },
  {
    id: "faq",
    to: "/admin/faq",
    title: "FAQ Manager",
    description: "Edit the public FAQ shown on /profile/support.",
    Icon: HelpCircle,
    accent: "#6BD3FF",
    badge: null,
    roles: ["founder", "admin"],
    statKey: null,
  },
  {
    id: "public-support",
    to: "/profile/support",
    title: "Public Support & FAQ",
    description: "User-facing support page. Admin widgets surface here too.",
    Icon: LifeBuoy,
    accent: "#FF8AC2",
    badge: "Public",
    roles: ["founder", "admin"],
    statKey: null,
  },
  {
    id: "widgets",
    to: "/admin/widgets",
    title: "Widgets & Badges Manager",
    description: "Create, launch, disable, and assign widgets and badges across profiles, home, and realms.",
    Icon: LayoutGrid,
    accent: "#C26BFF",
    badge: null,
    roles: ["founder", "admin"],
    statKey: null,
  },
  {
    id: "providers",
    to: "/admin/providers",
    title: "Provider Integrations",
    description: "Manage external APIs (OpenAI, NewsAPI, OpenWeather, Alpha Vantage, …). Enable / disable / health-check.",
    Icon: LayoutGrid,
    accent: "#00C2FF",
    badge: null,
    roles: ["founder", "admin"],
    statKey: null,
  },
  {
    id: "orion",
    to: "/admin/orion",
    title: "Orion Command Center",
    description: "AI assistant hub for founder operations, analytics, reports, drafts, approvals, and Orion tools.",
    Icon: Sparkles,
    accent: "#C26BFF",
    badge: "Founder Only",
    roles: ["founder"],
    statKey: null,
    footer: "✦ Open Orion Command Center",
  },
  {
    id: "portals",
    to: "/admin/portals",
    title: "Portal Development Hub",
    description: "Preview and manage every Realm (Rainforest, Aquarium, Cyberpunk, …). Launch, edit, disable. Never linked publicly.",
    Icon: Crown,
    accent: "#10E670",
    badge: "Founder Only",
    roles: ["founder"],
    statKey: null,
    footer: "◈ Open Portal Dev Hub",
  },
  {
    id: "data-health",
    to: "/admin/data-health",
    title: "Data Health & Audit",
    description: "Production data audit — media repair, synthetic-account cleanup, signup health, environment identity checks.",
    Icon: Database,
    accent: "#FF3F5A",
    badge: "Founder Only",
    roles: ["founder"],
    statKey: null,
    footer: "◈ Open Data Health Console",
  },
];

export default function AdminHub() {
  const { user } = useAuth();
  const role = roleOf(user);
  const visibleCards = CARDS.filter((c) => c.roles.includes(role) || (role === "founder" && c.roles.includes("admin")));

  const [stats, setStats] = useState({ loading: true });
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const out = {};
      // Helpdesk summary — visible to any admin.
      try {
        const { data } = await apiClient.get("/admin/support/summary");
        out.openTickets =
          (data?.status_counts?.Submitted || 0) +
          (data?.status_counts?.["In Progress"] || 0);
      } catch { /* */ }
      // Hashtag count — public-ish list endpoint.
      try {
        const { data } = await apiClient.get("/hashtags", { params: { limit: 1, sort: "usage" } });
        // The summary endpoint exposes a unique count directly; reuse that
        // if available, otherwise fall back to the small first-page slice.
        try {
          const sum = await apiClient.get("/hashtags/analytics/summary?window=30d");
          out.totalHashtags = sum.data?.unique_hashtags;
        } catch {
          out.totalHashtags = data?.total ?? data?.hashtags?.length ?? null;
        }
      } catch { /* */ }
      // Realm Pulse — founder only; surfaces DAU/MAU on the hub.
      if (role === "founder") {
        try {
          const { data } = await apiClient.get("/admin/realm-pulse/overview", { params: { window: "30d" } });
          out.dauMau = `${data?.dau ?? "—"} / ${data?.mau ?? "—"}`;
        } catch { /* */ }
      }
      if (!cancelled) setStats({ loading: false, ...out });
    })();
    return () => { cancelled = true; };
  }, [user, role]);

  // Phase 3.7.4 — live Orion Command Center health pill on the hub.
  // Founder only. Polls /api/admin/orion/health every 30s (backend has
  // its own 30s in-memory cache so this is cheap). Failure is silent —
  // the card still works as a passive launcher.
  const [orionHealth, setOrionHealth] = useState(null);
  useEffect(() => {
    if (role !== "founder") return;
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      try {
        const { data } = await apiClient.get("/admin/orion/health");
        if (!cancelled) setOrionHealth(data);
      } catch {
        if (!cancelled) setOrionHealth({ ok: false, _unreachable: true });
      }
    };
    tick();
    timer = setInterval(tick, 30_000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [role]);

  // Non-admin guard — backend gates each underlying page individually,
  // but the hub itself shows nothing useful for normal users so we
  // redirect-style-render a denied panel.
  if (!user || !isAdmin(user)) {
    return (
      <div className="max-w-md mx-auto or-surface p-8 text-center" data-testid="admin-hub-denied">
        <ShieldCheck size={28} style={{ color: "var(--primary)", margin: "0 auto" }} />
        <h2 className="text-xl mt-2" style={{ fontFamily: "var(--font-display)" }}>Admins only</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          This area is restricted to OurRealm admins and the founder.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto" data-testid="admin-hub-page">
      <header className="mb-5 flex items-center gap-3 flex-wrap">
        {role === "founder"
          ? <Crown size={26} style={{ color: "var(--primary)" }} />
          : <ShieldCheck size={26} style={{ color: "var(--brand-green)" }} />
        }
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>OurRealm · Admin</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Admin Hub</h1>
        </div>
        <span
          className="ml-auto text-[10px] uppercase tracking-widest px-2 py-1 rounded-full"
          style={{
            background: role === "founder"
              ? "color-mix(in srgb, var(--primary) 18%, transparent)"
              : "color-mix(in srgb, var(--brand-green) 18%, transparent)",
            color: role === "founder" ? "var(--primary)" : "var(--brand-green)",
          }}
          data-testid="admin-hub-role"
        >
          Signed in as {role}
        </span>
      </header>

      <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
        Every admin tool, one click away. Cards are filtered by the role tied to your account; the underlying APIs enforce
        the same permission rules server-side.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="admin-hub-grid">
        {visibleCards.map((c) => (
          <HubCard key={c.id} card={c} stats={stats} orionHealth={c.id === "orion" ? orionHealth : undefined} />
        ))}
      </div>
    </div>
  );
}


// Phase 3.7.4 — Orion status pill. Color reflects the live /health
// summary: green when ok+no auto-heal, amber when auto-healed or
// some warnings, red when overall ok=false or endpoint unreachable.
function OrionStatusPill({ health }) {
  if (!health) {
    return (
      <span
        className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
        style={{ background: "#3a3a4a44", color: "#9CA3AF" }}
        data-testid="admin-hub-card-orion-status"
        title="Checking Orion health…"
      >
        <Loader2 size={9} className="animate-spin" /> Checking
      </span>
    );
  }
  let color = "#22C55E"; let label = "Healthy";
  let failing = [];
  if (health._unreachable) { color = "#EF4444"; label = "Unreachable"; }
  else if (!health.ok) {
    // Distinguish between LLM provider failure (red, critical) and
    // optional-subsystem warnings (amber). The llm_provider check is
    // the only true blocker for Orion Chat.
    const llm = (health.checks || []).find((c) => c.name === "llm_provider");
    failing = (health.checks || []).filter((c) => !c.ok).map((c) => c.name);
    if (llm && !llm.ok) { color = "#EF4444"; label = "Provider Down"; }
    else                 { color = "#F59E0B"; label = "Warning"; }
  }
  else if (health.auto_healed) { color = "#F59E0B"; label = "Auto-Healed"; }
  const provider = (health.active_provider || "").toUpperCase();
  const tooltip = `Orion: ${label}` +
    (provider ? ` · provider=${provider}` : "") +
    (failing.length ? ` · failing=${failing.join(",")}` : "") +
    (typeof health.age_s === "number" ? ` · checked ${health.age_s}s ago` : "");
  return (
    <span
      className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
      data-testid="admin-hub-card-orion-status"
      title={tooltip}
    >
      <span style={{ width: 6, height: 6, background: color, borderRadius: 999 }} />
      {label}
    </span>
  );
}

function HubCard({ card, stats, orionHealth }) {
  const { Icon, accent } = card;
  const statValue = card.statKey ? stats[card.statKey] : undefined;
  return (
    <Link
      to={card.to}
      className="or-surface p-4 block group transition-transform"
      style={{ borderLeft: `3px solid ${accent}` }}
      data-testid={`admin-hub-card-${card.id}`}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 rounded-xl flex items-center justify-center"
          style={{
            width: 44, height: 44,
            background: `color-mix(in srgb, ${accent} 16%, transparent)`,
            color: accent,
            border: `1px solid ${accent}55`,
          }}
        >
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold truncate" style={{ color: "var(--text-main)", fontFamily: "var(--font-display)" }}>
              {card.title}
            </h3>
            {card.badge && (
              <span
                className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full"
                style={{ background: `${accent}22`, color: accent }}
                data-testid={`admin-hub-card-${card.id}-badge`}
              >{card.badge}</span>
            )}
            {card.id === "orion" && <OrionStatusPill health={orionHealth} />}
          </div>
          <p className="text-[12px] mt-1 leading-snug" style={{ color: "var(--text-muted)" }}>
            {card.description}
          </p>
          {statValue !== undefined && statValue !== null && (
            <div className="text-[11px] mt-2 inline-flex items-center gap-1"
              style={{ color: accent }}
              data-testid={`admin-hub-card-${card.id}-stat`}
            >
              <Sparkles size={10} /> {labelFor(card.statKey)}: <b className="font-bold">{statValue}</b>
            </div>
          )}
          {stats.loading && card.statKey && statValue === undefined && (
            <div className="text-[11px] mt-2 inline-flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={10} className="animate-spin" />
            </div>
          )}
          {card.footer && (
            <div
              className="text-[11px] mt-2 inline-flex items-center gap-1 font-semibold"
              style={{ color: accent }}
              data-testid={`admin-hub-card-${card.id}-footer`}
            >
              {card.footer}
            </div>
          )}
        </div>
        <ChevronRight size={16} style={{ color: "var(--text-muted)" }} className="mt-1 shrink-0 group-hover:translate-x-1 transition-transform" />
      </div>
    </Link>
  );
}

function labelFor(key) {
  return {
    openTickets:   "Open tickets",
    totalHashtags: "Unique hashtags",
    dauMau:        "DAU / MAU",
  }[key] || key;
}

function roleOf(user) {
  if (!user) return "guest";
  const uname = (user.username || "").toLowerCase();
  if (uname === "stealth" || user.admin_role === "founder") return "founder";
  if (uname === "support" || user.admin_role === "support_admin") return "admin";
  if (user.admin_role === "moderator") return "admin";
  if (isAdmin(user)) return "admin";
  return "user";
}
