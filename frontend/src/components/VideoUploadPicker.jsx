/**
 * VideoUploadPicker — direct device-video upload for the Feed composer.
 *
 * Mirrors ImageUploadPicker's UX: simple inline button that opens the
 * device file picker, shows a thumbnail preview + upload progress, and
 * surfaces backend 413/429/400 errors with friendly copy.
 *
 * Accepts MP4 / MOV / WebM. Server-enforced caps: 100 MB and 60 s.
 * Reuses the existing `/api/videos/upload` endpoint and auth flow.
 *
 * Usage:
 *   <VideoUploadPicker
 *     videoUrl={composeMediaUrl}
 *     onChange={(url) => setComposeMediaUrl(url)}
 *   />
 */
import React, { useEffect, useRef, useState } from "react";
import { Upload, X, Loader2, Video as VideoIcon, AlertCircle } from "lucide-react";
import apiClient from "@/api/client";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
const ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";
const MAX_MB = 100;        // server hard ceiling
const MAX_SECONDS = 60;    // server hard ceiling

function absUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${BACKEND}${u}`;
  return u;
}

// Measure HTMLVideoElement.duration for a freshly-picked file before upload.
function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : null;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  });
}

export default function VideoUploadPicker({ videoUrl, onChange, testid = "video-picker" }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState(0);
  const [localPreview, setLocalPreview] = useState(null);
  const [quota, setQuota] = useState(null);
  const inputRef = useRef(null);

  // Best-effort quota fetch so the user sees "N left today" before they pick.
  useEffect(() => {
    let cancelled = false;
    apiClient.get("/upload-limits/me")
      .then(({ data }) => { if (!cancelled) setQuota(data?.limits?.video || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [videoUrl]);

  const onFileChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(""); setProgress(0);

    // Client-side guardrails — friendly messages before we even try.
    if (f.size > MAX_MB * 1024 * 1024) {
      setErr(`Video too large — max ${MAX_MB} MB.`);
      return;
    }
    if (!/\.(mp4|mov|webm)$/i.test(f.name) && !/^video\/(mp4|quicktime|webm)$/i.test(f.type)) {
      setErr("Unsupported video format. Use MP4, MOV, or WebM.");
      return;
    }
    const duration = await probeDuration(f);
    if (duration && duration > MAX_SECONDS) {
      setErr(`Video too long — max ${MAX_SECONDS} seconds.`);
      return;
    }

    // Local preview (object URL) so the user sees what they're about to post.
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(URL.createObjectURL(f));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (duration != null) fd.append("duration", String(duration));
      const { data } = await apiClient.post("/videos/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      const next = data?.url || data?.video?.url;
      if (!next) throw new Error("Upload returned no URL");
      // Server URL is now authoritative — drop the local blob so the preview
      // <video> swaps to the rehosted file.
      if (localPreview) URL.revokeObjectURL(localPreview);
      setLocalPreview(null);
      setProgress(100);
      // Persist as a RELATIVE path (e.g. `/api/videos/<id>.mp4`). The
      // browser resolves it against the current document origin at render
      // time, so the same post document works in BOTH preview and
      // production — even when the deployed REACT_APP_BACKEND_URL differs
      // from the upload-time one. Absolutising at upload was the cause of
      // "video failed to load after refresh" on ourrealm.social.
      const stripped = next.startsWith("http")
        ? next.replace(/^https?:\/\/[^/]+/, "")
        : next;
      onChange?.(stripped);
      // Refresh quota so the visible "N left today" decrements live.
      apiClient.get("/upload-limits/me")
        .then(({ data: q }) => setQuota(q?.limits?.video || null))
        .catch(() => {});
    } catch (e) {
      const code = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (code === 413) setErr(detail || `Video too large — max ${MAX_MB} MB.`);
      else if (code === 429) setErr(detail || "Daily video upload limit reached.");
      else if (code === 400) setErr(detail || "That file isn't a supported video.");
      else setErr(detail || "Upload failed.");
    } finally {
      setBusy(false);
      // Reset the input so picking the SAME file again still fires onChange.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clear = () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    setProgress(0);
    setErr("");
    onChange?.("");
  };

  const showUploadedPreview = videoUrl && !localPreview;
  const showLocalPreview = !!localPreview;

  return (
    <div className="mt-2 space-y-2" data-testid={testid}>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onFileChange}
          className="hidden"
          data-testid={`${testid}-file-input`}
        />
        <button
          type="button"
          className="or-chip"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          data-testid={`${testid}-pick`}
          title="Upload a video from your device"
        >
          {busy
            ? <><Loader2 size={12} className="animate-spin" /> Uploading…</>
            : <><Upload size={12} /> Upload Video</>}
        </button>
        {(showUploadedPreview || showLocalPreview) && (
          <button
            type="button"
            className="or-chip"
            onClick={clear}
            data-testid={`${testid}-clear`}
            title="Remove this video"
          >
            <X size={12} /> Clear
          </button>
        )}
        {quota && (
          <span
            className="text-[11px] ml-auto"
            style={{ color: "var(--text-muted)" }}
            data-testid={`${testid}-quota`}
          >
            {quota.remaining === "unlimited"
              ? "Founder — unlimited uploads."
              : `${quota.remaining} of ${quota.per_day} video uploads left today.`}
          </span>
        )}
      </div>

      {/* Upload progress bar — visible only while the request is in flight. */}
      {busy && (
        <div
          className="h-1.5 w-full overflow-hidden"
          style={{ background: "var(--surface-2)", borderRadius: 999 }}
          data-testid={`${testid}-progress`}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: "var(--primary)",
              transition: "width 120ms linear",
            }}
          />
        </div>
      )}

      {/* Preview — local object URL while uploading, server URL once saved. */}
      {(showLocalPreview || showUploadedPreview) && (
        <div className="mt-1" data-testid={`${testid}-preview`}>
          <video
            src={showLocalPreview ? localPreview : absUrl(videoUrl)}
            controls
            muted
            playsInline
            className="rounded w-full"
            style={{ maxHeight: 220, background: "#000" }}
          />
        </div>
      )}

      {err && (
        <div
          className="flex items-start gap-2 text-xs px-3 py-2"
          style={{
            background: "rgba(255,80,80,0.1)",
            border: "1px solid rgba(255,80,80,0.4)",
            color: "#ff8080",
            borderRadius: "var(--radius)",
          }}
          data-testid={`${testid}-error`}
        >
          <AlertCircle size={13} className="shrink-0 mt-px" /> {err}
        </div>
      )}

      <p className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
        <VideoIcon size={11} /> MP4, MOV, or WebM · max {MAX_MB} MB · max {MAX_SECONDS}s.
      </p>
    </div>
  );
}
