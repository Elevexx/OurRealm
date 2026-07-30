/**
 * OraiDashboard — upgraded ORAi control-center dashboard for
 * /admin/orion. Reuses the existing orion-* CSS (glass/neon vars),
 * /admin/orion-logs endpoints, and the new /admin/orion control API
 * (settings, overview, providers, scan). Lightweight only — no
 * routing, orchestration or code generation.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Activity, AlertCircle, Bot, ChevronDown, CheckCircle, Cog, Cpu, DollarSign,
  Gauge, Lightbulb, Loader2, Pause, Play, Plug, Plus, RadioTower, RefreshCw,
  ScanLine, Sparkles, Timer, Zap,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const CARD = {
  background: "var(--orion-glass)",
  border: "1px solid var(--orion-line)",
  borderRadius: 14,
  backdropFilter: "blur(14px)",
};

const POWER_TIERS = [
  { max: 3, label: "Economy", color: "#34D399" },
  { max: 6, label: "Balanced", color: "#22D3EE" },
  { max: 8, label: "Advanced", color: "#A78BFA" },
  { max: 10, label: "Maximum", color: "#F472B6" },
];
const tierFor = (lvl) => POWER_TIERS.find((t) => lvl <= t.max) || POWER_TIERS[3];

const FREQS = ["manual", "hourly", "daily", "weekly", "custom"];

function Card({ id, title, icon: Icon, accent = "var(--orion-cyan)", children, right }) {
  const [open, setOpen] = useState(true);
  return (
    <section style={CARD} className="p-4 sm:p-5" data-testid={`orai-card-${id}`}>
      <header className="flex items-center gap-2 cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        <Icon size={16} style={{ color: accent }} />
        <h3 className="text-[12px] font-bold uppercase" style={{ color: "var(--orion-fg)", letterSpacing: "0.14em" }}>{title}</h3>
        <span className="ml-auto flex items-center gap-2">
          {right}
          <ChevronDown size={14} style={{ color: "var(--orion-muted)", transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.2s" }} />
        </span>
      </header>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

function Toggle({ on, onChange, testid }) {
  return (
    <button type="button" role="switch" aria-checked={on} data-testid={testid}
      onClick={() => onChange(!on)}
      className="shrink-0"
      style={{
        width: 38, height: 21, borderRadius: 999, position: "relative",
        background: on ? "var(--orion-cyan)" : "rgba(124,143,179,0.3)",
        border: "1px solid var(--orion-line)", transition: "background-color 0.2s",
      }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 18 : 2, width: 15, height: 15,
        borderRadius: "50%", background: "#fff", transition: "left 0.2s",
      }} />
    </button>
  );
}

function MiniChart({ series }) {
  const counts = (series || []).map((s) => s.count);
  if (!counts.length || counts.every((c) => c === 0)) {
    return <div className="text-xs py-6 text-center" style={{ color: "var(--orion-muted)" }}>No data yet.</div>;
  }
  const max = Math.max(...counts, 1);
  const pts = counts.map((c, i) => `${(i / (counts.length - 1)) * 100},${36 - (c / max) * 30}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" className="w-full" style={{ height: 72 }} preserveAspectRatio="none" data-testid="orai-usage-chart">
      <polyline points={pts} fill="none" stroke="var(--orion-cyan)" strokeWidth="1.5" />
      <polygon points={`0,40 ${pts} 100,40`} fill="rgba(34,211,238,0.12)" stroke="none" />
    </svg>
  );
}

const timeShort = (iso) => (iso ? String(iso).slice(0, 16).replace("T", " ") : "—");

export default function OraiDashboard({ onSection }) {
  const [overview, setOverview] = useState(null);
  const [settings, setSettings] = useState(null);
  const [providers, setProviders] = useState([]);
  const [activity, setActivity] = useState([]);
  const [recs, setRecs] = useState({ total: 0, rows: [] });
  const [scanBusy, setScanBusy] = useState(false);
  const settingsRef = useRef(null);
  const powerTimer = useRef(null);

  const loadAll = () => {
    apiClient.get("/admin/orion/overview").then((r) => setOverview(r.data)).catch(() => {});
    apiClient.get("/admin/orion/settings").then((r) => setSettings(r.data)).catch(() => {});
    apiClient.get("/admin/orion/providers").then((r) => setProviders(r.data?.providers || [])).catch(() => {});
    apiClient.get("/admin/orion-logs/actions?limit=8").then((r) => setActivity(r.data?.rows || [])).catch(() => {});
    apiClient.get("/admin/orion/recommendations").then((r) => setRecs(r.data)).catch(() => {});
  };
  useEffect(loadAll, []);

  const save = async (patch, msg) => {
    try {
      const { data } = await apiClient.put("/admin/orion/settings", patch);
      setSettings(data);
      setOverview((o) => (o ? { ...o, status: data.enabled ? "active" : "paused", power_level: data.power_level } : o));
      if (msg) toast.success(msg);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save.");
    }
  };

  const setPower = (lvl) => {
    setSettings((s) => ({ ...s, power_level: lvl }));
    clearTimeout(powerTimer.current);
    powerTimer.current = setTimeout(() => save({ power_level: lvl }, `Power level ${lvl} saved`), 500);
  };

  const runScan = async () => {
    setScanBusy(true);
    try {
      const { data } = await apiClient.post("/admin/orion/scan");
      setOverview((o) => (o ? { ...o, last_scan: data.last_scan } : o));
      toast.success("Scan complete");
      apiClient.get("/admin/orion-logs/actions?limit=8").then((r) => setActivity(r.data?.rows || [])).catch(() => {});
    } catch { toast.error("Scan failed."); } finally { setScanBusy(false); }
  };

  const testProvider = async (pid) => {
    try {
      const { data } = await apiClient.post(`/admin/orion/providers/${pid}/test`);
      data.ok ? toast.success(data.detail) : toast.error(data.detail);
    } catch { toast.error("Test failed."); }
  };

  const toggleProvider = async (p) => {
    try {
      await apiClient.post(`/admin/orion/providers/${p.id}/toggle`, { enabled: !p.enabled });
      setProviders((arr) => arr.map((x) => (x.id === p.id
        ? { ...x, enabled: !p.enabled, status: x.configured ? (!p.enabled ? "connected" : "disabled") : "not_configured" }
        : x)));
    } catch { toast.error("Could not update provider."); }
  };

  const enabled = settings?.enabled ?? true;
  const power = settings?.power_level ?? 5;
  const tier = tierFor(power);
  const scan = settings?.scan || { enabled: false, frequency: "manual", custom: { days: 0, hours: 6, minutes: 0 } };

  return (
    <div className="orion-section" style={{ maxWidth: 1180 }} data-testid="orai-dashboard">
      {/* Header + quick actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold flex items-center gap-2" style={{ color: "var(--orion-fg)" }}>
            <Sparkles size={18} style={{ color: "var(--orion-cyan)" }} /> ORAi Control Center
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--orion-muted)" }}>
            ORAi is analyzing, learning, and evolving OurRealm every day.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="orion-tile" style={{ ["--tile-accent"]: "#34D399", padding: "8px 14px" }}
            onClick={runScan} disabled={scanBusy} data-testid="orai-qa-run-scan">
            {scanBusy ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} Run Scan
          </button>
          <button className="orion-tile" style={{ ["--tile-accent"]: enabled ? "#FB7185" : "#34D399", padding: "8px 14px" }}
            onClick={() => save({ enabled: !enabled }, enabled ? "ORAi paused" : "ORAi resumed")}
            data-testid="orai-qa-pause">
            {enabled ? <Pause size={14} /> : <Play size={14} />} {enabled ? "Pause ORAi" : "Resume ORAi"}
          </button>
          <button className="orion-tile" style={{ ["--tile-accent"]: "#60A5FA", padding: "8px 14px" }}
            onClick={() => settingsRef.current?.scrollIntoView({ behavior: "smooth" })} data-testid="orai-qa-settings">
            <Cog size={14} /> Settings
          </button>
        </div>
      </div>

      {/* Overview cards */}
      <div className="orion-stat-grid" data-testid="orai-overview-cards">
        <div className="orion-stat">
          <div className="orion-stat-label">ORAi Status</div>
          <div className="orion-stat-value" style={{ fontSize: 20, color: enabled ? "#34D399" : "#FB7185" }} data-testid="orai-stat-status">
            {overview ? (overview.status === "active" ? "ACTIVE" : "PAUSED") : "—"}
          </div>
        </div>
        <div className="orion-stat">
          <div className="orion-stat-label">Last Scan</div>
          <div className="orion-stat-value" style={{ fontSize: 15 }} data-testid="orai-stat-lastscan">
            {overview?.last_scan ? timeShort(overview.last_scan.at) : "Never"}
          </div>
        </div>
        <div className="orion-stat">
          <div className="orion-stat-label">Recommendations</div>
          <div className="orion-stat-value" data-testid="orai-stat-recs">{overview?.recommendations ?? "—"}</div>
        </div>
        <div className="orion-stat">
          <div className="orion-stat-label">Today's Usage</div>
          <div className="orion-stat-value" data-testid="orai-stat-usage">{overview?.requests_today ?? "—"}</div>
        </div>
        <div className="orion-stat">
          <div className="orion-stat-label">Active Tasks</div>
          <div className="orion-stat-value" data-testid="orai-stat-tasks">{overview?.active_tasks ?? "—"}</div>
        </div>
        <div className="orion-stat">
          <div className="orion-stat-label">Cost Today</div>
          <div className="orion-stat-value" style={{ fontSize: 20 }} data-testid="orai-stat-cost">
            {overview?.cost_today != null ? `$${overview.cost_today}` : "N/A"}
          </div>
        </div>
      </div>

      {/* Row: power slider + scheduler + usage */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card id="power" title="ORAi Power Level" icon={Gauge} accent={tier.color}>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-2xl font-extrabold" style={{ color: tier.color }} data-testid="orai-power-value">{power}</span>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: tier.color }} data-testid="orai-power-tier">{tier.label}</span>
          </div>
          <input type="range" min={1} max={10} step={1} value={power}
            onChange={(e) => setPower(Number(e.target.value))}
            className="w-full" style={{ accentColor: tier.color }} data-testid="orai-power-slider" />
          <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--orion-muted)" }}>
            <span>Economy</span><span>Balanced</span><span>Advanced</span><span>Maximum</span>
          </div>
          <p className="text-[11px] mt-3" style={{ color: "var(--orion-muted)" }}>
            Saved automatically. Multi-model routing arrives in a later phase — this level is stored and exposed via settings.
          </p>
        </Card>

        <Card id="scheduler" title="Scan Scheduler" icon={Timer} accent="#60A5FA"
          right={<Toggle on={!!scan.enabled} onChange={(v) => save({ scan: { ...scan, enabled: v } }, v ? "Scheduler enabled" : "Scheduler disabled")} testid="orai-scan-toggle" />}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {FREQS.map((f) => (
              <button key={f} className="orion-tile" data-testid={`orai-freq-${f}`}
                onClick={() => save({ scan: { ...scan, frequency: f } }, `Frequency: ${f}`)}
                style={{
                  ["--tile-accent"]: "#60A5FA", padding: "5px 12px", fontSize: 11, textTransform: "capitalize",
                  outline: scan.frequency === f ? "1px solid #60A5FA" : "none",
                  background: scan.frequency === f ? "rgba(96,165,250,0.14)" : undefined,
                }}>{f}</button>
            ))}
          </div>
          {scan.frequency === "custom" && (
            <div className="flex gap-2" data-testid="orai-custom-interval">
              {["days", "hours", "minutes"].map((unit) => (
                <label key={unit} className="flex-1 text-[10px] uppercase tracking-widest" style={{ color: "var(--orion-muted)" }}>
                  {unit}
                  <input type="number" min={0} value={scan.custom?.[unit] ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, parseInt(e.target.value || "0", 10));
                      setSettings((s) => ({ ...s, scan: { ...s.scan, custom: { ...s.scan.custom, [unit]: v } } }));
                    }}
                    onBlur={() => save({ scan }, "Custom interval saved")}
                    className="w-full mt-1 px-2 py-1.5 text-sm"
                    style={{ background: "var(--orion-bg-2)", border: "1px solid var(--orion-line)", borderRadius: 8, color: "var(--orion-fg)" }}
                    data-testid={`orai-custom-${unit}`} />
                </label>
              ))}
            </div>
          )}
          <p className="text-[11px] mt-3" style={{ color: "var(--orion-muted)" }}>
            {scan.enabled ? `Scheduled: ${scan.frequency}` : "Scheduler off — use Run Scan for manual scans."}
          </p>
        </Card>

        <Card id="usage" title="Usage Monitor" icon={Activity} accent="#A78BFA">
          <div className="flex gap-4 mb-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--orion-muted)" }}>Requests today</div>
              <div className="text-xl font-extrabold" style={{ color: "var(--orion-fg)" }}>{overview?.requests_today ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--orion-muted)" }}>Est. cost</div>
              <div className="text-xl font-extrabold" style={{ color: "var(--orion-fg)" }}>
                {overview?.cost_today != null ? `$${overview.cost_today}` : "N/A"}
              </div>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--orion-muted)" }}>Last 7 days</div>
          <MiniChart series={overview?.series} />
        </Card>
      </div>

      {/* AI Providers */}
      <Card id="providers" title="AI Providers" icon={Plug} accent="#22D3EE">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="orai-providers-grid">
          {providers.map((p) => (
            <div key={p.id} className="p-3" style={{ ...CARD, borderRadius: 12 }} data-testid={`orai-provider-${p.id}`}>
              <div className="flex items-center gap-2 mb-1">
                <Cpu size={14} style={{ color: "var(--orion-cyan)" }} />
                <span className="text-sm font-bold" style={{ color: "var(--orion-fg)" }}>{p.name}</span>
                <span className="ml-auto text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{
                    color: p.status === "connected" ? "#34D399" : p.status === "disabled" ? "#F59E0B" : "#7C8FB3",
                    border: `1px solid ${p.status === "connected" ? "#34D399" : p.status === "disabled" ? "#F59E0B" : "#7C8FB3"}`,
                  }} data-testid={`orai-provider-status-${p.id}`}>
                  {p.status === "not_configured" ? "empty" : p.status}
                </span>
              </div>
              <div className="text-[11px] mb-2" style={{ color: "var(--orion-muted)" }}>{p.models}</div>
              <div className="flex flex-wrap gap-1.5">
                <button className="orion-tile" style={{ ["--tile-accent"]: "#22D3EE", padding: "4px 10px", fontSize: 11 }}
                  onClick={() => toggleProvider(p)} data-testid={`orai-provider-toggle-${p.id}`}>
                  {p.enabled ? "Disable" : "Enable"}
                </button>
                <button className="orion-tile" style={{ ["--tile-accent"]: "#60A5FA", padding: "4px 10px", fontSize: 11 }}
                  onClick={() => toast.info(`Configure via backend env var ${p.env} (contact support to rotate keys).`)}
                  data-testid={`orai-provider-configure-${p.id}`}>
                  Configure
                </button>
                <button className="orion-tile" style={{ ["--tile-accent"]: "#34D399", padding: "4px 10px", fontSize: 11 }}
                  onClick={() => testProvider(p.id)} data-testid={`orai-provider-test-${p.id}`}>
                  Test
                </button>
              </div>
            </div>
          ))}
          <button className="p-3 flex flex-col items-center justify-center gap-1 transition-colors"
            style={{ ...CARD, borderRadius: 12, borderStyle: "dashed", color: "var(--orion-muted)", minHeight: 100 }}
            onClick={() => toast.info("More providers arrive with multi-agent routing in a later phase.")}
            data-testid="orai-provider-add">
            <Plus size={18} />
            <span className="text-xs">Add Provider</span>
          </button>
        </div>
      </Card>

      {/* Row: activity + recommendations */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card id="activity" title="ORAi Activity Feed" icon={RadioTower} accent="#34D399">
          {activity.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: "var(--orion-muted)" }} data-testid="orai-activity-empty">
              No activity yet — run a scan or change a setting.
            </div>
          ) : (
            <ul className="space-y-2" data-testid="orai-activity-feed">
              {activity.map((a, i) => (
                <li key={a.id || i} className="flex items-start gap-2 text-xs">
                  {a.success === false
                    ? <AlertCircle size={13} style={{ color: "#FB7185", marginTop: 1 }} />
                    : a.action_type === "scan"
                      ? <ScanLine size={13} style={{ color: "#34D399", marginTop: 1 }} />
                      : a.action_type === "settings_change"
                        ? <Cog size={13} style={{ color: "#60A5FA", marginTop: 1 }} />
                        : <Bot size={13} style={{ color: "var(--orion-cyan)", marginTop: 1 }} />}
                  <span className="flex-1 min-w-0" style={{ color: "var(--orion-fg)" }}>
                    <b className="capitalize">{(a.action_type || "action").replace(/_/g, " ")}</b>
                    {a.short_result_summary ? ` — ${String(a.short_result_summary).slice(0, 90)}` : ""}
                  </span>
                  <span className="shrink-0" style={{ color: "var(--orion-muted)" }}>{timeShort(a.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card id="recommendations" title="Pending Recommendations" icon={Lightbulb} accent="#F59E0B"
          right={<span className="text-[10px] px-1.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.16)", color: "#F59E0B" }}>{recs.total}</span>}>
          {(!recs.rows || recs.rows.length === 0) ? (
            <div className="text-xs py-4 text-center" style={{ color: "var(--orion-muted)" }} data-testid="orai-recs-empty">
              No recommendations yet. ORAi will surface improvement ideas here after future scans.
            </div>
          ) : (
            <table className="w-full text-xs" data-testid="orai-recs-table">
              <thead>
                <tr style={{ color: "var(--orion-muted)" }} className="text-left uppercase tracking-widest text-[10px]">
                  <th className="pb-2">Priority</th><th className="pb-2">Title</th>
                  <th className="pb-2">Confidence</th><th className="pb-2">Status</th><th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {recs.rows.map((r, i) => (
                  <tr key={r.id || i} style={{ borderTop: "1px solid var(--orion-line)", color: "var(--orion-fg)" }}>
                    <td className="py-2 font-bold" style={{ color: r.priority === "high" ? "#FB7185" : r.priority === "medium" ? "#F59E0B" : "#34D399" }}>
                      {r.priority || "—"}
                    </td>
                    <td className="py-2">{r.title || "—"}</td>
                    <td className="py-2">{r.confidence != null ? `${r.confidence}%` : "—"}</td>
                    <td className="py-2">{r.status || "pending"}</td>
                    <td className="py-2">
                      <button className="orion-tile" style={{ ["--tile-accent"]: "#F59E0B", padding: "3px 10px", fontSize: 11 }}>Review</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Settings */}
      <div ref={settingsRef}>
        <Card id="settings" title="ORAi Settings" icon={Cog} accent="#60A5FA">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between p-3" style={{ ...CARD, borderRadius: 12 }}>
              <div>
                <div className="text-sm font-bold" style={{ color: "var(--orion-fg)" }}>Enable ORAi</div>
                <div className="text-[11px]" style={{ color: "var(--orion-muted)" }}>Master switch for the intelligence engine.</div>
              </div>
              <Toggle on={enabled} onChange={(v) => save({ enabled: v }, v ? "ORAi enabled" : "ORAi paused")} testid="orai-setting-enabled" />
            </div>
            <div className="flex items-center justify-between p-3" style={{ ...CARD, borderRadius: 12 }}>
              <div>
                <div className="text-sm font-bold" style={{ color: "var(--orion-fg)" }}>Notifications</div>
                <div className="text-[11px]" style={{ color: "var(--orion-muted)" }}>Notify on scans, errors and recommendations.</div>
              </div>
              <Toggle on={settings?.notifications ?? true} onChange={(v) => save({ notifications: v }, "Notification preference saved")} testid="orai-setting-notifications" />
            </div>
          </div>
          <p className="text-[11px] mt-3 flex items-center gap-1.5" style={{ color: "var(--orion-muted)" }}>
            <CheckCircle size={12} style={{ color: "#34D399" }} />
            Power level and scan frequency are configured in the cards above — all settings persist server-side.
          </p>
        </Card>
      </div>
    </div>
  );
}
