import React from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Gamepad2, GraduationCap, Image, Workflow, CalendarPlus, BarChart3, PencilRuler } from "lucide-react";

const TOOL_DEFS = {
  project_creator: { label: "Project Creator", desc: "Create projects, plans & workflows", Icon: PencilRuler, color: "#2EE6FF", admin: true, to: (id) => `/admin/orai?center=${id}` },
  game_creator: { label: "Game Creator", desc: "Design games, levels & challenges", Icon: Gamepad2, color: "#F4A73B", admin: true, to: (id) => `/admin/orai?center=${id}&tool=game` },
  course_creator: { label: "Course Creator", desc: "Build courses, lessons & activities", Icon: GraduationCap, color: "#10E670", admin: false, to: (id) => `/responsibility-center/${id}/course-maker` },
  media_creator: { label: "Media Creator", desc: "Create images, videos & audio", Icon: Image, color: "#C26BFF", admin: true, to: (id) => `/admin/orai?center=${id}&tool=media` },
  workflow_creator: { label: "Workflow Creator", desc: "Automate processes", Icon: Workflow, color: "#FF8A5A", admin: true, to: (id) => `/admin/orai?center=${id}&tool=workflow` },
  event_creator: { label: "Event Creator", desc: "Plan events & activities", Icon: CalendarPlus, color: "#2EE6FF", admin: false, to: (id) => `/responsibility-center/${id}?tab=calendar` },
  report_creator: { label: "Report Creator", desc: "Generate reports & insights", Icon: BarChart3, color: "#10E670", admin: false, to: (id) => `/responsibility-center/${id}?tab=reports`, perm: "view_reports" },
};

// Registry-driven creator tools panel — shows ONLY tools enabled for this
// Center type, gated by role/permission. Reuses existing OPC/Course Maker.
export const RcCreatorTools = ({ centerId, cfg, role, perms }) => {
  const navigate = useNavigate();
  const tools = (cfg?.creator_tools || []).filter((k) => {
    const d = TOOL_DEFS[k];
    if (!d) return false;
    if (d.admin && !["owner", "admin"].includes(role)) return false;
    if (d.perm && !perms.has(d.perm)) return false;
    return true;
  });
  if (!tools.length) return null;
  return (
    <div className="or-surface p-4 mb-4" data-testid="rc-creator-tools">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={13} style={{ color: "#C26BFF" }} />
        <b className="text-[10px] uppercase tracking-widest" style={{ color: "#C26BFF" }}>
          Tools &amp; Creators{cfg?.type_label ? ` — ${cfg.type_label}` : ""}</b>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tools.map((k) => {
          const { label, desc, Icon, color, to } = TOOL_DEFS[k];
          return (
            <button key={k} className="text-left rounded-xl p-3 transition-transform hover:-translate-y-0.5"
              style={{ background: `${color}0d`, border: `1px solid ${color}44` }}
              onClick={() => navigate(to(centerId))} data-testid={`rc-tool-${k}`}>
              <Icon size={15} style={{ color }} />
              <div className="text-xs font-semibold mt-1">{label}</div>
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
