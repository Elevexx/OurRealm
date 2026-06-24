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
import React, { useEffect, useState } from "react";
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
          <div className="text-xs italic" style={{ color: "var(--text-muted)" }}>No items yet.</div>
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
            {it.value && (
              <div className="text-[11px] font-bold whitespace-nowrap" style={{ color: "var(--primary)" }}>
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
          <div className="col-span-full text-xs italic" style={{ color: "var(--text-muted)" }}>No items yet.</div>
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
  const media = Array.isArray(data.media) ? data.media : [];
  return (
    <div className="h-full flex flex-col" data-testid="custom-layout-media_grid">
      {data.title && (
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-main)" }}>
          {data.title}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1 overflow-y-auto">
        {media.length === 0 ? (
          <div className="col-span-full text-xs italic" style={{ color: "var(--text-muted)" }}>No media yet.</div>
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
  return (
    <div className="h-full flex flex-col justify-center text-center" data-testid="custom-layout-stat">
      <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        {data.label || ""}
      </div>
      <div className="text-3xl mt-1" style={{ fontFamily: "var(--font-display)", color: accent }}>
        {data.value || "—"}
      </div>
      {data.delta && (
        <div className="text-[11px] mt-1 inline-flex items-center gap-1 justify-center" style={{ color: trend ? "#10E670" : "var(--text-muted)" }}>
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

  const merged = registryCfg ? {
    ...registryCfg,
    data: { ...(registryCfg.data || {}), ...(w?.data || {}) },
  } : null;

  if (!merged) {
    return (
      <div className="h-full flex items-center justify-center" data-testid={`custom-widget-loading-${w?.type || "x"}`}>
        <Icons.Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  const layout = merged.layout || "card";
  const Renderer = LAYOUT_RENDERERS[layout] || CardLayout;
  const data = merged.data || {};
  const theme = merged.theme || {};

  return (
    <div data-testid={`custom-widget-${w?.type || w?.key || "unknown"}`} className="h-full">
      <Renderer data={data} theme={theme} />
    </div>
  );
}

export { CardLayout, ListLayout, GridLayout, MediaGridLayout, PollLayout, StatLayout, EmbedLayout };
