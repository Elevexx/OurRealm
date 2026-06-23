/**
 * AdminBackButton — small "← Admin" link rendered at the top-left of
 * every /admin/* subpage. Routes back to the main /admin hub.
 *
 * Lives outside the page's own header so admin pages can drop it in
 * with one import without re-styling their existing layout.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export default function AdminBackButton({ className = "", style }) {
  return (
    <Link
      to="/admin"
      className={`or-chip inline-flex items-center gap-1 ${className}`}
      aria-label="Back to admin hub"
      data-testid="admin-back-button"
      style={{ padding: "0.3rem 0.6rem", fontSize: 12, ...style }}
    >
      <ChevronLeft size={14} />
      <span>Admin</span>
    </Link>
  );
}
