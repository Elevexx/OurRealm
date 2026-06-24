/**
 * Value formatters catalog (Phase 3.2).
 * Mirrors backend/utils/value_formatters.py so the builder can render
 * a formatter picker without hitting the server. Live preview uses
 * the same logic as the server (best-effort) so admins see exactly
 * what users will see.
 */

export const FORMATTERS = [
  { key: "none",          label: "None",            fields: [] },
  { key: "currency",      label: "Currency",        fields: ["symbol", "decimals", "prefix", "suffix"] },
  { key: "percent",       label: "Percentage",      fields: ["decimals", "positive_color", "negative_color", "prefix", "suffix"] },
  { key: "number",        label: "Number",          fields: ["decimals", "prefix", "suffix"] },
  { key: "compact",       label: "Compact Number",  fields: ["decimals", "symbol", "prefix", "suffix"] },
  { key: "date",          label: "Date",            fields: ["pattern"] },
  { key: "relative_time", label: "Relative Time",   fields: [] },
  { key: "uppercase",     label: "Uppercase",       fields: [] },
  { key: "lowercase",     label: "Lowercase",       fields: [] },
  { key: "titlecase",     label: "Title Case",      fields: [] },
];

export const FORMATTER_KEYS = FORMATTERS.map((f) => f.key);

// ─── Live preview helpers (best-effort mirror of backend) ───────────

const _num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const _fixed = (n, decimals) => {
  const d = Math.max(0, Math.min(parseInt(decimals ?? 0, 10) || 0, 8));
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
};

const COMPACT_TIERS = [
  { tier: 1e12, label: "T" },
  { tier: 1e9, label: "B" },
  { tier: 1e6, label: "M" },
  { tier: 1e3, label: "K" },
];

function _parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const ms = v > 1e10 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) {
      const ms = n > 1e10 ? n : n * 1000;
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

export function applyFormatter(value, cfg) {
  const out = { raw: value, formatted: null, color: null };
  if (!cfg || typeof cfg !== "object") return out;
  const kind = cfg.type || "none";
  if (kind === "none") return out;
  const decimals = cfg.decimals;
  const symbol = cfg.symbol || "";
  const prefix = cfg.prefix || "";
  const suffix = cfg.suffix || "";
  let formatted = null;

  try {
    if (kind === "currency") {
      const n = _num(value);
      if (n !== null) {
        const d = decimals !== undefined && decimals !== null ? decimals : 2;
        const sign = n < 0 ? "-" : "";
        formatted = `${prefix}${sign}${symbol || "$"}${_fixed(Math.abs(n), d)}${suffix}`;
      }
    } else if (kind === "percent") {
      const n = _num(value);
      if (n !== null) {
        const d = decimals !== undefined && decimals !== null ? decimals : 2;
        formatted = `${prefix}${_fixed(n, d)}${suffix || "%"}`;
      }
    } else if (kind === "number") {
      const n = _num(value);
      if (n !== null) formatted = `${prefix}${_fixed(n, decimals ?? 0)}${suffix}`;
    } else if (kind === "compact") {
      const n = _num(value);
      if (n !== null) {
        const abs = Math.abs(n);
        const sign = n < 0 ? "-" : "";
        const d = decimals !== undefined && decimals !== null ? decimals : 1;
        let done = false;
        for (const { tier, label } of COMPACT_TIERS) {
          if (abs >= tier) {
            formatted = `${prefix}${sign}${symbol}${_fixed(abs / tier, d)}${label}${suffix}`;
            done = true; break;
          }
        }
        if (!done) formatted = `${prefix}${sign}${symbol}${_fixed(abs, Math.max(0, d))}${suffix}`;
      }
    } else if (kind === "date") {
      const dt = _parseDate(value);
      if (dt) {
        const p = cfg.pattern || "%Y-%m-%d";
        formatted = p
          .replace("%Y", dt.getFullYear())
          .replace("%m", String(dt.getMonth() + 1).padStart(2, "0"))
          .replace("%d", String(dt.getDate()).padStart(2, "0"))
          .replace("%H", String(dt.getHours()).padStart(2, "0"))
          .replace("%M", String(dt.getMinutes()).padStart(2, "0"));
      }
    } else if (kind === "relative_time") {
      const dt = _parseDate(value);
      if (dt) {
        const delta = (Date.now() - dt.getTime()) / 1000;
        const future = delta < 0;
        const a = Math.abs(delta);
        let out2;
        if (a < 60) out2 = `${Math.floor(a)}s`;
        else if (a < 3600) out2 = `${Math.floor(a / 60)}m`;
        else if (a < 86400) out2 = `${Math.floor(a / 3600)}h`;
        else if (a < 86400 * 30) out2 = `${Math.floor(a / 86400)}d`;
        else if (a < 86400 * 365) out2 = `${Math.floor(a / (86400 * 30))}mo`;
        else out2 = `${Math.floor(a / (86400 * 365))}y`;
        formatted = future ? `in ${out2}` : `${out2} ago`;
      }
    } else if (kind === "uppercase") {
      if (value !== null && value !== undefined) formatted = String(value).toUpperCase();
    } else if (kind === "lowercase") {
      if (value !== null && value !== undefined) formatted = String(value).toLowerCase();
    } else if (kind === "titlecase") {
      if (value !== null && value !== undefined) {
        formatted = String(value).replace(/\w\S*/g, (s) => s[0].toUpperCase() + s.slice(1).toLowerCase());
      }
    }
  } catch { /* */ }

  const n = _num(value);
  if (n !== null && ["currency", "percent", "number", "compact"].includes(kind)) {
    if (n > 0 && cfg.positive_color) out.color = cfg.positive_color;
    else if (n < 0 && cfg.negative_color) out.color = cfg.negative_color;
  }
  out.formatted = formatted;
  return out;
}

export const blankFormatter = () => ({ type: "none" });
