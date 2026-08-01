import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  GraduationCap, Flame, Plus, Menu, X, ChevronLeft, LayoutDashboard, Users, Bot,
  BookOpen, ClipboardCheck, BarChart3, Settings as SettingsIcon, Sliders, CalendarDays,
  Bell, HelpCircle, Library, ShieldCheck, Eye, Pencil, Trash2, Star, Clock, Sparkles,
  FileBarChart, FileText, CheckSquare, Timer, Download, Leaf, Sigma, Landmark, Languages, Atom,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import Logo from "@/components/Logo";
import { RcImg } from "@/lib/rcAssets";
import { RcItemCreateModal } from "@/components/rc/RcItemCreateModal";
import { RcItemDrawer } from "@/components/rc/RcItemDrawer";
import { RcOraiPanel } from "@/components/rc/RcOraiPanel";

const BLUE = "#2EA0FF";
const EDGE = "rgba(46,160,255,0.35)";
const GLOW = "0 0 14px rgba(46,160,255,0.18)";

const STATUS_META = {
  completed: ["Completed", "#10E670"], approved: ["Completed", "#10E670"],
  in_progress: ["In Progress", "#F4A73B"], accepted: ["In Progress", "#F4A73B"],
  waiting: ["In Progress", "#F4A73B"], blocked: ["Blocked", "#FF6B6B"],
  submitted: ["Submitted", "#5AB2FF"], pending_approval: ["Pending Approval", "#C26BFF"],
  changes_requested: ["Changes Requested", "#F4A73B"],
  draft: ["Pending", "#5AB2FF"], assigned: ["Pending", "#5AB2FF"],
};
const SUBJECT_ICONS = [
  [/science|bio|chem|phys/i, Atom, "#10E670"], [/math|algebra|equation/i, Sigma, "#F4A73B"],
  [/history|social/i, Landmark, "#5AB2FF"], [/language|writing|grammar|english|reading/i, Languages, "#C26BFF"],
  [/nature|garden/i, Leaf, "#10E670"],
];
const subjectMeta = (s) => {
  for (const [rx, Icon, color] of SUBJECT_ICONS) if (rx.test(s || "")) return { Icon, color };
  return { Icon: BookOpen, color: BLUE };
};
const fmtDue = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");
const firstNameLastInitial = (name, username) => {
  const n = (name || "").trim();
  if (!n) return `@${username}`;
  const parts = n.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};

const Card = ({ children, className = "", style, testid }) => (
  <div className={`rounded-xl p-4 ${className}`} data-testid={testid}
    style={{ background: "color-mix(in srgb, var(--bgc) 55%, #0A1220)", border: `1px solid ${EDGE}`, boxShadow: GLOW, ...style }}>
    {children}
  </div>
);

const SectionTitle = ({ children }) => (
  <h2 className="text-sm font-bold uppercase tracking-[0.14em] mb-3" style={{ color: BLUE }}>{children}</h2>
);

