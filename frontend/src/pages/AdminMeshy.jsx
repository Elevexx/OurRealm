import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Box, PlugZap, Power, RefreshCcw } from "lucide-react";
import apiClient from "@/api/client";

const chip = (ok, yes, no) => (
  <span style={{ color: ok ? "#10E670" : "#FF6B6B", fontWeight: 600 }}>{ok ? yes : no}</span>
);

export default function AdminMeshy() {
  const [status, setStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, t, a] = await Promise.all([
        apiClient.get("/admin/meshy/status"),
        apiClient.get("/admin/meshy/tasks"),
        apiClient.get("/admin/meshy/assets"),
      ]);
      setStatus(s.data); setTasks(t.data.tasks || []); setAssets(a.data.assets || []);
    } catch (e) { toast.error(e?.response?.data?.detail || "Load failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const healthTest = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post("/admin/meshy/health-test");
      r.data.ok ? toast.success(`Meshy connected — balance ${r.data.balance}`)
        : toast.warning(r.data.detail);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Test failed"); }
    setBusy(false);
  };
  const toggle = async () => {
    try {
      const r = await apiClient.post("/admin/meshy/toggle", { enabled: !(status?.enabled) });
      toast.success(r.data.enabled ? "Meshy enabled" : "Meshy disabled"); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Toggle failed"); }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6" data-testid="admin-meshy-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Box size={22} /> Meshy 3D Studio</h1>
        <div className="flex gap-2">
          <button className="or-btn text-xs" disabled={busy} onClick={healthTest} data-testid="meshy-health-test">
            <PlugZap size={13} /> Connection Test</button>
          <button className="or-btn text-xs" onClick={toggle} data-testid="meshy-toggle">
            <Power size={13} /> {status?.enabled ? "Disable" : "Enable"}</button>
          <button className="or-btn text-xs" onClick={load} data-testid="meshy-refresh"><RefreshCcw size={13} /></button>
        </div>
      </div>

      {status && (
        <div className="or-card p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm" data-testid="meshy-status-card">
          <div>API Key: {chip(status.configured, "Configured", status.placeholder ? "Placeholder (set real key in production secrets)" : "Missing")}</div>
          <div>Generation: {chip(status.enabled, "Enabled", "Disabled")}</div>
          <div>Stored 3D assets: <b>{status.stored_assets}</b></div>
          <div>Last test: {status.last_health ? (status.last_health.ok ? `OK · balance ${status.last_health.balance}` : status.last_health.detail) : "never"}</div>
        </div>
      )}

      <div className="or-card p-4">
        <h2 className="font-semibold mb-2 text-base">Generation tasks</h2>
        <p className="text-xs opacity-70 mb-2">Every paid attempt is recorded with credits consumed. 3D assets feed game runtimes only — Engagement Resource (ER) and Fire Power rewards stay server-authoritative.</p>
        {tasks.length === 0 && <div className="text-sm opacity-60" data-testid="meshy-no-tasks">No Meshy tasks yet.</div>}
        {tasks.map((t) => (
          <div key={t.meshy_task_id} className="flex items-center justify-between border-b border-white/10 py-2 text-xs" data-testid={`meshy-task-${t.meshy_task_id}`}>
            <span>{t.workflow} · {t.meshy_task_id.slice(0, 10)}…</span>
            <span>{t.status} {t.progress ? `${t.progress}%` : ""} {t.consumed_credits != null ? `· ${t.consumed_credits} cr` : ""}</span>
          </div>
        ))}
      </div>

      <div className="or-card p-4">
        <h2 className="font-semibold mb-2 text-base">3D asset library (GLB)</h2>
        {assets.length === 0 && <div className="text-sm opacity-60" data-testid="meshy-no-assets">No stored models yet.</div>}
        {assets.map((a) => (
          <div key={a.id} className="flex items-center justify-between border-b border-white/10 py-2 text-xs" data-testid={`meshy-asset-${a.id}`}>
            <span>{a.name} · {a.meta?.meshes} meshes · {(a.meta?.bytes / 1048576).toFixed(1)}MB</span>
            <a className="underline" href={a.url} target="_blank" rel="noreferrer">GLB</a>
          </div>
        ))}
      </div>
    </div>
  );
}
