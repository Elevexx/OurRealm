/**
 * PostSoundBadge — attribution chip on posts that carry a Phase 3
 * Sound attachment. Image posts get client-side segment playback
 * (start / duration / loop honored); video posts render attribution
 * only (the Sound is baked into the processed derivative).
 */
import React, { useEffect, useRef, useState } from "react";
import { Music, Play, Pause } from "lucide-react";
import { resolveMediaUrl } from "@/lib/mediaUrl";

export default function PostSoundBadge({ attachment, mode = "image", testid = "post-sound-badge" }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    try { audioRef.current?.pause(); } catch { /* */ }
  }, []);
  if (!attachment?.track_id) return null;
  const a = attachment;

  const stop = () => {
    clearTimeout(timerRef.current);
    try { audioRef.current?.pause(); } catch { /* */ }
    setPlaying(false);
  };

  const armSegmentTimer = (el) => {
    const dur = Number(a.duration_seconds || 0);
    if (dur > 0) {
      timerRef.current = setTimeout(() => {
        if (a.loop && el) { el.currentTime = Number(a.start_seconds || 0); armSegmentTimer(el); }
        else stop();
      }, dur * 1000);
    }
  };

  const toggle = () => {
    if (mode !== "image") return;
    const el = audioRef.current;
    if (!el) return;
    if (playing) { stop(); return; }
    el.currentTime = Number(a.start_seconds || 0);
    el.volume = Math.min(Math.max(Number(a.volume ?? 1), 0), 1);
    el.loop = false;
    el.play().then(() => { setPlaying(true); armSegmentTimer(el); }).catch(() => { /* */ });
  };

  return (
    <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px]"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", color: "var(--text-muted)" }}
      data-testid={testid}>
      {mode === "image" ? (
        <button type="button" onClick={toggle} className="inline-flex items-center justify-center rounded-full"
          style={{ width: 18, height: 18, background: "var(--primary)", color: "#000" }}
          title={playing ? "Pause Sound" : "Play Sound"} data-testid={`${testid}-toggle`}>
          {playing ? <Pause size={9} /> : <Play size={9} />}
        </button>
      ) : (
        <Music size={11} style={{ color: "var(--brand-green, #00FF66)" }} />
      )}
      <span className="truncate" style={{ maxWidth: 220 }}>
        ♪ {a.title || "Sound"}{a.owner_username ? <> — <b>@{a.owner_username}</b></> : null}
      </span>
      {mode === "image" && (
        <audio ref={audioRef} src={resolveMediaUrl(a.file_url)} preload="none"
          onEnded={() => { if (a.loop) toggle(); else stop(); }} style={{ display: "none" }} />
      )}
    </div>
  );
}
