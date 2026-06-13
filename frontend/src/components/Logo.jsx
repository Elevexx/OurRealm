import React from "react";

/**
 * OurRealm logo — uses the uploaded asset directly with no cropping,
 * clipping, recoloring, or distortion.
 *
 * The asset is a wide banner ("OurRealm MESSENGER") so we render it
 * height-based with auto width to preserve aspect ratio. No additional
 * wordmark text is added because the wordmark is baked into the image.
 */
const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/fdizcj4w_IMG_1211.jpeg";

// Intrinsic aspect ratio of the uploaded logo (width / height)
const LOGO_ASPECT = 344 / 120;

export default function Logo({
  size = 44,           // interpreted as HEIGHT in px
  withWordmark = true, // kept for API compat; the banner image always includes the wordmark
  className = "",
  tagline = false,     // when true, renders the "Live · Connect · Experience" line below
}) {
  /* eslint-disable no-unused-vars */
  const _wm = withWordmark; // intentionally unused (always part of the asset)
  /* eslint-enable no-unused-vars */
  const height = size;
  const width = Math.round(height * LOGO_ASPECT);
  return (
    <div className={`inline-flex flex-col items-start gap-0.5 ${className}`} data-testid="ourrealm-logo">
      <img
        src={LOGO_URL}
        alt="OurRealm"
        width={width}
        height={height}
        draggable={false}
        style={{
          height,
          width: "auto",
          display: "block",
          objectFit: "contain",
        }}
      />
      {tagline && (
        <div
          style={{
            fontSize: height * 0.16,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            fontFamily: "var(--font-body)",
          }}
        >
          Live · Connect · Experience
        </div>
      )}
    </div>
  );
}

export { LOGO_URL, LOGO_ASPECT };
