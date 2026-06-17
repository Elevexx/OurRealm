// Phase B — admin gate shared by /admin* routes.
// Mirrors backend `core/deps.is_admin_user`: @stealth (founder) and
// @support (system) plus anyone with role==='admin'.
export const ADMIN_USERNAMES = new Set(["stealth", "support"]);

export function isAdmin(user) {
  if (!user) return false;
  if (user.is_founder) return true;
  if ((user.role || "").toLowerCase() === "admin") return true;
  return ADMIN_USERNAMES.has((user.username || "").toLowerCase());
}
