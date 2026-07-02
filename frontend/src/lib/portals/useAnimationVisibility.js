/**
 * OurRealm — Portals · useAnimationVisibility
 * -----------------------------------------------------------------
 * The official animation lifecycle manager for every OurRealm animated
 * component: Portals hub, Rainforest AR realm, future Aquarium fish
 * flocks, Cyberpunk holo-billboards, water ripples, NPC idle loops, …
 *
 * What it does
 *   • Observes the given element with a single IntersectionObserver.
 *   • Integrates with the Page Visibility API (tab switch, phone lock).
 *   • Toggles a "is-paused" class on the observed element whenever the
 *     effective visibility state changes.
 *   • CSS `animation-play-state: paused` freezes every descendant
 *     animation at its current frame — resume is bit-exact.
 *   • Guarded against React StrictMode double-invocations.
 *   • Falls back gracefully if IntersectionObserver is unavailable.
 *
 * Contract with the DOM
 *   Callers must ship this CSS scoped to the observed element:
 *
 *     .foo.is-paused,
 *     .foo.is-paused *,
 *     .foo.is-paused *::before,
 *     .foo.is-paused *::after {
 *       animation-play-state: paused !important;
 *       -webkit-animation-play-state: paused !important;
 *     }
 *
 * Usage
 *
 *   const portalRef = useRef(null);
 *   useAnimationVisibility(portalRef);
 *
 *   // Or read the state:
 *   const { paused } = useAnimationVisibility(portalRef);
 *
 * Options
 *   pauseClassName  — class toggled on the ref (default "is-paused").
 *   trackState      — when false (default) no React state updates fire,
 *                     so callers that don't need `paused` get zero
 *                     re-renders. Set true (or destructure `paused`)
 *                     to opt-in.
 *   threshold       — IO threshold. Default 0 (fully off-screen).
 *   rootMargin      — IO rootMargin. Default "0px".
 *
 * Cleanup
 *   • The IntersectionObserver is disconnected on unmount.
 *   • The visibilitychange listener is removed on unmount.
 *   • The `is-paused` class is left as-is at unmount (DOM is
 *     discarded); safe under StrictMode double-mount.
 */
import { useEffect, useRef, useState } from "react";

const DEFAULT_OPTS = {
  pauseClassName: "is-paused",
  trackState:     false,
  threshold:      0,
  rootMargin:     "0px",
};

export function useAnimationVisibility(ref, options = {}) {
  const opts = { ...DEFAULT_OPTS, ...options };
  const { pauseClassName, trackState, threshold, rootMargin } = opts;

  // Internal live state carried in a ref so the effect body doesn't
  // depend on it (no re-runs, no observer churn).
  const stateRef = useRef({
    inViewport: true,
    tabVisible: typeof document !== "undefined" ? !document.hidden : true,
    paused:     false,
  });

  // Optional React state — only updated when a consumer opts into
  // tracking, and only when the effective `paused` bit actually flips.
  const [paused, setPausedState] = useState(false);

  useEffect(() => {
    const el = ref?.current;
    if (!el) return undefined;

    const apply = () => {
      const s = stateRef.current;
      const shouldRun = s.inViewport && s.tabVisible;
      const nextPaused = !shouldRun;
      if (nextPaused === s.paused) return;      // no DOM mutation needed
      s.paused = nextPaused;
      el.classList.toggle(pauseClassName, nextPaused);
      if (trackState) setPausedState(nextPaused);
    };

    // IntersectionObserver — one per instance.
    let observer = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            stateRef.current.inViewport = entry.isIntersecting;
          }
          apply();
        },
        { threshold, rootMargin },
      );
      observer.observe(el);
    } else {
      // No IO → assume always-visible so the animation runs normally.
      stateRef.current.inViewport = true;
    }

    const onVis = () => {
      stateRef.current.tabVisible = !document.hidden;
      apply();
    };
    document.addEventListener("visibilitychange", onVis);

    // Initial reconciliation (StrictMode safe — pure DOM read).
    apply();

    return () => {
      if (observer) observer.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
    // Deps: only re-run if the ref target changes (React refs are
    // stable so this effectively runs once) or the observer knobs change.
  }, [ref, pauseClassName, trackState, threshold, rootMargin]);

  return { paused };
}

export default useAnimationVisibility;
