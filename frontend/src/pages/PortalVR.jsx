/**
 * Portals 1.0 — VR Coming Soon placeholder (/realms/portals/vr).
 *
 * Reserved route for the future WebXR / Unity build. Reuses the Portals
 * Hub aesthetic so the user immediately recognizes it as part of the
 * same system.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Hexagon, Lock } from "lucide-react";

export default function PortalVR() {
  return (
    <div className="portal-vr-root" data-testid="portal-vr">
      <style>{`
        .portal-vr-root {
          min-height: 100vh;
          background: radial-gradient(900px 500px at 30% -10%, #1a0c5e 0%, #06031a 55%, #000 100%);
          color: #E9D5FF;
          display: flex; align-items: center; justify-content: center;
          padding: 32px 18px;
          font-family: var(--font-display, "Inter", system-ui, sans-serif);
        }
        .portal-vr-card {
          max-width: 520px; width: 100%;
          padding: 28px 24px;
          background: linear-gradient(180deg, rgba(46,16,101,0.55), rgba(15,7,40,0.7));
          border: 1px solid rgba(196,181,253,0.30);
          border-radius: 22px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.55);
          backdrop-filter: blur(10px);
        }
        .portal-vr-badge {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 10px; letter-spacing: 0.20em; text-transform: uppercase; font-weight: 800;
          color: #C4B5FD;
          padding: 4px 10px;
          background: rgba(167,139,250,0.16);
          border: 1px solid rgba(196,181,253,0.40);
          border-radius: 999px;
        }
        .portal-vr-title {
          font-size: 32px; font-weight: 900; margin: 14px 0 8px;
          background: linear-gradient(180deg, #F5F3FF, #C4B5FD);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .portal-vr-body { font-size: 14px; line-height: 1.65; color: #DDD6FE; }
        .portal-vr-bullets {
          margin: 12px 0 18px; padding-left: 18px; color: #C4B5FD; font-size: 13px; line-height: 1.7;
        }
        .portal-vr-back {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 11px 16px;
          background: rgba(255,255,255,0.06);
          color: #F5F3FF;
          font-size: 12px; font-weight: 700;
          border: 1px solid rgba(196,181,253,0.30);
          border-radius: 999px;
          text-decoration: none;
        }
        .portal-vr-back:hover { background: rgba(196,181,253,0.10); }
      `}</style>
      <div className="portal-vr-card">
        <div className="portal-vr-badge">
          <Lock size={10} /> Coming Soon
        </div>
        <h1 className="portal-vr-title">
          <Hexagon size={22} style={{ display: "inline-block", marginRight: 8, verticalAlign: "-3px" }} />
          Portals VR
        </h1>
        <p className="portal-vr-body">
          This route is reserved for OurRealm&apos;s upcoming immersive VR Realm experiences.
          When this lights up, you&apos;ll be able to slip on a headset and step inside a Realm
          rather than peek through your phone&apos;s camera.
        </p>
        <ul className="portal-vr-bullets">
          <li>Full 6-DoF spatial navigation</li>
          <li>WebXR + native VR bridge</li>
          <li>Multi-user Realms with live presence</li>
          <li>Per-creature physical behaviours</li>
        </ul>
        <Link to="/portals" className="portal-vr-back" data-testid="portal-vr-back">
          <ArrowLeft size={14} /> Back to Portals
        </Link>
      </div>
    </div>
  );
}
