/**
 * CustomWidgetRenderer — universal renderer for any widget created
 * via the Custom Widget Builder. Dispatches on `editor_config.layout`
 * (card | list | grid | media_grid | poll | stat | embed) and reads
 * field values from `editor_config.data`. Used by:
 *   • The builder's live preview pane.
 *   • Profile widgets (when w.type doesn't match a system renderer).
 *   • HomeWidgets, RealmDetail.
 *
 * Data source:
 *   The renderer reads the data dict directly. Phase-3 plugin work
 *   will introduce a `kind: "api"` path that swaps `data` for
 *   server-fetched values without renderer changes.
 *
 * The renderer is intentionally read-only on public surfaces. The
 * builder passes `editing=true` to allow inline data edits.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { resolveMediaUrl as mediaUrl } from "@/lib/mediaUrl";

// Module-level cache so multiple instances of the same custom widget
// only fetch the registry entry once per page load.
const REGISTRY_CACHE = new Map();   // key -> editor_config
const INFLIGHT = new Map();         // key -> Promise

async function fetchRegistryConfig(key) {
  if (REGISTRY_CACHE.has(key)) return REGISTRY_CACHE.get(key);
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async () => {
    try {
      const { data } = await apiClient.get(`/widgets/registry/${encodeURIComponent(key)}`);
      const cfg = data?.widget?.editor_config || null;
      REGISTRY_CACHE.set(key, cfg);
      return cfg;
    } catch {
      REGISTRY_CACHE.set(key, null);
      return null;
    } finally {
      INFLIGHT.delete(key);
    }
  })();
  INFLIGHT.set(key, p);
  return p;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function safeData(w) {
  const cfg = w?.editor_config || {};
  return {
    layout: cfg.layout || "card",
    fields: cfg.fields || [],
    data: cfg.data || {},
    theme: cfg.theme || {},
  };
}

function Img({ src, alt, className = "" }) {
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
      >
        <Icons.Image size={20} />
      </div>
    );
  }
  return (
    <img
      src={mediaUrl(src)}
      alt={alt || ""}
      className={className}
      style={{ objectFit: "cover" }}
      loading="lazy"
    />
  );
}

function IconBadge({ name, size = 14, color }) {
  const Icon = Icons[name] || Icons.Star;
  return <Icon size={size} style={{ color: color || "var(--primary)" }} />;
}

// ─────────────────────────────────────────────────────────────────────
// Layout renderers
// ─────────────────────────────────────────────────────────────────────

function CardLayout({ data, theme }) {
  const accent = theme?.accent || "var(--primary)";
  const image = data.image || (Array.isArray(data.media) && data.media[0]) || null;
  return (
    <div className="h-full flex flex-col gap-2" data-testid="custom-layout-card">
      {image && (
        <Img src={image} className="w-full rounded-md" alt="" />
      )}
      {data.subtitle && (
        <div className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>
          {data.subtitle}
        </div>
      )}
      {data.title && (
        <div className="text-sm font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
          {data.title}
        </div>
      )}
      {data.body && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {data.body}
        </div>
      )}
      {(data.cta_label || data.cta_url) && (
        <a
          href={data.cta_url || "#"}
          target="_blank"
          rel="noreferrer"
          className="or-btn or-btn-primary mt-auto text-xs"
          style={{ alignSelf: "flex-start", background: accent }}
          onClick={(e) => { if (!data.cta_url) e.preventDefault(); }}
        >
          {data.cta_label || "Open"}
        </a>
      )}
    </div>
  );
}

function ListLayout({ data }) {
  const items = Array.isArray(data.items) ? data.items : [];
  return (
    <div className="h-full flex flex-col" data-testid="custom-layout-list">
      {data.title && (
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-main)" }}>
          {data.title}
        </div>
      )}
      <div className="space-y-1.5 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-xs italic" style={{ color: "var(--text-muted)" }} data-testid="custom-layout-empty">{data._empty_text || "No items yet."}</div>
        ) : items.map((it, i) => (
          <div
            key={it.id || i}
            className="flex items-start gap-2 px-2 py-1.5 rounded"
            style={{ background: "var(--surface-2)" }}
          >
            {it.icon && <IconBadge name={it.icon} />}
            {it.image && <Img src={it.image} className="w-7 h-7 rounded shrink-0" alt="" />}
            <div className="flex-1 min-w-0">
              {it.url ? (
                <a
                  href={it.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold hover:underline"
                  style={{ color: "var(--text-main)" }}
                >
                  {it.label || "(untitled)"}
                </a>
              ) : (
                <div className="text-xs font-semibold" style={{ color: "var(--text-main)" }}>
                  {it.label || "(untitled)"}
                </div>
              )}
              {it.body && (
                <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {it.body}
                </div>
              )}
            </div>
            {it.value !== undefined && it.value !== null && it.value !== "" && (
              <div className="text-[11px] font-bold whitespace-nowrap" style={{ color: (it._colors && it._colors.value) || "var(--primary)" }}>
                {it.value}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GridLayout({ data }) {
  const items = Array.isArray(data.items) ? data.items : [];
  return (
    <div className="h-full flex flex-col" data-testid="custom-layout-grid">
      {data.title && (
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-main)" }}>
          {data.title}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 overflow-y-auto">
        {items.length === 0 ? (
          <div className="col-span-full text-xs italic" style={{ color: "var(--text-muted)" }} data-testid="custom-layout-grid-empty">{data._empty_text || "No items yet."}</div>
        ) : items.map((it, i) => (
          <div
            key={it.id || i}
            className="p-2 rounded text-center"
            style={{ background: "var(--surface-2)" }}
          >
            {it.image ? (
              <Img src={it.image} className="w-full aspect-square rounded mb-1" alt="" />
            ) : it.icon ? (
              <div className="flex items-center justify-center aspect-square mb-1">
                <IconBadge name={it.icon} size={22} />
              </div>
            ) : null}
            <div className="text-[11px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
              {it.label || "(untitled)"}
            </div>
            {it.value && (
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {it.value}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MediaGridLayout({ data }) {
  const raw = Array.isArray(data.media) ? data.media : [];
  // Phase 3.1 — accept either ['url1', 'url2'] OR [{image:'url'}, ...]
  const media = raw.map((m) => (typeof m === "string" ? m : (m?.image || m?.url || ""))).filter(Boolean);
  return (
    <div className="h-full flex flex-col" data-testid="custom-layout-media_grid">
      {data.title && (
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-main)" }}>
          {data.title}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1 overflow-y-auto">
        {media.length === 0 ? (
          <div className="col-span-full text-xs italic" style={{ color: "var(--text-muted)" }}>{data._empty_text || "No media yet."}</div>
        ) : media.map((src, i) => (
          <Img key={i} src={src} className="w-full aspect-square rounded" alt="" />
        ))}
      </div>
    </div>
  );
}

function PollLayout({ data }) {
  const options = Array.isArray(data.options) ? data.options : [];
  const total = options.reduce((acc, o) => acc + (Number(o.votes) || 0), 0);
  return (
    <div className="h-full flex flex-col gap-2" data-testid="custom-layout-poll">
      <div className="text-xs font-semibold" style={{ color: "var(--text-main)" }}>
        {data.question || "Untitled poll"}
      </div>
      <div className="space-y-1.5">
        {options.map((o, i) => {
          const pct = total > 0 ? Math.round(((Number(o.votes) || 0) / total) * 100) : 0;
          return (
            <div key={o.id || i} className="relative px-2 py-1.5 rounded overflow-hidden" style={{ background: "var(--surface-2)" }}>
              <div
                className="absolute inset-y-0 left-0"
                style={{ width: `${pct}%`, background: "color-mix(in srgb, var(--primary) 28%, transparent)" }}
              />
              <div className="relative flex justify-between text-[11px]">
                <span style={{ color: "var(--text-main)" }}>{o.label || `Option ${i + 1}`}</span>
                <span style={{ color: "var(--text-muted)" }}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatLayout({ data, theme }) {
  const accent = theme?.accent || "var(--primary)";
  const trend = !!data.trend;
  const colors = data._colors || {};
  return (
    <div className="h-full flex flex-col justify-center text-center" data-testid="custom-layout-stat">
      <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        {data.label || ""}
      </div>
      <div className="text-3xl mt-1" style={{ fontFamily: "var(--font-display)", color: colors.value || accent }}>
        {data.value || "—"}
      </div>
      {data.delta && (
        <div className="text-[11px] mt-1 inline-flex items-center gap-1 justify-center" style={{ color: colors.delta || (trend ? "#10E670" : "var(--text-muted)") }}>
          {trend ? <Icons.TrendingUp size={12} /> : <Icons.Minus size={12} />}
          {data.delta}
        </div>
      )}
    </div>
  );
}

function EmbedLayout({ data }) {
  const url = data.embed_url || "";
  const aspect = data.aspect || "16/9";
  if (!url) {
    return (
      <div className="text-xs italic" style={{ color: "var(--text-muted)" }} data-testid="custom-layout-embed-empty">
        Embed URL not set.
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col gap-1" data-testid="custom-layout-embed">
      {data.title && (
        <div className="text-xs font-semibold" style={{ color: "var(--text-main)" }}>{data.title}</div>
      )}
      <div className="w-full rounded overflow-hidden" style={{ aspectRatio: aspect }}>
        <iframe
          src={url}
          title={data.title || "Embed"}
          className="w-full h-full"
          frameBorder="0"
          allow="encrypted-media; picture-in-picture; clipboard-write"
          allowFullScreen
        />
      </div>
    </div>
  );
}

const LAYOUT_RENDERERS = {
  card: CardLayout,
  list: ListLayout,
  grid: GridLayout,
  media_grid: MediaGridLayout,
  poll: PollLayout,
  stat: StatLayout,
  embed: EmbedLayout,
};

// ─────────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────────

export default function CustomWidgetRenderer({ w }) {
  // If the instance already carries an editor_config (e.g., the
  // builder preview pane), use it directly. Otherwise lazy-load
  // the registry config keyed by w.type (or w.key) and merge any
  // per-instance `data` overrides over the registry baseline.
  const [registryCfg, setRegistryCfg] = useState(w?.editor_config || null);
  const [apiData, setApiData] = useState(null);   // mapped fields from live API
  const [apiError, setApiError] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);
  // Phase 3.3 — resolved native OurRealm sound tracks by ID.
  const [resolvedSounds, setResolvedSounds] = useState({}); // { sound_id: track | null }

  useEffect(() => {
    if (w?.editor_config) {
      setRegistryCfg(w.editor_config);
      return undefined;
    }
    const key = w?.type || w?.key;
    if (!key) return undefined;
    let cancelled = false;
    fetchRegistryConfig(key).then((cfg) => { if (!cancelled) setRegistryCfg(cfg); });
    return () => { cancelled = true; };
  }, [w]);

  // API-backed widgets — fetch the proxied data on mount + at the
  // configured refresh interval. The renderer overlays `mapped` on
  // top of `editor_config.data` so static fallbacks always show
  // until the first successful fetch completes.
  const ds = registryCfg?.data_source || null;
  const isApi = ds?.kind === "api";
  const refreshMs = Math.max(15, (ds?.refresh_seconds || 600)) * 1000;
  const widgetIdent = w?.id || w?.type || w?.key;

  useEffect(() => {
    if (!isApi || !registryCfg) return undefined;
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      setApiLoading(true); setApiError(null);
      try {
        const { data } = await apiClient.post("/widgets/api-call", {
          widget_id: w?.id,
          widget_key: w?.type || w?.key,
        });
        if (!cancelled) {
          // Phase 3.2 — prefer mapped_formatted over mapped, and apply
          // per-item formatters from mapped_arrays_formatted to each
          // array item. Color hints flow through `_colors` so the
          // layout can pick them up without changing item shape.
          const merged = {};
          const colors = {};
          // Single-value fields.
          const mapped = data?.mapped || {};
          const mappedFmt = data?.mapped_formatted || {};
          for (const k of Object.keys(mapped)) {
            if (mappedFmt[k] && mappedFmt[k].formatted !== null && mappedFmt[k].formatted !== undefined) {
              merged[k] = mappedFmt[k].formatted;
              if (mappedFmt[k].color) colors[k] = mappedFmt[k].color;
            } else {
              merged[k] = mapped[k];
            }
          }
          // Array fields — overlay formatted values per item.
          const arrays = data?.mapped_arrays || {};
          const arraysFmt = data?.mapped_arrays_formatted || {};
          for (const fk of Object.keys(arrays)) {
            const items = arrays[fk] || [];
            const itemsFmt = arraysFmt[fk] || [];
            merged[fk] = items.map((it, i) => {
              if (!it || typeof it !== "object") return it;
              const fmtRow = itemsFmt[i] || {};
              const out = { ...it };
              for (const k of Object.keys(fmtRow)) {
                if (fmtRow[k]?.formatted !== null && fmtRow[k]?.formatted !== undefined) {
                  out[k] = fmtRow[k].formatted;
                  if (fmtRow[k].color) {
                    out._colors = { ...(out._colors || {}), [k]: fmtRow[k].color };
                  }
                }
              }
              return out;
            });
          }
          merged._colors = colors;
          setApiData(merged);
          setApiError(null);
        }
      } catch (e) {
        if (!cancelled) {
          const detail = e?.response?.data?.detail;
          // Phase 3.2 — 429 payload is shaped {error, scope, retry_after, message}.
          let msg = "Failed to load";
          if (typeof detail === "string") msg = detail;
          else if (detail?.message) msg = detail.message;
          else if (detail?.error) msg = detail.error;
          setApiError(msg);
        }
      } finally {
        if (!cancelled) setApiLoading(false);
      }
    };
    tick();
    timer = setInterval(tick, refreshMs);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApi, widgetIdent, refreshMs]);

  // Phase 3.3 — collect any sound-field values that look like native
  // OurRealm sound IDs, hit /api/sounds/resolve to hydrate them, and
  // render the inline players below the layout content.
  const soundFieldKeys = useMemo(() => {
    const fields = registryCfg?.fields || [];
    return fields.filter((f) => f.type === "sound").map((f) => f.key);
  }, [registryCfg]);

  const pinnedSoundIds = useMemo(() => {
    if (!registryCfg || soundFieldKeys.length === 0) return [];
    const out = new Set();
    const baseData = { ...(registryCfg.data || {}), ...(w?.data || {}) };
    for (const k of soundFieldKeys) {
      const v = baseData[k];
      if (!v) continue;
      const arr = Array.isArray(v) ? v : [v];
      for (const entry of arr) {
        if (looksLikeSoundId(entry)) out.add(entry);
      }
    }
    return Array.from(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryCfg, w?.data, soundFieldKeys.join(",")]);

  useEffect(() => {
    if (pinnedSoundIds.length === 0) {
      setResolvedSounds({});
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/sounds/resolve?ids=${encodeURIComponent(pinnedSoundIds.join(","))}`);
        if (cancelled) return;
        const map = {};
        for (const id of pinnedSoundIds) map[id] = null; // pre-seed for fallback rendering
        for (const t of (data?.tracks || [])) map[t.id] = t;
        setResolvedSounds(map);
      } catch {
        if (!cancelled) {
          const map = {};
          for (const id of pinnedSoundIds) map[id] = null;
          setResolvedSounds(map);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pinnedSoundIds.join(",")]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Build the merged data dict that the layout will render. For API
  // widgets we layer (in order): registry baseline → instance overrides
  // → live API mapping. Empty arrays bubble the array-binding's
  // empty_text via the special `_empty_text` key so the layout can
  // show "No headlines available" instead of generic copy.
  const merged = registryCfg ? {
    ...registryCfg,
    data: (() => {
      const base = { ...(registryCfg.data || {}), ...(w?.data || {}), ...(apiData || {}) };
      const bindings = registryCfg?.data_source?.array_bindings || [];
      const empties = bindings
        .filter((b) => Array.isArray(base[b.field_key]) && base[b.field_key].length === 0)
        .map((b) => b.empty_text)
        .filter(Boolean);
      if (empties.length > 0) base._empty_text = empties[0];
      return base;
    })(),
  } : null;

  if (!merged) {
    return (
      <div className="h-full flex items-center justify-center" data-testid={`custom-widget-loading-${w?.type || "x"}`}>
        <Icons.Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  // First-load skeleton for API widgets that don't have static
  // fallback values yet.
  if (isApi && apiLoading && !apiData && (!merged.data || Object.keys(merged.data).every((k) => !merged.data[k]))) {
    return (
      <div className="h-full flex items-center justify-center" data-testid={`custom-widget-api-loading-${w?.type || "x"}`}>
        <Icons.Loader2 size={18} className="animate-spin" style={{ color: "var(--primary)" }} />
      </div>
    );
  }

  const layout = merged.layout || "card";
  const Renderer = LAYOUT_RENDERERS[layout] || CardLayout;
  const data = merged.data || {};
  const theme = merged.theme || {};

  return (
    <div data-testid={`custom-widget-${w?.type || w?.key || "unknown"}`} className="h-full relative">
      <Renderer data={data} theme={theme} />
      {soundFieldKeys.length > 0 && (
        <NativeSoundList
          fieldKeys={soundFieldKeys}
          data={data}
          resolved={resolvedSounds}
        />
      )}
      {isApi && apiError && (
        <div
          className="absolute top-1 right-1 text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded"
          style={{ background: "rgba(255,90,107,0.18)", color: "#FF8080" }}
          title={apiError}
          data-testid="custom-widget-api-error"
        >
          <Icons.AlertTriangle size={9} className="inline" /> API
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3.3 — Native sound rendering
// ─────────────────────────────────────────────────────────────────────

function looksLikeSoundId(v) {
  if (!v || typeof v !== "string") return false;
  if (v.includes("/")) return false;
  const s = v.replace(/-/g, "").toLowerCase();
  return s.length === 32 && /^[0-9a-f]+$/.test(s);
}

function NativeSoundList({ fieldKeys, data, resolved }) {
  // Flatten every sound-field value into a single ordered list of
  // {id?, url?} entries. IDs resolve to native players; plain URLs
  // fall back to a lightweight legacy player (no metadata).
  const entries = [];
  for (const k of fieldKeys) {
    const v = data?.[k];
    if (!v) continue;
    const arr = Array.isArray(v) ? v : [v];
    for (const item of arr) {
      if (!item) continue;
      if (looksLikeSoundId(item)) entries.push({ id: item });
      else entries.push({ url: item });
    }
  }
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5" data-testid="custom-widget-sounds">
      {entries.map((e, i) => {
        if (e.id) {
          const track = resolved[e.id];
          if (track === undefined) {
            // still loading
            return (
              <div key={i} className="or-surface p-2 flex items-center gap-2" style={{ background: "var(--surface-2)" }}>
                <Icons.Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Resolving sound…</span>
              </div>
            );
          }
          if (track === null) {
            return (
              <div key={i} className="or-surface p-2 flex items-center gap-2"
                style={{ background: "var(--surface-2)" }}
                data-testid={`custom-widget-sound-missing-${e.id}`}>
                <Icons.AlertTriangle size={14} style={{ color: "#FF8080" }} />
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Sound unavailable (deleted or private).
                </span>
              </div>
            );
          }
          return <NativeSoundRow key={i} track={track} />;
        }
        return <LegacyUrlRow key={i} url={e.url} />;
      })}
    </div>
  );
}

function NativeSoundRow({ track }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const cover = track.cover_url ? mediaUrl(track.cover_url) : null;
  const fileUrl = mediaUrl(track.file_url);
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => setPlaying(false)); }
    else { a.pause(); }
  };
  return (
    <div className="or-surface p-2 flex items-center gap-2" style={{ background: "var(--surface-2)" }}
      data-testid={`custom-widget-sound-${track.id}`}>
      <button
        onClick={toggle}
        className="rounded shrink-0 relative overflow-hidden"
        style={{ width: 38, height: 38, background: "var(--surface-1)" }}
        title={playing ? "Pause" : "Play"}
      >
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
            <Icons.Music size={16} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.42)" }}>
          {playing ? <Icons.Pause size={12} style={{ color: "#fff" }} /> : <Icons.Play size={12} style={{ color: "#fff" }} />}
        </div>
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}>
          {track.title || "Untitled"}
        </div>
        <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
          {track.category || ""}{track.genre ? ` · ${track.genre}` : ""}
        </div>
      </div>
      <audio
        ref={audioRef}
        src={fileUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        style={{ display: "none" }}
      />
    </div>
  );
}

function LegacyUrlRow({ url }) {
  const resolved = mediaUrl(url);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  return (
    <div className="or-surface p-2 flex items-center gap-2" style={{ background: "var(--surface-2)" }}
      data-testid="custom-widget-sound-legacy">
      <button onClick={toggle} className="rounded shrink-0 flex items-center justify-center"
        style={{ width: 38, height: 38, background: "var(--surface-1)" }}>
        {playing ? <Icons.Pause size={14} /> : <Icons.Play size={14} />}
      </button>
      <div className="flex-1 min-w-0 text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
        {url || "(no audio url)"}
      </div>
      <audio
        ref={audioRef}
        src={resolved}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        style={{ display: "none" }}
      />
    </div>
  );
}

export { CardLayout, ListLayout, GridLayout, MediaGridLayout, PollLayout, StatLayout, EmbedLayout };
