import React, { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Static landing artwork — single full-screen image with three invisible,
// transparent click zones laid exactly over the artwork's buttons. The image
// has an intrinsic 9:16 portrait aspect ratio, so we render it inside a
// centered aspect-ratio container so the entire artwork is always visible
// (no cropping, no stretching) regardless of viewport size. Click-zone
// percentages are referenced against the container, so they stay aligned
// across breakpoints.
const LANDING_IMAGE_URL =
  "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/4ivnshz0_B1C6C04B-2956-4B67-A6C4-7D5A87E77D8A.png";

// Button geometry (percentages of container width / height) measured from the
// artwork. Buttons are equal-width pills centered horizontally.
const BUTTON_LEFT_PCT = 17.5;
const BUTTON_WIDTH_PCT = 65; // right edge ~82.5%
const BUTTON_HEIGHT_PCT = 8;
const BUTTONS = [
  { key: "signup", centerY: 67.8 },
  { key: "signin", centerY: 77.2 },
  { key: "guest",  centerY: 86.6 },
];

export default function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isGuest, isLoading, setGuest } = useAuth();
  const isLoggedIn = !!user && !isGuest;

  // Deep-link passthrough — when an authenticated user arrives at `/` with
  // ?to=/messages?dm=support (or ?next=…), bounce them straight to their
  // intended page so the landing never blocks the destination. Only allow
  // same-origin internal paths.
  useEffect(() => {
    if (isLoading || !isLoggedIn) return;
    const raw = searchParams.get("to") || searchParams.get("next");
    if (!raw) return;
    if (!raw.startsWith("/") || raw.startsWith("//")) return;
    navigate(raw, { replace: true });
  }, [isLoading, isLoggedIn, searchParams, navigate]);

  const handle = (key) => {
    if (key === "signup") return navigate("/signup");
    if (key === "signin") return navigate("/signin");
    // guest
    setGuest(true);
    navigate("/home");
  };

  return (
    <div
      data-testid="landing-page"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Aspect-ratio container — fills the viewport while preserving 9:16.
          The entire image is always visible (object-fit equivalent of contain),
          and the overlay buttons are positioned relative to this container so
          they remain perfectly aligned with the artwork. */}
      <div
        style={{
          position: "relative",
          // Maintain 9:16 portrait aspect-ratio. The whole image is always
          // visible, scaling to fit both viewport axes without distortion.
          //  - On wide viewports (desktop 16:9) → constrained by height.
          //  - On tall viewports (narrow phones) → constrained by width.
          width: "min(100vw, calc(100vh * 9 / 16))",
          height: "min(100vh, calc(100vw * 16 / 9))",
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
            objectFit: "contain",
            userSelect: "none",
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
              // Pill-shaped tap area so the focus/hover ring follows the artwork.
              borderRadius: 9999,
              // Keep invisible by default; show a subtle focus ring for a11y.
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
  );
}
