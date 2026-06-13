import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, LogIn, VenetianMask, ShieldCheck, Zap, Users } from "lucide-react";
import Logo, { LOGO_URL } from "@/components/Logo";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { MODE_PREVIEW_IMG } from "@/data/mockData";

// 4-mode grid — matches the reference Image 3 layout (TL/TR/BL/BR)
const QUADRANTS = [
  {
    mode: "neon",
    label: "NEON MODE",
    accent: "#B026FF",
    accentSoft: "rgba(176,38,255,0.18)",
    img: MODE_PREVIEW_IMG.neon,
    overlay: "radial-gradient(ellipse at 30% 30%, rgba(176,38,255,0.5), rgba(10,5,20,0.92))",
    pos: "tl",
  },
  {
    mode: "business",
    label: "BUSINESS MODE",
    accent: "#C8A24A",
    accentSoft: "rgba(200,162,74,0.20)",
    img: MODE_PREVIEW_IMG.business,
    overlay: "linear-gradient(135deg, rgba(255,250,240,0.85), rgba(220,195,130,0.55))",
    pos: "tr",
  },
  {
    mode: "millennium",
    label: "MILLENNIUM MODE",
    accent: "#2EA0FF",
    accentSoft: "rgba(46,160,255,0.22)",
    img: MODE_PREVIEW_IMG.millennium,
    overlay: "linear-gradient(180deg, rgba(46,160,255,0.55), rgba(20,60,130,0.75))",
    pos: "bl",
  },
  {
    mode: "stealth",
    label: "STEALTH MODE",
    accent: "#00FF66",
    accentSoft: "rgba(0,255,102,0.18)",
    img: MODE_PREVIEW_IMG.stealth,
    overlay: "radial-gradient(ellipse at 70% 70%, rgba(0,255,102,0.30), rgba(5,8,7,0.95))",
    pos: "br",
  },
];

