/**
 * /admin/orion — ORAi Founder Command Center (Phase 3.7.1).
 *
 * Premium full-screen "mission control" surface for OurRealm
 * founders/admins. Reuses Phase 3.6 + 3.7 backend tools entirely —
 * this page is a richer UI shell around the existing
 * `/api/widgets/chat/*` and `/api/admin/orion-logs/*` endpoints.
 *
 * Architecture
 *   • Permanent left sidebar (collapsible on mobile).
 *   • Main content swaps between Dashboard / Chat / Briefing /
 *     Quick Actions / Audit Logs / Roadmap views.
 *   • Right context panel surfaces the latest draft + recent
 *     activity + live status. Hidden on <lg.
 *   • Chat view uses the same /api/widgets/chat/{message,history}
 *     endpoints the profile widget uses, scoped to a dedicated
 *     "command center" conversation per founder.
 *   • Draft cards are rendered when an ORAi reply matches one of
 *     the Phase 3.7 draft headers — markdown → structured card.
 *
 * NO backend changes. NO duplicate analytics. Founder gate is the
 * same `username==='stealth'` check used by Phase 3.7.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, Award, BarChart3, Bell, Bot, BookOpen, Calendar,
  CheckCircle, ChevronDown, ChevronRight, Cog, Compass, Cpu, FileText, Flame, Hash,
  Hexagon, ImagePlus, Layers, LifeBuoy, ListChecks, Loader2, Maximize2, Menu, MessageSquare,
  Pin, Plug, Plus, RefreshCw, Search as SearchIcon, Send, Shield, ShieldCheck, Sparkles, Star, Tag,
  Target, Users, Workflow, X, XCircle, Zap,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import OraiDashboard, { ORAI_LOGO_URL } from "@/components/admin/OraiDashboard";
import OraiPrivateAccess from "@/components/admin/OraiPrivateAccess";
import OraiUsageDashboard from "@/components/admin/OraiUsageDashboard";
import { OraiVoiceBar } from "@/components/orai/OraiVoiceBar";

// ─────────────────────────────────────────────────────────────────────
// Constants — sidebar sections + quick-action tiles + suggested chips.
// ─────────────────────────────────────────────────────────────────────
const ORION_WIDGET_ID = "stealth_ai_5a6";  // founder-only chat widget seeded by /core/seed.py

const NAV_SECTIONS = [
  { id: "dashboard", label: "Dashboard",       icon: Hexagon },
  { id: "chat",      label: "ORAi Chat",      icon: MessageSquare },
  { id: "ai-command", label: "AI Command",    icon: Cpu, href: "/admin/orai-control" },
  { id: "private-access", label: "Private ORAi Access", icon: Shield },
  { id: "public-rules", label: "Public Access & Rules", icon: Shield },
  { id: "ai-usage",  label: "AI Usage",        icon: Activity },
  { id: "briefing",  label: "Founder Briefing", icon: BarChart3 },
  { id: "actions",   label: "Quick Actions",   icon: Zap },
  { id: "reports",   label: "Reports",         icon: FileText },
  { id: "alerts",    label: "Alerts",          icon: Bell },
  { id: "workflows", label: "Workflows",       icon: Workflow, soon: true },
  { id: "approvals", label: "Approvals",       icon: ListChecks },
  { id: "support",   label: "Support",         icon: LifeBuoy },
  { id: "moderation",label: "Moderation",      icon: Shield },
  { id: "realms",    label: "Realms",          icon: Compass },
  { id: "widgets",   label: "Widgets",         icon: Layers },
  { id: "badges",    label: "Badges",          icon: Award },
  { id: "tasks",     label: "Tasks",           icon: Tag, soon: true },
  { id: "automations", label: "Automations",   icon: Workflow, soon: true },
  { id: "settings",  label: "Settings",        icon: Cog },
];

const NAV_FUTURE = [
  { id: "agents",       label: "Agents",       icon: Bot,  phase: "4.0" },
  { id: "memory",       label: "Memory",       icon: Cpu,  phase: "4.0" },
  { id: "integrations", label: "Integrations", icon: Plug, phase: "4.0" },
];

const QUICK_TILES = [
  { id: "founder_briefing",  label: "Founder Briefing",  icon: BarChart3, prompt: "Give me a founder briefing", accent: "#22D3EE" },
  { id: "investor",          label: "Investor Snapshot", icon: Star,      prompt: "Give me an investor snapshot", accent: "#60A5FA" },
  { id: "draft_badge",       label: "Draft Badge",       icon: Award,     prompt: "Draft a badge for users who upload 1000 sounds", accent: "#F59E0B" },
  { id: "draft_widget",      label: "Draft Widget",      icon: Layers,    prompt: "Draft a widget for community polls", accent: "#A78BFA" },
  { id: "announcement",      label: "Create Announcement", icon: Bell,    prompt: "Draft an announcement about our growth this month", accent: "#34D399" },
  { id: "support_digest",    label: "Support Digest",    icon: LifeBuoy,  prompt: "Show the oldest unresolved tickets", accent: "#FB7185" },
  { id: "moderation_digest", label: "Moderation Digest", icon: Shield,    prompt: "Any risky moderation issues right now?", accent: "#FCA5A5" },
  { id: "growth_report",     label: "Growth Report",     icon: Flame,     prompt: "Show DAU WAU MAU", accent: "#F472B6" },
  { id: "realm_report",      label: "Realm Report",      icon: Compass,   prompt: "Show me the top realms this week", accent: "#22D3EE" },
  { id: "health_report",     label: "Health Report",     icon: ShieldCheck, prompt: "Today's snapshot", accent: "#86EFAC" },
  { id: "task_plan",         label: "Task Plan",         icon: Target,    prompt: "Inactive realms needing attention", accent: "#FACC15" },
  { id: "support_reply",     label: "Draft Support Reply", icon: MessageSquare, prompt: "Draft a reply for the oldest support ticket", accent: "#67E8F9" },
];

const SUGGESTED_CHIPS = [
  "Give me today's founder briefing",
  "Show platform alerts",
  "Draft a badge",
  "Draft a widget",
  "Oldest support tickets",
  "Top reported users",
  "Inactive realms",
  "Generate investor snapshot",
];

// Phase 3.7.2 — categorized prompt library. Replaces the flat chip
// row with grouped quick-prompts so founders can scan by surface.
const PROMPT_LIBRARY = [
  { group: "Analytics",   prompts: ["Show DAU WAU MAU", "Today's snapshot", "How many users signed up this week?"] },
  { group: "Investor",    prompts: ["Generate investor snapshot", "Give me a founder briefing"] },
  { group: "Realms",      prompts: ["Show me the top realms this week", "New realms this week", "Inactive realms"] },
  { group: "Community",   prompts: ["Top creators this week", "Sounds uploaded today", "Posts created today"] },
  { group: "Moderation",  prompts: ["Show open moderation reports", "Most reported users this week", "Any risky moderation issues right now?"] },
  { group: "Support",     prompts: ["Show open support tickets", "Oldest unresolved tickets", "Draft a reply for the oldest support ticket"] },
  { group: "Widgets",     prompts: ["All launched widgets", "Disabled widgets", "Most used widgets"] },
  { group: "Badges",      prompts: ["How many VIP holders?", "Show badge stats", "Beta holders"] },
  { group: "Announcements", prompts: ["Draft an announcement about our growth this month", "Draft a maintenance notice"] },
];

// Animated "thinking" phrases — rotated while a reply is in flight.
const THINKING_STATES = [
  "Reading analytics",
  "Checking moderation",
  "Reviewing support tickets",
  "Comparing trends",
  "Drafting recommendation",
  "Cross-referencing realms",
  "Pulling live counts",
];

// Maps a Phase 3.7 draft header to a structured card type.
const DRAFT_HEADERS = [
  { type: "badge",        match: /^\*\*Badge draft\*\*/im },
  { type: "widget",       match: /^\*\*Widget draft\*\*/im },
  { type: "announcement", match: /^\*\*Announcement draft\*\*/im },
  { type: "support",      match: /^\*\*Support reply draft\b/im },
  { type: "moderation",   match: /^\*\*Moderation risk assessment\*\*/im },
  { type: "briefing",     match: /^\*\*Founder briefing\*\*/im },
];

