import React, { useMemo, useState } from "react";
import { Play, Heart, Plus, ShoppingCart, Video, Disc3 } from "lucide-react";
import { TRENDING_TRACKS } from "@/data/mockData";

const DISTANCES = [25, 50, 100, 250, 500];
const GENRES = ["All", "Psytrance", "House", "Techno", "Drum & Bass", "Ambient", "Hip-Hop", "Indie"];
const SORTS = ["Top Charts", "Trending", "New Releases", "Up & Coming"];

export default function Music() {
  const [distance, setDistance] = useState(100);
  const [genre, setGenre] = useState("All");
  const [sort, setSort] = useState("Top Charts");
  const [open, setOpen] = useState(null);

  const tracks = useMemo(() => {
    return TRENDING_TRACKS.filter((t) =>
      (genre === "All" || t.genre === genre) && t.distance_miles <= distance
    ).sort((a, b) => {
      if (sort === "Top Charts") return b.plays - a.plays;
      if (sort === "Trending") return b.plays - a.plays * 0.7;
      if (sort === "New Releases") return a.id.localeCompare(b.id);
      return a.plays - b.plays;
    });
  }, [distance, genre, sort]);

  return (
    <div className="max-w-6xl mx-auto" data-testid="music-page">
      <div className="mb-6 flex items-center gap-3">
        <Disc3 size={28} style={{ color: "var(--primary)" }} />
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Sound · Local + Global</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Music</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="or-surface p-4 mb-6 grid sm:grid-cols-3 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Distance</div>
          <div className="flex flex-wrap gap-2">
            {DISTANCES.map((d) => (
              <button
                key={d}
                className="or-chip"
                data-active={distance === d}
                onClick={() => setDistance(d)}
                data-testid={`music-distance-${d}`}
              >
                {d} mi
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Genre</div>
          <div className="flex flex-wrap gap-2">
            {GENRES.map((g) => (
              <button key={g} className="or-chip" data-active={genre === g} onClick={() => setGenre(g)} data-testid={`music-genre-${g}`}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Sort</div>
          <div className="flex flex-wrap gap-2">
            {SORTS.map((s) => (
              <button key={s} className="or-chip" data-active={sort === s} onClick={() => setSort(s)} data-testid={`music-sort-${s.replace(/\s+/g, "-")}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {tracks.map((t) => (
          <div key={t.id} className="or-surface overflow-hidden" data-testid={`music-track-${t.id}`}>
            <div className="relative aspect-square overflow-hidden">
              <img src={t.cover} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => setOpen(t)}
                data-testid={`music-play-${t.id}`}
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.25)" }}
              >
                <span className="rounded-full p-4" style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                  <Play size={22} />
                </span>
              </button>
              <span className="absolute top-3 right-3 px-2 py-1 text-[10px] uppercase tracking-widest"
                style={{ background: "var(--surface-2)", borderRadius: 4 }}>
                {t.distance_miles} mi
              </span>
            </div>
            <div className="p-4">
              <div className="font-semibold text-base" style={{ color: "var(--text-main)" }}>{t.title}</div>
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>@{t.artist} · {t.genre}</div>
              <div className="mt-2 flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                <span>{t.plays.toLocaleString()} plays · {t.duration}</span>
                <Heart size={14} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Track detail */}
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
          onClick={() => setOpen(null)}
          data-testid="music-detail-modal"
        >
          <div className="or-surface max-w-2xl w-full p-6 grid sm:grid-cols-2 gap-5" onClick={(e) => e.stopPropagation()}>
            <img src={open.cover} alt="" className="w-full aspect-square object-cover" style={{ borderRadius: "var(--radius)" }} />
            <div>
              <div className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)" }}>{open.title}</div>
              <div className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>by @{open.artist}</div>
              <div className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--primary)" }}>{open.genre} · {open.duration}</div>
              <div className="grid grid-cols-2 gap-3">
                <button className="or-btn" data-testid="music-detail-follow"><Plus size={14} /> Follow</button>
                <button className="or-btn or-btn-ghost" data-testid="music-detail-playlist"><Plus size={14} /> Playlist</button>
                <button className="or-btn or-btn-ghost" data-testid="music-detail-buy"><ShoppingCart size={14} /> Buy</button>
                <button className="or-btn or-btn-ghost" data-testid="music-detail-favorite"><Heart size={14} /> Favorite</button>
                <button className="or-btn or-btn-ghost col-span-2" data-testid="music-detail-video"><Video size={14} /> Create video with sound</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
