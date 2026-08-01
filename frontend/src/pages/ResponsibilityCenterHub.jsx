import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Flame, Plus, ShieldCheck, Users, ChevronRight, Mail, LayoutDashboard, Building2,
  ClipboardList, CheckSquare, BarChart3, HelpCircle, Search, Bot, CalendarDays,
  ListChecks, BookOpen, Bell, Sparkles, UserPlus, FileBarChart, FolderTree,
  AlertTriangle, Activity, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { RC_TYPES, rcTypeMeta, ROLE_COLORS } from "@/lib/rcTypes";
import { RcImg, useRcBranding } from "@/lib/rcAssets";
import { RcMyWork } from "@/components/rc/RcMyWork";
import { RcSearchPanel } from "@/components/rc/RcSearchPanel";
import { useAuth } from "@/contexts/AuthContext";

const BLUE = "#2EA0FF";
const timeAgo = (iso) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const PanelTitle = ({ children, right }) => (
  <div className="flex items-center justify-between mb-2">
    <h3 className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: BLUE }}>{children}</h3>
    {right}
  </div>
);

// Responsibility Center — HOME. Premium command-center hybrid:
// structure from ref #2, glow language from ref #1. Real data only.
export default function ResponsibilityCenterHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [home, setHome] = useState(null);
  const [myWork, setMyWork] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyInvite, setBusyInvite] = useState(null);

  const load = useCallback(async () => {
    try {
      const [mine, cfg, hv, mw] = await Promise.all([
        apiClient.get("/responsibility-center/mine"),
        apiClient.get("/responsibility-center/config"),
        apiClient.get("/responsibility-center/home-overview").catch(() => ({ data: null })),
        apiClient.get("/responsibility-center/my-work").catch(() => ({ data: null })),
      ]);
      setData(mine.data);
      setConfig(cfg.data);
      setHome(hv.data);
      setMyWork(mw.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load Responsibility Centers");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const respond = async (centerId, accept) => {
    setBusyInvite(centerId);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/invites/respond`, { accept });
      if (accept && r.data?.joined) {
        toast.success("Welcome to the Center! Your 30-day seat is active.");
        navigate(`/responsibility-center/${centerId}`);
      } else {
        toast.success(accept ? "Joined" : "Invite declined");
        load();
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not respond to the invite");
    } finally { setBusyInvite(null); }
  };

  const balance = data?.my_fire_vault_balance ?? 0;
  const createCost = config?.create_cost ?? 1000;
  const branding = useRcBranding();
  const centers = data?.centers || [];
  const t = home?.totals || {};
  const hcards = home?.centers || [];
  const alerts = home?.alerts || [];
  const insights = buildInsights(home, myWork, centers, navigate);
  const managed = hcards.find((c) => ["owner", "admin", "manager"].includes(c.role)) || hcards[0];
  const goManaged = (tab) => managed ? navigate(`/responsibility-center/${managed.id}?tab=${tab}`) : navigate("/responsibility-center/create");
  const scrollTo = (sid) => document.getElementById(sid)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const typeCounts = centers.reduce((acc, { center }) => { acc[center.center_type] = (acc[center.center_type] || 0) + 1; return acc; }, {});

  const SIDE = [
    { label: "Dashboard", Icon: LayoutDashboard, act: () => window.scrollTo({ top: 0, behavior: "smooth" }), active: true },
    { label: "My Centers", Icon: Building2, act: () => scrollTo("rc-hub-centers") },
    { label: "My Responsibilities", Icon: BookOpen, act: () => scrollTo("rc-hub-mywork"), badge: t.responsibilities },
    { label: "My Tasks", Icon: ClipboardList, act: () => scrollTo("rc-hub-mywork"), badge: myWork?.total || 0 },
    { label: "Approvals", Icon: CheckSquare, act: () => managed ? goManaged("work") : scrollTo("rc-hub-mywork"), badge: t.pending_approvals },
    { label: "Calendar", Icon: CalendarDays, act: () => goManaged("calendar") },
    { label: "Reports & Analytics", Icon: BarChart3, act: () => goManaged("reports") },
    { label: "AI Assistant", Icon: Bot, act: () => scrollTo("rc-hub-orai"), beta: true },
  ];

  const QuickActionsCard = () => (
    <div className="or-surface p-4" data-testid="rc-hub-quick-actions">
      <PanelTitle>Quick Actions</PanelTitle>
      <div className="grid grid-cols-3 xl:grid-cols-2 gap-2">
        {[["Create Responsibility", BookOpen, "#10E670", () => goManaged("work")],
          ["Assign Task", ListChecks, "#F4A73B", () => goManaged("work")],
          ["Invite Member", UserPlus, BLUE, () => goManaged("members")],
          ["Generate Report", FileBarChart, "#C26BFF", () => goManaged("reports")],
          ["Create Event", CalendarDays, "#FF8A5A", () => goManaged("calendar")],
          ["Create Group", FolderTree, "#4DD6C1", () => goManaged("groups")]].map(([label, Icon, color, act]) => (
          <button key={label} onClick={act}
            className="rounded-xl p-2.5 flex flex-col items-center gap-1 text-center transition-transform hover:-translate-y-0.5"
            style={{ background: `${color}10`, border: `1px solid ${color}44` }}
            data-testid={`rc-hub-qa-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            <Icon size={16} style={{ color }} />
            <span className="text-[10px] font-semibold leading-tight">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const OraiCard = () => (
    <div className="or-surface p-4" id="rc-hub-orai" data-testid="rc-hub-orai">
      <PanelTitle right={<span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(194,107,255,0.2)", color: "#C26BFF" }}>BETA</span>}>
        <Sparkles size={11} className="inline mr-1" /> ORAi Insights
      </PanelTitle>
      <div className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
        Smart summaries from your real Center data. Suggestions only — you stay in control.
      </div>
      {insights.length === 0 && (
        <div className="text-xs py-2" style={{ color: "var(--text-muted)" }} data-testid="rc-hub-orai-empty">
          All clear — nothing needs your attention right now.
        </div>
      )}
      {insights.map((ins, i) => (
        <button key={i} onClick={ins.act}
          className="w-full text-left rounded-lg p-2 mb-1.5 text-[11px] transition-colors hover:bg-white/5"
          style={{ background: "rgba(194,107,255,0.06)", border: "1px solid rgba(194,107,255,0.25)" }}
          data-testid={`rc-hub-orai-insight-${i}`}>
          {ins.text}
        </button>
      ))}
      {!!managed && (
        <button className="or-btn or-btn-ghost w-full text-xs mt-1"
          onClick={() => navigate(`/responsibility-center/${managed.id}?orai=1`)} data-testid="rc-hub-orai-open">
          <Bot size={12} /> Open AI Assistant
        </button>
      )}
    </div>
  );

  const StatusCard = () => !!home && (
    <div className="or-surface p-4" data-testid="rc-hub-status">
      <PanelTitle>System Status</PanelTitle>
      {(home.system_status || []).map((r) => (
        <div key={r.label} className="flex items-center justify-between text-[11px] py-1.5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <span>{r.label}</span>
          <span className="flex items-center gap-1.5 font-semibold" style={{ color: r.ok ? "#10E670" : "#F4A73B" }}>
            <span className="rounded-full inline-block" style={{ width: 6, height: 6, background: r.ok ? "#10E670" : "#F4A73B" }} />
            {r.note}
          </span>
        </div>
      ))}
    </div>
  );

  const AlertsCard = () => !!alerts.length && (
    <div className="or-surface p-4" data-testid="rc-hub-alerts">
      <PanelTitle>Important Alerts</PanelTitle>
      {alerts.map((a, i) => {
        const color = a.severity === "high" ? "#FF6B6B" : a.severity === "medium" ? "#F4A73B" : BLUE;
        return (
          <button key={i} className="w-full text-left rounded-lg p-2.5 mb-1.5 flex items-start gap-2"
            style={{ background: `${color}10`, border: `1px solid ${color}44` }}
            onClick={() => a.center_id ? navigate(`/responsibility-center/${a.center_id}`) : scrollTo("rc-hub-mywork")}
            data-testid={`rc-hub-alert-${a.kind}-${i}`}>
            <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color }} />
            <span className="text-[11px]">{a.text}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="max-w-[1500px] mx-auto rcx-scope" data-testid="rc-hub-page">
      <div className="flex gap-4 items-start">
        {/* ── Left sidebar ── */}
        <aside className="hidden lg:block w-60 shrink-0" data-testid="rc-hub-sidebar">
          <div className="sticky top-20 space-y-3 max-h-[calc(100vh-6rem)] overflow-y-auto no-scrollbar pb-4">
            <div className="or-surface p-4 text-center">
              <RcImg assetKey="responsibility_center.main_logo" eager
                className="block mx-auto"
                style={{ width: "88%", height: "auto" }}
                fallback={<ShieldCheck size={52} className="mx-auto" style={{ color: BLUE }} />} testid="rc-hub-logo" />
              <div className="leading-tight mt-2.5">
                <div className="text-[13px] font-extrabold tracking-wide" style={{ fontFamily: "var(--font-display)" }}>OURREALM</div>
                <div className="text-[9px] tracking-[0.2em] uppercase" style={{ color: BLUE }}>{branding.short_name}</div>
              </div>
              <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }} data-testid="rc-hub-tagline">{branding.tagline}</div>
            </div>
            <div className="or-surface p-2">
              {SIDE.map(({ label, Icon, act, active, badge, beta }) => (
                <button key={label} className="rcx-side-item" data-active={!!active} onClick={act}
                  data-testid={`rc-hub-nav-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                  <Icon size={14} /> <span className="flex-1">{label}</span>
                  {beta && <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ background: "rgba(194,107,255,0.2)", color: "#C26BFF" }}>Beta</span>}
                  {!!badge && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: "rgba(244,167,59,0.2)", color: "#F4A73B" }}>{badge}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="or-surface p-2" data-testid="rc-hub-side-types">
              <div className="text-[9px] font-bold tracking-[0.2em] px-2 py-1" style={{ color: "var(--text-muted)" }}>ALL CENTERS</div>
              {RC_TYPES.map(({ id, label, Icon, color }) => {
                const n = typeCounts[id] || 0;
                return (
                  <button key={id} className="rcx-side-item"
                    onClick={() => {
                      const first = centers.find(({ center }) => center.center_type === id);
                      first ? navigate(`/responsibility-center/${first.center.id}`) : navigate("/responsibility-center/create");
                    }}
                    data-testid={`rc-hub-type-${id}`}>
                    <Icon size={13} style={{ color }} />
                    <span className="flex-1 truncate">{label}</span>
                    {n > 0 && <span className="rounded-full inline-block" style={{ width: 5, height: 5, background: "#10E670" }} />}
                    <span className="text-[9px]" style={{ color: n ? "var(--text-main)" : "var(--text-muted)" }}>{n || ""}</span>
                  </button>
                );
              })}
            </div>
            <div className="or-surface p-2">
              <button className="rcx-side-item" onClick={() => navigate("/faq")} data-testid="rc-hub-nav-help"><HelpCircle size={14} /> Help &amp; Guide</button>
              <button className="rcx-side-item" onClick={() => navigate("/notifications")} data-testid="rc-hub-nav-updates"><Bell size={14} /> System Updates</button>
            </div>
          </div>
        </aside>

        {/* ── Main column ── */}
        <main className="flex-1 min-w-0">
          {/* Mobile hero logo — sits fully below the sticky top nav */}
          <div className="lg:hidden text-center mb-3"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)" }}
            data-testid="rc-hub-mobile-hero">
            <RcImg assetKey="responsibility_center.main_logo" eager
              className="block mx-auto"
              style={{ width: "72%", maxWidth: 340, height: "auto" }}
              fallback={<ShieldCheck size={72} className="mx-auto" style={{ color: BLUE }} />} testid="rc-hub-mobile-logo" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4" data-testid="rc-hub-header">
            <div>
              <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }} data-testid="rc-hub-title">
                Welcome back, {user?.name || user?.username} 👋
              </h1>
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                One System. Endless Possibilities. <span style={{ color: "#10E670" }}>Make an Impact!</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs text-right">
                <div style={{ color: "var(--text-muted)" }}>Fire Power</div>
                <b style={{ color: balance >= createCost ? "#10E670" : "#FF6B6B" }} data-testid="rc-hub-balance">
                  {balance.toLocaleString()} 🔥
                </b>
              </div>
              <button className="or-btn" onClick={() => navigate("/responsibility-center/create")} data-testid="rc-hub-create-btn">
                <Plus size={14} /> Create a Center
              </button>
            </div>
          </div>

          {/* Summary cards */}
          {!!home && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" data-testid="rc-hub-stats">
              {[["Centers Managed", t.centers_managed, `${t.centers_total} total`, Building2, "#10E670"],
                ["Active Members", t.active_members, "Across your Centers", Users, BLUE],
                ["Responsibilities", t.responsibilities, "Assigned to you", BookOpen, "#4DD6C1"],
                ["Tasks Due Today", t.tasks_due_today, t.tasks_due_today ? "Needs attention" : "All clear", ClipboardList, "#F4A73B"],
                ["Pending Approvals", t.pending_approvals, t.pending_approvals ? "Requires your action" : "All caught up", CheckSquare, "#C26BFF"],
                ["Upcoming Events", t.upcoming_events, "Next 7 days", CalendarDays, "#FF8A5A"],
                ["Fire Power Activity", t.fire_activity_week, "Vault moves · 7 days", Flame, "#FF8A5A"],
                ["AI Suggestions", insights.length, "ORAi insights", Sparkles, "#C26BFF"],
              ].map(([label, value, sub, Icon, color]) => (
                <div key={label} className="or-surface p-3 flex items-center gap-2.5"
                  data-testid={`rc-hub-stat-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                  <div className="rcx-stat-tile" style={{ width: 38, height: 38, background: `${color}1a`, color, boxShadow: `0 0 12px ${color}33` }}>
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-lg font-extrabold leading-none">{value ?? 0}</div>
                    <div className="text-[10px] font-semibold mt-0.5 truncate">{label}</div>
                    <div className="text-[8px] truncate" style={{ color: "var(--text-muted)" }}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mb-4" data-testid="rc-hub-search"><RcSearchPanel /></div>

          {loading && (
            <div className="or-surface p-6 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="rc-hub-loading">
              Loading your Centers…
            </div>
          )}

          {/* System overview: trend + recent activity */}
          {!!home && (
            <div className="grid lg:grid-cols-2 gap-3 mb-4">
              <div className="or-surface p-4" data-testid="rc-hub-trend">
                <PanelTitle right={<TrendingUp size={13} style={{ color: "#10E670" }} />}>Completion Trend · 7 Days</PanelTitle>
                <TrendBars days={home.trend || []} />
              </div>
              <div className="or-surface p-4" data-testid="rc-hub-activity">
                <PanelTitle right={<Activity size={13} style={{ color: BLUE }} />}>Recent Activity</PanelTitle>
                {(home.activity || []).length === 0 && (
                  <div className="text-xs py-3" style={{ color: "var(--text-muted)" }}>No recent activity yet.</div>
                )}
                <div className="max-h-44 overflow-y-auto no-scrollbar">
                  {(home.activity || []).map((a) => (
                    <div key={a.id} className="flex items-start gap-2 py-1.5 text-[11px]"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span className="rounded-full mt-1 shrink-0" style={{ width: 6, height: 6, background: "#10E670" }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{a.detail}</div>
                        <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{a.center_name} · {timeAgo(a.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Active centers carousel */}
          {!loading && !!hcards.length && (
            <div className="or-surface p-4 mb-4" data-testid="rc-hub-active-centers">
              <PanelTitle right={
                <button className="text-[10px]" style={{ color: "var(--text-muted)" }} onClick={() => scrollTo("rc-hub-centers")}
                  data-testid="rc-hub-view-all">View All Centers <ChevronRight size={10} className="inline" /></button>
              }>Your Active Centers</PanelTitle>
              <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                {hcards.map((c) => {
                  const meta = rcTypeMeta(c.center_type);
                  return (
                    <button key={c.id} onClick={() => navigate(`/responsibility-center/${c.id}`)}
                      className="shrink-0 rounded-xl p-3 text-center transition-transform hover:-translate-y-0.5"
                      style={{ minWidth: 160, background: `${meta.color}0d`, border: `1px solid ${meta.color}55`, boxShadow: `0 0 12px ${meta.color}22` }}
                      data-testid={`rc-hub-active-${c.id}`}>
                      <meta.Icon size={26} className="mx-auto" style={{ color: meta.color }} />
                      <div className="text-xs font-bold mt-1.5 truncate">{c.name}</div>
                      <div className="text-[9px] uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</div>
                      <div className="flex items-center justify-center gap-2 mt-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                        <span><Users size={9} className="inline mr-0.5" />{c.members}</span>
                        <span><ClipboardList size={9} className="inline mr-0.5" />{c.open_tasks}</span>
                        <span style={{ color: c.health >= 70 ? "#10E670" : c.health >= 40 ? "#F4A73B" : "#FF6B6B" }}>♥ {c.health}%</span>
                      </div>
                      <div className="h-1 rounded-full mt-2" style={{ background: "rgba(255,255,255,0.08)" }}
                        role="img" aria-label={`Completion ${c.completion_pct}%`}>
                        <div className="h-1 rounded-full" style={{ width: `${c.completion_pct}%`, background: meta.color }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* My Work */}
          {!loading && <div id="rc-hub-mywork"><RcMyWork /></div>}

          {/* Pending invites */}
          {!loading && (data?.invites?.length || 0) > 0 && (
            <div className="mb-5" data-testid="rc-hub-invites">
              <PanelTitle><Mail size={11} className="inline mr-1" /> Pending Invites</PanelTitle>
              <div className="space-y-2">
                {data.invites.map(({ center, membership }) => (
                  <div key={center.id} className="or-surface p-4 flex flex-wrap items-center justify-between gap-3" data-testid={`rc-invite-${center.id}`}>
                    <div>
                      <div className="text-sm font-semibold">{center.name}</div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Invited by @{membership.invited_by_username} · {rcTypeMeta(center.center_type).label}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="or-btn" disabled={busyInvite === center.id}
                        onClick={() => respond(center.id, true)} data-testid={`rc-invite-accept-${center.id}`}>Accept</button>
                      <button className="or-btn or-btn-ghost" disabled={busyInvite === center.id}
                        onClick={() => respond(center.id, false)} data-testid={`rc-invite-decline-${center.id}`}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compact panels on smaller screens */}
          <div className="xl:hidden space-y-3 mb-4">
            <QuickActionsCard />
            <AlertsCard />
            <OraiCard />
            <StatusCard />
          </div>

          {/* My centers grid */}
          {!loading && (
            <div id="rc-hub-centers" data-testid="rc-hub-my-centers">
              <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>My Centers</h3>
              {centers.length === 0 ? (
                <div className="or-surface p-8 text-center" data-testid="rc-hub-empty">
                  <RcImg assetKey="responsibility_center.landing.no_centers" className="mx-auto mb-3"
                    style={{ maxHeight: 160 }} fallback={null} />
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                    You don't belong to any Responsibility Centers yet.
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    Founding a Center burns {createCost.toLocaleString()} 🔥 from your Fire Vault — your first 30-day seat is included.
                  </div>
                  <button className="or-btn mt-4" onClick={() => navigate("/responsibility-center/create")} data-testid="rc-hub-empty-create-btn">
                    <Plus size={14} /> Create your first Center
                  </button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {centers.map(({ center, membership }) => {
                    const meta = rcTypeMeta(center.center_type);
                    return (
                      <button key={center.id}
                        className="or-surface p-4 text-left transition-transform hover:-translate-y-0.5"
                        onClick={() => navigate(`/responsibility-center/${center.id}`)}
                        data-testid={`rc-center-card-${center.id}`}>
                        <div className="flex items-center gap-3">
                          <div className="rounded-full flex items-center justify-center shrink-0"
                            style={{ width: 40, height: 40, background: `${meta.color}22`, color: meta.color }}>
                            <meta.Icon size={20} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold truncate">{center.name}</div>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{meta.label}</div>
                          </div>
                          <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
                        </div>
                        <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                          <span className="uppercase tracking-wide font-semibold" style={{ color: ROLE_COLORS[membership.role] }}>
                            {membership.role}
                          </span>
                          <span><Users size={11} className="inline mr-1" />{center.member_count}</span>
                          <span><Flame size={11} className="inline mr-1" />{center.vault_balance.toLocaleString()} 🔥</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Bottom analytics — top performing centers */}
          {!!hcards.length && (
            <div className="or-surface p-4 mt-4" data-testid="rc-hub-top-centers">
              <PanelTitle>Top Performing Centers</PanelTitle>
              {hcards.slice(0, 5).map((c, i) => {
                const meta = rcTypeMeta(c.center_type);
                return (
                  <button key={c.id} className="w-full flex items-center gap-3 py-1.5 text-left"
                    onClick={() => navigate(`/responsibility-center/${c.id}`)} data-testid={`rc-hub-top-${c.id}`}>
                    <span className="text-[10px] w-4" style={{ color: "var(--text-muted)" }}>{i + 1}</span>
                    <meta.Icon size={14} style={{ color: meta.color }} />
                    <span className="text-xs flex-1 truncate">{c.name}</span>
                    <div className="h-1.5 rounded-full flex-1 max-w-[180px]" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-1.5 rounded-full" style={{ width: `${c.health}%`, background: meta.color }} />
                    </div>
                    <b className="text-xs w-10 text-right" style={{ color: meta.color }}>{c.health}%</b>
                  </button>
                );
              })}
            </div>
          )}

          {/* Motto footer */}
          <div className="text-center py-8" data-testid="rc-hub-motto">
            <div className="text-sm font-extrabold tracking-[0.35em]" style={{ fontFamily: "var(--font-display)" }}>
              <span style={{ color: "#F4A73B" }}>MANAGE</span> · <span style={{ color: "#10E670" }}>GUIDE</span> ·{" "}
              <span style={{ color: BLUE }}>PROTECT</span> · <span style={{ color: "#C26BFF" }}>GROW</span> ·{" "}
              <span style={{ color: "#FF8A5A" }}>SUCCEED</span>
            </div>
            <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
              Universal Responsibility. Any Purpose. Any Team. Anywhere.
            </div>
          </div>
        </main>

        {/* ── Right panel ── */}
        <aside className="hidden xl:block w-72 shrink-0" data-testid="rc-hub-right-panel">
          <div className="sticky top-20 space-y-3 max-h-[calc(100vh-6rem)] overflow-y-auto no-scrollbar pb-4">
            <QuickActionsCard />
            <AlertsCard />
            <OraiCard />
            <StatusCard />
          </div>
        </aside>
      </div>
    </div>
  );
}

function TrendBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.completed));
  return (
    <div className="flex items-end gap-2 h-32 pt-2" role="img"
      aria-label={`Items completed per day: ${days.map((d) => d.completed).join(", ")}`}>
      {days.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-[9px]" style={{ color: "var(--text-main)" }}>{d.completed || ""}</span>
          <div className="w-full rounded-t"
            style={{ height: `${Math.max(4, (d.completed / max) * 88)}px`,
              background: d.completed ? `linear-gradient(180deg, ${BLUE}, #10E670)` : "rgba(255,255,255,0.07)" }} />
          <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>
            {new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}
          </span>
        </div>
      ))}
    </div>
  );
}

function buildInsights(home, myWork, centers, navigate) {
  const out = [];
  if (!home) return out;
  const b = myWork?.buckets || {};
  if ((b.overdue || []).length) {
    out.push({ text: `⏰ ${b.overdue.length} of your items are overdue — tackle "${b.overdue[0].title}" first.`,
      act: () => navigate(`/responsibility-center/${b.overdue[0].center_id}?tab=work`) });
  }
  if ((b.due_today || []).length) {
    out.push({ text: `📌 ${b.due_today.length} item${b.due_today.length === 1 ? " is" : "s are"} due today across your Centers.`,
      act: () => document.getElementById("rc-hub-mywork")?.scrollIntoView({ behavior: "smooth" }) });
  }
  if (home.totals?.pending_approvals) {
    const managed = (home.centers || []).find((c) => ["owner", "admin", "manager"].includes(c.role));
    out.push({ text: `✅ ${home.totals.pending_approvals} submission${home.totals.pending_approvals === 1 ? "" : "s"} await your approval.`,
      act: () => managed && navigate(`/responsibility-center/${managed.id}?tab=work`) });
  }
  const low = (home.alerts || []).find((a) => a.kind === "low_vault");
  if (low) out.push({ text: `🔥 ${low.text}`, act: () => navigate(`/responsibility-center/${low.center_id}?tab=vault`) });
  const quiet = (home.centers || []).find((c) => c.open_tasks === 0 && c.status === "active");
  if (quiet) out.push({ text: `💡 "${quiet.name}" has no open work — a good moment to plan the next responsibilities.`,
    act: () => navigate(`/responsibility-center/${quiet.id}?tab=work`) });
  return out.slice(0, 5);
}
