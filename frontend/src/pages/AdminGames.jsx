import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Gamepad2, Loader2, Lock, Rocket, CheckCircle2, XCircle, Trash2, RefreshCcw, Play, Eye, Archive, Sparkles } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import GameRuntime from "@/components/games/GameRuntime";

const STATUS_COLORS = {
  building: "#2EE6FF", pending_approval: "#F4A73B", approved: "#2EA0FF",
  published: "#10E670", failed: "#FF6B6B", declined: "#FF6B6B", archived: "#8A93A6",
};
const POWER_LABELS = ["", "Fast & light", "Efficient", "Improved planning", "Planning + review",
  "Strong reasoning", "Deep QA", "Advanced design", "Rich iterations", "Highest intelligence", "Maximum depth"];

function Slider({ label, value, onChange, max, allowed, labels, testid }) {
  const isAllowed = (n) => !allowed || allowed.includes(n);
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <b>{label}</b>
        <span style={{ color: "#2EE6FF" }} data-testid={`${testid}-value`}>
          {value}{!isAllowed(value) ? " (locked)" : ""} — {labels ? labels[value] : ""}
        </span>
      </div>
      <input type="range" min={1} max={max} value={value} className="w-full accent-[#2EE6FF]"
        onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />
      <div className="flex justify-between text-[9px]" style={{ color: "var(--text-muted)" }}>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <span key={n} style={{ color: !isAllowed(n) ? "#556" : undefined }}>
            {!isAllowed(n) ? <Lock size={8} className="inline" /> : n}
          </span>
        ))}
      </div>
      {!isAllowed(value) && (
        <div className="text-[10px] mt-1" style={{ color: "#F4A73B" }} data-testid={`${testid}-locked-note`}>
          <Lock size={10} className="inline mr-1" />Level {value} isn't enabled — adjust in Game Creator Access below.
        </div>
      )}
    </div>
  );
}

const ALL_LEVELS = Array.from({ length: 10 }, (_, i) => i + 1);

