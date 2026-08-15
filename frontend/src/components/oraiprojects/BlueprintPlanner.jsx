import { useEffect, useState } from "react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { ArrowLeft, Check, Cpu, Layers, Library, RefreshCw, ShieldAlert, Wand2, X } from "lucide-react";
import AssetLibrarySearch from "./AssetLibrarySearch";

const Chip = ({ children, color = "#7B8CFF" }) => (
  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
    style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>{children}</span>
);

const Section = ({ title, children }) => (
  <div className="or-surface p-3">
    <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>{title}</div>
    {children}
  </div>
);

const ListLine = ({ label, items }) => (items || []).length ? (
  <div className="text-[10.5px] mb-1"><b style={{ color: "#2EE6FF" }}>{label}:</b>{" "}
    <span style={{ color: "var(--text-muted)" }}>{items.slice(0, 8).join(" · ")}</span></div>
) : null;

const DECISION_LABELS = {
  use_suggested: "Use suggested", search_library: "Search library",
  upload_replacement: "Upload replacement", generate_later: "Generate later",
  skip_optional: "Skip (optional)",
};

export default function BlueprintPlanner({ bp, onUpdate, onExit }) {
  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showAssets, setShowAssets] = useState(true);
  const [searchFor, setSearchFor] = useState(null);
  const b = bp.blueprint, id = bp.identity || b.identity, g = b.gameplay, rec = bp.runtime_recommendation;
  const approved = bp.approval_status === "approved";

  const call = async (path, body = {}, ok) => {
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/orai/projects/blueprints/${bp.id}${path}`, body);
      if (data.blueprint) onUpdate(data.blueprint);
      if (ok) toast.success(ok);
      return data;
    } catch (e) { toast.error(e?.response?.data?.detail || "Request failed"); }
    finally { setBusy(false); }
  };

  const decide = async (reqId, decision) => {
    if (decision === "search_library") { setSearchFor(reqId); }
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/orai/projects/blueprints/${bp.id}/assets/${reqId}/decision`, { decision });
      onUpdate({ ...bp, asset_requirements: bp.asset_requirements.map((r) => r.req_id === reqId ? data.requirement : r) });
      toast.success(`Decision saved: ${DECISION_LABELS[decision]}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Decision failed"); }
    finally { setBusy(false); }
  };

  const onAssetPicked = (req) => {
    onUpdate({ ...bp, asset_requirements: bp.asset_requirements.map((r) => r.req_id === req.req_id ? req : r) });
  };

  return (
    <div className="space-y-3" data-testid="blueprint-planner">
      {/* Header */}
      <div className="or-surface p-3 flex flex-wrap items-center gap-2">
        <button className="or-btn text-[10px] flex items-center gap-1" onClick={onExit} data-testid="blueprint-back-btn">
          <ArrowLeft size={11} /> Back
        </button>
        <div className="font-black text-sm flex-1" data-testid="blueprint-title">{id.title || bp.name}</div>
        <Chip color="#F4A73B">Blueprint v{bp.version}</Chip>
        <Chip color={bp.validation?.status === "valid" ? "#10E670" : bp.validation?.status === "invalid" ? "#FF5470" : "#F4A73B"}>
          {bp.validation?.status?.replaceAll("_", " ")}
        </Chip>
        <Chip color={approved ? "#10E670" : "#C26BFF"}>{approved ? "Approved — build pending" : "Pending founder approval"}</Chip>
      </div>

      {/* Summary + runtime */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Project Summary">
          <div className="text-[11px] mb-1.5" data-testid="blueprint-description">{id.description}</div>
          <div className="flex flex-wrap gap-1.5">
            {id.genre && <Chip>{id.genre}</Chip>}
            <Chip color="#2EE6FF">{id.visual_dimension}</Chip>
            {(id.target_devices || []).map((d) => <Chip key={d} color="#10E670">{d}</Chip>)}
            <Chip color="#F4A73B">Complexity {bp.complexity}</Chip>
            <Chip color="#C26BFF">AI Power {bp.ai_power}</Chip>
          </div>
          <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
            <b>Camera:</b> {b.runtime.camera_model || "—"} · <b>Controls:</b> {b.runtime.control_model || "—"}
          </div>
        </Section>

        <Section title="Runtime Recommendation">
          <div className="flex items-center gap-2 mb-1" data-testid="runtime-recommendation">
            <Cpu size={13} style={{ color: "#2EA0FF" }} />
            {rec.no_compatible_runtime && !bp.selected_runtime
              ? <b className="text-[11px]" style={{ color: "#FF5470" }}>No compatible runtime available</b>
              : <b className="text-[11px]">{bp.selected_runtime_label}</b>}
            {bp.selected_runtime && <Chip color="#2EA0FF">score {bp.diagnostics?.runtime_compatibility_score}</Chip>}
          </div>
          <div className="text-[10px] mb-1.5" style={{ color: "var(--text-muted)" }}>{rec.reason}</div>
          {!approved && (
            <select className="or-input text-[10.5px] w-full" value={bp.selected_runtime || ""}
              disabled={busy} data-testid="runtime-select"
              onChange={(e) => e.target.value && call("/runtime", { runtime: e.target.value }, "Runtime changed — assets re-matched")}>
              <option value="" disabled>Change runtime…</option>
              {(rec.compatible_runtimes || []).map((c) => (
                <option key={c.runtime_id} value={c.runtime_id}>{c.label} (score {c.score})</option>
              ))}
            </select>
          )}
          <ListLine label="Supported mechanics" items={bp.mechanics_support?.supported} />
          {(bp.mechanics_support?.unsupported || []).length > 0 && (
            <div className="text-[10.5px]" data-testid="unsupported-mechanics">
              <b style={{ color: "#FF5470" }}>Unsupported:</b>{" "}
              <span style={{ color: "var(--text-muted)" }}>{bp.mechanics_support.unsupported.join(" · ")}</span>
            </div>
          )}
        </Section>
      </div>

      {/* Blueprint sections */}
      <Section title="Blueprint — Gameplay & Systems">
        <div className="text-[10.5px] mb-1.5" data-testid="core-loop"><b style={{ color: "#C26BFF" }}>Core loop:</b>{" "}
          <span style={{ color: "var(--text-muted)" }}>{g.core_loop}</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <div>
            <ListLine label="Player mechanics" items={g.player_mechanics} />
            <ListLine label="Enemies" items={g.enemies} />
            <ListLine label="Bosses" items={g.bosses} />
            <ListLine label="NPCs" items={g.npcs} />
            <ListLine label="Abilities / spells" items={[...(g.abilities || []), ...(g.weapons_or_spells || [])]} />
            <ListLine label="Levels" items={g.levels} />
            <ListLine label="Worlds / maps" items={[...(g.worlds || []), ...(g.maps || [])]} />
          </div>
          <div>
            <ListLine label="Objectives" items={g.objectives} />
            <ListLine label="Quests" items={g.quests} />
            <ListLine label="Upgrades" items={g.upgrades} />
            <ListLine label="UI / HUD" items={b.systems.ui_hud} />
            <ListLine label="Achievements" items={b.systems.achievements} />
            <ListLine label="Tutorials" items={b.systems.tutorials} />
            <ListLine label="Fire Power hooks" items={b.systems.fire_power_integrations} />
          </div>
        </div>
        {(g.progression || g.inventory || b.systems.save_requirements) && (
          <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
            {g.progression && <div><b>Progression:</b> {g.progression}</div>}
            {g.inventory && <div><b>Inventory:</b> {g.inventory}</div>}
            {b.systems.save_requirements && <div><b>Saves:</b> {b.systems.save_requirements}</div>}
          </div>
        )}
      </Section>

      {/* Asset requirements */}
      <Section title={`Asset Requirements (${bp.asset_requirements.length}) — library searched before generation`}>
        <button className="or-btn text-[10px] mb-2 flex items-center gap-1" onClick={() => setShowAssets(!showAssets)}
          data-testid="review-assets-btn"><Library size={11} /> {showAssets ? "Collapse" : "Review assets"}</button>
        {showAssets && (
          <div className="space-y-1.5" data-testid="asset-requirements-list">
            {bp.asset_requirements.map((r) => (
              <div key={r.req_id} className="p-2 rounded-lg" data-testid={`asset-req-${r.req_id}`}
                style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <b className="text-[10.5px]">{r.label}</b>
                  <Chip color="#7B8CFF">{r.category}</Chip>
                  {r.required && <Chip color="#F4A73B">required</Chip>}
                  {r.existing_match_found
                    ? <Chip color="#10E670">library match ({r.best_matches[0]?.match_score})</Chip>
                    : <Chip color="#FF5470">no match — generation needed later</Chip>}
                  {r.founder_decision !== "pending" && <Chip color="#2EE6FF">{DECISION_LABELS[r.founder_decision]}</Chip>}
                </div>
                <div className="text-[9.5px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {r.description} · {r.dimensions_or_format} · est ${r.est_generation_cost}
                  {r.best_matches?.length > 0 && <> · best: {r.best_matches.map((m) => m.name).join(", ")}</>}
                </div>
                {!approved && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.decision_options.map((d) => (
                      <button key={d} disabled={busy || (d === "use_suggested" && !r.best_matches?.length)}
                        className="text-[9px] px-1.5 py-0.5 rounded-full disabled:opacity-30"
                        style={{
                          background: r.founder_decision === d ? "rgba(46,230,255,.18)" : "rgba(255,255,255,.05)",
                          border: "1px solid rgba(255,255,255,.12)", color: r.founder_decision === d ? "#2EE6FF" : "var(--text-muted)",
                        }}
                        onClick={() => decide(r.req_id, d)} data-testid={`decision-${r.req_id}-${d}`}>
                        {DECISION_LABELS[d]}
                      </button>
                    ))}
                  </div>
                )}
                {!approved && searchFor === r.req_id && (
                  <AssetLibrarySearch requirement={r} bpId={bp.id}
                    onPicked={onAssetPicked} onClose={() => setSearchFor(null)} />
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Meta + validation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Estimated AI Usage & Build Stages">
          <div className="text-[10.5px] mb-1.5" data-testid="estimated-usage">
            Planning: <b>${b.meta.estimated_ai_usage?.planning}</b> · Assets if generated later:{" "}
            <b>${b.meta.estimated_ai_usage?.assets_if_generated_later}</b>
            <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{b.meta.estimated_ai_usage?.source}</div>
          </div>
          <div className="flex flex-wrap gap-1" data-testid="build-stages">
            {(b.meta.estimated_build_stages || []).map((s, i) => (
              <Chip key={s.id} color={i === 0 ? "#10E670" : "#7B8CFF"}>{i + 1}. {s.label}</Chip>
            ))}
          </div>
        </Section>
        <Section title="Validation & Limitations">
          {(bp.validation?.blocking || []).map((w, i) => (
            <div key={i} className="text-[10px] flex items-start gap-1" style={{ color: "#FF5470" }} data-testid="validation-blocking">
              <ShieldAlert size={11} className="mt-0.5 shrink-0" /> {w}</div>
          ))}
          {(bp.validation?.warnings || []).map((w, i) => (
            <div key={i} className="text-[10px] flex items-start gap-1" style={{ color: "#F4A73B" }} data-testid="validation-warning">
              <ShieldAlert size={11} className="mt-0.5 shrink-0" /> {w}</div>
          ))}
          {!(bp.validation?.warnings || []).length && !(bp.validation?.blocking || []).length && (
            <div className="text-[10px]" style={{ color: "#10E670" }}>Blueprint schema fully valid.</div>
          )}
          <div className="text-[9px] mt-1.5" style={{ color: "var(--text-muted)" }} data-testid="blueprint-diagnostics">
            Planner: {bp.diagnostics?.planning_provider}/{bp.diagnostics?.planning_model} ·{" "}
            {bp.diagnostics?.existing_matches}/{bp.diagnostics?.required_assets} assets matched from library ·{" "}
            req {bp.diagnostics?.request_id?.slice(0, 8)}
          </div>
          <ListLine label="Runtime limitations" items={b.meta.known_runtime_limitations} />
        </Section>
      </div>

      {/* Revise */}
      {revising && !approved && (
        <div className="or-surface p-3">
          <textarea className="or-input w-full text-[11px]" rows={2} value={feedback}
            placeholder="Founder feedback for the revision — e.g. add a second boss, make it darker fantasy"
            onChange={(e) => setFeedback(e.target.value)} data-testid="revise-feedback-input" />
          <button className="or-btn text-[10px] mt-1.5" disabled={busy || !feedback.trim()}
            onClick={async () => { await call("/revise", { feedback }, "Blueprint revised"); setRevising(false); setFeedback(""); }}
            data-testid="revise-submit-btn">Submit revision</button>
        </div>
      )}

      {/* Controls */}
      <div className="or-surface p-3 flex flex-wrap gap-2 items-center">
        {!approved && (
          <>
            <button className="or-btn text-[10.5px] flex items-center gap-1" disabled={busy}
              onClick={() => setRevising(!revising)} data-testid="revise-plan-btn"><RefreshCw size={11} /> Revise plan</button>
            <button className="or-btn text-[10.5px] flex items-center gap-1" disabled={busy}
              onClick={() => setShowAssets(true)} data-testid="review-assets-ctrl-btn"><Layers size={11} /> Review assets</button>
            <button className="or-btn text-[10.5px]" onClick={() => { toast.success("Draft saved"); onExit(); }}
              data-testid="save-draft-btn">Save draft</button>
            <button className="or-btn text-[10.5px] flex items-center gap-1" disabled={busy}
              onClick={async () => { await call("/cancel"); onExit(); }} data-testid="cancel-blueprint-btn">
              <X size={11} /> Cancel</button>
            <div className="flex-1" />
            <button className="or-btn text-[11px] font-bold flex items-center gap-1.5 px-4 py-2"
              style={{ background: "linear-gradient(90deg,#10E670,#2EE6FF)", color: "#04220f" }}
              disabled={busy || bp.validation?.status === "invalid"}
              onClick={() => call("/approve", {}, "Blueprint approved — building is a separate future phase, nothing was generated")}
              data-testid="approve-blueprint-btn"><Check size={13} /> Approve plan</button>
          </>
        )}
        {approved && (
          <div className="text-[10.5px] flex items-center gap-1.5 w-full" style={{ color: "#10E670" }} data-testid="approved-note">
            <Wand2 size={12} /> Blueprint approved — review the build below. No media was generated.
          </div>
        )}
        {approved && (
          <BuildReviewPanel bp={bp} onExit={onExit} />
        )}
      </div>
    </div>
  );
}

function BuildReviewPanel({ bp, onExit }) {
  const [review, setReview] = useState(null);
  const [building, setBuilding] = useState(bp.status === "building" || bp.status === "built");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!building) {
      apiClient.get(`/orai/projects/blueprints/${bp.id}/build/review`)
        .then((r) => setReview(r.data.review)).catch(() => {});
    }
  }, [bp.id, building]);

  useEffect(() => {
    if (!building) return;

    let pollWarningShown = false;

    const t = setInterval(() => {
      apiClient.get(`/orai/projects/blueprints/${bp.id}/build/status`)
        .then((r) => {
          pollWarningShown = false;
          setStatus(r.data);

          if (["built", "build_failed"].includes(r.data.blueprint_status)) {
            clearInterval(t);
          }
        })
        .catch((e) => {
          if (!pollWarningShown) {
            pollWarningShown = true;
            toast.error(
              e?.response?.data?.detail ||
              "Build started, but status refresh temporarily failed"
            );
          }
        });
    }, 3000);

    return () => clearInterval(t);
  }, [bp.id, building]);

  const approveBuild = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/orai/projects/blueprints/${bp.id}/build/approve`);

      setStatus((prev) => ({
        ...(prev || {}),
        blueprint_status: "building",
        game_id: r.data?.game_id || prev?.game_id
      }));

      toast.success(
        r.data?.already_building
          ? "Build is already running"
          : "Build approved — assembling your game"
      );
      setBuilding(true);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : d?.message || "Build validation failed");
    } finally { setBusy(false); }
  };

  if (building) {
    const g = status?.game;
    const done = status?.blueprint_status === "built";
    const failed = status?.blueprint_status === "build_failed";
    return (
      <div className="w-full" data-testid="build-progress-panel">
        <div className="text-[11px] font-bold mb-1" style={{ color: failed ? "#FF5470" : done ? "#10E670" : "#2EA0FF" }}>
          {failed ? "Build failed" : done ? "Playable build ready — pending your review in Game Studio" : `Building… ${g?.stage || ""}`}
        </div>
        {(g?.build_log || []).slice(-3).map((l, i) => (
          <div key={i} className="text-[9px]" style={{ color: "var(--text-muted)" }}>{l.stage}: {l.msg}</div>
        ))}
        {done && g && (
          <div className="text-[10px] mt-1.5 flex items-center gap-2 flex-wrap" data-testid="build-done-note">
            <Chip color="#10E670">{g.title}</Chip>
            <Chip color="#2EA0FF">{g.runtime}</Chip>
            <Chip color="#F4A73B">{(g.scene_graph || []).length} scenes</Chip>
            <span style={{ color: "var(--text-muted)" }}>Editable · remixable · founder-only release. Preview & publish in /admin/games.</span>
            <button className="or-btn text-[10px]" onClick={onExit} data-testid="build-exit-btn">Done</button>
          </div>
        )}
      </div>
    );
  }

  if (!review) return <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Loading build review…</div>;
  const v = review.validation;
  return (
    <div className="w-full" data-testid="build-review-panel">
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
        Founder Build Review — nothing builds until you approve
      </div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        <Chip color="#2EA0FF">{review.runtime_label}</Chip>
        <Chip color="#7B8CFF">{review.scenes.length} scenes</Chip>
        <Chip color="#10E670">{review.asset_resolution.resolved} library assets</Chip>
        <Chip color="#F4A73B">{review.asset_resolution.placeholders} placeholders</Chip>
        <Chip color="#C26BFF">~{review.estimated_build_seconds}s · ${review.estimated_ai_usage.amount}</Chip>
        <Chip color={v.passed ? "#10E670" : "#FF5470"}>{v.passed ? "validation passed" : "validation failed"}</Chip>
      </div>
      {v.blocking.map((w, i) => <div key={i} className="text-[10px]" style={{ color: "#FF5470" }} data-testid="build-blocking">{w}</div>)}
      {v.warnings.slice(0, 3).map((w, i) => <div key={i} className="text-[9.5px]" style={{ color: "#F4A73B" }}>{w}</div>)}
      <div className="flex flex-wrap gap-2 mt-2">
        <button className="or-btn text-[11px] font-bold px-4 py-2"
          style={{ background: "linear-gradient(90deg,#2EA0FF,#10E670)", color: "#04220f" }}
          disabled={busy || !v.passed} onClick={approveBuild} data-testid="approve-build-btn">
          Approve Build
        </button>
        <button className="or-btn text-[10.5px]" onClick={() => { toast.success("Draft kept — build anytime"); onExit(); }}
          data-testid="build-save-draft-btn">Save draft</button>
        <button className="or-btn text-[10.5px]" onClick={onExit} data-testid="build-cancel-btn">Cancel</button>
      </div>
    </div>
  );
}
