import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, GraduationCap, Loader2, Play, Pause, CheckCircle2, XCircle, Pencil, Trash2, RefreshCcw, CalendarX, Zap, Archive, Save, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const STATUS_COLORS = {
  pending_approval: "#F4A73B", approved: "#2EE6FF", active: "#10E670",
  paused: "#FF8A5A", completed: "#8A93A6", declined: "#FF6B6B",
  changes_requested: "#C26BFF", archived: "#8A93A6", draft: "#8A93A6",
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function Stat({ label, value, testid }) {
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: "rgba(255,255,255,0.04)" }} data-testid={testid}>
      <div className="text-sm font-bold">{value}</div>
      <div className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function StudentEditor({ student, onChange }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.04)" }}
      data-testid={`edu-student-${student.username}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <b className="text-xs">@{student.username}</b>
        {(!student.grade_text || !(student.subjects || []).length) && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,107,107,0.15)", color: "#FF6B6B" }}>
            missing info
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className="or-input text-xs" placeholder="Grade (e.g. 7th Grade)" value={student.grade_text || ""}
          onChange={(e) => onChange({ ...student, grade_text: e.target.value })}
          data-testid={`edu-grade-${student.username}`} />
        <input className="or-input text-xs" placeholder="Subjects, comma-separated" value={(student.subjects || []).join(", ")}
          onChange={(e) => onChange({ ...student, subjects: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          data-testid={`edu-subjects-${student.username}`} />
      </div>
      <input className="or-input text-xs w-full mt-1.5" placeholder="Adjustments (e.g. make math easier)" value={student.adjustments || ""}
        onChange={(e) => onChange({ ...student, adjustments: e.target.value })}
        data-testid={`edu-adjustments-${student.username}`} />
    </div>
  );
}

export default function EduPlans() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [plans, setPlans] = useState(null);
  const [detail, setDetail] = useState(null);
  const [draftStudents, setDraftStudents] = useState(null);
  const [busy, setBusy] = useState(false);
  const selected = params.get("plan");

  const loadList = useCallback(() => {
    apiClient.get(`/responsibility-center/${id}/edu-plans`).then((r) => setPlans(r.data.plans))
      .catch((e) => toast.error(e?.response?.data?.detail || "Could not load plans"));
  }, [id]);

  const loadDetail = useCallback(() => {
    if (!selected) { setDetail(null); return; }
    apiClient.get(`/responsibility-center/${id}/edu-plans/${selected}`)
      .then((r) => { setDetail(r.data); setDraftStudents(r.data.plan.students); })
      .catch(() => toast.error("Plan not found"));
  }, [id, selected]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => {
    if (!detail || detail.plan.status !== "active") return;
    const t = setInterval(loadDetail, 10000);
    return () => clearInterval(t);
  }, [detail?.plan?.status, loadDetail]);

  const act = async (action, extra = {}) => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${id}/edu-plans/${selected}/action`, { action, ...extra });
      toast.success(`${action.replace(/_/g, " ")} — done`);
      if (action === "delete") { setParams({}); loadList(); }
      else { loadDetail(); loadList(); }
      return r.data;
    } catch (e) { toast.error(e?.response?.data?.detail || `${action} failed`); }
    finally { setBusy(false); }
  };

  const saveStudents = async () => {
    setBusy(true);
    try {
      await apiClient.patch(`/responsibility-center/${id}/edu-plans/${selected}`, { students: draftStudents });
      toast.success("Student details saved");
      loadDetail();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  const p = detail?.plan;
  const doneRuns = (detail?.runs || []).filter((r) => r.status === "done");
  const failedRuns = (detail?.runs || []).filter((r) => r.status === "failed");

  return (
    <div className="max-w-4xl mx-auto rcx-scope pb-12" data-testid="edu-plans-page">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(`/responsibility-center/${id}/education`)}
          data-testid="edu-plans-back"><ArrowLeft size={13} /> Education Center</button>
        <h1 className="text-xl sm:text-2xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
          <GraduationCap size={22} style={{ color: "#10E670" }} /> Education Automation
        </h1>
      </div>
      <p className="text-[11px] mb-4" style={{ color: "var(--text-muted)" }}>
        ORAi-drafted adaptive learning plans. Approve a plan to generate first lessons now, then each
        next lesson is created automatically at the scheduled time based on every student's real progress.
        Ask the floating ORAi: "Create one month of weekday lessons for all students."
      </p>

      {!selected && (
        <div className="space-y-2" data-testid="edu-plans-list">
          {plans === null ? <div className="or-surface p-5 text-xs text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>
            : plans.length === 0 ? (
              <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }} data-testid="edu-plans-empty">
                No learning plans yet — open the floating ORAi assistant and describe the plan you want.
              </div>
            ) : plans.map((pl) => (
              <button key={pl.id} className="or-surface p-3.5 w-full text-left flex items-center gap-3"
                onClick={() => setParams({ plan: pl.id })} data-testid={`edu-plan-row-${pl.id}`}>
                <div className="flex-1 min-w-0">
                  <b className="text-sm">{pl.title}</b>
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {pl.students.length} student(s) · {pl.schedule.start_date} → {pl.schedule.end_date} · daily at {pl.schedule.generation_time}
                    · {pl.usage.lessons_generated}/{pl.estimates.lessons_total} lessons
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0"
                  style={{ background: `${STATUS_COLORS[pl.status]}22`, color: STATUS_COLORS[pl.status] }}>
                  {pl.status.replace(/_/g, " ")}
                </span>
              </button>
            ))}
        </div>
      )}

      {selected && !p && <div className="or-surface p-5 text-xs text-center" style={{ color: "var(--text-muted)" }}>Loading plan…</div>}

      {p && (
        <div className="space-y-3" data-testid="edu-plan-detail">
          <div className="or-surface p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <button className="or-btn or-btn-ghost text-[10px]" onClick={() => setParams({})} data-testid="edu-plan-back-list">
                <ArrowLeft size={11} /> All plans
              </button>
              <b className="text-sm flex-1">{p.title}</b>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                style={{ background: `${STATUS_COLORS[p.status]}22`, color: STATUS_COLORS[p.status] }}
                data-testid="edu-plan-status">{p.status.replace(/_/g, " ")}</span>
            </div>
            {p.paused_reason && (
              <div className="text-[10px] mt-1 flex items-center gap-1" style={{ color: "#FF8A5A" }} data-testid="edu-plan-paused-reason">
                <AlertTriangle size={11} /> {p.paused_reason}
              </div>
            )}
            <div className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>"{p.request_text}"</div>
            {p.notes && <div className="text-[10px] mt-1" style={{ color: "#C26BFF" }}>Notes: {p.notes}</div>}

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
              <Stat label="Students" value={p.students.length} testid="edu-stat-students" />
              <Stat label="Learn days" value={p.estimates.learning_days} testid="edu-stat-days" />
              <Stat label="Lessons" value={`${p.usage.lessons_generated}/${p.estimates.lessons_total}`} testid="edu-stat-lessons" />
              <Stat label="Daily time" value={p.schedule.generation_time} testid="edu-stat-time" />
              <Stat label="Est / day" value={`$${p.estimates.est_daily_cost}`} testid="edu-stat-daily-cost" />
              <Stat label="Est total" value={`$${p.estimates.est_total_cost}`} testid="edu-stat-total-cost" />
            </div>
            <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
              {p.schedule.days.map((d) => d.toUpperCase()).join(" · ")} · {p.schedule.start_date} → {p.schedule.end_date} ({p.schedule.timezone})
              {(p.schedule.skip_dates || []).length > 0 && <> · skipping {p.schedule.skip_dates.join(", ")}</>}
              <br />Media: images {p.media.images ? "✓" : "✗"} · narration ✓ · quizzes ✓ · activities ✓ · AI video {p.media.video ? "✓" : "stays in dry-run"} ·
              Caps: {p.caps.daily_lessons || "∞"}/day, {p.caps.total_lessons || "∞"} total
            </div>
            {p.missing_info?.length > 0 && (
              <div className="rounded-lg p-2 mt-2 text-[10px]" style={{ background: "rgba(255,107,107,0.07)", border: "1px solid rgba(255,107,107,0.3)", color: "#FF8A8A" }}
                data-testid="edu-plan-missing">
                <b>Missing before activation:</b> {p.missing_info.join(" · ")} — complete it below.
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3" data-testid="edu-plan-actions">
              {p.status === "pending_approval" && detail.can_approve && (
                <>
                  <button className="or-btn text-xs font-bold" style={{ background: "#10E670", color: "#0a0a0a" }} disabled={busy}
                    onClick={() => act("approve", { activate: true })} data-testid="edu-approve-activate">
                    <CheckCircle2 size={13} /> Approve & Activate
                  </button>
                  <button className="or-btn text-xs" disabled={busy} onClick={() => act("approve")} data-testid="edu-approve-only">
                    Approve Only
                  </button>
                  <button className="or-btn text-xs" disabled={busy} style={{ color: "#C26BFF" }}
                    onClick={() => { const f = window.prompt("What should ORAi change?"); if (f) act("request_changes", { feedback: f }); }}
                    data-testid="edu-request-changes">
                    <Pencil size={12} /> Request Changes
                  </button>
                  <button className="or-btn text-xs" disabled={busy} style={{ color: "#FF6B6B" }}
                    onClick={() => act("decline")} data-testid="edu-decline"><XCircle size={12} /> Decline</button>
                </>
              )}
              {p.status === "approved" && detail.can_approve && (
                <button className="or-btn text-xs font-bold" style={{ background: "#10E670", color: "#0a0a0a" }} disabled={busy}
                  onClick={() => act("activate")} data-testid="edu-activate"><Play size={13} /> Activate — generate first lessons now</button>
              )}
              {p.status === "active" && (
                <>
                  <button className="or-btn text-xs" disabled={busy} onClick={() => act("pause")} data-testid="edu-pause"><Pause size={12} /> Pause</button>
                  <button className="or-btn text-xs" disabled={busy} onClick={() => act("generate_next_now")} data-testid="edu-generate-now">
                    <Zap size={12} /> Generate Next Now</button>
                  <button className="or-btn text-xs" disabled={busy}
                    onClick={() => { const d = window.prompt("Date to skip (YYYY-MM-DD):"); if (d) act("skip_date", { date: d }); }}
                    data-testid="edu-skip-date"><CalendarX size={12} /> Skip a Date</button>
                  <button className="or-btn text-xs" disabled={busy} style={{ color: "#FF8A5A" }} onClick={() => act("end")} data-testid="edu-end">End Plan</button>
                </>
              )}
              {p.status === "paused" && (
                <button className="or-btn text-xs font-bold" style={{ background: "#10E670", color: "#0a0a0a" }} disabled={busy}
                  onClick={() => act("resume")} data-testid="edu-resume"><Play size={13} /> Resume</button>
              )}
              {failedRuns.length > 0 && (
                <button className="or-btn text-xs" disabled={busy} style={{ color: "#FF6B6B" }}
                  onClick={() => act("retry_failed")} data-testid="edu-retry-failed">
                  <RefreshCcw size={12} /> Retry {failedRuns.length} Failed</button>
              )}
              {["completed", "declined"].includes(p.status) && (
                <button className="or-btn text-xs" disabled={busy} onClick={() => act("archive")} data-testid="edu-archive">
                  <Archive size={12} /> Archive</button>
              )}
              {p.status !== "active" && (
                <button className="or-btn text-xs" disabled={busy} style={{ color: "#FF6B6B" }}
                  onClick={() => window.confirm("Delete this plan? Generated lessons stay in student courses.") && act("delete")}
                  data-testid="edu-delete"><Trash2 size={12} /> Delete</button>
              )}
            </div>
          </div>

          <div className="or-surface p-4" data-testid="edu-plan-students">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#2EE6FF" }}>
              Students — live profiles (edits save back to each education profile)
            </div>
            <div className="space-y-2">
              {(draftStudents || []).map((s, i) => (
                <StudentEditor key={s.user_id} student={s}
                  onChange={(ns) => setDraftStudents(draftStudents.map((x, j) => (j === i ? ns : x)))} />
              ))}
            </div>
            <button className="or-btn text-xs mt-2" disabled={busy} onClick={saveStudents} data-testid="edu-save-students">
              <Save size={12} /> Save Student Details
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="or-surface p-4" data-testid="edu-plan-upcoming">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#10E670" }}>
                <Clock size={11} className="inline mr-1" />Upcoming lessons
              </div>
              {(detail.upcoming_dates || []).map((d) => (
                <div key={d} className="text-[11px] py-0.5">{d} — {p.students.length} lesson(s) at {p.schedule.generation_time}</div>
              ))}
              {!detail.upcoming_dates?.length && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>No upcoming learning days.</div>}
            </div>
            <div className="or-surface p-4" data-testid="edu-plan-runs">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#F4A73B" }}>
                Generated lessons ({doneRuns.length} done{failedRuns.length ? ` · ${failedRuns.length} failed` : ""})
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {(detail.runs || []).slice(0, 40).map((r) => (
                  <div key={r.id} className="text-[11px] flex items-start gap-1.5" data-testid={`edu-run-${r.id}`}>
                    {r.status === "done" ? <CheckCircle2 size={11} className="mt-0.5 shrink-0" style={{ color: "#10E670" }} />
                      : r.status === "failed" ? <XCircle size={11} className="mt-0.5 shrink-0" style={{ color: "#FF6B6B" }} />
                        : <Loader2 size={11} className="mt-0.5 shrink-0 animate-spin" style={{ color: "#2EE6FF" }} />}
                    <span className="min-w-0">
                      <b>@{r.student_username}</b> · {r.date} · {r.subject || "…"}
                      {r.lesson_title && (
                        <button className="block text-left underline" style={{ color: "#2EE6FF" }}
                          onClick={() => navigate(`/responsibility-center/${id}/courses/${r.course_id}/learn`)}>
                          {r.lesson_title}
                        </button>
                      )}
                      {r.adaptation && <span className="block text-[9px]" style={{ color: "var(--text-muted)" }}>↳ {r.adaptation}</span>}
                      {r.error && <span className="block text-[9px]" style={{ color: "#FF8A8A" }}>{r.error}</span>}
                    </span>
                  </div>
                ))}
                {!detail.runs?.length && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Nothing generated yet.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
