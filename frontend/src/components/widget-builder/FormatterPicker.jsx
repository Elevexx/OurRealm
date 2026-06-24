/**
 * FormatterPicker — compact inline picker for a single field's
 * formatter config. Renders as a chevron toggle (collapsed) or an
 * expanded panel showing the relevant settings for the chosen
 * formatter type.
 *
 * Used in both single-value bindings and per-item array bindings.
 */
import React, { useState } from "react";
import * as Icons from "lucide-react";
import { FORMATTERS, applyFormatter } from "@/lib/valueFormatters";

export default function FormatterPicker({ value, onChange, sampleValue, testid = "formatter" }) {
  const [open, setOpen] = useState(false);
  const cfg = value || { type: "none" };
  const isActive = cfg.type && cfg.type !== "none";
  const def = FORMATTERS.find((f) => f.key === cfg.type) || FORMATTERS[0];
  const preview = sampleValue !== undefined ? applyFormatter(sampleValue, cfg) : null;
  return (
    <div className="w-full" data-testid={testid}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-[10px]"
        style={{
          background: isActive ? "color-mix(in srgb, var(--brand-green) 14%, transparent)" : "var(--surface-2)",
          color: isActive ? "var(--brand-green)" : "var(--text-muted)",
        }}
      >
        <span className="flex items-center gap-1">
          <Icons.Sparkles size={9} />
          {isActive ? def.label : "Format · None"}
          {isActive && preview?.formatted && (
            <span className="ml-1" style={{ color: preview.color || "var(--brand-green)" }}>
              → {String(preview.formatted).slice(0, 20)}
            </span>
          )}
        </span>
        <Icons.ChevronDown size={9} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .1s" }} />
      </button>

      {open && (
        <div className="mt-1 or-surface p-2 space-y-1" style={{ background: "var(--surface-1)" }}>
          <label className="block">
            <div className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>Format Type</div>
            <select
              className="or-input w-full text-[10px]"
              value={cfg.type || "none"}
              onChange={(e) => onChange({ ...cfg, type: e.target.value })}
              data-testid={`${testid}-type`}
            >
              {FORMATTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>

          {def.fields.includes("decimals") && (
            <NumInput label="Decimals" value={cfg.decimals ?? ""} onChange={(v) => onChange({ ...cfg, decimals: v })} testid={`${testid}-decimals`} />
          )}
          {def.fields.includes("symbol") && (
            <StrInput label="Symbol" value={cfg.symbol || ""} placeholder={cfg.type === "currency" ? "$" : ""} onChange={(v) => onChange({ ...cfg, symbol: v })} testid={`${testid}-symbol`} />
          )}
          {def.fields.includes("prefix") && (
            <StrInput label="Prefix" value={cfg.prefix || ""} onChange={(v) => onChange({ ...cfg, prefix: v })} testid={`${testid}-prefix`} />
          )}
          {def.fields.includes("suffix") && (
            <StrInput label="Suffix" value={cfg.suffix || ""} onChange={(v) => onChange({ ...cfg, suffix: v })} testid={`${testid}-suffix`} />
          )}
          {def.fields.includes("positive_color") && (
            <ColorInput label="Positive Color" value={cfg.positive_color || ""} onChange={(v) => onChange({ ...cfg, positive_color: v })} testid={`${testid}-pos-color`} />
          )}
          {def.fields.includes("negative_color") && (
            <ColorInput label="Negative Color" value={cfg.negative_color || ""} onChange={(v) => onChange({ ...cfg, negative_color: v })} testid={`${testid}-neg-color`} />
          )}
          {def.fields.includes("pattern") && (
            <StrInput label="Date Pattern" value={cfg.pattern || ""} placeholder="%Y-%m-%d" onChange={(v) => onChange({ ...cfg, pattern: v })} testid={`${testid}-pattern`} />
          )}
        </div>
      )}
    </div>
  );
}

function NumInput({ label, value, onChange, testid }) {
  return (
    <label className="block">
      <div className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</div>
      <input type="number" className="or-input w-full text-[10px]" value={value}
        onChange={(e) => onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))} data-testid={testid} />
    </label>
  );
}
function StrInput({ label, value, onChange, placeholder, testid }) {
  return (
    <label className="block">
      <div className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</div>
      <input className="or-input w-full text-[10px]" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} data-testid={testid} />
    </label>
  );
}
function ColorInput({ label, value, onChange, testid }) {
  return (
    <label className="block">
      <div className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="flex gap-1">
        <input type="color" className="or-input shrink-0" style={{ width: 34, height: 26, padding: 0 }} value={value || "#00FF66"} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
        <input className="or-input flex-1 text-[10px]" value={value || ""} placeholder="#10E670" onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}