// Education Center — polished dashboard on top of the real RC engine.
export default function EducationCenterDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ov, setOv] = useState(null);
  const [center, setCenter] = useState(null); // full center data (members, membership)
  const [config, setConfig] = useState(null);
  const [selId, setSelId] = useState("");
  const [err, setErr] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [openItem, setOpenItem] = useState(null);
  const [oraiOpen, setOraiOpen] = useState(false);
  const refs = { students: useRef(null), ai: useRef(null), lessons: useRef(null), progress: useRef(null), reports: useRef(null) };

  const load = useCallback(async (studentId = "") => {
    try {
      const r = await apiClient.get(`/responsibility-center/${id}/education/overview`,
        { params: studentId ? { student_id: studentId } : {} });
      setOv(r.data);
      if (r.data.selected_student) setSelId(r.data.selected_student.user_id);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not load the Education Center");
    }
  }, [id]);

  useEffect(() => {
    load();
    apiClient.get(`/responsibility-center/${id}`).then((r) => setCenter(r.data)).catch(() => {});
    apiClient.get("/responsibility-center/config").then((r) => setConfig(r.data)).catch(() => {});
  }, [id, load]);

  if (err) {
    return (
      <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="edu-error">
        <div className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>{err}</div>
        <button className="or-btn" onClick={() => navigate(`/responsibility-center/${id}`)}>Back to the Center</button>
      </div>
    );
  }
  if (!ov) return <div className="max-w-3xl mx-auto or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="edu-loading">Loading Education Center…</div>;

  const sel = ov.students.find((s) => s.user_id === selId) || ov.selected_student;
  const canManage = ov.can_manage;
  const perms = new Set(ov.my_permissions || []);
  const balance = config?.my_fire_vault_balance ?? 0;
  const goTab = (tab) => navigate(`/responsibility-center/${id}?tab=${tab}`);
  const scrollTo = (k) => { refs[k]?.current?.scrollIntoView({ behavior: "smooth", block: "start" }); setNavOpen(false); };

  const selectStudent = (uid) => { setSelId(uid); load(uid); };

  const NAV = [
    { group: "MAIN", items: [
      { label: "Overview", Icon: LayoutDashboard, act: () => window.scrollTo({ top: 0, behavior: "smooth" }), active: true },
      { label: "Students", Icon: Users, act: () => scrollTo("students") },
      { label: "AI Teaching", Icon: Bot, act: () => { setOraiOpen(true); setNavOpen(false); } },
      { label: "Lessons & Tasks", Icon: BookOpen, act: () => scrollTo("lessons") },
      canManage && { label: "Grades & Approvals", Icon: ClipboardCheck, act: () => goTab("work") },
      perms.has("view_reports") && { label: "Reports", Icon: BarChart3, act: () => goTab("reports") },
    ].filter(Boolean) },
    { group: "SETTINGS", items: [
      perms.has("edit_center") && { label: "Education Settings", Icon: SettingsIcon, act: () => goTab("settings") },
      canManage && { label: "AI Settings", Icon: Sliders, act: () => scrollTo("ai") },
      { label: "Schedules", Icon: CalendarDays, act: () => goTab("calendar") },
      { label: "Notifications", Icon: Bell, act: () => navigate("/notifications") },
    ].filter(Boolean) },
    { group: "HELP", items: [
      { label: "Guide & Support", Icon: HelpCircle, act: () => navigate("/profile/support") },
      { label: "Resource Library", Icon: Library, act: () => navigate("/faq") },
    ] },
  ];

  const Sidebar = ({ mobile }) => (
    <aside className={mobile ? "w-64 h-full overflow-y-auto p-4" : "hidden lg:block w-56 shrink-0"}
      style={mobile ? { background: "color-mix(in srgb, var(--bgc) 92%, #060B14)" } : undefined}
      data-testid={mobile ? "edu-sidebar-mobile" : "edu-sidebar"}>
      <div className={mobile ? "" : "sticky top-20"}>
        <Card className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <RcImg assetKey="responsibility_center.education.compact_icon" width={30} height={30}
              style={{ borderRadius: 8 }} eager fallback={<GraduationCap size={22} style={{ color: "#10E670" }} />} />
            <div className="font-extrabold leading-tight tracking-wide" style={{ fontFamily: "var(--font-display)", color: BLUE }}>
              EDUCATION<br />CENTER
            </div>
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            AI-Powered Learning.<br />Real Progress. Real Results.
          </div>
        </Card>
        {NAV.map(({ group, items }) => !!items.length && (
          <div key={group} className="mb-3">
            <div className="text-[10px] font-bold tracking-[0.2em] px-2 mb-1" style={{ color: "var(--text-muted)" }}>{group}</div>
            {items.map(({ label, Icon, act, active }) => (
              <button key={label} onClick={act}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] mb-0.5 text-left transition-colors"
                style={active
                  ? { background: "rgba(46,160,255,0.14)", color: BLUE, border: `1px solid ${EDGE}` }
                  : { color: "var(--text-muted)", border: "1px solid transparent" }}
                data-testid={`edu-nav-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        ))}
        <Card className="mt-4" testid="edu-control-card">
          <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: BLUE }}>
            <ShieldCheck size={14} /> You're in Control
          </div>
          <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
            Manage learning, progress, and access with ease.
          </div>
        </Card>
      </div>
    </aside>
  );

  return (
    <div className="max-w-7xl mx-auto rcx-scope" data-testid="edu-dashboard">
      {/* Top header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap" data-testid="edu-header">
        <div className="flex items-center gap-2 min-w-0">
          <button className="or-btn or-btn-ghost p-1.5 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open Education menu" data-testid="edu-menu-btn">
            <Menu size={16} />
          </button>
          <RcImg assetKey="responsibility_center.education.logo" width={38} height={38} eager
            style={{ borderRadius: 10 }} fallback={<Logo size={36} />} testid="edu-header-logo" />
          <div className="min-w-0">
            <div className="font-bold truncate" style={{ fontFamily: "var(--font-display)" }}>{ov.center.name}</div>
            <button className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}
              onClick={() => navigate(`/responsibility-center/${id}`)} data-testid="edu-back-classic">
              <ChevronLeft size={10} /> Standard Center view
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2" data-testid="edu-fp-balance-row">
          <div className="text-xs">
            <span style={{ color: "var(--text-muted)" }}>Fire Power Balance </span>
            <b style={{ color: "#F4A73B" }} data-testid="edu-fp-balance">🔥 {balance.toLocaleString()}</b>
          </div>
          <button className="or-btn text-xs" onClick={() => goTab("vault")} data-testid="edu-fp-add">
            <Plus size={12} /> Add Fire Power
          </button>
        </div>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setNavOpen(false)} data-testid="edu-nav-overlay">
          <div onClick={(e) => e.stopPropagation()} className="h-full">
            <div className="flex justify-end p-2" style={{ background: "color-mix(in srgb, var(--bgc) 92%, #060B14)" }}>
              <button onClick={() => setNavOpen(false)} aria-label="Close menu" data-testid="edu-nav-close"><X size={16} /></button>
            </div>
            <Sidebar mobile />
          </div>
        </div>
      )}

      <div className="flex gap-4 items-start">
        <Sidebar />
        <main className="flex-1 min-w-0 space-y-4">
          {/* Student selector */}
          <Card testid="edu-student-selector">
            <div ref={refs.students} />
            <SectionTitle>Select Student</SectionTitle>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {ov.students.map((s) => {
                const active = s.user_id === sel?.user_id;
                return (
                  <button key={s.user_id} onClick={() => selectStudent(s.user_id)}
                    className="shrink-0 rounded-xl px-4 py-3 text-left transition-transform hover:-translate-y-0.5"
                    style={{
                      minWidth: 128,
                      background: active ? "rgba(46,160,255,0.10)" : "rgba(255,255,255,0.03)",
                      border: active ? `1.5px solid ${BLUE}` : `1px solid rgba(255,255,255,0.10)`,
                      boxShadow: active ? "0 0 16px rgba(46,160,255,0.4)" : "none",
                    }}
                    aria-pressed={active} data-testid={`edu-student-${s.username}`}>
                    <img src={s.avatar_url || `https://api.dicebear.com/9.x/initials/svg?seed=${s.username}`}
                      alt="" className="rounded-full mb-1.5" style={{ width: 36, height: 36, objectFit: "cover" }} />
                    <div className="text-sm font-semibold truncate">{firstNameLastInitial(s.name, s.username)}</div>
                    <div className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                      {s.grade_level ? (s.stage === "k12" ? `Grade ${s.grade_level}` : s.grade_level) : "Level not set"}
                      <span className="rounded-full inline-block" style={{ width: 6, height: 6, background: "#10E670" }} aria-label="Active" />
                    </div>
                  </button>
                );
              })}
              {perms.has("invite_members") && (
                <button onClick={() => goTab("members")} className="shrink-0 rounded-xl px-4 py-3 flex flex-col items-center justify-center"
                  style={{ minWidth: 110, border: `1px dashed ${EDGE}`, color: BLUE }} data-testid="edu-add-student">
                  <Plus size={20} /> <span className="text-xs mt-1">Add Student</span>
                </button>
              )}
            </div>
          </Card>

          {/* Profile + controls */}
          {sel && <StudentControls key={sel.user_id} centerId={id} sel={sel} ov={ov} canManage={canManage} refAi={refs.ai} reload={() => load(sel.user_id)} />}

          {/* Daily tasks */}
          <Card testid="edu-lessons">
            <div ref={refs.lessons} />
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
              <SectionTitle>Daily Tasks (Lessons)</SectionTitle>
              {canManage && (
                <button className="or-btn text-xs" onClick={() => setCreateOpen(true)} data-testid="edu-lesson-add">
                  <Plus size={12} /> Add
                </button>
              )}
            </div>
            <LessonTable lessons={ov.lessons} canManage={canManage} centerId={id}
              onOpen={(lid) => setOpenItem(lid)} reload={() => load(sel?.user_id)} />
          </Card>

          {/* Progress overview */}
          <div ref={refs.progress}>
            <ProgressOverview summary={ov.summary} />
          </div>

          {/* Reports & exports */}
          <Card testid="edu-reports">
            <div ref={refs.reports} />
            <SectionTitle>Reports &amp; Exports</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {[["Progress Report", FileBarChart, "#5AB2FF"], ["Transcript Summary", FileText, "#10E670"],
                ["Grade Report", Star, "#F4A73B"], ["Attendance Report", CheckSquare, "#C26BFF"],
                ["Time Report", Timer, "#5AB2FF"], ["Export All", Download, "#10E670"]].map(([label, Icon, color]) => (
                <button key={label} onClick={() => goTab("reports")}
                  className="rounded-xl p-3 flex flex-col items-center gap-2 text-center transition-transform hover:-translate-y-0.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: `1px solid rgba(255,255,255,0.10)` }}
                  data-testid={`edu-report-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                  <Icon size={22} style={{ color }} />
                  <span className="text-[11px] font-semibold">{label}</span>
                </button>
              ))}
            </div>
            <div className="text-[10px] mt-3" style={{ color: "var(--text-muted)" }} data-testid="edu-report-disclaimer">
              Reports reflect information recorded within this Responsibility Center and may not constitute an official,
              certified, or legally recognized record.
            </div>
          </Card>

          {/* Bottom trust bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="edu-trust-bar">
            {[[Sparkles, "Powered by OurRealm AI", "Smart. Adaptive. Effective."],
              [ShieldCheck, "Safe & Secure", "Privacy-first. Designed with safety controls."],
              [GraduationCap, "Built for Education", "For families, schools, homeschool groups, tutors, and learning organizations."]]
              .map(([Icon, t, d]) => (
                <Card key={t} className="flex items-center gap-3">
                  <Icon size={20} style={{ color: BLUE }} className="shrink-0" />
                  <div>
                    <div className="text-xs font-semibold">{t}</div>
                    <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{d}</div>
                  </div>
                </Card>
              ))}
          </div>
        </main>
      </div>

      {createOpen && center && (
        <RcItemCreateModal centerId={id} canCreate={canManage} members={center.members || []}
          timezone={center.center?.timezone || "UTC"}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); load(sel?.user_id); }} />
      )}
      {openItem && (
        <RcItemDrawer centerId={id} itemId={openItem}
          onClose={() => setOpenItem(null)} onChanged={() => load(sel?.user_id)} />
      )}
      <RcOraiPanel centerId={id} centerName={ov.center.name} open={oraiOpen} onClose={() => setOraiOpen(false)} />
      <button onClick={() => setOraiOpen(true)}
        className="fixed bottom-24 md:bottom-6 right-5 z-[60] rounded-full p-3.5 transition-transform hover:scale-105"
        style={{ background: "linear-gradient(135deg, #C26BFF, #2EA0FF)", boxShadow: "0 0 18px rgba(194,107,255,0.5)", color: "#fff" }}
        aria-label="Ask ORAi Tutor" title="Ask ORAi Tutor" data-testid="edu-orai-fab">
        <Sparkles size={20} />
      </button>
    </div>
  );
}

function StudentControls({ centerId, sel, ov, canManage, refAi, reload }) {
  const [stage, setStage] = useState(sel.stage);
  const levels = ov.stage_levels[stage] || [];
  const [gradeIdx, setGradeIdx] = useState(Math.max(0, levels.indexOf(sel.grade_level)));
  const aiLevels = ov.ai_power_levels || [];
  const savedAiIdx = Math.max(0, aiLevels.findIndex((l) => l.key === sel.ai_power_level));
  const [aiIdx, setAiIdx] = useState(savedAiIdx);
  const gradeTimer = useRef(null);

  const patch = async (body, okMsg) => {
    try {
      await apiClient.patch(`/responsibility-center/${centerId}/education/students/${sel.user_id}`, body);
      toast.success(okMsg);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
  };

  const changeStage = (s) => {
    if (!canManage) return;
    setStage(s);
    const lv = ov.stage_levels[s];
    const idx = Math.min(gradeIdx, lv.length - 1);
    setGradeIdx(idx);
    patch({ stage: s, grade_level: lv[idx] }, "Education level updated");
  };

  const changeGrade = (idx) => {
    setGradeIdx(idx);
    clearTimeout(gradeTimer.current);
    gradeTimer.current = setTimeout(() => patch({ grade_level: levels[idx] }, `Learning level saved: ${levels[idx]}`), 700);
  };

  const commitAi = (idx) => {
    const cur = aiLevels[savedAiIdx];
    const next = aiLevels[idx];
    if (!next || next.key === cur?.key) return;
    if ((next.fp_per_day || 0) > (cur?.fp_per_day || 0)) {
      if (!window.confirm(`Set AI Power to ${next.label}? Estimated Fire Power requirement: 🔥 ${next.fp_per_day} / day. Nothing is burned by this setting alone — Fire Power is only used by actual AI sessions.`)) {
        setAiIdx(savedAiIdx);
        return;
      }
    }
    patch({ ai_power_level: next.key }, `AI Power set to ${next.label}`);
  };

  const gradeLabel = stage === "k12" && levels[gradeIdx] !== "K" ? `Grade ${levels[gradeIdx]}` : levels[gradeIdx];
  const ai = aiLevels[aiIdx] || {};
  const aiPct = aiLevels.length > 1 ? (aiIdx / (aiLevels.length - 1)) * 100 : 0;
  const gradePct = levels.length > 1 ? (gradeIdx / (levels.length - 1)) * 100 : 0;

  return (
    <Card testid="edu-student-controls">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Profile */}
        <div data-testid="edu-profile">
          <div className="flex items-center gap-3 mb-3">
            <img src={sel.avatar_url || `https://api.dicebear.com/9.x/initials/svg?seed=${sel.username}`}
              alt="" className="rounded-full" style={{ width: 64, height: 64, objectFit: "cover", border: `2px solid ${BLUE}`, boxShadow: GLOW }} />
            <div>
              <div className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }} data-testid="edu-profile-name">{sel.name}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{gradeLabel || "Level not set"}</div>
              <div className="text-[10px] flex items-center gap-1" style={{ color: "#10E670" }}>
                <span className="rounded-full inline-block" style={{ width: 6, height: 6, background: "#10E670" }} /> Active
              </div>
            </div>
          </div>
          <div className="text-xs space-y-1.5">
            {[["School Year", sel.school_year || "—"], ["Learning Path", sel.learning_path || "—"],
              ["Focus", (sel.focus_subjects || []).join(", ") || "—"],
              ["AI Tutor", sel.ai_tutor_enabled ? "Enabled" : "Off"]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span style={{ color: "var(--text-muted)" }}>{k}</span>
                <span className="text-right font-medium" data-testid={`edu-profile-${k.toLowerCase().replace(/\s/g, "-")}`}>{v}</span>
              </div>
            ))}
          </div>
          {canManage && (
            <button className="or-chip text-[11px] mt-2" data-active={sel.ai_tutor_enabled}
              onClick={() => patch({ ai_tutor_enabled: !sel.ai_tutor_enabled }, sel.ai_tutor_enabled ? "AI Tutor turned off" : "AI Tutor enabled")}
              data-testid="edu-ai-tutor-toggle">
              <Bot size={11} /> {sel.ai_tutor_enabled ? "Disable AI Tutor" : "Enable AI Tutor"}
            </button>
          )}
        </div>

        {/* Education level */}
        <div data-testid="edu-level-panel">
          <div className="text-[10px] font-bold tracking-[0.16em] mb-2" style={{ color: BLUE }}>EDUCATION LEVEL</div>
          <div className="flex gap-1.5 mb-4">
            {[["prek", "Pre-K"], ["k12", "K–12"], ["higher", "Higher Ed"]].map(([k, label]) => (
              <button key={k} onClick={() => changeStage(k)} disabled={!canManage}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={stage === k
                  ? { background: BLUE, color: "#06101E" }
                  : { background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", border: "1px solid rgba(255,255,255,0.10)" }}
                aria-pressed={stage === k} data-testid={`edu-stage-${k}`}>{label}</button>
            ))}
          </div>
          <label className="text-xs block mb-1" htmlFor="edu-grade-slider">
            <span style={{ color: "var(--text-muted)" }}>Grade Level</span>{" "}
            <b data-testid="edu-grade-value">{gradeLabel || "—"}</b>
          </label>
          <input id="edu-grade-slider" type="range" min="0" max={Math.max(0, levels.length - 1)} step="1"
            value={gradeIdx} disabled={!canManage}
            onChange={(e) => changeGrade(Number(e.target.value))}
            aria-label={`Grade level: ${gradeLabel}`}
            aria-valuetext={gradeLabel}
            className="edu-slider w-full"
            style={{ background: `linear-gradient(90deg, #10E670 0%, ${BLUE} ${gradePct}%, rgba(255,255,255,0.12) ${gradePct}%)` }}
            data-testid="edu-grade-slider" />
          <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
            <span>{levels[0]}</span>
            <b style={{ color: "var(--text-main)" }}>{levels[gradeIdx]}</b>
            <span>{levels[levels.length - 1]}</span>
          </div>
          {!canManage && (
            <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }} data-testid="edu-level-readonly">
              Learning settings are managed by your Center's teachers and managers.
            </div>
          )}
        </div>

        {/* AI power */}
        <div data-testid="edu-ai-panel">
          <div ref={refAi} />
          <div className="text-[10px] font-bold tracking-[0.16em] mb-2" style={{ color: BLUE }}
            title="Higher AI Power may provide more advanced assistance and may require more Fire Power.">
            AI POWER <span style={{ color: "var(--text-muted)" }}>(TEACHING INTELLIGENCE)</span>
          </div>
          <div className="flex justify-between text-xs mb-1">
            <span data-testid="edu-ai-value">{ai.label || "—"}</span>
            <span style={{ color: "#F4A73B" }}>{aiIdx >= aiLevels.length / 2 ? "High use" : "Medium"}</span>
          </div>
          <input type="range" min="0" max={Math.max(0, aiLevels.length - 1)} step="1"
            value={aiIdx} disabled={!canManage}
            onChange={(e) => setAiIdx(Number(e.target.value))}
            onMouseUp={(e) => commitAi(Number(e.target.value))}
            onTouchEnd={() => commitAi(aiIdx)}
            onKeyUp={(e) => ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) && commitAi(aiIdx)}
            aria-label={`AI Power level: ${ai.label || ""}`}
            aria-valuetext={ai.label}
            className="edu-slider w-full"
            style={{ background: `linear-gradient(90deg, #10E670 0%, #F4E14A ${Math.max(aiPct * 0.6, 1)}%, #F4A73B ${aiPct}%, rgba(255,255,255,0.12) ${aiPct}%)` }}
            data-testid="edu-ai-slider" />
          <div className="flex justify-between text-[9px] mt-1" style={{ color: "var(--text-muted)" }}>
            {aiLevels.map((l) => <span key={l.key}>{l.label}</span>)}
          </div>
          <div className="mt-3 rounded-lg p-3 flex items-center gap-3"
            style={{ background: "rgba(244,167,59,0.08)", border: "1px solid rgba(244,167,59,0.3)" }}
            title="Higher AI Power may provide more advanced assistance and may require more Fire Power.">
            <Flame size={20} style={{ color: "#F4A73B" }} />
            <div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Fire Power Requirement / Day</div>
              <div className="text-lg font-bold" style={{ color: "#F4A73B" }} data-testid="edu-ai-fp-per-day">🔥 {ai.fp_per_day ?? "—"}</div>
            </div>
          </div>
          <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
            An engagement-resource estimate — AI suggestions always require approval by an authorized person.
          </div>
        </div>
      </div>
    </Card>
  );
}

function LessonTable({ lessons, canManage, centerId, onOpen, reload }) {
  const archive = async (l) => {
    if (!window.confirm(`Archive "${l.title}"? Its history is preserved.`)) return;
    try {
      await apiClient.post(`/responsibility-center/${centerId}/items/${l.id}/actions/archive`, {});
      toast.success("Lesson archived");
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not archive"); }
  };
  if (!lessons.length) {
    return (
      <div className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }} data-testid="edu-lessons-empty">
        No lessons assigned yet{canManage ? " — use + Add to create the first one." : "."}
      </div>
    );
  }
  const Row = ({ l }) => {
    const { Icon, color } = subjectMeta(l.subject);
    const [label, scolor] = l.overdue ? ["Overdue", "#FF6B6B"] : (STATUS_META[l.status] || [l.status, "#9AA7BD"]);
    return (
      <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid={`edu-lesson-row-${l.id}`}>
        <td className="py-2.5 pr-3">
          <div className="flex items-start gap-2">
            <span className="rounded-lg p-1.5 shrink-0" style={{ background: `${color}18`, color }}><Icon size={14} /></span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{l.title}</div>
              {l.description && <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{l.description}</div>}
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-3 text-xs">{l.subject || "—"}</td>
        <td className="py-2.5 pr-3 text-xs whitespace-nowrap">{fmtDue(l.due_at)}</td>
        <td className="py-2.5 pr-3">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ background: `${scolor}1c`, color: scolor, border: `1px solid ${scolor}55` }}
            data-testid={`edu-lesson-status-${l.id}`}>{label}</span>
        </td>
        <td className="py-2.5 pr-3" style={{ minWidth: 110 }}>
          <div className="text-[10px] mb-0.5">{l.progress}%</div>
          <div className="h-1.5 rounded-full" role="img" aria-label={`Progress ${l.progress}%`}
            style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-1.5 rounded-full" style={{ width: `${l.progress}%`, background: l.progress >= 100 ? "#10E670" : "#F4A73B" }} />
          </div>
        </td>
        <td className="py-2.5">
          <div className="flex items-center gap-1">
            <button className="p-1" title="View" aria-label={`View ${l.title}`} onClick={() => onOpen(l.id)} style={{ color: BLUE }} data-testid={`edu-lesson-view-${l.id}`}><Eye size={14} /></button>
            {canManage && (<>
              <button className="p-1" title="Edit" aria-label={`Edit ${l.title}`} onClick={() => onOpen(l.id)} style={{ color: "#F4A73B" }} data-testid={`edu-lesson-edit-${l.id}`}><Pencil size={13} /></button>
              <button className="p-1" title="Remove" aria-label={`Remove ${l.title}`} onClick={() => archive(l)} style={{ color: "#FF6B6B" }} data-testid={`edu-lesson-remove-${l.id}`}><Trash2 size={13} /></button>
            </>)}
          </div>
        </td>
      </tr>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full" data-testid="edu-lessons-table">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {["Lesson / Task", "Subject", "Due Date", "Status", "Progress", "Actions"].map((h) => (
              <th key={h} scope="col" className="py-1.5 pr-3 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{lessons.map((l) => <Row key={l.id} l={l} />)}</tbody>
      </table>
    </div>
  );
}

