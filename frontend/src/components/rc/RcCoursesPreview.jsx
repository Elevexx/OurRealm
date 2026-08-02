import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check, CheckSquare, Square, Sparkles, GraduationCap, ChevronLeft, ChevronRight,
  MessageCircle, Loader2, Trophy, BookOpen, Zap, RefreshCw, X,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { TutorPanel } from "@/pages/CoursePlayer";

// AI Courses Preview — live member selector + interactive per-member course
// cards. All member scoping is ALSO enforced server-side (courses-preview
// endpoints); this UI only reflects those permissions.
const nice = (s) => (s || "").replace(/_/g, " ");
const ACCENTS = ["#2EA0FF", "#10E670", "#F4A73B", "#2EE6FF", "#C26BFF"];

function ProfileChip({ m, selected, onClick, accent }) {
  return (
    <button onClick={onClick} disabled={!m.selectable}
      className="flex flex-col items-center gap-1 shrink-0 px-1 py-1 transition-transform"
      style={{ opacity: m.selectable ? 1 : 0.35, transform: selected ? "scale(1.04)" : "none" }}
      data-testid={`preview-member-${m.username}`} aria-pressed={selected}>
      <span className="relative">
        <span className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center block"
          style={{ background: "rgba(255,255,255,0.06)",
                   border: selected ? `2px solid ${accent}` : "2px solid transparent",
                   boxShadow: selected ? `0 0 14px ${accent}66` : "none" }}>
          {m.avatar_url
            ? <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
            : <span className="font-bold" style={{ color: accent }}>{(m.username || "?")[0].toUpperCase()}</span>}
        </span>
        {selected && (
          <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: accent }}><Check size={12} color="#0a0a0a" /></span>
        )}
      </span>
      <span className="text-[10px] font-semibold max-w-[64px] truncate">@{m.username}</span>
      <span className="text-[9px] capitalize" style={{ color: "var(--text-muted)" }}>{nice(m.relationship || m.role)}</span>
    </button>
  );
}

function LessonBlocks({ lesson, large }) {
  const blocks = lesson?.blocks || [];
  const img = blocks.find((b) => b.image_url)?.image_url || lesson?.image_url;
  return (
    <div className="space-y-3">
      {img && (
        <img src={img} alt={lesson.title}
          className="w-full object-cover rounded-xl"
          style={{ maxHeight: large ? 340 : 190, border: "1px solid rgba(46,160,255,0.25)" }}
          data-testid="preview-lesson-image" />
      )}
      {blocks.map((b) => (
        <div key={b.id}>
          {b.title && <div className="text-xs font-bold mb-0.5" style={{ color: "#2EE6FF" }}>{b.title}</div>}
          <div className="text-xs whitespace-pre-wrap" style={{ color: "var(--text-main)", lineHeight: 1.55 }}>
            {large ? b.body : `${b.body.slice(0, 600)}${b.body.length > 600 ? "…" : ""}`}
          </div>
        </div>
      ))}
      {!blocks.length && <div className="text-xs" style={{ color: "var(--text-muted)" }}>This lesson has no content yet.</div>}
    </div>
  );
}

