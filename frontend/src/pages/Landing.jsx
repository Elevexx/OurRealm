import React, { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Static landing artwork — single full-screen image with three invisible,
// transparent click zones laid exactly over the artwork's buttons.
//
// The image's intrinsic dimensions are 1024 × 1536 → aspect ratio 2 : 3
// (NOT 9 : 16). The button-center positions below were measured directly
// from the source PNG via pixel scan, so overlays land exactly over the
// visible artwork pills at every viewport size.
const LANDING_IMAGE_URL =
  "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/4ivnshz0_B1C6C04B-2956-4B67-A6C4-7D5A87E77D8A.png";

// Pill geometry as % of the image (measured from 1024×1536 source).
// Generous horizontal width and slightly taller hit-zone for forgiving taps
// without overlapping the adjacent button.
const BUTTON_LEFT_PCT = 24;     // left edge
const BUTTON_WIDTH_PCT = 52;    // covers ~25%..77% horizontally
const BUTTON_HEIGHT_PCT = 7.5;  // ~7% measured + tiny pad; no overlap (gap ≈ 1.8%)
const BUTTONS = [
  { key: "signup", centerY: 67.45 },
  { key: "signin", centerY: 76.20 },
  { key: "guest",  centerY: 84.90 },
];

export default function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isGuest, isLoading, setGuest } = useAuth();
  const isLoggedIn = !!user && !isGuest;

  // Deep-link passthrough — when an authenticated user arrives at `/` with
  // ?to=/messages?dm=support (or ?next=…), bounce them straight to their
  // intended page so the landing never blocks the destination.
  useEffect(() => {
    if (isLoading || !isLoggedIn) return;
    const raw = searchParams.get("to") || searchParams.get("next");
    if (!raw) return;
    if (!raw.startsWith("/") || raw.startsWith("//")) return;
    navigate(raw, { replace: true });
  }, [isLoading, isLoggedIn, searchParams, navigate]);

  // Lock body scrolling while the landing is mounted so the page can never
  // scroll even if an ancestor has overflowing children. The fixed container
  // covers the viewport — this just neutralises rubber-banding / latent
  // scrollbars so all three tap zones remain fully reachable on iOS Safari.
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

  const handle = (key) => {
    if (key === "signup") return navigate("/signup");
    if (key === "signin") return navigate("/signin");
    // guest — set context flag first so the destination renders in guest mode.
    setGuest(true);
    navigate("/feed");
  };

  return (
    <>
      {/* CSS fallback cascade: prefer dynamic viewport units so mobile
          browser chrome (URL bar) is accounted for. Falls back to vh/vw on
          older browsers without dvh/dvw support.
          The stage uses the image's TRUE 2:3 aspect ratio (1024×1536), so the
          rendered image fills the stage exactly with no letterboxing — that
          means absolute-positioned overlays map perfectly onto the artwork. */}
      <style>{`
        .or-landing-root { width: 100vw; height: 100vh; }
        .or-landing-stage {
          width: min(100vw, calc(100vh * 2 / 3));
          height: min(100vh, calc(100vw * 3 / 2));
        }
        @supports (height: 100dvh) {
          .or-landing-root { width: 100dvw; height: 100dvh; }
          .or-landing-stage {
            width: min(100dvw, calc(100dvh * 2 / 3));
            height: min(100dvh, calc(100dvw * 3 / 2));
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
        <div
          className="or-landing-stage"
          style={{
            position: "relative",
          }}
        >
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

          {BUTTONS.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => handle(b.key)}
              data-testid={`landing-${b.key}-button`}
              aria-label={
                b.key === "signup"
                  ? "Sign Up"
                  : b.key === "signin"
                  ? "Sign In"
                  : "Browse as Guest"
              }
              style={{
                position: "absolute",
                left: `${BUTTON_LEFT_PCT}%`,
                width: `${BUTTON_WIDTH_PCT}%`,
                top: `${b.centerY - BUTTON_HEIGHT_PCT / 2}%`,
                height: `${BUTTON_HEIGHT_PCT}%`,
                background: "transparent",
                border: "none",
                outline: "none",
                padding: 0,
                margin: 0,
                cursor: "pointer",
                zIndex: 10,
                pointerEvents: "auto",
                borderRadius: 9999,
                boxShadow: "none",
                WebkitTapHighlightColor: "transparent",
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow =
                  "0 0 0 2px rgba(255,255,255,0.35)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
