/**
 * OurRealm — Portals 1.4 · RealmTransition
 * -----------------------------------------------------------------
 * Full-screen CSS fade overlay used when entering or exiting a Realm.
 * Purely visual — no side effects on the Three.js engine — so the
 * PortalEngine / TemplateRealm / hand-authored Realms all keep their
 * lifecycles untouched.
 *
 * Usage:
 *   const [transition, setTransition] = useState(null);
 *   ...
 *   setTransition({ phase: "entering", label: "Entering Rainforest" });
 *   ...
 *   <RealmTransition transition={transition} onDone={() => setTransition(null)} />
 *
 * Transition object shape:
 *   { phase: "entering" | "exiting", label?: string, accent?: string, durationMs?: number }
 *
 * Design notes:
 *   • Position: fixed at inset:0 → covers the WebXR DOM overlay too.
 *   • Uses only CSS animations → GPU-composited on mobile.
 *   • Respects prefers-reduced-motion.
 */
import React, { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

const DEFAULT_MS = 900;

export default function RealmTransition({ transition, onDone }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!transition) { setVisible(false); return undefined; }
    setVisible(true);
    const dur = transition.durationMs || DEFAULT_MS;
    const t = setTimeout(() => {
      setVisible(false);
      if (typeof onDone === "function") onDone(transition);
    }, dur);
    return () => clearTimeout(t);
  }, [transition, onDone]);

  if (!transition) return null;

  const accent = transition.accent || "#86efac";
  const label  = transition.label  || (transition.phase === "exiting" ? "Leaving Realm…" : "Entering Realm…");

  return (
    <div
      className={`or-realm-transition ${visible ? "is-visible" : ""} phase-${transition.phase || "entering"}`}
      data-testid={`realm-transition-${transition.phase || "entering"}`}
      aria-live="polite"
    >
      <div className="or-realm-transition-portal" style={{ "--accent": accent }}>
        <div className="or-realm-transition-ring" />
        <div className="or-realm-transition-ring or-realm-transition-ring-2" />
        <div className="or-realm-transition-core">
          <Sparkles size={18} />
        </div>
      </div>
      <div className="or-realm-transition-label">{label}</div>
      <TransitionStyles />
    </div>
  );
}

function TransitionStyles() {
  return (
    <style>{`
      .or-realm-transition {
        position: fixed; inset: 0;
        z-index: 100000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 24px;
        background: radial-gradient(60% 60% at 50% 50%, rgba(3,12,8,0.85), rgba(1,4,2,0.98));
        color: #ecfdf5;
        font-family: var(--font-display, "Inter", system-ui, sans-serif);
        opacity: 0;
        pointer-events: none;
        transition: opacity 260ms ease;
      }
      .or-realm-transition.is-visible {
        opacity: 1;
        pointer-events: auto;
      }
      .or-realm-transition.phase-exiting {
        background: radial-gradient(60% 60% at 50% 50%, rgba(1,4,2,0.9), rgba(3,8,6,1));
      }
      .or-realm-transition-portal {
        position: relative;
        width: 128px; height: 128px;
      }
      .or-realm-transition-ring {
        position: absolute; inset: 0;
        border-radius: 999px;
        border: 2px solid var(--accent, #86efac);
        box-shadow: 0 0 40px var(--accent, #86efac), 0 0 24px var(--accent, #86efac) inset;
        transform-origin: center center;
        will-change: transform, opacity;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transform: translateZ(0);
        -webkit-transform: translateZ(0);
        animation: or-realm-ring 1.4s ease-out infinite;
      }
      .or-realm-transition-ring-2 {
        animation-delay: 0.55s;
      }
      .or-realm-transition-core {
        position: absolute; inset: 42%;
        border-radius: 999px;
        background: var(--accent, #86efac);
        color: #04140b;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 24px var(--accent, #86efac);
        will-change: transform;
        transform: translateZ(0);
        animation: or-realm-core 1.4s ease-in-out infinite;
      }
      .or-realm-transition-label {
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: var(--accent, #86efac);
        text-shadow: 0 2px 12px rgba(0,0,0,0.6);
      }
      @keyframes or-realm-ring {
        from { transform: scale(0.5) translateZ(0); opacity: 0.9; }
        to   { transform: scale(1.9) translateZ(0); opacity: 0;   }
      }
      @keyframes or-realm-core {
        0%,100% { transform: scale(1)    translateZ(0); }
        50%     { transform: scale(1.15) translateZ(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .or-realm-transition-ring, .or-realm-transition-core { animation: none; }
      }
    `}</style>
  );
}
