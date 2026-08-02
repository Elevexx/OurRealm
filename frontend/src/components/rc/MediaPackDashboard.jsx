import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Film, Image as ImageIcon, Loader2, MousePointerClick, RefreshCcw, Volume2, PencilRuler } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const fmtEta = (s) => {
  if (!s) return "—";
  if (s < 60) return `~${s}s`;
  return `~${Math.ceil(s / 60)} min`;
};

const STAGE_TEXT = {
  complete: "All assets complete",
  retrying_media: "Retrying remaining media in the background…",
  needs_attention: "Some assets need attention",
  creating_cover: "Designing the course cover…",
  creating_images: "Illustrating lessons…",
  creating_videos: "Generating lesson videos…",
};

// Unified one-click generation dashboard: stage, queue position, provider,
// retry counts, ETA, per-media completion, failed assets + manual retries.
export default function MediaPackDashboard({ centerId, courseId, compact = false }) {
  const navigate = useNavigate();
  const [ms, setMs] = useState(null);
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/courses/${courseId}/media-status`);
      setMs(r.data);
      return r.data;
    } catch { return null; }
  }, [centerId, courseId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 6000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  const retry = async (all) => {
    const ids = all ? null : Object.keys(sel).filter((k) => sel[k]);
    if (!all && !ids.length) { toast.error("Select at least one asset to retry"); return; }
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/courses/${courseId}/media-retry`,
        { task_ids: ids });
      toast.success(`Retrying ${r.data.requeued} asset(s) now`);
      setSel({});
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not retry"); }
    finally { setBusy(false); }
  };

  if (!ms) return null;
  const attention = (ms.failed_assets || []).filter((t) => t.status === "needs_attention");
  const retrying = (ms.failed_assets || []).filter((t) => t.status !== "needs_attention");
  const allDone = ms.stage === "complete" && !ms.failed_assets?.length;

  const tile = (label, Icon, m, color, extra) => (
    <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.04)" }}
      data-testid={`media-dash-${label.toLowerCase()}`}>
      <div className="flex justify-between items-center text-[10px] mb-1">
        <b className="flex items-center gap-1"><Icon size={11} style={{ color }} /> {label}</b>
        <span style={{ color: "var(--text-muted)" }}>
          {m.done}/{m.planned}{m.failed ? ` · ${m.failed} failed` : ""}{extra || ""}
        </span>
      </div>
      <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div className="h-1.5 rounded-full" style={{
          width: `${m.planned ? Math.min(100, (m.done / m.planned) * 100) : 100}%`,
          background: color }} />
      </div>
    </div>
  );

  return (
    <div className="or-surface p-4 mt-3" data-testid="media-pack-dashboard">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {allDone
          ? <CheckCircle2 size={16} style={{ color: "#10E670" }} />
          : attention.length
            ? <AlertTriangle size={16} style={{ color: "#FF6B6B" }} />
            : <Loader2 size={16} className="animate-spin" style={{ color: "#2EE6FF" }} />}
        <b className="text-xs flex-1" data-testid="media-dash-stage">
          {STAGE_TEXT[ms.stage] || ms.current_task || "Working…"}
        </b>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
          style={{ background: "rgba(46,230,255,0.12)", color: "#2EE6FF" }} data-testid="media-dash-overall">
          {ms.overall_pct}% complete
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
        <span data-testid="media-dash-provider">Engine: <b style={{ color: "var(--text-main)" }}>{ms.provider_label}</b></span>
        <span data-testid="media-dash-queue">Queue: <b style={{ color: "var(--text-main)" }}>
          {ms.queue_position ? `#${ms.queue_position} of ${ms.queue_length}` : ms.queue_length ? `${ms.queue_length} active` : "empty"}</b></span>
        <span data-testid="media-dash-retries">Retries so far: <b style={{ color: "var(--text-main)" }}>{ms.retry_count}</b></span>
        <span data-testid="media-dash-eta"><Clock size={10} className="inline mr-0.5" />
          ETA: <b style={{ color: "var(--text-main)" }}>{fmtEta(ms.eta_seconds)}</b></span>
        <span data-testid="media-dash-remaining">Remaining: <b style={{ color: "var(--text-main)" }}>{ms.remaining_assets}</b></span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        {tile("Images", ImageIcon, ms.images, "#2EA0FF")}
        {tile("Videos", Film, ms.videos, "#C26BFF", ms.videos.generating ? ` · ${ms.videos.generating} generating` : "")}
        {tile("Audio", Volume2, ms.audio, "#4DD6C1")}
        {tile("Activities", MousePointerClick, ms.activities, "#10E670")}
      </div>

      {retrying.length > 0 && (
        <div className="rounded-lg p-2 mb-2 text-[10px]" style={{ background: "rgba(46,230,255,0.05)", border: "1px solid rgba(46,230,255,0.15)" }}
          data-testid="media-dash-retrying-list">
          {retrying.map((t) => (
            <div key={t.id} className="flex items-center gap-1.5 py-0.5">
              <Loader2 size={10} className={t.status === "retrying" ? "animate-spin" : ""} style={{ color: "#2EE6FF" }} />
              <b>{t.label}</b>
              <span style={{ color: "var(--text-muted)" }}>
                {t.status === "retrying" ? `retrying now (attempt ${t.attempt + 1}/${t.max_attempts})`
                  : `retry ${t.attempt + 1}/${t.max_attempts} scheduled`}
                {t.error ? ` — last error: ${t.error}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {attention.length > 0 && (
        <div className="rounded-lg p-2.5 mb-2" style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.3)" }}
          data-testid="media-dash-attention-list">
          <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#FF6B6B" }}>
            Needs attention — automatic retries exhausted
          </div>
          {attention.map((t) => (
            <label key={t.id} className="flex items-start gap-2 py-1 cursor-pointer text-[11px]"
              data-testid={`media-dash-failed-${t.id}`}>
              <input type="checkbox" className="accent-[#FF6B6B] mt-0.5" checked={!!sel[t.id]}
                onChange={(e) => setSel({ ...sel, [t.id]: e.target.checked })}
                data-testid={`media-dash-failed-check-${t.id}`} />
              <span>
                <b>{t.label}</b>
                <span className="block text-[10px]" style={{ color: "#FF8A8A" }}>
                  {t.error || "Generation failed"} · {t.attempt} attempts
                </span>
              </span>
            </label>
          ))}
          <div className="flex flex-wrap gap-2 mt-2">
            <button className="or-btn text-[10px]" disabled={busy} onClick={() => retry(false)}
              data-testid="media-dash-retry-selected">
              <RefreshCcw size={11} /> Retry Selected ({Object.values(sel).filter(Boolean).length})
            </button>
            <button className="or-btn text-[10px] font-bold" disabled={busy} onClick={() => retry(true)}
              style={{ background: "#FF6B6B", color: "#0a0a0a" }} data-testid="media-dash-retry-all">
              <RefreshCcw size={11} /> Retry All Failed
            </button>
          </div>
        </div>
      )}

      {allDone && (
        <div className="text-[11px] mb-2" style={{ color: "#10E670" }} data-testid="media-dash-all-done">
          ✓ Every asset generated successfully.
        </div>
      )}

      {!compact && (
        <button className="or-btn text-xs font-bold" style={{ background: "var(--brand-green, #10E670)", color: "#0a0a0a" }}
          onClick={() => navigate(`/responsibility-center/${centerId}/courses/${courseId}/edit`)}
          data-testid="media-dash-open-editor">
          <PencilRuler size={12} /> Open Course in Editor
        </button>
      )}
    </div>
  );
}
