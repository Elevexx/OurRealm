import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, GitBranch, Hammer, History, Loader2, RotateCcw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

// Founder-only "ORAi Build Blueprint" — inspect/edit the full build spec,
// rebuild in place (version history + rollback + compare), clone & regenerate.
export default function GameBlueprint({ game, onChanged }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("blueprint");
  const [specText, setSpecText] = useState("");
  const [req, setReq] = useState(game.request || "");
  const [cx, setCx] = useState(game.complexity || 3);
  const [pw, setPw] = useState(game.ai_power || 5);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState(null);
  const [cmp, setCmp] = useState(null);
  const [diag, setDiag] = useState(false);

  useEffect(() => { setSpecText(JSON.stringify(game.spec || {}, null, 2)); setReq(game.request || ""); }, [game]);
  const call = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); toast.success(okMsg); onChanged && onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };
  const loadVersions = () => apiClient.get(`/admin/games/${game.id}/versions`).then((r) => setVersions(r.data));
  const plan = game.plan || {};
  const vp = plan.visual_plan || {};
  const buildSecs = (() => {
    const log = game.build_log || [];
    if (log.length < 2) return null;
    return Math.round((new Date(log[log.length - 1].at) - new Date(log[0].at)) / 1000);
  })();

  return (
    <div className="or-surface p-3 mt-3" data-testid="game-blueprint">
      <button className="w-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "#C26BFF" }} onClick={() => setOpen(!open)} data-testid="blueprint-toggle">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} ORAi Build Blueprint
        <span className="font-normal normal-case tracking-normal" style={{ color: "var(--text-muted)" }}>(founder — fully editable)</span>
      </button>
      {open && (
        <div className="mt-2">
          <div className="flex gap-1 mb-2 flex-wrap">
            {[["blueprint", "Blueprint"], ["rebuild", "Rebuild with AI"], ["versions", "Versions"]].map(([k, l]) => (
              <button key={k} className="or-btn or-btn-ghost text-[10px]"
                style={tab === k ? { background: "rgba(194,107,255,0.15)", color: "#C26BFF" } : {}}
                onClick={() => { setTab(k); if (k === "versions") loadVersions(); }} data-testid={`blueprint-tab-${k}`}>{l}</button>
            ))}
            <span className="flex-1" />
            <button className="or-btn or-btn-ghost text-[10px]" disabled={busy}
              onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/clone`, {}), "Cloned — editable copy created")}
              data-testid="game-clone"><Copy size={10} /> Clone</button>
            <button className="or-btn or-btn-ghost text-[10px]" disabled={busy}
              onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/clone`, { regenerate: true, overrides: { request: req, complexity: cx, ai_power: pw } }), "Clone building with your edits — original untouched")}
              data-testid="game-clone-regenerate"><Wand2 size={10} /> Clone &amp; Regenerate</button>
          </div>

          {tab === "blueprint" && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-[10px] mb-2" data-testid="blueprint-summary">
                <span>Prompt: <b>{(game.request || "").slice(0, 60)}…</b></span>
                <span>Runtime: <b>{game.runtime}</b> · Mode: <b>{vp.presentation_mode || game.spec?.mode || "—"}</b></span>
                <span>Complexity <b>{game.complexity}</b> · AI Power <b>{game.ai_power}</b></span>
                <span>Stages: <b>{(game.spec?.stages || []).length}</b> · Play ~<b>{plan.est_play_minutes || "—"}</b> min</span>
                <span>Envs: <b>{[...new Set((game.spec?.stages || []).map((s) => s.environment).filter(Boolean))].join(", ") || "—"}</b></span>
                <span>Palette: <b>{game.spec?.visual_theme?.palette?.glow || "—"}</b> · Player: <b>{game.spec?.visual_theme?.player_name || game.spec?.visual_theme?.player || "—"}</b></span>
                <span>Achievements: <b>{(game.spec?.achievements || []).length}</b> · Unlockables: <b>{(game.spec?.unlockables || []).length}</b></span>
                <span>Validation: <b style={{ color: game.test_results?.passed ? "#10E670" : "#FF6B6B" }}>{game.test_results?.passed ? "passed" : "failed"}</b></span>
                <span>Version: <b>v{game.version || 1}</b></span>
              </div>
              <textarea className="or-input w-full text-[10px] font-mono" rows={14} value={specText}
                onChange={(e) => setSpecText(e.target.value)} data-testid="blueprint-json" />
              <button className="or-btn text-xs mt-1" disabled={busy}
                onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/rebuild`, { spec: specText }), "Blueprint saved — spec validated & applied (no AI cost)")}
                data-testid="blueprint-save">{busy ? <Loader2 size={12} className="animate-spin" /> : <Hammer size={12} />} Save Blueprint (validate &amp; apply)</button>
              <button className="or-btn or-btn-ghost text-[10px] mt-1 ml-2" onClick={() => setDiag(!diag)} data-testid="blueprint-diag-toggle">
                {diag ? "Hide" : "Show"} diagnostics
              </button>
              {diag && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] mt-1 rounded-lg p-2"
                  style={{ background: "rgba(244,167,59,0.05)" }} data-testid="blueprint-diagnostics">
                  <span>Runtime: <b>{game.runtime}</b> · Sandbox: <b>v3</b></span>
                  <span>AI Power used: <b>{game.ai_power}</b></span>
                  <span>Complexity contract: <b>{(plan.complexity_features || []).length} features</b></span>
                  <span>Build time: <b>{buildSecs != null ? `${buildSecs}s` : "—"}</b></span>
                  <span>Generation cost: <b>${game.actual_cost}</b></span>
                  <span>Spec size: <b>{Math.round(JSON.stringify(game.spec || {}).length / 1024)} KB</b> · {(game.spec?.stages || []).length} stages</span>
                </div>
              )}
            </>
          )}

          {tab === "rebuild" && (
            <div data-testid="blueprint-rebuild">
              <textarea className="or-input w-full text-xs" rows={3} value={req} onChange={(e) => setReq(e.target.value)}
                placeholder="Updated prompt / feedback" data-testid="rebuild-request" />
              <div className="flex gap-3 items-center text-[11px] my-1">
                Complexity <input type="number" min={1} max={10} value={cx} className="or-input w-14 text-xs" onChange={(e) => setCx(Number(e.target.value))} data-testid="rebuild-complexity" />
                AI Power <input type="number" min={1} max={10} value={pw} className="or-input w-14 text-xs" onChange={(e) => setPw(Number(e.target.value))} data-testid="rebuild-power" />
              </div>
              <button className="or-btn text-xs" disabled={busy}
                onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/rebuild`, { request: req, complexity: cx, ai_power: pw }), "Rebuilding in place — previous version saved to history")}
                data-testid="rebuild-run">{busy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Rebuild this game (AI, in place)</button>
              <p className="text-[9px] mt-1" style={{ color: "var(--text-muted)" }}>Current version is stored in history first — rollback anytime.</p>
            </div>
          )}

          {tab === "versions" && (
            <div data-testid="blueprint-versions">
              {!versions ? <Loader2 size={13} className="animate-spin" /> : (
                <>
                  <div className="text-[10px] mb-1"><History size={11} className="inline mr-1" />Current: <b>v{versions.current_version}</b></div>
                  {(versions.versions || []).length === 0 && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>No previous versions yet.</div>}
                  {(versions.versions || []).map((v, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] rounded-lg px-2 py-1 mb-0.5" style={{ background: "rgba(255,255,255,0.03)" }}>
                      <GitBranch size={10} style={{ color: "#C26BFF" }} />
                      <span className="flex-1">v{v.version} · {(v.at || "").slice(0, 16).replace("T", " ")} · C{v.complexity}/P{v.ai_power} · {(v.spec?.stages || []).length} stages</span>
                      <button className="or-btn or-btn-ghost text-[9px]" onClick={() => setCmp(cmp === i ? null : i)} data-testid={`version-compare-${i}`}>Compare</button>
                      <button className="or-btn or-btn-ghost text-[9px]" disabled={busy}
                        onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/rollback`, { index: i }), `Rolled back to v${v.version}`)}
                        data-testid={`version-rollback-${i}`}><RotateCcw size={9} /> Rollback</button>
                      <button className="or-btn or-btn-ghost text-[9px]" disabled={busy}
                        onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/versions/${i}/duplicate`), `Duplicated v${v.version}`)}
                        data-testid={`version-duplicate-${i}`}>Duplicate</button>
                    </div>
                  ))}
                  {cmp != null && versions.versions[cmp] && (
                    <div className="grid grid-cols-2 gap-2 mt-2" data-testid="version-compare-view">
                      <div><b className="text-[10px]" style={{ color: "#C26BFF" }}>v{versions.versions[cmp].version}</b>
                        <textarea readOnly className="or-input w-full text-[9px] font-mono" rows={12} value={JSON.stringify(versions.versions[cmp].spec, null, 2)} /></div>
                      <div><b className="text-[10px]" style={{ color: "#2EE6FF" }}>Current v{versions.current_version}</b>
                        <textarea readOnly className="or-input w-full text-[9px] font-mono" rows={12} value={JSON.stringify(versions.current?.spec, null, 2)} /></div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
