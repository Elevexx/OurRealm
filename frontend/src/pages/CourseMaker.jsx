import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Loader2, GraduationCap, Image as ImageIcon, Film, Volume2, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import StyleSelector from "@/components/rc/StyleSelector";

const STAGE_LABELS = {
  starting: "Queued — ORAi is warming up…",
  designing_course: "Designing the course structure…",
  designing_storyboard: "Creating the course storyboard & style bible…",
  creating_images: "Illustrating lessons with AI images…",
  complete: "Done!",
};

const stageLabel = (stage) => {
  if (stage?.startsWith("building_lessons")) {
    const part = stage.split(":")[1];
    return `Writing lessons, activities & quizzes…${part ? ` (module ${part})` : ""}`;
  }
  return STAGE_LABELS[stage] || "Working…";
};

const stageIndex = (stage) => {
  if (!stage) return 0;
  if (stage.startsWith("building_lessons")) return 2;
  return { starting: 0, designing_course: 1, designing_storyboard: 1, creating_images: 3, complete: 4 }[stage] ?? 0;
};

const STYLES = ["", "Classic Guided Lessons", "Hands-On Workshop", "Gamified", "Interactive Story",
  "Creator Academy", "Business Masterclass", "Fast Crash Course"];
const LENGTHS = ["", "Short (5–10 min per lesson)", "Standard (15–20 min per lesson)", "Deep dive (30+ min per lesson)"];