// CTA button styled as a neon-outlined pill (matches reference Image 2)
function NeonPill({ color, glow, Icon, title, subtitle, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="w-full transition-all duration-200 group"
      style={{
        position: "relative",
        padding: "1rem 1.5rem",
        background: "rgba(8,12,20,0.55)",
        border: `2px solid ${color}`,
        borderRadius: 999,
        boxShadow: `0 0 18px ${glow}, inset 0 0 14px ${glow}`,
        color,
        cursor: "pointer",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 0 28px ${glow}, inset 0 0 22px ${glow}`; }}
      onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 0 18px ${glow}, inset 0 0 14px ${glow}`; }}
    >
      <div className="flex items-center gap-4">
        <Icon size={28} style={{ color, filter: `drop-shadow(0 0 8px ${glow})`, flexShrink: 0 }} />
        <div className="flex-1 text-left">
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "1.15rem",
              fontWeight: 800,
              letterSpacing: "0.16em",
              lineHeight: 1.1,
              color,
              textShadow: `0 0 12px ${glow}`,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: "0.78rem",
              color: "rgba(255,255,255,0.65)",
              marginTop: 3,
              fontFamily: "var(--font-body)",
              letterSpacing: "0.04em",
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { setGuest } = useAuth();
  const [hover, setHover] = useState(null);

  return (
    <div
      className="min-h-screen w-full relative overflow-hidden"
      data-testid="landing-page"
      style={{ background: "#04060A" }}
    >
      {/* Decorative circuitry dots/grid (matches reference) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(46,160,255,0.18) 1px, transparent 1.2px)," +
            "radial-gradient(circle at 1px 1px, rgba(16,230,112,0.10) 1px, transparent 1.2px)",
          backgroundSize: "32px 32px, 56px 56px",
          backgroundPosition: "0 0, 16px 28px",
          mask: "radial-gradient(ellipse at 50% 50%, black 30%, transparent 88%)",
          WebkitMask: "radial-gradient(ellipse at 50% 50%, black 30%, transparent 88%)",
          opacity: 0.55,
        }}
      />

      {/* 4-mode quadrant grid (Image 3) — interactive */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2" data-testid="landing-mode-grid">
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
              className="relative overflow-hidden text-left"
              style={{
                outline: active ? `2px solid ${q.accent}` : "none",
                outlineOffset: -2,
                opacity: hovered ? 0.95 : 0.55,
                transition: "opacity 0.4s ease, transform 0.7s ease",
              }}
            >
              <div
                className="absolute inset-0 transition-transform duration-700"
                style={{
                  backgroundImage: `url(${q.img})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  transform: hovered ? "scale(1.05)" : "scale(1.0)",
                  filter: active ? "saturate(1.4)" : "saturate(1.0)",
                }}
              />
              <div className="absolute inset-0" style={{ background: q.overlay }} />
              {/* Corner mode label */}
              <div
                className={`absolute p-5 sm:p-7 ${
                  q.pos === "tl" ? "top-0 left-0" :
                  q.pos === "tr" ? "top-0 right-0 text-right" :
                  q.pos === "bl" ? "bottom-0 left-0" : "bottom-0 right-0 text-right"
                }`}
              >
                <div
                  className="text-xs sm:text-sm font-extrabold"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: q.accent,
                    letterSpacing: "0.32em",
                    textShadow: `0 0 12px ${q.accent}`,
                  }}
                >
                  {q.label}
                </div>
                {active && (
                  <div
                    className="inline-block mt-2 text-[10px] tracking-[0.3em] uppercase px-2 py-0.5"
                    style={{ border: `1px solid ${q.accent}`, color: q.accent }}
                  >
                    Active mode
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Center floating panel — matches reference Image 2 structure */}
      <div className="pointer-events-none relative z-10 min-h-screen flex items-center justify-center px-4 py-10">
        <div
          className="pointer-events-auto w-full max-w-md flex flex-col items-center"
          data-testid="landing-center-panel"
        >
          {/* Big square logo (Image 1) */}
          <div
            className="w-full max-w-[320px] sm:max-w-[360px]"
            style={{
              filter:
                "drop-shadow(0 0 28px rgba(46,160,255,0.45)) drop-shadow(0 0 22px rgba(16,230,112,0.35))",
            }}
          >
            <img
              src={LOGO_URL}
              alt="OurRealm"
              className="block w-full h-auto"
              draggable={false}
              data-testid="landing-logo"
            />
          </div>

          {/* Welcome headline (blue → green gradient like reference) */}
          <h1
            className="mt-6 sm:mt-8 text-center"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(1.5rem, 3.4vw, 1.85rem)",
              letterSpacing: "0.32em",
              fontWeight: 800,
              background: "linear-gradient(90deg, #2EA0FF 0%, #2EA0FF 35%, #10E670 65%, #10E670 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textShadow: "0 0 28px rgba(46,160,255,0.35)",
            }}
            data-testid="landing-welcome"
          >
            WELCOME TO OURREALM
          </h1>
          <p
            className="mt-3 text-center"
            style={{
              fontFamily: "var(--font-body)",
              color: "rgba(220,235,255,0.75)",
              fontSize: "1.05rem",
              letterSpacing: "0.04em",
            }}
          >
            Live. Connect. Experience.
          </p>

          {/* Three neon-outlined CTA pills (matches reference Image 2) */}
          <div className="w-full mt-7 sm:mt-8 flex flex-col gap-4">
            <NeonPill
              color="#10E670"
              glow="rgba(16,230,112,0.45)"
              Icon={UserPlus}
              title="SIGN UP"
              subtitle="Create your realm"
              onClick={() => navigate("/signup")}
              testid="landing-signup-button"
            />
            <NeonPill
              color="#2EA0FF"
              glow="rgba(46,160,255,0.45)"
              Icon={LogIn}
              title="SIGN IN"
              subtitle="Welcome back"
              onClick={() => navigate("/signin")}
              testid="landing-signin-button"
            />
            <NeonPill
              color="#B26BFF"
              glow="rgba(178,107,255,0.45)"
              Icon={VenetianMask}
              title="BROWSE AS GUEST"
              subtitle="Explore without limits"
              onClick={() => { setGuest(true); navigate("/home"); }}
              testid="landing-guest-button"
            />
          </div>

          {/* Footer trust strip */}
          <div className="w-full mt-8 flex items-center justify-between gap-2 px-1 text-[10px] sm:text-xs">
            <div className="flex items-center gap-2" style={{ color: "rgba(220,235,255,0.6)", letterSpacing: "0.18em" }}>
              <ShieldCheck size={14} style={{ color: "#2EA0FF" }} />
              <span className="hidden sm:inline">SECURE</span>
              <span className="sm:hidden">SECURE</span>
            </div>
            <div className="h-3 w-px" style={{ background: "rgba(255,255,255,0.15)" }} />
            <div className="flex items-center gap-2" style={{ color: "rgba(220,235,255,0.6)", letterSpacing: "0.18em" }}>
              <Zap size={14} style={{ color: "#FFD24A" }} />
              <span>REAL-TIME</span>
            </div>
            <div className="h-3 w-px" style={{ background: "rgba(255,255,255,0.15)" }} />
            <div className="flex items-center gap-2" style={{ color: "rgba(220,235,255,0.6)", letterSpacing: "0.18em" }}>
              <Users size={14} style={{ color: "#10E670" }} />
              <span>GLOBAL</span>
            </div>
          </div>

          <div className="mt-5 text-[10px] tracking-[0.3em] uppercase" style={{ color: "rgba(220,235,255,0.45)" }}>
            Tap any quadrant to switch mode
          </div>
        </div>
      </div>
    </div>
  );
}

// Keep <Logo /> in scope so React's tree-shaker preserves it (used by app shell)
void Logo;
