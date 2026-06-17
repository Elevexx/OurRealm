/**
 * AutoplayVideo — `<video>` that auto-plays muted when ≥50% in view and
 * pauses when scrolled out. Drop-in replacement for `<video src=… controls …/>`.
 * Used by Feed, PostPopup, Profile, RealmDetail.
 *
 * iOS Safari specifically requires BOTH the `autoPlay` attribute on the
 * element AND `muted` + `playsInline` to be in the initial HTML — without
 * the explicit attribute the browser short-circuits the load and renders
 * a crossed-out play badge even though our IntersectionObserver would
 * have called `.play()` shortly after. So we set all four declaratively.
 */
import React from "react";
import { useAutoplayOnVisible } from "@/lib/useAutoplayOnVisible";

export default function AutoplayVideo({
  src,
  controls = true,
  className = "",
  style,
  testid,
  ...rest
}) {
  const ref = useAutoplayOnVisible({ threshold: 0.5 });
  return (
    <video
      ref={ref}
      src={src}
      controls={controls}
      muted
      autoPlay
      playsInline
      loop
      preload="metadata"
      // iOS-specific attributes that must live on the DOM element to be
      // honoured before React's effect phase runs.
      // eslint-disable-next-line react/no-unknown-property
      webkit-playsinline="true"
      // eslint-disable-next-line react/no-unknown-property
      x5-playsinline="true"
      className={className}
      style={style}
      data-testid={testid}
      {...rest}
    />
  );
}
