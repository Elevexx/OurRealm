/**
 * Fire Power API helpers — cached /fire/status fetch + react mutation.
 * All Fire features are founder-flag gated server-side; when disabled
 * the status endpoint returns { enabled: false } and every surface
 * falls back to the legacy Like UI.
 */
import { useEffect, useState } from "react";
import apiClient from "@/api/client";

const OFF = { enabled: false, boosted_enabled: false, ranked_feed_enabled: false, config: null, pool: null };

let _cache = null;
let _at = 0;
let _inflight = null;
let _cacheUser;

export async function fetchFireStatus(force = false) {
  const now = Date.now();
  if (!force && _cache && now - _at < 30000) return _cache;
  if (_inflight && !force) return _inflight;
  _inflight = apiClient
    .get("/fire/status")
    .then((r) => { _cache = r.data; _at = Date.now(); return _cache; })
    .catch(async () => {
      // One retry — covers requests aborted by the login navigation.
      await new Promise((res) => setTimeout(res, 1500));
      try {
        const r2 = await apiClient.get("/fire/status");
        _cache = r2.data; _at = Date.now(); return _cache;
      } catch { return _cache || OFF; }
    })
    .finally(() => { _inflight = null; });
  return _inflight;
}

export function updateCachedPool(pool) {
  if (_cache && pool) { _cache = { ..._cache, pool }; }
}

export function useFireStatus(userId) {
  const [status, setStatus] = useState(_cache);
  useEffect(() => {
    let on = true;
    // Refetch when the signed-in user changes so a pre-login (guest)
    // status never lingers in the cache after sign-in.
    const force = _cacheUser !== (userId ?? null);
    _cacheUser = userId ?? null;
    fetchFireStatus(force).then((s) => { if (on) setStatus(s); });
    return () => { on = false; };
  }, [userId]);
  return status || OFF;
}

export async function sendFire(postId, fireValue) {
  const key = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${postId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data } = await apiClient.post("/fire/react", {
    post_id: postId, fire_value: fireValue, idempotency_key: key,
  });
  updateCachedPool(data.pool);
  return data;
}
