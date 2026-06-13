import React from "react";
import { useTheme, MODES } from "@/contexts/ThemeContext";

const MODE_STYLES = {
  neon: {
    bg: "linear-gradient(135deg, #2EA0FF, #10E670)",
    color: "#07111E",
    border: "1px solid rgba(46,160,255,0.55)",
    shadow: "0 0 18px rgba(46,160,255,0.55), 0 0 12px rgba(16,230,112,0.4)",
    family: "'Unbounded', sans-serif",
  },
  business: {
    bg: "linear-gradient(135deg, #D5B05A, #8C7A3E)",
    color: "#fff",
    border: "1px solid rgba(181,147,59,0.5)",
    shadow: "0 6px 16px rgba(140,122,62,0.35)",
    family: "'Playfair Display', serif",
  },
  millennium: {
    bg: "linear-gradient(180deg, #6CC4FF, #2EA0FF)",
    color: "#fff",
    border: "2px solid #2EA0FF",
    shadow: "0 4px 0 rgba(7,17,38,0.45)",
    family: "'Fredoka', sans-serif",
  },
  stealth: {
    bg: "transparent",
    color: "#00FF66",
    border: "1px solid #00FF66",
    shadow: "0 0 12px rgba(0,255,102,0.35)",
    family: "'Share Tech Mono', monospace",
  },
};

const LABEL = { neon: "Neon", business: "Business", millennium: "Mill.", stealth: "Stealth" };

export default function ModeSwitcher({ compact = false }) {
  const { mode, setMode } = useTheme();
  return (
    <div
      className="flex items-center gap-1 p-1 or-surface no-scrollbar"
      data-testid="mode-switcher"
      style={{
        borderRadius: 999,
        maxWidth: "100%",
        overflowX: "auto",
        scrollSnapType: "x mandatory",
      }}
    >
      {MODES.map((m) => {
        const s = MODE_STYLES[m];
        const active = mode === m;
        return (
          <button
            key={m}
            data-testid={`mode-switcher-${m}`}
            onClick={() => setMode(m)}
            className="transition-all duration-200 shrink-0"
            style={{
              padding: compact ? "0.3rem 0.65rem" : "0.4rem 0.8rem",
              borderRadius: 999,
              fontSize: compact ? "0.62rem" : "0.7rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontFamily: s.family,
              fontWeight: 700,
              background: active ? s.bg : "transparent",
              color: active ? s.color : "var(--text-muted)",
              border: active ? s.border : "1px solid transparent",
              boxShadow: active ? s.shadow : "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              scrollSnapAlign: "start",
            }}
          >
            {LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

export { MODE_STYLES };
