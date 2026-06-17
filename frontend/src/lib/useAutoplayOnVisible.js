/** useAutoplayOnVisible — IntersectionObserver-based media autoplay.
 * Attach the returned ref to a <video> or <img> (for GIFs). When ≥50%
 * of the element enters the viewport, video.play() is called (muted);
 * when it leaves, video.pause(). Cheap, no scroll listeners.
 */
import { useEffect, useRef } from "react";

export function useAutoplayOnVisible({ threshold = 0.5 } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const isVideo = el.tagName === "VIDEO";
    if (isVideo) {
      el.muted = true;
      el.playsInline = true;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            if (isVideo) el.play?.().catch(() => {});
            // GIFs: nothing to do — img plays automatically; we'd need a
            // canvas trick to pause GIFs which is too heavy here.
          } else if (isVideo) {
            el.pause?.();
          }
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return ref;
}