function InlineQuiz({ centerId, courseId, lesson, memberIsSelf, onDone }) {
  const qs = lesson?.quiz?.questions || [];
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!qs.length) return null;
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.post(
        `/responsibility-center/${centerId}/courses/${courseId}/lessons/${lesson.id}/quiz`,
        { answers: qs.map((q) => answers[q.id] ?? -1) });
      setResult(data);
      onDone && onDone();
    } catch (e) { toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || "Quiz failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3 p-3 rounded-xl space-y-2" style={{ background: "rgba(194,107,255,0.07)", border: "1px solid rgba(194,107,255,0.25)" }} data-testid="preview-quiz">
      <div className="text-xs font-bold" style={{ color: "#C26BFF" }}>Quiz — {qs.length} question(s)</div>
      {qs.map((q, qi) => (
        <div key={q.id}>
          <div className="text-xs font-semibold mb-1">{qi + 1}. {q.q}</div>
          <div className="grid gap-1">
            {q.options.map((o, oi) => (
              <button key={oi} className="text-left text-xs px-2 py-1.5 rounded-lg"
                style={{ background: answers[q.id] === oi ? "rgba(46,160,255,0.2)" : "rgba(255,255,255,0.04)",
                         border: answers[q.id] === oi ? "1px solid var(--brand-blue)" : "1px solid transparent" }}
                onClick={() => !result && setAnswers({ ...answers, [q.id]: oi })}
                data-testid={`quiz-q${qi}-opt${oi}`}>{o}</button>
            ))}
          </div>
        </div>
      ))}
      {result ? (
        <div className="text-xs font-bold" style={{ color: "var(--brand-green, #10E670)" }} data-testid="quiz-result">
          Score: {result.score}/{result.total ?? qs.length}{result.passed === false ? " — try again!" : " 🎉"}
        </div>
      ) : (
        memberIsSelf && (
          <button className="or-btn text-xs font-bold" style={{ background: "#C26BFF", color: "#fff" }}
            disabled={busy || Object.keys(answers).length < qs.length} onClick={submit} data-testid="quiz-submit">
            {busy ? <Loader2 size={13} className="animate-spin" /> : "Submit quiz"}
          </button>
        )
      )}
    </div>
  );
}

function TutorHistoryPanel({ centerId, courseId, memberId, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    apiClient.get(`/responsibility-center/${centerId}/courses/${courseId}/tutor-history?member_id=${memberId}`)
      .then((r) => setRows(r.data.messages || [])).catch(() => setRows([]));
  }, [centerId, courseId, memberId]);
  return (
    <div className="mt-3 p-3 rounded-xl" style={{ background: "rgba(46,230,255,0.06)", border: "1px solid rgba(46,230,255,0.25)" }} data-testid="tutor-history-panel">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold" style={{ color: "#2EE6FF" }}>AI Tutor history (read-only)</span>
        <button className="or-btn or-btn-ghost p-1" onClick={onClose} aria-label="Close"><X size={13} /></button>
      </div>
      <div className="space-y-1.5 max-h-52 overflow-y-auto">
        {rows === null && <Loader2 size={14} className="animate-spin" />}
        {rows?.length === 0 && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>No tutor conversations yet.</div>}
        {(rows || []).map((r) => (
          <div key={r.id} className="text-[11px]" style={{ color: r.role === "user" ? "var(--text-main)" : "var(--text-muted)" }}>
            <b>{r.role === "user" ? "Member" : "ORAi"}:</b> {r.content.slice(0, 400)}
          </div>
        ))}
      </div>
    </div>
  );
}

