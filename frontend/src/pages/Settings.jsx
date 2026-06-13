import React from "react";
import ModeSwitcher from "@/components/ModeSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl mx-auto" data-testid="settings-page">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Preferences</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Settings</h1>
      </div>

      <div className="or-surface p-5 mb-4">
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Appearance · Mode</h3>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          OurRealm offers four distinct experiences. Your mode persists across the entire app.
        </p>
        <ModeSwitcher />
      </div>

      <div className="or-surface p-5 mb-4">
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Account</h3>
        {user ? (
          <div className="space-y-2 text-sm">
            <div><span style={{ color: "var(--text-muted)" }}>Name: </span><b>{user.name}</b></div>
            <div><span style={{ color: "var(--text-muted)" }}>Email: </span><b>{user.email}</b></div>
            <div><span style={{ color: "var(--text-muted)" }}>Role: </span><b>{user.role}</b></div>
            <button className="or-btn mt-3" onClick={() => { logout(); navigate("/"); }} data-testid="settings-logout">Sign out</button>
          </div>
        ) : (
          <button className="or-btn" onClick={() => navigate("/signin")} data-testid="settings-signin">Sign in</button>
        )}
      </div>

      <div className="or-surface p-5">
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>About</h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          OurRealm · Live. Connect. Experience. v1.0 — multi-mode social platform with widget profiles.
        </p>
      </div>
    </div>
  );
}