// ─────────────────────────────────────────────────────────────────────
// Page shell — founder gate + nav + main panel switch.
// ─────────────────────────────────────────────────────────────────────
export default function AdminOrion() {
  const { user } = useAuth();
  const isFounder = (user?.username || "").toLowerCase() === "stealth";
  const [section, setSection] = useState(() => window.history.state?.usr?.section || "dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);   // mobile drawer
  const [latestDraft, setLatestDraft] = useState(null);    // for context panel
  const [summary, setSummary] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);   // Phase 3.7.2

  // Phase 3.7.2 — global Cmd/Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  // Pull /summary once on mount so the status + recent activity rail
  // has live numbers. Failure is silent — the page works without it.
  useEffect(() => {
    if (!isFounder) return;
    apiClient
      .get("/admin/orion-logs/summary")
      .then((r) => setSummary(r.data))
      .catch(() => setSummary(null));
  }, [isFounder]);

  // Phase 3.7.3 — startup validation. Logs descriptive console errors
  // if any sidebar id / dashboard tile / palette entry references an
  // unregistered section or has a missing prompt. Catches stale IDs
  // immediately instead of surfacing as a generic "widget not found".
  useEffect(() => {
    if (!isFounder) return;
    const REGISTERED_HANDLERS = new Set([
      "dashboard", "chat", "briefing", "actions", "reports", "alerts",
      "approvals", "support", "moderation", "realms", "widgets", "badges",
      "settings", "ai-command", "private-access", "ai-usage", "public-rules",
    ]);
    const SOON_OK = new Set(["workflows", "tasks", "automations"]);
    const missingSections = NAV_SECTIONS
      .filter((s) => !s.soon && !REGISTERED_HANDLERS.has(s.id))
      .map((s) => s.id);
    if (missingSections.length) {
      // eslint-disable-next-line no-console
      console.error(
        "[ORAi] startup validation: NAV_SECTIONS contains unregistered ids → " +
        JSON.stringify(missingSections) +
        ". Add a handler in SectionRouter or mark them `soon: true`.",
      );
    }
    const soonsWithoutFlag = NAV_SECTIONS
      .filter((s) => SOON_OK.has(s.id) && !s.soon)
      .map((s) => s.id);
    if (soonsWithoutFlag.length) {
      // eslint-disable-next-line no-console
      console.warn(
        "[ORAi] startup validation: sections " + JSON.stringify(soonsWithoutFlag) +
        " are coming-soon but not flagged.",
      );
    }
    const tilesMissingPrompt = QUICK_TILES.filter((t) => !t.prompt || !t.id).map((t) => t.id || t.label);
    if (tilesMissingPrompt.length) {
      // eslint-disable-next-line no-console
      console.error(
        "[ORAi] startup validation: QUICK_TILES missing prompt or id → " +
        JSON.stringify(tilesMissingPrompt),
      );
    }
    const emptyGroups = PROMPT_LIBRARY.filter((g) => !g.prompts || g.prompts.length === 0).map((g) => g.group);
    if (emptyGroups.length) {
      // eslint-disable-next-line no-console
      console.warn(
        "[ORAi] startup validation: empty PROMPT_LIBRARY groups → " + JSON.stringify(emptyGroups),
      );
    }
    // Server-side health probe — surfaces missing widget_registry row,
    // missing LLM keys, etc. Failure is logged but does not block the UI.
    apiClient
      .get("/admin/orion/health")
      .then((r) => {
        const checks = r.data?.checks || [];
        const failed = checks.filter((c) => !c.ok);
        const total = checks.length;
        if (failed.length === 0) {
          // eslint-disable-next-line no-console
          console.info(`[ORAi] backend health check ok (${total} checks).`);
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[ORAi] backend health check: ${total - failed.length}/${total} ok — failing: ` +
            failed.map((c) => `${c.name} (${c.detail})`).join(" · "),
          );
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[ORAi] backend health endpoint unreachable:", err?.message || err);
      });
  }, [isFounder]);

  if (!isFounder) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" data-testid="orion-cc-refused">
        <div className="or-surface p-6 max-w-md text-center">
          <AlertTriangle size={28} style={{ color: "var(--text-muted)" }} className="mx-auto mb-2" />
          <div className="font-bold mb-1" style={{ color: "var(--text-main)" }}>
            Founder Command Center
          </div>
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            ORAi&apos;s full-screen mission control is only available to the OurRealm founder.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="orion-cc-root" data-testid="orion-cc-root">
      <OrionStyles />
      {/* Mobile top bar with hamburger */}
      <div className="orion-mobile-topbar lg:hidden">
        <button
          className="orion-icon-btn"
          onClick={() => setSidebarOpen(true)}
          data-testid="orion-cc-sidebar-toggle"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center gap-2">
          <OrionLogo size={20} />
          <div className="font-extrabold tracking-wide" style={{ color: "var(--orion-fg)" }}>ORAi</div>
        </div>
        <Link to="/admin/orion-logs" className="orion-icon-btn" data-testid="orion-cc-logs-link-mobile" aria-label="Audit logs">
          <Activity size={16} />
        </Link>
      </div>

      <div className="orion-cc-grid">
        {/* Sidebar — desktop always visible; mobile slides in */}
        <aside
          className={`orion-sidebar ${sidebarOpen ? "open" : ""}`}
          data-testid="orion-cc-sidebar"
        >
          <div className="orion-brand">
            <OrionLogo size={28} />
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em]" style={{ color: "var(--orion-muted)" }}>
                Founder
              </div>
              <div className="font-extrabold" style={{ color: "var(--orion-fg)", letterSpacing: 1 }}>
                ORAi
              </div>
            </div>
            <button
              className="lg:hidden ml-auto orion-icon-btn"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          </div>
          <nav className="orion-nav" data-testid="orion-cc-nav">
            {NAV_SECTIONS.map((s) => (
              <NavItem
                key={s.id}
                active={section === s.id}
                onClick={() => { if (s.href) { window.location.href = s.href; return; } setSection(s.id); setSidebarOpen(false); }}
                icon={s.icon}
                label={s.label}
                soon={s.soon}
                testid={`orion-cc-nav-${s.id}`}
              />
            ))}
            <div className="orion-nav-group-label">Phase 4.0 — reserved</div>
            {NAV_FUTURE.map((s) => (
              <NavItem
                key={s.id}
                icon={s.icon}
                label={s.label}
                soon
                disabled
                testid={`orion-cc-nav-${s.id}`}
              />
            ))}
          </nav>
          <div className="orion-sidebar-footer">
            <Link to="/admin/orion-logs" className="orion-link" data-testid="orion-cc-logs-link">
              <Activity size={14} /> Audit logs
            </Link>
          </div>
        </aside>

        {/* Main content */}
        <main className="orion-main">
          <SectionRouter
            section={section}
            summary={summary}
            onDraft={setLatestDraft}
            sectionNav={(id) => setSection(id)}
          />
        </main>

        {/* Right context panel — visible ≥xl */}
        <aside className="orion-context" data-testid="orion-cc-context">
          <StatusCard summary={summary} />
          <ContextDraftCard draft={latestDraft} />
          <RecentActivityCard summary={summary} />
          <RoadmapCard />
        </aside>
      </div>

      {/* Mobile drawer scrim */}
      {sidebarOpen && (
        <div className="orion-scrim lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Phase 3.7.2 — Cmd/Ctrl+K command palette */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSection={(id) => { setSection(id); setSidebarOpen(false); }}
        onPrompt={(p) => {
          setSection("chat");
          setTimeout(() => window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p })), 50);
        }}
      />
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Section router
// ─────────────────────────────────────────────────────────────────────
function SectionRouter({ section, summary, onDraft, sectionNav }) {
  if (section === "chat")      return <OrionChat onDraft={onDraft} />;
  if (section === "briefing")  return <BriefingPanel onDraft={onDraft} />;
  if (section === "actions")   return <QuickActions onPick={(p) => { onDraft(null); sectionNav("chat"); setTimeout(() => window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p })), 50); }} />;
  if (section === "reports")   return <SimplePromptList title="Reports" intros={["Show DAU WAU MAU", "Show today's snapshot", "Show me the top realms this week"]} onPrompt={(p) => sectionNav("chat") || window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p }))} />;
  if (section === "alerts")    return <SimplePromptList title="Alerts" intros={["Any risky moderation issues right now?", "Show open support tickets", "Oldest unresolved tickets"]} onPrompt={(p) => sectionNav("chat") || window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p }))} />;
  if (section === "approvals") return <ApprovalsPanel />;
  if (section === "support")   return <SimplePromptList title="Support" intros={["Show open support tickets", "Oldest unresolved tickets", "Draft a reply for the oldest support ticket"]} onPrompt={(p) => sectionNav("chat") || window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p }))} />;
  if (section === "moderation") return <SimplePromptList title="Moderation" intros={["Show open moderation reports", "Most reported users this week", "Most reported content", "Any risky moderation issues right now?"]} onPrompt={(p) => sectionNav("chat") || window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p }))} />;
  if (section === "realms")    return <SimplePromptList title="Realms" intros={["Show me the top realms this week", "New realms this week", "Inactive realms"]} onPrompt={(p) => sectionNav("chat") || window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p }))} />;
  if (section === "widgets")   return <SimplePromptList title="Widgets" intros={["All launched widgets", "Disabled widgets", "Most used widgets"]} onPrompt={(p) => sectionNav("chat") || window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p }))} />;
  if (section === "badges")    return <SimplePromptList title="Badges" intros={["How many VIP holders?", "Show badge stats", "Beta holders"]} onPrompt={(p) => sectionNav("chat") || window.dispatchEvent(new CustomEvent("orion-prefill", { detail: p }))} />;
  if (section === "settings")  return <SettingsPanel summary={summary} />;
  if (section === "private-access") return <OraiPrivateAccess />;
  if (section === "ai-usage")  return <OraiUsageDashboard />;
  if (section === "classic")   return <Dashboard summary={summary} onSection={sectionNav} />;
  // Default: upgraded ORAi control-center dashboard (hero + live chat)
  return <OraiDashboard onSection={sectionNav} Chat={OrionChat} onDraft={onDraft} />;
}


// ─────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────
function Dashboard({ summary, onSection }) {
  return (
    <div className="orion-section" data-testid="orion-cc-dashboard">
      <SectionHeader
        title="Mission Control"
        subtitle="Live operating system for OurRealm. Reuses Phase 3.6 analytics and Phase 3.7 draft tools."
      />
      <div className="orion-stat-grid">
        <Stat label="Queries today"    value={summary?.query_today ?? "—"}  hue="#22D3EE" />
        <Stat label="Queries (all-time)" value={summary?.query_total ?? "—"} hue="#60A5FA" />
        <Stat label="Refused"          value={summary?.query_refused ?? "—"} hue="#FB7185" />
        <Stat label="Actions today"    value={summary?.action_today ?? "—"}  hue="#A78BFA" />
        <Stat label="Drafts pending"   value={summary?.action_pending ?? "—"} hue="#F59E0B" />
        <Stat label="Approvals"        value={summary?.action_approved ?? "—"} hue="#34D399" />
      </div>

      <h3 className="orion-h3 mt-6">Jump in</h3>
      <div className="orion-tile-grid">
        {QUICK_TILES.slice(0, 6).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { onSection("chat"); setTimeout(() => window.dispatchEvent(new CustomEvent("orion-prefill", { detail: t.prompt })), 50); }}
            className="orion-tile"
            style={{ ["--tile-accent"]: t.accent }}
            data-testid={`orion-cc-tile-${t.id}`}
          >
            <t.icon size={18} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <h3 className="orion-h3 mt-6">Sections</h3>
      <div className="orion-tile-grid">
        {NAV_SECTIONS.filter(s => !["dashboard","settings"].includes(s.id)).slice(0, 8).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSection(s.id)}
            className="orion-tile"
            style={{ ["--tile-accent"]: "#22D3EE" }}
            data-testid={`orion-cc-jump-${s.id}`}
          >
            <s.icon size={16} />
            <span>{s.label}{s.soon ? " (soon)" : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// ORAi Chat — full conversational workspace
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// Phase 3.7.2 — Simulated token reveal. The ORAi analytics tools
// return deterministic replies in one shot (no upstream OpenAI for
// analytics intents). We progressively reveal the reply so the UX
// feels like a streaming AI. Speed adapts to length so short
// snapshots feel snappy and long briefings still finish in <2s.
// ─────────────────────────────────────────────────────────────────────
async function streamReveal(text, onChunk) {
  if (!text) return;
  const total = text.length;
  // Aim for ~30 frames (so ~500ms at 60fps for short, ~1.5s for long).
  const chunkSize = Math.max(6, Math.ceil(total / 30));
  for (let i = chunkSize; i < total; i += chunkSize) {
    onChunk(text.slice(0, i));
    // 16ms ≈ 1 paint frame; longer for paragraph breaks for natural rhythm.
    const pause = text[i - 1] === "\n" ? 28 : 14;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, pause));
  }
  onChunk(text);
}

const IMG_INTENT = /\b(create|generate|make|design|draw|render|regenerate)\b.{0,60}\b(image|picture|photo|logo|banner|poster|icon|avatar|pfp|wallpaper|illustration|artwork|art|mockup|thumbnail|graphic)\b|\b(remove (the )?background|photorealistic|variation|upscale|enhance|restyle)\b/i;

function OrionChat({ onDraft }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [attach, setAttach] = useState(null); // {dataUrl, b64, name}
  const [imgState, setImgState] = useState(""); // "", "Uploading", "Generating image", "Editing image"
  const fileRef = useRef(null);
  const scrollRef = useRef(null);

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { setErr("Please attach an image file."); return; }
    if (f.size > 10 * 1024 * 1024) { setErr("Image too large — 10 MB max."); return; }
    setImgState("Uploading");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setAttach({ dataUrl, b64: String(dataUrl).split(",")[1] || "", name: f.name });
      setImgState("");
    };
    reader.onerror = () => { setImgState(""); setErr("Could not read that image."); };
    reader.readAsDataURL(f);
  };

  // Load history once.
  useEffect(() => {
    apiClient
      .get(`/widgets/chat/history?widget_id=${ORION_WIDGET_ID}`)
      .then((r) => setMessages(r.data?.messages || []))
      .catch(() => {});
  }, []);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Listen for prefill events from Quick Actions tiles / suggested chips.
  useEffect(() => {
    const onPrefill = (e) => {
      setInput(e?.detail || "");
      // Auto-submit after a tick.
      setTimeout(() => {
        const evt = new CustomEvent("orion-submit-now");
        window.dispatchEvent(evt);
      }, 80);
    };
    window.addEventListener("orion-prefill", onPrefill);
    return () => window.removeEventListener("orion-prefill", onPrefill);
  }, []);

  const send = useCallback(async (text) => {
    const body = (text || input || "").trim();
    if ((!body && !attach) || busy) return null;
    const message = body || "Edit this image.";
    const upload = attach;
    setBusy(true); setErr("");
    setInput(""); setAttach(null);
    const isImage = !!upload || IMG_INTENT.test(message);
    setImgState(isImage ? (upload ? "Editing image" : "Generating image") : "");
    const userMsg = { role: "user", content: message, image_url: null, _localImage: upload?.dataUrl || null, created_at: new Date().toISOString() };
    setMessages((p) => [...p, userMsg]);
    try {
      const { data } = await apiClient.post("/widgets/chat/message", {
        widget_id: ORION_WIDGET_ID,
        message,
        ...(upload ? { image_b64: upload.b64 } : {}),
      }, { timeout: 180000 });
      const reply = data?.reply || "";
      if (data?.image_url) {
        // Image tool result — show immediately, no token streaming.
        setMessages((p) => [...p, {
          role: "assistant", content: reply, model: data?.model,
          image_url: data.image_url, created_at: new Date().toISOString(),
        }]);
        setImgState("");
        setBusy(false);
        return reply;
      }
      // Phase 3.7.2 — simulated token streaming. The ORAi analytics
      // interceptor returns deterministic replies (no upstream OpenAI
      // call for analytics/draft tools), so token-by-token streaming
      // from the model isn't available. We progressively reveal the
      // reply so the UX still feels like a live AI assistant.
      const aiBase = {
        role: "assistant", content: "", model: data?.model,
        fallback: !!(data?.provider && data.provider !== "openai"),
        image_url: data?.image_url || null,
        created_at: new Date().toISOString(), _streaming: true,
      };
      setMessages((p) => [...p, aiBase]);
      await streamReveal(reply, (partial) => {
        setMessages((p) => {
          const next = [...p];
          next[next.length - 1] = { ...next[next.length - 1], content: partial };
          return next;
        });
      });
      setMessages((p) => {
        const next = [...p];
        next[next.length - 1] = { ...next[next.length - 1], _streaming: false };
        return next;
      });
      // Detect drafts → bubble up to context panel.
      const draftHit = DRAFT_HEADERS.find((d) => d.match.test(reply));
      if (draftHit) onDraft({ type: draftHit.type, content: reply, ts: Date.now() });
      return reply;
    } catch (e) {
      setErr(e?.response?.data?.detail || "ORAi is unavailable right now.");
      return null;
    } finally {
      setBusy(false);
      setImgState("");
    }
  }, [input, busy, onDraft, attach]);

  useEffect(() => {
    const handler = () => send();
    window.addEventListener("orion-submit-now", handler);
    return () => window.removeEventListener("orion-submit-now", handler);
  }, [send]);

  const clearChat = async () => {
    if (busy) return;
    try { await apiClient.post("/widgets/chat/clear", { widget_id: ORION_WIDGET_ID }); } catch { /* ignore */ }
    setMessages([]);
  };

  return (
    <div className="orion-section orion-chat" data-testid="orion-cc-chat">
      <SectionHeader
        title="ORAi Chat"
        subtitle="Conversational workspace — every reply runs against the live Phase 3.6 / 3.7 backend tools."
        actions={(
          <button
            type="button"
            onClick={clearChat}
            className="orion-btn-ghost"
            data-testid="orion-cc-chat-clear"
            disabled={busy}
          >
            <RefreshCw size={12} /> <span>Clear</span>
          </button>
        )}
      />
      <div className="orion-chat-stream" ref={scrollRef} data-testid="orion-cc-chat-stream">
        {messages.length === 0 && (
          <div className="orion-chat-empty">
            <OrionLogo size={48} />
            <div className="text-sm mt-3" style={{ color: "var(--orion-muted)" }}>
              Ask ORAi anything. Try a quick action below.
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} msg={m} onDraft={onDraft} onImageAction={(action) => {
            if (action === "regenerate") send("Regenerate the same image with the same instructions.");
            else if (action === "variation") send("Create a variation of this image.");
            else if (action === "edit") {
              setInput("Edit this image: ");
              document.querySelector('[data-testid="orion-cc-input"]')?.focus();
            }
          }} />
        ))}
        {busy && (
          <div className="orion-chat-row orion-chat-row-ai">
            <div className="orion-chat-bubble orion-chat-bubble-ai">
              {imgState ? (
                <span className="flex items-center gap-2" data-testid="orion-img-progress">
                  <Loader2 size={13} className="animate-spin" /> {imgState}…
                </span>
              ) : (
                <ThinkingStates />
              )}
            </div>
          </div>
        )}
        {err && (
          <div className="orion-chat-row">
            <div className="orion-chat-bubble" style={{ background: "rgba(255,80,80,0.12)", color: "#FCA5A5" }}>
              {err}
            </div>
          </div>
        )}
      </div>

      <div className="orion-suggested" data-testid="orion-cc-suggested">
        <PromptLibrary onPick={(p) => send(p)} disabled={busy} />
      </div>

      <OraiVoiceBar onSubmit={(t) => send(t)} accent="#4DD6C1" testidPrefix="orion-cc" />

      <form
        className="orion-composer"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <input type="file" accept="image/*" ref={fileRef} onChange={pickFile} style={{ display: "none" }} data-testid="orion-cc-file" />
        <button
          type="button"
          className="orion-send-btn"
          style={{ background: "transparent", border: "1px solid var(--orion-line)" }}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Attach an image to edit"
          data-testid="orion-cc-attach"
        >
          <ImagePlus size={16} />
        </button>
        {attach && (
          <span className="flex items-center gap-1.5 shrink-0" data-testid="orion-cc-attach-chip">
            <img src={attach.dataUrl} alt="attachment" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 8, border: "1px solid var(--orion-cyan)" }} />
            <button type="button" onClick={() => setAttach(null)} style={{ color: "var(--orion-muted)" }} aria-label="Remove attachment" data-testid="orion-cc-attach-remove">
              <X size={13} />
            </button>
          </span>
        )}
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={attach ? "Describe how to edit this image…" : "Ask ORAi…"}
          className="orion-input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          data-testid="orion-cc-input"
        />
        <button
          type="submit"
          className="orion-send-btn"
          disabled={busy || (!input.trim() && !attach)}
          data-testid="orion-cc-send"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Briefing — one-shot view that auto-fires the Founder Briefing on mount.
// ─────────────────────────────────────────────────────────────────────
function BriefingPanel({ onDraft }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    apiClient
      .post("/widgets/chat/message", { widget_id: ORION_WIDGET_ID, message: "Give me a founder briefing" })
      .then((r) => { if (!cancelled) { setReply(r.data?.reply || ""); onDraft && onDraft({ type: "briefing", content: r.data?.reply || "", ts: Date.now() }); } })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.detail || "Failed."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [onDraft]);
  return (
    <div className="orion-section" data-testid="orion-cc-briefing">
      <SectionHeader title="Founder Briefing" subtitle="Composite executive summary — pulled live from realm_pulse + counts." />
      {busy && <div className="orion-skel"><Loader2 size={14} className="animate-spin" /> <span className="ml-1.5">Pulling live numbers…</span></div>}
      {err && <div className="orion-error" data-testid="orion-cc-briefing-error">{err}</div>}
      {reply && <Markdown text={reply} onDraft={onDraft} />}
    </div>
  );
}


// Phase 3.7.4 — localStorage-backed favorites + recently-used registry
// for Quick Actions. Tiny, no external state lib.
const ORION_FAVS_KEY = "orion-cc-quick-favorites";
const ORION_RECENT_KEY = "orion-cc-quick-recent";

function loadStringSet(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
function saveStringSet(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr.slice(0, 32))); } catch { /* */ }
}

function QuickActions({ onPick }) {
  const [favorites, setFavorites] = useState(() => loadStringSet(ORION_FAVS_KEY));
  const [recent, setRecent] = useState(() => loadStringSet(ORION_RECENT_KEY));
  const [search, setSearch] = useState("");

  const toggleFav = useCallback((id) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      saveStringSet(ORION_FAVS_KEY, next);
      return next;
    });
  }, []);

  const handlePick = useCallback((tile) => {
    setRecent((prev) => {
      const next = [tile.id, ...prev.filter((x) => x !== tile.id)].slice(0, 6);
      saveStringSet(ORION_RECENT_KEY, next);
      return next;
    });
    onPick(tile.prompt);
  }, [onPick]);

  // Categories — group tiles by accent-bucket heuristically. The
  // existing QUICK_TILES list is small enough that the labels below
  // remain stable and meaningful.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = QUICK_TILES.filter((t) =>
      !q || t.label.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q)
    );
    const byId = Object.fromEntries(filtered.map((t) => [t.id, t]));
    const groups = [];
    if (favorites.length) {
      const items = favorites.map((id) => byId[id]).filter(Boolean);
      if (items.length) groups.push({ key: "favorites", label: "Favorites", icon: Star, items });
    }
    if (recent.length) {
      const items = recent.map((id) => byId[id]).filter(Boolean);
      if (items.length) groups.push({ key: "recent", label: "Recently used", icon: RefreshCw, items });
    }
    groups.push({ key: "all", label: "All actions", icon: Zap, items: filtered });
    return groups;
  }, [favorites, recent, search]);

  return (
    <div className="orion-section" data-testid="orion-cc-actions">
      <SectionHeader title="Quick Action Center" subtitle="Tap a tile to send the matching command to ORAi." />
      <div className="orion-quick-toolbar">
        <div className="orion-quick-search">
          <SearchIcon size={12} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quick actions…"
            data-testid="orion-cc-quick-search"
          />
        </div>
        {favorites.length > 0 && (
          <button
            type="button"
            className="or-btn-ghost text-xs"
            onClick={() => { setFavorites([]); saveStringSet(ORION_FAVS_KEY, []); }}
            data-testid="orion-cc-quick-clear-favs"
          >
            Clear favorites
          </button>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.key} className="orion-quick-group" data-testid={`orion-cc-quick-group-${g.key}`}>
          <div className="orion-quick-group-label">
            <g.icon size={12} /> <span>{g.label}</span>
            <span className="orion-quick-group-count">{g.items.length}</span>
          </div>
          <div className="orion-tile-grid">
            {g.items.length === 0 && (
              <div className="orion-quick-empty">No matches.</div>
            )}
            {g.items.map((t) => {
              const fav = favorites.includes(t.id);
              return (
                <div
                  key={`${g.key}-${t.id}`}
                  className="orion-tile orion-tile-with-pin"
                  style={{ ["--tile-accent"]: t.accent }}
                  data-testid={`orion-cc-quick-${t.id}`}
                >
                  <button
                    type="button"
                    onClick={() => handlePick(t)}
                    className="orion-tile-body"
                    data-testid={`orion-cc-quick-${t.id}-launch`}
                  >
                    <t.icon size={20} />
                    <span>{t.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleFav(t.id); }}
                    className={`orion-tile-pin ${fav ? "orion-tile-pin-on" : ""}`}
                    title={fav ? "Remove from favorites" : "Pin to favorites"}
                    data-testid={`orion-cc-quick-${t.id}-pin`}
                  >
                    <Pin size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


function SimplePromptList({ title, intros, onPrompt }) {
  return (
    <div className="orion-section" data-testid={`orion-cc-list-${title.toLowerCase()}`}>
      <SectionHeader title={title} subtitle="One-tap into the relevant ORAi command. Replies stream into ORAi Chat." />
      <div className="space-y-2">
        {intros.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPrompt(p)}
            className="orion-list-item"
            data-testid={`orion-cc-list-prompt-${p.slice(0, 16).replace(/\W+/g, "-")}`}
          >
            <Sparkles size={14} />
            <span>{p}</span>
            <ChevronRight size={14} className="ml-auto" />
          </button>
        ))}
      </div>
    </div>
  );
}


// Phase 3.7.5 — Approval UX polish helpers
//
// Maps backend action_type strings to a (label, icon, accent) triple
// so each approval row gets a meaningful badge + colored left rail.
const APPROVAL_KIND = {
  draft_badge:        { label: "Badge",        Icon: Award,        accent: "#FBBF24" },
  draft_widget:       { label: "Widget",       Icon: Layers,       accent: "#22D3EE" },
  draft_announcement: { label: "Announcement", Icon: Bell,         accent: "#F59E0B" },
  draft_support:      { label: "Support reply", Icon: LifeBuoy,    accent: "#34D399" },
  draft_moderation:   { label: "Moderation",   Icon: Shield,       accent: "#FB7185" },
  provider_switch:    { label: "Provider",     Icon: RefreshCw,    accent: "#A78BFA" },
  provider_failure:   { label: "Provider",     Icon: AlertTriangle, accent: "#EF4444" },
};
function _kindFor(actionType) {
  return APPROVAL_KIND[actionType] || { label: actionType || "Draft", Icon: FileText, accent: "#94A3B8" };
}
function _relativeTime(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)        return `${Math.round(diff)}s ago`;
    if (diff < 3600)      return `${Math.round(diff / 60)}m ago`;
    if (diff < 86_400)    return `${Math.round(diff / 3600)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return "—"; }
}
function _draftTitle(row) {
  const txt = (row.requested_action || row.short_result_summary || "").trim();
  if (!txt) return `Untitled ${_kindFor(row.action_type).label}`;
  return txt.length > 64 ? txt.slice(0, 64) + "…" : txt;
}

function ApprovalsPanel() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [active, setActive] = useState(null);

  const load = useCallback(() => {
    setBusy(true);
    apiClient.get("/admin/orion-logs/actions?approval_status=pending&limit=50")
      .then((r) => setRows(r.data?.rows || []))
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="orion-section" data-testid="orion-cc-approvals">
      <div className="flex items-start justify-between gap-3">
        <SectionHeader
          title="Pending Approvals"
          subtitle="Drafts awaiting explicit confirmation. Phase 3.7 is draft-only — live approval & publishing arrives in Phase 3.8."
        />
        <button
          type="button"
          onClick={load}
          className="or-btn-ghost text-xs shrink-0"
          data-testid="orion-cc-approvals-refresh"
          disabled={busy}
        >
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          <span className="ml-1">Refresh</span>
        </button>
      </div>

      {busy && (
        <div className="orion-skel" data-testid="orion-cc-approvals-loading">
          <Loader2 size={14} className="animate-spin" />
          <span className="ml-2">Loading pending drafts…</span>
        </div>
      )}
      {!busy && rows.length === 0 && (
        <div className="orion-empty" data-testid="orion-cc-approvals-empty">
          <CheckCircle size={14} style={{ display: "inline-block", marginRight: 6, verticalAlign: "-2px", color: "#34D399" }} />
          No pending drafts right now. ORAi is idle.
        </div>
      )}

      <div className="orion-approval-grid">
        {rows.map((r, i) => {
          const kind = _kindFor(r.action_type);
          return (
            <button
              type="button"
              key={`${r.timestamp}-${i}`}
              onClick={() => setActive(r)}
              className="orion-approval-card"
              style={{ ["--ap-accent"]: kind.accent }}
              data-testid={`orion-cc-approval-row-${i}`}
            >
              <div className="orion-approval-icon">
                <kind.Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="orion-approval-meta">
                  <span className="orion-approval-kind">{kind.label}</span>
                  <span className="orion-approval-dot">•</span>
                  <span className="orion-approval-author">Generated by ORAi</span>
                  <span className="orion-approval-dot">•</span>
                  <span className="orion-approval-time">{_relativeTime(r.timestamp)}</span>
                </div>
                <div className="orion-approval-title" data-testid={`orion-cc-approval-title-${i}`}>
                  {_draftTitle(r)}
                </div>
                {r.short_result_summary && (
                  <div className="orion-approval-summary">{r.short_result_summary}</div>
                )}
              </div>
              <div className="orion-approval-status">
                <span className="orion-status-pill orion-status-pending" data-testid={`orion-cc-approval-status-${i}`}>
                  Pending
                </span>
                <span className="orion-status-pill orion-status-draft">Draft Only</span>
              </div>
              <ChevronRight size={16} className="orion-approval-chev" />
            </button>
          );
        })}
      </div>

      {active && (
        <ApprovalDetailsModal
          row={active}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function ApprovalDetailsModal({ row, onClose }) {
  const kind = _kindFor(row.action_type);
  const created = (() => {
    try { return new Date(row.timestamp).toLocaleString(); }
    catch { return row.timestamp || "—"; }
  })();

  // Esc to close
  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  return createPortal(
    <div
      className="orion-modal-scrim"
      onClick={onClose}
      data-testid="orion-cc-approval-modal-scrim"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Approval details: ${kind.label}`}
        className="orion-modal"
        style={{ ["--ap-accent"]: kind.accent }}
        onClick={(e) => e.stopPropagation()}
        data-testid="orion-cc-approval-modal"
      >
        <div className="orion-modal-head">
          <div className="orion-modal-head-icon"><kind.Icon size={18} /></div>
          <div className="flex-1 min-w-0">
            <div className="orion-approval-meta">
              <span className="orion-approval-kind">{kind.label}</span>
              <span className="orion-approval-dot">•</span>
              <span className="orion-approval-author">Generated by ORAi</span>
              <span className="orion-approval-dot">•</span>
              <span className="orion-approval-time">{created}</span>
            </div>
            <h3 className="orion-modal-title">{_draftTitle(row)}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="orion-modal-close"
            aria-label="Close"
            data-testid="orion-cc-approval-modal-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="orion-modal-body">
          {/* Read-only preview */}
          <SectionLabel>Draft Preview</SectionLabel>
          <div className="orion-modal-preview" data-testid="orion-cc-approval-modal-preview">
            {row.requested_action
              ? <BasicMarkdown text={row.requested_action} />
              : <span className="orion-empty">No preview content captured for this draft.</span>}
          </div>

          {/* Configuration / properties */}
          <SectionLabel className="mt-5">Properties</SectionLabel>
          <dl className="orion-modal-kv" data-testid="orion-cc-approval-modal-props">
            <Kv k="Type"     v={kind.label} />
            <Kv k="Tool"     v={row.tool_called || "—"} />
            <Kv k="Created"  v={created} />
            <Kv k="Status"   v={row.approval_status || "pending"} pillColor="#F59E0B" />
            <Kv k="Confirmation required" v={row.confirmation_required ? "Yes" : "No"} />
            <Kv k="Prepared draft"        v={row.prepared_draft ? "Yes" : "No"} />
            <Kv k="Result"   v={row.result || "draft_only"} />
            <Kv k="Latency"  v={`${row.execution_time_ms ?? 0} ms`} />
          </dl>

          {/* ORAi summary */}
          {row.short_result_summary && (
            <>
              <SectionLabel className="mt-5">ORAi summary</SectionLabel>
              <div className="orion-modal-summary">{row.short_result_summary}</div>
            </>
          )}

          {/* Draft-only notice */}
          <div className="orion-modal-notice" data-testid="orion-cc-approval-modal-notice">
            <AlertTriangle size={14} />
            <span>
              This draft is awaiting execution. Live approval and publishing
              will be available in Phase 3.8.
            </span>
          </div>
        </div>

        <div className="orion-modal-actions" data-testid="orion-cc-approval-modal-actions">
          {[
            { id: "edit",    label: "Edit",    Icon: FileText },
            { id: "approve", label: "Approve", Icon: CheckCircle },
            { id: "decline", label: "Decline", Icon: XCircle },
            { id: "delete",  label: "Delete",  Icon: X },
          ].map((b) => (
            <button
              key={b.id}
              type="button"
              disabled
              aria-disabled="true"
              className={`orion-modal-action orion-modal-action-${b.id}`}
              title="Available in Phase 3.8"
              data-testid={`orion-cc-approval-action-${b.id}`}
            >
              <b.Icon size={13} />
              <span>{b.label}</span>
              <span className="orion-modal-action-tag">Phase 3.8</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SectionLabel({ children, className = "" }) {
  return (
    <div
      className={`text-[10px] uppercase tracking-widest font-bold ${className}`}
      style={{ color: "var(--orion-muted)", marginBottom: 6 }}
    >
      {children}
    </div>
  );
}

function Kv({ k, v, pillColor }) {
  return (
    <div className="orion-modal-kv-row">
      <dt>{k}</dt>
      <dd>
        {pillColor ? (
          <span className="orion-status-pill" style={{ background: `${pillColor}22`, color: pillColor }}>{v}</span>
        ) : v}
      </dd>
    </div>
  );
}


function SettingsPanel({ summary }) {
  // Phase 3.7.4 — embed the live Health Dashboard inside Settings so
  // the founder can scan every ORAi subsystem without leaving the
  // command center. Reuses the existing /api/admin/orion/health
  // endpoint with the 30s cache (refresh button forces fresh=1).
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/admin/orion/health", { params: fresh ? { fresh: 1 } : {} });
      setHealth(data);
    } catch (e) {
      setHealth({ ok: false, _err: e?.message || "unreachable", checks: [] });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(false); }, [load]);

  return (
    <div className="orion-section" data-testid="orion-cc-settings">
      <SectionHeader title="Settings & Health" subtitle="ORAi runtime state plus the live subsystem health snapshot." />
      <div className="orion-stat-grid">
        <Stat label="Mode" value="Read-only" hue="#22D3EE" />
        <Stat label="Engine" value="orai-analytics" hue="#60A5FA" />
        <Stat label="Memory" value="Persistent" hue="#A78BFA" />
        <Stat label="Audit logging" value="Active" hue="#34D399" />
        <Stat label="Provider" value={(health?.active_provider || "—").toUpperCase()} hue="#F59E0B" />
        <Stat label="Phase" value="3.7.4" hue="#FB7185" />
      </div>

      <div className="flex items-center justify-between mt-6 mb-2">
        <h3 className="text-sm font-bold" style={{ color: "var(--orion-fg)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Subsystem Health
        </h3>
        <button
          type="button"
          onClick={() => load(true)}
          className="or-btn-ghost text-xs"
          data-testid="orion-cc-health-refresh"
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          <span className="ml-1">Refresh</span>
        </button>
      </div>

      {health && (
        <div className="text-[11px]" style={{ color: "var(--orion-muted)" }} data-testid="orion-cc-health-meta">
          Overall: {health.ok ? "🟢 Healthy" : "🔴 Issues detected"}
          {health.auto_healed ? " · 🟡 auto-healed this session" : ""}
          {typeof health.age_s === "number" ? ` · checked ${health.age_s}s ago` : ""}
          {health.cached ? " · (cached)" : ""}
        </div>
      )}

      <div className="orion-health-grid" data-testid="orion-cc-health-grid">
        {(health?.checks || []).map((c) => {
          const accent = c.ok ? (health.auto_healed && c.name === "widget_registry" ? "#F59E0B" : "#22C55E") : "#EF4444";
          const Pill = c.ok ? CheckCircle : XCircle;
          return (
            <div
              key={c.name}
              className="orion-health-row"
              style={{ ["--health-accent"]: accent }}
              data-testid={`orion-cc-health-${c.name}`}
            >
              <div className="flex-1 min-w-0">
                <div className="orion-health-row-name">{c.name.replace(/_/g, " ")}</div>
                <div className="orion-health-row-detail">{c.detail}</div>
              </div>
              <span className="orion-health-pill"><Pill size={11} /> {c.ok ? "ok" : "fail"}</span>
            </div>
          );
        })}
        {!loading && (!health || (health.checks || []).length === 0) && (
          <div className="orion-quick-empty">No health checks returned.</div>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Chat bubble + lightweight markdown renderer + draft card detection
// ─────────────────────────────────────────────────────────────────────
function ChatBubble({ msg, onDraft, onImageAction }) {
  const imgSrc = (u) => (u && u.startsWith("http") ? u : `${process.env.REACT_APP_BACKEND_URL}${u}`);
  const mine = msg.role === "user";
  return (
    <div className={`orion-chat-row ${mine ? "orion-chat-row-mine" : "orion-chat-row-ai"}`}>
      <div className={`orion-chat-bubble ${mine ? "orion-chat-bubble-mine" : "orion-chat-bubble-ai"}`}>
        {!mine && (
          <div className="orion-chat-meta">
            <OrionLogo size={12} />
            <span className="ml-1.5">
              ORAi · {msg.model || "—"}{msg.fallback ? " · FALLBACK" : ""}
            </span>
          </div>
        )}
        {msg.image_url && (
          <>
            <img
              src={imgSrc(msg.image_url)}
              alt="ORAi generated"
              style={{ maxWidth: "100%", borderRadius: 10, margin: "6px 0" }}
              data-testid="orion-chat-image"
            />
            {!mine && onImageAction && (
              <div className="flex flex-wrap gap-1.5 mb-1" data-testid="orion-image-actions">
                <button type="button" className="orion-tile" style={{ padding: "3px 9px", fontSize: 11 }}
                  onClick={() => onImageAction("regenerate", msg)} data-testid="orion-img-regenerate">
                  <RefreshCw size={11} /> Regenerate
                </button>
                <button type="button" className="orion-tile" style={{ padding: "3px 9px", fontSize: 11 }}
                  onClick={() => onImageAction("variation", msg)} data-testid="orion-img-variation">
                  <Sparkles size={11} /> Variation
                </button>
                <button type="button" className="orion-tile" style={{ padding: "3px 9px", fontSize: 11 }}
                  onClick={() => onImageAction("edit", msg)} data-testid="orion-img-edit">
                  <Cog size={11} /> Edit again
                </button>
                <button type="button" className="orion-tile" style={{ padding: "3px 9px", fontSize: 11 }}
                  onClick={() => window.open(imgSrc(msg.image_url), "_blank")} data-testid="orion-img-fullscreen">
                  <Maximize2 size={11} /> Full screen
                </button>
                <a className="orion-tile" style={{ padding: "3px 9px", fontSize: 11 }}
                  href={imgSrc(msg.image_url)} download="orai-image.png"
                  data-testid="orion-img-download">
                  ↓ Save
                </a>
              </div>
            )}
          </>
        )}
        {msg._localImage && (
          <img src={msg._localImage} alt="uploaded" style={{ maxWidth: 180, borderRadius: 10, margin: "6px 0" }} data-testid="orion-chat-upload-preview" />
        )}
        <Markdown text={msg.content || ""} onDraft={onDraft} />
      </div>
    </div>
  );
}

function Markdown({ text, onDraft }) {
  // Intercept Phase 3.7 drafts and render them as structured cards;
  // everything else falls through to the lightweight markdown
  // renderer below (bold / inline code / lists / fenced code blocks).
  const draftHit = DRAFT_HEADERS.find((d) => d.match.test(text || ""));
  if (draftHit && draftHit.type !== "briefing") {
    return <DraftCard kind={draftHit.type} content={text} onPin={() => onDraft && onDraft({ type: draftHit.type, content: text, ts: Date.now() })} />;
  }
  return <BasicMarkdown text={text} />;
}

function BasicMarkdown({ text }) {
  // Render `**bold**`, ``inline``, fenced ``` blocks, and bullet lists.
  // We intentionally avoid a heavy MD lib — ORAi replies are bounded
  // and consistent.
  const blocks = splitFenced(text || "");
  return (
    <div className="orion-md">
      {blocks.map((b, i) => b.kind === "code" ? (
        <pre key={i} className="orion-md-code"><code>{b.code}</code></pre>
      ) : (
        <BasicMarkdownPlain key={i} text={b.text} />
      ))}
    </div>
  );
}

function BasicMarkdownPlain({ text }) {
  const lines = (text || "").split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const bullet = /^\s*[•·\-*]\s+/.test(line);
        const clean = line.replace(/^\s*[•·\-*]\s+/, "");
        const inner = inlineFormat(clean);
        if (line.trim().length === 0) return <div key={i} className="h-1.5" />;
        if (bullet) return <div key={i} className="orion-md-bullet">• <span>{inner}</span></div>;
        return <div key={i} className="orion-md-line">{inner}</div>;
      })}
    </>
  );
}

function inlineFormat(line) {
  // Replace **bold** and `inline`. Returns React fragments.
  const parts = [];
  let rest = line;
  let i = 0;
  while (rest.length) {
    const b = rest.match(/\*\*([^*]+)\*\*/);
    const c = rest.match(/`([^`]+)`/);
    let pick = null;
    if (b && c) pick = (b.index <= c.index) ? { kind: "b", m: b } : { kind: "c", m: c };
    else if (b) pick = { kind: "b", m: b };
    else if (c) pick = { kind: "c", m: c };
    if (!pick) { parts.push(<span key={i++}>{rest}</span>); break; }
    if (pick.m.index > 0) parts.push(<span key={i++}>{rest.slice(0, pick.m.index)}</span>);
    if (pick.kind === "b") parts.push(<strong key={i++} className="orion-md-strong">{pick.m[1]}</strong>);
    else parts.push(<code key={i++} className="orion-md-inline">{pick.m[1]}</code>);
    rest = rest.slice(pick.m.index + pick.m[0].length);
  }
  return parts;
}

function splitFenced(text) {
  const out = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "code", lang: m[1], code: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}


// ─────────────────────────────────────────────────────────────────────
// Draft card — structured preview for Phase 3.7 drafts.
// ─────────────────────────────────────────────────────────────────────
function DraftCard({ kind, content, onPin }) {
  const [showTech, setShowTech] = useState(false);
  const meta = useMemo(() => extractDraftFields(content), [content]);
  const Icon = kind === "badge" ? Award
    : kind === "widget" ? Layers
    : kind === "announcement" ? Bell
    : kind === "support" ? LifeBuoy
    : kind === "moderation" ? Shield
    : Hexagon;
  const accent = kind === "badge" ? "#F59E0B"
    : kind === "widget" ? "#A78BFA"
    : kind === "announcement" ? "#34D399"
    : kind === "support" ? "#67E8F9"
    : kind === "moderation" ? "#FCA5A5"
    : "#22D3EE";
  const titleByKind = {
    badge: "Badge draft", widget: "Widget draft", announcement: "Announcement draft",
    support: "Support reply draft", moderation: "Moderation risks",
  };
  return (
    <div className="orion-draft-card" style={{ ["--draft-accent"]: accent }} data-testid={`orion-draft-card-${kind}`}>
      <div className="orion-draft-head">
        <div className="orion-draft-icon"><Icon size={16} /></div>
        <div className="flex-1 min-w-0">
          <div className="orion-draft-eyebrow">DRAFT · {kind}</div>
          <div className="orion-draft-title">{titleByKind[kind]}</div>
        </div>
        <span className="orion-pill" style={{ color: accent }}>Pending</span>
      </div>

      {meta.body && <div className="orion-draft-body">{meta.body}</div>}

      <div className="orion-draft-meta">
        <DraftMetaRow label="Status"  value="Draft · not executed" />
        <DraftMetaRow label="Impact"  value={meta.impact || "—"} />
        <DraftMetaRow label="Risks"   value={meta.risks  || "—"} />
        <DraftMetaRow label="Launch"  value={meta.launch || "—"} />
      </div>

      <button
        type="button"
        onClick={() => setShowTech((v) => !v)}
        className="orion-tech-toggle"
        data-testid={`orion-draft-tech-toggle-${kind}`}
      >
        {showTech ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="ml-1">Technical details</span>
      </button>
      {showTech && (
        <pre className="orion-draft-code"><code>{content}</code></pre>
      )}

      <div className="orion-draft-actions">
        <button type="button" className="orion-btn-ghost" onClick={onPin} data-testid={`orion-draft-pin-${kind}`}>
          <Star size={12} /> <span>Pin to context</span>
        </button>
        <button
          type="button"
          className="orion-btn-primary"
          onClick={() => {
            const phrase = "Yes, execute";
            window.dispatchEvent(new CustomEvent("orion-prefill", { detail: phrase }));
          }}
          data-testid={`orion-draft-approve-${kind}`}
          title="Logs an approval. Phase 3.7 never executes."
        >
          <ShieldCheck size={12} /> <span>Approve (log only)</span>
        </button>
      </div>
      <div className="orion-draft-footnote">
        Phase 3.7 is draft-only. Approval is logged in <Link to="/admin/orion-logs" className="orion-link-inline">audit logs</Link> — nothing is executed.
      </div>
    </div>
  );
}

function DraftMetaRow({ label, value }) {
  return (
    <div className="flex items-start gap-2">
      <div className="orion-draft-meta-label">{label}</div>
      <div className="orion-draft-meta-value">{value}</div>
    </div>
  );
}

// Best-effort extraction of impact / risks / launch + everything else
// as the body. The Phase 3.7 draft tools emit predictable sections.
function extractDraftFields(text) {
  if (!text) return {};
  const grab = (label) => {
    const re = new RegExp(`\\*\\*${label}[^*]*\\*\\*:?\\s*([^\\n]+)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    impact: grab("Estimated impact") || grab("Impact"),
    risks:  grab("Risks") || grab("Edge cases"),
    launch: grab("Launch notes") || grab("Launch plan"),
    body:   firstLine(text),
  };
}
function firstLine(text) {
  const lines = (text || "").split("\n").slice(1).filter((l) => l.trim() && !l.startsWith("```"));
  return lines.slice(0, 2).join(" · ").slice(0, 220);
}


// ─────────────────────────────────────────────────────────────────────
// Context panel cards
// ─────────────────────────────────────────────────────────────────────
function StatusCard({ summary }) {
  return (
    <div className="orion-ctx-card" data-testid="orion-cc-status">
      <div className="orion-ctx-eyebrow">ORAi status</div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="orion-status-dot" />
        <span className="orion-ctx-title">Online · Read-only</span>
      </div>
      <div className="orion-ctx-rows">
        <div><span className="orion-ctx-k">Engine</span><span className="orion-ctx-v">orai-analytics</span></div>
        <div><span className="orion-ctx-k">Memory</span><span className="orion-ctx-v">persistent</span></div>
        <div><span className="orion-ctx-k">Audit</span><span className="orion-ctx-v">active</span></div>
        <div><span className="orion-ctx-k">Avg</span><span className="orion-ctx-v">~6 ms</span></div>
      </div>
    </div>
  );
}

function ContextDraftCard({ draft }) {
  return (
    <div className="orion-ctx-card" data-testid="orion-cc-context-draft">
      <div className="orion-ctx-eyebrow">Current draft</div>
      {!draft && <div className="orion-ctx-empty">No draft pinned. Tap a tile or ask ORAi to draft something.</div>}
      {draft && (
        <>
          <div className="orion-ctx-title mt-1">{draft.type}</div>
          <div className="orion-ctx-snippet">{firstLine(draft.content)}</div>
        </>
      )}
    </div>
  );
}

function RecentActivityCard({ summary }) {
  return (
    <div className="orion-ctx-card" data-testid="orion-cc-recent">
      <div className="orion-ctx-eyebrow">Recent activity</div>
      <div className="orion-ctx-rows mt-1">
        <div><span className="orion-ctx-k">Queries today</span><span className="orion-ctx-v">{summary?.query_today ?? "—"}</span></div>
        <div><span className="orion-ctx-k">Pending</span><span className="orion-ctx-v">{summary?.action_pending ?? "—"}</span></div>
        <div><span className="orion-ctx-k">Approved</span><span className="orion-ctx-v">{summary?.action_approved ?? "—"}</span></div>
      </div>
      <Link to="/admin/orion-logs" className="orion-ctx-link mt-2" data-testid="orion-cc-recent-link">
        Open audit logs <ChevronRight size={12} />
      </Link>
    </div>
  );
}

function RoadmapCard() {
  return (
    <div className="orion-ctx-card" data-testid="orion-cc-roadmap">
      <div className="orion-ctx-eyebrow">Phase 4.0 reserved</div>
      <div className="orion-ctx-rows mt-1">
        {NAV_FUTURE.map((s) => (
          <div key={s.id}><span className="orion-ctx-k">{s.label}</span><span className="orion-ctx-v">Phase {s.phase}</span></div>
        ))}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Small UI primitives
// ─────────────────────────────────────────────────────────────────────
function NavItem({ active, onClick, icon: Icon, label, soon, disabled, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`orion-nav-item ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
      data-testid={testid}
      disabled={disabled}
    >
      <Icon size={14} />
      <span>{label}</span>
      {soon && <span className="orion-nav-soon">soon</span>}
    </button>
  );
}

function SectionHeader({ title, subtitle, actions }) {
  return (
    <header className="orion-section-head">
      <div>
        <div className="orion-eyebrow">FOUNDER COMMAND CENTER</div>
        <h2 className="orion-h2">{title}</h2>
        {subtitle && <p className="orion-sub">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

function Stat({ label, value, hue }) {
  return (
    <div className="orion-stat" style={{ ["--stat-hue"]: hue }}>
      <div className="orion-stat-label">{label}</div>
      <div className="orion-stat-value">{value}</div>
    </div>
  );
}

function OrionLogo({ size = 24 }) {
  return (
    <img
      src={ORAI_LOGO_URL}
      alt="ORAi"
      aria-hidden="true"
      style={{
        width: size, height: size, objectFit: "cover", objectPosition: "50% 32%",
        borderRadius: "50%", flexShrink: 0,
        boxShadow: "0 0 10px rgba(34,211,238,0.45), 0 0 20px rgba(52,211,153,0.2)",
      }}
    />
  );
}


// ─────────────────────────────────────────────────────────────────────
// Scoped styles — keeps the ORAi aesthetic isolated from the rest of
// the OurRealm theme. Variables only apply inside `.orion-cc-root`.
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// Phase 3.7.2 — Animated thinking states (rotating). Replaces the
// single "Thinking…" spinner with phrases that hint at what ORAi
// would be doing if it were a real autonomous agent. The list cycles
// every 1.6s while the request is in flight.
// ─────────────────────────────────────────────────────────────────────
function ThinkingStates() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % THINKING_STATES.length), 1600);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-flex items-center gap-2" data-testid="orion-cc-thinking">
      <span className="orion-thinking-dots">
        <span /><span /><span />
      </span>
      <span className="text-sm" style={{ color: "var(--orion-muted)" }}>
        {THINKING_STATES[i]}…
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3.7.2 — Categorized prompt library. Replaces the flat chip
// row with collapsible groups. The first group is open by default;
// clicking a chip dispatches into the parent's `onPick`.
// ─────────────────────────────────────────────────────────────────────
function PromptLibrary({ onPick, disabled }) {
  const [openGroup, setOpenGroup] = useState(PROMPT_LIBRARY[0].group);
  return (
    <div className="orion-prompt-library" data-testid="orion-cc-prompt-library">
      <div className="orion-prompt-tabs" role="tablist">
        {PROMPT_LIBRARY.map((g) => (
          <button
            key={g.group}
            type="button"
            onClick={() => setOpenGroup(g.group)}
            className={`orion-prompt-tab ${openGroup === g.group ? "active" : ""}`}
            role="tab"
            aria-selected={openGroup === g.group}
            data-testid={`orion-cc-prompt-tab-${g.group.toLowerCase()}`}
          >
            {g.group}
          </button>
        ))}
      </div>
      <div className="orion-prompt-chips">
        {(PROMPT_LIBRARY.find((g) => g.group === openGroup)?.prompts || []).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="orion-chip"
            disabled={disabled}
            data-testid={`orion-cc-prompt-chip-${p.slice(0, 12).replace(/\W+/g, "-")}`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3.7.2 — Cmd/Ctrl+K Command Palette. Searches across nav
// sections + the entire PROMPT_LIBRARY. Keyboard navigable (↑ / ↓ /
// Enter / Escape). Mounted at the page level so it's available from
// any section.
// ─────────────────────────────────────────────────────────────────────
function CommandPalette({ open, onClose, onSection, onPrompt }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const items = useMemo(() => {
    const navItems = NAV_SECTIONS.map((s) => ({ kind: "nav", id: s.id, label: s.label, icon: s.icon }));
    const promptItems = PROMPT_LIBRARY.flatMap((g) =>
      g.prompts.map((p) => ({ kind: "prompt", id: `${g.group}:${p}`, label: p, group: g.group, icon: Sparkles })),
    );
    const all = [...navItems, ...promptItems];
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, 12);
    return all.filter((x) => x.label.toLowerCase().includes(needle) || (x.group || "").toLowerCase().includes(needle)).slice(0, 20);
  }, [q]);
  useEffect(() => {
    if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);
  useEffect(() => { setIdx(0); }, [q]);
  const choose = (it) => {
    onClose();
    if (it.kind === "nav") onSection(it.id);
    else onPrompt(it.label);
  };
  if (!open) return null;
  return (
    <div className="orion-palette-scrim" onClick={onClose} data-testid="orion-cc-palette">
      <div className="orion-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="orion-palette-input"
          placeholder="Search sections, reports, prompts…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); if (items[idx]) choose(items[idx]); }
            else if (e.key === "Escape") { onClose(); }
          }}
          data-testid="orion-cc-palette-input"
        />
        <div className="orion-palette-results">
          {items.length === 0 && (
            <div className="orion-palette-empty">No matches.</div>
          )}
          {items.map((it, i) => (
            <button
              key={`${it.kind}-${it.id}`}
              type="button"
              onClick={() => choose(it)}
              className={`orion-palette-row ${i === idx ? "active" : ""}`}
              onMouseEnter={() => setIdx(i)}
              data-testid={`orion-cc-palette-row-${i}`}
            >
              <it.icon size={14} />
              <span className="flex-1 truncate">{it.label}</span>
              <span className="orion-palette-kind">{it.kind === "nav" ? "Section" : (it.group || "Prompt")}</span>
            </button>
          ))}
        </div>
        <div className="orion-palette-hint">
          ↑ ↓ navigate · Enter to open · Esc to close
        </div>
      </div>
    </div>
  );
}

function OrionStyles() {
  return (
    <style>{`
      .orion-cc-root {
        --orion-bg-0: #050714;
        --orion-bg-1: #0A0E1F;
        --orion-bg-2: rgba(15, 23, 42, 0.6);
        --orion-fg: #E2F1FF;
        --orion-muted: #7C8FB3;
        --orion-cyan: #22D3EE;
        --orion-cyan-soft: rgba(34, 211, 238, 0.16);
        --orion-blue: #60A5FA;
        --orion-line: rgba(80, 140, 220, 0.18);
        --orion-glass: rgba(15, 23, 42, 0.55);
        min-height: 100vh;
        background:
          radial-gradient(circle at 20% 10%, rgba(34,211,238,0.10), transparent 40%),
          radial-gradient(circle at 80% 20%, rgba(96,165,250,0.10), transparent 45%),
          radial-gradient(circle at 50% 90%, rgba(168,85,247,0.07), transparent 50%),
          linear-gradient(180deg, var(--orion-bg-0) 0%, var(--orion-bg-1) 100%);
        color: var(--orion-fg);
        position: relative;
        overflow: hidden;
      }
      .orion-cc-root::before {
        content: "";
        position: fixed; inset: 0;
        background-image:
          radial-gradient(white 1px, transparent 1px),
          radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px);
        background-size: 90px 90px, 130px 130px;
        background-position: 0 0, 50px 75px;
        opacity: 0.18; pointer-events: none; z-index: 0;
        animation: orion-twinkle 12s infinite linear;
      }
      @keyframes orion-twinkle {
        0%   { opacity: 0.10; }
        50%  { opacity: 0.22; }
        100% { opacity: 0.10; }
      }
      .orion-cc-grid {
        position: relative; z-index: 1;
        display: grid;
        grid-template-columns: 260px 1fr;
        min-height: 100vh;
      }
      @media (min-width: 1280px) {
        .orion-cc-grid { grid-template-columns: 260px 1fr 320px; }
      }
      @media (max-width: 1023px) {
        .orion-cc-grid { grid-template-columns: 1fr; }
        .orion-sidebar { position: fixed; inset: 0 auto 0 0; transform: translateX(-100%); transition: transform 200ms ease; z-index: 60; }
        .orion-sidebar.open { transform: translateX(0); }
        .orion-context { display: none; }
      }
      .orion-mobile-topbar {
        position: sticky; top: 0; z-index: 30;
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px;
        background: var(--orion-glass);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--orion-line);
      }
      .orion-icon-btn {
        width: 36px; height: 36px;
        border-radius: 10px;
        background: var(--orion-bg-2);
        border: 1px solid var(--orion-line);
        color: var(--orion-fg);
        display: inline-flex; align-items: center; justify-content: center;
      }
      .orion-icon-btn:hover { background: var(--orion-cyan-soft); }

      .orion-sidebar {
        background: var(--orion-glass);
        backdrop-filter: blur(18px);
        border-right: 1px solid var(--orion-line);
        padding: 18px 14px;
        display: flex; flex-direction: column; gap: 14px;
        min-height: 100vh; width: 260px;
      }
      .orion-brand {
        display: flex; align-items: center; gap: 10px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--orion-line);
      }
      .orion-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; padding-right: 4px; }
      .orion-nav-item {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 10px;
        border-radius: 10px;
        font-size: 13px; color: var(--orion-fg);
        background: transparent;
        text-align: left;
        transition: background 150ms ease, color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
      }
      .orion-nav-item:hover {
        background: var(--orion-cyan-soft);
        transform: translateX(3px);
        box-shadow: 0 0 14px rgba(34,211,238,0.12);
      }

      /* ── ORAi redesign: hero, voice UI, glass polish ─────────────── */
      .orai-hero { display: flex; flex-direction: column; align-items: center; gap: 14px; }
      .orai-hero-logo {
        width: clamp(220px, 38vw, 420px);
        height: auto;
        border-radius: 18px;
        filter: drop-shadow(0 0 26px rgba(34,211,238,0.35)) drop-shadow(0 0 50px rgba(52,211,153,0.18));
        animation: orai-hero-in 700ms ease both;
      }
      @keyframes orai-hero-in { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: none; } }
      .orai-hero-chat { width: 100%; }
      .orai-hero-chat .orion-chat-stream { min-height: 180px; max-height: 320px; }
      .orai-voicebar {
        width: 100%;
        display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap;
        padding: 12px 16px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 16px;
        backdrop-filter: blur(14px);
      }
      .orai-mic {
        width: 46px; height: 46px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        background: radial-gradient(circle at 35% 30%, rgba(34,211,238,0.28), rgba(10,14,25,0.9));
        border: 1px solid var(--orion-cyan);
        color: var(--orion-cyan);
        transition: box-shadow 200ms ease, transform 150ms ease;
        box-shadow: 0 0 12px rgba(34,211,238,0.3);
      }
      .orai-mic:hover { transform: scale(1.06); box-shadow: 0 0 20px rgba(34,211,238,0.5); }
      .orai-mic.on {
        border-color: #34D399; color: #34D399;
        box-shadow: 0 0 18px rgba(52,211,153,0.55);
        animation: orai-mic-pulse 1.4s ease-in-out infinite;
      }
      @keyframes orai-mic-pulse { 0%,100% { box-shadow: 0 0 10px rgba(52,211,153,0.35); } 50% { box-shadow: 0 0 26px rgba(52,211,153,0.7); } }
      .orai-wave { display: inline-flex; align-items: center; gap: 3px; height: 26px; }
      .orai-wave span {
        width: 3px; height: 6px; border-radius: 2px;
        background: linear-gradient(180deg, var(--orion-cyan), #34D399);
        animation: orai-wave-bounce 1s ease-in-out infinite;
        animation-play-state: paused; opacity: 0.45;
      }
      .orai-wave.on span { animation-play-state: running; opacity: 1; }
      @keyframes orai-wave-bounce { 0%,100% { height: 5px; } 50% { height: 22px; } }
      .orai-listening { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #34D399; animation: orai-blink 1.2s ease-in-out infinite; }
      @keyframes orai-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
      .orai-audit-note { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; color: var(--orion-muted); }
      [data-testid^="orai-card-"], .orion-stat {
        transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
      }
      [data-testid^="orai-card-"]:hover, .orion-stat:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 30px rgba(0,0,0,0.35), 0 0 18px rgba(34,211,238,0.12);
        border-color: rgba(34,211,238,0.35);
      }
      .orion-composer .orion-input:focus {
        outline: none;
        border-color: var(--orion-cyan);
        box-shadow: 0 0 0 1px var(--orion-cyan), 0 0 18px rgba(34,211,238,0.25);
      }
      @media (max-width: 640px) {
        .orai-hero-logo { width: min(78vw, 300px); }
        .orai-voicebar { gap: 10px; }
        .orai-audit-note { width: 100%; justify-content: center; }
      }
      .orion-nav-item.active {
        background: linear-gradient(90deg, var(--orion-cyan-soft), transparent);
        color: var(--orion-cyan);
        box-shadow: inset 2px 0 0 var(--orion-cyan);
      }
      .orion-nav-item.disabled { color: var(--orion-muted); opacity: 0.6; cursor: not-allowed; }
      .orion-nav-soon {
        margin-left: auto; font-size: 9px;
        padding: 1px 6px; border-radius: 999px;
        background: rgba(96,165,250,0.18); color: var(--orion-blue);
        letter-spacing: 0.08em; text-transform: uppercase;
      }
      .orion-nav-group-label {
        margin-top: 14px; padding: 6px 10px;
        font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase;
        color: var(--orion-muted);
      }
      .orion-sidebar-footer {
        border-top: 1px solid var(--orion-line);
        padding-top: 10px;
      }
      .orion-link {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 10px; border-radius: 8px;
        color: var(--orion-muted); font-size: 12px;
      }
      .orion-link:hover { color: var(--orion-cyan); background: var(--orion-cyan-soft); }
      .orion-link-inline { color: var(--orion-cyan); text-decoration: underline; }

      .orion-main { padding: 24px clamp(16px, 4vw, 40px); min-height: 100vh; min-width: 0; }
      .orion-section { display: flex; flex-direction: column; gap: 18px; max-width: 980px; }
      .orion-section-head { display: flex; align-items: end; justify-content: space-between; gap: 12px; }
      .orion-eyebrow { font-size: 10px; letter-spacing: 0.34em; color: var(--orion-cyan); }
      .orion-h2 { font-size: clamp(22px, 3vw, 32px); font-weight: 800; letter-spacing: -0.01em; }
      .orion-h3 { font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--orion-muted); }
      .orion-sub { font-size: 13px; color: var(--orion-muted); max-width: 60ch; }

      .orion-stat-grid {
        display: grid; gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      @media (min-width: 700px) { .orion-stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      @media (min-width: 1100px) { .orion-stat-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
      .orion-stat {
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 14px;
        padding: 14px;
        box-shadow: 0 0 0 1px transparent, 0 0 24px color-mix(in srgb, var(--stat-hue) 18%, transparent);
        position: relative;
      }
      .orion-stat::before {
        content: ""; position: absolute; inset: 0;
        border-radius: 14px;
        background: linear-gradient(135deg, color-mix(in srgb, var(--stat-hue) 28%, transparent), transparent 60%);
        pointer-events: none;
      }
      .orion-stat-label { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--orion-muted); }
      .orion-stat-value { font-size: 28px; font-weight: 800; color: var(--orion-fg); margin-top: 2px; }

      .orion-tile-grid {
        display: grid; gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      @media (min-width: 700px) { .orion-tile-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      @media (min-width: 1100px) { .orion-tile-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
      .orion-tile {
        display: flex; align-items: center; gap: 10px;
        padding: 14px;
        text-align: left;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 14px;
        color: var(--orion-fg); font-weight: 600;
        transition: transform 150ms ease, border 150ms ease, box-shadow 150ms ease;
      }
      .orion-tile:hover {
        transform: translateY(-1px);
        border-color: var(--tile-accent);
        box-shadow: 0 0 32px color-mix(in srgb, var(--tile-accent) 20%, transparent);
      }
      .orion-tile svg { color: var(--tile-accent); }

      /* Phase 3.7.4 — Quick Actions polish */
      .orion-quick-toolbar {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .orion-quick-search {
        flex: 1 1 220px; max-width: 360px;
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 999px;
        color: var(--orion-muted);
        transition: border 150ms ease;
      }
      .orion-quick-search:focus-within { border-color: var(--orion-cyan); }
      .orion-quick-search input {
        flex: 1; background: transparent; border: none; outline: none;
        color: var(--orion-fg); font-size: 13px;
      }
      .orion-quick-search input::placeholder { color: var(--orion-muted); }
      .orion-quick-group { margin-top: 10px; }
      .orion-quick-group-label {
        display: flex; align-items: center; gap: 6px;
        font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
        color: var(--orion-muted); margin: 14px 2px 8px;
      }
      .orion-quick-group-count {
        margin-left: 4px;
        font-size: 9px; padding: 2px 6px;
        background: rgba(80,140,220,0.10);
        border-radius: 999px;
      }
      .orion-quick-empty {
        grid-column: 1 / -1;
        padding: 14px; text-align: center;
        color: var(--orion-muted); font-size: 12px;
        background: var(--orion-glass); border: 1px dashed var(--orion-line);
        border-radius: 12px;
      }
      .orion-tile-with-pin { position: relative; padding: 0; overflow: hidden; }
      .orion-tile-body {
        flex: 1; display: flex; align-items: center; gap: 10px;
        padding: 14px; padding-right: 36px;
        background: transparent; border: none; color: inherit;
        text-align: left; font-weight: 600; cursor: pointer;
      }
      .orion-tile-pin {
        position: absolute; top: 6px; right: 6px;
        width: 24px; height: 24px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(80,140,220,0.08);
        border: 1px solid var(--orion-line);
        border-radius: 8px;
        color: var(--orion-muted);
        opacity: 0; transition: opacity 150ms ease, color 150ms ease, background-color 150ms ease;
        cursor: pointer;
      }
      .orion-tile:hover .orion-tile-pin { opacity: 1; }
      .orion-tile-pin-on { opacity: 1; color: var(--tile-accent); background: color-mix(in srgb, var(--tile-accent) 14%, transparent); }
      .orion-tile-pin:hover { color: var(--orion-cyan); }

      /* Phase 3.7.4 — Health Dashboard rows */
      .orion-health-grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 12px; }
      @media (min-width: 720px) { .orion-health-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      .orion-health-row {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 14px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-left: 3px solid var(--health-accent, var(--orion-line));
        border-radius: 12px;
      }
      .orion-health-row-name { font-weight: 700; color: var(--orion-fg); text-transform: capitalize; }
      .orion-health-row-detail { font-size: 12px; color: var(--orion-muted); margin-top: 2px; }
      .orion-health-pill {
        margin-left: auto;
        font-size: 10px; padding: 3px 9px; border-radius: 999px;
        letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;
        background: color-mix(in srgb, var(--health-accent, #888) 18%, transparent);
        color: var(--health-accent, #888);
      }

      .orion-list-item {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 14px; border-radius: 12px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        color: var(--orion-fg);
        width: 100%; text-align: left;
        transition: background 150ms ease, border 150ms ease;
      }
      .orion-list-item:hover { background: var(--orion-cyan-soft); border-color: var(--orion-cyan); }

      /* Chat */
      .orion-chat { gap: 12px; }
      .orion-chat-stream {
        flex: 1; min-height: 320px; max-height: calc(100vh - 320px);
        overflow-y: auto;
        padding: 14px;
        border-radius: 16px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        display: flex; flex-direction: column; gap: 10px;
      }
      .orion-chat-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 240px; }
      .orion-chat-row { display: flex; }
      .orion-chat-row-mine { justify-content: flex-end; }
      .orion-chat-row-ai { justify-content: flex-start; }
      .orion-chat-bubble {
        max-width: min(82%, 720px);
        padding: 12px 14px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.5;
        border: 1px solid var(--orion-line);
      }
      .orion-chat-bubble-mine {
        background: linear-gradient(135deg, var(--orion-cyan), #1E90FF);
        color: #051120;
        border-color: transparent;
        box-shadow: 0 0 24px rgba(34,211,238,0.28);
      }
      .orion-chat-bubble-ai { background: var(--orion-bg-2); color: var(--orion-fg); }
      .orion-chat-meta {
        display: flex; align-items: center;
        font-size: 10px; color: var(--orion-muted);
        letter-spacing: 0.18em; text-transform: uppercase;
        margin-bottom: 4px;
      }
      .orion-suggested {
        display: flex; gap: 8px; flex-wrap: wrap;
      }
      .orion-chip {
        padding: 6px 10px; border-radius: 999px; font-size: 12px;
        background: var(--orion-bg-2); border: 1px solid var(--orion-line);
        color: var(--orion-fg);
        transition: background 120ms ease, color 120ms ease;
      }
      .orion-chip:hover { background: var(--orion-cyan-soft); color: var(--orion-cyan); }
      .orion-composer {
        display: flex; gap: 8px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 16px;
        padding: 8px;
      }
      .orion-input {
        flex: 1; resize: none; min-height: 38px; max-height: 140px;
        background: transparent; border: 0; outline: none;
        color: var(--orion-fg); font-size: 14px; padding: 8px 6px;
      }
      .orion-input::placeholder { color: var(--orion-muted); }
      .orion-send-btn {
        align-self: end;
        width: 42px; height: 42px; border-radius: 12px;
        background: linear-gradient(135deg, var(--orion-cyan), #1E90FF);
        color: #051120; display: inline-flex; align-items: center; justify-content: center;
        box-shadow: 0 0 18px rgba(34,211,238,0.4);
        transition: filter 120ms ease;
      }
      .orion-send-btn:hover { filter: brightness(1.08); }
      .orion-send-btn[disabled] { opacity: 0.5; filter: grayscale(0.4); }

      .orion-btn-ghost { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 10px; background: var(--orion-bg-2); border: 1px solid var(--orion-line); color: var(--orion-fg); font-size: 12px; }
      .orion-btn-ghost:hover { background: var(--orion-cyan-soft); color: var(--orion-cyan); }
      .orion-btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 10px; background: var(--orion-cyan); color: #051120; font-weight: 700; font-size: 12px; box-shadow: 0 0 18px rgba(34,211,238,0.32); }
      .orion-btn-primary:hover { filter: brightness(1.08); }
      .orion-pill { font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: rgba(96,165,250,0.16); }

      /* Right context panel */
      .orion-context {
        padding: 24px 18px;
        border-left: 1px solid var(--orion-line);
        background: var(--orion-glass);
        display: flex; flex-direction: column; gap: 12px;
        min-width: 0;
      }
      .orion-ctx-card {
        background: var(--orion-bg-2);
        border: 1px solid var(--orion-line);
        border-radius: 14px;
        padding: 14px;
      }
      .orion-ctx-eyebrow { font-size: 9px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--orion-muted); }
      .orion-ctx-title { font-weight: 700; font-size: 14px; color: var(--orion-fg); }
      .orion-ctx-empty { font-size: 12px; color: var(--orion-muted); margin-top: 6px; }
      .orion-ctx-snippet { font-size: 12px; color: var(--orion-muted); margin-top: 4px; line-height: 1.45; }
      .orion-ctx-rows { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
      .orion-ctx-rows > div { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
      .orion-ctx-k { color: var(--orion-muted); }
      .orion-ctx-v { color: var(--orion-fg); font-weight: 600; }
      .orion-ctx-link { font-size: 12px; color: var(--orion-cyan); display: inline-flex; align-items: center; gap: 4px; }
      .orion-status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34D399; box-shadow: 0 0 12px #34D399; }

      /* Draft card */
      .orion-draft-card {
        margin-top: 6px;
        background: linear-gradient(180deg, var(--orion-bg-2), rgba(8,12,28,0.7));
        border: 1px solid color-mix(in srgb, var(--draft-accent) 35%, var(--orion-line));
        border-radius: 16px;
        padding: 14px;
        box-shadow: 0 0 32px color-mix(in srgb, var(--draft-accent) 14%, transparent);
      }
      .orion-draft-head { display: flex; align-items: center; gap: 10px; }
      .orion-draft-icon { width: 32px; height: 32px; border-radius: 10px; background: color-mix(in srgb, var(--draft-accent) 18%, transparent); display: inline-flex; align-items: center; justify-content: center; color: var(--draft-accent); }
      .orion-draft-eyebrow { font-size: 9px; letter-spacing: 0.26em; color: var(--draft-accent); text-transform: uppercase; }
      .orion-draft-title { font-weight: 700; font-size: 16px; color: var(--orion-fg); }
      .orion-draft-body { font-size: 13px; color: var(--orion-muted); margin-top: 10px; line-height: 1.5; }
      .orion-draft-meta { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
      .orion-draft-meta-label { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--orion-muted); min-width: 64px; }
      .orion-draft-meta-value { font-size: 13px; color: var(--orion-fg); flex: 1; }
      .orion-tech-toggle { display: inline-flex; align-items: center; gap: 4px; margin-top: 10px; font-size: 11px; color: var(--orion-muted); }
      .orion-tech-toggle:hover { color: var(--orion-cyan); }
      .orion-draft-code { margin-top: 8px; padding: 10px 12px; border-radius: 12px; background: rgba(0,0,0,0.35); border: 1px solid var(--orion-line); color: var(--orion-fg); font-size: 12px; max-height: 240px; overflow: auto; }
      .orion-draft-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
      .orion-draft-footnote { margin-top: 8px; font-size: 11px; color: var(--orion-muted); }

      /* Markdown */
      .orion-md { font-size: 14px; line-height: 1.55; }
      .orion-md-strong { color: var(--orion-fg); font-weight: 700; }
      .orion-md-inline { font-family: ui-monospace, Menlo, Monaco, "Courier New", monospace; font-size: 12px; padding: 1px 4px; background: rgba(34,211,238,0.12); border-radius: 4px; color: var(--orion-cyan); }
      .orion-md-bullet { display: flex; gap: 6px; margin-top: 2px; }
      .orion-md-line { }
      .orion-md-code { background: rgba(0,0,0,0.35); border: 1px solid var(--orion-line); border-radius: 10px; padding: 10px 12px; font-size: 12px; color: var(--orion-fg); overflow-x: auto; }

      .orion-skel { display: inline-flex; align-items: center; color: var(--orion-muted); font-size: 12px; }
      .orion-empty { color: var(--orion-muted); font-size: 13px; padding: 18px 0; }
      .orion-error { color: #FCA5A5; font-size: 13px; }

      .orion-approval-row {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px; border-radius: 12px;
        background: var(--orion-bg-2); border: 1px solid var(--orion-line);
      }

      /* Phase 3.7.5 — Pending Approvals polish */
      .orion-approval-grid {
        display: grid; gap: 10px; margin-top: 14px;
        grid-template-columns: 1fr;
      }
      @media (min-width: 880px) {
        .orion-approval-grid { grid-template-columns: 1fr 1fr; }
      }
      .orion-approval-card {
        display: grid;
        grid-template-columns: 44px 1fr auto 16px;
        align-items: center;
        gap: 12px;
        padding: 14px;
        text-align: left;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-left: 3px solid var(--ap-accent);
        border-radius: 14px;
        color: var(--orion-fg);
        cursor: pointer;
        transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
      }
      .orion-approval-card:hover {
        transform: translateY(-1px);
        background: rgba(80, 140, 220, 0.04);
        border-color: color-mix(in srgb, var(--ap-accent) 50%, var(--orion-line));
        box-shadow: 0 6px 30px color-mix(in srgb, var(--ap-accent) 16%, transparent);
      }
      .orion-approval-card:focus-visible { outline: 2px solid var(--ap-accent); outline-offset: 2px; }
      .orion-approval-icon {
        width: 44px; height: 44px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 12px;
        background: color-mix(in srgb, var(--ap-accent) 14%, transparent);
        color: var(--ap-accent);
        border: 1px solid color-mix(in srgb, var(--ap-accent) 35%, var(--orion-line));
      }
      .orion-approval-meta {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
        color: var(--orion-muted);
      }
      .orion-approval-kind { color: var(--ap-accent); font-weight: 800; }
      .orion-approval-dot { opacity: 0.5; }
      .orion-approval-author { color: var(--orion-muted); }
      .orion-approval-time { color: var(--orion-muted); }
      .orion-approval-title {
        font-size: 14px; font-weight: 700; color: var(--orion-fg);
        margin-top: 4px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .orion-approval-summary {
        font-size: 11px; color: var(--orion-muted); margin-top: 2px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .orion-approval-status { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
      .orion-approval-chev { color: var(--orion-muted); }

      .orion-status-pill {
        font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase;
        padding: 3px 9px; border-radius: 999px; font-weight: 800; white-space: nowrap;
      }
      .orion-status-pending { background: rgba(245, 158, 11, 0.16); color: #F59E0B; }
      .orion-status-draft   { background: rgba(148, 163, 184, 0.16); color: #94A3B8; }

      /* Approval details modal */
      .orion-modal-scrim {
        position: fixed; inset: 0; z-index: 220;
        background: rgba(3, 6, 18, 0.74);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: flex-start; justify-content: center;
        padding: 4vh 16px; overflow-y: auto;
        animation: orionPaletteFade 0.16s ease-out;
      }
      .orion-modal {
        width: min(720px, 100%);
        background: linear-gradient(180deg, rgba(15,23,42,0.96), rgba(10,14,31,0.96));
        border: 1px solid var(--orion-line);
        border-top: 3px solid var(--ap-accent);
        border-radius: 16px;
        box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px color-mix(in srgb, var(--ap-accent) 18%, transparent);
        overflow: hidden;
        animation: orionPaletteSlide 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .orion-modal-head {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 18px 18px 12px;
        border-bottom: 1px solid var(--orion-line);
        background: rgba(0,0,0,0.18);
      }
      .orion-modal-head-icon {
        width: 38px; height: 38px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 10px;
        background: color-mix(in srgb, var(--ap-accent) 14%, transparent);
        color: var(--ap-accent);
        border: 1px solid color-mix(in srgb, var(--ap-accent) 35%, var(--orion-line));
        flex-shrink: 0;
      }
      .orion-modal-title {
        font-size: 18px; font-weight: 800;
        color: var(--orion-fg);
        margin-top: 4px;
        font-family: var(--font-display, inherit);
      }
      .orion-modal-close {
        flex-shrink: 0;
        width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        background: transparent;
        border: 1px solid var(--orion-line);
        border-radius: 10px;
        color: var(--orion-muted);
        cursor: pointer;
        transition: color 150ms ease, background-color 150ms ease;
      }
      .orion-modal-close:hover { color: var(--orion-fg); background: rgba(255,255,255,0.06); }
      .orion-modal-body {
        padding: 16px 18px 4px;
        max-height: 60vh; overflow-y: auto;
      }
      .orion-modal-body::-webkit-scrollbar { width: 6px; }
      .orion-modal-body::-webkit-scrollbar-thumb { background: rgba(80,140,220,0.25); border-radius: 4px; }
      .orion-modal-preview {
        padding: 12px 14px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 10px;
        font-size: 13px; line-height: 1.55;
        color: var(--orion-fg);
        max-height: 280px; overflow-y: auto;
        white-space: pre-wrap;
      }
      .orion-modal-kv {
        display: grid; gap: 6px;
        grid-template-columns: 1fr;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 10px;
        padding: 10px 14px;
      }
      @media (min-width: 600px) { .orion-modal-kv { grid-template-columns: 1fr 1fr; } }
      .orion-modal-kv-row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; font-size: 12px; padding: 4px 0;
      }
      .orion-modal-kv-row dt {
        color: var(--orion-muted);
        text-transform: uppercase; letter-spacing: 0.10em; font-size: 10px; font-weight: 700;
      }
      .orion-modal-kv-row dd { color: var(--orion-fg); font-weight: 600; }
      .orion-modal-summary {
        padding: 10px 14px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 10px;
        font-size: 12px; color: var(--orion-fg);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .orion-modal-notice {
        display: flex; align-items: flex-start; gap: 8px;
        margin: 18px 0 8px;
        padding: 12px 14px;
        background: rgba(245, 158, 11, 0.08);
        border: 1px dashed rgba(245, 158, 11, 0.45);
        border-radius: 10px;
        color: #F59E0B;
        font-size: 12px; line-height: 1.5;
      }
      .orion-modal-notice svg { flex-shrink: 0; margin-top: 1px; }
      .orion-modal-actions {
        display: flex; flex-wrap: wrap; gap: 8px;
        padding: 12px 18px 18px;
        border-top: 1px solid var(--orion-line);
        background: rgba(0,0,0,0.18);
      }
      .orion-modal-action {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 12px;
        background: var(--orion-glass);
        border: 1px solid var(--orion-line);
        border-radius: 999px;
        color: var(--orion-muted);
        font-size: 12px; font-weight: 700;
        cursor: not-allowed;
        opacity: 0.55;
      }
      .orion-modal-action[disabled]:hover { background: var(--orion-glass); }
      .orion-modal-action-tag {
        margin-left: 4px;
        font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
        padding: 2px 6px; border-radius: 999px;
        background: rgba(96, 165, 250, 0.16); color: #93C5FD;
      }
      .orion-modal-action-approve { color: #34D399; }
      .orion-modal-action-decline { color: #FB7185; }
      .orion-modal-action-delete  { color: #EF4444; }
      @media (max-width: 520px) {
        .orion-approval-card { grid-template-columns: 40px 1fr 12px; }
        .orion-approval-status { display: none; }
        .orion-modal-head { flex-wrap: wrap; }
        .orion-modal-actions { padding: 12px; }
      }

      .orion-scrim { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; }

      /* Phase 3.7.2 — Cmd/Ctrl+K palette */
      .orion-palette-scrim {
        position: fixed; inset: 0; z-index: 200;
        background: rgba(3,6,18,0.72);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: flex-start; justify-content: center;
        padding-top: 12vh;
        animation: orionPaletteFade 0.16s ease-out;
      }
      @keyframes orionPaletteFade { from { opacity: 0; } to { opacity: 1; } }
      .orion-palette {
        width: min(640px, 92vw);
        background: linear-gradient(180deg, rgba(15,23,42,0.95), rgba(10,14,31,0.95));
        border: 1px solid var(--orion-line);
        border-radius: 14px;
        box-shadow: 0 25px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(34,211,238,0.08), 0 0 36px rgba(34,211,238,0.12);
        overflow: hidden;
        transform: translateY(0);
        animation: orionPaletteSlide 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes orionPaletteSlide { from { transform: translateY(-12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .orion-palette-input {
        width: 100%;
        padding: 16px 18px;
        background: transparent;
        border: none;
        outline: none;
        color: var(--orion-fg);
        font-size: 15px;
        border-bottom: 1px solid var(--orion-line);
        font-family: inherit;
      }
      .orion-palette-input::placeholder { color: var(--orion-muted); }
      .orion-palette-results {
        max-height: 380px;
        overflow-y: auto;
        padding: 6px;
      }
      .orion-palette-results::-webkit-scrollbar { width: 6px; }
      .orion-palette-results::-webkit-scrollbar-thumb { background: rgba(80,140,220,0.25); border-radius: 4px; }
      .orion-palette-empty {
        padding: 24px;
        text-align: center;
        color: var(--orion-muted);
        font-size: 13px;
      }
      .orion-palette-row {
        width: 100%;
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        color: var(--orion-fg);
        background: transparent;
        border: 1px solid transparent;
        text-align: left;
        font-size: 13px;
        cursor: pointer;
        transition: background-color 0.12s, border-color 0.12s;
      }
      .orion-palette-row:hover,
      .orion-palette-row.active {
        background: var(--orion-cyan-soft);
        border-color: rgba(34,211,238,0.25);
      }
      .orion-palette-row svg { color: var(--orion-cyan); flex-shrink: 0; }
      .orion-palette-kind {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--orion-muted);
        padding: 2px 8px;
        background: rgba(80,140,220,0.10);
        border-radius: 999px;
        flex-shrink: 0;
      }
      .orion-palette-hint {
        padding: 10px 16px;
        font-size: 11px;
        color: var(--orion-muted);
        border-top: 1px solid var(--orion-line);
        background: rgba(0,0,0,0.25);
        letter-spacing: 0.05em;
      }
      @media (max-width: 640px) {
        .orion-palette-scrim { padding-top: 8vh; }
        .orion-palette { width: 94vw; }
        .orion-palette-results { max-height: 60vh; }
      }

      .orion-logo { position: relative; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: radial-gradient(circle at 30% 30%, var(--orion-cyan), #1E90FF 70%); color: #050714; box-shadow: 0 0 16px rgba(34,211,238,0.55); }
      .orion-logo-glow { position: absolute; inset: -3px; border-radius: 50%; background: radial-gradient(circle, rgba(34,211,238,0.35), transparent 70%); }
    `}</style>
  );
}
