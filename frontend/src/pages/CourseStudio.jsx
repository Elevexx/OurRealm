import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles, BookOpen, Pencil, Play, Trash2, Loader2, BarChart3, GraduationCap, X, Share2, Library, Download } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const GEN_STEPS = ["Designing course structure…", "Writing lessons & activities…",
  "Building quizzes & answer keys…", "Adding worksheets, homework & projects…", "Placing checkpoints…"];

function ReportModal({ centerId, course, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get(`/responsibility-center/${centerId}/courses/${course.id}/report`)
      .then((r) => setData(r.data)).catch((e) => { toast.error(e?.response?.data?.detail || "Could not load report"); onClose(); });
  }, [centerId, course.id, onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="or-surface w-full max-w-lg max-h-[80vh] overflow-y-auto p-4 rcx-scope" onClick={(e) => e.stopPropagation()} data-testid="course-report-modal">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>Progress Report — {course.title}</div>
          <button className="or-btn or-btn-ghost p-1.5" onClick={onClose} data-testid="course-report-close"><X size={14} /></button>
        </div>
        {!data ? <div className="text-xs py-6 text-center" style={{ color: "var(--text-muted)" }}>Loading…</div> : (
          data.students.length === 0
            ? <div className="text-xs py-6 text-center" style={{ color: "var(--text-muted)" }}>No learner activity yet.</div>
            : data.students.map((s) => (
              <div key={s.user_id} className="flex items-center gap-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid={`course-report-row-${s.username}`}>
                <div className="text-xs font-semibold flex-1">@{s.username}</div>
                <div className="w-28 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: "#10E670" }} />
                </div>
                <div className="text-[10px] w-10 text-right">{s.pct}%</div>
                <div className="text-[10px] w-16 text-right" style={{ color: "var(--text-muted)" }}>
                  {s.avg_score != null ? `avg ${s.avg_score}%` : "—"}{s.pending ? ` · ${s.pending}⏳` : ""}
                </div>
              </div>
            ))
        )}
      </div>
    </div>,
    document.body,
  );
}

