import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle, ArrowLeft, Save, CheckCircle2 } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";
import CostEstimatePanel from "./CostEstimatePanel";

const Row = ({ k, v }) => (
  <div className="flex justify-between gap-3 text-[10.5px] py-0.5">
    <span style={{ color: "var(--text-muted)" }}>{k}</span>
    <span className="text-right" style={{ color: "var(--text-primary)" }}>{v}</span>
  </div>
);

export const ProviderWorkflow = ({ stages }) => (
  <div className="or-surface p-3" data-testid="provider-workflow">
    <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#2EA0FF" }}>Provider Workflow</div>
    {stages.map((s) => (
      <Row key={s.id} k={s.label} v={s.provider} />
    ))}
  </div>
);

export const EstimateReview = ({ project, providerNames, onBack, onApproved }) => {
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState([]);

  useEffect(() => {
    apiClient.post(`/orai/projects/${project.id}/validate`)
      .then((r) => setValidation(r.data))
      .catch((e) => setValidation({ valid: false, errors: [e?.response?.data?.detail || "Validation failed"] }));
    // stage preview mirrors backend stages_for
    const t = project.tools || [];
    const list = [{ id: "validate", label: "Validating Request", provider: "internal" },
                  { id: "plan", label: "Planning Project", provider: providerNames?.plan || "AI reasoning" }];
    if (t.includes("text")) list.push({ id: "text", label: "Generating Text", provider: "AI reasoning tier" });
    if (t.includes("image")) list.push({ id: "image", label: "Generating Images", provider: "ORAi Image Pipeline" });
    if (t.includes("audio")) list.push({ id: "audio", label: "Generating Audio", provider: "ORAi Voice (TTS)" });
    if (t.includes("video")) list.push({ id: "video", label: "Generating Video", provider: "OpenAI Video (Sora)" });
    if (t.includes("game")) list.push({ id: "game", label: "Building Game", provider: "ORAi Game Studio" });
    if (t.includes("course")) list.push({ id: "course", label: "Building Course", provider: "ORAi Course Maker" });
    list.push({ id: "finalize", label: "Finalizing Project", provider: "internal" });
    setStages(list);
  }, [project.id]); // eslint-disable-line

  const approve = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/orai/projects/${project.id}/approve`,
        { idempotency_key: `${project.id}-${project.updated_at}` });
      toast.success(data.already_running ? "Already running" : "Project approved — generation started");
      onApproved(data.project);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Approval failed");
      setBusy(false);
    }
  };

  const s = project.settings || {};
  return (
    <div className="space-y-3" data-testid="estimate-review">
      <div className="flex items-center gap-2">
        <button className="or-btn text-xs flex items-center gap-1" onClick={onBack} data-testid="review-back-btn">
          <ArrowLeft size={12} /> Back to Edit
        </button>
        <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Review & Approve</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="or-surface p-3 lg:col-span-1" data-testid="project-summary">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#C26BFF" }}>Project Summary</div>
          <Row k="Name" v={project.name} />
          <Row k="Tools" v={(project.tools || []).join(", ")} />
          <Row k="Complexity" v={`${project.complexity}/10`} />
          <Row k="AI Power" v={`${project.ai_power}/10`} />
          {s.image && <Row k="Images" v={`${s.image.count ?? 4} × ${s.image.aspect || "1:1"} ${s.image.style || ""}`} />}
          {s.video && <Row k="Video" v={`${s.video.seconds || 8}s ${s.video.size || "1280x720"} (${s.video.model || "sora-2"})`} />}
          {s.audio && <Row k="Audio" v={`Narration · voice ${s.audio.voice_id || "nova"}`} />}
          {s.text && <Row k="Text" v={`${s.text.content_type || "article"} · ${s.text.length || "medium"}`} />}
          {s.course && <Row k="Course" v={`${s.course.modules ?? 3} modules × ${s.course.lessons_per_module ?? 3}`} />}
          {s.sound?.mode && <Row k="Sound" v={s.sound.mode === "existing" ? `Existing: ${s.sound.track_title || s.sound.track_id}` : s.sound.mode} />}
          <div className="text-[10px] mt-2 p-2 rounded" style={{ background: "rgba(255,255,255,.03)", color: "var(--text-muted)" }}>
            "{(project.prompt || "").slice(0, 300)}"
          </div>
        </div>
        <ProviderWorkflow stages={stages} />
        <CostEstimatePanel estimate={validation?.estimate || project.estimate} />
      </div>
      <div className="or-surface p-3" data-testid="validation-checklist">
        <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
          style={{ color: validation?.valid ? "#10E670" : "#FF6B6B" }}>
          <ShieldCheck size={11} className="inline mr-1" />Validation
        </div>
        {!validation && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Checking…</div>}
        {validation?.valid && (
          <div className="text-[11px] flex items-center gap-1.5" style={{ color: "#10E670" }} data-testid="validation-pass">
            <CheckCircle2 size={12} /> All checks passed — permissions, providers, credentials, settings, sound eligibility
          </div>
        )}
        {validation && !validation.valid && validation.errors.map((e, i) => (
          <div key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: "#FF6B6B" }} data-testid={`validation-error-${i}`}>
            <AlertTriangle size={12} /> {e}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="or-btn text-xs flex items-center gap-1" onClick={onBack} data-testid="review-save-draft">
          <Save size={12} /> Save as Draft
        </button>
        <button className="or-btn text-sm font-bold px-5 py-2.5 flex items-center gap-1.5"
          style={{ background: validation?.valid ? "linear-gradient(90deg,#10E670,#2EE6FF)" : undefined,
                   color: validation?.valid ? "#06210F" : undefined, opacity: busy ? 0.6 : 1 }}
          disabled={!validation?.valid || busy} onClick={approve} data-testid="approve-create-btn">
          <CheckCircle2 size={14} /> {busy ? "Starting…" : "Approve Estimate & Create Project"}
        </button>
      </div>
    </div>
  );
};

export default EstimateReview;
