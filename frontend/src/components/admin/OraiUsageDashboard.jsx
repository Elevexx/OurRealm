import React, { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, Loader2, ShieldAlert } from "lucide-react";
import apiClient from "@/api/client";

// Founder AI Usage dashboard — live rollup of ORAi chat, course/video jobs,
// spend, queues, budgets and provider health. Refreshes every 10s.
export const OraiUsageDashboard = () => {
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);

  const load = useCallback(() => {
    apiClient.get("/admin/orai/usage").then((r) => setData(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const checkHealth = async () => {
    setHealth("loading");
    try { const r = await apiClient.get("/admin/ai-video/providers/health"); setHealth(r.data.providers); }
    catch { setHealth(null); }
  };

  if (!data) return <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin inline mr-1" /> Loading AI usage…</div>;

  const stat = (label, value, accent) => (
    <div key={label} className="or-surface p-3 text-center">
      <div className="text-lg font-bold" style={{ fontFamily: "var(--font-display)", color: accent || "var(--text-main)" }}>{value}</div>
      <div className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );

  return (
    <div className="orion-section" data-testid="orai-usage-dashboard">
      <div className="flex items-center gap-2 mb-3">
        <Gauge size={18} style={{ color: "#2EE6FF" }} />
        <div className="text-base font-bold" style={{ fontFamily: "var(--font-display)" }}>AI Usage Dashboard</div>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(16,230,112,0.12)", color: "#10E670" }}>live · 10s refresh</span>
        <div className="ml-auto flex gap-1.5">
          {data.emergency_disabled && <span className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(255,107,107,0.15)", color: "#FF6B6B" }}><ShieldAlert size={9} className="inline mr-0.5" />EMERGENCY STOP</span>}
          <span className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ background: data.dry_run ? "rgba(77,214,193,0.15)" : "rgba(244,167,59,0.15)", color: data.dry_run ? "#4DD6C1" : "#F4A73B" }}>
            {data.dry_run ? "DRY RUN — $0 spend" : "LIVE SPEND"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3" data-testid="orai-usage-stats">
        {stat("ORAi chats today", data.chat.today, "#2EA0FF")}
        {stat("Chats this week", data.chat.week)}
        {stat("Chats this month", data.chat.month)}
        {stat("Images stored today", data.images_today)}
        {stat("Videos generated", data.videos.generated, "#C26BFF")}
        {stat("Courses generated", data.courses.generated, "#10E670")}
        {stat("Courses today", data.courses.today)}
        {stat("Queue length", data.queue_length, data.queue_length > 0 ? "#F4A73B" : undefined)}
        {stat("Pending jobs", data.pending_jobs)}
        {stat("Failed jobs", data.failed_jobs, data.failed_jobs > 0 ? "#FF6B6B" : undefined)}
        {stat("Spend today", `$${data.spend.daily_spent.toFixed(2)}`, "#F4A73B")}
        {stat("Spend this month", `$${data.spend.monthly_spent.toFixed(2)}`, "#F4A73B")}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="or-surface p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#F4A73B" }}>Budget remaining</div>
          <div className="text-[11px] space-y-1">
            <div className="flex justify-between"><span style={{ color: "var(--text-muted)" }}>Daily</span><b>${data.budget.daily_remaining.toFixed(2)} / ${data.budget.daily.toFixed(2)}</b></div>
            <div className="flex justify-between"><span style={{ color: "var(--text-muted)" }}>Monthly</span><b>${data.budget.monthly_remaining.toFixed(2)} / ${data.budget.monthly.toFixed(2)}</b></div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-widest mt-3 mb-1" style={{ color: "#2EE6FF" }}>Rate limits</div>
          {data.rate_limits.map((r) => <div key={r} className="text-[10px]" style={{ color: "var(--text-muted)" }}>• {r}</div>)}
          <div className="text-[9px] mt-2" style={{ color: "var(--text-muted)" }}>
            Voice minutes & avg response time: not tracked yet.
          </div>
        </div>
        <div className="or-surface p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#10E670" }}>Most active users (7d)</div>
          {data.top_users.length === 0 ? <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>No ORAi chats yet.</div>
            : data.top_users.map((u) => <div key={u._id} className="text-[11px] flex justify-between"><span>@{u.username}</span><b>{u.n}</b></div>)}
          <div className="text-[10px] font-bold uppercase tracking-widest mt-3 mb-1.5" style={{ color: "#C26BFF" }}>Most active Centers (course gen)</div>
          {data.top_centers.length === 0 ? <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>No course generations yet.</div>
            : data.top_centers.map((c) => <div key={c._id} className="text-[11px] flex justify-between"><span className="truncate mr-2">{c.name}</span><b>{c.n}</b></div>)}
        </div>
      </div>

      <div className="or-surface p-3" data-testid="orai-usage-health">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#10E670" }}>Provider health</div>
          <button className="or-btn or-btn-ghost text-[10px]" onClick={checkHealth} data-testid="orai-usage-health-check">
            {health === "loading" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Check (free)
          </button>
        </div>
        {Array.isArray(health) ? health.map((h) => (
          <div key={h.name} className="flex items-center gap-2 py-0.5 text-[11px]">
            <span className="w-2 h-2 rounded-full" style={{ background: h.ok ? "#10E670" : "#FF6B6B" }} />
            <b className="w-36">{h.label}</b>
            <span style={{ color: "var(--text-muted)" }}>{h.detail}</span>
          </div>
        )) : <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Free connectivity + model-access probe — no generation, no cost.</div>}
      </div>
    </div>
  );
};

export default OraiUsageDashboard;
