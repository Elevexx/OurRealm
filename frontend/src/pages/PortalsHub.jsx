/**
 * Portals 1.0 — Hub page (/portals).
 *
 * Dynamic list rendered from /src/config/portals.js. Phase 1.0 ships:
 *   • Featured Rainforest Realm (AR) — live
 *   • Rainforest Realm (VR) — coming soon
 *
 * Visual style follows the futuristic neon-green Portals direction
 * defined in the brief.
 */
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Compass, Sparkles, Lock } from "lucide-react";
import { PORTALS, PORTAL_STATUS } from "../config/portals";

const isLive = (p) => p.status === PORTAL_STATUS.LIVE;

export default function PortalsHub() {
  const navigate = useNavigate();
  const featured = PORTALS.find((p) => p.portalId === "rainforest-ar");
  const others   = PORTALS.filter((p) => p.portalId !== "rainforest-ar");

  return (
    <div className="portals-hub-root" data-testid="portals-hub">
      <PortalsStyles />
      <div className="portals-hub-bg" aria-hidden="true">
        <div className="portals-hub-bg-rays" />
        <div className="portals-hub-bg-mist" />
      </div>

      <header className="portals-hub-header">
        <div className="portals-hub-brand">
          <Compass size={18} />
          <span>Portals · 1.0</span>
        </div>
        <h1 className="portals-hub-title">
          Step Through Reality
        </h1>
        <p className="portals-hub-subtitle">
          Portals let you enter immersive AR &amp; VR Realm experiences. Pick a destination,
          allow your camera, and the world around you transforms.
        </p>
      </header>

      {/* Featured card */}
      {featured && (
        <section className="portals-featured" data-testid="portals-featured">
          <div className="portals-featured-tag">
            <Sparkles size={12} /> Featured Realm · Live
          </div>
          <div className="portals-featured-grid">
            <div className="portals-featured-art" aria-hidden="true">
              <div className="portals-featured-art-leaves" />
              <div className="portals-featured-art-glow" />
              <div className="portals-featured-art-creatures">
                <span className="creature-mini" style={{ animationDelay: "0s"   }}>🦜</span>
                <span className="creature-mini" style={{ animationDelay: "0.6s" }}>🐆</span>
                <span className="creature-mini" style={{ animationDelay: "1.2s" }}>🐒</span>
                <span className="creature-mini" style={{ animationDelay: "1.8s" }}>🐊</span>
              </div>
            </div>
            <div className="portals-featured-body">
              <h2 className="portals-featured-title">{featured.realmName}</h2>
              <p className="portals-featured-blurb">{featured.hubBlurb}</p>
              <ul className="portals-featured-bullets">
                <li>Layered jungle holograms over your live camera feed</li>
                <li>River, caiman, jaguar, monkeys, macaws &amp; toucans</li>
                <li>Tilt your phone upward to peek through the canopy</li>
              </ul>
              <div className="portals-featured-cta-row">
                <button
                  type="button"
                  className="portals-cta-primary"
                  onClick={() => navigate(featured.route)}
                  data-testid="portals-cta-enter-ar"
                >
                  Enter AR Portal <ArrowRight size={14} />
                </button>
                <Link
                  to={featured.route}
                  className="portals-cta-secondary"
                  data-testid="portals-cta-route"
                >
                  Open {featured.route}
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Other portal cards (incl. VR coming soon) */}
      <section className="portals-grid" data-testid="portals-other-grid">
        {others.map((p) => (
          <article
            key={p.portalId}
            className={`portals-card ${isLive(p) ? "" : "portals-card-soon"}`}
            data-testid={`portals-card-${p.portalId}`}
          >
            <div className="portals-card-head">
              <span className="portals-card-mode">
                {p.supportedModes.includes("vr") ? "VR" : "AR"}
              </span>
              {isLive(p) ? (
                <span className="portals-card-pill portals-card-live">LIVE</span>
              ) : (
                <span className="portals-card-pill portals-card-pill-soon">
                  <Lock size={9} /> Coming Soon
                </span>
              )}
            </div>
            <h3 className="portals-card-title">{p.realmName}</h3>
            <p className="portals-card-blurb">{p.hubBlurb}</p>
            <div className="portals-card-foot">
              {isLive(p) ? (
                <Link to={p.route} className="portals-cta-secondary" data-testid={`portals-card-${p.portalId}-link`}>
                  Enter <ArrowRight size={12} />
                </Link>
              ) : (
                <Link
                  to={p.route}
                  className="portals-cta-secondary portals-cta-disabled"
                  data-testid={`portals-card-${p.portalId}-link`}
                >
                  Preview placeholder <ArrowRight size={12} />
                </Link>
              )}
            </div>
          </article>
        ))}
      </section>

      <footer className="portals-hub-foot">
        <p>More realms are launching soon. Portals are designed to host AR rainforests, VR oceans, holographic galleries, and beyond.</p>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared Portals styles. Kept inline so a future migration to a CSS
// module / styled-components system is trivial.
// ─────────────────────────────────────────────────────────────────────
function PortalsStyles() {
  return (
    <style>{`
      .portals-hub-root {
        position: relative;
        min-height: 100vh;
        padding: 28px 18px 64px;
        background: radial-gradient(1200px 700px at 20% -10%, #053a2a 0%, #021008 55%, #000 100%);
        color: #DCFCE7;
        font-family: var(--font-display, "Inter", system-ui, sans-serif);
        overflow: hidden;
      }
      .portals-hub-bg { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
      .portals-hub-bg-rays {
        position: absolute; inset: 0;
        background:
          radial-gradient(600px 600px at 80% 10%, rgba(134,239,172,0.18), transparent 65%),
          radial-gradient(400px 400px at 10% 80%, rgba(34,197,94,0.10), transparent 65%);
      }
      .portals-hub-bg-mist {
        position: absolute; inset: 0;
        background:
          repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0 2px, transparent 2px 22px);
        mix-blend-mode: screen;
      }
      .portals-hub-header {
        position: relative; z-index: 1;
        max-width: 980px; margin: 0 auto 28px;
        text-align: left;
      }
      .portals-hub-brand {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 12px; border-radius: 999px;
        background: rgba(34,197,94,0.10);
        border: 1px solid rgba(134,239,172,0.35);
        color: #86EFAC;
        font-size: 11px; letter-spacing: 0.20em; text-transform: uppercase; font-weight: 800;
      }
      .portals-hub-title {
        margin: 16px 0 8px;
        font-size: clamp(32px, 6vw, 56px);
        line-height: 1.05;
        font-weight: 900;
        background: linear-gradient(180deg, #ECFDF5 0%, #86EFAC 70%, #22C55E 100%);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .portals-hub-subtitle {
        max-width: 620px; color: #BBF7D0; font-size: 14px; line-height: 1.6;
      }

      .portals-featured {
        position: relative; z-index: 1;
        max-width: 980px; margin: 0 auto 28px;
        background: linear-gradient(180deg, rgba(20,83,45,0.55), rgba(6,40,21,0.7));
        border: 1px solid rgba(134,239,172,0.30);
        border-radius: 22px;
        padding: 20px;
        box-shadow:
          0 20px 60px rgba(0,0,0,0.5),
          inset 0 1px 0 rgba(255,255,255,0.05);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .portals-featured-tag {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 10px; letter-spacing: 0.20em; text-transform: uppercase; font-weight: 800;
        color: #86EFAC;
      }
      .portals-featured-grid {
        display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 14px;
      }
      @media (min-width: 760px) {
        .portals-featured-grid { grid-template-columns: 0.85fr 1.15fr; gap: 24px; }
      }
      .portals-featured-art {
        position: relative;
        min-height: 220px;
        border-radius: 16px;
        overflow: hidden;
        background:
          radial-gradient(220px 220px at 70% 70%, rgba(134,239,172,0.30), transparent 70%),
          radial-gradient(140px 140px at 30% 30%, rgba(34,197,94,0.20), transparent 70%),
          linear-gradient(180deg, #052e1e, #021410);
        border: 1px solid rgba(134,239,172,0.18);
      }
      .portals-featured-art-leaves {
        position: absolute; inset: 0;
        background:
          radial-gradient(circle at 30% 20%, #166534 0 14px, transparent 16px),
          radial-gradient(circle at 70% 30%, #14532d 0 18px, transparent 20px),
          radial-gradient(circle at 50% 70%, #15803d 0 16px, transparent 18px),
          radial-gradient(circle at 20% 80%, #166534 0 12px, transparent 14px);
        opacity: 0.7;
        filter: blur(0.4px);
      }
      .portals-featured-art-glow {
        position: absolute; inset: 0;
        background: radial-gradient(circle at 60% 50%, rgba(134,239,172,0.30), transparent 70%);
        animation: portals-glow 5s ease-in-out infinite alternate;
      }
      @keyframes portals-glow { from { opacity: 0.5; } to { opacity: 1; } }
      .portals-featured-art-creatures {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center; gap: 28px;
        font-size: 28px;
      }
      .creature-mini {
        animation: float-mini 3s ease-in-out infinite;
        filter: drop-shadow(0 0 8px rgba(134,239,172,0.5));
      }
      @keyframes float-mini {
        0%,100% { transform: translateY(0) rotate(0deg); }
        50%     { transform: translateY(-10px) rotate(4deg); }
      }
      .portals-featured-title { font-size: 24px; font-weight: 900; margin: 0; color: #ECFDF5; }
      .portals-featured-blurb { margin: 6px 0 8px; color: #BBF7D0; font-size: 13px; line-height: 1.55; }
      .portals-featured-bullets {
        margin: 8px 0 16px; padding-left: 18px; color: #A7F3D0; font-size: 13px; line-height: 1.7;
      }
      .portals-featured-cta-row { display: flex; flex-wrap: wrap; gap: 10px; }
      .portals-cta-primary {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 12px 18px;
        background: linear-gradient(180deg, #22C55E, #15803D);
        color: #022C1A;
        font-size: 13px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
        border: none; border-radius: 999px;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(34,197,94,0.35), inset 0 1px 0 rgba(255,255,255,0.25);
        transition: transform 150ms ease, box-shadow 150ms ease;
      }
      .portals-cta-primary:hover { transform: translateY(-1px); box-shadow: 0 10px 30px rgba(34,197,94,0.45); }
      .portals-cta-primary:active { transform: translateY(0); }
      .portals-cta-secondary {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 11px 16px;
        background: rgba(255,255,255,0.06);
        color: #ECFDF5;
        font-size: 12px; font-weight: 700;
        border: 1px solid rgba(134,239,172,0.30);
        border-radius: 999px;
        text-decoration: none;
        transition: background-color 150ms ease, border-color 150ms ease;
      }
      .portals-cta-secondary:hover { background: rgba(134,239,172,0.10); border-color: rgba(134,239,172,0.55); }
      .portals-cta-disabled { opacity: 0.7; }

      .portals-grid {
        position: relative; z-index: 1;
        max-width: 980px; margin: 0 auto;
        display: grid; gap: 14px;
        grid-template-columns: 1fr;
      }
      @media (min-width: 720px) { .portals-grid { grid-template-columns: 1fr 1fr; } }
      .portals-card {
        position: relative;
        padding: 18px;
        background: rgba(8,30,20,0.65);
        border: 1px solid rgba(134,239,172,0.18);
        border-radius: 18px;
        backdrop-filter: blur(8px);
      }
      .portals-card-soon { opacity: 0.92; }
      .portals-card-head {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 12px;
      }
      .portals-card-mode {
        font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 800;
        color: #86EFAC;
        padding: 3px 8px; border-radius: 6px;
        background: rgba(134,239,172,0.10);
        border: 1px solid rgba(134,239,172,0.30);
      }
      .portals-card-pill {
        font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 800;
        padding: 3px 8px; border-radius: 999px;
        display: inline-flex; align-items: center; gap: 4px;
      }
      .portals-card-live      { background: rgba(34,197,94,0.18); color: #22C55E; }
      .portals-card-pill-soon { background: rgba(167,139,250,0.16); color: #A78BFA; }
      .portals-card-title { font-size: 18px; font-weight: 900; margin: 0; color: #ECFDF5; }
      .portals-card-blurb { margin: 6px 0 14px; font-size: 12.5px; color: #BBF7D0; line-height: 1.55; }
      .portals-card-foot { display: flex; justify-content: flex-end; }

      .portals-hub-foot {
        position: relative; z-index: 1;
        max-width: 980px; margin: 32px auto 0;
        text-align: center;
        color: rgba(187,247,208,0.55); font-size: 11.5px;
      }
    `}</style>
  );
}
