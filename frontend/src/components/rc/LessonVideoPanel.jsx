import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clapperboard, Loader2, Upload, Link2, Trash2, X, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const STATUS_COLORS = {
  queued: "#F4A73B", generating: "#C26BFF", downloading: "#2EA0FF",
  uploading_r2: "#2EA0FF", optimizing: "#4DD6C1", attaching: "#4DD6C1",
  ready: "#10E670", complete: "#10E670", failed: "#FF6B6B", cancelled: "#FF8A5A",
};
const STAGE_TEXT = {
  queued: "Queued…", designing_prompt: "ORAi is writing the cinematic production prompt…",
  generating: "Generating video…", downloading: "Downloading…",
  uploading_r2: "Uploading to storage…", optimizing: "Optimizing & thumbnail…",
  attaching: "Attaching to lesson…",
};

function EstimateModal({ base, blockBody, onApprove, onClose }) {
  const [seconds, setSeconds] = useState(4);
  const [prompt, setPrompt] = useState(blockBody || "");
  const [styleProfile, setStyleProfile] = useState({ primary: "auto", camera: "Auto" });
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEst(null);
    apiClient.post(`${base}/estimate`, { seconds })
      .then((r) => setEst(r.data))
      .catch((e) => { toast.error(e?.response?.data?.detail || "Could not estimate"); onClose(); });
  }, [seconds, base, onClose]);
  const approve = async () => {
    if (!prompt.trim() || !est) return;
    setBusy(true);
    try { await onApprove({ prompt: prompt.trim(), seconds, estimate: est, styleProfile }); onClose(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not start generation"); }
    finally { setBusy(false); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="or-surface w-full max-w-md p-4 rcx-scope overflow-y-auto" style={{ maxHeight: "88dvh" }} onClick={(e) => e.stopPropagation()} data-testid="video-estimate-modal">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: "var(--font-display)" }}>
            <Clapperboard size={15} style={{ color: "#C26BFF" }} /> Generate lesson video
          </div>
          <button className="or-btn or-btn-ghost p-1.5" onClick={onClose} data-testid="video-estimate-close"><X size={13} /></button>
        </div>
        <textarea className="or-input w-full text-xs mb-2" rows={3} maxLength={2000}
          placeholder="Describe the video to generate…" value={prompt}
          onChange={(e) => setPrompt(e.target.value)} data-testid="video-prompt-input" />
        <div className="flex gap-1.5 mb-3">
          {[4, 8, 12].map((s) => (
            <button key={s} className="text-[11px] px-2.5 py-1 rounded-full"
              style={{ background: seconds === s ? "rgba(194,107,255,0.2)" : "rgba(255,255,255,0.05)",
                       border: seconds === s ? "1px solid #C26BFF" : "1px solid rgba(255,255,255,0.1)" }}
              onClick={() => setSeconds(s)} data-testid={`video-seconds-${s}`}>{s}s</button>
          ))}
        </div>
        <div className="rounded-xl p-2 mb-3" style={{ background: "rgba(46,230,255,0.03)", border: "1px solid rgba(46,230,255,0.15)" }}>
          <StyleSelector compact value={styleProfile} onChange={setStyleProfile} subjectHint={blockBody || ""} />
        </div>
        {!est ? <div className="text-xs py-3 text-center" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin inline mr-1" /> Estimating…</div> : (
          <div className="rounded-xl p-3 mb-3 text-[11px] space-y-1" style={{ background: "rgba(255,255,255,0.04)" }} data-testid="video-estimate-details">
            {est.dry_run && (
              <div className="font-bold" style={{ color: "#4DD6C1" }}>DRY RUN mode is on — a free test clip is produced, nothing is billed.</div>
            )}
            {[["Estimated cost", `$${est.estimated_cost.toFixed(2)}`],
              ["Estimated time", `~${Math.round(est.estimated_time_seconds / 60)} min`],
              ["Resolution", est.size], ["Duration", `${est.seconds}s`],
              ["Engine", est.provider_label],
              ["Daily budget remaining", `$${est.daily_budget_remaining.toFixed(2)}`],
              ["Course video total (with this)", `$${est.course_total_with_this.toFixed(2)}`]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><span style={{ color: "var(--text-muted)" }}>{k}</span><b>{v}</b></div>
            ))}
            {est.blockers.map((b) => <div key={b} style={{ color: "#FF6B6B" }}>⚠ {b}</div>)}
          </div>
        )}
        <div className="flex gap-2">
          <button className="or-btn text-xs flex-1 font-bold" disabled={busy || !est || est.blockers.length > 0 || !prompt.trim()}
            onClick={approve} data-testid="video-approve-generate">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />}
            Approve & Generate {est ? `($${est.estimated_cost.toFixed(2)})` : ""}
          </button>
          <button className="or-btn or-btn-ghost text-xs" onClick={onClose}>Cancel</button>
        </div>
        <div className="text-[9px] mt-2" style={{ color: "var(--text-muted)" }}>Nothing is generated or spent without this explicit approval.</div>
      </div>
    </div>,
    document.body,
  );
}

