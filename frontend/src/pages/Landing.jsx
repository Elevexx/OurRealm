import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "@/components/Logo";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { MODE_PREVIEW_IMG } from "@/data/mockData";

const QUADRANTS = [
  {
    mode: "cypher",
    label: "Cypher",
    sub: "Cyberpunk Future",
    img: MODE_PREVIEW_IMG.cypher,
    overlay: "radial-gradient(ellipse at center, rgba(176,38,255,0.35), rgba(5,5,10,0.92))",
    accent: "#B026FF",
    pos: "tl",
  },
  {
    mode: "business",
    label: "Business",
    sub: "Executive Luxury",
    img: MODE_PREVIEW_IMG.business,
    overlay: "linear-gradient(135deg, rgba(255,250,240,0.35), rgba(195,165,80,0.45))",
    accent: "#B5933B",
    pos: "tr",
  },
  {
    mode: "millennium",
    label: "Millennium",
    sub: "Y2K Nostalgia",
    img: MODE_PREVIEW_IMG.millennium,
    overlay: "linear-gradient(180deg, rgba(108,168,240,0.45), rgba(46,109,211,0.65))",
    accent: "#2E6DD3",
    pos: "bl",
  },
  {
    mode: "stealth",
    label: "Stealth",
    sub: "Tactical Intel",
    img: MODE_PREVIEW_IMG.stealth,
    overlay: "radial-gradient(ellipse at center, rgba(0,255,102,0.18), rgba(5,8,7,0.95))",
    accent: "#00FF66",
    pos: "br",
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { setGuest } = useAuth();
  const [hover, setHover] = useState(null);

  return (
    <div className="min-h-screen w-full relative overflow-hidden" data-testid="landing-page">
      {/* 4-quadrant background */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
        {QUADRANTS.map((q) => {
          const active = mode === q.mode;
          const hovered = hover === q.mode;
          return (
            <button
              key={q.mode}
              data-testid={`landing-quadrant-${q.mode}`}
              onClick={() => setMode(q.mode)}
              onMouseEnter={() => setHover(q.mode)}
              onMouseLeave={() => setHover(null)}
              className="relative overflow-hidden text-left transition-all duration-500 group"
              style={{
                outline: active ? `2px solid ${q.accent}` : "none",
                outlineOffset: -2,
              }}
            >
              <div
                className="absolute inset-0 transition-transform duration-700"
                style={{
                  backgroundImage: `url(${q.img})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  transform: hovered ? "scale(1.06)" : "scale(1.0)",
                  filter: active ? "saturate(1.4)" : "saturate(1.1)",
                }}
              />
              <div className="absolute inset-0" style={{ background: q.overlay }} />
              {/* Mode label */}
              <div
                className={`absolute p-6 sm:p-10 ${
                  q.pos === "tl" ? "top-0 left-0" :
                  q.pos === "tr" ? "top-0 right-0 text-right" :
                  q.pos === "bl" ? "bottom-0 left-0" : "bottom-0 right-0 text-right"
                }`}
                style={{ color: q.mode === "business" ? "#1A1A1A" : "#fff" }}
              >
                <div
                  className="text-[10px] sm:text-xs uppercase tracking-[0.3em] opacity-80 mb-2"
                  style={{ fontFamily: "'Chivo', sans-serif" }}
                >
                  {q.sub}
                </div>
                <div
                  className="text-3xl sm:text-5xl lg:text-6xl font-black"
                  style={{
                    fontFamily:
                      q.mode === "business" ? "'Playfair Display', serif" :
                      q.mode === "millennium" ? "'Fredoka', sans-serif" :
                      q.mode === "stealth" ? "'Share Tech Mono', monospace" :
                      "'Unbounded', sans-serif",
                    textShadow: q.mode === "business" ? "none" : `0 0 24px ${q.accent}55`,
                  }}
                >
                  {q.label}
                </div>
                {active && (
                  <div className="mt-2 inline-block text-[10px] tracking-[0.25em] uppercase px-2 py-1"
                    style={{ border: `1px solid ${q.accent}`, color: q.accent }}>
                    Active mode
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Center floating panel — wrapper must NOT intercept clicks on the quadrants beneath */}
      <div className="pointer-events-none relative z-10 min-h-screen flex items-center justify-center px-4">
        <div
          className="pointer-events-auto or-surface w-full max-w-md p-8 sm:p-10 text-center grain"
          style={{
            background: "color-mix(in srgb, var(--surface-2) 92%, transparent)",
            backdropFilter: "blur(28px)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.45), var(--shadow-glow)",
          }}
          data-testid="landing-center-panel"
        >
          <div className="flex justify-center mb-4 animate-float">
            <Logo size={80} />
          </div>
          <h1
            className="text-4xl sm:text-5xl mb-2"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-main)", letterSpacing: "-0.02em" }}
          >
            Our<span style={{ color: "var(--primary)" }}>Realm</span>
          </h1>
          <p
            className="text-sm sm:text-base mb-7 tracking-widest uppercase"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-body)" }}
          >
            Live. Connect. Experience.
          </p>
          <div className="flex flex-col gap-3">
            <button
              data-testid="landing-signup-button"
              className="or-btn w-full"
              onClick={() => navigate("/signup")}
            >
              Sign up
            </button>
            <button
              data-testid="landing-signin-button"
              className="or-btn or-btn-ghost w-full"
              onClick={() => navigate("/signin")}
            >
              Sign in
            </button>
            <button
              data-testid="landing-guest-button"
              className="w-full text-sm py-2.5"
              style={{ color: "var(--text-muted)", textDecoration: "underline", textUnderlineOffset: 4 }}
              onClick={() => { setGuest(true); navigate("/feed"); }}
            >
              Browse as guest
            </button>
          </div>
          <div className="mt-6 text-[10px] tracking-[0.25em] uppercase" style={{ color: "var(--text-muted)" }}>
            Click any quadrant to switch mode
          </div>
        </div>
      </div>
    </div>
  );
}
