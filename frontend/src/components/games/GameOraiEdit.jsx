import React, { useState } from "react";
import { Sparkles, Wand2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const QUICK = [
  ["New Biome", "Add a brand-new biome environment as a new stage with its own hazards and palette twist"],
  ["Boss Stage", "Turn the final stage into an intense boss-style gauntlet: a relentless chaser, denser hazards and a dramatic finale"],
  ["Better HUD", "Improve HUD clarity: sharper stage titles, clearer story text, punchier achievement labels"],
  ["More Animations", "Increase visual energy: more moving hazards, faster pacing curves and richer pickup variety"],
  ["New Ending", "Rewrite the final stage story and title into a cinematic ending with a satisfying payoff"],
  ["Endless Mode Feel", "Rebalance the last stages into an escalating survival crescendo that feels endless"],
  ["Side Quests", "Add optional flavor: hidden-feeling bonus objectives woven into stage stories and achievements"],
  ["Seasonal Event", "Re-theme one stage as a limited seasonal event with festive palette and themed hazards"],
];
const UNSUPPORTED = [["Multiplayer Version", "multiplayer"], ["Controller Version", "gamepad input"]];

export default function GameOraiEdit({ gameId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState("full");
  const [addStages, setAddStages] = useState(0);
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);
  const [subs, setSubs] = useState([]);

  const estimate = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/games/${gameId}/orai-edit`,
        { prompt, scope, add_stages: addStages, dry_run: true });
      setEst(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Estimate failed"); }
    finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/games/${gameId}/orai-edit`,
        { prompt, scope, add_stages: addStages, request_id: `oedit-${gameId}-${Date.now()}` });
      const jobId = r.data.job_id;
      localStorage.setItem(`orai-edit-job-${gameId}`, jobId);
      toast.info("ORAi is working — this continues even if you leave the page");
      pollJob(jobId);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "ORAi edit failed");
      setBusy(false);
    }
  };

  const pollJob = (jobId) => {
    const iv = setInterval(async () => {
      try {
        const j = (await apiClient.get(`/jobs/${jobId}`)).data.job;
        if (j.phase === "completed") {
          clearInterval(iv);
          localStorage.removeItem(`orai-edit-job-${gameId}`);
          toast.success(`ORAi edit applied — v${j.result?.version} · $${j.result?.cost}`);
          setSubs(j.result?.substitutions || []);
          setEst(null); setPrompt(""); setAddStages(0); setBusy(false);
          onChanged && onChanged();
        } else if (j.phase === "failed" || j.phase === "cancelled") {
          clearInterval(iv);
          localStorage.removeItem(`orai-edit-job-${gameId}`);
          toast.error(j.error || "ORAi edit failed");
          setBusy(false);
        }
      } catch { /* keep polling */ }
    }, 3000);
  };

  // resume progress display if a job was running when the page was left
  React.useEffect(() => {
    const saved = localStorage.getItem(`orai-edit-job-${gameId}`);
    if (saved) { setBusy(true); pollJob(saved); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  return (
    <div className="or-surface p-3 mt-3" data-testid="game-orai-edit">
      <button className="w-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "#C26BFF" }} onClick={() => setOpen(!open)} data-testid="orai-edit-toggle">
        <Wand2 size={11} /> Edit with ORAi — Living Project {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-3">
          <textarea className="or-input w-full text-xs" rows={2} value={prompt}
            placeholder='Describe what to change… e.g. "Add an underwater biome", "Make enemies twice as aggressive", "Turn stage 3 into an ice fortress"'
            onChange={(e) => { setPrompt(e.target.value); setEst(null); }} data-testid="orai-edit-prompt" />
          <div className="flex gap-1.5 flex-wrap my-1.5">
            {QUICK.map(([l, p]) => (
              <button key={l} className="or-btn or-btn-ghost text-[9.5px] py-0.5 px-2"
                onClick={() => { setPrompt(p); setEst(null); }} data-testid={`orai-quick-${l.toLowerCase().replace(/ /g, "-")}`}>
                <Sparkles size={9} /> {l}
              </button>
            ))}
            {UNSUPPORTED.map(([l, what]) => (
              <button key={l} className="or-btn or-btn-ghost text-[9.5px] py-0.5 px-2 opacity-40 cursor-not-allowed"
                title={`The engine doesn't support ${what} yet — ORAi never fakes capabilities`}
                onClick={() => toast.warning(`Honest mode: the engine doesn't support ${what} yet, so ORAi won't pretend it does.`)}
                data-testid={`orai-unsupported-${l.toLowerCase().replace(/ /g, "-")}`}>
                <AlertTriangle size={9} /> {l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-2 text-[11px]">
            <span style={{ color: "var(--text-muted)" }}>Scope:</span>
            <select className="or-input text-xs py-1 w-auto" value={scope}
              onChange={(e) => { setScope(e.target.value); setEst(null); }} data-testid="orai-edit-scope">
              {["full", "stages", "environment", "player", "hud", "mechanics", "difficulty", "audio", "achievements", "story", "visuals"]
                .map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ color: "var(--text-muted)" }}>Generate more levels:</span>
            <input type="number" min={0} max={10} value={addStages} className="or-input w-16 text-xs"
              onChange={(e) => { setAddStages(Number(e.target.value)); setEst(null); }} data-testid="orai-add-stages" />
            {!est ? (
              <button className="or-btn text-xs" disabled={busy || (!prompt.trim() && !addStages)}
                onClick={estimate} data-testid="orai-edit-estimate">Estimate cost</button>
            ) : (
              <>
                <span className="font-bold" style={{ color: "#F4A73B" }} data-testid="orai-edit-cost">
                  ~${est.estimated_cost} · {est.model}
                </span>
                <button className="or-btn text-xs font-bold" style={{ background: "#C26BFF", color: "#0a0a0a" }}
                  disabled={busy} onClick={run} data-testid="orai-edit-apply">
                  {busy ? "Applying…" : "Apply edit"}
                </button>
              </>
            )}
          </div>
          {subs.length > 0 && (
            <div className="rounded-lg p-2 text-[10px] mb-1" data-testid="orai-edit-substitutions"
              style={{ background: "rgba(244,167,59,0.08)", border: "1px solid rgba(244,167,59,0.3)", color: "#F4A73B" }}>
              <b>ORAi substitutions (honest mode):</b>
              {subs.map((s, i) => <div key={i}>• {s}</div>)}
            </div>
          )}
          <p className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>
            ORAi patches only the requested scope and preserves everything else. Each edit creates a new version
            (rollback anytime in the Blueprint). Unsupported requests are declared, never faked.
          </p>
        </div>
      )}
    </div>
  );
}
