import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, LayoutDashboard, Rocket, Library } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";
import OraiProjectChat from "@/components/oraiprojects/OraiProjectChat";
import ToolGrid from "@/components/oraiprojects/ToolCards";
import ProviderGrid from "@/components/oraiprojects/ProviderCards";
import SmartSuggestions from "@/components/oraiprojects/SmartSuggestions";
import { ComplexitySlider, AIPowerSlider } from "@/components/oraiprojects/Sliders";
import DynamicToolSettings from "@/components/oraiprojects/DynamicToolSettings";
import CostEstimatePanel from "@/components/oraiprojects/CostEstimatePanel";
import EstimateReview from "@/components/oraiprojects/EstimateReview";
import GenerationProgress from "@/components/oraiprojects/GenerationProgress";
import ProjectHistory from "@/components/oraiprojects/ProjectHistory";
import BlueprintPlanner from "@/components/oraiprojects/BlueprintPlanner";
import ProjectMedia from "@/components/oraiprojects/ProjectMedia";

const ACTIVE_KEY = "orai_active_project";

export default function OraiProjects() {
  const navigate = useNavigate();
  const [caps, setCaps] = useState(null);
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState("create"); // create | review | progress
  const [activeId, setActiveId] = useState(null);
  const [reviewProject, setReviewProject] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [blueprint, setBlueprint] = useState(null);
  const [bpLoading, setBpLoading] = useState(false);
  const [compatReport, setCompatReport] = useState(null);

  const [proj, setProj] = useState({
    id: null, name: "", prompt: "", tools: [], providers: [],
    complexity: 5, ai_power: 5, settings: {}, suggestion_used: "",
  });
  const [estimate, setEstimate] = useState(null);
  const [estLoading, setEstLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [reuseCandidates, setReuseCandidates] = useState([]);
  const debRef = useRef(null);

  useEffect(() => {
    apiClient.get("/orai/projects/capabilities")
      .then((r) => setCaps(r.data))
      .catch((e) => { if (e?.response?.status === 403) setDenied(true); });
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved) {
      apiClient.get(`/orai/projects/${saved}`).then((r) => {
        if (["queued", "generating"].includes(r.data.project.status)) {
          setActiveId(saved); setView("progress");
        } else localStorage.removeItem(ACTIVE_KEY);
      }).catch(() => localStorage.removeItem(ACTIVE_KEY));
    }
  }, []);

  const providerNames = useMemo(
    () => Object.fromEntries((caps?.providers || []).map((p) => [p.id, p.name])), [caps]);

  // Debounced estimate + suggestions
  useEffect(() => {
    if (!proj.tools.length) { setEstimate(null); setSuggestions([]); return; }
    setEstLoading(true);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => {
      apiClient.post("/orai/projects/estimate", proj)
        .then((r) => setEstimate(r.data.estimate)).catch(() => {})
        .finally(() => setEstLoading(false));
      apiClient.post("/orai/projects/suggest", proj)
        .then((r) => { setSuggestions(r.data.suggestions || []); setReuseCandidates(r.data.reuse_candidates || []); })
        .catch(() => {});
    }, 450);
    return () => clearTimeout(debRef.current);
  }, [proj.tools, proj.providers, proj.complexity, proj.ai_power, proj.settings, proj.prompt]); // eslint-disable-line

  const toggleTool = useCallback((id) => {
    setProj((p) => {
      const tools = p.tools.includes(id) ? p.tools.filter((t) => t !== id) : [...p.tools, id];
      const stillValid = (caps?.providers || []).filter((x) => p.providers.includes(x.id) && x.tools.some((t) => tools.includes(t))).map((x) => x.id);
      if (stillValid.length !== p.providers.length) toast.info("Provider selection adjusted — some providers don't support the new tool mix");
      return { ...p, tools, providers: stillValid };
    });
  }, [caps]);

  const toggleProvider = useCallback((id) =>
    setProj((p) => ({ ...p, providers: p.providers.includes(id) ? p.providers.filter((x) => x !== id) : [...p.providers, id] })), []);

  const useSuggestion = (s) => {
    setProj((p) => ({ ...p, ai_power: s.ai_power, providers: s.providers, suggestion_used: s.id }));
    toast.success(`${s.name} combination applied`);
  };

  const applyPreset = (pr) => {
    setProj((p) => ({ ...p, tools: pr.tools.length ? pr.tools : p.tools, complexity: pr.complexity,
      ai_power: pr.ai_power, settings: { ...p.settings, ...pr.settings } }));
    toast.success(`Preset: ${pr.name}`);
  };

  const usePrompt = useCallback((text, opts = {}) => {
    setProj((p) => ({ ...p, prompt: text, name: p.name || text.slice(0, 60) }));
    if (!opts.silent) toast.success("Prompt applied to Project Summary");
  }, []);

  const planBlueprint = async () => {
    if (!proj.prompt.trim()) { toast.error("Describe the game first (chat or prompt box)"); return; }
    setBpLoading(true);
    setCompatReport(null);
    try {
      const { data } = await apiClient.post("/orai/projects/blueprints/plan", {
        request: proj.prompt, name: proj.name, complexity: proj.complexity, ai_power: proj.ai_power,
      });
      setBlueprint(data.blueprint);
      setView("blueprint");
      toast.success("Game blueprint planned — review before approval");
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (d && d.error_code === "no_compatible_runtime") {
        setCompatReport(d);
        toast.error("No compatible runtime — see the compatibility report");
      } else {
        toast.error(typeof d === "string" ? d : "Blueprint planning failed");
      }
    }
    finally { setBpLoading(false); }
  };

  const goReview = async () => {
    if (!proj.tools.length) { toast.error("Select at least one tool"); return; }
    if (!proj.prompt.trim()) { toast.error("Describe your project first (chat or prompt box)"); return; }
    try {
      const { data } = await apiClient.post("/orai/projects/draft", proj);
      setProj((p) => ({ ...p, id: data.project.id }));
      setReviewProject(data.project);
      setView("review");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save draft"); }
  };

  const onApproved = (p) => {
    localStorage.setItem(ACTIVE_KEY, p.id);
    setActiveId(p.id); setView("progress"); setHistoryKey((k) => k + 1);
  };

  const openFromHistory = (p) => {
    if (["queued", "generating", "completed", "partially_completed", "failed", "canceled"].includes(p.status)) {
      setActiveId(p.id); setView("progress");
      if (["queued", "generating"].includes(p.status)) localStorage.setItem(ACTIVE_KEY, p.id);
    } else {
      setProj({ id: p.id, name: p.name, prompt: p.prompt, tools: p.tools || [], providers: p.providers || [],
        complexity: p.complexity, ai_power: p.ai_power, settings: p.settings || {}, suggestion_used: p.suggestion_used || "" });
      setView("create");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (denied) return (
    <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="orai-projects-denied">
      ORAi Projects is founder-only.
    </div>
  );

  const H = ({ children }) => (
    <div className="text-[11px] font-bold uppercase tracking-wider mt-4 mb-2" style={{ color: "var(--text-muted)" }}>{children}</div>
  );

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 pb-24 overflow-x-hidden" data-testid="orai-projects-page">
      {/* Centered branding */}
      <div className="text-center pt-4 pb-3">
        <div className="inline-flex items-center gap-2">
          <Sparkles size={20} style={{ color: "#C26BFF" }} />
          <span className="text-lg sm:text-2xl font-black tracking-tight"
            style={{ background: "linear-gradient(90deg,#C26BFF,#2EA0FF,#2EE6FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            OurRealm AI — Project Creator
          </span>
        </div>
        <div className="flex justify-center gap-2 mt-1.5">
          <button className="or-btn text-[10px] flex items-center gap-1" onClick={() => navigate("/admin/orai/dashboard")}
            data-testid="orai-dashboard-link"><LayoutDashboard size={10} /> ORAi Dashboard</button>
        </div>
      </div>

      {view === "review" && reviewProject && (
        <EstimateReview project={reviewProject} providerNames={providerNames}
          onBack={() => setView("create")} onApproved={onApproved} />
      )}
      {view === "blueprint" && blueprint && (
        <BlueprintPlanner bp={blueprint} onUpdate={setBlueprint}
          onExit={() => { setBlueprint(null); setView("create"); }} />
      )}
      {view === "progress" && activeId && (
        <GenerationProgress projectId={activeId}
          onExit={() => { setView("create"); setHistoryKey((k) => k + 1); localStorage.removeItem(ACTIVE_KEY); }} />
      )}

      {view === "create" && (
        <>
          {/* 1. ORAi Chat — always first */}
          <OraiProjectChat onUsePrompt={usePrompt} />

          {/* Project Media — reusable import library */}
          <ProjectMedia />

          {/* Prompt + name */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            <input className="or-input text-sm sm:col-span-1" placeholder="Project name"
              value={proj.name} onChange={(e) => setProj({ ...proj, name: e.target.value })}
              data-testid="project-name-input" aria-label="Project name" />
            <input className="or-input text-sm sm:col-span-2" placeholder="Main project prompt (type here or use a chat message)"
              value={proj.prompt} onChange={(e) => setProj({ ...proj, prompt: e.target.value })}
              data-testid="project-prompt-input" aria-label="Project prompt" />
          </div>

          {/* Presets */}
          <div className="flex gap-1.5 flex-wrap mt-2" data-testid="preset-row">
            {(caps?.presets || []).map((pr) => (
              <button key={pr.id} className="text-[9.5px] px-2 py-1 rounded-full transition-colors"
                style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", color: "var(--text-muted)" }}
                onClick={() => applyPreset(pr)} data-testid={`preset-${pr.id}`}>{pr.name}</button>
            ))}
          </div>

          <H>2 · Select Tools</H>
          {caps ? <ToolGrid tools={caps.tools} selected={proj.tools} onToggle={toggleTool}
            disabledMap={{ course: (caps.course_centers || []).length ? null : "Needs a Responsibility Center",
                           video: caps.providers.find((p) => p.id === "openai_video")?.connected ? null : "OpenAI Video not connected" }} />
            : <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading tools…</div>}

          {proj.tools.includes("game") && (
            <div className="or-surface p-2.5 mt-2 flex flex-wrap items-center gap-2" data-testid="blueprint-cta">
              <div className="text-[10px] flex-1" style={{ color: "var(--text-muted)" }}>
                <b style={{ color: "#F4A73B" }}>AAA Game Blueprint:</b> plan the full game design, runtime
                recommendation and asset reuse before anything generates.
              </div>
              <button className="or-btn text-[10.5px] font-bold" disabled={bpLoading}
                style={{ background: "linear-gradient(90deg,#F4A73B,#C26BFF)", color: "#fff" }}
                onClick={planBlueprint} data-testid="plan-blueprint-btn">
                {bpLoading ? "Planning…" : "Plan Game Blueprint"}
              </button>
            </div>
          )}

          {compatReport && (
            <div className="or-surface p-3 mt-2 space-y-1.5" data-testid="compat-report"
              style={{ border: "1px solid #FF5A6E66", background: "#FF5A6E0d" }}>
              <div className="text-[11px] font-bold" style={{ color: "#FF5A6E" }}>
                ⚠ No compatible runtime — blueprint generation stopped
              </div>
              <div className="text-[10.5px]" style={{ color: "var(--text-muted)" }} data-testid="compat-report-message">
                {compatReport.message}
              </div>
              <div className="text-[10px] grid sm:grid-cols-2 gap-x-4 gap-y-1">
                <div data-testid="compat-requested"><b style={{ color: "#F4A73B" }}>Requested:</b>{" "}
                  {(compatReport.requested_mechanics || []).join(", ") || "—"}</div>
                <div data-testid="compat-closest"><b style={{ color: "#2EE6FF" }}>Closest runtime:</b>{" "}
                  {compatReport.closest_matching_runtime} (score {compatReport.compatibility_score})</div>
                <div data-testid="compat-supported"><b style={{ color: "#10E670" }}>Supported:</b>{" "}
                  {(compatReport.supported_mechanics || []).join(", ") || "none"}</div>
                <div data-testid="compat-unsupported"><b style={{ color: "#FF5A6E" }}>Unsupported:</b>{" "}
                  {(compatReport.unsupported_mechanics || []).join(", ") || "none"}</div>
              </div>
              {(compatReport.recommendations || []).length > 0 && (
                <ul className="text-[10px] list-disc pl-4" style={{ color: "var(--text-muted)" }}
                  data-testid="compat-recommendations">
                  {compatReport.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
              <button className="or-btn text-[10px]" onClick={() => setCompatReport(null)}
                data-testid="compat-report-dismiss">Dismiss</button>
            </div>
          )}

          {proj.tools.length > 0 && (
            <>
              <H>3 · Available APIs & Providers</H>
              <ProviderGrid providers={caps?.providers || []} tools={proj.tools}
                selected={proj.providers} onToggle={toggleProvider} />

              {suggestions.length > 0 && (
                <>
                  <H>4 · AI Smart Suggestions</H>
                  <SmartSuggestions suggestions={suggestions} providerNames={providerNames}
                    activeId={proj.suggestion_used} onUse={useSuggestion} />
                </>
              )}
              {reuseCandidates.length > 0 && (
                <div className="or-surface p-2.5 mt-2 flex items-start gap-2" data-testid="reuse-candidates">
                  <Library size={13} style={{ color: "#2EE6FF" }} className="mt-0.5 shrink-0" />
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    <b style={{ color: "#2EE6FF" }}>Library match:</b> you already have{" "}
                    {reuseCandidates.map((c) => c.title).join(", ")} — reuse them as references instead of regenerating.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
                <div className="lg:col-span-2 space-y-3">
                  <H>5 · Configure Project</H>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <ComplexitySlider value={proj.complexity} onChange={(v) => setProj({ ...proj, complexity: v })} tools={proj.tools} />
                    <AIPowerSlider value={proj.ai_power} onChange={(v) => setProj({ ...proj, ai_power: v })}
                      tierLabel={caps?.ai_power_tiers?.[proj.ai_power]} />
                  </div>
                  <H>6 · Output & Content Options</H>
                  <DynamicToolSettings tools={proj.tools} settings={proj.settings}
                    onChange={(s) => setProj({ ...proj, settings: s })} caps={caps} />
                </div>
                <div className="space-y-3">
                  <H>7 · Estimate</H>
                  <CostEstimatePanel estimate={estimate} loading={estLoading} sticky />
                  <button className="or-btn w-full py-3 text-sm font-bold flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(90deg,#C26BFF,#2EA0FF)", color: "#fff" }}
                    onClick={goReview} data-testid="create-project-btn">
                    <Rocket size={15} /> Create ORAi Project
                  </button>
                  <p className="text-[9px] text-center" style={{ color: "var(--text-muted)" }}>
                    Opens Review & Approval — nothing generates until you explicitly approve.
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="mt-8">
            <ProjectHistory onOpen={openFromHistory} refreshKey={historyKey} />
          </div>
        </>
      )}
    </div>
  );
}
