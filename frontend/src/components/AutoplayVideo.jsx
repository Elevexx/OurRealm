/**
 * AutoplayVideo — `<video>` that auto-plays muted when ≥50% in view and
 * pauses when scrolled out. Drop-in replacement for `<video src=… controls …/>`.
 * Used by Feed, PostPopup, Profile, RealmDetail.
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
      playsInline
      loop
      preload="metadata"
      className={className}
      style={style}
      data-testid={testid}
      {...rest}
    />
  );
}
