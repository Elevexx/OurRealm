import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Rocket, Eye, Wrench } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

// Site Access Modes — full-screen gate for Beta / Preview / Maintenance.
// Backend enforces independently (middleware); this renders the screen.
const MODE_META = {
  beta: { Icon: Rocket, color: "#2EA0FF", badge: "BETA" },
  preview: { Icon: Eye, color: "#C26BFF", badge: "PREVIEW" },
  maintenance: { Icon: Wrench, color: "#F4A73B", badge: "MAINTENANCE" },
};

export function ModeScreen({ mode, title, message, isPreview, onClose }) {
  const meta = MODE_META[mode] || MODE_META.beta;
  const { Icon } = meta;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: "#060B14" }} data-testid={`site-mode-screen-${mode}`}>
      <div className="max-w-md w-full text-center">
        {isPreview && (
          <button className="or-btn or-btn-ghost text-xs mb-4" onClick={onClose} data-testid="site-mode-preview-close">
            ← Exit preview
          </button>
        )}
        <div className="mx-auto mb-5 w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${meta.color} 15%, transparent)`, boxShadow: `0 0 30px ${meta.color}44` }}>
          <Icon size={30} style={{ color: meta.color }} />
        </div>
        <div className="text-[10px] font-bold tracking-[0.3em] mb-2" style={{ color: meta.color }}>{meta.badge}</div>
        <h1 className="text-2xl font-extrabold mb-3 text-white" style={{ fontFamily: "var(--font-display)" }}>
          {title || "OurRealm"}
        </h1>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{message}</p>
        {!isPreview && (
          <a href="/signin" className="or-btn text-xs font-bold inline-block mt-6"
            style={{ background: meta.color, color: "#0a0a0a" }} data-testid="site-mode-signin-link">
            Member sign in
          </a>
        )}
      </div>
    </div>
  );
}

export default function SiteModeGate() {
  const { user } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState(null);
  useEffect(() => {
    apiClient.get("/access-control/site-status").then((r) => setStatus(r.data)).catch(() => setStatus(null));
  }, [user?.id]);
  if (!status || status.mode === "live" || status.allowed) return null;

  // Public Games is intentionally available even while the rest of OurRealm
  // is gated by Maintenance/Beta/Preview. This exemption is route-scoped only.
  if (location.pathname === "/games" || location.pathname.startsWith("/games/")) return null;

  // REALMLIFE DIRECT GAME BYPASS
  if (
    location.pathname
      .toLowerCase()
      .startsWith("/realmlife")
  ) return null;

  if (["/signin", "/signup"].some((p) => location.pathname.startsWith(p))) return null;
  return <ModeScreen mode={status.mode} title={status.title} message={status.message} />;
}
