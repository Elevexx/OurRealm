/**
 * Portals 1.0 — Rainforest Realm AR (/realms/portals/ar).
 *
 * Lightweight browser AR: getUserMedia camera passthrough + layered CSS/SVG
 * jungle holograms + emoji creatures with CSS-keyframe loops. Designed for
 * iPhone Safari & Android Chrome.
 *
 * No 3D models. No Unity. No heavy assets. Future hooks for WebXR / Unity /
 * spatial mapping live in /src/config/portals.js. When this phase
 * graduates to real WebXR, only this file (and the renderer) need to
 * change — the registry stays.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Camera, CameraOff, Compass, LogOut, Leaf, Bird, Sparkles, Zap,
  Bug,
} from "lucide-react";
import { getPortalByRoute } from "../config/portals";

const PORTAL = getPortalByRoute("/realms/portals/ar");

// Phase: Portals 1.0 debug helper. Verbose console.info traces tagged with
// `[PortalAR]` so the entire scene lifecycle can be traced from the browser
// devtools when the user reports "no rainforest content".
const log = (...args) => {
  // eslint-disable-next-line no-console
  console.info("[PortalAR]", ...args);
};

export default function PortalAR() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [camState, setCamState] = useState("idle"); // idle | requesting | live | denied | unavailable
  const [errMsg, setErrMsg]     = useState("");
  const [ambient, setAmbient]   = useState(true);
  const [creatures, setCreatures] = useState(true);
  const [quality, setQuality]   = useState(PORTAL?.performanceProfile?.defaultMode || "balanced");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tiltUp, setTiltUp]     = useState(0); // 0..1 normalized "looking up" intensity

  // Phase 1.0 debug HUD state. The rainforest scene is built entirely from
  // inline SVG + CSS + emoji glyphs — there are no external assets — so the
  // "asset failure" channel exists primarily for future expansion. We still
  // track render readiness for the debug overlay.
  const [showDebug, setShowDebug] = useState(true);
  const [assetErrors, setAssetErrors] = useState([]);
  const [overlayMounted, setOverlayMounted] = useState(false);
  const [videoReady, setVideoReady] = useState({ w: 0, h: 0, readyState: 0 });

  // ── Mount-time trace ─────────────────────────────────────────────
  useEffect(() => {
    log("scene mounted", {
      route: "/realms/portals/ar",
      portalId: PORTAL?.portalId,
      hasMediaDevices: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
      isSecureContext: typeof window !== "undefined" ? window.isSecureContext : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    return () => log("scene unmounted");
  }, []);

  // ── Reduced-motion preference ────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onCh = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", onCh);
    return () => mq.removeEventListener?.("change", onCh);
  }, []);

  // ── Camera lifecycle ─────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    log("startCamera() called");
    setCamState("requesting");
    setErrMsg("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      log("startCamera: mediaDevices.getUserMedia missing");
      setCamState("unavailable");
      setErrMsg("Camera API unavailable in this browser.");
      return;
    }
    try {
      // Prefer back camera on mobile, fall back gracefully.
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      log("startCamera: stream acquired", {
        trackLabel: track?.label,
        trackSettings: track?.getSettings?.() || null,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const onLoaded = () => {
          const v = videoRef.current;
          if (!v) return;
          setVideoReady({ w: v.videoWidth, h: v.videoHeight, readyState: v.readyState });
          log("video metadata loaded", { w: v.videoWidth, h: v.videoHeight, readyState: v.readyState });
        };
        videoRef.current.addEventListener("loadedmetadata", onLoaded, { once: true });
        // Safari requires explicit play() after metadata loads.
        try { await videoRef.current.play(); log("video.play() resolved"); }
        catch (e) {
          log("video.play() rejected (autoplay policy)", e?.name, e?.message);
        }
      }
      setCamState("live");
      log("camState → live");
    } catch (err) {
      const name = err?.name || "";
      log("startCamera: getUserMedia threw", name, err?.message);
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setCamState("denied");
        setErrMsg("Camera permission was denied.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setCamState("unavailable");
        setErrMsg("No camera was found on this device.");
      } else {
        setCamState("unavailable");
        setErrMsg(`Camera error: ${err?.message || name || "unknown"}`);
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    log("stopCamera() called");
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch { /* swallow */ }
    streamRef.current = null;
    if (videoRef.current) { try { videoRef.current.srcObject = null; } catch { /* */ } }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]); // cleanup on unmount

  // ── Device orientation → "looking up" intensity ──────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOrient = (e) => {
      // beta: front-back tilt. iOS Safari requires explicit permission via DeviceOrientationEvent.requestPermission()
      // but for Phase 1.0 we just listen — if no events arrive the canopy still shows.
      const beta = typeof e.beta === "number" ? e.beta : 0;
      // beta ≈ 0 → flat, ~90 → straight up. Normalize 30..90 to 0..1.
      const t = Math.max(0, Math.min(1, (beta - 30) / 60));
      setTiltUp(t);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, []);

  const requestMotionPermission = useCallback(async () => {
    try {
      // iOS Safari 13+: requestPermission() must be triggered by a user gesture.
      const cls = typeof window !== "undefined" ? window.DeviceOrientationEvent : null;
      if (cls && typeof cls.requestPermission === "function") {
        await cls.requestPermission();
      }
    } catch { /* swallow */ }
  }, []);

  // ── Derived performance settings ─────────────────────────────────
  const perf = useMemo(() => {
    const low = quality === "low" || reducedMotion;
    return {
      low,
      birdCount:   low ? 2 : 5,
      monkeyCount: low ? 1 : 2,
      fireflies:   low ? 0 : 12,
      mist:        !low && ambient,
      animations:  !reducedMotion,
    };
  }, [quality, reducedMotion, ambient]);

  const onExit = useCallback(() => {
    stopCamera();
    navigate("/portals");
  }, [navigate, stopCamera]);

  return (
    <div className="par-root" data-testid="portal-ar-root">
      <PortalARStyles />

      {/* ── Camera passthrough ─────────────────────────────────── */}
      <video
        ref={videoRef}
        className="par-video"
        autoPlay
        muted
        playsInline
        data-testid="portal-ar-video"
        aria-label="Live camera passthrough"
      />
      {camState !== "live" && <div className="par-video-fallback" aria-hidden="true" />}

      {/* ── Rainforest overlays ────────────────────────────────── */}
      {camState === "live" && (
        <RainforestOverlay
          ambient={ambient && perf.mist}
          creatures={creatures}
          perf={perf}
          tiltUp={tiltUp}
          onMount={() => { setOverlayMounted(true); log("RainforestOverlay mounted"); }}
          onUnmount={() => { setOverlayMounted(false); log("RainforestOverlay unmounted"); }}
          onAssetError={(url, err) => {
            log("ASSET ERROR", url, err);
            setAssetErrors((prev) => prev.includes(url) ? prev : [...prev, url]);
          }}
        />
      )}

      {/* ── Permission gates ───────────────────────────────────── */}
      {(camState === "idle" || camState === "requesting") && (
        <PermissionGate
          state={camState}
          onStart={async () => { await startCamera(); requestMotionPermission(); }}
        />
      )}
      {(camState === "denied" || camState === "unavailable") && (
        <PermissionDenied state={camState} errMsg={errMsg} onRetry={startCamera} />
      )}

      {/* ── HUD ─────────────────────────────────────────────────── */}
      <header className="par-hud-top">
        <div className="par-hud-label" data-testid="portal-ar-label">
          <Compass size={14} />
          <span>{PORTAL?.realmName || "Rainforest Realm"}</span>
          {camState === "live" && <span className="par-hud-dot" />}
        </div>
        <button
          type="button"
          onClick={onExit}
          className="par-exit-btn"
          data-testid="portal-ar-exit"
          aria-label="Exit Portal"
        >
          <LogOut size={14} />
          <span className="par-exit-label">Exit Portal</span>
        </button>
      </header>

      {camState === "live" && (
        <footer className="par-hud-bottom">
          <Toggle
            on={ambient} onChange={setAmbient}
            label="Ambient"  Icon={Sparkles} testId="portal-ar-toggle-ambient"
          />
          <Toggle
            on={creatures} onChange={setCreatures}
            label="Creatures" Icon={Bird} testId="portal-ar-toggle-creatures"
          />
          <QualityToggle value={quality} onChange={setQuality} />
        </footer>
      )}

      {/* Phase 1.0 — Debug HUD. Surfaces camera/render/scene state so the
          founder can immediately tell what's happening on a real device.
          Tap the bug icon in the top HUD to toggle. */}
      {showDebug && (
        <DebugHUD
          camState={camState}
          videoReady={videoReady}
          overlayMounted={overlayMounted}
          assetErrors={assetErrors}
          tiltUp={tiltUp}
          perf={perf}
          creaturesEnabled={creatures}
          ambientEnabled={ambient}
          quality={quality}
          reducedMotion={reducedMotion}
          onClose={() => setShowDebug(false)}
        />
      )}
      {!showDebug && (
        <button
          type="button"
          className="par-debug-fab"
          onClick={() => setShowDebug(true)}
          data-testid="portal-ar-debug-open"
          aria-label="Open debug overlay"
        >
          <Bug size={14} />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────
function PermissionGate({ state, onStart }) {
  return (
    <div className="par-gate" data-testid="portal-ar-gate">
      <div className="par-gate-card">
        <div className="par-gate-badge"><Leaf size={12} /> AR Portal · Phase 1.0</div>
        <h1 className="par-gate-title">Rainforest Realm</h1>
        <p className="par-gate-body">
          We&apos;ll briefly ask for camera permission to overlay the jungle onto your room.
          Nothing is recorded — the feed stays on your device.
        </p>
        <button
          type="button"
          onClick={onStart}
          className="par-gate-cta"
          data-testid="portal-ar-allow-camera"
          disabled={state === "requesting"}
        >
          <Camera size={16} />
          {state === "requesting" ? "Opening camera…" : "Allow Camera & Enter"}
        </button>
        <Link to="/portals" className="par-gate-back" data-testid="portal-ar-gate-back">
          Cancel
        </Link>
      </div>
    </div>
  );
}

function PermissionDenied({ state, errMsg, onRetry }) {
  return (
    <div className="par-gate" data-testid="portal-ar-denied">
      <div className="par-gate-card">
        <div className="par-gate-badge par-gate-badge-warn">
          <CameraOff size={12} /> {state === "denied" ? "Camera blocked" : "Camera unavailable"}
        </div>
        <h1 className="par-gate-title">We need your camera</h1>
        <p className="par-gate-body">
          {errMsg || "Please allow camera access in your browser settings, then try again."}
          <br />
          <span style={{ opacity: 0.7, fontSize: 12 }}>
            On iOS: Settings → Safari → Camera → Allow.<br />
            On Android: Tap the lock icon in the URL bar → Permissions → Camera.
          </span>
        </p>
        <button type="button" onClick={onRetry} className="par-gate-cta" data-testid="portal-ar-retry">
          <Camera size={16} /> Try again
        </button>
        <Link to="/portals" className="par-gate-back">Back to Portals</Link>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label, Icon, testId }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`par-toggle ${on ? "par-toggle-on" : ""}`}
      data-testid={testId}
      aria-pressed={on}
    >
      <Icon size={13} />
      <span>{label}</span>
      <span className="par-toggle-pill">{on ? "On" : "Off"}</span>
    </button>
  );
}

function QualityToggle({ value, onChange }) {
  return (
    <div className="par-quality" data-testid="portal-ar-quality">
      <Zap size={13} />
      <span className="par-quality-label">Quality</span>
      {["balanced", "low"].map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onChange(q)}
          className={`par-quality-pill ${value === q ? "par-quality-pill-on" : ""}`}
          data-testid={`portal-ar-quality-${q}`}
        >
          {q === "balanced" ? "Balanced" : "Low"}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Rainforest overlay — pure CSS/SVG layers + emoji creatures.
// Renders many <span> elements but each is GPU-cheap (transform/opacity).
// ─────────────────────────────────────────────────────────────────────
function RainforestOverlay({ ambient, creatures, perf, tiltUp, onMount, onUnmount }) {
  useEffect(() => {
    onMount?.();
    return () => onUnmount?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Canopy intensity grows when the phone tilts up.
  const canopyOpacity = 0.45 + tiltUp * 0.45;

  const fireflyArr = perf.fireflies > 0
    ? Array.from({ length: perf.fireflies }, (_, i) => i)
    : [];

  return (
    <div className="par-overlay" aria-hidden="true">
      {/* Sky / canopy gradient — top region */}
      <div className="par-layer par-canopy" style={{ opacity: canopyOpacity }} data-testid="portal-ar-canopy">
        <CanopySvg />
      </div>

      {/* Light rays through canopy */}
      {ambient && (
        <div className="par-layer par-rays" data-testid="portal-ar-rays">
          <div className="par-ray par-ray-1" />
          <div className="par-ray par-ray-2" />
          <div className="par-ray par-ray-3" />
        </div>
      )}

      {/* Mist / fireflies floating */}
      {ambient && perf.mist && (
        <div className="par-layer par-mist" data-testid="portal-ar-mist">
          <div className="par-mist-veil" />
          {fireflyArr.map((i) => (
            <span
              key={i}
              className="par-firefly"
              style={{
                left:  `${(i * 53 % 100)}%`,
                top:   `${30 + (i * 37 % 60)}%`,
                animationDuration: `${4 + (i % 5)}s`,
                animationDelay: `${(i % 4) * 0.6}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Trees / vines on edges */}
      <div className="par-layer par-trees" data-testid="portal-ar-trees">
        <TreesSvg />
      </div>

      {/* Floor jungle + river */}
      <div className="par-layer par-ground" data-testid="portal-ar-ground">
        <GroundSvg />
        <div className="par-river" data-testid="portal-ar-river">
          <div className="par-river-flow par-river-flow-1" />
          <div className="par-river-flow par-river-flow-2" />
        </div>
      </div>

      {/* Creatures */}
      {creatures && (
        <div className="par-layer par-creatures" data-testid="portal-ar-creatures">
          {/* River dweller */}
          <span className="par-creature par-caiman" data-testid="portal-ar-caiman">🐊</span>

          {/* Ground predator */}
          <span className="par-creature par-jaguar" data-testid="portal-ar-jaguar">🐆</span>

          {/* Birds — flying toward & away */}
          {Array.from({ length: perf.birdCount }, (_, i) => i).map((i) => (
            <span
              key={`bird-${i}`}
              className={`par-creature par-bird par-bird-${(i % 3) + 1}`}
              style={{ animationDelay: `${i * 1.7}s` }}
              data-testid={`portal-ar-bird-${i}`}
            >
              {i % 2 === 0 ? "🦜" : "🐦"}
            </span>
          ))}

          {/* Monkeys — climbing vines on left/right */}
          {Array.from({ length: perf.monkeyCount }, (_, i) => i).map((i) => (
            <span
              key={`monkey-${i}`}
              className={`par-creature par-monkey par-monkey-${i % 2 === 0 ? "left" : "right"}`}
              style={{ animationDelay: `${i * 2.4}s` }}
              data-testid={`portal-ar-monkey-${i}`}
            >🐒</span>
          ))}

          {/* Floor frog */}
          <span className="par-creature par-frog" data-testid="portal-ar-frog">🐸</span>
        </div>
      )}
    </div>
  );
}

// SVG components — kept tiny so the bundle stays light.
function CanopySvg() {
  return (
    <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className="par-svg-canopy">
      <defs>
        <radialGradient id="cg" cx="50%" cy="0%" r="80%">
          <stop offset="0%"  stopColor="#86EFAC" stopOpacity="0.5" />
          <stop offset="60%" stopColor="#15803D" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#022C19" stopOpacity="0.0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="300" fill="url(#cg)" />
      {/* leaf clusters */}
      {[80, 220, 360, 500, 640, 780, 920].map((x, i) => (
        <ellipse key={i} cx={x} cy={40 + (i % 3) * 20} rx="120" ry="60" fill="#166534" opacity="0.55" />
      ))}
      {[140, 320, 480, 680, 860].map((x, i) => (
        <ellipse key={`l${i}`} cx={x} cy={110 + (i % 2) * 30} rx="90" ry="40" fill="#14532D" opacity="0.65" />
      ))}
    </svg>
  );
}

function TreesSvg() {
  // Two vertical trunks (left & right) with vine drape silhouettes.
  return (
    <>
      <svg viewBox="0 0 200 1000" preserveAspectRatio="none" className="par-svg-trees par-svg-trees-left">
        <defs>
          <linearGradient id="tg-l" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"  stopColor="#3b2412" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#3b2412" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="80" height="1000" fill="url(#tg-l)" />
        {[60, 200, 360, 540, 720, 880].map((y, i) => (
          <ellipse key={i} cx={70 + (i % 2) * 20} cy={y} rx="48" ry="22" fill="#14532D" opacity="0.7" />
        ))}
      </svg>
      <svg viewBox="0 0 200 1000" preserveAspectRatio="none" className="par-svg-trees par-svg-trees-right">
        <defs>
          <linearGradient id="tg-r" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"  stopColor="#3b2412" stopOpacity="0" />
            <stop offset="100%" stopColor="#3b2412" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <rect x="120" y="0" width="80" height="1000" fill="url(#tg-r)" />
        {[100, 260, 420, 600, 800].map((y, i) => (
          <ellipse key={i} cx={130 - (i % 2) * 20} cy={y} rx="48" ry="22" fill="#166534" opacity="0.72" />
        ))}
      </svg>
    </>
  );
}

function GroundSvg() {
  return (
    <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className="par-svg-ground">
      <defs>
        <linearGradient id="gg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#022C19" stopOpacity="0" />
          <stop offset="60%" stopColor="#022C19" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="300" fill="url(#gg)" />
      {[100, 280, 460, 620, 820].map((x, i) => (
        <ellipse key={i} cx={x} cy={250 - (i % 2) * 30} rx="100" ry="32" fill="#0E3D26" opacity="0.7" />
      ))}
      {[180, 380, 560, 740, 900].map((x, i) => (
        <path
          key={`f${i}`}
          d={`M${x} 240 q-30 -60 0 -100 q30 60 0 100 z`}
          fill="#166534"
          opacity="0.78"
        />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1.0 — Temporary debug HUD. Read-only diagnostic for the founder
// to verify camera + render + scene state on real devices. Toggle via the
// floating bug icon. Designed to be removed (or gated behind ?debug=1)
// once the scene is stable.
// ─────────────────────────────────────────────────────────────────────
function DebugHUD({
  camState, videoReady, overlayMounted, assetErrors,
  tiltUp, perf, creaturesEnabled, ambientEnabled, quality, reducedMotion,
  onClose,
}) {
  // Active creature count = caiman(1) + jaguar(1) + birds(perf.birdCount)
  //                      + monkeys(perf.monkeyCount) + frog(1).
  const creatureTotal = creaturesEnabled
    ? (1 + 1 + perf.birdCount + perf.monkeyCount + 1)
    : 0;
  // Asset registry — Portals 1.0 ships ZERO external assets (all SVG/CSS/emoji),
  // so "assets loaded" is structural: 8 overlay layers + N creatures.
  const layersDeclared = 8; // sky/canopy + rays + mist + trees + ground + river + creatures (when on)
  const layersLoaded   = overlayMounted ? layersDeclared : 0;

  const renderer = camState === "live"
    ? (overlayMounted ? "active" : "video-only")
    : "idle";

  return (
    <div className="par-debug" data-testid="portal-ar-debug">
      <div className="par-debug-head">
        <span className="par-debug-title"><Bug size={11} /> Debug HUD · Portals 1.0</span>
        <button
          type="button"
          onClick={onClose}
          className="par-debug-close"
          aria-label="Close debug overlay"
          data-testid="portal-ar-debug-close"
        >✕</button>
      </div>
      <DebugRow k="Cam state"      v={camState} testId="portal-ar-debug-cam" />
      <DebugRow k="Renderer"       v={renderer} testId="portal-ar-debug-renderer" />
      <DebugRow k="Video"          v={`${videoReady.w}×${videoReady.h} · rs=${videoReady.readyState}`} testId="portal-ar-debug-video" />
      <DebugRow k="Overlay"        v={overlayMounted ? "mounted" : "not mounted"} testId="portal-ar-debug-overlay" />
      <DebugRow k="Assets loaded"  v={`${layersLoaded} / ${layersDeclared} layers`} testId="portal-ar-debug-assets" />
      <DebugRow k="Active creatures" v={creatureTotal} testId="portal-ar-debug-creatures" />
      <DebugRow k="Tilt up"        v={`${(tiltUp * 100).toFixed(0)}%`} testId="portal-ar-debug-tilt" />
      <DebugRow k="Quality"        v={`${quality}${reducedMotion ? " · reduced-motion" : ""}`} testId="portal-ar-debug-quality" />
      <DebugRow k="Toggles"        v={`ambient=${ambientEnabled?"on":"off"} · creatures=${creaturesEnabled?"on":"off"}`} testId="portal-ar-debug-toggles" />
      {assetErrors.length > 0 ? (
        <>
          <div className="par-debug-fail-head">Failed asset URLs ({assetErrors.length})</div>
          {assetErrors.map((u) => (
            <div className="par-debug-fail" key={u} data-testid="portal-ar-debug-fail">{u}</div>
          ))}
        </>
      ) : (
        <DebugRow k="Failed assets" v="0 (no external assets)" testId="portal-ar-debug-fails" />
      )}
    </div>
  );
}
function DebugRow({ k, v, testId }) {
  return (
    <div className="par-debug-row">
      <span className="par-debug-k">{k}</span>
      <span className="par-debug-v" data-testid={testId}>{String(v)}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
function PortalARStyles() {
  return (
    <style>{`
      .par-root {
        position: fixed; inset: 0;
        background: #000;
        color: #ECFDF5;
        font-family: var(--font-display, "Inter", system-ui, sans-serif);
        overflow: hidden;
        touch-action: none;
        z-index: 60;
      }
      .par-video {
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        object-fit: cover;
        background: #000;
        z-index: 1;
      }
      .par-video-fallback {
        position: absolute; inset: 0;
        z-index: 1;
        background:
          radial-gradient(700px 500px at 20% 20%, #064e3b 0%, #021410 60%, #000 100%);
      }

      /* Overlay master — explicit z-index above video, below HUD/permission. */
      .par-overlay { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: normal; z-index: 10; }
      .par-layer   { position: absolute; inset: 0; }

      /* Canopy / sky */
      .par-canopy { transition: opacity 600ms ease; }
      .par-svg-canopy {
        position: absolute; top: 0; left: 0; width: 100%; height: 38%;
        filter: drop-shadow(0 4px 12px rgba(34,197,94,0.35));
      }

      /* Light rays */
      .par-rays { mix-blend-mode: screen; opacity: 0.45; }
      .par-ray {
        position: absolute; top: -10%; width: 2px; height: 120%;
        background: linear-gradient(180deg, rgba(255,255,200,0.35), transparent 70%);
        transform-origin: top center;
        filter: blur(0.6px);
      }
      .par-ray-1 { left: 22%; transform: rotate(8deg);  animation: ray-flicker 6s ease-in-out infinite; }
      .par-ray-2 { left: 48%; transform: rotate(-4deg); animation: ray-flicker 7s ease-in-out infinite 1s; }
      .par-ray-3 { left: 75%; transform: rotate(12deg); animation: ray-flicker 8s ease-in-out infinite 2s; }
      @keyframes ray-flicker { 0%,100% { opacity: 0.35; } 50% { opacity: 0.8; } }

      /* Mist + fireflies */
      .par-mist-veil {
        position: absolute; inset: 0;
        background:
          radial-gradient(800px 400px at 50% 80%, rgba(187,247,208,0.12), transparent 70%),
          radial-gradient(500px 300px at 80% 30%, rgba(134,239,172,0.08), transparent 70%);
        animation: mist-drift 18s ease-in-out infinite alternate;
      }
      @keyframes mist-drift {
        from { transform: translateX(-2%); }
        to   { transform: translateX(2%); }
      }
      .par-firefly {
        position: absolute;
        width: 5px; height: 5px;
        border-radius: 999px;
        background: radial-gradient(circle, #FEF08A 0%, rgba(254,240,138,0) 70%);
        animation-name: firefly-drift;
        animation-iteration-count: infinite;
        animation-timing-function: ease-in-out;
        will-change: transform, opacity;
        filter: drop-shadow(0 0 6px rgba(254,240,138,0.85));
      }
      @keyframes firefly-drift {
        0%   { transform: translate(0,0) scale(0.9); opacity: 0.2; }
        50%  { transform: translate(20px,-30px) scale(1.2); opacity: 1; }
        100% { transform: translate(-15px,15px) scale(0.9); opacity: 0.2; }
      }

      /* Trees on edges */
      .par-svg-trees { position: absolute; top: 0; height: 100%; width: 26%; }
      .par-svg-trees-left  { left: 0; }
      .par-svg-trees-right { right: 0; }

      /* Ground + river */
      .par-svg-ground { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: 34%; }
      .par-river {
        position: absolute; left: 0; right: 0; bottom: 4%;
        height: 60px;
        overflow: hidden;
        filter: drop-shadow(0 -2px 12px rgba(34,211,238,0.25));
      }
      .par-river-flow {
        position: absolute; inset: 0;
        background:
          linear-gradient(90deg, rgba(34,211,238,0.20), rgba(20,184,166,0.30), rgba(34,211,238,0.20)),
          repeating-linear-gradient(90deg,
            rgba(255,255,255,0.18) 0 6px, transparent 6px 18px);
        background-size: 200% 100%, 80px 100%;
        mix-blend-mode: screen;
        animation: river-flow 8s linear infinite;
      }
      .par-river-flow-2 {
        opacity: 0.55;
        animation: river-flow 5s linear infinite reverse;
        transform: translateY(8px);
      }
      @keyframes river-flow {
        from { background-position: 0% 0, 0 0; }
        to   { background-position: 100% 0, 80px 0; }
      }

      /* Creatures (emoji) */
      .par-creature {
        position: absolute;
        font-size: 36px;
        filter: drop-shadow(0 0 14px rgba(134,239,172,0.55)) drop-shadow(0 0 4px rgba(0,0,0,0.7));
        will-change: transform, opacity;
        line-height: 1;
        user-select: none;
      }

      /* Caiman — swims back and forth in the river */
      .par-caiman {
        bottom: 5%; left: -10%;
        font-size: 38px;
        animation: caiman-swim 14s linear infinite;
      }
      @keyframes caiman-swim {
        0%   { transform: translateX(-10vw)    scaleX(1)  translateY(0); }
        45%  { transform: translateX(95vw)     scaleX(1)  translateY(-2px); }
        50%  { transform: translateX(95vw)     scaleX(-1) translateY(0); }
        95%  { transform: translateX(-10vw)    scaleX(-1) translateY(-2px); }
        100% { transform: translateX(-10vw)    scaleX(1)  translateY(0); }
      }

      /* Jaguar — paces near river */
      .par-jaguar {
        bottom: 16%; left: -10%;
        font-size: 42px;
        animation: jaguar-pace 11s ease-in-out infinite;
      }
      @keyframes jaguar-pace {
        0%   { transform: translateX(-10vw) scaleX(1);  }
        45%  { transform: translateX(85vw)  scaleX(1);  }
        50%  { transform: translateX(85vw)  scaleX(-1); }
        95%  { transform: translateX(-10vw) scaleX(-1); }
        100% { transform: translateX(-10vw) scaleX(1);  }
      }

      /* Birds — fly across with scale change (depth illusion) */
      .par-bird { top: 18%; left: -10%; font-size: 26px; opacity: 0.95; }
      .par-bird-1 { top: 12%; animation: bird-fly-a 9s linear infinite;  }
      .par-bird-2 { top: 26%; animation: bird-fly-b 11s linear infinite; font-size: 22px; opacity: 0.85; }
      .par-bird-3 { top: 32%; animation: bird-fly-a 13s linear infinite 2s; font-size: 18px; opacity: 0.75; }
      @keyframes bird-fly-a {
        0%   { transform: translate(-10vw, 0)    scale(0.6); opacity: 0.4; }
        50%  { transform: translate(50vw, -20px) scale(1.2); opacity: 1;   }
        100% { transform: translate(110vw, 0)    scale(0.6); opacity: 0.4; }
      }
      @keyframes bird-fly-b {
        0%   { transform: translate(110vw, 10px) scaleX(-1) scale(0.8); opacity: 0.4; }
        50%  { transform: translate(50vw, -10px) scaleX(-1) scale(1.1); opacity: 1;   }
        100% { transform: translate(-10vw, 10px) scaleX(-1) scale(0.6); opacity: 0.4; }
      }

      /* Monkeys — climb left or right tree */
      .par-monkey { font-size: 32px; }
      .par-monkey-left  { left: 5%;  top: 110%; animation: monkey-climb-l 10s ease-in-out infinite; }
      .par-monkey-right { right: 5%; top: 110%; animation: monkey-climb-r 12s ease-in-out infinite 1s; }
      @keyframes monkey-climb-l {
        0%   { transform: translateY(0)      rotate(0deg); opacity: 0.9; }
        50%  { transform: translateY(-110vh) rotate(-6deg); opacity: 1; }
        100% { transform: translateY(0)      rotate(0deg); opacity: 0.9; }
      }
      @keyframes monkey-climb-r {
        0%   { transform: translateY(0)      rotate(0deg);  opacity: 0.9; }
        50%  { transform: translateY(-105vh) rotate(6deg);  opacity: 1; }
        100% { transform: translateY(0)      rotate(0deg);  opacity: 0.9; }
      }

      /* Floor frog — hops in place */
      .par-frog {
        bottom: 8%; left: 20%; font-size: 24px;
        animation: frog-hop 4s ease-in-out infinite;
      }
      @keyframes frog-hop {
        0%, 80%, 100% { transform: translateY(0); }
        85%           { transform: translateY(-18px); }
        90%           { transform: translateY(0); }
      }

      /* Reduced motion / low quality — disable heavy animations */
      @media (prefers-reduced-motion: reduce) {
        .par-creature, .par-mist-veil, .par-firefly, .par-river-flow, .par-ray { animation: none !important; }
      }

      /* HUD */
      .par-hud-top {
        position: absolute; top: 0; left: 0; right: 0;
        padding: max(12px, env(safe-area-inset-top)) 14px 12px;
        display: flex; align-items: center; justify-content: space-between;
        z-index: 70;
        pointer-events: none;
      }
      .par-hud-label {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 14px;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(134,239,172,0.35);
        border-radius: 999px;
        font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
        color: #ECFDF5;
        pointer-events: auto;
      }
      .par-hud-dot {
        width: 6px; height: 6px; border-radius: 999px;
        background: #22C55E;
        box-shadow: 0 0 10px #22C55E;
        animation: dot-pulse 1.6s ease-in-out infinite;
      }
      @keyframes dot-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }

      .par-exit-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px;
        background: rgba(220,38,38,0.18);
        border: 1px solid rgba(248,113,113,0.45);
        border-radius: 999px;
        color: #FECACA;
        font-size: 12px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
        cursor: pointer;
        pointer-events: auto;
      }
      .par-exit-btn:hover { background: rgba(220,38,38,0.30); }
      .par-exit-label { display: none; }
      @media (min-width: 420px) { .par-exit-label { display: inline; } }

      .par-hud-bottom {
        position: absolute; left: 0; right: 0; bottom: 0;
        padding: 10px 12px max(14px, env(safe-area-inset-bottom));
        display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
        z-index: 70;
      }
      .par-toggle {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 9px 14px;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(134,239,172,0.20);
        border-radius: 999px;
        color: #ECFDF5;
        font-size: 12px; font-weight: 700; letter-spacing: 0.06em;
        cursor: pointer;
        transition: border-color 150ms ease, background-color 150ms ease;
      }
      .par-toggle-on { border-color: rgba(134,239,172,0.65); background: rgba(34,197,94,0.20); }
      .par-toggle-pill {
        font-size: 9px; letter-spacing: 0.16em;
        padding: 2px 8px; border-radius: 999px;
        background: rgba(255,255,255,0.10); color: #ECFDF5;
      }
      .par-toggle-on .par-toggle-pill { background: rgba(34,197,94,0.35); color: #ECFDF5; }

      .par-quality {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 10px;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(134,239,172,0.20);
        border-radius: 999px;
        color: #ECFDF5;
        font-size: 11px;
      }
      .par-quality-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; margin-right: 2px; }
      .par-quality-pill {
        padding: 4px 10px;
        background: transparent; color: #BBF7D0;
        border: 1px solid rgba(134,239,172,0.20);
        border-radius: 999px;
        font-size: 11px; font-weight: 700;
        cursor: pointer;
      }
      .par-quality-pill-on { background: rgba(34,197,94,0.30); color: #ECFDF5; border-color: rgba(134,239,172,0.55); }

      /* Permission gate card */
      .par-gate {
        position: absolute; inset: 0;
        background: radial-gradient(700px 500px at 30% 30%, #052e1e 0%, #021410 55%, #000 100%);
        display: flex; align-items: center; justify-content: center;
        padding: 24px 18px;
        z-index: 80;
      }
      .par-gate-card {
        width: 100%; max-width: 460px;
        padding: 24px 22px;
        background: rgba(8,30,20,0.85);
        border: 1px solid rgba(134,239,172,0.30);
        border-radius: 22px;
        box-shadow: 0 30px 80px rgba(0,0,0,0.6);
        text-align: center;
      }
      .par-gate-badge {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 10px; border-radius: 999px;
        background: rgba(34,197,94,0.16);
        border: 1px solid rgba(134,239,172,0.40);
        color: #86EFAC;
        font-size: 10px; letter-spacing: 0.20em; text-transform: uppercase; font-weight: 800;
      }
      .par-gate-badge-warn {
        background: rgba(248,113,113,0.16);
        border-color: rgba(252,165,165,0.55);
        color: #FECACA;
      }
      .par-gate-title {
        margin: 12px 0 8px;
        font-size: 28px; font-weight: 900;
        background: linear-gradient(180deg, #ECFDF5, #86EFAC);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .par-gate-body { font-size: 14px; line-height: 1.6; color: #BBF7D0; }
      .par-gate-cta {
        margin-top: 18px;
        display: inline-flex; align-items: center; gap: 8px;
        padding: 13px 22px;
        background: linear-gradient(180deg, #22C55E, #15803D);
        color: #022C1A;
        border: none; border-radius: 999px;
        font-size: 13px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(34,197,94,0.40);
      }
      .par-gate-cta[disabled] { opacity: 0.65; cursor: progress; }
      .par-gate-back {
        display: block; margin-top: 14px;
        color: #BBF7D0; font-size: 12px; text-decoration: underline;
      }

      /* Phase 1.0 debug HUD */
      .par-debug {
        position: fixed;
        top: max(64px, env(safe-area-inset-top));
        right: 10px;
        z-index: 90;
        width: min(280px, 86vw);
        padding: 10px 12px;
        background: rgba(0,0,0,0.78);
        border: 1px solid rgba(134,239,172,0.40);
        border-radius: 12px;
        color: #ECFDF5;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; line-height: 1.55;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      }
      .par-debug-head {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 6px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(134,239,172,0.20);
      }
      .par-debug-title {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 800;
        color: #86EFAC;
      }
      .par-debug-close {
        width: 22px; height: 22px;
        background: transparent;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 6px;
        color: #BBF7D0;
        cursor: pointer;
        font-size: 11px;
      }
      .par-debug-row {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
      }
      .par-debug-k { color: rgba(187,247,208,0.65); }
      .par-debug-v { color: #ECFDF5; text-align: right; word-break: break-all; }
      .par-debug-fail-head {
        margin-top: 6px; padding-top: 6px;
        border-top: 1px dashed rgba(252,165,165,0.40);
        font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;
        color: #FCA5A5;
      }
      .par-debug-fail { color: #FECACA; font-size: 10px; word-break: break-all; }
      .par-debug-fab {
        position: fixed;
        top: max(64px, env(safe-area-inset-top));
        right: 10px;
        z-index: 90;
        width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.7);
        border: 1px solid rgba(134,239,172,0.35);
        border-radius: 999px;
        color: #BBF7D0;
        cursor: pointer;
      }
    `}</style>
  );
}
