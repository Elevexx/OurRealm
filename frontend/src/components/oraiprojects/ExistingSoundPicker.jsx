import { useEffect, useRef, useState } from "react";
import { Play, Pause, Search, X } from "lucide-react";
import apiClient from "@/api/client";

export const ExistingSoundPicker = ({ open, onClose, onSelect }) => {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!open) { audioRef.current?.pause(); setPlaying(null); return; }
    setLoading(true);
    const t = setTimeout(() => {
      apiClient.get(`/orai/projects/sounds/eligible?q=${encodeURIComponent(q)}`)
        .then((r) => setRows(r.data.sounds || []))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [open, q]);

  const toggle = (tr) => {
    if (playing === tr.id) { audioRef.current?.pause(); setPlaying(null); return; }
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = tr.file_url;
    audioRef.current.play().catch(() => {});
    setPlaying(tr.id);
    audioRef.current.onended = () => setPlaying(null);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3"
      style={{ background: "rgba(0,0,0,.7)" }} data-testid="sound-picker-modal">
      <div className="or-surface w-full max-w-lg max-h-[80vh] flex flex-col p-4 rounded-2xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Use Existing Sound</span>
          <span className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>only eligible Sounds shown</span>
          <button className="ml-auto" onClick={onClose} aria-label="Close" data-testid="sound-picker-close">
            <X size={16} style={{ color: "var(--text-muted)" }} />
          </button>
        </div>
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <input className="or-input w-full text-xs pl-8" placeholder="Search sounds…" value={q}
            onChange={(e) => setQ(e.target.value)} data-testid="sound-picker-search" autoFocus />
        </div>
        <div className="overflow-y-auto space-y-1.5 flex-1" data-testid="sound-picker-list">
          {loading && <div className="text-[10px] py-4 text-center" style={{ color: "var(--text-muted)" }}>Searching…</div>}
          {!loading && !rows.length && <div className="text-[10px] py-4 text-center" style={{ color: "var(--text-muted)" }}>No eligible sounds found</div>}
          {rows.map((tr) => (
            <div key={tr.id} className="flex items-center gap-2 rounded-lg p-2"
              style={{ background: "rgba(255,255,255,.03)" }} data-testid={`sound-row-${tr.id}`}>
              {tr.cover_url
                ? <img src={tr.cover_url} alt="" className="w-8 h-8 rounded object-cover" />
                : <div className="w-8 h-8 rounded" style={{ background: "rgba(194,107,255,.2)" }} />}
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate" style={{ color: "var(--text-primary)" }}>{tr.title}</div>
                <div className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>
                  {tr.creator} · {tr.duration ? `${Math.round(tr.duration)}s` : "—"} · {tr.own ? "your sound" : "reuse allowed"}
                </div>
              </div>
              <button className="p-1.5 rounded-full" style={{ background: "rgba(255,255,255,.06)" }}
                onClick={() => toggle(tr)} aria-label="Preview" data-testid={`sound-preview-${tr.id}`}>
                {playing === tr.id ? <Pause size={12} /> : <Play size={12} />}
              </button>
              <button className="or-btn text-[10px] px-2 py-1" onClick={() => onSelect(tr)}
                data-testid={`sound-select-${tr.id}`}>Select</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ExistingSoundPicker;
