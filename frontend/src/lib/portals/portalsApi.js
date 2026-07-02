/**
 * Portals 1.3 — Client wrapper for the admin_portals backend router.
 *
 * Every method returns { ok: true, override } on success. On network
 * failure we set `ok: false` and let the caller decide whether to fall
 * back to sessionStorage — this keeps the UI usable offline while
 * still preferring persistent server-side truth.
 */
import apiClient from "@/api/client";

const BASE = "/admin/portals";

async function safe(fn) {
  try {
    const { data } = await fn();
    return { ok: true, ...data };
  } catch (e) {
    const status = e?.response?.status;
    const detail = e?.response?.data?.detail || e?.message || "Network error";
    return { ok: false, status, detail };
  }
}

export const portalsApi = {
  listOverrides:      ()            => safe(() => apiClient.get(`${BASE}/overrides`)),
  getOverride:        (id)          => safe(() => apiClient.get(`${BASE}/${id}/override`)),
  setNotes:           (id, notes)   => safe(() => apiClient.post(`${BASE}/${id}/notes`,               { notes })),
  setStatus:          (id, status)  => safe(() => apiClient.post(`${BASE}/${id}/status`,              { status })),
  toggleEnabled:      (id, enabled) => safe(() => apiClient.post(`${BASE}/${id}/toggle`,              { enabled })),
  setPlatformReadiness: (id, platform, entry) =>
                                        safe(() => apiClient.post(`${BASE}/${id}/platform-readiness`, { platform, entry })),
  setAssetScrolls:    (id, assetScrolls) =>
                                        safe(() => apiClient.post(`${BASE}/${id}/asset-scrolls`,      { asset_scrolls: assetScrolls })),
  setUnityDeployment: (id, body)    => safe(() => apiClient.post(`${BASE}/${id}/unity-deployment`,    body)),
  setArVrCompatibility: (id, body)  => safe(() => apiClient.post(`${BASE}/${id}/ar-vr-compatibility`, body)),
  setRoadmapNotes:    (id, value)   => safe(() => apiClient.post(`${BASE}/${id}/roadmap-notes`,       { value })),
  setPerformanceNotes:(id, value)   => safe(() => apiClient.post(`${BASE}/${id}/performance-notes`,   { value })),
  resetOverride:      (id)          => safe(() => apiClient.delete(`${BASE}/${id}/override`)),
};

export default portalsApi;