function MemberCourseCard({ centerId, member, courses, accent, expanded, canManage, isSelf, onEduSaved }) {
  const [courseId, setCourseId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [idx, setIdx] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [grade, setGrade] = useState(member.grade_text || "");
  const [power, setPower] = useState(member.ai_power ?? 60);
  const [err, setErr] = useState(null);

  const activeCourseId = courseId || courses[0]?.id;
  const loadDetail = useCallback(() => {
    if (!activeCourseId) return;
    setErr(null);
    apiClient.get(`/responsibility-center/${centerId}/courses-preview/course?course_id=${activeCourseId}&member_id=${member.user_id}`)
      .then((r) => {
        setDetail(r.data);
        const lessons = r.data.lessons || [];
        const firstOpen = lessons.findIndex((l) => r.data.progress?.[l.id]?.status !== "completed");
        setIdx(firstOpen === -1 ? Math.max(0, lessons.length - 1) : firstOpen);
      })
      .catch((e) => setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || "Could not load this course"));
  }, [centerId, activeCourseId, member.user_id]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const saveEdu = async (body) => {
    try {
      await apiClient.patch(`/responsibility-center/${centerId}/members/${member.user_id}/education`, body);
      toast.success("Learning profile saved");
      onEduSaved && onEduSaved();
    } catch (e) { toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || "Could not save"); }
  };
  const complete = async (lesson) => {
    try {
      await apiClient.post(`/responsibility-center/${centerId}/courses/${activeCourseId}/lessons/${lesson.id}/complete`, {});
      toast.success("Lesson complete!");
      loadDetail();
    } catch (e) { toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || "Could not save progress"); }
  };

  const lessons = detail?.lessons || [];
  const lesson = lessons[idx];
  const prog = detail?.progress || {};
  const done = detail?.summary?.done || 0;
  const pct = lessons.length ? Math.round((done / lessons.length) * 100) : 0;

  return (
    <div className="or-surface p-4 flex flex-col" data-testid={`preview-card-${member.username}`}
      style={{ border: `1px solid ${accent}44`, boxShadow: `0 0 18px ${accent}22` }}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center shrink-0"
          style={{ background: "rgba(255,255,255,0.06)", border: `1.5px solid ${accent}` }}>
          {member.avatar_url ? <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
            : <span className="text-xs font-bold" style={{ color: accent }}>{(member.username || "?")[0].toUpperCase()}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">@{member.username}</div>
          <div className="text-[10px] capitalize" style={{ color: "var(--text-muted)" }}>
            {nice(member.relationship || member.role)} · {member.grade_text || nice(member.grade_level)}
          </div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${accent}22`, color: accent }}>
          {pct}%
        </span>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input className="or-input text-xs flex-1 min-w-[130px]" placeholder='Grade level — e.g. "5th Grade", "Toddler"'
            value={grade} onChange={(e) => setGrade(e.target.value)}
            onBlur={() => grade !== (member.grade_text || "") && saveEdu({ grade_text: grade })}
            data-testid={`grade-input-${member.username}`} aria-label="Grade level" />
          <label className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
            <Zap size={12} style={{ color: "#F4A73B" }} /> AI Power
            <input type="range" min="0" max="100" value={power}
              onChange={(e) => setPower(Number(e.target.value))}
              onMouseUp={() => saveEdu({ ai_power: power })}
              onTouchEnd={() => saveEdu({ ai_power: power })}
              style={{ accentColor: accent, width: 80 }}
              data-testid={`power-slider-${member.username}`} aria-label="AI power" />
            {power}
          </label>
        </div>
      )}

      {courses.length > 1 && (
        <select className="or-input text-xs mb-2" value={activeCourseId || ""}
          onChange={(e) => { setCourseId(e.target.value); setDetail(null); setShowQuiz(false); }}
          aria-label="Course" data-testid={`course-select-${member.username}`}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      )}

      {err ? (
        <div className="text-xs p-3 rounded-xl" style={{ background: "rgba(255,107,107,0.08)", color: "#FF6B6B" }}>
          {String(err)} <button className="underline inline-flex items-center gap-1" onClick={loadDetail}><RefreshCw size={11} /> Retry</button>
        </div>
      ) : !courses.length ? (
        <div className="text-xs p-3" style={{ color: "var(--text-muted)" }}>No courses yet — generate one with ORAi below.</div>
      ) : !detail ? (
        <div className="p-6 text-center"><Loader2 size={18} className="animate-spin mx-auto" /></div>
      ) : (
        <div className={expanded ? "grid md:grid-cols-[220px,1fr] gap-4 flex-1" : "flex-1"}>
          <div className={expanded ? "" : "mb-2"}>
            <div className="text-xs font-bold mb-1.5 flex items-center gap-1.5">
              <BookOpen size={13} style={{ color: accent }} /> {detail.course.title}
            </div>
            <div className={expanded ? "space-y-1" : "flex gap-1 overflow-x-auto no-scrollbar pb-1"}>
              {lessons.map((l, i) => {
                const doneL = prog[l.id]?.status === "completed";
                return (
                  <button key={l.id}
                    className={`text-[10px] px-2 py-1 rounded-lg text-left shrink-0 ${expanded ? "w-full flex items-center gap-1.5" : ""}`}
                    style={{ background: i === idx ? `${accent}22` : "rgba(255,255,255,0.04)",
                             border: i === idx ? `1px solid ${accent}` : "1px solid transparent",
                             color: doneL ? "var(--brand-green, #10E670)" : "var(--text-main)" }}
                    onClick={() => { setIdx(i); setShowQuiz(false); }}
                    data-testid={`lesson-pill-${member.username}-${i}`}>
                    {doneL ? "✓ " : ""}{expanded ? l.title : i + 1}
                  </button>
                );
              })}
            </div>
            {expanded && detail.summary?.achievements?.length > 0 && (
              <div className="mt-3 space-y-1">
                {detail.summary.achievements.map((a) => (
                  <div key={a.id} className="text-[10px] flex items-center gap-1.5" style={{ color: "#F4C84A" }}>
                    <Trophy size={11} /> {a.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            {lesson && (
              <>
                <div className="text-xs font-bold mb-2">{lesson.title}
                  {prog[lesson.id]?.status === "completed" && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(16,230,112,0.15)", color: "var(--brand-green, #10E670)" }}>COMPLETED</span>}
                </div>
                <LessonBlocks lesson={lesson} large={expanded} />
                {showQuiz && <InlineQuiz centerId={centerId} courseId={activeCourseId} lesson={lesson} memberIsSelf={isSelf} onDone={loadDetail} />}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button className="or-btn or-btn-ghost text-xs" disabled={idx === 0}
                    onClick={() => { setIdx(idx - 1); setShowQuiz(false); }} data-testid={`lesson-back-${member.username}`}>
                    <ChevronLeft size={13} /> Back
                  </button>
                  {(lesson.quiz?.questions || []).length > 0 && (
                    <button className="or-btn text-xs" style={{ background: "rgba(194,107,255,0.2)", color: "#C26BFF" }}
                      onClick={() => setShowQuiz(!showQuiz)} data-testid={`lesson-quiz-${member.username}`}>Quiz</button>
                  )}
                  {isSelf && prog[lesson.id]?.status !== "completed" && (
                    <button className="or-btn text-xs" style={{ background: "rgba(16,230,112,0.18)", color: "var(--brand-green, #10E670)" }}
                      onClick={() => complete(lesson)} data-testid={`lesson-complete-${member.username}`}>Mark complete</button>
                  )}
                  <button className="or-btn text-xs font-bold ml-auto" style={{ background: accent, color: "#0a0a0a" }}
                    disabled={idx >= lessons.length - 1}
                    onClick={() => { setIdx(idx + 1); setShowQuiz(false); }} data-testid={`lesson-next-${member.username}`}>
                    Next Lesson <ChevronRight size={13} />
                  </button>
                </div>
                <div className="mt-2">
                  <button className="or-btn or-btn-ghost text-xs inline-flex items-center gap-1.5"
                    onClick={() => setTutorOpen(!tutorOpen)} data-testid={`tutor-open-${member.username}`}>
                    <MessageCircle size={13} style={{ color: "#2EE6FF" }} /> AI Tutor help
                  </button>
                </div>
                {tutorOpen && (isSelf
                  ? <div className="mt-2"><TutorPanel centerId={centerId} courseId={activeCourseId} lesson={lesson} onClose={() => setTutorOpen(false)} /></div>
                  : <TutorHistoryPanel centerId={centerId} courseId={activeCourseId} memberId={member.user_id} onClose={() => setTutorOpen(false)} />)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RcCoursesPreview({ centerId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const initRef = useRef(false);

  const load = useCallback((ids) => {
    const q = ids?.length ? `?member_ids=${ids.join(",")}` : "";
    apiClient.get(`/responsibility-center/${centerId}/courses-preview${q}`)
      .then((r) => {
        setData(r.data);
        if (!initRef.current) { setSelected(r.data.selected || []); initRef.current = true; }
      })
      .catch(() => {});
  }, [centerId]);
  useEffect(() => { load(selected.length ? selected : undefined); }, [load, selected]);

  if (!data) return null;
  const { members, can_manage, member_data } = data;
  const selectable = members.filter((m) => m.selectable);
  const toggle = (id) => {
    if (!can_manage) { setSelected([id]); return; }
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  };
  const shown = members.filter((m) => selected.includes(m.user_id));
  const totalCourses = shown.reduce((n, m) => n + (member_data[m.user_id]?.courses?.length || 0), 0);
  const totalDone = shown.reduce((n, m) => n + (member_data[m.user_id]?.courses || []).reduce((x, c) => x + (c.done || 0), 0), 0);
  const totalLessons = shown.reduce((n, m) => n + (member_data[m.user_id]?.courses || []).reduce((x, c) => x + (c.lesson_count || 0), 0), 0);
  const expanded = shown.length === 1;

  return (
    <div className="mb-6" data-testid="rc-courses-preview">
      <div className="or-surface p-4 mb-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] flex items-center gap-1.5" style={{ color: "var(--brand-blue)" }}>
            <GraduationCap size={13} /> AI Courses Preview
          </div>
          {can_manage && (
            <div className="flex items-center gap-2 ml-auto text-[10px]">
              <button className="or-btn or-btn-ghost text-[10px] inline-flex items-center gap-1"
                onClick={() => setSelected(selectable.map((m) => m.user_id))} data-testid="preview-select-all">
                <CheckSquare size={11} /> Select all
              </button>
              <button className="or-btn or-btn-ghost text-[10px] inline-flex items-center gap-1"
                onClick={() => setSelected([])} data-testid="preview-clear">
                <Square size={11} /> Clear
              </button>
              <span style={{ color: "var(--text-muted)" }} data-testid="preview-count">{shown.length} selected</span>
            </div>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" data-testid="preview-member-row">
          {members.map((m, i) => (
            <ProfileChip key={m.user_id} m={m} selected={selected.includes(m.user_id)}
              accent={ACCENTS[i % ACCENTS.length]} onClick={() => toggle(m.user_id)} />
          ))}
        </div>
      </div>

      {shown.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div className="or-surface p-3 flex items-center gap-3" style={{ border: "1px solid rgba(46,230,255,0.25)" }} data-testid="preview-tutor-summary">
            <Sparkles size={18} style={{ color: "#2EE6FF" }} />
            <div>
              <div className="text-xs font-bold">AI Tutor</div>
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Grade-aware help inside every lesson — hints, examples and simpler explanations on demand.
              </div>
            </div>
          </div>
          <div className="or-surface p-3 flex items-center gap-3" style={{ border: "1px solid rgba(16,230,112,0.25)" }} data-testid="preview-progress-summary">
            <Trophy size={18} style={{ color: "var(--brand-green, #10E670)" }} />
            <div className="flex-1">
              <div className="text-xs font-bold">Overall Progress</div>
              <div className="h-1.5 rounded-full mt-1" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-1.5 rounded-full" style={{ width: `${totalLessons ? Math.round((totalDone / totalLessons) * 100) : 0}%`, background: "var(--brand-green, #10E670)" }} />
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {totalDone}/{totalLessons} lessons · {totalCourses} course(s) · {shown.length} member(s)
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={expanded ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 lg:grid-cols-2 gap-3"} data-testid="preview-card-grid">
        {shown.map((m, i) => (
          <MemberCourseCard key={m.user_id} centerId={centerId} member={m}
            courses={member_data[m.user_id]?.courses || []}
            accent={ACCENTS[members.findIndex((x) => x.user_id === m.user_id) % ACCENTS.length]}
            expanded={expanded} canManage={can_manage}
            isSelf={m.user_id === user?.id}
            onEduSaved={() => load(selected)} />
        ))}
      </div>

      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3" data-testid="preview-feature-summary">
          {["Interactive lessons", "Quizzes", "Grade-level adaptation", "AI Tutor", "Achievements", "Progress saved instantly"].map((f) => (
            <span key={f} className="text-[10px] px-2 py-1 rounded-full" style={{ background: "rgba(46,160,255,0.1)", color: "var(--brand-blue)" }}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}
