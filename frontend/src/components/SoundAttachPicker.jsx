/**
 * SoundAttachPicker — Phase 3 compact OurRealm Sound browser for
 * attaching Sounds to image/video posts. Server-driven eligibility:
 * only Sounds whose owners enabled the required reuse permission are
 * selectable; "Playable Only" Sounds render with a disabled Select.
 */
import React, { useEffect, useRef, useState } from "react";
import { X, Search, Play, Pause, Music, Loader2, Check, Lock } from "lucide-react";
import apiClient from "@/api/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";

const CATEGORIES = [
  { id: "", label: "All" },
  { id: "Music", label: "Music" },
  { id: "Podcast", label: "Podcasts" },
  { id: "FX", label: "FX" },
];
const TABS = [
  { id: "all", label: "Browse" },
  { id: "saved", label: "Saved" },
  { id: "mine", label: "My Sounds" },
  { id: "recent", label: "Recently Used" },
];

export default function SoundAttachPicker({ open, onClose, onSelect, useType = "image_posts", testid = "sound-attach-picker" }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [sort, setSort] = useState("trending");
  const [tab, setTab] = useState("all");
  const [sounds, setSounds] = useState([]);
  const [genres, setGenres] = useState([]);
  const [moods, setMoods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const audioRef = useRef(null);

  const stopPreview = () => { try { audioRef.current?.pause(); } catch { /* */ } setPreviewId(null); };

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get("/sounds/browse", {
          params: { use_type: useType, q, category, genre, mood, sort, tab, include_facets: 1, limit: 40 },
        });
        if (cancelled) return;
        setSounds(data?.sounds || []);
        if (data?.genres) setGenres(data.genres);
        if (data?.moods) setMoods(data.moods);
      } catch { if (!cancelled) setSounds([]); }
      finally { if (!cancelled) setLoading(false); }
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, q, category, genre, mood, sort, tab, useType]);

  useEffect(() => { if (!open) stopPreview(); /* eslint-disable-next-line */ }, [open]);
  if (!open) return null;

  const togglePreview = (s) => {
    if (previewId === s.id) { stopPreview(); return; }
    stopPreview();
    setPreviewId(s.id);
    setTimeout(() => { try { audioRef.current?.play(); } catch { /* */ } }, 50);
  };
  const pick = (s) => { stopPreview(); onSelect?.(s); };
  const close = () => { stopPreview(); onClose?.(); };
  const fmt = (d) => (d ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}` : "—");

  return (
    <div className="fixed inset-0 z-[96] flex items-end sm:items-center justify-center sm:px-3"
      style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }}
      onClick={close} data-testid={testid}>
      <div className="or-surface w-full sm:max-w-lg flex flex-col overflow-hidden"
        style={{ maxHeight: "78vh", borderRadius: "var(--radius)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div>
            <div className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>Add an OurRealm Sound</div>
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Only Sounds their owners opened for reuse can be attached.
            </div>
          </div>
          <button className="starbar-icon" style={{ width: 30, height: 30 }} onClick={close} data-testid={`${testid}-close`}>
            <X size={13} />
          </button>
        </div>

        <div className="px-4 pb-2 space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input className="or-input w-full text-sm" style={{ paddingLeft: 30 }} placeholder="Search Sounds…"
              value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${testid}-search`} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {TABS.map((t) => (
              <button key={t.id} className="or-chip text-[11px]"
                style={tab === t.id ? { background: "var(--primary)", color: "#000", fontWeight: 700 } : {}}
                onClick={() => setTab(t.id)} data-testid={`${testid}-tab-${t.id}`}>{t.label}</button>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">
            {CATEGORIES.map((c) => (
              <button key={c.id || "all"} className="or-chip text-[11px]"
                style={category === c.id ? { background: "var(--primary)", color: "#000", fontWeight: 700 } : {}}
                onClick={() => setCategory(c.id)} data-testid={`${testid}-cat-${c.id || "all"}`}>{c.label}</button>
            ))}
            <select className="or-input text-[11px] py-1 px-2" value={sort} onChange={(e) => setSort(e.target.value)}
              data-testid={`${testid}-sort`} style={{ width: "auto" }}>
              <option value="trending">Trending</option>
              <option value="newest">Newest</option>
            </select>
            {genres.length > 0 && (
              <select className="or-input text-[11px] py-1 px-2" value={genre} onChange={(e) => setGenre(e.target.value)}
                data-testid={`${testid}-genre`} style={{ width: "auto" }}>
                <option value="">Genre</option>
                {genres.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {moods.length > 0 && (
              <select className="or-input text-[11px] py-1 px-2" value={mood} onChange={(e) => setMood(e.target.value)}
                data-testid={`${testid}-mood`} style={{ width: "auto" }}>
                <option value="">Mood</option>
                {moods.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-1.5" data-testid={`${testid}-results`}>
          {loading ? (
            <div className="text-center p-6"><Loader2 size={18} className="animate-spin inline" /></div>
          ) : sounds.length === 0 ? (
            <div className="text-center p-6 text-xs" style={{ color: "var(--text-muted)" }} data-testid={`${testid}-empty`}>
              No Sounds found for this filter.
            </div>
          ) : sounds.map((s) => (
            <div key={s.id} className="or-surface p-2 flex items-center gap-2"
              style={{ background: "var(--surface-2)", opacity: s.reuse_eligible ? 1 : 0.72 }}
              data-testid={`${testid}-row-${s.id}`}>
              <button onClick={() => togglePreview(s)} className="rounded shrink-0 relative overflow-hidden"
                style={{ width: 42, height: 42, background: "var(--surface-1)" }}
                title={previewId === s.id ? "Stop preview" : "Preview"}
                data-testid={`${testid}-preview-${s.id}`}>
                {s.cover_url ? <img src={resolveMediaUrl(s.cover_url)} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}><Music size={16} /></div>}
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.42)" }}>
                  {previewId === s.id ? <Pause size={13} style={{ color: "#fff" }} /> : <Play size={13} style={{ color: "#fff" }} />}
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate" style={{ color: "var(--text-main)" }}>{s.title}</div>
                <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                  @{s.creator_username || "unknown"} · {fmt(s.duration_seconds)} · {s.category}
                  {s.genre ? ` · ${s.genre}` : ""}{s.mood ? ` · ${s.mood}` : ""}
                </div>
                <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider mt-0.5 px-1.5 py-0.5 rounded-full"
                  style={s.reuse_eligible
                    ? { background: "rgba(0,255,102,0.14)", color: "var(--brand-green, #00FF66)" }
                    : { background: "var(--surface-1)", color: "var(--text-muted)" }}
                  data-testid={`${testid}-badge-${s.id}`}>
                  {s.reuse_eligible ? <Check size={9} /> : <Lock size={9} />} {s.reuse_badge}
                </span>
              </div>
              <button className="or-btn text-[11px] px-2.5 py-1 shrink-0" disabled={!s.reuse_eligible}
                style={!s.reuse_eligible ? { opacity: 0.45, cursor: "not-allowed" } : {}}
                title={s.reuse_eligible ? "Attach this Sound" : "The owner hasn't enabled this Sound for reuse"}
                onClick={() => s.reuse_eligible && pick(s)}
                data-testid={`${testid}-select-${s.id}`}>
                Select
              </button>
            </div>
          ))}
        </div>
        {previewId && (
          <audio ref={audioRef} src={resolveMediaUrl(sounds.find((s) => s.id === previewId)?.file_url)}
            preload="metadata" onEnded={stopPreview} style={{ display: "none" }}
            data-testid={`${testid}-audio`} />
        )}
      </div>
    </div>
  );
}
