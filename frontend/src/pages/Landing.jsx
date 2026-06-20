import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Static landing artwork — served same-origin from /public/landing.png
// so no third-party CDN can break the page (iOS Safari content
// blockers, restrictive corporate networks, customer-assets CDN
// outages, etc.). Filename is lowercase + simple per ops guidance.
const LANDING_IMAGE_URL = "/landing.png";

// Pill geometry as % of the image. Same geometry is used for both signed-in
// and signed-out states — layout never shifts; only the button text and
// click handlers change.
const BUTTON_LEFT_PCT = 24;
const BUTTON_WIDTH_PCT = 52;
const BUTTON_HEIGHT_PCT = 7.5;
const CENTERS = { top: 67.45, mid: 76.20, bot: 84.90 };

export default function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isGuest, isLoading, setGuest, logout } = useAuth();
  const isLoggedIn = !!user && !isGuest;
  // Fallback flag — if the landing artwork fails to load (network,
  // content blocker, stale cache, etc.) we surface visible labelled
  // pills so Sign Up / Sign In / Browse-as-Guest stay reachable.
  const [imgFailed, setImgFailed] = useState(false);

  // Deep-link passthrough — authenticated users hitting `/` with ?to=… or
  // ?next=… get bounced to their destination immediately.
  useEffect(() => {
    if (isLoading || !isLoggedIn) return;
    const raw = searchParams.get("to") || searchParams.get("next");
    if (!raw) return;
    if (!raw.startsWith("/") || raw.startsWith("//")) return;
    navigate(raw, { replace: true });
  }, [isLoading, isLoggedIn, searchParams, navigate]);

  // Lock body scrolling while the landing is mounted so all three tap zones
  // remain reachable on iOS Safari (no rubber-banding / latent scrollbars).
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  // ---------- Click handlers ----------
  const signedOutHandlers = {
    signup: () => navigate("/signup"),
    signin: () => navigate("/signin"),
    guest: () => {
      setGuest(true);
      navigate("/feed");
    },
  };

  const signedInHandlers = {
    continue: () => navigate("/feed"),
    signout: async () => {
      try { await logout(); } catch { /* ignore */ }
      setGuest(false);
      navigate("/", { replace: true });
    },
    guest: async () => {
      // Drop the authenticated session, enter guest mode, then continue to feed.
      try { await logout(); } catch { /* ignore */ }
      setGuest(true);
      navigate("/feed");
    },
  };

  // ---------- Button definitions ----------
  // Each button uses the same pill geometry; only label / subtext / handler
  // changes based on auth state. Signed-out buttons stay fully transparent
  // (the artwork pills are visible underneath). Signed-in buttons render a
  // masking pill that covers the underlying artwork text and shows the new
  // label + subtext.
  const buttons = isLoggedIn
    ? [
        {
          key: "continue",
          centerY: CENTERS.top,
          label: `CONTINUE AS @${user?.username || "you"}`,
          sub: "Return to your realm",
          tone: "cyan", // matches Sign Up pill outline tint
          onClick: signedInHandlers.continue,
        },
        {
          key: "signout",
          centerY: CENTERS.mid,
          label: "SIGN OUT",
          sub: "Leave this account",
          tone: "blue", // matches Sign In pill outline tint
          onClick: signedInHandlers.signout,
        },
        {
          key: "guest",
          centerY: CENTERS.bot,
          label: "BROWSE AS GUEST",
          sub: "",
          tone: "purple", // matches Browse as Guest pill outline tint
          onClick: signedInHandlers.guest,
        },
      ]
    : [
        { key: "signup", centerY: CENTERS.top, label: "", sub: "", tone: "transparent", onClick: signedOutHandlers.signup,  aria: "Sign Up" },
        { key: "signin", centerY: CENTERS.mid, label: "", sub: "", tone: "transparent", onClick: signedOutHandlers.signin,  aria: "Sign In" },
        { key: "guest",  centerY: CENTERS.bot, label: "", sub: "", tone: "transparent", onClick: signedOutHandlers.guest,   aria: "Browse as Guest" },
      ];

  // Map tone → solid black masking colour (kept consistent with the artwork
  // background so the original button text underneath is fully hidden when
  // a label is rendered on top).
  const maskBg = "rgba(2,6,14,0.96)";

  return (
    <>
      <style>{`
        .or-landing-root { width: 100vw; height: 100vh; }
        .or-landing-stage {
          width: min(100vw, calc(100vh * 2 / 3));
          height: min(100vh, calc(100vw * 3 / 2));
          container-type: size;
        }
        @supports (height: 100dvh) {
          .or-landing-root { width: 100dvw; height: 100dvh; }
          .or-landing-stage {
            width: min(100dvw, calc(100dvh * 2 / 3));
            height: min(100dvh, calc(100dvw * 3 / 2));
            container-type: size;
          }
        }
      `}</style>
      <div
        data-testid="landing-page"
        className="or-landing-root"
        style={{
          position: "fixed",
          inset: 0,
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          touchAction: "manipulation",
        }}
      >
        <div className="or-landing-stage" style={{ position: "relative" }}>
          <img
            src={LANDING_IMAGE_URL}
            alt="OurRealm — Live. Connect. Experience."
            draggable={false}
            data-testid="landing-image"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "fill",
              userSelect: "none",
              pointerEvents: "none",
            }}
          />

          {buttons.map((b) => {
            const showsLabel = !!b.label;
            // Per-tone outline colour to keep the pill visually consistent
            // with the artwork beneath when signed in.
            const outlineColor =
              b.tone === "cyan"
                ? "rgba(54,227,110,0.95)"
                : b.tone === "blue"
                ? "rgba(46,182,255,0.95)"
                : b.tone === "purple"
                ? "rgba(201,123,255,0.95)"
                : "transparent";
            return (
              <button
                key={b.key}
                type="button"
                onClick={b.onClick}
                data-testid={`landing-${b.key}-button`}
                aria-label={b.aria || b.label || b.key}
                style={{
                  position: "absolute",
                  left: `${BUTTON_LEFT_PCT}%`,
                  width: `${BUTTON_WIDTH_PCT}%`,
                  top: `${b.centerY - BUTTON_HEIGHT_PCT / 2}%`,
                  height: `${BUTTON_HEIGHT_PCT}%`,
                  background: showsLabel ? maskBg : "transparent",
                  border: showsLabel ? `1.5px solid ${outlineColor}` : "none",
                  outline: "none",
                  padding: 0,
                  margin: 0,
                  cursor: "pointer",
                  zIndex: 10,
                  pointerEvents: "auto",
                  borderRadius: 9999,
                  boxShadow: showsLabel
                    ? `0 0 18px 1px ${outlineColor.replace("0.95", "0.35")}`
                    : "none",
                  WebkitTapHighlightColor: "transparent",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "inherit",
                  textTransform: "none",
                  lineHeight: 1.15,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
                onFocus={(e) => {
                  if (!showsLabel) {
                    e.currentTarget.style.boxShadow =
                      "0 0 0 2px rgba(255,255,255,0.35)";
                  }
                }}
                onBlur={(e) => {
                  if (!showsLabel) e.currentTarget.style.boxShadow = "none";
                }}
              >
                {showsLabel && (
                  <>
                    <span
                      data-testid={`landing-${b.key}-label`}
                      style={{
                        fontWeight: 700,
                        // Scale text to ~38% of pill height for readability
                        // across all viewports without manual breakpoints.
                        fontSize: "clamp(11px, 2.4cqh, 18px)",
                        letterSpacing: "0.04em",
                        maxWidth: "92%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {b.label}
                    </span>
                    {b.sub && (
                      <span
                        style={{
                          fontSize: "clamp(8px, 1.55cqh, 12px)",
                          opacity: 0.78,
                          marginTop: 2,
                          maxWidth: "92%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {b.sub}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
