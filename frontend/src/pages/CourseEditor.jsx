import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Save, Loader2, Rocket, ImagePlus, CheckCircle2, ListChecks } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import LessonVideoPanel from "@/components/rc/LessonVideoPanel";

const BLOCK_TYPES = ["text", "activity", "worksheet", "homework", "project", "review",
  "tap_select", "matching", "ordering", "short_answer", "reflection", "scenario",
  "checklist", "audio_note", "video_embed"];
const BLOCK_COLORS = { text: "#2EA0FF", activity: "#10E670", worksheet: "#4DD6C1", homework: "#F4A73B", project: "#C26BFF", review: "#FF8A5A" };

function QuizEditor({ quiz, onChange }) {
  const qs = quiz?.questions || [];
  const setQ = (i, patch) => onChange({ questions: qs.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  return (
    <div className="space-y-3" data-testid="quiz-editor">
      {qs.map((q, i) => (
        <div key={q.id || i} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(194,107,255,0.25)" }}>
          <div className="flex gap-2 mb-2">
            <input className="or-input flex-1 text-xs" value={q.q} placeholder={`Question ${i + 1}`}
              onChange={(e) => setQ(i, { q: e.target.value })} data-testid={`quiz-q-${i}`} />
            <button className="or-btn or-btn-ghost p-1.5" onClick={() => onChange({ questions: qs.filter((_, j) => j !== i) })}
              data-testid={`quiz-q-del-${i}`}><Trash2 size={12} /></button>
          </div>
          {q.options.map((o, oi) => (
            <div key={oi} className="flex items-center gap-2 mb-1">
              <input type="radio" checked={q.answer_index === oi} onChange={() => setQ(i, { answer_index: oi })}
                title="Correct answer" data-testid={`quiz-q-${i}-correct-${oi}`} className="accent-[#10E670]" />
              <input className="or-input flex-1 text-xs" value={o}
                onChange={(e) => setQ(i, { options: q.options.map((x, xi) => (xi === oi ? e.target.value : x)) })}
                data-testid={`quiz-q-${i}-opt-${oi}`} />
            </div>
          ))}
          <input className="or-input w-full text-xs mt-1" value={q.explanation || ""} placeholder="Answer key explanation"
            onChange={(e) => setQ(i, { explanation: e.target.value })} data-testid={`quiz-q-${i}-explain`} />
        </div>
      ))}
      <button className="or-btn or-btn-ghost text-xs" data-testid="quiz-add-q"
        onClick={() => onChange({ questions: [...qs, { id: `n${Date.now()}`, q: "", options: ["", "", "", ""], answer_index: 0, explanation: "" }] })}>
        <Plus size={12} /> Add question
      </button>
    </div>
  );
}

function LessonEditor({ centerId, courseId, lesson, onSaved, onDeleted }) {
  const [draft, setDraft] = useState(lesson);
  const [saving, setSaving] = useState(false);
  const [imgBusy, setImgBusy] = useState(null);
  useEffect(() => setDraft(lesson), [lesson]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await apiClient.patch(`/responsibility-center/${centerId}/courses/${courseId}/lessons/${lesson.id}`, draft);
      onSaved(r.data.lesson);
      toast.success("Lesson saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
    finally { setSaving(false); }
  };

  const genImage = async (blockId) => {
    setImgBusy(blockId);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/courses/${courseId}/lessons/${lesson.id}/image`,
        { block_id: blockId }, { timeout: 120000 });
      setDraft((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === blockId ? { ...b, image_url: r.data.image_url } : b)) }));
      toast.success("Illustration added");
    } catch (e) { toast.error(e?.response?.data?.detail || "Image generation failed"); }
    finally { setImgBusy(null); }
  };

  const setBlock = (i, patch) => setDraft((d) => ({ ...d, blocks: d.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));

  return (
    <div className="or-surface p-4" data-testid="lesson-editor">
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input className="or-input flex-1 min-w-[200px] text-sm font-semibold" value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="lesson-title-input" />
        <select className="or-input text-xs" value={draft.lesson_type}
          onChange={(e) => setDraft({ ...draft, lesson_type: e.target.value })} data-testid="lesson-type-select">
          <option value="lesson">Lesson</option><option value="quiz">Quiz</option><option value="checkpoint">Checkpoint</option>
        </select>
        <input className="or-input text-xs w-20" type="number" min={1} value={draft.duration_min}
          onChange={(e) => setDraft({ ...draft, duration_min: Number(e.target.value) })} title="Minutes" data-testid="lesson-duration-input" />
        <button className="or-btn text-xs" onClick={save} disabled={saving} data-testid="lesson-save-btn">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
        </button>
        <button className="or-btn or-btn-ghost text-xs" onClick={onDeleted} data-testid="lesson-delete-btn"><Trash2 size={12} /></button>
      </div>

      <div className="space-y-3 mb-4">
        {(draft.blocks || []).map((b, i) => (
          <div key={b.id} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BLOCK_COLORS[b.type] || "#2EE6FF"}44` }}
            data-testid={`block-editor-${i}`}>
            <div className="flex gap-2 mb-2 items-center">
              <select className="or-input text-[10px]" value={b.type} onChange={(e) => setBlock(i, { type: e.target.value })}
                style={{ color: BLOCK_COLORS[b.type] || "#2EE6FF" }} data-testid={`block-type-${i}`}>
                {BLOCK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className="or-input flex-1 text-xs" value={b.title} placeholder="Section title"
                onChange={(e) => setBlock(i, { title: e.target.value })} data-testid={`block-title-${i}`} />
              <button className="or-btn or-btn-ghost p-1.5 text-[10px]" onClick={() => genImage(b.id)} disabled={!!imgBusy}
                title="Generate illustration with ORAi" data-testid={`block-image-${i}`}>
                {imgBusy === b.id ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
              </button>
              <button className="or-btn or-btn-ghost p-1.5" onClick={() => setDraft((d) => ({ ...d, blocks: d.blocks.filter((_, j) => j !== i) }))}
                data-testid={`block-del-${i}`}><Trash2 size={12} /></button>
            </div>
            {b.image_url && <img src={b.image_url} alt="" className="rounded-lg mb-2 max-h-40 object-cover" />}
            {b.type === "video_embed" && (
              <LessonVideoPanel centerId={centerId} courseId={courseId} lessonId={lesson.id} block={b}
                onBlockChange={(patch) => setBlock(i, patch)} />
            )}
            <textarea className="or-input w-full text-xs" rows={4} value={b.body}
              onChange={(e) => setBlock(i, { body: e.target.value })} data-testid={`block-body-${i}`} />
          </div>
        ))}
        <button className="or-btn or-btn-ghost text-xs" data-testid="block-add-btn"
          onClick={() => setDraft((d) => ({ ...d, blocks: [...(d.blocks || []), { id: `n${Date.now()}`, type: "text", title: "", body: "", image_url: null }] }))}>
          <Plus size={12} /> Add content block
        </button>
      </div>

      <div className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2 flex items-center gap-1.5" style={{ color: "#C26BFF" }}>
        <ListChecks size={13} /> Quiz & answer key
      </div>
      <QuizEditor quiz={draft.quiz} onChange={(quiz) => setDraft({ ...draft, quiz })} />
    </div>
  );
}

