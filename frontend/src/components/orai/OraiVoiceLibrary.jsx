import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Play, Square, Star, Check, Loader2, AudioLines } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { oraiVoice } from "@/lib/oraiVoiceEngine";

const Slider = ({ label, value, min, max, step, format, onChange, testid }) => (
  <div>
    <div className="flex justify-between text-[10px] mb-1">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <b>{format(value)}</b>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-[#C26BFF]" data-testid={testid} />
  </div>
);

// ORAi Voice Library — native OurRealm voices. Preview, favorite, set
// default, and tune speed / pitch / volume. Prefs persist per user.
export const OraiVoiceLibrary = ({ open, onClose, accent = "#C26BFF" }) => {
  const [voices, setVoices] = useState([]);
  const [prefs, setPrefs] = useState(null);
  const [playing, setPlaying] = useState(null); // voice_id being previewed
  const [loadingPreview, setLoadingPreview] = useState(null);
  const audioRef = useRef(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    apiClient.get("/orai/voice/library")
      .then((r) => { setVoices(r.data.voices || []); setPrefs(r.data.prefs); })
      .catch(() => toast.error("Could not load the ORAi Voice Library"));
    return () => stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stopPreview = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlaying(null);
  };

  const preview = async (vid) => {
    if (playing === vid) { stopPreview(); return; }
    stopPreview();
    setLoadingPreview(vid);
    try {
      const r = await apiClient.get(`/orai/voice/preview/${vid}`, { responseType: "blob", timeout: 60000 });
      const url = URL.createObjectURL(r.data);
      const a = new Audio(url);
      a.volume = prefs?.volume ?? 0.9;
      a.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
      audioRef.current = a;
      setPlaying(vid);
      await a.play();
    } catch {
      toast.error("Preview unavailable right now");
      setPlaying(null);
    } finally { setLoadingPreview(null); }
  };

  const update = (patch, { debounce = false } = {}) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (debounce) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => oraiVoice.savePrefs(patch), 400);
    } else {
      oraiVoice.savePrefs(patch);
    }
  };

  const toggleFav = (vid) => {
    const favs = prefs.favorites || [];
    update({ favorites: favs.includes(vid) ? favs.filter((f) => f !== vid) : [...favs, vid] });
  };

  if (!open || !prefs) return null;
  const sorted = [...voices].sort((a, b) =>
    (prefs.favorites?.includes(b.id) ? 1 : 0) - (prefs.favorites?.includes(a.id) ? 1 : 0));

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={onClose} data-testid="orai-voice-library-overlay">
      <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl rcx-scope"
        style={{ background: "color-mix(in srgb, var(--bgc) 88%, #060D18)", border: `1px solid ${accent}44` }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ORAi Voice Library"
        data-testid="orai-voice-library">
        <div className="flex items-center gap-2 p-4 sticky top-0 z-10"
          style={{ background: "inherit", borderBottom: `1px solid ${accent}33` }}>
          <span className="rounded-lg p-1.5" style={{ background: `${accent}22`, color: accent }}><AudioLines size={16} /></span>
          <div className="flex-1">
            <div className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>ORAi Voice Library</div>
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Choose how ORAi sounds — everywhere on OurRealm</div>
          </div>
          <button className="or-btn or-btn-ghost p-1.5" onClick={onClose} aria-label="Close" data-testid="orai-voice-library-close"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4">
          {sorted.map((v) => {
            const isDefault = prefs.voice_id === v.id;
            const isFav = prefs.favorites?.includes(v.id);
            return (
              <div key={v.id} className="rounded-xl p-3 transition-colors"
                style={{ background: isDefault ? `${v.color}12` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isDefault ? v.color : "rgba(255,255,255,0.09)"}` }}
                data-testid={`orai-voice-card-${v.id}`}>
                <div className="flex items-center gap-2 mb-1">
                  <button onClick={() => preview(v.id)}
                    className="rounded-full p-2 shrink-0 transition-transform hover:scale-105"
                    style={{ background: `${v.color}22`, color: v.color, border: `1px solid ${v.color}66` }}
                    title="Preview" aria-label={`Preview ${v.name}`} data-testid={`orai-voice-preview-${v.id}`}>
                    {loadingPreview === v.id ? <Loader2 size={13} className="animate-spin" />
                      : playing === v.id ? <Square size={13} /> : <Play size={13} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold" style={{ color: v.color }}>{v.name}</div>
                    <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{v.tagline}</div>
                  </div>
                  <button onClick={() => toggleFav(v.id)} title="Favorite" aria-label={`Favorite ${v.name}`}
                    data-testid={`orai-voice-fav-${v.id}`}>
                    <Star size={14} fill={isFav ? "#F4A73B" : "none"} style={{ color: isFav ? "#F4A73B" : "var(--text-muted)" }} />
                  </button>
                </div>
                <div className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>{v.personality}</div>
                <button onClick={() => update({ voice_id: v.id })} disabled={isDefault}
                  className="w-full text-[10px] font-bold py-1.5 rounded-lg transition-colors"
                  style={isDefault
                    ? { background: `${v.color}22`, color: v.color, border: `1px solid ${v.color}66` }
                    : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)" }}
                  data-testid={`orai-voice-default-${v.id}`}>
                  {isDefault ? <span className="inline-flex items-center gap-1"><Check size={11} /> Your voice</span> : "Set as my voice"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="p-4 pt-1 space-y-3">
          <Slider label="Speaking speed" value={prefs.speed ?? 1} min={0.5} max={2} step={0.05}
            format={(v) => `${v.toFixed(2)}×`} onChange={(v) => update({ speed: v }, { debounce: true })}
            testid="orai-voice-speed" />
          <Slider label="Pitch" value={prefs.pitch ?? 0} min={-6} max={6} step={1}
            format={(v) => (v > 0 ? `+${v}` : `${v}`)} onChange={(v) => update({ pitch: v }, { debounce: true })}
            testid="orai-voice-pitch" />
          <Slider label="Volume" value={Math.round((prefs.volume ?? 0.9) * 100)} min={0} max={100} step={5}
            format={(v) => `${v}%`} onChange={(v) => update({ volume: v / 100 }, { debounce: true })}
            testid="orai-voice-volume" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold">Auto Speak</div>
              <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>ORAi reads every reply out loud</div>
            </div>
            <button onClick={() => update({ auto_speak: !prefs.auto_speak })}
              className="rounded-full px-3 py-1 text-[10px] font-bold"
              style={prefs.auto_speak
                ? { background: "rgba(16,230,112,0.15)", color: "#10E670", border: "1px solid rgba(16,230,112,0.5)" }
                : { background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", border: "1px solid rgba(255,255,255,0.12)" }}
              data-testid="orai-voice-autospeak-toggle">
              {prefs.auto_speak ? "On" : "Off"}
            </button>
          </div>
          <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
            Works with Bluetooth headsets and AirPods — ORAi uses whichever microphone and speaker your device has selected.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