// Dedicated AI Course Maker workspace — blueprint-first, background generation
// with polled progress (no long HTTP request = no Cloudflare timeout).
export default function CourseMaker() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [grade, setGrade] = useState("");
  const [count, setCount] = useState("");
  const [style, setStyle] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [lessonLength, setLessonLength] = useState("");
  const [goals, setGoals] = useState("");
  const [finalProject, setFinalProject] = useState("");
  const [accessibility, setAccessibility] = useState("");
  const [wantImages, setWantImages] = useState(true);
  const [wantVideo, setWantVideo] = useState(false);
  const [wantAudio, setWantAudio] = useState(false);
  const [wantInteractive, setWantInteractive] = useState(true);
  const [styleProfile, setStyleProfile] = useState({ primary: "auto", camera: "Auto" });
  const [blueprint, setBlueprint] = useState(null);
  const [bpBusy, setBpBusy] = useState(false);
  const [job, setJob] = useState(null);
  const pollRef = useRef(null);

  const buildOptions = () => {
    const o = {};
    if (style) o.style = style;
    if (difficulty) o.difficulty = difficulty;
    if (lessonLength) o.lesson_length = lessonLength;
    const media = [];
    if (wantImages) media.push("AI-generated images");
    if (wantVideo) media.push("video segments (labeled placeholders until video generation is connected)");
    if (wantAudio) media.push("audio examples read aloud by ORAi's voice (audio_note blocks)");
    if (wantInteractive) media.push("interactive activities (tap_select, matching, ordering, scenario, checklist)");
    if (media.length) o.media_types = media.join("; ");
    if (goals.trim()) o.goals = goals.trim();
    if (finalProject.trim()) o.final_project = finalProject.trim();
    if (accessibility.trim()) o.accessibility = accessibility.trim();
    if (styleProfile && (styleProfile.primary !== "auto" || styleProfile.custom_prompt || styleProfile.secondary)) {
      o.style_profile = styleProfile;
    }
    return o;
  };

  const draftBlueprint = async () => {
    if (!prompt.trim() || bpBusy || job) return;
    setBpBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${id}/courses/blueprint`,
        { prompt: prompt.trim(), grade_level: grade || undefined, options: buildOptions() },
        { timeout: 120000 });
      setBlueprint(r.data.blueprint);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "ORAi could not draft a blueprint");
    } finally { setBpBusy(false); }
  };

  const generate = async () => {
    if (!prompt.trim() || job) return;
    try {
      const r = await apiClient.post(`/responsibility-center/${id}/courses/generate-async`, {
        prompt: prompt.trim(),
        grade_level: grade || blueprint?.grade_level || undefined,
        lesson_count: count ? Number(count) : undefined,
        blueprint: blueprint || undefined,
        options: buildOptions(),
        generate_images: wantImages,
      });
      setJob({ id: r.data.job_id, status: "running", stage: "starting" });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start generation");
    }
  };

  useEffect(() => {
    if (!job?.id || job.status !== "running") return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiClient.get(`/responsibility-center/${id}/courses/generate-jobs/${job.id}`);
        setJob({ ...r.data });
        if (r.data.status === "done") {
          clearInterval(pollRef.current);
          toast.success("Course drafted! Review and edit before publishing.");
          navigate(`/responsibility-center/${id}/courses/${r.data.course_id}/edit`);
        } else if (r.data.status === "failed") {
          clearInterval(pollRef.current);
          toast.error(r.data.error || "ORAi could not build that course");
          setJob(null);
        }
      } catch { /* transient poll error — keep polling */ }
    }, 3500);
    return () => clearInterval(pollRef.current);
  }, [job?.id, job?.status, id, navigate]);

  const busy = bpBusy || !!job;

  return (
    <div className="max-w-3xl mx-auto rcx-scope rcx-page-enter pb-12" data-testid="course-maker-page">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${id}/courses`)}
          data-testid="course-maker-back">
          <ArrowLeft size={13} /> Back to Courses
        </button>
        <h1 className="text-xl sm:text-2xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
          <Sparkles size={22} style={{ color: "#C26BFF" }} />
          <span style={{ background: "linear-gradient(90deg, #2EA0FF, #10E670, #FF8A5A)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            AI Course Maker
          </span>
        </h1>
      </div>

      <div className="or-surface p-4 sm:p-5 mb-4" data-testid="course-maker-form">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: "#C26BFF" }}>
          1 · Describe your course
        </div>
        <textarea className="or-input w-full text-sm mb-3" rows={3} maxLength={2000}
          placeholder='e.g. "Intro to Music Production — video-first and hands-on, ending with a final song project"'
          value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy}
          data-testid="maker-prompt" />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          <input className="or-input text-xs" placeholder="Grade level (e.g. 3rd Grade)" value={grade}
            onChange={(e) => setGrade(e.target.value)} disabled={busy} data-testid="maker-grade" />
          <input className="or-input text-xs" placeholder="Lessons (optional)" type="number" min={3} max={20}
            value={count} onChange={(e) => setCount(e.target.value)} disabled={busy} data-testid="maker-count" />
          <select className="or-input text-xs" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
            disabled={busy} data-testid="maker-difficulty">
            <option value="">Difficulty (auto)</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <select className="or-input text-xs" value={style} onChange={(e) => setStyle(e.target.value)}
            disabled={busy} data-testid="maker-style">
            {STYLES.map((s) => <option key={s} value={s}>{s || "Course style (auto)"}</option>)}
          </select>
          <select className="or-input text-xs col-span-2 sm:col-span-1" value={lessonLength}
            onChange={(e) => setLessonLength(e.target.value)} disabled={busy} data-testid="maker-length">
            {LENGTHS.map((s) => <option key={s} value={s}>{s || "Lesson length (auto)"}</option>)}
          </select>
        </div>

        <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>Media & activities</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            [wantImages, setWantImages, ImageIcon, "AI images", "maker-media-images"],
            [wantInteractive, setWantInteractive, MousePointerClick, "Interactive activities", "maker-media-interactive"],
            [wantAudio, setWantAudio, Volume2, "ORAi voice audio", "maker-media-audio"],
            [wantVideo, setWantVideo, Film, "Video (placeholders)", "maker-media-video"],
          ].map(([val, set, Icon, label, tid]) => (
            <button key={tid} type="button" disabled={busy} onClick={() => set(!val)} data-testid={tid}
              className="text-[11px] px-2.5 py-1.5 rounded-full flex items-center gap-1.5"
              style={{ background: val ? "rgba(194,107,255,0.18)" : "rgba(255,255,255,0.05)",
                       border: val ? "1px solid #C26BFF" : "1px solid rgba(255,255,255,0.1)",
                       color: val ? "#E4C4FF" : "var(--text-muted)" }}>
              <Icon size={12} /> {label}{val ? " ✓" : ""}
            </button>
          ))}
        </div>

        <div className="rounded-xl p-2.5 mb-3" style={{ background: "rgba(46,230,255,0.03)", border: "1px solid rgba(46,230,255,0.15)" }}>
          <StyleSelector value={styleProfile} onChange={setStyleProfile} gradeHint={grade} subjectHint={prompt} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <input className="or-input text-xs" placeholder="Learning goals (optional)" value={goals}
            onChange={(e) => setGoals(e.target.value)} disabled={busy} data-testid="maker-goals" />
          <input className="or-input text-xs" placeholder="Final project preference (optional)" value={finalProject}
            onChange={(e) => setFinalProject(e.target.value)} disabled={busy} data-testid="maker-final-project" />
          <input className="or-input text-xs sm:col-span-2" placeholder="Accessibility needs (optional)" value={accessibility}
            onChange={(e) => setAccessibility(e.target.value)} disabled={busy} data-testid="maker-accessibility" />
        </div>

        <button className="or-btn text-xs" onClick={draftBlueprint} disabled={busy || !prompt.trim()} data-testid="maker-draft-blueprint">
          {bpBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {bpBusy ? "Drafting blueprint…" : blueprint ? "Redraft Blueprint" : "Draft Blueprint"}
        </button>
      </div>

      {blueprint && !job && (
        <div className="or-surface p-4 sm:p-5 mb-4" style={{ border: "1px solid rgba(194,107,255,0.35)" }} data-testid="course-blueprint-card">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: "#C26BFF" }}>
            2 · Review the blueprint — everything is editable
          </div>
          <input className="or-input text-sm font-bold w-full mb-1" value={blueprint.title}
            onChange={(e) => setBlueprint({ ...blueprint, title: e.target.value })} data-testid="blueprint-title" />
          <textarea className="or-input text-xs w-full mb-2" rows={2} value={blueprint.description}
            onChange={(e) => setBlueprint({ ...blueprint, description: e.target.value })} data-testid="blueprint-description" />
          <div className="flex flex-wrap gap-1.5 mb-2 text-[10px]">
            {[["Difficulty", blueprint.difficulty], ["Level", blueprint.grade_level || "all"],
              ["Style", blueprint.learning_style], ["~Time", blueprint.estimated_minutes ? `${blueprint.estimated_minutes} min` : "—"],
              ["Quizzes", blueprint.quiz_count], ["Media", (blueprint.media_types || []).join(", ") || "—"]].map(([k, v]) => (
              <span key={k} className="px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                {k}: <b style={{ color: "var(--text-main)" }}>{v}</b>
              </span>
            ))}
          </div>
          {(blueprint.modules || []).map((m, mi) => (
            <div key={mi} className="mb-1.5">
              <input className="or-input text-xs font-bold w-full mb-0.5" value={m.title}
                onChange={(e) => { const mods = [...blueprint.modules]; mods[mi] = { ...m, title: e.target.value }; setBlueprint({ ...blueprint, modules: mods }); }}
                data-testid={`blueprint-module-${mi}`} />
              <div className="text-[10px] pl-2" style={{ color: "var(--text-muted)" }}>
                {(m.lessons || []).map((l) => (typeof l === "string" ? l : `${l.title}${l.media && l.media !== "none" ? ` (${l.media})` : ""}`)).join(" · ")}
              </div>
            </div>
          ))}
          {(blueprint.projects || []).length > 0 && (
            <div className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>Projects: {blueprint.projects.join(" · ")}</div>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="or-btn text-xs font-bold" style={{ background: "var(--brand-green, #10E670)", color: "#0a0a0a" }}
              onClick={generate} data-testid="blueprint-approve">✓ Approve & Generate</button>
            <button className="or-btn or-btn-ghost text-xs" onClick={() => setBlueprint(null)} data-testid="blueprint-discard">Discard</button>
          </div>
        </div>
      )}

      {job && (
        <div className="or-surface p-5 text-center" data-testid="course-gen-progress">
          <Loader2 size={26} className="animate-spin mx-auto mb-3" style={{ color: "#C26BFF" }} />
          <div className="text-sm font-bold mb-1" style={{ fontFamily: "var(--font-display)" }}>
            {stageLabel(job.stage)}
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            ORAi is building your course in the background — safe from timeouts. You can keep this tab open;
            the draft opens automatically when it's ready and everything stays editable before publishing.
          </div>
          <div className="flex justify-center gap-1.5 mt-3">
            {[1, 2, 3].map((s) => (
              <div key={s} className="h-1.5 w-10 rounded-full"
                style={{ background: stageIndex(job.stage) >= s ? "#C26BFF" : "rgba(255,255,255,0.1)" }} />
            ))}
          </div>
        </div>
      )}

      {!blueprint && !job && (
        <div className="or-surface p-4 text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="course-maker-hint">
          <GraduationCap size={14} className="inline mr-1" style={{ color: "#C26BFF" }} />
          ORAi builds full interactive courses: written lessons, tap-select checks, matching, ordering,
          scenarios, checklists, worksheets, quizzes with answer keys, projects, AI illustrations,
          ORAi-voiced audio examples — and honest labeled placeholders for video until video generation is connected.
        </div>
      )}
    </div>
  );
}
