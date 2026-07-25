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
import { Upload, X, Loader2, Video as VideoIcon, AlertCircle, Music } from "lucide-react";
import apiClient from "@/api/client";
import SoundAttachPicker from "@/components/SoundAttachPicker";
import SoundAttachmentEditor from "@/components/SoundAttachmentEditor";

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

export default function VideoUploadPicker({ videoUrl, onChange, onSoundAttachment, testid = "video-picker" }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState(0);
  const [localPreview, setLocalPreview] = useState(null);
  const [quota, setQuota] = useState(null);
  const [pending, setPending] = useState(null);
  const [audioChoice, setAudioChoice] = useState("mute");
  const [rightsChecked, setRightsChecked] = useState(false);
  const [audioNote, setAudioNote] = useState("");
  // Phase 3 — Replace with an OurRealm Sound.
  const [soundPickOpen, setSoundPickOpen] = useState(false);
  const [attachedSound, setAttachedSound] = useState(null);
  const [soundSettings, setSoundSettings] = useState({ start_seconds: 0, duration_seconds: null, volume: 1, fade_in: 0, fade_out: 0 });
  const [processingSound, setProcessingSound] = useState(false);
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
    setErr(""); setProgress(0); setAudioNote("");

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

    // Stage the file — AUDIO RIGHTS must be answered before upload.
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(URL.createObjectURL(f));
    setPending({ file: f, duration, sessionId: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`) });
    setAudioChoice("mute");
    setRightsChecked(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const doUpload = async () => {
    if (!pending || busy) return;
    if (audioChoice === "replace" && !attachedSound) {
      setErr("Choose an OurRealm Sound first, or switch to Publish Muted.");
      return;
    }
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", pending.file);
      if (pending.duration != null) fd.append("duration", String(pending.duration));
      fd.append("audio_choice", audioChoice);
      fd.append("rights_confirmed", String(audioChoice === "original" && rightsChecked));
      fd.append("upload_session_id", pending.sessionId);
      const { data } = await apiClient.post("/videos/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      let next = data?.url || data?.video?.url;
      if (!next) throw new Error("Upload returned no URL");
      // Phase 3 — replace flow: render the processed derivative with the
      // attached Sound. The server revalidates owner reuse permission.
      if (audioChoice === "replace" && attachedSound && data?.video?.id) {
        setProcessingSound(true);
        try {
          const { data: rep } = await apiClient.post(`/videos/${data.video.id}/replace-audio`, {
            track_id: attachedSound.id,
            start_seconds: soundSettings.start_seconds || 0,
            duration_seconds: soundSettings.duration_seconds || null,
            volume: soundSettings.volume ?? 1,
            fade_in: soundSettings.fade_in || 0,
            fade_out: soundSettings.fade_out || 0,
          });
          next = rep?.url || next;
          setAudioNote(`Published with "${attachedSound.title}" replacing the original audio.`);
          onSoundAttachment?.({
            track_id: attachedSound.id,
            start_seconds: soundSettings.start_seconds || 0,
            duration_seconds: soundSettings.duration_seconds || null,
            volume: soundSettings.volume ?? 1,
            fade_in: soundSettings.fade_in || 0,
            fade_out: soundSettings.fade_out || 0,
          });
        } finally { setProcessingSound(false); }
      }
      if (localPreview) URL.revokeObjectURL(localPreview);
      setLocalPreview(null);
      setPending(null);
      setProgress(100);
      if (audioChoice !== "replace") {
        onSoundAttachment?.(null);
        if (data?.audio?.audio_detected && !data?.audio?.audio_published) {
          setAudioNote("Published with the original audio muted.");
        } else if (data?.audio?.audio_published) {
          setAudioNote("Published with the original audio (rights confirmed).");
        }
      }
      // Persist as a RELATIVE path (works in both preview and production).
      const stripped = next.startsWith("http")
        ? next.replace(/^https?:\/\/[^/]+/, "")
        : next;
      onChange?.(stripped);
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
    }
  };

  const clear = () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    setPending(null);
    setProgress(0);
    setErr("");
    setAudioNote("");
    setAttachedSound(null);
    setAudioChoice("mute");
    onSoundAttachment?.(null);
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

      {/* AUDIO RIGHTS — required before the staged file uploads. */}
      {pending && (
        <div
          className="space-y-2 p-3 text-xs"
          style={{ border: "1px solid var(--border-col)", borderRadius: "var(--radius)" }}
          data-testid={`${testid}-audio-rights`}
        >
          <div className="font-semibold uppercase tracking-wider text-[11px]">Audio Rights</div>
          <p style={{ color: "var(--text-muted)" }}>
            This video contains audio. Its original audio will remain muted unless you
            confirm that you own the audio or have permission to use it on OurRealm.
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name={`${testid}-audio`} checked={audioChoice === "mute"}
              onChange={() => { setAudioChoice("mute"); setRightsChecked(false); }}
              data-testid={`${testid}-audio-mute`} className="mt-0.5" />
            <span><b>🔇 Publish Muted</b><br />
              <span style={{ color: "var(--text-muted)" }}>Remove or mute this video's original audio.</span></span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name={`${testid}-audio`} checked={audioChoice === "replace"}
              onChange={() => { setAudioChoice("replace"); setRightsChecked(false); if (!attachedSound) setSoundPickOpen(true); }}
              data-testid={`${testid}-audio-replace`} className="mt-0.5" />
            <span><b>🎵 Replace with an OurRealm Sound</b><br />
              <span style={{ color: "var(--text-muted)" }}>Remove the original audio and add a Sound whose owner enabled video reuse.</span></span>
          </label>
          {audioChoice === "replace" && (
            <div className="pl-5 space-y-2">
              {attachedSound ? (
                <SoundAttachmentEditor
                  sound={attachedSound}
                  settings={soundSettings}
                  onChange={setSoundSettings}
                  onRemove={() => { setAttachedSound(null); setAudioChoice("mute"); }}
                  onReplace={() => setSoundPickOpen(true)}
                  mode="video"
                  testid={`${testid}-sound-editor`}
                />
              ) : (
                <button type="button" className="or-chip" onClick={() => setSoundPickOpen(true)}
                  data-testid={`${testid}-choose-sound`}>
                  <Music size={12} /> Choose a Sound
                </button>
              )}
            </div>
          )}
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name={`${testid}-audio`} checked={audioChoice === "original"}
              onChange={() => setAudioChoice("original")}
              data-testid={`${testid}-audio-original`} className="mt-0.5" />
            <span><b>🎤 Keep Original Audio</b><br />
              <span style={{ color: "var(--text-muted)" }}>Only choose this if you own the audio or have permission to use it on OurRealm.</span></span>
          </label>
          {audioChoice === "original" && (
            <label className="flex items-start gap-2 cursor-pointer pl-5">
              <input type="checkbox" checked={rightsChecked}
                onChange={(e) => setRightsChecked(e.target.checked)}
                data-testid={`${testid}-rights-checkbox`} className="mt-0.5" />
              <span>I confirm that I own this audio or have the necessary rights and
                permission to upload and share it on OurRealm.</span>
            </label>
          )}
          {audioChoice === "original" && !rightsChecked && (
            <p style={{ color: "#ffb84d" }} data-testid={`${testid}-rights-warning`}>
              Without the confirmation above, the video will publish with its original audio muted.
            </p>
          )}
          <button
            type="button"
            className="or-btn w-full"
            onClick={doUpload}
            disabled={busy || (audioChoice === "replace" && !attachedSound)}
            data-testid={`${testid}-confirm-upload`}
          >
            {busy
              ? <><Loader2 size={13} className="animate-spin" /> {processingSound ? "Adding Sound…" : "Uploading…"}</>
              : "Upload video"}
          </button>
        </div>
      )}

      <SoundAttachPicker
        open={soundPickOpen}
        onClose={() => setSoundPickOpen(false)}
        useType="video_posts"
        onSelect={(s) => { setAttachedSound(s); setSoundPickOpen(false); setAudioChoice("replace"); }}
        testid={`${testid}-sound-picker`}
      />

      {audioNote && (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }} data-testid={`${testid}-audio-note`}>
          {audioNote}
        </p>
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
