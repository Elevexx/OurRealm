/**
 * SoundAttachmentEditor — Phase 3 compact settings panel for an
 * attached OurRealm Sound (start point, duration/segment, volume for
 * video, fades, loop for images) + segment preview + remove/replace.
 */
import React, { useEffect, useRef, useState } from "react";
import { Music, Play, Square, RefreshCw, Trash2 } from "lucide-react";
import { resolveMediaUrl } from "@/lib/mediaUrl";

export default function SoundAttachmentEditor({ sound, settings, onChange, onRemove, onReplace, mode = "image", testid = "sound-editor" }) {
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const s = settings || {};
  const trackDur = Number(sound?.duration_seconds || 0);

  const set = (key, val) => onChange?.({ ...s, [key]: val });
  const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

  const stopPreview = () => {
    clearTimeout(timerRef.current);
    try { audioRef.current?.pause(); } catch { /* */ }
    setPreviewing(false);
  };
  useEffect(() => () => stopPreview(), []); // eslint-disable-line

  const startPreview = () => {
    const a = audioRef.current;
    if (!a) return;
    stopPreview();
    a.currentTime = Math.min(num(s.start_seconds), Math.max(0, trackDur - 0.5));
    a.volume = Math.min(Math.max(num(s.volume, 1), 0), 1);
    a.play().then(() => {
      setPreviewing(true);
      const dur = num(s.duration_seconds, 0);
      if (dur > 0) timerRef.current = setTimeout(stopPreview, dur * 1000);
    }).catch(() => { /* autoplay blocked */ });
  };

  const Field = ({ label, children }) => (
    <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
      {label}{children}
    </label>
  );

  return (
    <div className="p-2.5 space-y-2 text-xs"
      style={{ border: "1px solid var(--border-col)", borderRadius: "var(--radius)", background: "var(--surface-2)" }}
      data-testid={testid}>
      <div className="flex items-center gap-2">
        <Music size={13} style={{ color: "var(--brand-green, #00FF66)" }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" style={{ color: "var(--text-main)" }} data-testid={`${testid}-title`}>
            {sound?.title || "Sound"}
          </div>
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            @{sound?.creator_username || sound?.owner_username || ""} · {Math.round(trackDur)}s
          </div>
        </div>
        <button type="button" className="or-chip text-[10px]" onClick={onReplace} data-testid={`${testid}-replace`}>
          <RefreshCw size={10} /> Replace
        </button>
        <button type="button" className="or-chip text-[10px]" onClick={() => { stopPreview(); onRemove?.(); }}
          data-testid={`${testid}-remove`}>
          <Trash2 size={10} /> Remove
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Field label="Start (s)">
          <input type="number" min="0" max={Math.max(0, trackDur - 0.5)} step="0.5" className="or-input text-xs py-1"
            value={s.start_seconds ?? 0} onChange={(e) => set("start_seconds", num(e.target.value))}
            data-testid={`${testid}-start`} />
        </Field>
        <Field label={mode === "video" ? "Segment (s)" : "Play for (s)"}>
          <input type="number" min="0.5" step="0.5" className="or-input text-xs py-1"
            placeholder={mode === "video" ? "video length" : "full"}
            value={s.duration_seconds ?? ""} onChange={(e) => set("duration_seconds", e.target.value === "" ? null : num(e.target.value))}
            data-testid={`${testid}-duration`} />
        </Field>
        <Field label="Fade in (s)">
          <input type="number" min="0" max="10" step="0.5" className="or-input text-xs py-1"
            value={s.fade_in ?? 0} onChange={(e) => set("fade_in", num(e.target.value))}
            data-testid={`${testid}-fade-in`} />
        </Field>
        <Field label="Fade out (s)">
          <input type="number" min="0" max="10" step="0.5" className="or-input text-xs py-1"
            value={s.fade_out ?? 0} onChange={(e) => set("fade_out", num(e.target.value))}
            data-testid={`${testid}-fade-out`} />
        </Field>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {mode === "video" && (
          <label className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
            Volume
            <input type="range" min="0" max="2" step="0.05" value={s.volume ?? 1}
              onChange={(e) => set("volume", num(e.target.value, 1))} style={{ width: 90 }}
              data-testid={`${testid}-volume`} />
            <span style={{ minWidth: 28 }}>{Math.round((s.volume ?? 1) * 100)}%</span>
          </label>
        )}
        {mode === "image" && (
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: "var(--text-muted)" }}>
            <input type="checkbox" checked={!!s.loop} onChange={(e) => set("loop", e.target.checked)}
              data-testid={`${testid}-loop`} /> Loop
          </label>
        )}
        <button type="button" className="or-chip text-[10px] ml-auto"
          onClick={previewing ? stopPreview : startPreview} data-testid={`${testid}-preview`}>
          {previewing ? <><Square size={10} /> Stop</> : <><Play size={10} /> Preview segment</>}
        </button>
      </div>
      <audio ref={audioRef} src={resolveMediaUrl(sound?.file_url)} preload="metadata"
        onEnded={stopPreview} style={{ display: "none" }} />
    </div>
  );
}