function ProgressOverview({ summary: s }) {
  const pct = s.completion_pct || 0;
  const R = 42, C = 2 * Math.PI * R;
  return (
    <Card testid="edu-progress">
      <SectionTitle>Progress Overview</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl p-3 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid="edu-progress-overall">
          <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>Overall Progress</div>
          <svg width="110" height="110" viewBox="0 0 110 110" className="mx-auto" role="img" aria-label={`Overall progress ${pct} percent`}>
            <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
            <circle cx="55" cy="55" r={R} fill="none" stroke="url(#eduGrad)" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 55 55)" />
            <defs>
              <linearGradient id="eduGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#2EA0FF" /><stop offset="100%" stopColor="#10E670" />
              </linearGradient>
            </defs>
            <text x="55" y="52" textAnchor="middle" fontSize="20" fontWeight="800" fill="#FFFFFF">{`${pct}%`}</text>
            <text x="55" y="68" textAnchor="middle" fontSize="9" fill="#9AA7BD">Complete</text>
          </svg>
          <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{s.completed} / {s.total} Lessons Completed</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid="edu-progress-status">
          <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>Progress by Status</div>
          {[["Completed", s.completed, "#10E670"], ["In Progress", s.in_progress, "#F4A73B"],
            ["Pending", s.pending, "#5AB2FF"], ["Overdue", s.overdue, "#FF6B6B"]].map(([k, v, c]) => (
            <div key={k} className="flex items-center justify-between text-xs py-1">
              <span className="flex items-center gap-2">
                <span className="rounded-full inline-block" style={{ width: 8, height: 8, background: c }} />{k}
              </span>
              <b>{v}</b>
            </div>
          ))}
        </div>
        <div className="rounded-xl p-3 text-center flex flex-col justify-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          title="This reflects information recorded in this Responsibility Center and may not represent an official or legally recognized academic record."
          data-testid="edu-progress-grade">
          <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Average Grade Within This Center</div>
          {s.average_grade !== null ? (<>
            <div className="text-3xl font-extrabold" style={{ color: "#F4A73B" }}>{s.average_grade}% <Star size={18} className="inline mb-1" /></div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>All Subjects · {s.graded_count} graded</div>
          </>) : (
            <div className="text-sm py-3" style={{ color: "var(--text-muted)" }} data-testid="edu-grade-empty">No grades recorded yet</div>
          )}
        </div>
        <div className="rounded-xl p-3 flex flex-col justify-center gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid="edu-progress-time">
          <div className="flex items-center gap-2">
            <Clock size={16} style={{ color: BLUE }} />
            <div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Study Time (This Week)</div>
              <div className="text-sm font-bold">{s.study_time_week ?? <span style={{ color: "var(--text-muted)" }}>Not tracked yet</span>}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Bot size={16} style={{ color: "#C26BFF" }} />
            <div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>AI Sessions</div>
              <div className="text-sm font-bold">{s.ai_sessions ?? <span style={{ color: "var(--text-muted)" }}>Not tracked yet</span>}</div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
