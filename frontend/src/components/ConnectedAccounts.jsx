/**
 * ConnectedAccounts — Settings card showing Google link status.
 * The connected email renders only here (owner's own settings page);
 * it is never part of any public payload consumed elsewhere.
 * No unlinking yet: Google-created accounts have no usable password, so
 * unlink would risk lockout — deferred until a set-password flow exists.
 */
import React from "react";
import { Link2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export const ConnectedAccounts = () => {
  const { user } = useAuth();
  if (!user) return null;
  const linked = !!user.google_auth;
  return (
    <div className="or-surface p-5 mb-4" data-testid="connected-accounts">
      <div className="flex items-center gap-2 mb-1">
        <Link2 size={16} style={{ color: "var(--primary)" }} />
        <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Connected Accounts</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        Sign-in methods linked to your OurRealm account. Only you can see this.
      </p>
      <div className="flex items-center gap-3 py-2.5" style={{ borderTop: "1px solid var(--border-col)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-sm" style={{ color: "var(--text-main)" }}>Google</div>
          <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }} data-testid="connected-google-detail">
            {linked ? user.email : "Not connected — use “Sign in with Google” with this email to link automatically."}
          </div>
        </div>
        {linked ? (
          <span className="or-chip text-[10px]" style={{ color: "#57D98A", borderColor: "#57D98A" }} data-testid="connected-google-status">
            <CheckCircle2 size={11} /> Connected
          </span>
        ) : (
          <span className="or-chip text-[10px]" data-testid="connected-google-status">Not connected</span>
        )}
      </div>
    </div>
  );
};

export default ConnectedAccounts;
