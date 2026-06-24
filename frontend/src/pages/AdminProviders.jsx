/**
 * AdminProviders — `/admin/providers` page (Phase 3.4).
 *
 * Surfaces the live state of every external provider (configured /
 * enabled / coming_soon / health) and lets @stealth toggle them on
 * or off without touching env vars. Other admin tiers can view +
 * trigger health re-tests but not toggle.
 *
 * Status pill colors (matching Neon spec):
 *   healthy    → green
 *   untested   → yellow
 *   error      → red
 *   disabled   → grey
 *   unconfigured → amber
 *   coming_soon → muted
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_COLORS = {
  healthy:      "#10E670",
  untested:     "#F4C84A",
  error:        "#FF5A6B",
  disabled:     "#9C9C9C",
  unconfigured: "#F4C84A",
  coming_soon:  "#7C5CFF",
};

export default function AdminProviders() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isStealth = (user?.username || "").toLowerCase() === "stealth";

  const [providers, setProviders] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});  // id → "toggling" | "testing"

  useEffect(() => {
    if (authLoading) return;
    const role = (user?.role || "").toLowerCase();
    const isAdminTier = role === "admin" || role === "founder" || role === "support_admin" || role === "moderator" || user?.is_admin === true || isStealth;
    if (!user || !isAdminTier) navigate("/", { replace: true });
  }, [authLoading, user, navigate, isStealth]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        apiClient.get("/admin/providers"),
        apiClient.get("/admin/analytics/providers"),
      ]);
      setProviders(a?.data?.providers || []);
      const m = {};
      for (const r of (b?.data?.providers || [])) m[r.id] = r;
      setAnalytics(m);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const toggle = async (p) => {
    if (!isStealth) return;
    setBusy((b) => ({ ...b, [p.id]: "toggling" }));
    try {
      await apiClient.post("/admin/providers/toggle", { id: p.id, enabled: !p.enabled });
      await reload();
    } catch (e) { alert(e?.response?.data?.detail || "Toggle failed"); }
    finally { setBusy((b) => { const n = { ...b }; delete n[p.id]; return n; }); }
  };

  const test = async (p) => {
    setBusy((b) => ({ ...b, [p.id]: "testing" }));
    try {
      const { data } = await apiClient.post("/admin/providers/test", { id: p.id, enabled: p.enabled });
      // Inline the result so user sees latency/error immediately.
      setProviders((prev) => prev.map((x) => x.id === p.id ? { ...x, status: data.status, _last_test: data } : x));
      await reload();
    } catch (e) { alert(e?.response?.data?.detail || "Test failed"); }
    finally { setBusy((b) => { const n = { ...b }; delete n[p.id]; return n; }); }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto" data-testid="admin-providers-page">
      <div className="mb-5">
        <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Phase 3.4 · Provider Integrations
        </div>
        <h1 className="text-3xl mt-1" style={{ fontFamily: "var(--font-display)" }}>Provider Management</h1>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          Manage every external API the Widget Builder can call. Keys live in <code>.env</code> only — frontend never sees them.
          {!isStealth && " Founder-only for enable/disable; you can still re-test and view analytics."}
        </p>
      </div>

      {loading ? (
        <div className="text-center p-8"><Icons.Loader2 className="animate-spin inline" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="admin-providers-grid">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              p={p}
              metrics={analytics[p.id]}
              isStealth={isStealth}
              busy={busy[p.id]}
              onToggle={() => toggle(p)}
              onTest={() => test(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ p, metrics, isStealth, busy, onToggle, onTest }) {
  const Icon = Icons[p.icon] || Icons.Plug;
  const color = STATUS_COLORS[p.status] || "#9C9C9C";
  const canTest = !p.coming_soon && p.configured && p.enabled;

  return (
    <div
      className="or-surface p-4 flex flex-col gap-3"
      style={{ borderLeft: `3px solid ${color}` }}
      data-testid={`provider-card-${p.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md p-2 shrink-0" style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)", color: "var(--primary)" }}>
          <Icon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-base" style={{ color: "var(--text-main)" }}>{p.name}</span>
            <StatusPill status={p.status} />
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{p.description}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <Tag label="Configured" on={p.configured} />
        <Tag label="Enabled" on={p.enabled} />
        <Tag label="Available" on={!p.coming_soon} muted={p.coming_soon} />
      </div>

      {(p.capabilities || []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.capabilities.map((c) => (
            <span key={c} className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ background: "color-mix(in srgb, var(--brand-green) 16%, transparent)", color: "var(--brand-green)" }}>
              ✓ {c}
            </span>
          ))}
        </div>
      )}

      {p._last_test?.error && (
        <div className="text-[11px] px-2 py-1.5 rounded" style={{ background: "rgba(255,90,107,0.14)", color: "#FF8080" }}>
          {p._last_test.error}
        </div>
      )}

      {p._last_test?.latency_ms != null && p._last_test?.healthy && (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Last test: <b style={{ color: STATUS_COLORS.healthy }}>{p._last_test.latency_ms}ms</b>
        </div>
      )}

      {metrics && (
        <div className="text-[10px] flex gap-3 mt-1" style={{ color: "var(--text-muted)" }}>
          <span>Calls: <b style={{ color: "var(--text-main)" }}>{metrics.calls}</b></span>
          <span>Errors: <b style={{ color: metrics.errors > 0 ? "#FF5A6B" : "var(--text-main)" }}>{metrics.errors}</b></span>
          {metrics.avg_latency_ms != null && <span>Avg: <b style={{ color: "var(--text-main)" }}>{metrics.avg_latency_ms}ms</b></span>}
        </div>
      )}

      {!p.coming_soon && !p.configured && p.auth_env_var && (
        <div className="text-[10px] px-2 py-1.5 rounded" style={{ background: "color-mix(in srgb, var(--brand-green) 12%, transparent)", color: "var(--brand-green)" }}>
          Add <code>{p.auth_env_var}</code> to <code>/app/backend/.env</code> and restart backend.
        </div>
      )}

      <div className="flex gap-2 mt-1">
        {canTest && (
          <button
            className="or-btn or-btn-ghost text-xs"
            onClick={onTest}
            disabled={!!busy}
            data-testid={`provider-test-${p.id}`}
          >
            {busy === "testing" ? <Icons.Loader2 size={12} className="animate-spin" /> : <Icons.Activity size={12} />} Test
          </button>
        )}
        {isStealth && !p.coming_soon && (
          <button
            className={p.enabled ? "or-btn or-btn-ghost text-xs" : "or-btn or-btn-primary text-xs"}
            onClick={onToggle}
            disabled={!!busy}
            data-testid={`provider-toggle-${p.id}`}
          >
            {busy === "toggling" ? <Icons.Loader2 size={12} className="animate-spin" /> :
              (p.enabled ? <><Icons.PowerOff size={12}/> Disable</> : <><Icons.Power size={12}/> Enable</>)}
          </button>
        )}
        {p.docs_url && (
          <a href={p.docs_url} target="_blank" rel="noreferrer" className="or-btn or-btn-ghost text-xs ml-auto">
            <Icons.ExternalLink size={11} /> Docs
          </a>
        )}
      </div>
    </div>
  );
}

function Tag({ label, on, muted }) {
  const color = muted ? "#9C9C9C" : (on ? "#10E670" : "#9C9C9C");
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ background: "var(--surface-2)" }}>
      {on ? <Icons.Check size={10} style={{ color }} /> : <Icons.X size={10} style={{ color }} />}
      <span className="text-[10px]" style={{ color }}>{label}</span>
    </div>
  );
}

function StatusPill({ status }) {
  const color = STATUS_COLORS[status] || "#9C9C9C";
  const labels = { healthy: "Healthy", untested: "Untested", error: "Error", disabled: "Disabled", unconfigured: "Needs Key", coming_soon: "Coming Soon" };
  return (
    <span
      className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded"
      style={{ background: `${color}22`, color }}
      data-testid={`provider-status-${status}`}
    >
      {labels[status] || status}
    </span>
  );
}
