import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Briefcase, Repeat } from "lucide-react";
import apiClient from "@/api/client";

const fmtDue = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};

const BUCKETS = [
  ["overdue", "Overdue", "#FF6B6B"],
  ["due_today", "Due Today", "#F4C84A"],
  ["due_soon", "Due Soon", "#5AB2FF"],
  ["pending_my_approval", "Pending My Approval", "#C26BFF"],
  ["in_progress", "In Progress", "#7BD88F"],
  ["recently_completed", "Recently Completed", "#9AA7BD"],
];

// Cross-Center "My Work" — only items the user is authorized to see.
export const RcMyWork = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    apiClient.get("/responsibility-center/my-work")
      .then((r) => setData(r.data))
      .catch(() => setData({ buckets: {}, total: 0 }));
  }, []);

  if (!data || !data.total) return null;
  const buckets = data.buckets || {};

  return (
    <div className="mb-6" data-testid="rc-my-work">
      <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>
        <Briefcase size={16} className="inline mr-1" /> My Work
      </h3>
      <div className="space-y-3">
        {BUCKETS.map(([key, label, color]) => {
          const rows = buckets[key] || [];
          if (!rows.length) return null;
          return (
            <div key={key} className="or-surface p-3" data-testid={`rc-my-work-${key}`}>
              <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color }}>
                {label} ({rows.length})
              </div>
              <div className="space-y-1">
                {rows.slice(0, 5).map((it) => (
                  <button key={it.id}
                    className="w-full flex flex-wrap items-center gap-2 py-1.5 px-1 text-left hover:bg-white/5 rounded"
                    onClick={() => navigate(`/responsibility-center/${it.center_id}?tab=work&item=${it.id}`)}
                    data-testid={`rc-my-work-item-${it.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{it.title}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {it.center_name} · {it.item_type} · {it.priority}
                        {it.due_at ? ` · due ${fmtDue(it.due_at)}` : ""}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: it.overdue ? "#FF6B6B" : "var(--text-muted)" }}>
                      {it.overdue ? "overdue" : it.status.replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RcMyWork;
