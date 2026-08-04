import { useEffect, useState } from "react";
import { RefreshCw, XCircle, RotateCcw, ArrowLeft, CheckCircle2, Loader2, Circle, AlertTriangle, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import apiClient from "@/api/client";
import { toast } from "sonner";

const STATUS_ICON = {
  waiting: <Circle size={12} style={{ color: "var(--text-muted)" }} />,
  in_progress: <Loader2 size={12} className="animate-spin" style={{ color: "#2EA0FF" }} />,
  complete: <CheckCircle2 size={12} style={{ color: "#10E670" }} />,
  failed: <AlertTriangle size={12} style={{ color: "#FF6B6B" }} />,
};

export const LiveOutputPreview = ({ outputs, navigate }) => {
  if (!outputs?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="live-output-preview">
      {outputs.map((o, i) => (
        <div key={o.asset_id || i} className="or-surface p-2 rounded-xl" data-testid={`output-card-${o.type}-${i}`}>
          <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#2EE6FF" }}>{o.type}</div>
          {o.type === "image" && <img src={o.thumb || o.url} alt="" className="w-full h-24 object-cover rounded-lg" loading="lazy" />}
          {o.type === "video" && <video src={o.url} controls className="w-full h-24 rounded-lg object-cover" preload="metadata" />}
          {o.type === "audio" && <audio src={o.url} controls className="w-full h-9" preload="none" />}
          {o.type === "text" && <div className="text-[9.5px] h-24 overflow-hidden leading-snug" style={{ color: "var(--text-muted)" }}>{o.preview}</div>}
          {o.type === "game" && (
            <button className="w-full text-left" onClick={() => navigate("/admin/games")} data-testid={`open-game-${i}`}>
              {o.cover ? <img src={o.cover} alt="" className="w-full h-20 object-cover rounded-lg" /> : <div className="h-20 rounded-lg" style={{ background: "rgba(244,167,59,.15)" }} />}
              <div className="text-[10px] mt-1 flex items-center gap-1" style={{ color: "#F4A73B" }}>
                {o.title} <ExternalLink size={9} /> Game Studio
              </div>
            </button>
          )}
          {o.type === "course" && (
            <button className="w-full text-left" onClick={() => navigate(`/responsibility-center/${o.center_id}/courses/${o.course_id}`)}
              data-testid={`open-course-${i}`}>
              <div className="h-20 rounded-lg flex items-center justify-center" style={{ background: "rgba(46,230,255,.12)" }}>
                <span className="text-[10px]" style={{ color: "#2EE6FF" }}>Open Course Studio</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: "#2EE6FF" }}>{o.title}</div>
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export const GenerationProgress = ({ projectId, onExit }) => {
  const [p, setP] = useState(null);
  const navigate = useNavigate();

  const load = () => apiClient.get(`/orai/projects/${projectId}`).then((r) => setP(r.data.project)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(() => {
      setP((cur) => {
        if (cur && !["queued", "generating"].includes(cur.status)) return cur;
        load();
        return cur;
      });
    }, 3000);
    return () => clearInterval(t);
  }, [projectId]); // eslint-disable-line

  if (!p) return <div className="text-xs p-6" style={{ color: "var(--text-muted)" }}>Loading project…</div>;
  const running = ["queued", "generating"].includes(p.status);
  const done = ["completed", "partially_completed"].includes(p.status);
  const outputs = done ? p.outputs : [...(p.outputs || []), ...Object.values(p.outputs_live || {}).flat()];
  const est = p.estimate_approved || p.estimate;

  const act = async (path, msg) => {
    try { await apiClient.post(`/orai/projects/${projectId}/${path}`, {}); toast.success(msg); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
  };

  return (
    <div className="space-y-3" data-testid="generation-progress">
      <div className="flex flex-wrap items-center gap-2">
        <button className="or-btn text-xs flex items-center gap-1" onClick={onExit} data-testid="progress-back-btn">
          <ArrowLeft size={12} /> Projects
        </button>
        <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{p.name}</span>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,.05)", color: "var(--text-muted)" }}>
          {p.id.slice(0, 8)} · {p.job_id ? p.job_id.slice(0, 14) : "no job"}
        </span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase" data-testid="progress-status"
          style={{ background: done ? "rgba(16,230,112,.15)" : p.status === "failed" ? "rgba(255,107,107,.15)" : "rgba(46,160,255,.15)",
                   color: done ? "#10E670" : p.status === "failed" ? "#FF6B6B" : "#2EA0FF" }}>
          {p.status.replace("_", " ")}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button className="or-btn text-[10px] flex items-center gap-1" onClick={load} data-testid="progress-refresh"><RefreshCw size={10} />Refresh</button>
          {running && <button className="or-btn text-[10px] flex items-center gap-1" style={{ color: "#FF6B6B" }}
            onClick={() => act("cancel", "Cancel requested")} data-testid="progress-cancel"><XCircle size={10} />Cancel</button>}
          {!running && (p.status === "failed" || p.status === "partially_completed" || p.status === "canceled" || p.stalled) && (
            <button className="or-btn text-[10px] flex items-center gap-1" style={{ color: "#F4A73B" }}
              onClick={() => act("retry", "Retrying failed stages")} data-testid="progress-retry"><RotateCcw size={10} />Retry Failed</button>
          )}
        </div>
      </div>

      <div className="or-surface p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#2EA0FF" }}>Overall Progress</span>
          <span className="text-sm font-bold font-mono" style={{ color: "#2EA0FF" }} data-testid="progress-pct">{p.progress_pct ?? 0}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.06)" }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${p.progress_pct ?? 0}%`, background: "linear-gradient(90deg,#C26BFF,#2EA0FF,#10E670)" }} />
        </div>
        <div className="mt-3 space-y-1.5" data-testid="stage-list">
          {(p.stages || []).map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-[11px]" data-testid={`stage-${s.id}`}>
              {STATUS_ICON[s.status] || STATUS_ICON.waiting}
              <span style={{ color: s.status === "in_progress" ? "var(--text-primary)" : "var(--text-muted)" }}>{s.label}</span>
              <span className="text-[9px] px-1.5 rounded-full" style={{ background: "rgba(255,255,255,.05)", color: "var(--text-muted)" }}>{s.provider}</span>
              {s.detail && <span className="text-[9.5px] truncate" style={{ color: s.status === "failed" ? "#FF6B6B" : "#2EA0FF" }}>{s.detail}</span>}
            </div>
          ))}
        </div>
        {est && (
          <div className="text-[9.5px] mt-2" style={{ color: "var(--text-muted)" }}>
            Approved estimate: ${est.range[0].toFixed(2)}–${est.range[1].toFixed(2)} · Actual usage so far:{" "}
            <span className="font-mono" style={{ color: "#10E670" }} data-testid="actual-usage">${(p.usage?.total || 0).toFixed(3)}</span>
          </div>
        )}
      </div>

      {done && (
        <div className="or-surface p-3" data-testid="project-complete-panel">
          <div className="text-[11px] font-bold" style={{ color: "#10E670" }}>
            ✓ Project {p.status === "completed" ? "Complete" : "finished with some failed stages"}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[10px]">
            <div><span style={{ color: "var(--text-muted)" }}>Estimate</span><div className="font-mono" style={{ color: "var(--text-primary)" }}>${est?.total?.toFixed(3)}</div></div>
            <div><span style={{ color: "var(--text-muted)" }}>Actual usage</span><div className="font-mono" style={{ color: "#10E670" }}>${(p.usage?.total || 0).toFixed(3)}</div></div>
            <div><span style={{ color: "var(--text-muted)" }}>Outputs</span><div style={{ color: "var(--text-primary)" }}>{(p.outputs || []).length} assets saved to libraries</div></div>
            <div><span style={{ color: "var(--text-muted)" }}>Finished</span><div style={{ color: "var(--text-primary)" }}>{p.finished_at ? new Date(p.finished_at).toLocaleTimeString() : "—"}</div></div>
          </div>
        </div>
      )}

      <LiveOutputPreview outputs={outputs} navigate={navigate} />

      {(p.activity || []).length > 0 && (
        <div className="or-surface p-3" data-testid="activity-log">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Activity</div>
          {[...p.activity].reverse().slice(0, 12).map((a, i) => (
            <div key={i} className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>
              {new Date(a.at).toLocaleTimeString()} — {a.msg}
            </div>
          ))}
        </div>
      )}
      {p.error && <div className="text-[10.5px] p-2 rounded" style={{ background: "rgba(255,107,107,.1)", color: "#FF6B6B" }} data-testid="project-error">{p.error}</div>}
    </div>
  );
};

export default GenerationProgress;
