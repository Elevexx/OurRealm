import { useEffect, useRef, useState } from "react";
import { FolderUp, Search, RotateCcw, Trash2, CheckCircle2, XCircle, FileBox, Music2, Video, Box, FileText, Archive, ChevronDown, ChevronUp } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";

const TYPE_ICON = { audio: Music2, video: Video, model_3d: Box, unity: Box, unreal: Box, hdri: Box, material: Box, document: FileText, archive: Archive };

export const ProjectMedia = () => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [limits, setLimits] = useState(null);
  const [founder, setFounder] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const repRef = useRef(null);
  const [repTarget, setRepTarget] = useState(null);

  const load = (query = q) =>
    apiClient.get("/orai/media", { params: { q: query } }).then((r) => {
      setRows(r.data.assets); setTotal(r.data.total);
      setLimits(r.data.limits); setFounder(r.data.founder_unlimited);
    }).catch(() => {});

  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line

  const uploadFiles = async (files) => {
    setBusy(true);
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        await apiClient.post("/orai/media/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
        toast.success(`Imported ${f.name}`);
      } catch (e) { toast.error(e?.response?.data?.detail || `Failed: ${f.name}`); }
    }
    setBusy(false); load();
  };

  const act = async (fn, ok) => { try { await fn(); ok && toast.success(ok); load(); } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); } };

  return (
    <div className="or-surface p-3 mt-3" data-testid="project-media-panel">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setOpen(!open)} data-testid="project-media-toggle">
        <FolderUp size={14} style={{ color: "#2EE6FF" }} />
        <span className="text-[11px] font-bold uppercase tracking-wider flex-1" style={{ color: "var(--text-muted)" }}>
          Project Media — import &amp; reuse library {total ? `(${total})` : ""}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="mt-3">
          <div
            className="rounded-xl p-4 text-center text-[11px] cursor-pointer"
            style={{ border: "1.5px dashed rgba(46,230,255,.35)", color: "var(--text-muted)" }}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); uploadFiles([...e.dataTransfer.files]); }}
            data-testid="project-media-dropzone">
            {busy ? "Importing…" : "Drag & drop or click — images, sprite sheets, audio, video, GIF, GLB/FBX/OBJ, Unity packages, Blender, HDRI, PDFs, ZIP libraries"}
            <div className="mt-1 text-[9.5px]" style={{ color: "#2EE6FF" }}>
              {founder ? "Founder account: unlimited uploads" : limits ? `Your limits: ${limits.max_files} files · ${limits.max_mb}MB each` : ""}
            </div>
          </div>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => uploadFiles([...e.target.files])} data-testid="project-media-file-input" />
          <input ref={repRef} type="file" hidden onChange={async (e) => {
            const f = e.target.files[0]; if (!f || !repTarget) return;
            const fd = new FormData(); fd.append("file", f);
            await act(() => apiClient.post(`/orai/media/${repTarget}/replace`, fd,
              { headers: { "Content-Type": "multipart/form-data" } }), "Replaced — previous version kept");
            setRepTarget(null);
          }} />
          <div className="flex gap-2 mt-2">
            <div className="relative flex-1">
              <Search size={11} className="absolute left-2 top-2" style={{ color: "var(--text-muted)" }} />
              <input className="or-input text-[11px] w-full pl-6" placeholder="Search imported media (auto-tagged by ORAi)"
                value={q} onChange={(e) => { setQ(e.target.value); load(e.target.value); }}
                data-testid="project-media-search" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2" data-testid="project-media-grid">
            {rows.map((a) => {
              const Ic = TYPE_ICON[a.media_type] || FileBox;
              const d = a.dimensions || {};
              return (
                <div key={a.id} className="rounded-lg p-2" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}
                  data-testid={`project-media-card-${a.id}`}>
                  <div className="h-16 rounded flex items-center justify-center overflow-hidden" style={{ background: "rgba(0,0,0,.3)" }}>
                    {a.preview_url ? <img src={a.preview_url} alt={a.name} className="max-h-16 object-contain" />
                      : <Ic size={22} style={{ color: "#2EA0FF" }} />}
                  </div>
                  <div className="text-[10px] font-bold mt-1 truncate">{a.name}</div>
                  <div className="text-[8.5px]" style={{ color: "var(--text-muted)" }}>
                    {a.media_type} · {a.category}{d.width ? ` · ${d.width}×${d.height}` : ""}{d.frames > 1 ? ` · ${d.frames}f` : ""}
                    {d.duration_sec ? ` · ${d.duration_sec}s` : ""} · v{a.version}
                    {a.moderation_status === "approved" && <span style={{ color: "#10E670" }}> ✓</span>}
                    {a.moderation_status === "rejected" && <span style={{ color: "#FF5A6E" }}> ✗</span>}
                  </div>
                  <div className="flex gap-1 mt-1">
                    <button className="or-btn text-[8.5px] px-1.5" title="Replace (versioned)"
                      onClick={() => { setRepTarget(a.id); repRef.current?.click(); }}
                      data-testid={`pm-replace-${a.id}`}>Replace</button>
                    {(a.versions || []).length > 0 && (
                      <button className="or-btn text-[8.5px] px-1.5" title="Restore previous version"
                        onClick={() => act(() => apiClient.post(`/orai/media/${a.id}/restore`), "Previous version restored")}
                        data-testid={`pm-restore-${a.id}`}><RotateCcw size={9} /></button>)}
                    {founder && (
                      <>
                        <button className="or-btn text-[8.5px] px-1" onClick={() => act(() => apiClient.post(`/orai/media/${a.id}/moderate`, { decision: "approve" }), "Approved")}
                          data-testid={`pm-approve-${a.id}`}><CheckCircle2 size={9} style={{ color: "#10E670" }} /></button>
                        <button className="or-btn text-[8.5px] px-1" onClick={() => act(() => apiClient.post(`/orai/media/${a.id}/moderate`, { decision: "reject" }), "Rejected")}
                          data-testid={`pm-reject-${a.id}`}><XCircle size={9} style={{ color: "#FF5A6E" }} /></button>
                      </>)}
                    <button className="or-btn text-[8.5px] px-1 ml-auto" onClick={() => act(() => apiClient.delete(`/orai/media/${a.id}`), "Archived")}
                      data-testid={`pm-archive-${a.id}`}><Trash2 size={9} /></button>
                  </div>
                </div>
              );
            })}
            {!rows.length && <div className="col-span-full text-center text-[10px] py-3" style={{ color: "var(--text-muted)" }}>
              No imported media yet — everything you import becomes searchable and reusable by ORAi across all future projects (including Unity / VR / AR runtimes).</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectMedia;