// Course Editor — full editing of an AI-generated (or manual) course.
export default function CourseEditor() {
  const { id, courseId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [selId, setSelId] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${id}/courses/${courseId}`);
      setData(r.data);
      setMeta((m) => m || { title: r.data.course.title, description: r.data.course.description, grade_level: r.data.course.grade_level, subject: r.data.course.subject });
      setSelId((s) => s || r.data.lessons[0]?.id);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not load course"); }
  }, [id, courseId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="max-w-4xl mx-auto or-surface p-8 text-center rcx-scope"><div className="rcx-loader mb-3" /><div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading course…</div></div>;
  const { course, lessons } = data;
  const sel = lessons.find((l) => l.id === selId);

  const saveMeta = async (extra = {}) => {
    setBusy(true);
    try {
      const r = await apiClient.patch(`/responsibility-center/${id}/courses/${courseId}`, { ...meta, ...extra });
      setData((d) => ({ ...d, course: r.data.course }));
      toast.success(extra.status === "published" ? "Course published! 🎉" : "Course updated");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
    finally { setBusy(false); }
  };

  const addLesson = async (moduleId) => {
    try {
      const r = await apiClient.post(`/responsibility-center/${id}/courses/${courseId}/lessons`, { module_id: moduleId });
      await load();
      setSelId(r.data.lesson.id);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not add lesson"); }
  };

  const deleteLesson = async (lid) => {
    if (!window.confirm("Delete this lesson?")) return;
    try {
      await apiClient.delete(`/responsibility-center/${id}/courses/${courseId}/lessons/${lid}`);
      setSelId(null);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not delete"); }
  };

  return (
    <div className="max-w-6xl mx-auto rcx-scope rcx-page-enter pb-10" data-testid="course-editor-page">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${id}/courses`)} data-testid="course-editor-back">
          <ArrowLeft size={13} /> Course Studio
        </button>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={course.status === "published" ? { background: "rgba(16,230,112,0.15)", color: "#10E670" } : { background: "rgba(244,167,59,0.15)", color: "#F4A73B" }}>
          {course.status === "published" ? "Published" : "Draft"}
        </span>
        <div className="flex-1" />
        <button className="or-btn text-xs" onClick={() => saveMeta(course.status === "draft" ? { status: "published" } : {})} disabled={busy}
          data-testid="course-publish-btn">
          {course.status === "draft" ? <><Rocket size={12} /> Publish</> : <><CheckCircle2 size={12} /> Save details</>}
        </button>
      </div>

      <div className="or-surface p-4 mb-4" data-testid="course-meta-card">
        <input className="or-input w-full text-base font-bold mb-2" value={meta.title}
          onChange={(e) => setMeta({ ...meta, title: e.target.value })} onBlur={() => saveMeta()} data-testid="course-title-input" />
        <textarea className="or-input w-full text-xs mb-2" rows={2} value={meta.description}
          onChange={(e) => setMeta({ ...meta, description: e.target.value })} onBlur={() => saveMeta()} data-testid="course-desc-input" />
        <div className="flex gap-2">
          <input className="or-input text-xs w-40" value={meta.subject} placeholder="Subject"
            onChange={(e) => setMeta({ ...meta, subject: e.target.value })} onBlur={() => saveMeta()} data-testid="course-subject-input" />
          <input className="or-input text-xs w-40" value={meta.grade_level} placeholder="Grade level"
            onChange={(e) => setMeta({ ...meta, grade_level: e.target.value })} onBlur={() => saveMeta()} data-testid="course-grade-input" />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <aside className="w-full lg:w-64 shrink-0 space-y-2" data-testid="course-editor-outline">
          {course.modules.map((m, mi) => (
            <div key={m.id} className="or-surface p-2">
              <div className="text-[10px] font-bold uppercase tracking-wider px-2 py-1" style={{ color: "var(--text-muted)" }}>{m.title}</div>
              {m.lesson_ids.map((lid) => {
                const l = lessons.find((x) => x.id === lid);
                if (!l) return null;
                return (
                  <button key={lid} onClick={() => setSelId(lid)}
                    className="w-full text-left text-[11px] px-2 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors hover:bg-white/5"
                    style={selId === lid ? { background: "rgba(194,107,255,0.12)", border: "1px solid rgba(194,107,255,0.4)" } : { border: "1px solid transparent" }}
                    data-testid={`outline-lesson-${lid}`}>
                    <span className="shrink-0 text-[8px] font-bold px-1 rounded" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>
                      {l.lesson_type === "checkpoint" ? "CP" : l.lesson_type === "quiz" ? "QZ" : "L"}
                    </span>
                    <span className="truncate">{l.title}</span>
                  </button>
                );
              })}
              <button className="w-full text-[10px] px-2 py-1 rounded-lg text-left hover:bg-white/5" style={{ color: "var(--text-muted)" }}
                onClick={() => addLesson(m.id)} data-testid={`outline-add-${mi}`}>
                <Plus size={10} className="inline mr-1" />Add lesson
              </button>
            </div>
          ))}
        </aside>
        <main className="flex-1 min-w-0 w-full">
          {sel ? (
            <LessonEditor key={sel.id} centerId={id} courseId={courseId} lesson={sel}
              onSaved={(les) => setData((d) => ({ ...d, lessons: d.lessons.map((x) => (x.id === les.id ? les : x)) }))}
              onDeleted={() => deleteLesson(sel.id)} />
          ) : (
            <div className="or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>Pick a lesson to edit.</div>
          )}
        </main>
      </div>
    </div>
  );
}
