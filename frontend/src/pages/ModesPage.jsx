import React from "react";
import { useNavigate } from "react-router-dom";
import { Check, Zap, Crown, Sparkles, Shield, ArrowRight } from "lucide-react";
import { useTheme, MODES } from "@/contexts/ThemeContext";
import { MODE_PREVIEW_IMG } from "@/data/mockData";

const MODE_INFO = {
  neon: {
    label: "NEON",
    sub: "Holographic Future",
    Icon: Zap,
    accent: "#2EA0FF",
    glow: "rgba(46,160,255,0.55)",
    img: MODE_PREVIEW_IMG.neon,
    bullets: ["Holographic widgets", "Floating glass panels", "Particle field + grid", "Futuristic creator aesthetic"],
    gradient: "linear-gradient(135deg, #2EA0FF 0%, #10E670 100%)",
    family: "'Unbounded', sans-serif",
  },
  business: {
    label: "BUSINESS",
    sub: "Executive Luxury",
    Icon: Crown,
    accent: "#C8A24A",
    glow: "rgba(200,162,74,0.55)",
    img: MODE_PREVIEW_IMG.business,
    bullets: ["White + cream backgrounds", "Gold and silver accents", "Frosted luxury cards", "Executive dashboards"],
    gradient: "linear-gradient(135deg, #D5B05A 0%, #8C7A3E 100%)",
    family: "'Playfair Display', serif",
  },
  millennium: {
    label: "MILLENNIUM",
    sub: "Y2K Optimism",
    Icon: Sparkles,
    accent: "#2EA0FF",
    glow: "rgba(46,160,255,0.55)",
    img: MODE_PREVIEW_IMG.millennium,
    bullets: ["Bright sky-blue gradients", "Glossy rounded panels", "Playful chrome buttons", "Original — never copies any OS"],
    gradient: "linear-gradient(180deg, #6CC4FF 0%, #2E78D6 100%)",
    family: "'Fredoka', sans-serif",
  },
  stealth: {
    label: "STEALTH",
    sub: "Tactical Intelligence",
    Icon: Shield,
    accent: "#00FF66",
    glow: "rgba(0,255,102,0.55)",
    img: MODE_PREVIEW_IMG.stealth,
    bullets: ["Grid + scan-line backdrop", "Terminal monospace fonts", "Corner-bracketed surfaces", "Radar widget signature"],
    gradient: "linear-gradient(135deg, #00FF66 0%, #00B23E 100%)",
    family: "'Share Tech Mono', monospace",
  },
};

export default function ModesPage() {
  const { mode, setMode } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="max-w-7xl mx-auto" data-testid="modes-page">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Choose your experience</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Modes</h1>
        <p className="mt-2 text-sm sm:text-base max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Switch the entire OurRealm app between four immersive experiences. The selected mode persists across every page — Home, Discover, For You, Profile, Messages, Wallet, and everywhere else.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        {MODES.map((m) => {
          const info = MODE_INFO[m];
          const Icon = info.Icon;
          const active = mode === m;
          return (
            <div
              key={m}
              role="button"
              tabIndex={0}
              onClick={() => setMode(m)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMode(m); } }}
              data-testid={`modes-card-${m}`}
              data-active={active}
              className="text-left or-surface overflow-hidden transition-all duration-300 cursor-pointer"
              style={{
                outline: active ? `2px solid ${info.accent}` : "none",
                outlineOffset: -2,
                transform: active ? "translateY(-2px)" : "none",
                boxShadow: active ? `0 0 28px ${info.glow}` : undefined,
              }}
            >
              <div className="relative h-44 sm:h-52 overflow-hidden">
                <img src={info.img} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 20%, ${info.accent}33 70%, rgba(0,0,0,0.7))` }} />
                <div
                  className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-extrabold"
                  style={{
                    background: info.gradient,
                    color: m === "business" ? "#fff" : "#0a0a0a",
                    letterSpacing: "0.22em",
                    boxShadow: `0 0 14px ${info.glow}`,
                    fontFamily: info.family,
                  }}
                >
                  {info.label}
                </div>
                {active && (
                  <span
                    className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: info.accent, color: "#0a0a0a" }}
                    data-testid={`modes-active-check-${m}`}
                  >
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] mb-1" style={{ color: "#cfe3ff" }}>{info.sub}</div>
                    <h3 className="text-2xl sm:text-3xl" style={{ fontFamily: info.family, fontWeight: 800, color: "#fff", textShadow: `0 0 18px ${info.glow}` }}>
                      {info.label}
                    </h3>
                  </div>
                  <Icon size={32} style={{ color: info.accent, filter: `drop-shadow(0 0 10px ${info.glow})` }} />
                </div>
              </div>
              <div className="p-5">
                <ul className="space-y-1.5 mb-4">
                  {info.bullets.map((b) => (
                    <li key={b} className="text-sm flex items-center gap-2" style={{ color: "var(--text-main)" }}>
                      <span className="w-1 h-1 rounded-full" style={{ background: info.accent }} />
                      {b}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <button
                    className="or-btn flex-1"
                    onClick={(e) => { e.stopPropagation(); setMode(m); }}
                    data-testid={`modes-apply-${m}`}
                  >
                    {active ? "Currently active" : "Apply mode"}
                  </button>
                  {active && (
                    <button
                      className="or-btn or-btn-ghost"
                      onClick={(e) => { e.stopPropagation(); navigate("/home"); }}
                      style={{ padding: "0.6rem 0.9rem", fontSize: "0.78rem" }}
                      data-testid={`modes-enter-${m}`}
                    >
                      Enter <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 or-surface p-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Tip: the OurRealm logo itself never changes between modes — only the surrounding UI re-themes. Your mode persists across sessions.
      </div>
    </div>
  );
}