function ShareModal({ centerId, course, onClose }) {
  const [visibility, setVisibility] = useState("organization");
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/courses/${course.id}/share`, { visibility });
      toast.success(visibility === "private" ? "Sharing turned off" : `Shared with ${r.data.shared_with} Center(s)`);
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not share"); }
    finally { setBusy(false); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="or-surface w-full max-w-sm p-4 rcx-scope" onClick={(e) => e.stopPropagation()} data-testid="course-share-modal">
        <div className="text-sm font-bold mb-1" style={{ fontFamily: "var(--font-display)" }}>Share "{course.title}"</div>
        <div className="text-[10px] mb-3" style={{ color: "var(--text-muted)" }}>
          Imported copies stay editable and always credit you as the original creator.
        </div>
        {[["private", "Private", "Only this Center"],
          ["organization", "Organization", "Every Center you own"],
          ["invite", "Invite only", "Specific Centers (manage below)"]].map(([v, label, desc]) => (
          <label key={v} className="flex items-center gap-2 py-1.5 cursor-pointer" data-testid={`course-share-${v}`}>
            <input type="radio" checked={visibility === v} onChange={() => setVisibility(v)} className="accent-[#2EA0FF]" />
            <span className="text-[12px] font-semibold w-24">{label}</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{desc}</span>
          </label>
        ))}
        <div className="text-[9px] mt-1 mb-3" style={{ color: "var(--text-muted)" }}>Public sharing is coming in a future update.</div>
        <div className="flex gap-2">
          <button className="or-btn text-xs flex-1" onClick={share} disabled={busy} data-testid="course-share-confirm">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />} Apply
          </button>
          <button className="or-btn or-btn-ghost text-xs" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Course Studio — list + AI generation for a Center's courses.
export default function CourseStudio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [courses, setCourses] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [grade, setGrade] = useState("");
  const [count, setCount] = useState("");
  const [genStep, setGenStep] = useState(-1);
  const [report, setReport] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [shared, setShared] = useState([]);

  const load = useCallback(() => {
    apiClient.get(`/responsibility-center/${id}/courses`)
      .then((r) => { setCourses(r.data.courses); setCanManage(r.data.can_manage); })
      .catch((e) => toast.error(e?.response?.data?.detail || "Could not load courses"));
    apiClient.get(`/responsibility-center/${id}/courses-shared`)
      .then((r) => setShared(r.data.shared || [])).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!prompt.trim() || genStep >= 0) return;
    setGenStep(0);
    const stepTimer = setInterval(() => setGenStep((s) => Math.min(s + 1, GEN_STEPS.length - 1)), 9000);
    try {
      const r = await apiClient.post(`/responsibility-center/${id}/courses/generate`,
        { prompt: prompt.trim(), grade_level: grade || undefined, lesson_count: count ? Number(count) : undefined },
        { timeout: 300000 });
      toast.success("Course drafted! Review and edit before publishing.");
      setPrompt("");
      navigate(`/responsibility-center/${id}/courses/${r.data.course.id}/edit`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "ORAi could not build that course");
    } finally { clearInterval(stepTimer); setGenStep(-1); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.title}" and all its progress?`)) return;
    try { await apiClient.delete(`/responsibility-center/${id}/courses/${c.id}`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not delete"); }
  };

  return (
    <div className="max-w-5xl mx-auto rcx-scope rcx-page-enter pb-10" data-testid="course-studio-page">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${id}/education`)} data-testid="course-studio-back">
          <ArrowLeft size={13} /> Education Center
        </button>
        <h1 className="text-xl sm:text-2xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
          <GraduationCap size={22} style={{ color: "#C26BFF" }} /> Course Studio
        </h1>
      </div>

      {canManage && (
        <div className="or-surface p-4 mb-5" data-testid="course-generate-card">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2 flex items-center gap-1.5" style={{ color: "#C26BFF" }}>
            <Sparkles size={13} /> Create a course with ORAi
          </div>
          <textarea className="or-input w-full text-sm mb-2" rows={2} maxLength={2000}
            placeholder='Describe your course — e.g. "A fun introduction to fractions with lots of baking examples"'
            value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={genStep >= 0}
            data-testid="course-gen-prompt" />
          <div className="flex flex-wrap gap-2 items-center">
            <input className="or-input text-xs w-36" placeholder="Grade level (optional)" value={grade}
              onChange={(e) => setGrade(e.target.value)} disabled={genStep >= 0} data-testid="course-gen-grade" />
            <input className="or-input text-xs w-36" placeholder="Lessons (optional)" type="number" min={3} max={20}
              value={count} onChange={(e) => setCount(e.target.value)} disabled={genStep >= 0} data-testid="course-gen-count" />
            <button className="or-btn text-xs" onClick={generate} disabled={genStep >= 0 || !prompt.trim()} data-testid="course-gen-btn">
              {genStep >= 0 ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {genStep >= 0 ? "Generating…" : "Generate Course"}
            </button>
          </div>
          {genStep >= 0 && (
            <div className="mt-3 text-[11px] flex items-center gap-2" style={{ color: "#C26BFF" }} data-testid="course-gen-progress">
              <Loader2 size={12} className="animate-spin" /> {GEN_STEPS[genStep]}
              <span style={{ color: "var(--text-muted)" }}>· Everything stays editable before publishing</span>
            </div>
          )}
        </div>
      )}

      {!courses ? (
        <div className="or-surface p-8 text-center" data-testid="course-loading"><div className="rcx-loader mb-3" /><div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading courses…</div></div>
      ) : courses.length === 0 ? (
        <div className="or-surface p-10 text-center" data-testid="course-empty">
          <BookOpen size={36} className="mx-auto mb-3" style={{ color: "#C26BFF" }} />
          <div className="text-sm font-semibold mb-1">No courses yet</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {canManage ? "Describe a course above and ORAi will draft the whole thing — lessons, quizzes, worksheets and checkpoints." : "Your Center hasn't published any courses yet."}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rcx-stagger" data-testid="course-grid">
          {courses.map((c) => (
            <div key={c.id} className="or-surface p-4 flex flex-col rcx-hover-lift"
              style={{ borderTop: `2px solid ${c.color || "#2EA0FF"}` }} data-testid={`course-card-${c.id}`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-sm font-bold leading-tight">{c.title}</div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={c.status === "published"
                    ? { background: "rgba(16,230,112,0.15)", color: "#10E670" }
                    : { background: "rgba(244,167,59,0.15)", color: "#F4A73B" }}
                  data-testid={`course-status-${c.id}`}>
                  {c.status === "published" ? "Published" : "Draft"}
                </span>
              </div>
              <div className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
                {[c.subject, c.grade_level, `${c.lesson_count} lessons`].filter(Boolean).join(" · ")}
              </div>
              <div className="text-[11px] mb-3 flex-1" style={{ color: "var(--text-muted)" }}>{c.description?.slice(0, 140)}</div>
              <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${c.my_pct}%`, background: c.color || "#2EA0FF" }} />
              </div>
              <div className="text-[9px] mb-3" style={{ color: "var(--text-muted)" }}>{c.my_pct}% complete</div>
              <div className="flex gap-1.5 flex-wrap">
                <button className="or-btn text-xs flex-1" onClick={() => navigate(`/responsibility-center/${id}/courses/${c.id}/learn`)}
                  data-testid={`course-learn-${c.id}`}>
                  <Play size={12} /> {c.my_pct > 0 && c.my_pct < 100 ? "Continue" : c.my_pct >= 100 ? "Review" : "Start"}
                </button>
                {canManage && (
                  <>
                    <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${id}/courses/${c.id}/edit`)}
                      data-testid={`course-edit-${c.id}`}><Pencil size={12} /></button>
                    <button className="or-btn or-btn-ghost text-xs" onClick={() => setReport(c)} title="Progress report"
                      data-testid={`course-report-${c.id}`}><BarChart3 size={12} /></button>
                    {c.status === "published" && (
                      <button className="or-btn or-btn-ghost text-xs" onClick={() => setSharing(c)} title="Share course"
                        data-testid={`course-share-${c.id}`}><Share2 size={12} /></button>
                    )}
                    <button className="or-btn or-btn-ghost text-xs" title="Save as template" data-testid={`course-template-${c.id}`}
                      onClick={() => apiClient.post(`/responsibility-center/${id}/templates`, { kind: "course", name: c.title, source_id: c.id })
                        .then(() => toast.success("Saved to your Template Library"))
                        .catch((e) => toast.error(e?.response?.data?.detail || "Failed"))}>
                      <Library size={12} />
                    </button>
                    <button className="or-btn or-btn-ghost text-xs" onClick={() => remove(c)} title="Delete"
                      data-testid={`course-delete-${c.id}`}><Trash2 size={12} /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {report && <ReportModal centerId={id} course={report} onClose={() => setReport(null)} />}
      {sharing && <ShareModal centerId={id} course={sharing} onClose={() => setSharing(null)} />}

      {!!shared.length && (
        <div className="mt-6" data-testid="course-shared-section">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2 flex items-center gap-1.5" style={{ color: "#4DD6C1" }}>
            <Share2 size={13} /> Shared with this Center
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {shared.map((c) => (
              <div key={c.share_id} className="or-surface p-4" style={{ borderTop: `2px solid ${c.color || "#4DD6C1"}` }}
                data-testid={`shared-course-${c.id}`}>
                <div className="text-sm font-bold mb-0.5">{c.title}</div>
                <div className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
                  {[c.subject, c.grade_level, `${c.lesson_count} lessons`].filter(Boolean).join(" · ")}
                </div>
                <div className="text-[10px] mb-3" style={{ color: "#4DD6C1" }}>
                  by @{c.creator_username} · {c.from_center_name}
                </div>
                {canManage && (
                  <button className="or-btn text-xs w-full" data-testid={`shared-import-${c.id}`}
                    onClick={() => apiClient.post(`/responsibility-center/${id}/courses-shared/${c.id}/import`)
                      .then(() => { toast.success("Imported as an editable draft — creator credited"); load(); })
                      .catch((e) => toast.error(e?.response?.data?.detail || "Could not import"))}>
                    <Download size={12} /> Import editable copy
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
