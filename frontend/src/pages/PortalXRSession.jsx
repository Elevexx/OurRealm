/**
 * OurRealm — Portals 1.1 · Immersive AR Session
 *   Route: /realms/portals/ar/xr
 *
 * This page owns the real WebXR immersive-ar experience:
 *   1. On mount → probe navigator.xr for immersive-ar support.
 *   2. Show "Enter Immersive AR" CTA. On click → PortalEngine.startXR().
 *   3. Engine handles hit-test + reticle. When the user taps a detected
 *      surface, the selected Realm is planted at that anchor.
 *   4. Live event stream drives the on-screen HUD.
 *
 * The DOM overlay stays super light — the heavy work lives in
 * PortalEngine + Realm classes.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Crosshair, PlayCircle, Sparkles, XCircle, AlertTriangle } from "lucide-react";
import { PortalEngine } from "../lib/portals/PortalEngine";
import { createRealm, listRealmIds } from "../lib/portals/registry";
import RealmTransition from "../lib/portals/RealmTransition";

// Human-readable event log — capped so the array never balloons.
const MAX_EVENTS = 40;

export default function PortalXRSession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const realmId = params.get("realm") || "rainforest";

  const canvasHostRef = useRef(null);
  const overlayRef    = useRef(null);
  const engineRef     = useRef(null);

  const [probe, setProbe]           = useState(null);       // { hasNavXR, arSupported, reason }
  const [phase, setPhase]           = useState("idle");     // idle | initializing | supported | requesting | in_session | placed | ended | error
  const [status, setStatus]         = useState("Detecting device AR support…");
  const [surfaceHint, setSurfaceHint] = useState("");
  const [events, setEvents]         = useState([]);
  const [errorMsg, setErrorMsg]     = useState("");
  // Portals 1.4 — realm transition overlay driver.
  const [transition, setTransition] = useState(null);

  const pushEvent = useCallback((label) => {
    setEvents((prev) => {
      const next = [...prev, { t: Date.now(), label }];
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    });
  }, []);

  // ── Probe support on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await PortalEngine.probe();
      if (cancelled) return;
      setProbe(p);
      if (p.arSupported) {
        setPhase("supported");
        setStatus("This device supports immersive AR. Tap ENTER AR to begin.");
      } else {
        setPhase("error");
        setStatus(p.reason || "This device does not support WebXR immersive-ar.");
      }
      pushEvent(`probe → arSupported=${p.arSupported}`);
    })();
    return () => { cancelled = true; };
  }, [pushEvent]);

  // ── Engine event handler ─────────────────────────────────────────
  const onEngineEvent = useCallback((ev) => {
    switch (ev.type) {
      case "engine:init":
        pushEvent("engine initialized");
        break;
      case "xr:started":
        pushEvent("xr session started");
        setPhase("in_session");
        setStatus("Point your device at the floor. Move slowly to detect a surface.");
        setSurfaceHint("Looking for a flat surface…");
        break;
      case "surface:detected":
        pushEvent("surface detected");
        setSurfaceHint("Surface found — tap the screen to plant the Rainforest.");
        break;
      case "surface:lost":
        pushEvent("surface lost");
        setSurfaceHint("Surface lost — keep the reticle steady on the floor.");
        break;
      case "surface:placed":
        pushEvent("realm planted");
        setPhase("placed");
        setStatus("Rainforest planted. Walk around to explore.");
        setSurfaceHint("");
        break;
      case "xr:ended":
        pushEvent("xr session ended");
        setPhase("ended");
        setStatus("Session ended.");
        setSurfaceHint("");
        break;
      case "xr:error":
      case "xr:unavailable":
        pushEvent(`xr error: ${ev.message || ev.reason || "unknown"}`);
        setErrorMsg(ev.message || ev.reason || "Failed to start immersive AR session.");
        setPhase("error");
        setStatus("");
        setSurfaceHint("");
        break;
      default:
        break;
    }
  }, [pushEvent]);

  // ── Enter AR ─────────────────────────────────────────────────────
  const enterAR = useCallback(async () => {
    if (!listRealmIds().includes(realmId)) {
      setErrorMsg(`Realm "${realmId}" not found.`);
      setPhase("error");
      return;
    }
    setPhase("initializing");
    setStatus("Initializing engine…");
    setErrorMsg("");
    setTransition({ phase: "entering", label: `Entering ${realmId.replace(/-/g, " ")}`, durationMs: 900 });
    try {
      const realm = createRealm(realmId);
      const engine = new PortalEngine({
        container: canvasHostRef.current,
        realm,
        overlayEl: overlayRef.current,
        onEvent: onEngineEvent,
      });
      engineRef.current = engine;
      await engine.init();
      pushEvent("engine.init complete");
      setPhase("requesting");
      setStatus("Requesting immersive AR session…");
      const ok = await engine.startXR();
      if (!ok) {
        setErrorMsg("The browser refused the immersive AR session.");
        setPhase("error");
      }
    } catch (e) {
      setErrorMsg(e?.message || "Unexpected error while starting AR.");
      setPhase("error");
    }
  }, [onEngineEvent, pushEvent, realmId]);

  const exitAR = useCallback(async () => {
    setTransition({ phase: "exiting", label: "Leaving Realm", durationMs: 700 });
    if (engineRef.current) {
      await engineRef.current.endXR();
    }
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        try { engineRef.current.dispose(); } catch (_) { /* noop */ }
        engineRef.current = null;
      }
    };
  }, []);

  const isSupported = probe?.arSupported === true;
  const inSession   = phase === "in_session" || phase === "placed";

  return (
    <div className="portal-xr-root" data-testid="portal-xr-root">
      <PortalXRStyles />
      <RealmTransition
        transition={transition}
        onDone={() => setTransition(null)}
      />

      {/* Three.js canvas mounts here in-session; empty otherwise. */}
      <div ref={canvasHostRef} className="portal-xr-canvas-host" data-testid="portal-xr-canvas-host" />

      {/* DOM overlay — visible during pre-session AND handed to the XR session as domOverlay. */}
      <div ref={overlayRef} className="portal-xr-overlay" data-testid="portal-xr-overlay">
        <header className="pxr-topbar">
          <button
            type="button"
            className="pxr-btn pxr-btn-icon"
            onClick={() => (inSession ? exitAR() : navigate("/realms/portals/ar"))}
            data-testid="portal-xr-back"
          >
            <ArrowLeft size={18} /> {inSession ? "Exit AR" : "Back"}
          </button>
          <div className="pxr-title">
            <Sparkles size={14} /> Portals · Rainforest AR
          </div>
          <div className="pxr-spacer" />
        </header>

        {/* Pre-session card */}
        {!inSession && (
          <div className="pxr-card" data-testid="portal-xr-card">
            {phase === "idle" && (
              <div className="pxr-loading" data-testid="portal-xr-loading">
                <div className="pxr-spinner" />
                <div>Detecting device AR support…</div>
              </div>
            )}

            {(phase === "supported" || phase === "initializing" || phase === "requesting") && (
              <>
                <h2 className="pxr-h2" data-testid="portal-xr-headline">
                  Enter the Rainforest
                </h2>
                <p className="pxr-p">
                  This is a real WebXR experience. Your device will scan for a flat
                  surface — tap it to plant an interactive Amazon rainforest and
                  walk around to explore it.
                </p>
                <ul className="pxr-checks">
                  <li>Grant camera + motion permissions when prompted.</li>
                  <li>Slowly move your device across the floor to help it map surfaces.</li>
                  <li>Tap the green reticle to place the realm.</li>
                </ul>
                <button
                  type="button"
                  className="pxr-cta"
                  onClick={enterAR}
                  disabled={phase !== "supported"}
                  data-testid="portal-xr-enter-btn"
                >
                  <PlayCircle size={18} />
                  {phase === "initializing"
                    ? "Initializing…"
                    : phase === "requesting"
                    ? "Requesting session…"
                    : "Enter Immersive AR"}
                </button>
              </>
            )}

            {phase === "error" && (
              <div className="pxr-error" data-testid="portal-xr-error">
                <AlertTriangle size={22} />
                <h3 className="pxr-h3">Immersive AR is unavailable</h3>
                <p className="pxr-p">
                  {errorMsg || status}
                </p>
                <p className="pxr-p pxr-muted">
                  Native WebXR AR currently requires an ARCore-capable Android device
                  running Chrome. iOS Safari does not yet support WebXR immersive-ar.
                  You can still enjoy the cinematic preview overlay from the previous
                  screen.
                </p>
                <button
                  type="button"
                  className="pxr-btn"
                  onClick={() => navigate("/realms/portals/ar")}
                  data-testid="portal-xr-return-preview"
                >
                  Return to Preview
                </button>
              </div>
            )}

            {phase === "ended" && (
              <div className="pxr-error" data-testid="portal-xr-ended">
                <XCircle size={22} />
                <h3 className="pxr-h3">Session ended</h3>
                <p className="pxr-p">You can re-enter the rainforest any time.</p>
                <button
                  type="button"
                  className="pxr-cta"
                  onClick={enterAR}
                  data-testid="portal-xr-reenter-btn"
                >
                  <PlayCircle size={18} /> Re-enter AR
                </button>
              </div>
            )}

            {/* Small debug log — collapsible in a future polish pass. */}
            <details className="pxr-log">
              <summary>Engine log ({events.length})</summary>
              <ol data-testid="portal-xr-log">
                {events.slice().reverse().map((e) => (
                  <li key={`${e.t}-${e.label}`}>{new Date(e.t).toLocaleTimeString()} — {e.label}</li>
                ))}
              </ol>
            </details>
          </div>
        )}

        {/* In-session HUD — must be tiny; overlaid on live camera. */}
        {inSession && (
          <div className="pxr-hud" data-testid="portal-xr-hud">
            <div className="pxr-hud-status">
              <Crosshair size={14} />
              <span>{surfaceHint || status}</span>
            </div>
          </div>
        )}

        {/* Support hint strip visible only in supported/pre-session */}
        {isSupported && !inSession && phase === "supported" && (
          <div className="pxr-hint" data-testid="portal-xr-hint">
            WebXR immersive-ar supported · hit-test enabled
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
function PortalXRStyles() {
  return (
    <style>{`
      .portal-xr-root {
        position: fixed; inset: 0;
        background: #030608;
        color: #E6FFF3;
        font-family: var(--font-display, "Inter", system-ui, sans-serif);
        overflow: hidden;
      }
      .portal-xr-canvas-host {
        position: absolute; inset: 0;
        z-index: 0;
      }
      .portal-xr-canvas-host canvas {
        display: block;
      }
      .portal-xr-overlay {
        position: absolute; inset: 0;
        z-index: 1;
        display: flex; flex-direction: column;
        pointer-events: none;
      }
      .portal-xr-overlay > * { pointer-events: auto; }

      .pxr-topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px;
        background: linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0));
      }
      .pxr-title {
        display: inline-flex; align-items: center; gap: 8px;
        font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
        color: #86efac;
      }
      .pxr-spacer { width: 82px; }

      .pxr-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px;
        background: rgba(6,20,14,0.75);
        border: 1px solid rgba(134,239,172,0.4);
        border-radius: 999px;
        color: #ecfdf5;
        font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
        cursor: pointer;
      }
      .pxr-btn:hover { border-color: #86efac; }
      .pxr-btn-icon { padding-left: 10px; padding-right: 12px; }

      .pxr-card {
        margin: 8px 16px 24px;
        max-width: 520px;
        align-self: center;
        width: calc(100% - 32px);
        background: rgba(3,12,8,0.85);
        border: 1px solid rgba(134,239,172,0.28);
        border-radius: 16px;
        padding: 22px 20px;
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 20px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05);
      }
      .pxr-h2 {
        margin: 0 0 8px;
        font-size: 22px; font-weight: 900; letter-spacing: 0.01em;
        background: linear-gradient(180deg, #ECFDF5, #86EFAC);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .pxr-h3 { margin: 6px 0 4px; font-size: 16px; font-weight: 800; color: #ecfdf5; }
      .pxr-p  { margin: 0 0 10px; font-size: 13px; line-height: 1.55; color: #bbf7d0; }
      .pxr-muted { color: rgba(187,247,208,0.7); font-size: 12px; }

      .pxr-checks {
        margin: 4px 0 16px; padding-left: 18px;
        color: #bbf7d0; font-size: 12px; line-height: 1.7;
      }
      .pxr-cta {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 12px 18px;
        background: linear-gradient(180deg, #22C55E, #15803D);
        color: #022C1A;
        font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
        border: none; border-radius: 999px;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(34,197,94,0.4), inset 0 1px 0 rgba(255,255,255,0.25);
        transition: transform 150ms ease, box-shadow 150ms ease;
      }
      .pxr-cta:hover:not(:disabled) { transform: translateY(-1px); }
      .pxr-cta:disabled { opacity: 0.6; cursor: default; }

      .pxr-loading {
        display: flex; align-items: center; gap: 10px;
        color: #bbf7d0; font-size: 13px;
      }
      .pxr-spinner {
        width: 18px; height: 18px; border-radius: 999px;
        border: 2px solid rgba(134,239,172,0.35);
        border-top-color: #86efac;
        animation: pxr-spin 800ms linear infinite;
      }
      @keyframes pxr-spin { to { transform: rotate(360deg); } }

      .pxr-error {
        display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
        color: #ffb4b4;
      }
      .pxr-error .pxr-btn, .pxr-error .pxr-cta { margin-top: 6px; }

      .pxr-log {
        margin-top: 14px;
        color: rgba(187,247,208,0.7);
        font-size: 11px;
      }
      .pxr-log summary { cursor: pointer; }
      .pxr-log ol {
        max-height: 120px; overflow-y: auto;
        margin: 6px 0 0; padding-left: 18px;
      }
      .pxr-log li { margin: 2px 0; }

      .pxr-hud {
        position: absolute;
        bottom: max(24px, env(safe-area-inset-bottom));
        left: 50%; transform: translateX(-50%);
        padding: 10px 14px;
        background: rgba(3,12,8,0.75);
        border: 1px solid rgba(134,239,172,0.35);
        border-radius: 999px;
        color: #ecfdf5;
        font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
      }
      .pxr-hud-status { display: inline-flex; align-items: center; gap: 8px; }

      .pxr-hint {
        position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
        padding: 6px 12px;
        background: rgba(3,12,8,0.65);
        border: 1px solid rgba(134,239,172,0.25);
        border-radius: 999px;
        color: #86efac;
        font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700;
      }

      @media (max-width: 480px) {
        .pxr-h2 { font-size: 20px; }
        .pxr-p  { font-size: 12.5px; }
      }
    `}</style>
  );
}
