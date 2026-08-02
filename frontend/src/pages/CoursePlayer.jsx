import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Circle, Trophy, Award, GraduationCap,
  Sparkles, Send, X, BookOpen, Beaker, FileText, Home as HomeIcon, Hammer,
  RefreshCcw, Clock, Bot, Loader2, ShieldCheck, Volume2,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { OraiVoiceBar } from "@/components/orai/OraiVoiceBar";
import { oraiVoice } from "@/lib/oraiVoiceEngine";
import ActivityBlock, { isInteractiveBlock } from "@/components/rc/ActivityBlock";

const BLOCK_META = {
  text: { Icon: BookOpen, color: "#2EA0FF", label: "Lesson" },
  activity: { Icon: Beaker, color: "#10E670", label: "Activity" },
  worksheet: { Icon: FileText, color: "#4DD6C1", label: "Worksheet" },
  homework: { Icon: HomeIcon, color: "#F4A73B", label: "Homework" },
  project: { Icon: Hammer, color: "#C26BFF", label: "Project" },
  review: { Icon: RefreshCcw, color: "#FF8A5A", label: "Review" },
};

function AudioNoteBlock({ b }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    if (playing || oraiVoice.state === "speaking") { oraiVoice.stopSpeaking(); setPlaying(false); return; }
    setPlaying(true);
    try { await oraiVoice.speak(`${b.title ? b.title + ". " : ""}${b.body}`); }
    catch { toast.error("ORAi voice is unavailable right now"); }
    finally { setPlaying(false); }
  };
  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", borderLeft: "3px solid #FF8A5A" }}
      data-testid="player-block-audio_note">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#FF8A5A" }}>
        <Volume2 size={12} /> Audio Example{b.title ? ` — ${b.title}` : ""}
      </div>
      <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap mb-2">{b.body}</div>
      <button className="or-btn text-xs" onClick={play} data-testid="audio-note-play">
        <Volume2 size={12} /> {playing ? "Stop" : "Play with ORAi voice"}
      </button>
    </div>
  );
}