function AccessConfig({ label, cfg, onChange, testid }) {
  return (
    <div className="mb-3" data-testid={testid}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <b className="text-[11px] w-full sm:w-40">{label}</b>
        {["all", "range", "custom"].map((m) => (
          <button key={m} className="or-btn or-btn-ghost text-[10px]"
            style={cfg.mode === m ? { background: "rgba(46,230,255,0.15)", color: "#2EE6FF", borderColor: "rgba(46,230,255,0.5)" } : {}}
            onClick={() => onChange({ ...cfg, mode: m })} data-testid={`${testid}-mode-${m}`}>
            {m === "all" ? "All (default)" : m === "range" ? "Range" : "Custom"}
          </button>
        ))}
      </div>
      {cfg.mode === "range" && (
        <div className="flex items-center gap-2 mt-1.5 text-[11px]">
          Min <input type="number" min={1} max={10} value={cfg.min ?? 1} className="or-input w-16 text-xs"
            onChange={(e) => onChange({ ...cfg, min: Number(e.target.value) })} data-testid={`${testid}-min`} />
          Max <input type="number" min={1} max={10} value={cfg.max ?? 10} className="or-input w-16 text-xs"
            onChange={(e) => onChange({ ...cfg, max: Number(e.target.value) })} data-testid={`${testid}-max`} />
        </div>
      )}
      {cfg.mode === "custom" && (
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {ALL_LEVELS.map((n) => {
            const on = (cfg.levels || []).includes(n);
            return (
              <button key={n} className="text-[10px] w-7 h-7 rounded-lg"
                style={{ border: `1px solid ${on ? "#2EE6FF" : "rgba(255,255,255,0.15)"}`, background: on ? "rgba(46,230,255,0.15)" : "transparent", color: on ? "#2EE6FF" : "var(--text-muted)" }}
                onClick={() => onChange({ ...cfg, levels: on ? (cfg.levels || []).filter((x) => x !== n) : [...(cfg.levels || []), n] })}
                data-testid={`${testid}-level-${n}`}>{n}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminGames() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [deniedMsg, setDeniedMsg] = useState(null);
  const [request, setRequest] = useState("");
  const [complexity, setComplexity] = useState(2);
  const [power, setPower] = useState(5);
  const [opts, setOpts] = useState({ target_age: "", grade_level: "", subject: "" });
  const [estimate, setEstimate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [access, setAccess] = useState(null);
  const [showAccess, setShowAccess] = useState(false);
  const pollRef = useRef(null);
  const selGame = params.get("game");
  const allowedC = data?.allowed_complexity || ALL_LEVELS;
  const allowedP = data?.allowed_power || ALL_LEVELS;

  const load = useCallback(() => {
    apiClient.get("/admin/games").then((r) => { setData(r.data); setDeniedMsg(null); })
      .catch((e) => {
        if (e?.response?.status === 403) setDeniedMsg(e?.response?.data?.detail || "Founder access only");
        else toast.error(e?.response?.data?.detail || "Could not load Game Studio");
      });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (data?.studio_access) setAccess((a) => a || data.studio_access); }, [data]);

  const saveAccess = async () => {
    try {
      await apiClient.patch("/admin/games/settings", access);
      toast.success("Game Creator access saved");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save access settings"); }
  };

  useEffect(() => {
    const estId = params.get("estimate");
    if (estId && data) {
      const e = data.pending_estimates.find((x) => x.id === estId);
      if (e) setEstimate(e);
    }
  }, [params, data]);

  useEffect(() => {
    if (!selGame) { setDetail(null); return; }
    const fetchGame = () => apiClient.get(`/admin/games/${selGame}`).then((r) => {
      setDetail(r.data.game);
      if (r.data.game.status !== "building" && pollRef.current) clearInterval(pollRef.current);
    }).catch(() => {});
    fetchGame();
    pollRef.current = setInterval(fetchGame, 5000);
    return () => clearInterval(pollRef.current);
  }, [selGame]);

  const makeEstimate = async () => {
    if (!request.trim()) { toast.error("Describe the game first"); return; }
    setBusy(true);
    try {
      const r = await apiClient.post("/admin/games/estimate", { request, complexity, ai_power: power, ...opts });
      setEstimate(r.data.estimate);
      toast.success("Estimate ready — nothing builds until you approve");
    } catch (e) { toast.error(e?.response?.data?.detail || "Estimate failed"); }
    finally { setBusy(false); }
  };

  const approveBuild = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/games/estimate/${estimate.id}/build`);
      toast.success("Build approved — ORAi is building in the isolated workspace");
      setEstimate(null); setRequest("");
      setParams({ game: r.data.game.id });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Build failed to start"); }
    finally { setBusy(false); }
  };

  const act = async (gameId, action, feedback = "") => {
    setBusy(true);
    try {
      await apiClient.post(`/admin/games/${gameId}/action`, { action, feedback });
      toast.success(`${action} — done`);
      if (action === "delete") setParams({});
      load();
      if (selGame) apiClient.get(`/admin/games/${selGame}`).then((r) => setDetail(r.data.game)).catch(() => {});
    } catch (e) { toast.error(e?.response?.data?.detail || `${action} failed`); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-4xl mx-auto pb-12" data-testid={deniedMsg ? "admin-games-denied" : "admin-games-page"}>
      {deniedMsg ? (
        <div className="or-surface p-8 text-center mt-8">
          <Gamepad2 size={36} className="mx-auto mb-3" style={{ color: "#C26BFF" }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{deniedMsg}</p>
        </div>
      ) : (
      <>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate("/admin")} data-testid="games-back">
          <ArrowLeft size={13} /> Admin Hub</button>
        <h1 className="text-xl sm:text-2xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
          <Gamepad2 size={22} style={{ color: "#C26BFF" }} /> OurRealm Game Studio
        </h1>
      </div>
      <p className="text-[11px] mb-4" style={{ color: "var(--text-muted)" }}>
        Describe a game in plain language — ORAi designs it, estimates the cost, and only builds after
        your approval. Games run in an isolated sandbox and publish to /games when you approve them.
        You can also just tell the floating ORAi: "Create a rhythm game that teaches beat matching."
      </p>

      {!selGame && (
        <>
          <div className="or-surface p-4 mb-3" data-testid="game-create-panel">
            <textarea className="or-input w-full text-sm" rows={3} value={request}
              placeholder='e.g. "Create a fractions game based on baking for 4th graders"'
              onChange={(e) => setRequest(e.target.value)} data-testid="game-request-input" />
            <div className="grid grid-cols-3 gap-2 my-2">
              {["target_age", "grade_level", "subject"].map((k) => (
                <input key={k} className="or-input text-xs" placeholder={k.replace("_", " ")}
                  value={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.value })}
                  data-testid={`game-opt-${k}`} />
              ))}
            </div>
            <Slider label="Game Complexity" value={complexity} onChange={setComplexity} max={10} allowed={allowedC}
              labels={["", "Very Simple", "Simple", "Enhanced", "Advanced", "Complex", "Highly Complex", "Simulation", "Large Experience", "World Scale", "Universe Scale"]}
              testid="game-complexity-slider" />
            <Slider label="AI Power" value={power} onChange={setPower} max={10} allowed={allowedP} labels={POWER_LABELS}
              testid="game-power-slider" />
            <button className="or-btn text-xs font-bold"
              disabled={busy || !allowedC.includes(complexity) || !allowedP.includes(power)} onClick={makeEstimate}
              data-testid="game-estimate-btn">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Get Cost Estimate
            </button>
          </div>

          <div className="or-surface p-3 mb-3" data-testid="game-access-panel">
            <button className="w-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "#F4A73B" }} onClick={() => setShowAccess(!showAccess)} data-testid="game-access-toggle">
              <Lock size={11} /> Game Creator Access {showAccess ? "▾" : "▸"}
              <span className="font-normal normal-case tracking-normal" style={{ color: "var(--text-muted)" }}>
                (founder — configure which levels others can use)
              </span>
            </button>
            {showAccess && access && (
              <div className="mt-3">
                <AccessConfig label="Game Complexity Access" cfg={access.complexity_access}
                  onChange={(c) => setAccess({ ...access, complexity_access: c })} testid="access-complexity" />
                <AccessConfig label="AI Power Access" cfg={access.ai_power_access}
                  onChange={(c) => setAccess({ ...access, ai_power_access: c })} testid="access-power" />
                <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
                  Founders always keep 1–10. These limits apply to everyone else through the existing
                  AI Access Policy system (per-user, badge, progression and invite rules plug in later).
                </p>
                <button className="or-btn text-xs" onClick={saveAccess} data-testid="game-access-save">Save Access</button>
              </div>
            )}
          </div>

          {estimate && (
            <div className="or-surface p-4 mb-3" style={{ border: "1px solid rgba(244,167,59,0.4)" }} data-testid="game-estimate-card">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#F4A73B" }}>
                Approval required — nothing builds until you approve
              </div>
              <b className="text-sm">{estimate.plan.title}</b>
              <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                {estimate.plan.gameplay_summary || estimate.plan.concept}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                <div className="rounded-lg p-2" style={{ background: "rgba(46,230,255,0.06)" }} data-testid="game-est-runtime">
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: "#2EE6FF" }}>Runtime selected</div>
                  <b className="text-[11px]">{estimate.plan.runtime_label || estimate.plan.runtime}</b>
                </div>
                <div className="rounded-lg p-2" style={{ background: "rgba(194,107,255,0.06)" }} data-testid="game-est-stages">
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: "#C26BFF" }}>Stages · Play time</div>
                  <b className="text-[11px]">{estimate.plan.stages} stages · ~{estimate.plan.est_play_minutes} min</b>
                </div>
                <div className="rounded-lg p-2" style={{ background: "rgba(16,230,112,0.06)" }} data-testid="game-est-saves">
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: "#10E670" }}>Save features</div>
                  <b className="text-[11px]">{(estimate.plan.save_features || []).join(", ") || "—"}</b>
                </div>
              </div>
              {estimate.plan.visual_plan && (
                <div className="mt-2 rounded-lg p-2" style={{ background: "rgba(194,107,255,0.06)", border: "1px solid rgba(194,107,255,0.25)" }}
                  data-testid="game-est-visual-plan">
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#C26BFF" }}>
                    Presentation & Visual Plan
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                    <span>Mode: <b>{estimate.plan.visual_plan.presentation_mode?.replace(/_/g, " ")}</b></span>
                    <span>Player: <b>{estimate.plan.visual_plan.player_appearance || "—"}</b></span>
                    <span>Hazard types: <b>{estimate.plan.visual_plan.hazard_types_planned}</b></span>
                    <span>Pickup types: <b>{estimate.plan.visual_plan.pickup_types_planned}</b></span>
                    <span className="col-span-2">Stage visual groups: <b>{estimate.plan.visual_plan.stage_visual_groups}</b></span>
                  </div>
                  {estimate.plan.visual_plan.visual_style_summary && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{estimate.plan.visual_plan.visual_style_summary}</p>
                  )}
                  {(estimate.plan.visual_plan.environment_themes || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {estimate.plan.visual_plan.environment_themes.map((e, i) => (
                        <span key={i} className="text-[9.5px] px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(194,107,255,0.12)", border: "1px solid rgba(194,107,255,0.35)", color: "#C26BFF" }}>{e}</span>
                      ))}
                    </div>
                  )}
                  {(estimate.plan.visual_plan.visual_warning || estimate.plan.visual_plan.fallback_shapes) && (
                    <div className="text-[10px] mt-1" style={{ color: "#F4A73B" }} data-testid="game-est-visual-warning">
                      ⚠ {estimate.plan.visual_plan.visual_warning || "Basic procedural shapes will be used at this complexity."}
                    </div>
                  )}
                </div>
              )}
              {(estimate.plan.mechanics || []).length > 0 && (
                <div className="mt-2" data-testid="game-est-mechanics">
                  <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Mechanics included</div>
                  <div className="flex flex-wrap gap-1">
                    {estimate.plan.mechanics.map((m, i) => (
                      <span key={i} className="text-[9.5px] px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(46,230,255,0.1)", border: "1px solid rgba(46,230,255,0.3)", color: "#2EE6FF" }}>{m}</span>
                    ))}
                  </div>
                </div>
              )}
              {(estimate.plan.complexity_features || []).length > 0 && (
                <div className="mt-2" data-testid="game-est-complexity-features">
                  <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Complexity {estimate.complexity} features</div>
                  <div className="text-[10px]" style={{ color: "var(--text-main)" }}>
                    {estimate.plan.complexity_features.map((f, i) => <span key={i}>✓ {f}{i < estimate.plan.complexity_features.length - 1 ? "  ·  " : ""}</span>)}
                  </div>
                </div>
              )}
              {((estimate.plan.substitutions || []).length > 0 || (estimate.plan.unsupported_mechanics || []).length > 0) && (
                <div className="mt-2 rounded-lg p-2" style={{ background: "rgba(244,167,59,0.08)", border: "1px solid rgba(244,167,59,0.3)" }}
                  data-testid="game-est-substitutions">
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "#F4A73B" }}>Honest limits & substitutions</div>
                  {(estimate.plan.substitutions || []).map((s, i) => <div key={`s${i}`} className="text-[10px]">⚠ {s}</div>)}
                  {(estimate.plan.unsupported_mechanics || []).map((s, i) => <div key={`u${i}`} className="text-[10px]">✗ Not in Phase 1: {s}</div>)}
                </div>
              )}
              <div className="text-[11px] mt-2">
                {(estimate.plan.features || []).map((f, i) => <div key={i}>• {f}</div>)}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                <span>Complexity <b style={{ color: "var(--text-main)" }}>{estimate.complexity}</b> · AI Power <b style={{ color: "var(--text-main)" }}>{estimate.ai_power}</b></span>
                <span data-testid="game-est-cost">Est. cost: <b style={{ color: "#F4A73B" }}>${estimate.estimates.provider_cost}</b></span>
                <span>~{estimate.estimates.generation_time_min} min · {estimate.estimates.testing}</span>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="or-btn text-xs font-bold" style={{ background: "#10E670", color: "#0a0a0a" }}
                  disabled={busy} onClick={approveBuild} data-testid="game-approve-build">
                  <Rocket size={13} /> Approve & Build
                </button>
                <button className="or-btn text-xs" disabled={busy}
                  onClick={async () => { await apiClient.post(`/admin/games/estimate/${estimate.id}/cancel`); setEstimate(null); toast.success("Cancelled"); }}
                  data-testid="game-cancel-estimate">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-2" data-testid="games-list">
            {(data?.games || []).map((g) => (
              <button key={g.id} className="or-surface p-3 w-full text-left flex items-center gap-3"
                onClick={() => setParams({ game: g.id })} data-testid={`game-row-${g.id}`}>
                <Gamepad2 size={16} style={{ color: "#C26BFF" }} />
                <div className="flex-1 min-w-0">
                  <b className="text-xs">{g.title}</b>
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {g.runtime} · C{g.complexity} · Power {g.ai_power} · est ${g.est_cost} / actual ${g.actual_cost} · {g.plays || 0} plays
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                  style={{ background: `${STATUS_COLORS[g.status]}22`, color: STATUS_COLORS[g.status] }}>
                  {g.status.replace(/_/g, " ")}
                </span>
              </button>
            ))}
            {data && !data.games.length && (
              <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }} data-testid="games-empty">
                No games yet — describe your first one above.
              </div>
            )}
          </div>
        </>
      )}

      {selGame && detail && (
        <div className="space-y-3" data-testid="game-detail">
          <div className="or-surface p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <button className="or-btn or-btn-ghost text-[10px]" onClick={() => setParams({})} data-testid="game-back-list">
                <ArrowLeft size={11} /> Studio</button>
              <b className="text-sm flex-1">{detail.title}</b>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                style={{ background: `${STATUS_COLORS[detail.status]}22`, color: STATUS_COLORS[detail.status] }}
                data-testid="game-detail-status">{detail.status.replace(/_/g, " ")}</span>
            </div>
            <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
              {detail.runtime} · Complexity {detail.complexity} · AI Power {detail.ai_power} ·
              est ${detail.est_cost} / actual ${detail.actual_cost}
              {detail.test_results && <> · tests: {detail.test_results.passed ? "✓ passed" : "✗ failed"}</>}
            </div>
            {detail.error && <div className="text-[10px] mt-1" style={{ color: "#FF8A8A" }} data-testid="game-error">{detail.error}</div>}
            {detail.status === "building" && (
              <div className="text-[11px] mt-2 flex items-center gap-1.5" style={{ color: "#2EE6FF" }} data-testid="game-building">
                <Loader2 size={12} className="animate-spin" /> {detail.stage} — {(detail.build_log || []).slice(-1)[0]?.msg}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              {detail.status === "pending_approval" && (
                <>
                  <button className="or-btn text-xs font-bold" style={{ background: "#10E670", color: "#0a0a0a" }} disabled={busy}
                    onClick={() => act(detail.id, "publish")} data-testid="game-publish">
                    <Rocket size={12} /> Approve & Publish to /games</button>
                  <button className="or-btn text-xs" disabled={busy} onClick={() => act(detail.id, "approve")} data-testid="game-approve">
                    <CheckCircle2 size={12} /> Approve Only</button>
                  <button className="or-btn text-xs" style={{ color: "#C26BFF" }} disabled={busy}
                    onClick={() => { const f = window.prompt("Feedback for ORAi (rebuilds the game):"); if (f) act(detail.id, "regenerate", f); }}
                    data-testid="game-request-changes"><RefreshCcw size={12} /> Return with Feedback</button>
                  <button className="or-btn text-xs" style={{ color: "#FF6B6B" }} disabled={busy}
                    onClick={() => act(detail.id, "decline")} data-testid="game-decline"><XCircle size={12} /> Decline</button>
                </>
              )}
              {detail.status === "approved" && (
                <button className="or-btn text-xs font-bold" style={{ background: "#10E670", color: "#0a0a0a" }} disabled={busy}
                  onClick={() => act(detail.id, "publish")} data-testid="game-publish-approved"><Rocket size={12} /> Publish to /games</button>
              )}
              {detail.status === "published" && (
                <>
                  <button className="or-btn text-xs" disabled={busy} onClick={() => navigate(`/games?play=${detail.id}`)} data-testid="game-open-hub">
                    <Play size={12} /> Open in /games</button>
                  <button className="or-btn text-xs" style={{ color: "#FF8A5A" }} disabled={busy}
                    onClick={() => act(detail.id, "unpublish")} data-testid="game-unpublish">Unpublish</button>
                </>
              )}
              {detail.status === "failed" && (
                <button className="or-btn text-xs" disabled={busy} onClick={() => act(detail.id, "regenerate")} data-testid="game-retry">
                  <RefreshCcw size={12} /> Retry Build</button>
              )}
              {["declined", "failed", "approved"].includes(detail.status) && (
                <button className="or-btn text-xs" style={{ color: "#FF6B6B" }} disabled={busy}
                  onClick={() => window.confirm("Delete this game?") && act(detail.id, "delete")} data-testid="game-delete">
                  <Trash2 size={12} /> Delete</button>
              )}
              {detail.status === "published" && (
                <button className="or-btn text-xs" disabled={busy} onClick={() => act(detail.id, "archive")} data-testid="game-archive">
                  <Archive size={12} /> Archive</button>
              )}
            </div>
          </div>

          {detail.spec && (
            <div className="or-surface p-4" data-testid="game-preview-panel">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#2EE6FF" }}>
                <Eye size={11} className="inline mr-1" />Playable preview (sandboxed — mobile & desktop)
              </div>
              <GameRuntime spec={detail.spec} height={440} gameId={detail.id} />
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
