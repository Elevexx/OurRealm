/**
 * AdminSettingsTab — content for the Settings > Admin tab.
 *
 * Visibility (UI-only — backend remains the source of truth):
 *   • @stealth (founder)        — full kit: Admin Dashboard + all
 *                                  user-management tools.
 *   • @support (support-admin)  — Admin Dashboard + tools their
 *                                  backend role allows (search,
 *                                  suspend, mute, delete; NO
 *                                  password reset — founder-only).
 *   • everyone else             — the tab is not rendered.
 *
 * The user-management tools reuse the existing widgets so we don't
 * introduce duplicate UI surfaces.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import AdminUserControlWidget from "@/components/AdminUserControlWidget";
import AdminPasswordResetWidget from "@/components/AdminPasswordResetWidget";

export default function AdminSettingsTab() {
  const { user } = useAuth();
  if (!isAdmin(user)) return null;

  const isFounder = (user.username || "").toLowerCase() === "stealth";

  return (
    <div className="space-y-4" data-testid="tab-admin">
      <div className="or-surface p-4 flex items-center gap-3" data-testid="admin-tab-header">
        <ShieldCheck size={18} style={{ color: "var(--primary)" }} />
        <div className="flex-1">
          <div className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Admin role: {isFounder ? "founder" : (user.admin_role || "admin")}
          </div>
          <div className="text-sm" style={{ color: "var(--text-main)" }}>
            Account & moderation tools. Backend enforces every action.
          </div>
        </div>
        <Link
          to="/admin"
          className="or-btn"
          data-testid="admin-tab-dashboard-link"
        >
          <ExternalLink size={14} /> Go to Admin Dashboard
        </Link>
      </div>

      {/* Founder password reset — sits above the general user-control
          widget because it's the most sensitive tool and is strictly
          founder-only on the backend. */}
      {isFounder && <AdminPasswordResetWidget />}

      {/* Search + suspend / mute / delete / username + email change.
          The widget itself hides the username/email change forms
          when the viewer doesn't have founder permission. */}
      <AdminUserControlWidget />
    </div>
  );
}