function CertificateModal({ centerId, courseId, onClose }) {
  const [cert, setCert] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    apiClient.get(`/responsibility-center/${centerId}/courses/${courseId}/certificate`)
      .then((r) => setCert(r.data))
      .catch((e) => setErr(e?.response?.data?.detail || "Certificate unavailable"));
  }, [centerId, courseId]);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-6 text-center rcx-scope" onClick={(e) => e.stopPropagation()}
        style={{ background: "color-mix(in srgb, var(--bgc) 85%, #060D18)", border: "2px solid #F4A73B" }}
        data-testid="certificate-modal">
        {err ? <div className="text-sm py-6">{err}</div> : !cert ? <div className="text-sm py-6">Preparing…</div> : (
          <>
            <Trophy size={40} className="mx-auto mb-2" style={{ color: "#F4A73B" }} />
            <div className="text-[10px] uppercase tracking-[0.3em] mb-1" style={{ color: "#F4A73B" }}>Certificate of Completion</div>
            <div className="text-xl font-bold mb-1" style={{ fontFamily: "var(--font-display)" }} data-testid="certificate-student">{cert.student_name}</div>
            <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>has completed</div>
            <div className="text-base font-bold mb-1">{cert.course_title}</div>
            <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
              {cert.center_name} · {cert.lessons_completed} lessons{cert.avg_score != null ? ` · avg score ${cert.avg_score}%` : ""}
            </div>
            <div className="text-[10px] font-mono mb-3" style={{ color: "#4DD6C1" }}>{cert.certificate_id}</div>
            <div className="text-[9px] px-4" style={{ color: "var(--text-muted)" }}>{cert.disclaimer}</div>
            <button className="or-btn text-xs mt-4" onClick={() => window.print()} data-testid="certificate-print">Print / Save</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function TutorPanel({ centerId, courseId, lesson, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  useEffect(() => {
    apiClient.get(`/responsibility-center/${centerId}/courses/${courseId}/tutor/${lesson.id}`)
      .then((r) => setMessages(r.data.messages || [])).catch(() => {});
  }, [centerId, courseId, lesson.id]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || busy) return null;
    setInput("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: msg }]);
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/courses/${courseId}/tutor`,
        { lesson_id: lesson.id, message: msg }, { timeout: 90000 });
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: "assistant", content: r.data.reply }]);
      return r.data.reply;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Tutor is unavailable right now");
      return null;
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="h-full w-full sm:w-[400px] flex flex-col rcx-scope" onClick={(e) => e.stopPropagation()}
        style={{ background: "color-mix(in srgb, var(--bgc) 85%, #060D18)", borderLeft: "1px solid rgba(77,214,193,0.4)" }}
        data-testid="tutor-panel">
        <div className="flex items-center gap-2 p-3" style={{ borderBottom: "1px solid rgba(77,214,193,0.3)" }}>
          <span className="rounded-lg p-1.5" style={{ background: "rgba(77,214,193,0.15)", color: "#4DD6C1" }}><Bot size={16} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>ORAi Tutor</div>
            <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{lesson.title}</div>
          </div>
          <button className="or-btn or-btn-ghost p-1.5" onClick={onClose} data-testid="tutor-close"><X size={15} /></button>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="tutor-messages">
          {messages.length === 0 && (
            <div className="text-center pt-10 px-4">
              <Bot size={30} className="mx-auto mb-2" style={{ color: "#4DD6C1" }} />
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Stuck on something? I know this lesson inside out — ask me anything and I'll guide you (no spoilers on quiz answers!).
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[85%] rounded-xl px-3 py-2 text-[12px] whitespace-pre-wrap"
                style={m.role === "user"
                  ? { background: "rgba(46,160,255,0.16)", border: "1px solid rgba(46,160,255,0.35)" }
                  : { background: "rgba(77,214,193,0.08)", border: "1px solid rgba(77,214,193,0.3)" }}
                data-testid={`tutor-msg-${m.role}`}>
                {m.content}
              </div>
            </div>
          ))}
          {busy && <div className="text-[11px] flex items-center gap-1.5" style={{ color: "#4DD6C1" }}><Sparkles size={11} className="animate-pulse" /> Tutor is thinking…</div>}
        </div>
        <div className="p-3" style={{ borderTop: "1px solid rgba(77,214,193,0.3)" }}>
          <OraiVoiceBar onSubmit={(t) => send(t)} accent="#4DD6C1" testidPrefix="tutor" />
          <div className="flex gap-2">
            <input className="or-input flex-1 text-sm" value={input} placeholder="Ask the tutor…" disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()} data-testid="tutor-input" />
            <button className="or-btn px-3" disabled={busy || !input.trim()} onClick={() => send()} data-testid="tutor-send"><Send size={14} /></button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Quiz({ centerId, courseId, lesson, onDone }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const qs = lesson.quiz?.questions || [];
  useEffect(() => { setAnswers({}); setResult(null); }, [lesson.id]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/courses/${courseId}/lessons/${lesson.id}/quiz`, { answers });
      setResult(r.data);
      onDone(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not submit"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3" data-testid="quiz-player">
      {qs.map((q, i) => {
        const res = result?.results?.find((r) => r.id === q.id);
        return (
          <div key={q.id} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(194,107,255,0.25)" }}>
            <div className="text-[12px] font-semibold mb-2">{i + 1}. {q.q}</div>
            <div className="space-y-1">
              {q.options.map((o, oi) => {
                let style = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" };
                if (result && res) {
                  if (oi === res.answer_index) style = { background: "rgba(16,230,112,0.12)", border: "1px solid rgba(16,230,112,0.5)" };
                  else if (res.picked === oi && !res.correct) style = { background: "rgba(255,107,107,0.12)", border: "1px solid rgba(255,107,107,0.5)" };
                } else if (answers[q.id] === oi) {
                  style = { background: "rgba(46,160,255,0.14)", border: "1px solid rgba(46,160,255,0.5)" };
                }
                return (
                  <button key={oi} disabled={!!result} onClick={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                    className="w-full text-left text-[11px] px-3 py-2 rounded-lg transition-colors" style={style}
                    data-testid={`quiz-opt-${i}-${oi}`}>
                    {o}
                  </button>
                );
              })}
            </div>
            {result && res?.explanation && (
              <div className="text-[10px] mt-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(77,214,193,0.08)", color: "#4DD6C1" }}>
                {res.explanation}
              </div>
            )}
          </div>
        );
      })}
      {!result ? (
        <button className="or-btn text-xs w-full" disabled={busy || Object.keys(answers).length < qs.length} onClick={submit}
          data-testid="quiz-submit-btn">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Submit answers
        </button>
      ) : (
        <div className="or-surface p-3 text-center" data-testid="quiz-result">
          <div className="text-lg font-extrabold" style={{ color: result.pct >= 70 ? "#10E670" : "#F4A73B" }}>
            {result.score}/{result.total} · {result.pct}%
          </div>
          {result.needs_approval && (
            <div className="text-[10px] mt-1 flex items-center justify-center gap-1" style={{ color: "#F4A73B" }}>
              <ShieldCheck size={11} /> Sent for parent/teacher approval
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Course Player — lessons, quizzes, checkpoints, progress, tutor, certificate.
export default function CoursePlayer() {
  const { id, courseId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [selId, setSelId] = useState(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (keepSel) => {
    try {
      const r = await apiClient.get(`/responsibility-center/${id}/courses/${courseId}`);
      setData(r.data);
      setSelId((s) => (keepSel && s) ? s : (s || r.data.resume_lesson_id || r.data.lessons[0]?.id));
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not load course"); }
  }, [id, courseId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selId) return;
    apiClient.post(`/responsibility-center/${id}/courses/${courseId}/position`, { lesson_id: selId }).catch(() => {});
  }, [selId, id, courseId]);

  if (!data) return <div className="max-w-4xl mx-auto or-surface p-8 text-center rcx-scope" data-testid="player-loading"><div className="rcx-loader mb-3" /><div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading course…</div></div>;
  const { course, lessons, progress } = data;
  const orderIds = course.modules.flatMap((m) => m.lesson_ids).filter((lid) => lessons.some((l) => l.id === lid));
  const idx = orderIds.indexOf(selId);
  const lesson = lessons.find((l) => l.id === selId) || lessons[0];
  const doneCount = Object.values(progress).filter((p) => p.status === "completed").length;
  const pct = course.lesson_count ? Math.round((doneCount / course.lesson_count) * 100) : 0;
  const myState = progress[lesson?.id];
  const hasQuiz = (lesson?.quiz?.questions || []).length > 0;

  const markComplete = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${id}/courses/${courseId}/lessons/${lesson.id}/complete`, {});
      if (r.data.needs_approval) toast.info("Checkpoint sent for parent/teacher approval");
      else toast.success("Lesson complete! 🎉");
      await load(true);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save progress"); }
    finally { setBusy(false); }
  };

  const go = (dir) => {
    const n = idx + dir;
    if (n >= 0 && n < orderIds.length) setSelId(orderIds[n]);
  };

  return (
    <div className="max-w-6xl mx-auto rcx-scope rcx-page-enter pb-10" data-testid="course-player-page">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${id}/courses`)} data-testid="player-back">
          <ArrowLeft size={13} /> Courses
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate" style={{ fontFamily: "var(--font-display)" }} data-testid="player-course-title">{course.title}</div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 rounded-full overflow-hidden flex-1 max-w-[220px]" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: course.color || "#2EA0FF" }} />
            </div>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="player-progress-pct">{pct}%</span>
          </div>
        </div>
        {data.achievements.map((a) => (
          <span key={a.id} className="text-[9px] font-bold px-2 py-1 rounded-full flex items-center gap-1"
            style={{ background: "rgba(244,167,59,0.14)", color: "#F4A73B", border: "1px solid rgba(244,167,59,0.4)" }}
            title={a.label} data-testid={`achievement-${a.id}`}>
            <Award size={10} /> {a.label}
          </span>
        ))}
        {pct >= 100 && (
          <button className="or-btn text-xs" onClick={() => setCertOpen(true)} data-testid="player-certificate-btn">
            <Trophy size={12} /> Certificate
          </button>
        )}
        <button className="or-btn or-btn-ghost text-xs" onClick={() => setTutorOpen(true)} data-testid="player-tutor-btn">
          <Bot size={13} /> AI Tutor
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <aside className="w-full lg:w-64 shrink-0 space-y-2" data-testid="player-outline">
          {course.modules.map((m) => (
            <div key={m.id} className="or-surface p-2">
              <div className="text-[10px] font-bold uppercase tracking-wider px-2 py-1" style={{ color: "var(--text-muted)" }}>{m.title}</div>
              {m.lesson_ids.map((lid) => {
                const l = lessons.find((x) => x.id === lid);
                if (!l) return null;
                const st = progress[lid];
                return (
                  <button key={lid} onClick={() => setSelId(lid)}
                    className="w-full text-left text-[11px] px-2 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors hover:bg-white/5"
                    style={selId === lid ? { background: `${course.color || "#2EA0FF"}18`, border: `1px solid ${course.color || "#2EA0FF"}55` } : { border: "1px solid transparent" }}
                    data-testid={`player-lesson-${lid}`}>
                    {st?.status === "completed"
                      ? <CheckCircle2 size={12} style={{ color: "#10E670" }} className="shrink-0" />
                      : st?.status === "pending_approval"
                        ? <Clock size={12} style={{ color: "#F4A73B" }} className="shrink-0" />
                        : <Circle size={12} style={{ color: "var(--text-muted)" }} className="shrink-0" />}
                    <span className="truncate flex-1">{l.title}</span>
                    {l.lesson_type === "checkpoint" && <ShieldCheck size={10} style={{ color: "#C26BFF" }} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <main className="flex-1 min-w-0 w-full">
          {lesson && (
            <div className="or-surface p-4 sm:p-5" data-testid="player-lesson-view">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold flex-1" style={{ fontFamily: "var(--font-display)" }} data-testid="player-lesson-title">{lesson.title}</h2>
                <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                  <Clock size={9} className="inline mr-0.5" /> ~{lesson.duration_min} min
                </span>
                <button className="or-btn or-btn-ghost text-xs" title="ORAi reads this lesson aloud"
                  onClick={() => {
                    if (oraiVoice.state === "speaking") { oraiVoice.stopSpeaking(); return; }
                    const text = `${lesson.title}. ` + (lesson.blocks || []).map((b) => `${b.title ? b.title + ". " : ""}${b.body}`).join(" ");
                    oraiVoice.speak(text).catch(() => toast.error("ORAi voice is unavailable right now"));
                  }}
                  data-testid="player-read-aloud-btn">
                  <Volume2 size={13} /> Read aloud
                </button>
              </div>
              {myState?.status === "pending_approval" && (
                <div className="text-[10px] mb-3 px-3 py-2 rounded-lg flex items-center gap-1.5"
                  style={{ background: "rgba(244,167,59,0.1)", color: "#F4A73B", border: "1px solid rgba(244,167,59,0.35)" }}
                  data-testid="player-pending-banner">
                  <Clock size={11} /> Waiting for parent/teacher approval on this checkpoint.
                </div>
              )}

              <div className="space-y-4 mb-5">
                {(lesson.blocks || []).map((b) => {
                  if (b.type === "audio_note") return <AudioNoteBlock key={b.id} b={b} />;
                  if (isInteractiveBlock(b)) {
                    return (
                      <div key={b.id} data-testid={`player-block-${b.type}`}>
                        {b.image_url && <img src={b.image_url} alt={b.title || "illustration"} className="rounded-xl mb-2 w-full max-h-72 object-cover" />}
                        <ActivityBlock b={b} />
                      </div>
                    );
                  }
                  const meta = BLOCK_META[b.type] || BLOCK_META.text;
                  return (
                    <div key={b.id} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", borderLeft: `3px solid ${meta.color}` }}
                      data-testid={`player-block-${b.type}`}>
                      <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: meta.color }}>
                        <meta.Icon size={12} /> {meta.label}{b.title ? ` — ${b.title}` : ""}
                      </div>
                      {b.image_url && <img src={b.image_url} alt={b.title || "illustration"} className="rounded-xl mb-3 w-full max-h-72 object-cover" />}
                      <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{b.body}</div>
                    </div>
                  );
                })}
              </div>

              {hasQuiz && <Quiz centerId={id} courseId={courseId} lesson={lesson} onDone={() => load(true)} />}

              <div className="flex items-center gap-2 mt-5 flex-wrap">
                <button className="or-btn or-btn-ghost text-xs" onClick={() => go(-1)} disabled={idx <= 0} data-testid="player-prev-btn">
                  <ArrowLeft size={12} /> Previous
                </button>
                <div className="flex-1" />
                {!hasQuiz && myState?.status !== "completed" && myState?.status !== "pending_approval" && (
                  <button className="or-btn text-xs" onClick={markComplete} disabled={busy} data-testid="player-complete-btn">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Mark complete
                  </button>
                )}
                <button className="or-btn text-xs" onClick={() => go(1)} disabled={idx >= orderIds.length - 1} data-testid="player-next-btn">
                  Next lesson <ArrowRight size={12} />
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {tutorOpen && lesson && <TutorPanel centerId={id} courseId={courseId} lesson={lesson} onClose={() => setTutorOpen(false)} />}
      {certOpen && <CertificateModal centerId={id} courseId={courseId} onClose={() => setCertOpen(false)} />}
    </div>
  );
}
