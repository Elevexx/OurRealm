// Reusable Sound Upload modal. Mirrors ImageUploadPicker's UX.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload, X, Loader2, Music as MusicIcon, AlertCircle, Image as ImageIcon } from "lucide-react";
import apiClient from "@/api/client";
import ImageUploadPicker from "@/components/ImageUploadPicker";
import { GENRES } from "@/data/musicGenres";

const MOODS  = ["Energetic", "Chill", "Dark", "Uplifting", "Focus", "Party"];

const ACCEPT = "audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/x-flac,audio/webm,.mp3,.m4a,.aac,.wav,.ogg,.flac,.webm";
const MAX_MB = 50;       // matches server cap (services/upload_limits)

export default function SoundUploadPicker({ open, onClose, onUploaded, defaultCategory = "Music", deferPost = false, testid = "sound-picker" }) {
  const [busy, setBusy] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  // Shared classification list — same source as the Sounds page composer.
  const [classifications, setClassifications] = useState([
    { id: "music", name: "Music" }, { id: "podcasts", name: "Podcasts" }, { id: "fx", name: "FX" },
  ]);
  useEffect(() => {
    if (!open) return;
    apiClient.get("/sounds/classifications").then((r) => {
      const rows = (r.data?.classifications || []).filter((c) => ["music", "podcasts", "fx"].includes(c.id));
      if (rows.length) setClassifications(rows);
    }).catch(() => {});
  }, [open]);
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [quota, setQuota] = useState(null); // {used, remaining, per_day}
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/upload-limits/me");
        if (!cancelled) setQuota(data?.limits?.audio || null);
      } catch {/* non-fatal */}
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;
  const close = () => { if (!busy) { reset(); onClose?.(); } };
  const reset = () => {
    setFile(null); setTitle(""); setCategory(defaultCategory);
    setGenre(""); setMood(""); setCoverUrl(""); setErr("");
    setRightsConfirmed(false);
  };

  const onPickFile = (f) => {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setErr(`File is too large (max ${MAX_MB} MB).`); return;
    }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 140));
    setErr("");
  };

  const submit = async () => {
    if (!file)   { setErr("Pick an audio file to upload."); return; }
    if (!title.trim()) { setErr("Title is required."); return; }
    if (!["Music", "Podcasts", "FX"].includes(category)) {
      setErr("AI category cannot accept uploads yet."); return;
    }
    if (!rightsConfirmed) {
      setErr("You must confirm you have the rights to upload this audio.");
      return;
    }
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title.trim());
      fd.append("category", category);
      const LEGACY_TO_ID = { Music: "music", Podcasts: "podcasts", FX: "fx" };
      fd.append("classification_id", LEGACY_TO_ID[category] || "other");
      if (deferPost) fd.append("defer_post", "true");
      fd.append("genre", genre || "");
      fd.append("mood", mood || "");
      if (coverUrl) fd.append("cover_url", coverUrl);
      // PART 5 — copyright rights confirmation.
      fd.append("rights_confirmed", "true");
      fd.append("app_version", process.env.REACT_APP_BUILD_VERSION || "preview");
      const { data } = await apiClient.post("/sounds/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      apiClient.get("/upload-limits/me").then((r) => setQuota(r?.data?.limits?.audio || null)).catch(() => {});
      onUploaded?.(data.track);
      reset();
      onClose?.();
    } catch (e) {
      const code = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (code === 413) setErr(detail || "Audio too large — max 50 MB per upload.");
      else if (code === 429) setErr(detail || "Daily audio upload limit reached. Try again later.");
      else setErr(detail || "Upload failed.");
    } finally { setBusy(false); }
  };

  return createPortal((
    <div
      className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center px-2 sm:px-4 py-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={close}
      data-testid={`${testid}-overlay`}
    >
      <div
        className="or-surface w-full sm:max-w-md max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
        role="dialog" aria-modal="true"
      >
        <div className="flex items-center gap-3 p-3 sm:p-4" style={{ borderBottom: "1px solid var(--border-col)" }}>
          <MusicIcon size={16} style={{ color: "var(--primary)" }} />
          <div className="font-semibold flex-1" style={{ color: "var(--text-main)" }}>Upload a Sound</div>
          <button onClick={close} className="starbar-icon" style={{ width: 32, height: 32 }} aria-label="Close" data-testid={`${testid}-close`}>
            <X size={14} />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
          <input
            ref={fileRef} type="file" accept={ACCEPT}
            onChange={(e) => onPickFile(e.target.files?.[0])}
            style={{ display: "none" }}
            data-testid={`${testid}-file-input`}
          />
          <button
            type="button" onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="or-btn w-full"
            data-testid={`${testid}-pick-file`}
          >
            <Upload size={14} /> {file ? `Replace audio (${file.name.slice(0, 32)}${file.name.length > 32 ? "…" : ""})` : "Choose audio file"}
          </button>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            MP3, M4A/AAC, WAV, OGG, FLAC, or WebM. Up to 10 minutes • Max {MAX_MB} MB. Audio is automatically optimized and streamed from our CDN for fast playback.
          </p>
          {quota && (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }} data-testid={`${testid}-quota`}>
              {quota.remaining === "unlimited"
                ? "Founder account — unlimited uploads."
                : `${quota.remaining} of ${quota.per_day} sound uploads remaining today.`}
            </p>
          )}

          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Title</label>
            <input
              type="text" value={title} maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Track title"
              className="or-input w-full"
              data-testid={`${testid}-title`}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Category</label>
              <select
                className="or-input w-full"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid={`${testid}-category`}
              >
                {classifications.map((c) => {
                  const legacy = { music: "Music", podcasts: "Podcasts", fx: "FX" }[c.id];
                  return <option key={c.id} value={legacy}>{c.name}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Genre</label>
              <select
                className="or-input w-full"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                data-testid={`${testid}-genre`}
              >
                <option value="">—</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Mood</label>
              <select
                className="or-input w-full"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                data-testid={`${testid}-mood`}
              >
                <option value="">—</option>
                {MOODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Optional cover */}
          <button
            type="button"
            onClick={() => setShowCoverPicker(true)}
            className="or-btn or-btn-ghost w-full"
            data-testid={`${testid}-cover`}
          >
            <ImageIcon size={14} /> {coverUrl ? "Replace cover art (optional)" : "Add cover art (optional)"}
          </button>
          {coverUrl && (
            <div className="flex items-center gap-3">
              <img src={coverUrl} alt="" style={{ width: 64, height: 64, borderRadius: "var(--radius)", objectFit: "cover" }} />
              <button
                type="button" onClick={() => setCoverUrl("")}
                className="text-xs underline"
                style={{ color: "var(--text-muted)" }}
                data-testid={`${testid}-cover-remove`}
              >Remove</button>
            </div>
          )}

          {/* PART 5 — copyright rights confirmation. Mandatory; the
              upload button stays disabled until the user checks this. */}
          <label
            className="flex items-start gap-2 px-2 py-2 text-xs cursor-pointer"
            data-testid={`${testid}-rights-row`}
            style={{ color: "var(--text-main)" }}
          >
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(e) => setRightsConfirmed(e.target.checked)}
              data-testid={`${testid}-rights-checkbox`}
              style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--primary)" }}
            />
            <span className="leading-snug">
              I confirm that I own the rights to this audio or have permission to upload and share it on OurRealm.
            </span>
          </label>
          <div
            className="text-[11px] leading-snug px-2"
            data-testid={`${testid}-rights-note`}
            style={{ color: "var(--text-muted)" }}
          >
            Do not upload copyrighted audio you do not own or have permission to use. Repeated violations may result in content removal or account restrictions.
          </div>

          {err && (
            <div className="flex items-start gap-2 text-xs px-3 py-2"
              style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}
              data-testid={`${testid}-error`}
            >
              <AlertCircle size={14} /> {err}
            </div>
          )}
        </div>

        <div className="p-3 flex gap-2 justify-end" style={{ borderTop: "1px solid var(--border-col)" }}>
          <button className="or-btn or-btn-ghost" onClick={close} data-testid={`${testid}-cancel`} disabled={busy}>Cancel</button>
          <button
            className="or-btn"
            disabled={busy || !file || !title.trim() || !rightsConfirmed}
            onClick={submit}
            data-testid={`${testid}-submit`}
          >
            {busy ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload</>}
          </button>
        </div>

        <ImageUploadPicker
          open={showCoverPicker}
          onClose={() => setShowCoverPicker(false)}
          onPicked={({ url }) => { setCoverUrl(url); setShowCoverPicker(false); }}
          title="Add cover art"
          testid={`${testid}-cover-picker`}
        />
      </div>
    </div>
  ), document.body);
}
