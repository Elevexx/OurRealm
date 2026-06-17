/**
 * Single source of truth for presence color logic across OurRealm.
 *
 *   Green  = online
 *   Blue   = messenger
 *   Gray   = offline / invisible / unknown / null
 *   Red    = LIVE  — gated behind ENABLE_LIVE_PRESENCE (currently false)
 *
 * The feature flag below is the *only* place red is unlocked. Until live
 * streaming actually ships and the backend returns `is_live === true`,
 * every consumer must funnel through `resolvePresence()` so we never
 * accidentally flash a red dot.
 */

// Feature flag — flip to true the day live streaming goes live.
export const ENABLE_LIVE_PRESENCE = false;

/**
 * Resolve the *displayable* presence string for a user.
 * @param {object} opts
 * @param {object} opts.user            — user/profile dict from the API
 * @param {object} [opts.statuses]      — live `usePresence().statuses`
 * @param {string} [opts.override]      — explicit value (highest priority)
 * @returns {"live"|"messenger"|"online"|"offline"}
 */
export function resolvePresence({ user, statuses, override }) {
  // Live socket update wins (when this user is the subject of a recent
  // presence:update broadcast).
  const raw =
    override
    || (user?.id && statuses ? statuses[user.id] : undefined)
    || user?.presence_status
    || "offline";

  const status = String(raw).toLowerCase();

  // Red is hard-disabled while the live feature is off. Even if the
  // backend somehow returns "live" or is_live=true, we degrade to online
  // so a red dot never appears in the UI.
  if (status === "live" || user?.is_live === true) {
    if (!ENABLE_LIVE_PRESENCE) return "online";
    if (ENABLE_LIVE_PRESENCE && user?.is_live === true) return "live";
    return "online";
  }
  if (status === "messenger") return "messenger";
  if (status === "online")    return "online";
  // Anything else — invisible, offline, null, undefined, unknown — is gray.
  return "offline";
}

/**
 * Should the visible bubble be rendered at all?
 * `offline` collapses to "no dot" by default so the UI is quiet for
 * inactive users.
 */
export function shouldRenderPresenceDot(displayStatus, { showOffline = false } = {}) {
  if (!displayStatus) return false;
  if (displayStatus === "offline" && !showOffline) return false;
  return true;
}

/**
 * Map a *resolved* status to its hex color. Useful for the small dot.
 * Gray is rendered when nothing else fits — never red while the flag is off.
 */
export function presenceColor(displayStatus) {
  switch (displayStatus) {
    case "live":      return ENABLE_LIVE_PRESENCE ? "#FF3F5A" : "#5A6378";
    case "online":    return "#10E670";
    case "messenger": return "#2EA0FF";
    default:          return "#5A6378";
  }
}
