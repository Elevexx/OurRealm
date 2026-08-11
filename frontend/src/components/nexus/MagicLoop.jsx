/* AI Magic Loop — founder-only orchestrator panel (real runs, honest scores). */
import { useEffect, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";

const MODES = [
  ["improve_draft", "Improve Current Draft"],
  ["clone_variant", "Clone as Variant"],
  ["animation_style", "Animation Style"],
  ["runtime_style", "Runtime Style"],
  ["living_editor", "Living Editor"],
];
const STAGES = ["BUILD", "REVIEW", "COMPARE", "IMPROVE", "VERIFY"];

export const MagicLoop = ({ world, onStarted }) => {
  const [cfg, setCfg] = useState(null);
  const [sel, setSel] = useState({});
  const [mode, setMode] = useState("improve_draft");
  const [style, setStyle] = useState("");
  const [request, setRequest] = useState("");
  const [fmax, setFmax] = useState(false);
  const [reviewer, setReviewer] = useState(true);
  const [stopScore, setStopScore] = useState(90);
  const [attempts, setAttempts] = useState(3);
  const [cycles, setCycles] = useState(2);
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { apiClient.get("/nexus/magic/config").then((r) => setCfg(r.data)).catch(() => {}); }, []);

  const allTargets = [];
  (world?.zones || []).forEach((z) => {
    allTargets.push({ key: `${z.id}|zone`, label: `Zone: ${z.name}`, t: { kind: "zone", zone_id: z.id } });
    z.entities.forEach((e) => allTargets.push({
      key: `${z.id}|${e.id}`, label: `${e.type} · ${e.props?.label || e.id}`,
      t: { kind: "entity", zone_id: z.id, entity_id: e.id },
    }));
  });
  const selected = allTargets.filter((a) => sel[a.key]).map((a) => a.t);
  const setAll = (v) => setSel(Object.fromEntries(allTargets.map((a) => [a.key, v])));
  const invert = () => setSel(Object.fromEntries(allTargets.map((a) => [a.key, !sel[a.key]])));

  const styles = mode === "animation_style" ? cfg?.animation_styles
    : mode === "runtime_style" ? cfg?.runtime_styles : null;

  const payload = (dryRun) => ({
    mode, targets: selected, style: style || undefined, request,
    settings: { founder_max: fmax, reviewer, stop_score: stopScore, max_attempts: attempts, repair_cycles: cycles, dry_run: dryRun },
  });
  const estimate = async () => {
    try { setEst((await apiClient.post("/nexus/magic/estimate", payload(false))).data); }
    catch (e) { toast.error(e?.response?.data?.detail || "Estimate failed"); }
  };
  const start = async (dryRun) => {
    setBusy(true);
    try {
      await apiClient.post("/nexus/magic/start", payload(dryRun));
      toast.success(dryRun ? "Dry run started" : "Magic Loop run started");
      onStarted?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Start failed"); }
    setBusy(false);
  };

  const scoreMax = fmax ? 99 : 95;
  return (
    <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-4" data-testid="nexus-card-magic">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm font-black text-cyan-300">AI MAGIC LOOP</div>
        <span className="text-[10px] font-bold bg-amber-400/20 text-amber-300 rounded px-2 py-0.5">FOUNDER ONLY</span>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-amber-300 cursor-pointer">
          <input type="checkbox" checked={fmax} onChange={(e) => setFmax(e.target.checked)} data-testid="magic-founder-max" />
          Founder Max — Beyond 10
        </label>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {STAGES.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-white/70 bg-white/10 rounded-full px-2 py-1">{i + 1} {s}</span>
            {i < 4 && <span className="text-white/25 text-[10px]">→</span>}
          </span>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] mb-1">
            <span className="font-bold text-white/70">SELECT TARGETS</span>
            <button onClick={() => setAll(true)} className="text-cyan-300 underline" data-testid="magic-select-all">Select All</button>
            <button onClick={() => setAll(false)} className="text-white/60 underline" data-testid="magic-clear">Clear</button>
            <button onClick={invert} className="text-white/60 underline" data-testid="magic-invert">Invert</button>
            <span className="ml-auto text-white/50" data-testid="magic-selected-count">{selected.length} selected</span>
          </div>
          <div className="bg-black/30 rounded-xl p-2 max-h-44 overflow-y-auto space-y-0.5">
            {allTargets.map((a) => (
              <label key={a.key} className="flex items-center gap-2 text-[11px] text-white/80 cursor-pointer hover:bg-white/5 rounded px-1 py-0.5">
                <input type="checkbox" checked={!!sel[a.key]} data-testid={`magic-target-${a.key.replace("|", "-")}`}
                  onChange={(e) => setSel({ ...sel, [a.key]: e.target.checked })} />
                <span className="truncate">{a.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {MODES.map(([m, lbl]) => (
              <button key={m} onClick={() => { setMode(m); setStyle(""); setEst(null); }} data-testid={`magic-mode-${m}`}
                className={`text-[11px] font-bold rounded-lg px-2.5 py-1.5 ${mode === m ? "bg-cyan-500 text-black" : "bg-white/10 text-white/80 hover:bg-white/20"}`}>
                {lbl}
              </button>
            ))}
          </div>
          {styles && (
            <select value={style} onChange={(e) => setStyle(e.target.value)} data-testid="magic-style-select"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white">
              <option value="">— choose a style —</option>
              {Object.entries(styles).map(([k, v]) => (
                <option key={k} value={k} disabled={!v.supported}>
                  {v.label}{v.supported ? "" : " — NOT SUPPORTED YET"}
                </option>
              ))}
            </select>
          )}
          {mode === "living_editor" && (
            <textarea value={request} onChange={(e) => setRequest(e.target.value)} data-testid="magic-request"
              placeholder='e.g. "Add a market stall cluster near the fountain"'
              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-[11px] text-white h-14 resize-none" />
          )}
          <div className="grid grid-cols-3 gap-2 text-[10px] text-white/60">
            <label>Stop score ≥
              <input type="number" min="50" max={scoreMax} value={stopScore} data-testid="magic-stop-score"
                onChange={(e) => setStopScore(Math.min(scoreMax, parseInt(e.target.value) || 90))}
                className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-white mt-0.5" />
            </label>
            <label>Max attempts
              <input type="number" min="1" max={fmax ? 5 : 3} value={attempts} data-testid="magic-attempts"
                onChange={(e) => setAttempts(parseInt(e.target.value) || 3)}
                className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-white mt-0.5" />
            </label>
            <label>Repair cycles
              <input type="number" min="0" max={fmax ? 3 : 2} value={cycles} data-testid="magic-cycles"
                onChange={(e) => setCycles(parseInt(e.target.value) || 0)}
                className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-white mt-0.5" />
            </label>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-white/70 cursor-pointer">
            <input type="checkbox" checked={reviewer} onChange={(e) => setReviewer(e.target.checked)} data-testid="magic-reviewer" />
            Independent reviewer pass
          </label>
          <div className="flex gap-1.5 text-[10px]">
            <span className="bg-emerald-500/15 text-emerald-300 rounded px-2 py-1 font-bold">ORAi · connected</span>
            <span className="bg-emerald-500/15 text-emerald-300 rounded px-2 py-1 font-bold">OpenAI · connected</span>
            <span className="bg-white/10 text-white/60 rounded px-2 py-1 font-bold">Meshy · connected (0 credits this checkpoint)</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-3 flex-wrap">
        <button onClick={() => start(false)} disabled={busy || !selected.length} data-testid="magic-start-btn"
          className="text-xs font-black bg-cyan-500 text-black hover:bg-cyan-400 rounded-lg px-4 py-2 disabled:opacity-40">▶ START SELECTED</button>
        <button onClick={() => start(true)} disabled={busy || !selected.length} data-testid="magic-dryrun-btn"
          className="text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg px-4 py-2 disabled:opacity-40">DRY RUN</button>
        <button onClick={estimate} disabled={!selected.length} data-testid="magic-estimate-btn"
          className="text-xs font-bold bg-orange-500/80 hover:bg-orange-500 text-black rounded-lg px-4 py-2 disabled:opacity-40">ESTIMATE</button>
      </div>
      {est && (
        <div className="mt-2 bg-black/30 rounded-xl p-2.5 text-[11px] text-white/75" data-testid="magic-estimate-panel">
          <b className="text-orange-300">ESTIMATE:</b> ~{est.estimated_ops} ops · {est.targets} targets ·
          LLM calls {est.provider_calls.orai_llm} · Meshy {est.credits.meshy} · Image {est.credits.image} ·
          ~{est.estimated_duration_s}s — {est.note}
        </div>
      )}
    </div>
  );
};
