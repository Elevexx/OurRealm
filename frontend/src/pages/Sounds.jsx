/**
 * OurRealm — Sounds (Phase 4A)
 * Music · Podcasts · FX · AI (Coming Soon)
 * Reuses RadiusChips, the singleton audioPlayer, and the SoundUploadPicker.
 * Reads from /api/sounds/feed and /api/sounds/charts/top100.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import useHeartbeat from "@/hooks/useHeartbeat";
import {
  Play, Heart, Plus, ChevronDown, ChevronLeft, ChevronRight,
  Music as MusicIcon, Mic, Sparkles, Wand2, Disc3, Loader2, Upload, Send, Search,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import RadiusChips from "@/components/RadiusChips";
import SoundUploadPicker from "@/components/SoundUploadPicker";
import SoundManagementMenu from "@/components/SoundManagementMenu";
import ShareToChatModal from "@/components/ShareToChatModal";
import ZipRequiredModal from "@/components/ZipRequiredModal";
import { GENRES as ALL_GENRES } from "@/data/musicGenres";
import { play as playerPlay, formatTime } from "@/lib/audioPlayer";
import { TRENDING_TRACKS } from "@/data/mockData";

// Tabs — unique color + icon per spec
const TABS = [
  { id: "Music",    Icon: MusicIcon, color: "#5BC9FF" },
  { id: "Podcasts", Icon: Mic,       color: "#B383FF" },
  { id: "FX",       Icon: Sparkles,  color: "#FFB72E" },
  { id: "AI",       Icon: Wand2,     color: "#3CFFB0" },
];
const GENRES = ["All", ...ALL_GENRES];
const CHARTS = ["Top 100", "Trending", "New Releases", "Up & Coming", "Editor's Picks"];
const MOODS  = ["Any", "Energetic", "Chill", "Dark", "Uplifting", "Focus", "Party"];
const RADII  = ["10", "20", "50", "100", "250", "500"];   // "Any" handled by the chip toggle

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
        <div className="or-surface absolute z-30 mt-1 p-1 min-w-[180px]"
          style={{ background: "var(--surface-2)" }}
          onMouseLeave={() => setOpen(false)}
        >
          {options.map((o) => (
            <button
              key={o} onClick={() => { onChange(o); setOpen(false); }}
              data-testid={`${testid}-opt-${String(o).replace(/\s+/g, "-")}`}
              className="block w-full text-left px-3 py-2 text-sm rounded-md transition-colors"
              style={{
                background: value === o ? "color-mix(in srgb, var(--primary) 16%, transparent)" : "transparent",
                color: "var(--text-main)",
              }}
            >{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sounds() {
  useHeartbeat("sounds");
  const { user } = useAuth();
  const [tab, setTab] = useState("Music");
  const [genre, setGenre] = useState("All");
  const [chart, setChart] = useState("Top 100");
  const [mood, setMood] = useState("Any");
  const [radius, setRadius] = useState("");     // "" = Any
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [zipRequiredOpen, setZipRequiredOpen] = useState(false);

  const [tracks, setTracks] = useState([]);
  const [pageInfo, setPageInfo] = useState({ page: 1, pages: 5, total: 0 });
  const [featured, setFeatured] = useState([]);
  const [madeForYou, setMadeForYou] = useState([]);
  const [showMadeForYou, setShowMadeForYou] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [shareTrack, setShareTrack] = useState(null);

  const onRadiusChange = (val) => {
    if (val && !user?.zip_code) {
      setZipRequiredOpen(true);
      return;
    }
    setRadius(val || "");
    setPage(1);
  };

  // Filters reset to page 1 on change; one filter never resets the others.
  useEffect(() => { setPage(1); }, [tab, genre, mood, chart, searchTerm]);

  // Debounce the search input (300ms) so we don't hammer the API per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Featured carousel — always Top 6 of the platform regardless of filters
  const loadFeatured = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/sounds/feed", {
        params: { chart: "Top 100", limit: 6 },
      });
      const items = data.tracks || [];
      // Day-1 fallback: if zero uploads platform-wide, show mock so the page never looks dead.
      if (items.length === 0) {
        setFeatured(TRENDING_TRACKS.slice(0, 6).map((t) => ({ ...t, _mock: true })));
      } else {
        setFeatured(items);
      }
    } catch { /* ignore */ }
  }, []);

  // Phase 4B follow-up — "Made for You" rail (above Top 100).
  // Render only when the personalization engine reports `active` for this user.
  const loadMadeForYou = useCallback(async () => {
    try {
      const { data: status } = await apiClient.get("/sounds/me/personalized");
      if (!status?.active) {
        setShowMadeForYou(false);
        setMadeForYou([]);
        return;
      }
      // Reuse the existing /feed endpoint — 70/30 personalized blend is server-side.
      const { data } = await apiClient.get("/sounds/feed", {
        params: { chart: "Top 100", limit: 12 },
      });
      const items = data.tracks || [];
      setShowMadeForYou(items.length > 0);
      setMadeForYou(items);
    } catch {
      setShowMadeForYou(false);
      setMadeForYou([]);
    }
  }, []);

  const load = useCallback(async () => {
    if (tab === "AI") { setTracks([]); setPageInfo({ page: 1, pages: 5, total: 0 }); return; }
    setLoading(true);
    try {
      if (chart === "Top 100") {
        const { data } = await apiClient.get("/sounds/charts/top100", {
          params: {
            category: tab,
            genre: genre !== "All" ? genre : undefined,
            mood:   mood  !== "Any" ? mood  : undefined,
            radius: radius || undefined,
            q: searchTerm || undefined,
            page,
          },
        });
        setTracks(data.tracks || []);
        setPageInfo({ page: data.page, pages: data.pages, total: data.total });
      } else {
        const { data } = await apiClient.get("/sounds/feed", {
          params: {
            category: tab,
            genre: genre !== "All" ? genre : undefined,
            mood:   mood  !== "Any" ? mood  : undefined,
            chart,
            radius: radius || undefined,
            q: searchTerm || undefined,
            limit: 100,
          },
        });
        setTracks(data.tracks || []);
        setPageInfo({ page: 1, pages: 1, total: (data.tracks || []).length });
      }
    } catch (e) {
      // Sign-in required or transient — fall back to empty state, never crash the page.
      setTracks([]);
      setPageInfo({ page: 1, pages: 5, total: 0 });
    } finally { setLoading(false); }
  }, [tab, genre, mood, chart, radius, searchTerm, page]);

  useEffect(() => { loadFeatured(); }, [loadFeatured]);
  useEffect(() => { loadMadeForYou(); }, [loadMadeForYou]);
  useEffect(() => { load(); }, [load]);

  const onUploaded = (track) => {
    setShowUpload(false);
    setTab(track.category);
    setPage(1);
    setTimeout(() => { load(); loadFeatured(); loadMadeForYou(); }, 250);
  };

  const onPlay = (t) => {
    if (t._mock) return;   // mock tracks have no real file_url
    playerPlay(t);
  };

  const onLike = async (t) => {
    if (t._mock) return;
    const liked = !t.liked;
    setTracks((prev) => prev.map((x) => x.id === t.id ? { ...x, liked, likes: (x.likes || 0) + (liked ? 1 : -1) } : x));
    try {
      if (liked) await apiClient.post(`/sounds/${t.id}/like`);
      else       await apiClient.delete(`/sounds/${t.id}/like`);
    } catch {
      // revert on error
      setTracks((prev) => prev.map((x) => x.id === t.id ? { ...x, liked: !liked, likes: (x.likes || 0) + (liked ? -1 : 1) } : x));
    }
  };

  const isAI = tab === "AI";
  const activeTab = TABS.find((x) => x.id === tab);

  return (
    <div className="max-w-7xl mx-auto" data-testid="sounds-page">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Disc3 size={28} style={{ color: "var(--primary)" }} />
          <div>
            <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>The Realm Sound Library</div>
            <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Sounds</h1>
          </div>
        </div>
        {!isAI && (
          <button
            onClick={() => setShowUpload(true)}
            className="or-btn"
            data-testid="sounds-upload-btn"
          >
            <Upload size={14} /> Upload
          </button>
        )}
      </header>

      {/* Category hero cards — bigger, color-graphic per category (Phase 5 polish) */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-3"
        data-testid="sounds-tabs"
      >
        {TABS.map(({ id, Icon, color }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              data-testid={`sounds-tab-${id}`}
              data-active={active}
              onClick={() => setTab(id)}
              className="relative overflow-hidden flex flex-col items-start justify-between p-3 sm:p-4 transition-transform active:scale-[0.98]"
              style={{
                borderRadius: "var(--radius)",
                minHeight: 92,
                background: active
                  ? `linear-gradient(135deg, color-mix(in srgb, ${color} 38%, var(--surface)) 0%, color-mix(in srgb, ${color} 12%, var(--surface)) 100%)`
                  : `linear-gradient(135deg, color-mix(in srgb, ${color} 16%, var(--surface)) 0%, var(--surface) 100%)`,
                outline: active ? `2px solid ${color}` : "1px solid var(--border-col)",
                boxShadow: active
                  ? `0 8px 26px color-mix(in srgb, ${color} 32%, transparent)`
                  : "none",
                color: active ? color : "var(--text-main)",
              }}
            >
              {/* Decorative orb */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  right: -14,
                  bottom: -14,
                  width: 78,
                  height: 78,
                  borderRadius: "50%",
                  background: `radial-gradient(circle at 30% 30%, ${color}, transparent 70%)`,
                  opacity: active ? 0.55 : 0.28,
                  filter: "blur(2px)",
                  pointerEvents: "none",
                }}
              />
              <span
                className="flex items-center justify-center"
                style={{
                  width: 36, height: 36, borderRadius: "calc(var(--radius) - 6px)",
                  background: `color-mix(in srgb, ${color} 22%, transparent)`,
                  color,
                }}
              >
                <Icon size={18} />
              </span>
              <span className="flex items-baseline gap-2 mt-2 z-[1]" style={{ fontFamily: "var(--font-display)" }}>
                <span className="text-base sm:text-lg font-semibold">{id}</span>
                {id === "AI" && (
                  <span className="text-[9px] uppercase tracking-widest opacity-80">Soon</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      {!isAI && (
        <>
          <div className="flex gap-2 mb-2 overflow-x-auto no-scrollbar items-center" data-testid="sounds-filters">
            <Dropdown label="Genre"  value={genre}  onChange={setGenre}  options={GENRES} testid="sounds-genre" />
            <Dropdown label="Charts" value={chart}  onChange={setChart}  options={CHARTS} testid="sounds-chart" />
            <Dropdown label="Mood"   value={mood}   onChange={setMood}   options={MOODS}  testid="sounds-mood" />
          </div>
          {/* Search bar — debounced 300ms; never resets filters */}
          <div
            className="or-surface mb-2 p-2.5 flex items-center gap-2"
            style={{ background: "var(--surface-2)" }}
            data-testid="sounds-search-bar"
          >
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              placeholder="Search sounds by title or genre…"
              className="bg-transparent flex-1 outline-none border-none text-sm"
              style={{ color: "var(--text-main)" }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              data-testid="sounds-search-input"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="text-xs underline"
                style={{ color: "var(--text-muted)" }}
                data-testid="sounds-search-clear"
              >Clear</button>
            )}
          </div>
          <div className="mb-5">
            <RadiusChips
              value={radius}
              onChange={onRadiusChange}
              options={RADII}
              testidPrefix="sounds-radius"
            />
          </div>
        </>
      )}

      {/* AI placeholder */}
      {isAI && (
        <section className="or-surface p-8 text-center mb-6" data-testid="sounds-ai-placeholder">
          <div className="inline-flex items-center justify-center mb-3 rounded-full p-4"
            style={{ background: "color-mix(in srgb, var(--brand-green) 22%, transparent)", color: "var(--brand-green)" }}>
            <Wand2 size={32} />
          </div>
          <h2 className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)" }}>AI Sounds — Coming Soon</h2>
          <p className="max-w-xl mx-auto text-sm" style={{ color: "var(--text-muted)" }}>
            Generate music, podcasts, and FX with AI inside OurRealm. This category will unlock once
            our audio models are tuned for community use. Uploads and rankings are intentionally disabled.
          </p>
        </section>
      )}

      {/* Featured carousel */}
      {!isAI && (
        <div className="mb-7">
          <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>Featured</h3>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2" data-testid="sounds-featured">
            {featured.length === 0 ? (
              <div className="or-surface p-6 text-center w-full" style={{ color: "var(--text-muted)" }}>
                No featured sounds yet — be the first to upload!
              </div>
            ) : featured.map((t) => (
              <FeaturedCard key={t.id} t={t} onPlay={() => onPlay(t)} testid={`sounds-featured-${t.id}`} />
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {!isAI && (
        <>
          {/* Phase 4B follow-up — "Made for You" rail.
              Only renders once the personalization engine activates for this user. */}
          {showMadeForYou && (
            <div className="mb-6" data-testid="sounds-made-for-you">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--brand-green)" }}>
                  Made for <span style={{ color: "var(--primary)" }}>You</span>
                </h3>
                <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  Tuned to your taste
                </span>
              </div>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2" data-testid="sounds-made-for-you-rail">
                {madeForYou.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onPlay(t)}
                    className="or-surface shrink-0 text-left overflow-hidden"
                    style={{ width: 180 }}
                    data-testid={`sounds-mfy-${t.id}`}
                  >
                    <div className="relative aspect-square overflow-hidden">
                      {t.cover_url ? (
                        <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"
                          style={{ background: "var(--surface-2)", color: "var(--brand-green)" }}>
                          <MusicIcon size={36} />
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 rounded-full p-2"
                        style={{ background: "var(--primary)", color: "var(--primary-fg)", boxShadow: "0 0 12px var(--primary)" }}>
                        <Play size={14} />
                      </span>
                    </div>
                    <div className="p-2.5">
                      <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{t.title}</div>
                      <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                        {t.artist_username ? `@${t.artist_username}` : ""}
                        {t.genre ? ` · ${t.genre}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
              {chart}{tracks.length ? ` · ${tracks.length} results` : ""}
            </h3>
            {chart === "Top 100" && pageInfo.pages > 1 && (
              <PaginationBar page={page} pages={pageInfo.pages} setPage={setPage} testid="sounds-pager" />
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : tracks.length === 0 ? (
            <EmptyState category={tab} accent={activeTab?.color} onUpload={() => setShowUpload(true)} />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="sounds-results">
              {tracks.map((t) => (
                <TrackCard
                  key={t.id}
                  t={t}
                  user={user}
                  onPlay={() => onPlay(t)}
                  onLike={() => onLike(t)}
                  onShare={() => setShareTrack(t)}
                  onUpdated={(updated) => setTracks((prev) => prev.map((x) => x.id === updated.id ? { ...x, ...updated } : x))}
                  onDeleted={(id) => setTracks((prev) => prev.filter((x) => x.id !== id))}
                />
              ))}
            </div>
          )}

          {chart === "Top 100" && pageInfo.pages > 1 && tracks.length > 0 && (
            <div className="mt-5 flex justify-center">
              <PaginationBar page={page} pages={pageInfo.pages} setPage={setPage} testid="sounds-pager-bottom" />
            </div>
          )}
        </>
      )}

      <SoundUploadPicker
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={onUploaded}
        defaultCategory={isAI ? "Music" : tab}
        testid="sounds-upload"
      />
      <ShareToChatModal
        open={!!shareTrack}
        track={shareTrack}
        onClose={() => setShareTrack(null)}
        testid="sounds-share"
      />
      <ZipRequiredModal open={zipRequiredOpen} onClose={() => setZipRequiredOpen(false)} testid="sounds-zip-required" />
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────
function PaginationBar({ page, pages, setPage, testid }) {
  return (
    <div className="flex items-center gap-1" data-testid={testid}>
      <button
        className="starbar-icon" style={{ width: 32, height: 32 }}
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={page === 1}
        data-testid={`${testid}-prev`}
        aria-label="Previous page"
      ><ChevronLeft size={14} /></button>
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <button
          key={p}
          onClick={() => setPage(p)}
          className="px-2.5 py-1 text-xs font-bold"
          style={{
            borderRadius: 6,
            background: p === page ? "var(--primary)" : "var(--surface-2)",
            color: p === page ? "var(--primary-fg)" : "var(--text-main)",
            minWidth: 28,
          }}
          data-testid={`${testid}-page-${p}`}
        >{(p - 1) * 20 + 1}–{p * 20}</button>
      ))}
      <button
        className="starbar-icon" style={{ width: 32, height: 32 }}
        onClick={() => setPage(Math.min(pages, page + 1))}
        disabled={page === pages}
        data-testid={`${testid}-next`}
        aria-label="Next page"
      ><ChevronRight size={14} /></button>
    </div>
  );
}

function FeaturedCard({ t, onPlay, testid }) {
  const cover = t.cover_url || t.cover || null;
  return (
    <div
      className="or-surface shrink-0 overflow-hidden grain relative"
      style={{ width: 320 }}
      data-testid={testid}
    >
      <div className="relative h-40">
        {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> :
          <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--surface-2)", color: "var(--primary)" }}><MusicIcon size={36} /></div>}
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.7))" }} />
        <button
          onClick={onPlay}
          className="absolute bottom-3 right-3 rounded-full p-3"
          style={{ background: "var(--primary)", color: "var(--primary-fg)", boxShadow: "0 0 18px var(--primary)" }}
          data-testid={`${testid}-play`}
          aria-label="Play"
        ><Play size={18} /></button>
        <div className="absolute bottom-3 left-3 right-16">
          <div className="font-bold truncate" style={{ color: "#fff" }}>{t.title}</div>
          <div className="text-xs truncate" style={{ color: "#cfd9e5" }}>
            {t.artist_username ? `@${t.artist_username}` : (t.artist ? `@${t.artist}` : "")} {t.genre ? `· ${t.genre}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackCard({ t, user, onPlay, onLike, onShare, onUpdated, onDeleted }) {
  const cover = t.cover_url || t.cover || null;
  return (
    <div className="or-surface overflow-hidden" data-testid={`sounds-track-${t.id}`}>
      <div className="relative aspect-square overflow-hidden">
        {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> :
          <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--surface-2)", color: "var(--primary)" }}><MusicIcon size={48} /></div>}
        <button
          onClick={onPlay}
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.3)" }}
          data-testid={`sounds-play-${t.id}`}
          aria-label={`Play ${t.title}`}
        >
          <span className="rounded-full p-4" style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
            <Play size={20} />
          </span>
        </button>
        {typeof t.rank === "number" && (
          <span className="absolute top-3 left-3 px-2 py-1 text-[11px] font-bold uppercase tracking-widest"
            style={{ background: "var(--surface-2)", color: "var(--primary)", borderRadius: 4, border: "1px solid var(--primary)" }}
            data-testid={`sounds-rank-${t.id}`}>#{t.rank}</span>
        )}
        {typeof t.distance_miles === "number" && (
          <span className="absolute top-3 right-3 px-2 py-1 text-[10px] uppercase tracking-widest"
            style={{ background: "var(--surface-2)", borderRadius: 4 }}>{t.distance_miles} mi</span>
        )}
      </div>
      <div className="p-4 flex gap-3 items-center">
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>{t.title}</div>
          <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
            {t.artist_username ? `@${t.artist_username}` : ""} {t.genre ? `· ${t.genre}` : ""}
            {typeof t.duration_seconds === "number" && t.duration_seconds > 0 ? ` · ${formatTime(t.duration_seconds)}` : ""}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {t.plays ? `${t.plays} plays` : ""}{t.plays && t.likes ? " · " : ""}{t.likes ? `${t.likes} likes` : ""}
          </div>
        </div>
        <button
          onClick={onShare}
          className="starbar-icon"
          style={{ width: 36, height: 36, color: "var(--text-muted)" }}
          data-testid={`sounds-share-${t.id}`}
          aria-label="Share to chat"
          title="Share to chat"
        >
          <Send size={15} />
        </button>
        <SoundManagementMenu
          track={t}
          user={user}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          testid={`sound-manage-${t.id}`}
        />
        <button
          onClick={onLike}
          className="starbar-icon"
          style={{ width: 36, height: 36, color: t.liked ? "var(--brand-green)" : "var(--text-muted)" }}
          data-testid={`sounds-like-${t.id}`}
          aria-label={t.liked ? "Unlike" : "Like"}
          aria-pressed={!!t.liked}
        >
          <Heart size={16} fill={t.liked ? "currentColor" : "none"} />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ category, accent = "var(--primary)", onUpload }) {
  return (
    <div className="or-surface p-8 text-center" data-testid="sounds-empty">
      <div className="inline-flex items-center justify-center mb-3 rounded-full p-4"
        style={{ background: `color-mix(in srgb, ${accent} 22%, transparent)`, color: accent }}>
        <Plus size={28} />
      </div>
      <h3 className="text-xl mb-1" style={{ fontFamily: "var(--font-display)" }}>No {category} tracks here yet</h3>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Be the first to upload — your track lands right on the chart.
      </p>
      <button className="or-btn" onClick={onUpload} data-testid="sounds-empty-upload">
        <Upload size={14} /> Upload {category}
      </button>
    </div>
  );
}
