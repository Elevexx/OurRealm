/**
 * ColorCustomizer — lets users override the interface accent colors for the
 * currently active mode. Overrides persist per-mode on this device and are
 * applied globally via ThemeContext (inline CSS variables).
 */
import React from "react";
import { Palette, RotateCcw } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

const PRESETS = [
  "#2EA0FF", "#10E670", "#00FF66", "#C8A24A", "#C26BFF",
  "#FF3F5A", "#F4C84A", "#FF7A18", "#4DD2FF", "#FF5CCB",
];

function PickerRow({ label, varKey, value, onChange, testid }) {
  const current = value || getComputedStyle(document.documentElement).getPropertyValue(`--${varKey}`).trim() || "#2EA0FF";
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-sm w-28" style={{ color: "var(--text-main)" }}>{label}</span>
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(current) ? current : "#2EA0FF"}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 42, height: 32, border: "1px solid var(--border-col)", borderRadius: 8, background: "transparent", cursor: "pointer" }}
        aria-label={`Pick ${label} color`}
        data-testid={testid}
      />
      <span className="text-xs font-mono px-2 py-1 rounded" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }} data-testid={`${testid}-hex`}>
        {current.toUpperCase()}
      </span>
      <div className="flex gap-1.5 flex-wrap">
        {PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onChange(hex)}
            className="rounded-full"
            style={{
              width: 20, height: 20, background: hex,
              border: current.toLowerCase() === hex.toLowerCase() ? "2px solid var(--text-main)" : "1px solid var(--border-col)",
            }}
            aria-label={`Preset ${hex}`}
            data-testid={`${testid}-preset-${hex.slice(1).toLowerCase()}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function ColorCustomizer() {
  const { mode, customColors, setCustomColor, resetCustomColors } = useTheme();
  const hasOverride = !!(customColors.primary || customColors.secondary || customColors["text-main"]);

  return (
    <div className="or-surface p-5 mt-6" data-testid="modes-color-customizer">
      <div className="flex items-center gap-2 mb-1">
        <Palette size={18} style={{ color: "var(--primary)" }} />
        <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Customize your colors</h3>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Override the accent colors of the <b style={{ color: "var(--text-main)" }}>{mode.toUpperCase()}</b> mode.
        Changes apply instantly across the whole app and are saved per mode on this device.
      </p>
      <div className="space-y-3">
        <PickerRow label="Primary accent" varKey="primary" value={customColors.primary} onChange={(v) => setCustomColor("primary", v)} testid="modes-color-primary" />
        <PickerRow label="Secondary accent" varKey="secondary" value={customColors.secondary} onChange={(v) => setCustomColor("secondary", v)} testid="modes-color-secondary" />
        <PickerRow label="Text & icons" varKey="text-main" value={customColors["text-main"]} onChange={(v) => setCustomColor("text-main", v)} testid="modes-color-text" />
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          className="or-btn or-btn-ghost"
          onClick={resetCustomColors}
          disabled={!hasOverride}
          style={{ opacity: hasOverride ? 1 : 0.5, padding: "0.5rem 0.9rem", fontSize: "0.8rem" }}
          data-testid="modes-color-reset"
        >
          <RotateCcw size={13} /> Reset to {mode} defaults
        </button>
        {hasOverride && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="modes-color-override-note">
            Custom colors active for this mode
          </span>
        )}
      </div>
    </div>
  );
}