// LessonVideoPanel — video controls for a video_embed block in the Course
// Editor. Generate / upload / paste URL / remove — all provider-agnostic.
export default function LessonVideoPanel({ centerId, courseId, lessonId, block, onBlockChange }) {
  const base = `/responsibility-center/${centerId}/courses/${courseId}/lessons/${lessonId}/video`;
  const [showEstimate, setShowEstimate] = useState(false);
  const [job, setJob] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const pollJob = (jobId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiClient.get(`${base}/jobs/${jobId}`);
        setJob(r.data);
        if (r.data.status === "complete") {
          clearInterval(pollRef.current);
          onBlockChange({ video_url: r.data.video_url, video_thumbnail: r.data.thumbnail_url,
            video_source: "generated", video_status: "ready", video_job_id: jobId });
          toast.success("Lesson video is ready");
          setJob(null);
        } else if (r.data.status === "failed" || r.data.status === "cancelled") {
          clearInterval(pollRef.current);
          if (r.data.status === "failed") toast.error(r.data.error || "Video generation failed");
          setJob(null);
        }
      } catch { /* transient — keep polling */ }
    }, 4000);
  };

  const startGenerate = async ({ prompt, seconds, estimate, styleProfile }) => {
    const r = await apiClient.post(`${base}/generate`, {
      block_id: block.id, prompt, seconds,
      approve_cost: true, approved_cost: estimate.estimated_cost,
      style_profile: styleProfile,
    });
    setJob({ id: r.data.job_id, status: "queued", stage: "queued", progress: 0 });
    pollJob(r.data.job_id);
    toast.success(r.data.dry_run ? "Dry-run video queued (free)" : "Video generation queued");
  };

  const cancelJob = async () => {
    if (!job) return;
    try { await apiClient.post(`${base}/jobs/${job.id}/cancel`); toast.success("Cancel requested"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not cancel"); }
  };

  const uploadFile = async (file) => {
    if (!file) return;
    const rights = window.confirm(
      "Do you have the rights to this video AND its audio? OK = publish with original audio. Cancel = abort upload.");
    if (!rights) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("audio_choice", "original");
      fd.append("rights_confirmed", "true");
      fd.append("upload_session_id", `lessonvid-${block.id}-${Date.now()}`);
      const up = await apiClient.post("/videos/upload", fd, { timeout: 300000 });
      const url = up.data.url || up.data.video?.url;
      await apiClient.post(`${base}/attach`, { block_id: block.id, video_url: url });
      onBlockChange({ video_url: url, video_source: "uploaded", video_status: "ready", video_thumbnail: null });
      toast.success("Video uploaded & attached");
    } catch (e) { toast.error(e?.response?.data?.detail || "Upload failed"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const pasteUrl = async () => {
    const url = window.prompt("Paste an https:// video URL (or an OurRealm /api/videos/… URL):");
    if (!url) return;
    try {
      const r = await apiClient.post(`${base}/attach`, { block_id: block.id, video_url: url.trim() });
      onBlockChange({ video_url: r.data.video_url, video_source: r.data.video_source, video_status: "ready", video_thumbnail: null });
      toast.success("Video attached");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not attach"); }
  };

  const removeVideo = async () => {
    if (!window.confirm("Remove this video from the lesson?")) return;
    try {
      await apiClient.post(`${base}/remove`, { block_id: block.id });
      onBlockChange({ video_url: null, video_source: null, video_status: null, video_thumbnail: null, video_job_id: null });
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not remove"); }
  };

  const status = job?.status || block.video_status;
  return (
    <div className="rounded-lg p-2.5 mb-2" style={{ background: "rgba(46,230,255,0.04)", border: "1px dashed rgba(46,230,255,0.3)" }}
      data-testid={`lesson-video-panel-${block.id}`}>
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <Clapperboard size={12} style={{ color: "#2EE6FF" }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#2EE6FF" }}>Lesson video</span>
        {status && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: `${STATUS_COLORS[status] || "#888"}22`, color: STATUS_COLORS[status] || "#888" }}
            data-testid="video-status-chip">{status}</span>
        )}
        {block.video_source && <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>({block.video_source})</span>}
      </div>

      {block.video_url && !job && (
        <video controls preload="metadata" className="w-full rounded-lg mb-2" src={block.video_url}
          poster={block.video_thumbnail || undefined} style={{ maxHeight: 220 }} data-testid="video-preview" />
      )}

      {job && (
        <div className="text-[11px] mb-2 flex items-center gap-2" style={{ color: "#C26BFF" }} data-testid="video-job-progress">
          <Loader2 size={12} className="animate-spin" />
          {STAGE_TEXT[job.stage] || "Working…"} {job.progress ? `${job.progress}%` : ""}
          <button className="or-btn or-btn-ghost text-[10px] ml-auto" onClick={cancelJob} data-testid="video-job-cancel">Cancel</button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button className="or-btn text-[10px]" onClick={() => setShowEstimate(true)} disabled={!!job || uploading}
          data-testid="video-generate-btn">
          {block.video_url ? <><RefreshCcw size={11} /> Regenerate</> : <><Clapperboard size={11} /> Generate Video</>}
        </button>
        <button className="or-btn or-btn-ghost text-[10px]" onClick={() => fileRef.current?.click()} disabled={!!job || uploading}
          data-testid="video-upload-btn">
          {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Upload
        </button>
        <button className="or-btn or-btn-ghost text-[10px]" onClick={pasteUrl} disabled={!!job || uploading} data-testid="video-url-btn">
          <Link2 size={11} /> Paste URL
        </button>
        {block.video_url && (
          <button className="or-btn or-btn-ghost text-[10px]" onClick={removeVideo} disabled={!!job} data-testid="video-remove-btn">
            <Trash2 size={11} /> Remove
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden"
        onChange={(e) => uploadFile(e.target.files?.[0])} data-testid="video-file-input" />
      {showEstimate && (
        <EstimateModal base={base} blockBody={block.body?.slice(0, 500)}
          onApprove={startGenerate} onClose={() => setShowEstimate(false)} />
      )}
    </div>
  );
}
