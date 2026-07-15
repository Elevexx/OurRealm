/**
 * OurRealm — Portals /portals
 *
 * Phase 1.0 ships as an "Opening Soon" teaser. The full Portal browser
 * (featured Realms / search / friends inside / live users / previews)
 * will replace this file when Portals 1.0 launches. The existing AR
 * & VR routes (/realms/portals/ar, /realms/portals/vr) remain intact.
 *
 * Design targets:
 *   • Massive spinning neon-green energy portal, center of screen.
 *   • Dark futuristic backdrop with drifting dust + faint circuit lines.
 *   • Cycling loader statuses every 2s.
 *   • Notify-me button (shows a local toast; no backend yet).
 *   • CSS-only animations, mobile-first, 60fps friendly.
 *   • Pauses the JS status interval when the tab is hidden.
 */
import React, { useEffect, useRef, useState } from "react";
import { Bell, Sparkles } from "lucide-react";
import { useAnimationVisibility } from "@/lib/portals/useAnimationVisibility";

const STATUSES = [
  "Initializing Portal Network...",
  "Constructing Realms...",
  "Stabilizing Portal Energy...",
  "Preparing for Launch...",
];

export default function PortalsHub() {
  useEffect(() => {
    // Progression app-event: user visited the Portals page (deduped server-side)
    import("@/api/client").then(({ default: apiClient }) =>
      apiClient.post("/progression/app-event", { event_key: "portals_visited" }).catch(() => {}));
  }, []);
  const [statusIdx, setStatusIdx] = useState(0);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // Ref to the portal wrapper — the IntersectionObserver toggles the
  // is-paused class on this element which, via a single CSS descendant
  // rule, freezes every currently-and-future rotating layer at its
  // current rotation. animation-play-state preserves position (no reset).
  const portalRef = useRef(null);

  // Cycle statuses every 2s; pause when the tab is hidden to save CPU.
  useEffect(() => {
    let intervalId = null;
    const tick = () => setStatusIdx((i) => (i + 1) % STATUSES.length);
    const start = () => {
      if (!intervalId) intervalId = setInterval(tick, 2000);
    };
    const stop = () => {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    };
    const onVis = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Portal animation controller — pauses ALL rotating layers when the
  // portal is fully off-screen OR the browser tab is hidden / phone is
  // locked, and resumes from the exact rotation on re-entry. See
  // /lib/portals/useAnimationVisibility for the shared implementation.
  useAnimationVisibility(portalRef);

  const notify = () => {
    setToast("Portals are currently under development.");
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  };

  return (
    <div className="ph-root" data-testid="portals-hub">
      <PortalsStyles />

      {/* Background */}
      <div className="ph-bg" aria-hidden="true">
        <div className="ph-bg-grid" />
        <div className="ph-bg-fog" />
        <div className="ph-bg-vignette" />
        {/* Drifting dust motes — 18 cheap positioned spans */}
        {Array.from({ length: 18 }, (_, i) => (
          <span
            key={i}
            className="ph-dust"
            style={{
              left: `${(i * 47 + 8) % 100}%`,
              top:  `${(i * 29 + 12) % 100}%`,
              animationDuration: `${9 + (i % 6)}s`,
              animationDelay: `${(i % 5) * 0.7}s`,
              width:  `${2 + (i % 3)}px`,
              height: `${2 + (i % 3)}px`,
            }}
          />
        ))}
      </div>

      {/* Top branding */}
      <header className="ph-header" data-testid="portals-header">
        <div className="ph-brand">OurRealm</div>
        <div className="ph-tagline">LIVE · CONNECT · EXPERIENCE</div>
      </header>

      {/* Portal */}
      <main className="ph-main">
        <div className="ph-portal-wrap" data-testid="portals-portal" ref={portalRef}>
          {/* Outer thin ring (rotates opposite direction) */}
          <div className="ph-ring" aria-hidden="true" />
          {/* Outer bloom */}
          <div className="ph-bloom" aria-hidden="true" />
          {/* Rim particles orbiting */}
          <div className="ph-rim" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <span
                key={i}
                className="ph-rim-dot"
                style={{ transform: `rotate(${i * (360 / 14)}deg) translateX(var(--rim-r))` }}
              />
            ))}
          </div>
          {/* Vortex — layered conic gradients rotating at different speeds. */}
          <div className="ph-vortex ph-vortex-1" aria-hidden="true" />
          <div className="ph-vortex ph-vortex-2" aria-hidden="true" />
          <div className="ph-vortex ph-vortex-3" aria-hidden="true" />
          {/* Electric flicker + inner glow */}
          <div className="ph-electric" aria-hidden="true" />
          <div className="ph-core" aria-hidden="true">
            <Sparkles size={20} />
          </div>
        </div>

        <h1 className="ph-headline" data-testid="portals-headline">Opening Soon</h1>
        <p className="ph-desc">
          Step through the Portal into immersive shared Realms.<br />
          Our first generation of Portals is currently under construction.
        </p>

        <div className="ph-status" data-testid="portals-status" aria-live="polite">
          <span className="ph-status-dot" />
          <span key={statusIdx} className="ph-status-text">
            {STATUSES[statusIdx]}
          </span>
        </div>

        <button
          type="button"
          onClick={notify}
          className="ph-cta"
          data-testid="portals-notify-btn"
        >
          <Bell size={14} /> Notify Me When Portals Launch
        </button>
      </main>

      {/* Toast */}
      {toast && (
        <div className="ph-toast" data-testid="portals-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styles — all CSS. No external assets. GPU-only transforms/opacity.
// ─────────────────────────────────────────────────────────────────────
function PortalsStyles() {
  return (
    <style>{`
      .ph-root {
        position: relative;
        min-height: 100vh;
        min-height: 100dvh;
        overflow: hidden;
        background: #030608;
        color: #E6FFF3;
        font-family: var(--font-display, "Inter", system-ui, sans-serif);
        display: flex; flex-direction: column;
        /* Bottom padding clears the fixed BottomNav bar (~72px) plus safe-area. */
        padding: 24px 18px calc(96px + env(safe-area-inset-bottom, 0px));
      }

      /* Background layers */
      .ph-bg { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
      .ph-bg-grid {
        position: absolute; inset: 0;
        background-image:
          linear-gradient(rgba(34,197,94,0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(34,197,94,0.06) 1px, transparent 1px);
        background-size: 48px 48px;
        mask-image: radial-gradient(ellipse at center, black 40%, transparent 75%);
        -webkit-mask-image: radial-gradient(ellipse at center, black 40%, transparent 75%);
      }
      .ph-bg-fog {
        position: absolute; inset: 0;
        background:
          radial-gradient(50% 40% at 50% 60%, rgba(34,197,94,0.14), transparent 65%),
          radial-gradient(60% 50% at 20% 20%, rgba(20,83,45,0.20), transparent 70%),
          radial-gradient(50% 40% at 80% 80%, rgba(6,95,70,0.18), transparent 70%);
        animation: ph-fog 18s ease-in-out infinite alternate;
      }
      @keyframes ph-fog {
        from { transform: translate3d(-2%, 0, 0); }
        to   { transform: translate3d(2%, 1%, 0); }
      }
      .ph-bg-vignette {
        position: absolute; inset: 0;
        background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 90%);
      }
      .ph-dust {
        position: absolute;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(134,239,172,0.9), rgba(134,239,172,0) 70%);
        filter: drop-shadow(0 0 4px rgba(134,239,172,0.7));
        animation-name: ph-dust-drift;
        animation-iteration-count: infinite;
        animation-timing-function: linear;
        opacity: 0.75;
      }
      @keyframes ph-dust-drift {
        0%   { transform: translate3d(0,0,0); opacity: 0.2; }
        50%  { transform: translate3d(20px, -30px, 0); opacity: 0.8; }
        100% { transform: translate3d(-15px, 20px, 0); opacity: 0.2; }
      }

      /* Header */
      .ph-header {
        position: relative; z-index: 2;
        text-align: center;
      }
      .ph-brand {
        font-size: 22px; font-weight: 900; letter-spacing: 0.02em;
        background: linear-gradient(180deg, #ECFDF5, #86EFAC);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .ph-tagline {
        margin-top: 4px;
        font-size: 10px; letter-spacing: 0.32em; text-transform: uppercase; font-weight: 700;
        color: rgba(134,239,172,0.85);
      }

      /* Main flex container */
      .ph-main {
        position: relative; z-index: 2;
        flex: 1;
        display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
        gap: 14px;
        padding: 24px 0 8px;
      }

      /* Portal wrapper — sizes 200..420px */
      .ph-portal-wrap {
        --portal-size: clamp(200px, 44vmin, 420px);
        --rim-r: calc(var(--portal-size) / 2 - 8px);
        position: relative;
        width: var(--portal-size);
        height: var(--portal-size);
        border-radius: 999px;
      }

      /* IntersectionObserver-driven pause. Freezes every descendant
       * animation at its current position (animation-play-state:paused
       * DOES NOT reset the animation) so the portal resumes seamlessly
       * from the exact rotation when it re-enters the viewport OR the
       * tab is unlocked. Auto-covers every future rotating layer via
       * the descendant selector. */
      .ph-portal-wrap.is-paused,
      .ph-portal-wrap.is-paused *,
      .ph-portal-wrap.is-paused *::before,
      .ph-portal-wrap.is-paused *::after {
        animation-play-state: paused !important;
        -webkit-animation-play-state: paused !important;
      }

      /* Outer thin rotating ring */
      .ph-ring {
        position: absolute; inset: -14px;
        border-radius: 999px;
        border: 1px dashed rgba(134,239,172,0.65);
        box-shadow: 0 0 24px rgba(34,197,94,0.25) inset;
        transform-origin: center center;
        will-change: transform;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transform: translateZ(0);
        -webkit-transform: translateZ(0);
        animation: ph-spin-r 22s linear infinite;
      }

      /* Outer bloom */
      .ph-bloom {
        position: absolute; inset: -18%;
        border-radius: 999px;
        background: radial-gradient(circle,
          rgba(34,197,94,0.35) 0%,
          rgba(34,197,94,0.18) 30%,
          rgba(34,197,94,0.04) 55%,
          transparent 70%);
        filter: blur(6px);
        animation: ph-bloom 5s ease-in-out infinite alternate;
      }
      @keyframes ph-bloom {
        from { opacity: 0.65; transform: scale(1); }
        to   { opacity: 1;    transform: scale(1.05); }
      }

      /* Rim particles orbit */
      .ph-rim {
        position: absolute; inset: 0;
        border-radius: 999px;
        transform-origin: center center;
        will-change: transform;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transform: translateZ(0);
        -webkit-transform: translateZ(0);
        animation: ph-spin 14s linear infinite;
      }
      .ph-rim-dot {
        position: absolute;
        top: 50%; left: 50%;
        width: 6px; height: 6px; margin: -3px 0 0 -3px;
        border-radius: 999px;
        background: #BBF7D0;
        box-shadow: 0 0 8px #22C55E, 0 0 16px rgba(34,197,94,0.7);
      }

      /* Vortex — 3 conic-gradient layers spinning at different rates.
       * NOTE: on iOS Safari, elements combining conic-gradient +
       * mask-image + filter:blur() require explicit GPU-promotion hints
       * (translateZ / backface-visibility / will-change) or their
       * transform animation is silently skipped. Keep these in sync
       * across .ph-vortex-1/-2/-3 or the mobile spin will regress. */
      .ph-vortex {
        position: absolute; inset: 6%;
        border-radius: 999px;
        transform-origin: center center;
        will-change: transform;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transform: translateZ(0);
        -webkit-transform: translateZ(0);
        mask-image: radial-gradient(circle, black 40%, transparent 100%);
        -webkit-mask-image: radial-gradient(circle, black 40%, transparent 100%);
      }
      .ph-vortex-1 {
        background: conic-gradient(from 0deg,
          rgba(34,197,94,0.0),
          rgba(34,197,94,0.75) 30%,
          rgba(134,239,172,0.95) 55%,
          rgba(34,197,94,0.65) 75%,
          rgba(34,197,94,0.0) 100%);
        animation: ph-spin 8s linear infinite;
        filter: blur(2px);
      }
      .ph-vortex-2 {
        inset: 14%;
        background: conic-gradient(from 90deg,
          rgba(6,95,70,0.0),
          rgba(74,222,128,0.9) 40%,
          rgba(34,197,94,0.6) 70%,
          rgba(6,95,70,0.0) 100%);
        animation: ph-spin-r 5s linear infinite;
        filter: blur(1.5px);
      }
      .ph-vortex-3 {
        inset: 24%;
        background: conic-gradient(from 180deg,
          rgba(240,253,244,0.0),
          rgba(240,253,244,0.55) 35%,
          rgba(134,239,172,0.9) 60%,
          rgba(240,253,244,0.0) 100%);
        animation: ph-spin 3s linear infinite;
        filter: blur(1px);
      }
      /* Explicit from + to keyframes with translateZ(0) baked in so
       * the compositing layer is preserved across every frame. iOS
       * Safari fails to animate when only the "to" state is defined
       * AND the element has conic-gradient/mask/filter. */
      @keyframes ph-spin {
        from { transform: rotate(0deg)    translateZ(0); -webkit-transform: rotate(0deg)    translateZ(0); }
        to   { transform: rotate(360deg)  translateZ(0); -webkit-transform: rotate(360deg)  translateZ(0); }
      }
      @keyframes ph-spin-r {
        from { transform: rotate(0deg)    translateZ(0); -webkit-transform: rotate(0deg)    translateZ(0); }
        to   { transform: rotate(-360deg) translateZ(0); -webkit-transform: rotate(-360deg) translateZ(0); }
      }
      /* WebKit-prefixed keyframe copies for older Safari (iOS 15/16). */
      @-webkit-keyframes ph-spin {
        from { -webkit-transform: rotate(0deg)    translateZ(0); transform: rotate(0deg)    translateZ(0); }
        to   { -webkit-transform: rotate(360deg)  translateZ(0); transform: rotate(360deg)  translateZ(0); }
      }
      @-webkit-keyframes ph-spin-r {
        from { -webkit-transform: rotate(0deg)    translateZ(0); transform: rotate(0deg)    translateZ(0); }
        to   { -webkit-transform: rotate(-360deg) translateZ(0); transform: rotate(-360deg) translateZ(0); }
      }

      /* Electric flicker overlay */
      .ph-electric {
        position: absolute; inset: 18%;
        border-radius: 999px;
        background:
          radial-gradient(circle at 30% 30%, rgba(255,255,255,0.5), transparent 40%),
          radial-gradient(circle at 70% 60%, rgba(134,239,172,0.6), transparent 45%);
        mix-blend-mode: screen;
        animation: ph-flicker 2.2s ease-in-out infinite;
      }
      @keyframes ph-flicker {
        0%,100% { opacity: 0.85; }
        45%     { opacity: 0.35; }
        55%     { opacity: 1;    }
      }

      /* Central core */
      .ph-core {
        position: absolute; inset: 40%;
        display: flex; align-items: center; justify-content: center;
        border-radius: 999px;
        background: radial-gradient(circle, #F0FDF4 0%, #86EFAC 45%, #22C55E 80%, rgba(34,197,94,0) 100%);
        box-shadow: 0 0 40px #22C55E, 0 0 80px rgba(34,197,94,0.7);
        color: #052e1e;
        animation: ph-core-pulse 3.6s ease-in-out infinite;
      }
      @keyframes ph-core-pulse {
        0%,100% { transform: scale(1);    filter: brightness(1); }
        50%     { transform: scale(1.08); filter: brightness(1.15); }
      }

      /* Opening Soon headline */
      .ph-headline {
        font-size: clamp(28px, 6vw, 42px);
        font-weight: 900;
        letter-spacing: 0.02em;
        text-align: center;
        margin: 8px 0 0;
        background: linear-gradient(180deg, #ECFDF5, #86EFAC 70%, #22C55E);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
        text-shadow: 0 0 24px rgba(34,197,94,0.35);
        animation: ph-glow 3.6s ease-in-out infinite alternate;
      }
      @keyframes ph-glow {
        from { text-shadow: 0 0 18px rgba(34,197,94,0.25); }
        to   { text-shadow: 0 0 34px rgba(34,197,94,0.55); }
      }
      .ph-desc {
        text-align: center;
        color: #BBF7D0;
        font-size: 14px; line-height: 1.6;
        max-width: 460px;
        margin: 0 12px;
      }

      /* Status line */
      .ph-status {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 14px;
        background: rgba(6,20,14,0.65);
        border: 1px solid rgba(134,239,172,0.30);
        border-radius: 999px;
        color: #86EFAC;
        font-size: 12px; font-weight: 700; letter-spacing: 0.06em;
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      }
      .ph-status-dot {
        width: 8px; height: 8px; border-radius: 999px;
        background: #22C55E;
        box-shadow: 0 0 8px #22C55E;
        animation: ph-blink 1.6s ease-in-out infinite;
      }
      @keyframes ph-blink { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
      .ph-status-text {
        animation: ph-fade-in 480ms ease-out;
      }
      @keyframes ph-fade-in {
        from { opacity: 0; transform: translateY(2px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* CTA */
      .ph-cta {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 12px 18px;
        background: linear-gradient(180deg, #22C55E, #15803D);
        color: #022C1A;
        font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
        border: none; border-radius: 999px;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(34,197,94,0.40), inset 0 1px 0 rgba(255,255,255,0.25);
        transition: transform 150ms ease, box-shadow 150ms ease;
      }
      .ph-cta:hover  { transform: translateY(-1px); box-shadow: 0 12px 34px rgba(34,197,94,0.55); }
      .ph-cta:active { transform: translateY(0); }

      /* Toast — bottom offset clears the fixed BottomNav (~72px) on mobile. */
      .ph-toast {
        position: fixed;
        bottom: calc(88px + env(safe-area-inset-bottom, 0px));
        left: 50%; transform: translateX(-50%);
        padding: 12px 18px;
        background: rgba(6,20,14,0.90);
        border: 1px solid rgba(134,239,172,0.45);
        border-radius: 12px;
        color: #ECFDF5;
        font-size: 13px; font-weight: 600;
        box-shadow: 0 12px 32px rgba(0,0,0,0.55);
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        z-index: 100;
        animation: ph-fade-in 220ms ease-out;
      }

      /* Reduced-motion — pause every animation */
      @media (prefers-reduced-motion: reduce) {
        .ph-ring, .ph-rim, .ph-vortex, .ph-bloom, .ph-electric, .ph-core,
        .ph-headline, .ph-status-dot, .ph-bg-fog, .ph-dust {
          animation: none !important;
        }
      }

      /* Tablet / desktop spacing polish */
      @media (min-width: 768px) {
        .ph-root { padding-top: 40px; }
        .ph-brand { font-size: 26px; }
      }
    `}</style>
  );
}
