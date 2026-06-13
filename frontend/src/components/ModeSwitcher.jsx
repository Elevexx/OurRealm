import React from "react";
import { useTheme, MODES } from "@/contexts/ThemeContext";

const MODE_STYLES = {
  cypher: {
    bg: "linear-gradient(135deg, #B026FF, #00F0FF)",
    color: "#fff",
    border: "1px solid rgba(0,240,255,0.5)",
    shadow: "0 0 18px rgba(176,38,255,0.6)",
    family: "'Unbounded', sans-serif",
  },
  business: {
    bg: "linear-gradient(135deg, #C5A24A, #8C7A3E)",
    color: "#fff",
    border: "1px solid rgba(181,147,59,0.5)",
    shadow: "0 6px 16px rgba(140,122,62,0.35)",
    family: "'Playfair Display', serif",
  },
  millennium: {
    bg: "linear-gradient(180deg, #6CA8F0, #2E6DD3)",
    color: "#fff",
    border: "2px solid #2E6DD3",
    shadow: "0 4px 0 rgba(46,109,211,0.45)",
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

export default function ModeSwitcher({ compact = false }) {
  const { mode, setMode } = useTheme();
  return (
    <div className="flex items-center gap-1.5 p-1 or-surface" data-testid="mode-switcher" style={{ borderRadius: 999 }}>
      {MODES.map((m) => {
        const s = MODE_STYLES[m];
        const active = mode === m;
        return (
          <button
            key={m}
            data-testid={`mode-switcher-${m}`}
            onClick={() => setMode(m)}
            className="transition-all duration-200"
            style={{
              padding: compact ? "0.3rem 0.7rem" : "0.45rem 0.95rem",
              borderRadius: 999,
              fontSize: compact ? "0.65rem" : "0.72rem",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontFamily: s.family,
              fontWeight: 700,
              background: active ? s.bg : "transparent",
              color: active ? s.color : "var(--text-muted)",
              border: active ? s.border : "1px solid transparent",
              boxShadow: active ? s.shadow : "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {m === "millennium" ? "Mill." : m.slice(0, compact ? 4 : 10)}
          </button>
        );
      })}
    </div>
  );
}

export { MODE_STYLES };
