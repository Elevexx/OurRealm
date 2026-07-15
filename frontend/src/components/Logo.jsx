import React, { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { resolveMediaUrl } from "@/lib/mediaUrl";

/**
 * OurRealm — OFFICIAL MASTER LOGO (Website Media aware, June 2026).
 *
 * Reads the founder-published Website Media config for the active theme
 * mode. Fallback chain (never a broken image):
 *   1. published asset for the active mode
 *   2. published Neon default asset
 *   3. this hardcoded master logo
 * The published config is fetched once per session (module cache) and
 * versioned URLs bust caches after each publish.
 */
const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/ki9b6c4f_4AA21A20-23F6-4B58-A5C1-C58EAD942F36.png";

let _cfgCache = null;
let _cfgPromise = null;
const _listeners = new Set();

async function fetchConfig() {
  if (_cfgCache) return _cfgCache;
  if (!_cfgPromise) {
    _cfgPromise = fetch(`${process.env.REACT_APP_BACKEND_URL}/api/website-media/published`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { _cfgCache = d || { modes: {} }; _listeners.forEach((fn) => fn(_cfgCache)); return _cfgCache; })
      .catch(() => { _cfgCache = { modes: {} }; return _cfgCache; });
  }
  return _cfgPromise;
}

// Called by the admin page after publishing so open tabs refresh promptly.
export function invalidateWebsiteMediaCache() {
  _cfgCache = null;
  _cfgPromise = null;
  fetchConfig();
}

function useBranding(mode) {
  const [cfg, setCfg] = useState(_cfgCache);
  useEffect(() => {
    let on = true;
    const cb = (c) => on && setCfg(c);
    _listeners.add(cb);
    fetchConfig().then((c) => on && setCfg(c));
    return () => { on = false; _listeners.delete(cb); };
  }, []);
  const modes = cfg?.modes || {};
  const entry = modes[mode] || {};
  const neon = modes.neon || {};
  const v = entry.logo ? entry.v : neon.v;
  const logo = entry.logo || neon.logo || LOGO_URL;
  const wordmark = entry.wordmark || (entry.logo ? null : neon.wordmark) || null;
  const bust = v ? `${logo.includes("?") ? "&" : "?"}wmv=${v}` : "";
  return {
    logo: logo === LOGO_URL ? LOGO_URL : resolveMediaUrl(logo) + bust,
    wordmark: wordmark ? resolveMediaUrl(wordmark) + (v ? `${wordmark.includes("?") ? "&" : "?"}wmv=${v}` : "") : null,
  };
}

export default function Logo({
  size = 44,
  className = "",
  withWordmark = true,
  tagline = false, // eslint-disable-line no-unused-vars
}) {
  const { mode } = useTheme();
  const { logo, wordmark } = useBranding(mode);
  const [logoBroken, setLogoBroken] = useState(false);
  const [wmBroken, setWmBroken] = useState(false);
  useEffect(() => { setLogoBroken(false); setWmBroken(false); }, [logo, wordmark]);

  return (
    <span className={`inline-flex items-center gap-2 ${className}`} style={{ flexShrink: 0 }}>
      <img
        src={logoBroken ? LOGO_URL : logo}
        alt="OurRealm"
        width={size}
        height={size}
        draggable={false}
        data-testid="ourrealm-logo"
        onError={() => setLogoBroken(true)}
        style={{
          width: size, height: size, display: "block",
          objectFit: "contain", objectPosition: "center",
          flexShrink: 0, background: "transparent",
        }}
      />
      {withWordmark && wordmark && !wmBroken && (
        <img
          src={wordmark}
          alt=""
          draggable={false}
          data-testid="ourrealm-wordmark"
          onError={() => setWmBroken(true)}
          style={{ height: Math.round(size * 0.55), width: "auto", maxWidth: size * 3.4,
                   display: "block", objectFit: "contain", background: "transparent" }}
        />
      )}
    </span>
  );
}

export { LOGO_URL };
