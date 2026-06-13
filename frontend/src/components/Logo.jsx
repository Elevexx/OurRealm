import React from "react";

/**
 * OurRealm — official square logo (Image 1).
 * Uses the uploaded asset directly with no cropping, recoloring, or distortion.
 * The square format has the wordmark "OurRealm — LIVE. CONNECT. EXPERIENCE."
 * baked into the bottom portion of the image.
 */
const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/4ivnshz0_B1C6C04B-2956-4B67-A6C4-7D5A87E77D8A.png";

export default function Logo({
  size = 44,
  className = "",
  // kept for API compat — the wordmark is part of the asset
  withWordmark = true, // eslint-disable-line no-unused-vars
  tagline = false,     // eslint-disable-line no-unused-vars
}) {
  return (
    <img
      src={LOGO_URL}
      alt="OurRealm"
      width={size}
      height={size}
      draggable={false}
      data-testid="ourrealm-logo"
      className={className}
      style={{
        width: size,
        height: size,
        display: "block",
        objectFit: "contain",
        flexShrink: 0,
      }}
    />
  );
}

export { LOGO_URL };
