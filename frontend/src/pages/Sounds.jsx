import React, { useMemo, useState } from "react";
import { Play, Heart, Plus, ShoppingCart, Video, Disc3, Music as MusicIcon, Mic, Sparkles, Wand2, ChevronDown } from "lucide-react";
import { TRENDING_TRACKS, CHARACTERS } from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";
import ZipRequiredModal from "@/components/ZipRequiredModal";

const TABS = [
  { id: "Music",    Icon: MusicIcon },
  { id: "Podcasts", Icon: Mic },
  { id: "FX",       Icon: Sparkles },
  { id: "AI",       Icon: Wand2 },
];
const GENRES = ["All","Psytrance","House","Techno","Drum & Bass","Ambient","Hip-Hop","Indie"];
const CHARTS = ["Top 100","Trending","New Releases","Up & Coming","Editor's Picks"];
const MOODS = ["Any","Energetic","Chill","Dark","Uplifting","Focus","Party"];
// Phase-2 — radius options match the spec across Feed and Sounds.
// "Any" disables the radius filter entirely. Default is "Any".
const RADII = ["Any", "10", "20", "50", "100", "250", "500"];

function Dropdown({ label, options, value, onChange, testid }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" data-testid={testid}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="or-chip"
        style={{ paddingRight: 10 }}
        data-testid={`${testid}-button`}
      >
        <span className="text-[11px] uppercase tracking-widest opacity-70">{label}:</span>
        <span className="font-semibold">{value}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="or-surface absolute z-20 mt-1 p-1 min-w-[160px]"
          style={{ background: "var(--surface-2)" }}
          onMouseLeave={() => setOpen(false)}
        >
          {options.map((o) => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false); }}
              data-testid={`${testid}-opt-${String(o)}`}
              className="block w-full text-left px-3 py-2 text-sm rounded-md transition-colors"
              style={{
                background: value === o ? "color-mix(in srgb, var(--primary) 16%, transparent)" : "transparent",
                color: "var(--text-main)",
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sounds() {
  const { user } = useAuth();
  const [tab, setTab] = useState("Music");
  const [genre, setGenre] = useState("All");
  const [chart, setChart] = useState("Top 100");
  const [mood, setMood] = useState("Any");
  // Phase-2 — radius default = "Any" (spec). ZIP-gated when non-Any.
  const [radius, setRadius] = useState("Any");
  const [zipRequiredOpen, setZipRequiredOpen] = useState(false);
  const [open, setOpen] = useState(null);

  const onRadiusChange = (val) => {
    const raw = (val || "").replace(/\s*mi$/i, "").trim();
    if (raw !== "Any" && !user?.zip_code) {
      setZipRequiredOpen(true);
      return;
    }
    setRadius(raw);
  };

  const tracks = useMemo(() => {
    const list = TRENDING_TRACKS.filter((t) => {
      if (tab === "Music")    if (t.category !== "Music") return false;
      if (tab === "Podcasts") if (t.category !== "Podcasts") return false;
      if (tab === "FX")       if (t.category !== "FX") return false;
      if (tab === "AI")       if (t.category !== "AI") return false;
      if (genre !== "All" && t.genre !== genre) return false;
      if (mood  !== "Any" && t.mood  !== mood)  return false;
      if (radius !== "Any" && t.distance_miles > parseInt(radius, 10)) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      if (chart === "Trending")    return b.plays - a.plays * 0.7;
      if (chart === "New Releases")return a.id.localeCompare(b.id);
      if (chart === "Up & Coming") return a.plays - b.plays;
      return b.plays - a.plays; // Top 100 / Editor's Picks
    });
    return sorted;
  }, [tab, genre, chart, mood, radius]);

  const featured = TRENDING_TRACKS.slice(0, 6);

  return (
    <div className="max-w-7xl mx-auto" data-testid="sounds-page">
      <div className="mb-5 flex items-center gap-3">
        <Disc3 size={28} style={{ color: "var(--primary)" }} />
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>The Realm Sound Library</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Sounds</h1>
        </div>
      </div>

      {/* Row 2: type tabs */}
      <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar" data-testid="sounds-tabs">
        {TABS.map(({ id, Icon }) => (
          <button
            key={id}
            data-testid={`sounds-tab-${id}`}
            data-active={tab === id}
            onClick={() => setTab(id)}
            className="or-chip shrink-0"
          >
            <Icon size={14} /> {id}
          </button>
        ))}
      </div>

      {/* Row 3: dropdowns */}
      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar" data-testid="sounds-filters">
        <Dropdown label="Genre"  value={genre}  onChange={setGenre}  options={GENRES} testid="sounds-genre" />
        <Dropdown label="Charts" value={chart}  onChange={setChart}  options={CHARTS} testid="sounds-chart" />
        <Dropdown label="Mood"   value={mood}   onChange={setMood}   options={MOODS}  testid="sounds-mood" />
        <Dropdown label="Radius" value={radius === "Any" ? "Any" : `${radius} mi`} onChange={onRadiusChange} options={RADII.map((r) => r === "Any" ? "Any" : `${r} mi`)} testid="sounds-radius" />
      </div>

      {/* Row 4: featured carousel */}
      <div className="mb-7">
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>Featured</h3>
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2" data-testid="sounds-featured">
          {featured.map((t) => (
            <div key={t.id} className="or-surface shrink-0 overflow-hidden grain" style={{ width: 320 }} data-testid={`sounds-featured-${t.id}`}>
              <div className="relative h-40">
                <img src={t.cover} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.7))" }} />
                <button
                  onClick={() => setOpen(t)}
                  className="absolute bottom-3 right-3 rounded-full p-3"
                  style={{ background: "var(--primary)", color: "var(--primary-fg)", boxShadow: "0 0 18px var(--primary)" }}
                  data-testid={`sounds-feat-play-${t.id}`}
                >
                  <Play size={18} />
                </button>
                <div className="absolute bottom-3 left-3">
                  <div className="font-bold" style={{ color: "#fff" }}>{t.title}</div>
                  <div className="text-xs" style={{ color: "#cfd9e5" }}>@{t.artist} · {t.genre}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 5: results */}
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          {chart}{tracks.length ? ` · ${tracks.length} results` : ""}
        </h3>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tracks.length === 0 && (
          <div className="or-surface p-6 text-center col-span-full" style={{ color: "var(--text-muted)" }}>
            No tracks match your filters. Widen the radius or change genre.
          </div>
        )}
        {tracks.map((t) => {
          const artist = CHARACTERS.find((c) => c.id === t.artist_id);
          return (
            <div key={t.id} className="or-surface overflow-hidden" data-testid={`sounds-track-${t.id}`}>
              <div className="relative aspect-square overflow-hidden">
                <img src={t.cover} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => setOpen(t)}
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.25)" }}
                  data-testid={`sounds-play-${t.id}`}
                >
                  <span className="rounded-full p-4" style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                    <Play size={20} />
                  </span>
                </button>
                <span className="absolute top-3 right-3 px-2 py-1 text-[10px] uppercase tracking-widest" style={{ background: "var(--surface-2)", borderRadius: 4 }}>{t.distance_miles} mi</span>
              </div>
              <div className="p-4 flex gap-3 items-center">
                {artist && <img src={artist.avatar} alt="" className="rounded-full" style={{ width: 36, height: 36, border: "1px solid var(--border-col)" }} />}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>{t.title}</div>
                  <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>@{t.artist} · {t.genre}</div>
                </div>
                <Heart size={16} style={{ color: "var(--text-muted)" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Track detail */}
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
          onClick={() => setOpen(null)}
          data-testid="sounds-detail-modal"
        >
          <div className="or-surface max-w-2xl w-full p-6 grid sm:grid-cols-2 gap-5" onClick={(e) => e.stopPropagation()}>
            <img src={open.cover} alt="" className="w-full aspect-square object-cover" style={{ borderRadius: "var(--radius)" }} />
            <div>
              <div className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)" }}>{open.title}</div>
              <div className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>by @{open.artist}</div>
              <div className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--primary)" }}>{open.genre} · {open.mood} · {open.duration}</div>
              <div className="grid grid-cols-2 gap-3">
                <button className="or-btn" data-testid="sounds-detail-follow"><Plus size={14} /> Follow</button>
                <button className="or-btn or-btn-ghost" data-testid="sounds-detail-playlist"><Plus size={14} /> Playlist</button>
                <button className="or-btn or-btn-ghost" data-testid="sounds-detail-buy"><ShoppingCart size={14} /> Buy</button>
                <button className="or-btn or-btn-ghost" data-testid="sounds-detail-favorite"><Heart size={14} /> Favorite</button>
                <button className="or-btn or-btn-ghost col-span-2" data-testid="sounds-detail-video"><Video size={14} /> Create video with sound</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ZipRequiredModal open={zipRequiredOpen} onClose={() => setZipRequiredOpen(false)} testid="sounds-zip-required" />
    </div>
  );
}
