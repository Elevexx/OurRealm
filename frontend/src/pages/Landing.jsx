import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, LogIn, VenetianMask, ShieldCheck, Zap, Users } from "lucide-react";
import Logo, { LOGO_URL } from "@/components/Logo";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import ModePreviewArt from "@/components/ModePreviewArt";

// 4-mode grid — matches the reference Image 3 layout (TL/TR/BL/BR).
// Each quadrant now uses pure CSS/SVG art via <ModePreviewArt> instead of
// external photos — zero copyright risk, faster load, perfectly themed.
const QUADRANTS = [
  { mode: "neon",       label: "NEON MODE",       accent: "#B026FF", pos: "tl",
    overlay: "radial-gradient(ellipse at 30% 30%, rgba(176,38,255,0.18), rgba(10,5,20,0.55))" },
  { mode: "business",   label: "BUSINESS MODE",   accent: "#C8A24A", pos: "tr",
    overlay: "linear-gradient(135deg, rgba(255,250,240,0.20), rgba(220,195,130,0.18))" },
  { mode: "millennium", label: "MILLENNIUM MODE", accent: "#2EA0FF", pos: "bl",
    overlay: "linear-gradient(180deg, rgba(46,160,255,0.10), rgba(20,60,130,0.20))" },
  { mode: "stealth",    label: "STEALTH MODE",    accent: "#00FF66", pos: "br",
    overlay: "radial-gradient(ellipse at 70% 70%, rgba(0,255,102,0.14), rgba(5,8,7,0.55))" },
];

// Convert "#RRGGBB" → "rgba(R, G, B, a)". Used so the preview accent can
// drive translucent halos / shadows without copy-pasting per-mode rgba.
function hexA(hex, alpha = 1) {
  const h = (hex || "#000000").replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

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
  const { mode } = useTheme();
  const { user, isGuest, setGuest, logout } = useAuth();
  const [hover, setHover] = useState(null);
  // PREVIEW-only mode — clicking a quadrant changes the local preview accent
  // (center widget colors/glow/border/buttons), but does NOT change the
  // saved app mode. The saved mode is only persisted via the normal flow
  // on /modes after login.
  const [previewMode, setPreviewMode] = useState(mode || "neon");
  const isLoggedIn = !!user && !isGuest;
  const activePreview = QUADRANTS.find((q) => q.mode === previewMode) || QUADRANTS[0];

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

      {/* 4-mode quadrant grid (Image 3) — interactive, PREVIEW only */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2" data-testid="landing-mode-grid">
        {QUADRANTS.map((q) => {
          const active = previewMode === q.mode;
          const hovered = hover === q.mode;
          return (
            <button
              key={q.mode}
              data-testid={`landing-quadrant-${q.mode}`}
              data-active={active}
              aria-pressed={active}
              onClick={() => setPreviewMode(q.mode)}
              onMouseEnter={() => setHover(q.mode)}
              onMouseLeave={() => setHover(null)}
              className="relative overflow-hidden text-left"
              style={{
                outline: active ? `2px solid ${q.accent}` : "none",
                outlineOffset: -2,
                opacity: active ? 1 : hovered ? 0.92 : 0.6,
                transition: "opacity 0.35s ease, transform 0.7s ease",
              }}
            >
              {/* CSS/SVG mode preview (replaces external image) */}
              <div
                className="absolute inset-0 transition-transform duration-700"
                style={{
                  transform: hovered ? "scale(1.04)" : "scale(1.0)",
                  filter: active ? "saturate(1.25)" : "saturate(0.95)",
                }}
              >
                <ModePreviewArt mode={q.mode} />
              </div>
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
                    Preview
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
          className="pointer-events-auto w-full max-w-md flex flex-col items-center relative"
          data-testid="landing-center-panel"
        >
          {/* Mode-tinted ambient halo behind the center widget — re-skins on preview click */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 -z-10"
            style={{
              background: `radial-gradient(ellipse at 50% 38%, ${hexA(activePreview.accent, 0.32)} 0%, transparent 60%)`,
              transition: "background 360ms ease",
            }}
          />
          {/* Mode pill — shows which preview is active */}
          <div
            className="mb-4 inline-flex items-center gap-2 px-3 py-1"
            style={{
              border: `1px solid ${activePreview.accent}`,
              color: activePreview.accent,
              borderRadius: 999,
              fontSize: 10,
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              fontWeight: 800,
              transition: "color 280ms ease, border-color 280ms ease",
            }}
            data-testid="landing-preview-pill"
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: activePreview.accent, boxShadow: `0 0 10px ${activePreview.accent}` }} />
            {activePreview.label} · Preview
          </div>
          {/* Big square logo (Image 1) — drop-shadow re-skins on preview click */}
          <div
            className="w-full max-w-[320px] sm:max-w-[360px]"
            style={{
              filter: `drop-shadow(0 0 28px ${hexA(activePreview.accent, 0.55)}) drop-shadow(0 0 22px ${hexA(activePreview.accent, 0.35)})`,
              transition: "filter 360ms ease",
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

          {/* Welcome headline — gradient re-skins on preview click */}
          <h1
            className="mt-6 sm:mt-8 text-center"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(1.5rem, 3.4vw, 1.85rem)",
              letterSpacing: "0.32em",
              fontWeight: 800,
              background: `linear-gradient(90deg, ${activePreview.accent} 0%, ${activePreview.accent} 45%, #FFFFFF 100%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textShadow: `0 0 28px ${hexA(activePreview.accent, 0.45)}`,
              transition: "background 360ms ease, text-shadow 360ms ease",
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
            {isLoggedIn ? (
              <>
                <NeonPill
                  color="#10E670"
                  glow="rgba(16,230,112,0.45)"
                  Icon={UserPlus}
                  title={`CONTINUE AS @${(user.username || "you").toUpperCase()}`}
                  subtitle="Return to your realm"
                  onClick={() => navigate("/feed")}
                  testid="landing-continue-user"
                />
                <NeonPill
                  color="#FF3F5A"
                  glow="rgba(255,63,90,0.4)"
                  Icon={LogIn}
                  title="SIGN OUT"
                  subtitle="Leave this account"
                  onClick={async () => { await logout(); window.location.reload(); }}
                  testid="landing-signout"
                />
                <NeonPill
                  color="#B26BFF"
                  glow="rgba(178,107,255,0.45)"
                  Icon={VenetianMask}
                  title="BROWSE AS GUEST"
                  subtitle="Explore without limits"
                  onClick={() => { setGuest(true); navigate("/feed"); }}
                  testid="landing-guest-button"
                />
              </>
            ) : (
              <>
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
              </>
            )}
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
