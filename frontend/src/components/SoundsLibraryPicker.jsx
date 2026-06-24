/**
 * SoundsLibraryPicker — modal that lists the founder's uploaded
 * sounds from /api/sounds/me/tracks and lets them pick one (single
 * mode) or several (multi mode) to pin into a widget. Sound IDs are
 * what the widget saves — NOT raw R2 URLs — so renames / covers /
 * deletes propagate naturally and the renderer always resolves
 * current data via /api/sounds/resolve.
 *
 * Phase 3.3 — wired into the WidgetBuilder Data tab's MediaListInput
 * whenever the field's type is `sound`.
 */
import React, { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";

export default function SoundsLibraryPicker({ open, onClose, onPick, multi = false, initialSelected = [] }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(initialSelected || []);
  const [previewId, setPreviewId] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true); setError(null);
    setSelected(initialSelected || []);
    setPreviewId(null);
    (async () => {
      try {
        const { data } = await apiClient.get("/sounds/me/tracks?limit=100");
        if (!cancelled) setTracks(data?.tracks || []);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || "Could not load your sounds.");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const stopPreview = () => {
    try { audioRef.current?.pause(); } catch { /* */ }
    setPreviewId(null);
  };

  const togglePreview = (track) => {
    if (previewId === track.id) {
      stopPreview();
      return;
    }
    setPreviewId(track.id);
  };

  const toggleSelect = (track) => {
    if (multi) {
      setSelected((s) => (s.includes(track.id) ? s.filter((x) => x !== track.id) : [...s, track.id]));
    } else {
      setSelected([track.id]);
    }
  };

  const confirm = () => {
    stopPreview();
    onPick(multi ? selected : (selected[0] || null));
  };

  const close = () => {
    stopPreview();
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center px-3"
      style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }}
      onClick={close}
      data-testid="sounds-library-picker"
    >
      <div
        className="or-surface w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border-col)" }}>
          <div>
            <h2 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
              Select from your Sounds Library
            </h2>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {multi ? `Pick one or more sounds · ${selected.length} selected` : "Pick a single sound"}
            </div>
          </div>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={close} data-testid="sounds-picker-close">
            <Icons.X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center p-8"><Icons.Loader2 className="animate-spin inline" /></div>
          ) : error ? (
            <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(255,90,107,0.14)", color: "#FF8080" }}>
              {error}
            </div>
          ) : tracks.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-1.5" data-testid="sounds-library-list">
              {tracks.map((t) => (
                <SoundRow
                  key={t.id}
                  track={t}
                  selected={selected.includes(t.id)}
                  multi={multi}
                  playing={previewId === t.id}
                  onToggleSelect={() => toggleSelect(t)}
                  onTogglePreview={() => togglePreview(t)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t p-3 flex items-center justify-between gap-2" style={{ borderColor: "var(--border-col)" }}>
          <a
            href="/sounds"
            className="text-[11px] hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            Manage uploads on /sounds ↗
          </a>
          <div className="flex gap-2">
            <button className="or-btn or-btn-ghost text-sm" onClick={close}>Cancel</button>
            <button
              className="or-btn or-btn-primary text-sm"
              onClick={confirm}
              disabled={selected.length === 0}
              data-testid="sounds-picker-confirm"
            >
              <Icons.Check size={13} /> {multi ? `Use ${selected.length} sound${selected.length === 1 ? "" : "s"}` : "Use this sound"}
            </button>
          </div>
        </div>

        {/* Hidden preview audio — module-level singleton so only one
            sound plays at a time within the modal. */}
        {previewId && (
          <PreviewAudio
            audioRef={audioRef}
            url={tracks.find((t) => t.id === previewId)?.file_url}
            onEnded={stopPreview}
          />
        )}
      </div>
    </div>
  );
}

function SoundRow({ track, selected, multi, playing, onToggleSelect, onTogglePreview }) {
  const cover = track.cover_url ? resolveMediaUrl(track.cover_url) : null;
  return (
    <div
      className="or-surface p-2 flex items-center gap-2"
      style={{
        background: "var(--surface-2)",
        outline: selected ? "2px solid var(--primary)" : "none",
      }}
      data-testid={`sound-row-${track.id}`}
    >
      <button
        onClick={onTogglePreview}
        className="rounded shrink-0 relative overflow-hidden"
        style={{ width: 44, height: 44, background: "var(--surface-1)" }}
        title={playing ? "Stop preview" : "Preview"}
        data-testid={`sound-preview-${track.id}`}
      >
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
            <Icons.Music size={18} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.42)" }}>
          {playing ? <Icons.Pause size={14} style={{ color: "#fff" }} /> : <Icons.Play size={14} style={{ color: "#fff" }} />}
        </div>
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>
          {track.title || "Untitled"}
        </div>
        <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
          {track.category || ""}{track.genre ? ` · ${track.genre}` : ""}{track.mood ? ` · ${track.mood}` : ""}
        </div>
      </div>
      <button
        onClick={onToggleSelect}
        className="px-2.5 py-1 rounded text-xs transition-colors"
        style={{
          background: selected ? "var(--primary)" : "var(--surface-1)",
          color: selected ? "#000" : "var(--text-muted)",
          fontWeight: selected ? 700 : 500,
        }}
        data-testid={`sound-select-${track.id}`}
      >
        {selected ? (multi ? <><Icons.Check size={11} className="inline" /> Selected</> : "Selected") : (multi ? "Add" : "Pick")}
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="or-surface p-6 text-center" style={{ background: "var(--surface-2)" }} data-testid="sounds-library-empty">
      <Icons.Music2 size={32} className="mx-auto mb-2" style={{ color: "var(--text-muted)" }} />
      <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-main)" }}>No sounds uploaded yet</div>
      <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
        Upload audio from the Sounds page to pin them into widgets.
      </div>
      <a
        href="/sounds"
        className="or-btn or-btn-primary text-xs inline-flex"
      >
        <Icons.Upload size={11} /> Open /sounds
      </a>
    </div>
  );
}

function PreviewAudio({ audioRef, url, onEnded }) {
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    a.play().catch(() => { /* autoplay blocked — user clicked anyway */ });
    a.addEventListener("ended", onEnded);
    return () => { a.removeEventListener("ended", onEnded); };
  }, [url, audioRef, onEnded]);
  return (
    <audio
      ref={audioRef}
      src={resolveMediaUrl(url)}
      preload="metadata"
      style={{ display: "none" }}
      data-testid="sounds-picker-audio"
    />
  );
}
