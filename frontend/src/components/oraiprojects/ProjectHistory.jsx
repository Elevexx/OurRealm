import { useEffect, useState } from "react";
import { Copy, Archive, Eye, Play } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";

const COLORS = {
  draft: "#7B8CFF", estimated: "#7B8CFF", queued: "#2EA0FF", generating: "#2EA0FF",
  completed: "#10E670", partially_completed: "#F4A73B", failed: "#FF6B6B", canceled: "#FF6B6B",
};

export const ProjectHistoryCard = ({ p, onOpen, onDuplicate, onArchive }) => (
  <div className="or-surface p-3 rounded-xl" data-testid={`history-card-${p.id}`}>
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>{p.name}</span>
      <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded-full uppercase whitespace-nowrap"
        style={{ background: `${COLORS[p.status] || "#7B8CFF"}22`, color: COLORS[p.status] || "#7B8CFF" }}
        data-testid={`history-status-${p.id}`}>
        {p.status.replace("_", " ")}
      </span>
    </div>
    <div className="text-[9.5px] mt-1 truncate" style={{ color: "var(--text-muted)" }}>
      {(p.tools || []).join(" · ")} — cx {p.complexity} / pw {p.ai_power}
      {p.estimate && ` · est $${p.estimate.total?.toFixed(2)}`}
      {p.usage?.total > 0 && ` · used $${p.usage.total.toFixed(2)}`}
    </div>
    <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
      {new Date(p.updated_at).toLocaleString()}
    </div>
    <div className="flex gap-1.5 mt-2">
      <button className="or-btn text-[9.5px] px-2 py-1 flex items-center gap-1" onClick={() => onOpen(p)}
        data-testid={`history-open-${p.id}`}>
        {["queued", "generating"].includes(p.status) ? <Play size={9} /> : <Eye size={9} />}
        {["queued", "generating"].includes(p.status) ? "View Progress" : p.status === "draft" ? "Continue Editing" : "Open"}
      </button>
      <button className="or-btn text-[9.5px] px-2 py-1 flex items-center gap-1" onClick={() => onDuplicate(p)}
        data-testid={`history-duplicate-${p.id}`}><Copy size={9} />Duplicate</button>
      {!["queued", "generating"].includes(p.status) && (
        <button className="or-btn text-[9.5px] px-2 py-1 flex items-center gap-1" onClick={() => onArchive(p)}
          data-testid={`history-archive-${p.id}`}><Archive size={9} />Archive</button>
      )}
    </div>
  </div>
);

export const ProjectHistory = ({ onOpen, refreshKey }) => {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const load = (pg = page) =>
    apiClient.get(`/orai/projects?page=${pg}`)
      .then((r) => { setRows(r.data.projects || []); setPages(r.data.pages || 1); })
      .catch(() => {});
  useEffect(() => { load(page); }, [page, refreshKey]); // eslint-disable-line

  const dup = async (p) => {
    try { const { data } = await apiClient.post(`/orai/projects/${p.id}/duplicate`, {}); toast.success("Duplicated"); onOpen(data.project, "edit"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Duplicate failed"); }
  };
  const arch = async (p) => {
    try { await apiClient.post(`/orai/projects/${p.id}/archive`, { archived: true }); toast.success("Archived"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Archive failed"); }
  };

  if (!rows.length && page === 1) return null;
  return (
    <div className="space-y-2" data-testid="project-history">
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Project History</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {rows.map((p) => <ProjectHistoryCard key={p.id} p={p} onOpen={onOpen} onDuplicate={dup} onArchive={arch} />)}
      </div>
      {pages > 1 && (
        <div className="flex gap-2 items-center text-[10px]" style={{ color: "var(--text-muted)" }}>
          <button className="or-btn text-[10px] px-2 py-1" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="history-prev">Prev</button>
          {page}/{pages}
          <button className="or-btn text-[10px] px-2 py-1" disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="history-next">Next</button>
        </div>
      )}
    </div>
  );
};

export default ProjectHistory;
