import React, { useEffect, useState } from "react";
import apiClient from "@/api/client";

// Responsibility Center — centralized asset resolution (Bundle B).
// One manifest fetch per session (cache-busted after admin activations
// via refreshRcManifest). Components NEVER hardcode replaceable branding;
// they render a safe built-in fallback when no custom asset is active.
let _manifest = null;
let _promise = null;
const _listeners = new Set();

export async function loadRcManifest(force = false) {
  if (_manifest && !force) return _manifest;
  if (_promise && !force) return _promise;
  _promise = apiClient
    .get("/responsibility-center/media/manifest")
    .then((r) => {
      _manifest = r.data;
      _listeners.forEach((fn) => fn(_manifest));
      return _manifest;
    })
    .catch(() => _manifest); // storage/API issue → keep cached/fallbacks
  return _promise;
}

export function refreshRcManifest() {
  _promise = null;
  return loadRcManifest(true);
}

export function useRcManifest() {
  const [m, setM] = useState(_manifest);
  useEffect(() => {
    const fn = (next) => setM(next);
    _listeners.add(fn);
    loadRcManifest().then((v) => v && setM(v));
    return () => _listeners.delete(fn);
  }, []);
  return m;
}

export function resolveRcAsset(manifest, assetKey, { theme, device } = {}) {
  const slot = manifest?.assets?.[assetKey];
  if (!slot) return null;
  const variants = slot.variants || {};
  const url =
    (theme && device && variants[`${theme}:${device}`]) ||
    (theme && variants[`${theme}:default`]) ||
    (device && variants[`default:${device}`]) ||
    slot.url;
  return url ? { url, alt: slot.alt || "" } : null;
}

export function useRcAsset(assetKey, opts) {
  const m = useRcManifest();
  return resolveRcAsset(m, assetKey, opts);
}

export function useRcBranding() {
  const m = useRcManifest();
  return {
    product_name: m?.branding?.product_name || "OurRealm Responsibility Center",
    short_name: m?.branding?.short_name || "Responsibility Center",
    tagline: m?.branding?.tagline || "One System. Endless Possibilities.",
    center_branding_enabled: !!m?.branding?.center_branding_enabled,
  };
}

// <RcImg assetKey="…" fallback={<Icon/>}/> — reserved dimensions, no
// broken-image glyphs (onError falls back), lazy by default.
export function RcImg({ assetKey, theme, device, fallback = null, className,
                        style, width, height, eager = false, testid }) {
  const asset = useRcAsset(assetKey, { theme, device });
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [asset?.url]);
  if (!asset || broken) return fallback;
  return (
    <img
      src={asset.url}
      alt={asset.alt}
      className={className}
      style={{ objectFit: "contain", ...(width ? { width } : {}), ...(height ? { height } : {}), ...style }}
      loading={eager ? "eager" : "lazy"}
      onError={() => setBroken(true)}
      data-testid={testid || `rc-asset-${assetKey}`}
    />
  );
}
