/**
 * Returns the maximum number of characters allowed in a thought / text-only
 * post for the given user. Mirrors the server-side rule in
 * `backend/services/post_limits.py` so the UI and API can never disagree.
 *
 *   founder (@stealth)  → 2,000
 *   VIP (badges/role)   →   500
 *   default              →   300
 *
 * Limits apply to text content only. Media-only posts are unaffected.
 */
export function getPostCharacterLimit(user) {
  if (!user) return 300;
  const uname = (user.username || "").toLowerCase();
  if (uname === "stealth" || user.is_founder) return 2000;
  const badges = user.badges || [];
  if (user.is_vip || badges.includes("VIP") || badges.includes("vip")) return 500;
  return 300;
}

export const POST_LIMITS = { founder: 2000, vip: 500, default: 300 };
