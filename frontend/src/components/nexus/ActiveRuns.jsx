/* Active Magic Loop run cards — real Mongo-backed state, survives refresh. */
import { useEffect, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";

const STAGES = ["build", "review", "compare", "improve", "verify"];
const BADGE = {
  running: "bg-cyan-500/20 text-cyan-300", paused: "bg-amber-400/20 text-amber-300",
  awaiting_approval: "bg-purple-500/25 text-purple-300", applied: "bg-emerald-500/20 text-emerald-300",
  completed: "bg-emerald-500/20 text-emerald-300", stopped: "bg-white/10 text-white/60",
  rejected: "bg-white/10 text-white/60", failed: "bg-red-500/25 text-red-300",
  stalled: "bg-red-500/20 text-red-300",
};

const elapsed = (r) => {
  const end = ["running", "paused"].includes(r.status) ? Date.now() : new Date(r.updated_at).getTime();
  const s = Math.max(0, Math.round((end - new Date(r.created_at).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export const ActiveRuns = ({ refreshKey, onDraftChanged }) => {
  const [runs, setRuns] = useState([]);
  const [variants, setVariants] = useState([]);
  const [open, setOpen] = useState(null);

  const load = () => {
    apiClient.get("/nexus/magic/runs").then((r) => setRuns(r.data.runs || [])).catch(() => {});
    apiClient.get("/nexus/magic/variants").then((r) => setVariants(r.data.variants || [])).catch(() => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const control = async (rid, action) => {
    try { await apiClient.post(`/nexus/magic/runs/${rid}/control`, { action }); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Control failed"); }
  };
  const controlAll = async (action) => {
    const r = await apiClient.post("/nexus/magic/control-all", { action });
    toast.message(`${action} → ${r.data.affected} run(s)`);
    load();
  };
  const decide = async (rid, approve) => {
    try {
      await apiClient.post(`/nexus/magic/runs/${rid}/decide`, { approve });
      toast.success(approve ? "Applied to DRAFT (published untouched)" : "Rejected");
      load(); onDraftChanged?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Decision failed"); }
  };
  const loadVariant = async (vid) => {
    try {
      const r = await apiClient.post(`/nexus/magic/variants/${vid}/load`);
      toast.success(`Variant loaded into draft (auto-backup ${r.data.backup_variant_id} saved)`);
      onDraftChanged?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Load failed"); }
  };

  return (
    <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3" data-testid="nexus-card-runs">
      <div className="flex items-center gap-2">
        <div className="text-xs font-black text-cyan-300">ACTIVE RUNS</div>
        <button onClick={() => controlAll("pause")} data-testid="runs-pause-all"
          className="ml-auto text-[10px] font-bold bg-white/10 hover:bg-white/20 rounded px-2 py-1">⏸ Pause All</button>
        <button onClick={() => controlAll("stop")} data-testid="runs-stop-all"
          className="text-[10px] font-bold bg-red-500/25 hover:bg-red-500/40 text-red-200 rounded px-2 py-1">■ Stop All</button>
      </div>
      {runs.length === 0 && <div className="text-[11px] text-white/45 mt-2">No runs yet — start one from the AI Magic Loop.</div>}
      <div className="space-y-2 mt-2 max-h-[46vh] overflow-y-auto">
        {runs.map((r) => (
          <div key={r.id} className="bg-black/30 rounded-xl p-2.5" data-testid={`run-${r.id}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-white/90 truncate max-w-[150px]">{r.label}</span>
              <span className={`text-[9px] font-black rounded px-1.5 py-0.5 ${BADGE[r.status] || "bg-white/10"}`} data-testid={`run-status-${r.id}`}>
                {r.status.replace("_", " ").toUpperCase()}
              </span>
              {r.settings?.dry_run && <span className="text-[9px] font-bold bg-white/10 text-white/60 rounded px-1.5 py-0.5">DRY RUN</span>}
              {r.settings?.founder_max && <span className="text-[9px] font-bold bg-amber-400/20 text-amber-300 rounded px-1.5 py-0.5">MAX</span>}
            </div>
            <div className="flex items-center gap-1 mt-1.5">
              {STAGES.map((s, i) => (
                <div key={s} className={`h-1.5 flex-1 rounded-full ${i < (r.stages_done || 0) ? "bg-cyan-400" : r.stage === s && r.status === "running" ? "bg-cyan-400/40 animate-pulse" : "bg-white/10"}`} />
              ))}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-white/55 mt-1 flex-wrap">
              <span>stage: <b className="text-white/80">{r.stage}</b></span>
              <span>{r.stages_done || 0}/5</span>
              {r.score != null && <span>score <b className="text-emerald-300">{r.score}</b>/{r.settings?.stop_score} (heuristic)</span>}
              <span>{elapsed(r)}</span>
              <span>LLM {r.provider_usage?.openai_calls ?? 0} · Meshy {r.provider_usage?.meshy_calls ?? 0}</span>
            </div>
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              <button onClick={() => setOpen(open === r.id ? null : r.id)} data-testid={`run-view-${r.id}`}
                className="text-[10px] bg-white/10 hover:bg-white/20 rounded px-2 py-1">👁 View</button>
              {["running"].includes(r.status) && (
                <button onClick={() => control(r.id, "pause")} data-testid={`run-pause-${r.id}`}
                  className="text-[10px] bg-white/10 hover:bg-white/20 rounded px-2 py-1">⏸ Pause</button>
              )}
              {r.status === "paused" && (
                <button onClick={() => control(r.id, "resume")} data-testid={`run-resume-${r.id}`}
                  className="text-[10px] bg-cyan-500/30 hover:bg-cyan-500/50 rounded px-2 py-1">▶ Resume</button>
              )}
              {["running", "paused"].includes(r.status) && (
                <button onClick={() => control(r.id, "stop")} data-testid={`run-stop-${r.id}`}
                  className="text-[10px] bg-red-500/25 hover:bg-red-500/40 text-red-200 rounded px-2 py-1">■ Stop</button>
              )}
              {r.status === "awaiting_approval" && (
                <>
                  <button onClick={() => decide(r.id, true)} data-testid={`run-approve-${r.id}`}
                    className="text-[10px] font-bold bg-emerald-500 text-black rounded px-2 py-1">✓ Approve → Draft</button>
                  <button onClick={() => decide(r.id, false)} data-testid={`run-reject-${r.id}`}
                    className="text-[10px] bg-white/10 rounded px-2 py-1">Reject</button>
                </>
              )}
            </div>
            {open === r.id && (
              <div className="mt-2 bg-black/40 rounded-lg p-2 text-[10px] text-white/70" data-testid={`run-detail-${r.id}`}>
                {r.result?.plan && <div className="mb-1"><b className="text-purple-300">PLAN:</b> {r.result.plan}</div>}
                {r.diff && (
                  <div className="mb-1 flex gap-2">
                    <span className="bg-white/5 rounded px-1.5 py-0.5">Reference: draft</span>
                    <span className="bg-emerald-500/10 text-emerald-300 rounded px-1.5 py-0.5">Proposed: +{r.diff.adds} ~{r.diff.updates} -{r.diff.removes}</span>
                    <span className="bg-white/5 rounded px-1.5 py-0.5">Diff: {r.diff.ops_count} ops</span>
                  </div>
                )}
                <div className="max-h-28 overflow-y-auto space-y-0.5">
                  {(r.stage_history || []).map((h, i) => (
                    <div key={i}>· <b>{h.stage}</b> {h.note}{h.score != null ? ` [${h.score}]` : ""}</div>
                  ))}
                </div>
                {r.result?.ops?.length > 0 && (
                  <pre className="mt-1 max-h-24 overflow-y-auto text-white/50 whitespace-pre-wrap">{JSON.stringify(r.result.ops, null, 1)}</pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {variants.length > 0 && (
        <div className="mt-3" data-testid="variants-list">
          <div className="text-[10px] font-black text-white/60 mb-1">VARIANTS ({variants.length})</div>
          {variants.slice(0, 5).map((v) => (
            <div key={v.id} className="flex items-center justify-between text-[10px] text-white/70 py-0.5">
              <span className="truncate">{v.label} <span className="text-white/35">({v.kind})</span></span>
              <button onClick={() => loadVariant(v.id)} data-testid={`variant-load-${v.id}`}
                className="bg-white/10 hover:bg-white/20 rounded px-2 py-0.5">Load → Draft</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
