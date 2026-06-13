import React from "react";

/**
 * OurRealm — OFFICIAL MASTER LOGO.
 * Single source of truth for the brand across every page, favicon, manifest,
 * share preview, and splash screen. Uses the uploaded asset directly with no
 * cropping, recoloring, distortion, or competing shadows.
 *
 * The image is a square composition that contains the orbital hologram
 * cluster + the "OurRealm" wordmark + the "LIVE. CONNECT. EXPERIENCE."
 * tagline — already baked in. Do not add a separate wordmark anywhere.
 */
const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/s123exdm_4AA21A20-23F6-4B58-A5C1-C58EAD942F36.png";

export default function Logo({
  size = 44,
  className = "",
  // kept for API compat — the wordmark/tagline are part of the asset
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
        objectPosition: "center",
        flexShrink: 0,
        background: "transparent",
      }}
    />
  );
}

export { LOGO_URL };
